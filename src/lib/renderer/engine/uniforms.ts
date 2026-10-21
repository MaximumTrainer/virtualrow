/**
 * Shared `frame` uniform block uploaded once per frame (#550 FR3). The layout
 * is a packed std140-style struct that the WGSL `Frame` definition in each
 * pass shader must mirror exactly.
 *
 *   view      mat4   16 floats   offset 0
 *   proj      mat4   16 floats   offset 16
 *   viewProj  mat4   16 floats   offset 32
 *   camPos    vec3    3 floats   offset 48, pad to 4
 *   sunDir    vec3    3 floats   offset 52, pad to 4
 *   fog       vec4    4 floats   offset 56
 *   time      f32     1 float    offset 60, pad to 4
 *
 * Total 64 vec4-aligned floats = 256 bytes. The pad after `time` keeps the
 * buffer size a multiple of 16, which is a std140 requirement.
 */

/// <reference types="@webgpu/types" />

import type { Mat4 } from '../math/mat4';
import type { FrameUniforms } from './frameGraph';

export const FRAME_UNIFORMS_FLOATS = 64;
export const FRAME_UNIFORMS_BYTES = FRAME_UNIFORMS_FLOATS * 4;

/**
 * Shadow uniform block (#559 FR1). Mirrors `ShadowUniforms` in
 * `shaderSnippets.ts`. 4 cascades × 16 floats (mat4) + 4 (splits) + 4
 * (radius) + 4 (blend + count + tile + atlas width) = 76 floats = 304
 * bytes, padded up to 320 to keep the std140 size a multiple of 16.
 */
export const SHADOW_UNIFORMS_FLOATS = 80;
export const SHADOW_UNIFORMS_BYTES = SHADOW_UNIFORMS_FLOATS * 4;

export interface ShadowUniformsCpu {
  cascadeViewProj: Mat4[]; // length 4; indices ≥ `cascadeCount` are zeroed
  cascadeSplits: Float32Array; // vec4
  cascadeRadius: Float32Array; // vec4
  cascadeBlendStartRatio: number;
  cascadeCount: number;
  tileSize: number;
  atlasWidth: number;
}

export const createShadowUniformBuffer = (device: GPUDevice): GPUBuffer =>
  device.createBuffer({
    label: 'shadow-uniforms',
    size: SHADOW_UNIFORMS_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

export const packShadowUniforms = (
  shadows: ShadowUniformsCpu,
  out = new Float32Array(SHADOW_UNIFORMS_FLOATS),
): Float32Array => {
  out.fill(0);
  // 4 × mat4 = 64 floats, offset 0..63
  for (let i = 0; i < 4; i++) {
    const m = shadows.cascadeViewProj[i];
    if (!m) continue;
    out.set(m, i * 16);
  }
  out.set(shadows.cascadeSplits.subarray(0, 4), 64);
  out.set(shadows.cascadeRadius.subarray(0, 4), 68);
  out[72] = shadows.cascadeBlendStartRatio;
  // cascadeCount is a u32 in WGSL; re-cast via the shared buffer.
  const asU32 = new Uint32Array(out.buffer, out.byteOffset);
  asU32[73] = shadows.cascadeCount >>> 0;
  out[74] = shadows.tileSize;
  out[75] = shadows.atlasWidth;
  return out;
};

export const createFrameUniformBuffer = (device: GPUDevice): GPUBuffer =>
  device.createBuffer({
    label: 'frame-uniforms',
    size: FRAME_UNIFORMS_BYTES,
    usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

export const packFrameUniforms = (
  frame: FrameUniforms,
  out = new Float32Array(FRAME_UNIFORMS_FLOATS),
): Float32Array => {
  out.set(frame.view, 0);
  out.set(frame.proj, 16);
  out.set(frame.viewProj, 32);
  out[48] = frame.camPos[0];
  out[49] = frame.camPos[1];
  out[50] = frame.camPos[2];
  // 51 pad
  out[52] = frame.sunDir[0];
  out[53] = frame.sunDir[1];
  out[54] = frame.sunDir[2];
  // 55 pad
  out[56] = frame.fog[0];
  out[57] = frame.fog[1];
  out[58] = frame.fog[2];
  out[59] = frame.fog[3];
  out[60] = frame.time;
  // 61,62,63 pad
  return out;
};
