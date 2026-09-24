// Pure utility functions for Rower3D — no React, no side-effects.
import * as THREE from 'three';
import { gerstnerChunks, waterSurfaceChunks } from './shaderChunks';
import {
  SWELL_AMPLITUDES_METRES,
  SWELL_WAVELENGTHS_METRES,
  frequencyForWavelength,
} from './waterMaterial';

// Deterministic seeded pseudo-random — avoids Math.random() impurity in render.
// Returns a stable value in [0, 1) for a given seed integer.
export function seededRandom(seed: number): number {
  const s = Math.sin(seed * 9301 + 49297) * 233280;
  return s - Math.floor(s);
}

/** Procedural normal map for boat hull surface grain (#116). */
export function createBoatNormalMap(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 64; canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#8080ff';
  ctx.fillRect(0, 0, 64, 64);
  for (let y = 0; y < 64; y += 4) {
    ctx.strokeStyle = `rgba(120,120,250,0.3)`;
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(64, y); ctx.stroke();
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(4, 2);
  return tex;
}

/** Procedural normal map for Gerstner water ripple detail (#106). */
export function createWaterNormalMap(frequency: number): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const imageData = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = Math.sin(x * frequency * 0.3) * 0.5 + 0.5;
      const ny = Math.cos(y * frequency * 0.3) * 0.5 + 0.5;
      const i = (y * size + x) * 4;
      imageData.data[i]   = Math.floor(nx * 128 + 64);
      imageData.data[i+1] = Math.floor(ny * 128 + 64);
      imageData.data[i+2] = 255;
      imageData.data[i+3] = 255;
    }
  }
  ctx.putImageData(imageData, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8, 8);
  return tex;
}

/** Voronoi-ish caustics cookie texture for the CausticsLight SpotLight (#123). */
export function createCausticsTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 256;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, 256, 256);
  // Use a fixed-seed loop so the texture is deterministic
  for (let i = 0; i < 20; i++) {
    const x = seededRandom(i * 7 + 1) * 256;
    const y = seededRandom(i * 7 + 2) * 256;
    const r = 10 + seededRandom(i * 7 + 3) * 30;
    const g = ctx.createRadialGradient(x, y, r * 0.3, x, y, r);
    g.addColorStop(0, 'rgba(200,220,255,0.8)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 256, 256);
  }
  return new THREE.CanvasTexture(canvas);
}

/**
 * Attach Gerstner wave vertex shader injection to a MeshPhysicalMaterial.
 *
 * @param mat          The material to modify (mutated in place).
 * @param timeUniform  Shared `{ value: number }` uniform updated each frame.
 * @param heightAxis   'z' → PlaneGeometry rotated -PI/2 (height is local Z);
 *                     'y' → horizontal custom geometry (height is local Y).
 * @param cacheKey     Unique string so Three.js recompiles when theme changes.
 */
export function attachGerstnerShader(
  // Standard rather than physical: the water uses a standard material now,
  // because the physical one rendered nothing at all (#269). Physical extends
  // standard, so both still fit.
  mat: THREE.MeshStandardMaterial,
  timeUniform: { value: number },
  heightAxis: 'y' | 'z',
  cacheKey: string,
  waveAmplitude: number = 1.0,
  waveFrequency: number = 1.0,
): void {
  const waveXY = heightAxis === 'z'
    ? 'vec2(position.x, position.y)'
    : 'vec2(position.x, position.z)';


  // The normal points up whichever axis the wave displaces.
  //
  // Both cases used the Z-up form, which is right for the rotated plane and
  // wrong for the curved channel - where height is local Y, so the gradient
  // belongs in X and Z. The river's wave normals pointed downstream rather than
  // up, and it was lit as though the waves lay on their side. No spec saw it:
  // the wave shader is skipped under automation (#298).
  const normalFromGradient = heightAxis === 'z'
    ? 'vec3(-wGrad.x, -wGrad.y, 1.0)'
    : 'vec3(-wGrad.x, 1.0, -wGrad.y)';

  // The swell, written as wavelengths in metres rather than as frequencies.
  //
  // These used to be 0.020 to 0.050 radians per unit, which is 314 m down to
  // 126 m — swell on the scale of a coastline, invisible from a boat. VR-04
  // asks for 1.5–6 m; the mesh cannot carry it (see `waterMaterial.ts`, and
  // the test that holds the floor), so the vertices take the shortest swell
  // they can sample and the ripple texture takes the chop.
  const swell = SWELL_WAVELENGTHS_METRES.map((wavelength) =>
    (frequencyForWavelength(wavelength) * waveFrequency).toFixed(4),
  );
  const amplitudes = SWELL_AMPLITUDES_METRES.map((amplitude) =>
    (amplitude * waveAmplitude).toFixed(4),
  );


  const heightDisplace = heightAxis === 'z'
    ? 'vec3(position.x, position.y, position.z + wH)'
    : 'vec3(position.x, position.y + wH, position.z)';

  // The GLSL itself lives in `shaders/gerstner.vert.glsl` (#341). What is
  // computed here is only what varies per material: which axis the wave
  // displaces, and the swell as numbers.
  const { functions, normal, position } = gerstnerChunks({
    waveXY,
    normalFromGradient,
    heightDisplace,
    amplitudes,
    frequencies: swell,
  });

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = timeUniform;
    shader.vertexShader = functions + shader.vertexShader;
    shader.vertexShader = shader.vertexShader
      .replace('#include <beginnormal_vertex>', normal)
      .replace('#include <begin_vertex>',      position);
  };
  mat.customProgramCacheKey = () => `gerstner-${cacheKey}`;
}

/**
 * Schlick's F0 for water against air: about 2% reflected head-on (#324).
 *
 * The other 98% arrives at a grazing angle, which is why a river is dark
 * underfoot and a mirror at the far bank. One roughness for both is what made
 * the channel read as paint.
 */
export const WATER_FRESNEL_F0 = 0.02;

/**
 * How much of the grazing-angle reflection to blend in.
 *
 * Below 1 because the environment map is a sky and not the whole world: at
 * full strength the far water turns the sky's own colour and the horizon line
 * disappears with it.
 */
export const WATER_FRESNEL_STRENGTH = 0.6;

/**
 * The water's fragment surface: a second layer of ripples, and fresnel.
 *
 * Both live in the fragment shader and both are decisions about the same
 * surface, so they are one injection rather than two hooks fighting over
 * `#include <normal_fragment_maps>`.
 *
 * **The second layer.** three has one `normalMap` slot, and one scrolling
 * layer reads as a texture being dragged across the river rather than as
 * water. The second sample is the same tile at its own offset and its own
 * scale, which is how a surface stops looking like it is on rails.
 *
 * Chained onto whatever hook is already installed: `attachGerstnerShader` owns
 * `onBeforeCompile` for the same material and writes the vertex half. Call
 * this after it.
 */
export function attachWaterSurface(
  mat: THREE.MeshStandardMaterial,
  uniforms: {
    uRipple2Offset: { value: THREE.Vector2 };
    uRipple2Scale: { value: number };
  },
): void {
  const previous = mat.onBeforeCompile;

  // `shaders/waterSurface.frag.glsl` (#341).
  const { uniforms: uniformDeclarations, surface } = waterSurfaceChunks({
    fresnelF0: WATER_FRESNEL_F0,
    fresnelStrength: WATER_FRESNEL_STRENGTH,
  });

  mat.onBeforeCompile = (shader, renderer) => {
    previous?.(shader, renderer);
    shader.uniforms.uRipple2Offset = uniforms.uRipple2Offset;
    shader.uniforms.uRipple2Scale = uniforms.uRipple2Scale;
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', `${uniformDeclarations}void main() {`)
      .replace('#include <normal_fragment_maps>', surface);
  };
}
