import { describe, it, expect } from 'vitest';
import { parser } from '@shaderfrog/glsl-parser';
import {
  splitChunks,
  fillPlaceholders,
  gerstnerChunks,
  waterSurfaceChunks,
  foliageBillboardChunks,
  foliageSwayChunks,
} from '../components/rower3d/shaderChunks';
import { WATER_FRESNEL_F0, WATER_FRESNEL_STRENGTH } from '../components/rower3d/helpers';
import { countShaderErrors } from '../components/rower3d/shaderErrors';

/**
 * Issue #341 — the GLSL parses in CI instead of on a rower's GPU.
 *
 * Every chunk here is spliced into one of three's own shaders at
 * `onBeforeCompile`. Nothing checked them: a typo compiled fine as TypeScript,
 * shipped, and surfaced as a WebGL compile error on whatever hardware happened
 * to load it. #298 is what that costs - a wave normal built on the wrong axis
 * lit the river as though the swell lay on its side, and no spec saw it.
 *
 * What these cases can and cannot do. A parser is not a compiler: it will not
 * tell you a normal points the wrong way, and it does not know three's
 * built-ins. What it will not let past is a shader that is not GLSL - an
 * unbalanced brace, a missing semicolon, a `vec3` given two arguments - which
 * is the class of fault that used to reach a GPU.
 */

/**
 * The declarations three's own shader would have provided.
 *
 * The chunks are fragments: they read `position`, write `transformed`, and
 * call functions three declares above them. To parse one on its own it has to
 * be given that context, and this is the smallest version of it that is
 * honest - every name here is one three really does declare, at the point the
 * chunk is injected.
 */
const THREE_VERTEX_PRELUDE = `
precision highp float;
attribute vec3 position;
attribute vec3 normal;
attribute vec2 uv;
attribute vec4 tangent;
uniform mat4 instanceMatrix;
`;

const THREE_FRAGMENT_PRELUDE = `
precision highp float;
uniform sampler2D normalMap;
uniform vec2 normalScale;
varying vec2 vNormalMapUv;
varying vec3 vViewPosition;
mat3 tbn = mat3(1.0);
vec3 normal = vec3(0.0, 1.0, 0.0);
vec4 diffuseColor = vec4(1.0);
`;

/**
 * Wrap a chunk in a complete shader and parse it.
 *
 * Preprocessor directives are stripped first: `#ifdef USE_TANGENT` and
 * `#include <normal_fragment_maps>` are three's business, resolved before a
 * GPU ever sees them, and a GLSL grammar has no opinion on either. Removing
 * them keeps both branches of an `#ifdef` in the text, which is what we want -
 * each is code that has to be valid.
 */
const withoutPreprocessor = (glsl: string) =>
  glsl
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n');

const parseInMain = (prelude: string, body: string) => {
  const source = `${prelude}\nvoid main() {\n${withoutPreprocessor(body)}\n}\n`;
  return () => parser.parse(source);
};

/** The values the water is really built with, so the chunks are the real ones. */
const gerstnerForAxis = (heightAxis: 'y' | 'z') =>
  gerstnerChunks({
    waveXY:
      heightAxis === 'z' ? 'vec2(position.x, position.y)' : 'vec2(position.x, position.z)',
    normalFromGradient:
      heightAxis === 'z' ? 'vec3(-wGrad.x, -wGrad.y, 1.0)' : 'vec3(-wGrad.x, 1.0, -wGrad.y)',
    heightDisplace:
      heightAxis === 'z'
        ? 'vec3(position.x, position.y, position.z + wH)'
        : 'vec3(position.x, position.y + wH, position.z)',
    amplitudes: ['0.0450', '0.0300', '0.0220', '0.0150'],
    frequencies: ['1.0472', '1.5708', '2.0944', '4.1888'],
  });

describe('the scene’s GLSL parses', () => {
  describe('the Gerstner swell', () => {
    // Both axes, because they are different shaders: the curved channel
    // displaces local Y and the rotated plane local Z, and #298 was one of
    // them being written as the other.
    for (const axis of ['y', 'z'] as const) {
      it(`builds a vertex shader for the ${axis}-up mesh`, () => {
        const chunks = gerstnerForAxis(axis);
        const body = `${chunks.normal}\n${chunks.position}`;

        expect(parseInMain(`${THREE_VERTEX_PRELUDE}\n${chunks.functions}`, body)).not.toThrow();
      });
    }

    it('leaves no placeholder unfilled', () => {
      const chunks = gerstnerForAxis('y');
      const all = `${chunks.functions}${chunks.normal}${chunks.position}`;

      for (const token of ['WAVE_XY', 'NORMAL_FROM_GRADIENT', 'HEIGHT_DISPLACE', 'AMP0', 'FREQ3']) {
        expect(all, `${token} was never substituted`).not.toContain(token);
      }
    });

    // The numbers are the point of the chunk; a substitution that silently
    // dropped them would still parse.
    it('carries the amplitudes and frequencies it was given', () => {
      const chunks = gerstnerForAxis('y');

      expect(chunks.position).toContain('0.0450');
      expect(chunks.position).toContain('4.1888');
      expect(chunks.normal).toContain('0.0150');
    });
  });

  it('builds the water surface fragment shader', () => {
    const chunks = waterSurfaceChunks({
      fresnelF0: WATER_FRESNEL_F0,
      fresnelStrength: WATER_FRESNEL_STRENGTH,
    });

    expect(
      parseInMain(`${THREE_FRAGMENT_PRELUDE}\n${chunks.uniforms}`, chunks.surface),
    ).not.toThrow();
  });

  // `FRESNEL_F0` is a prefix of `FRESNEL_F0_INV`, so a substitution that did
  // not respect word boundaries would leave `0.0200_INV` in the shader.
  it('fills the fresnel constants without corrupting each other', () => {
    const { surface } = waterSurfaceChunks({ fresnelF0: 0.02, fresnelStrength: 0.6 });

    expect(surface).toContain('0.0200 + 0.9800');
    expect(surface).not.toContain('_INV');
    expect(surface).toContain('0.6000');
  });

  it('builds the billboard foliage shaders', () => {
    const chunks = foliageBillboardChunks();

    expect(
      parseInMain(
        `${THREE_VERTEX_PRELUDE}\n${chunks.vertexDeclarations}\nvec3 transformed = position;`,
        `${chunks.sway}${chunks.tint}`,
      ),
    ).not.toThrow();
    expect(
      parseInMain(`${THREE_FRAGMENT_PRELUDE}\n${chunks.fragmentDeclarations}`, chunks.tintFragment),
    ).not.toThrow();
  });

  it('builds the kit foliage sway', () => {
    const chunks = foliageSwayChunks();

    expect(
      parseInMain(
        `${THREE_VERTEX_PRELUDE}\n${chunks.declarations}\nvec3 transformed = position;`,
        chunks.sway,
      ),
    ).not.toThrow();
  });

  /**
   * The gate, gated.
   *
   * A parse test that cannot fail is worse than none, because it reads as
   * cover. This is the fault the whole file exists to catch, written down.
   */
  it('rejects GLSL that is not GLSL', () => {
    const broken = 'float swayAmt = sin(uTime * 1.2 + position.x * 0.5;';

    expect(parseInMain(THREE_VERTEX_PRELUDE, broken)).toThrow();
  });
});

describe('splitting a shader file into chunks', () => {
  const source = [
    '// what this shader is for',
    '// @chunk:first',
    'float a = 1.0;',
    '',
    '// @chunk:second',
    'float b = 2.0;',
  ].join('\n');

  it('keys each chunk by the name on its marker', () => {
    expect(Object.keys(splitChunks(source))).toEqual(['first', 'second']);
  });

  it('drops the header above the first marker', () => {
    expect(splitChunks(source).first).not.toContain('what this shader is for');
    expect(splitChunks(source).first).toBe('float a = 1.0;\n');
  });

  it('substitutes whole words only', () => {
    expect(fillPlaceholders('A + A_LONGER', { A: '1.0', A_LONGER: '2.0' })).toBe('1.0 + 2.0');
  });
});

/**
 * Issue #341 — what the parser cannot know, the driver still can.
 *
 * A parse test proves the chunks are GLSL. It cannot prove a driver will
 * compile them: a `varying` the two halves of a program disagree about, or a
 * built-in that exists in one GLSL version and not the next, is valid GLSL and
 * still a black scene. `countShaderErrors` is how a spec finds out.
 */
describe('counting shaders the driver refused', () => {
  // A plain object, because the thing under test takes a `Pick` of the context
  // rather than the context itself - which is the whole reason it can be tested
  // without a GPU.
  const COMPILE_STATUS = 0x8b81;
  type Compiling = Parameters<typeof countShaderErrors>[0];
  const fakeGl = (compiles: boolean): Compiling =>
    ({
      COMPILE_STATUS,
      getShaderParameter: (_shader: WebGLShader, pname: number) =>
        pname === COMPILE_STATUS ? compiles : 1,
      getShaderInfoLog: () => 'ERROR: 0:12: undeclared identifier',
    }) as unknown as Compiling;
  const anyShader = {} as WebGLShader;

  it('says nothing while shaders compile', () => {
    const logs: string[] = [];
    const gl = countShaderErrors(fakeGl(true), (log) => logs.push(log));

    gl.getShaderParameter(anyShader, COMPILE_STATUS);

    expect(logs).toEqual([]);
  });

  it('reports the driver’s own log when one does not', () => {
    const logs: string[] = [];
    const gl = countShaderErrors(fakeGl(false), (log) => logs.push(log));

    gl.getShaderParameter(anyShader, COMPILE_STATUS);

    expect(logs).toEqual(['ERROR: 0:12: undeclared identifier']);
  });

  // Compiling is asynchronous: the failure is knowable when someone asks for
  // COMPILE_STATUS, and only then. Every other query has to pass through.
  it('leaves every other query alone, and its answer intact', () => {
    const logs: string[] = [];
    const gl = countShaderErrors(fakeGl(false), (log) => logs.push(log));

    expect(gl.getShaderParameter(anyShader, 0x8b88)).toBe(1);
    expect(logs).toEqual([]);
  });
});
