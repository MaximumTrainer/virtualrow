import gerstnerSource from './shaders/gerstner.vert.glsl?raw';
import waterSurfaceSource from './shaders/waterSurface.frag.glsl?raw';
import foliageBillboardSource from './shaders/foliageBillboard.glsl?raw';
import foliageSwaySource from './shaders/foliageSway.vert.glsl?raw';

/**
 * The GLSL this scene injects into three's shaders, read from files (#341).
 *
 * It used to be template strings spliced together inside `onBeforeCompile`,
 * where a typo surfaced as a WebGL compile error on a rower's GPU and nothing
 * else - no editor knew it was GLSL, and nothing in CI ever read it. #298 is
 * the cost of that: a normal built on the wrong axis shipped unnoticed, because
 * the only thing that could have caught it was looking at the river.
 *
 * The files are the shaders; this module is only the seam. It splits them on
 * `// @chunk:<name>` markers and fills the few values that are computed per
 * material - an axis, a wavelength - leaving everything else exactly as
 * written. `shaders.test.ts` assembles each chunk into a complete shader and
 * parses it, so a typo now fails a unit test.
 */

/** A shader file's chunks, by the name on their marker. */
export type ShaderChunks = Record<string, string>;

const CHUNK_MARKER = /^\s*\/\/\s*@chunk:(\w+)\s*$/;

/**
 * Whole-line comments stay in the file and out of the shader.
 *
 * The prose explaining why a wave is phased the way it is belongs beside the
 * line it explains - that is most of the point of moving this out of template
 * literals. It does not belong in the string handed to a GPU: three compiles
 * what it is given, and every one of these materials would carry a paragraph
 * of it.
 *
 * Whole-line only. Nothing here puts a comment after code, and GLSL has no
 * strings for a `//` to hide in.
 */
const isNotComment = (line: string) => !/^\s*\/\//.test(line);

/**
 * Split a `.glsl` file on its `// @chunk:` markers.
 *
 * Anything before the first marker is the file's own header - what the shader
 * is for, and which placeholders it takes - and belongs to no chunk.
 */
export const splitChunks = (source: string): ShaderChunks => {
  const chunks: ShaderChunks = {};
  let current: string | null = null;
  const lines: Record<string, string[]> = {};

  for (const line of source.split('\n')) {
    const marker = CHUNK_MARKER.exec(line);
    if (marker) {
      current = marker[1];
      lines[current] ??= [];
      continue;
    }
    if (current) lines[current].push(line);
  }

  for (const [name, body] of Object.entries(lines)) {
    chunks[name] = `${body.filter(isNotComment).join('\n').trim()}\n`;
  }
  return chunks;
};

/**
 * Substitute `PLACEHOLDER` tokens, whole-word only.
 *
 * Whole-word because the names overlap: `AMP0` is a prefix of nothing here, but
 * `FRESNEL_F0` is a prefix of `FRESNEL_F0_INV`, and a plain `replaceAll` would
 * turn the longer one into `0.0200_INV`. Word boundaries make the order the
 * substitutions are applied in stop mattering.
 */
export const fillPlaceholders = (source: string, values: Record<string, string>): string =>
  Object.entries(values).reduce(
    (filled, [token, value]) => filled.replace(new RegExp(`\\b${token}\\b`, 'g'), value),
    source,
  );

const gerstner = splitChunks(gerstnerSource);
const waterSurface = splitChunks(waterSurfaceSource);
const foliageBillboard = splitChunks(foliageBillboardSource);
const foliageSway = splitChunks(foliageSwaySource);

export interface GerstnerValues {
  /** Where the wave is sampled, in the mesh's own axes. */
  waveXY: string;
  /** The normal, pointing up whichever axis displaces. */
  normalFromGradient: string;
  /** The displaced position. */
  heightDisplace: string;
  /** Four amplitudes in metres, already scaled, as GLSL literals. */
  amplitudes: readonly string[];
  /** Four frequencies, already scaled, as GLSL literals. */
  frequencies: readonly string[];
}

/** The three chunks `attachGerstnerShader` injects, with its numbers in them. */
export const gerstnerChunks = (values: GerstnerValues) => {
  const substitutions: Record<string, string> = {
    WAVE_XY: values.waveXY,
    NORMAL_FROM_GRADIENT: values.normalFromGradient,
    HEIGHT_DISPLACE: values.heightDisplace,
  };
  values.amplitudes.forEach((amplitude, i) => {
    substitutions[`AMP${i}`] = amplitude;
  });
  values.frequencies.forEach((frequency, i) => {
    substitutions[`FREQ${i}`] = frequency;
  });

  return {
    functions: gerstner.functions,
    normal: fillPlaceholders(gerstner.normal, substitutions),
    position: fillPlaceholders(gerstner.position, substitutions),
  };
};

export interface WaterSurfaceValues {
  fresnelF0: number;
  fresnelStrength: number;
}

/** The uniforms and the surface chunk `attachWaterSurface` injects. */
export const waterSurfaceChunks = ({ fresnelF0, fresnelStrength }: WaterSurfaceValues) => ({
  uniforms: waterSurface.uniforms,
  surface: fillPlaceholders(waterSurface.surface, {
    FRESNEL_F0: fresnelF0.toFixed(4),
    FRESNEL_F0_INV: (1 - fresnelF0).toFixed(4),
    FRESNEL_STRENGTH: fresnelStrength.toFixed(4),
  }),
});

/** The billboard foliage's chunks. Nothing here is computed per material. */
export const foliageBillboardChunks = () => ({
  vertexDeclarations: foliageBillboard.vertexDeclarations,
  sway: foliageBillboard.sway,
  tint: foliageBillboard.tint,
  fragmentDeclarations: foliageBillboard.fragmentDeclarations,
  tintFragment: foliageBillboard.tintFragment,
});

/** The kit foliage's older per-vertex sway (#107). */
export const foliageSwayChunks = () => ({
  declarations: foliageSway.declarations,
  sway: foliageSway.sway,
});
