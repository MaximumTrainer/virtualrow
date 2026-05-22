// Pure utility functions for Rower3D — no React, no side-effects.
import * as THREE from 'three';

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
  mat: THREE.MeshPhysicalMaterial,
  timeUniform: { value: number },
  heightAxis: 'y' | 'z',
  cacheKey: string,
  waveAmplitude: number = 1.0,
  waveFrequency: number = 1.0,
): void {
  const waveXY = heightAxis === 'z'
    ? 'vec2(position.x, position.y)'
    : 'vec2(position.x, position.z)';

  const glslFunctions = `
    uniform float uTime;
    float gWave(vec2 p, vec2 dir, float amp, float freq, float spd) {
      vec2 nd = normalize(dir);
      return amp * sin(dot(nd, p) * freq - spd * uTime);
    }
    vec2 gWaveGrad(vec2 p, vec2 dir, float amp, float freq, float spd) {
      vec2 nd = normalize(dir);
      return amp * freq * nd * cos(dot(nd, p) * freq - spd * uTime);
    }
  `;

  const normalChunk = `
    vec2 wXY = ${waveXY};
    vec2 wGrad = gWaveGrad(wXY, vec2( 1.0,  0.3), ${(0.15 * waveAmplitude).toFixed(4)}, ${(0.020 * waveFrequency).toFixed(4)}, 0.80)
               + gWaveGrad(wXY, vec2(-0.3,  1.0), ${(0.12 * waveAmplitude).toFixed(4)}, ${(0.025 * waveFrequency).toFixed(4)}, 0.60)
               + gWaveGrad(wXY, vec2( 0.7,  0.7), ${(0.08 * waveAmplitude).toFixed(4)}, ${(0.015 * waveFrequency).toFixed(4)}, 1.10)
               + gWaveGrad(wXY, vec2( 0.5, -0.5), ${(0.04 * waveAmplitude).toFixed(4)}, ${(0.050 * waveFrequency).toFixed(4)}, 1.50);
    vec3 objectNormal = normalize(vec3(-wGrad.x, -wGrad.y, 1.0));
    #ifdef USE_TANGENT
      vec3 objectTangent = vec3(tangent.xyz);
    #endif
  `;

  const heightDisplace = heightAxis === 'z'
    ? 'vec3(position.x, position.y, position.z + wH)'
    : 'vec3(position.x, position.y + wH, position.z)';

  const positionChunk = `
    float wH = gWave(wXY, vec2( 1.0,  0.3), ${(0.15 * waveAmplitude).toFixed(4)}, ${(0.020 * waveFrequency).toFixed(4)}, 0.80)
             + gWave(wXY, vec2(-0.3,  1.0), ${(0.12 * waveAmplitude).toFixed(4)}, ${(0.025 * waveFrequency).toFixed(4)}, 0.60)
             + gWave(wXY, vec2( 0.7,  0.7), ${(0.08 * waveAmplitude).toFixed(4)}, ${(0.015 * waveFrequency).toFixed(4)}, 1.10)
             + gWave(wXY, vec2( 0.5, -0.5), ${(0.04 * waveAmplitude).toFixed(4)}, ${(0.050 * waveFrequency).toFixed(4)}, 1.50);
    vec3 transformed = ${heightDisplace};
  `;

  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = timeUniform;
    shader.vertexShader = glslFunctions + shader.vertexShader;
    shader.vertexShader = shader.vertexShader
      .replace('#include <beginnormal_vertex>', normalChunk)
      .replace('#include <begin_vertex>',      positionChunk);
  };
  mat.customProgramCacheKey = () => `gerstner-${cacheKey}`;
}
