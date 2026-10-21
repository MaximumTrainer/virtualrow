/**
 * Cascaded Shadow Maps — three-free port of three-csm's practical-split core
 * (#559 FR2). Builds per-cascade view-projection matrices + split depths
 * from the camera's near / far and a world-space light direction.
 *
 * The three side uses `CSM` from `three/examples/jsm/csm/CSM.js`; this port
 * keeps the pieces the renderer needs: the practical-split formula (mix of
 * uniform and logarithmic), the view-space-AABB-to-light-space fit, and
 * texel-grid stabilisation so sliding the camera doesn't shimmer the
 * cascades. Everything runs on `Mat4` from `../math/mat4` — no three import
 * under `src/lib/renderer/` (ESLint rule from P2 enforces).
 */

import { mat4, mat4Identity, mat4LookAt, mat4Multiply } from '../math/mat4';
import type { Mat4 } from '../math/mat4';
import type { Vec3 } from '../math/vec3';

export interface CascadedShadowsConfig {
  /** Number of cascades (2..4). */
  cascades: number;
  /** Camera near / far clip. */
  near: number;
  far: number;
  /** Camera vertical FOV in radians (used to build the view frustum). */
  fovY: number;
  /** Aspect ratio (width/height). */
  aspect: number;
  /** World-space camera position. */
  camPos: Vec3;
  /** World-space camera forward (points into the scene). */
  camForward: Vec3;
  /** World-space camera up. */
  camUp: Vec3;
  /**
   * World-space light direction — points *from* the light *toward* the
   * scene (same convention as `cascadedShadowsCore.ts`).
   */
  lightDirection: Vec3;
  /**
   * `practical`-blend lambda (0..1). 0 = uniform splits, 1 = logarithmic
   * splits; three-csm uses `mode: 'practical'` which maps to ~0.5.
   */
  lambda?: number;
  /**
   * Resolution (texels) of one cascade tile on the atlas; used for the
   * texel-grid snap that stabilises cascades across camera motion.
   */
  tileTexels: number;
}

export interface CascadeData {
  /** Per-cascade light view-projection matrix (col-major). */
  viewProj: Mat4;
  /** Half-side of the cascade's orthographic volume in world units. */
  radius: number;
}

export interface ComputedCascades {
  /** Up to 4 cascades, filled from index 0; indices ≥ cascades are zeroed. */
  cascades: CascadeData[];
  /**
   * Split depths in view space. `splits[i]` is the far distance of
   * cascade `i`; `splits[cascades-1]` is the shadow range's far clip.
   * Monotonically increasing (asserted by `cascadedShadows.test.ts`).
   */
  splits: Float32Array;
}

const EPSILON = 1e-6;

const normalize3 = (out: Vec3, v: Vec3): Vec3 => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  out[0] = v[0] / l;
  out[1] = v[1] / l;
  out[2] = v[2] / l;
  return out;
};

const cross3 = (out: Vec3, a: Vec3, b: Vec3): Vec3 => {
  const ax = a[0], ay = a[1], az = a[2];
  const bx = b[0], by = b[1], bz = b[2];
  out[0] = ay * bz - az * by;
  out[1] = az * bx - ax * bz;
  out[2] = ax * by - ay * bx;
  return out;
};

/**
 * Practical split: mix uniform (`near + (far-near) * i/N`) and logarithmic
 * (`near * (far/near)^(i/N)`) at `lambda`. Returns `cascades` far distances
 * ending at `far`.
 */
export const practicalSplits = (
  near: number,
  far: number,
  cascades: number,
  lambda = 0.5,
): Float32Array => {
  const out = new Float32Array(cascades);
  for (let i = 1; i <= cascades; i++) {
    const p = i / cascades;
    const logSplit = near * Math.pow(far / near, p);
    const uniformSplit = near + (far - near) * p;
    out[i - 1] = lambda * logSplit + (1 - lambda) * uniformSplit;
  }
  return out;
};

/**
 * Build an orthographic matrix (left/right/bottom/top/near/far). Column
 * major — matches `mat4Perspective`'s convention so WGSL reads it unchanged.
 */
const mat4Ortho = (
  out: Mat4,
  left: number,
  right: number,
  bottom: number,
  top: number,
  near: number,
  far: number,
): Mat4 => {
  const dx = right - left || EPSILON;
  const dy = top - bottom || EPSILON;
  const dz = far - near || EPSILON;
  out.fill(0);
  out[0] = 2 / dx;
  out[5] = 2 / dy;
  out[10] = -2 / dz;
  out[12] = -(right + left) / dx;
  out[13] = -(top + bottom) / dy;
  out[14] = -(far + near) / dz;
  out[15] = 1;
  return out;
};

const emptyCascade = (): CascadeData => ({
  viewProj: mat4Identity(mat4()),
  radius: 0,
});

/**
 * Compute `cascades` light view-projection matrices + their split far
 * depths. Each cascade fits an orthographic volume around the view
 * frustum's slice from `splits[i-1]` to `splits[i]` and texel-snaps the
 * origin for stability.
 */
export const computeCascades = (
  config: CascadedShadowsConfig,
): ComputedCascades => {
  const cascades = Math.max(1, Math.min(4, Math.floor(config.cascades)));
  const splits = practicalSplits(
    config.near,
    config.far,
    cascades,
    config.lambda ?? 0.5,
  );

  // Light basis — look *along* `lightDirection` from a point above the
  // camera. Build a stable right/up pair avoiding colinearity with
  // (0, 1, 0).
  const lightDir: Vec3 = new Float32Array([
    config.lightDirection[0],
    config.lightDirection[1],
    config.lightDirection[2],
  ]);
  normalize3(lightDir, lightDir);

  const tmpUp: Vec3 = new Float32Array(3);
  if (Math.abs(lightDir[1]) > 0.95) {
    tmpUp[0] = 0;
    tmpUp[1] = 0;
    tmpUp[2] = 1;
  } else {
    tmpUp[0] = 0;
    tmpUp[1] = 1;
    tmpUp[2] = 0;
  }
  const lightRight: Vec3 = new Float32Array(3);
  cross3(lightRight, lightDir, tmpUp);
  normalize3(lightRight, lightRight);
  const lightUp: Vec3 = new Float32Array(3);
  cross3(lightUp, lightRight, lightDir);
  normalize3(lightUp, lightUp);

  // Camera basis.
  const camForward: Vec3 = new Float32Array(3);
  normalize3(camForward, config.camForward);
  const camRight: Vec3 = new Float32Array(3);
  cross3(camRight, camForward, config.camUp);
  normalize3(camRight, camRight);
  const camUp: Vec3 = new Float32Array(3);
  cross3(camUp, camRight, camForward);
  normalize3(camUp, camUp);

  const halfFovTan = Math.tan(config.fovY / 2);
  const camPos = config.camPos;

  const out: CascadeData[] = [];
  let prevSplit = config.near;

  for (let i = 0; i < 4; i++) {
    if (i >= cascades) {
      out.push(emptyCascade());
      continue;
    }
    const splitNear = prevSplit;
    const splitFar = splits[i];
    prevSplit = splitFar;

    // Frustum corners in world space for this slice.
    const yn = halfFovTan * splitNear;
    const xn = yn * config.aspect;
    const yf = halfFovTan * splitFar;
    const xf = yf * config.aspect;
    // 8 corners: near TL/TR/BR/BL, far TL/TR/BR/BL.
    const corners: Vec3[] = [];
    const addCorner = (fx: number, fy: number, fz: number): void => {
      const wx =
        camPos[0] + camRight[0] * fx + camUp[0] * fy + camForward[0] * fz;
      const wy =
        camPos[1] + camRight[1] * fx + camUp[1] * fy + camForward[1] * fz;
      const wz =
        camPos[2] + camRight[2] * fx + camUp[2] * fy + camForward[2] * fz;
      corners.push(new Float32Array([wx, wy, wz]));
    };
    addCorner(-xn, yn, splitNear);
    addCorner(xn, yn, splitNear);
    addCorner(xn, -yn, splitNear);
    addCorner(-xn, -yn, splitNear);
    addCorner(-xf, yf, splitFar);
    addCorner(xf, yf, splitFar);
    addCorner(xf, -yf, splitFar);
    addCorner(-xf, -yf, splitFar);

    // Centroid for a stable light-view origin.
    let cxw = 0, cyw = 0, czw = 0;
    for (const c of corners) {
      cxw += c[0];
      cyw += c[1];
      czw += c[2];
    }
    cxw /= 8;
    cyw /= 8;
    czw /= 8;

    // Bounding sphere radius (keeps the cascade stable under camera rotation).
    let radius = 0;
    for (const c of corners) {
      const dx = c[0] - cxw;
      const dy = c[1] - cyw;
      const dz = c[2] - czw;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > radius) radius = d;
    }
    radius = Math.ceil(radius * 16) / 16;

    // Texel-grid snap: project centroid onto the light's XY plane and
    // round to the atlas tile's texel size, so adjacent frames align.
    const texelsPerUnit = config.tileTexels / (2 * radius);
    const lookX = cxw - lightDir[0] * (radius + 10);
    const lookY = cyw - lightDir[1] * (radius + 10);
    const lookZ = czw - lightDir[2] * (radius + 10);
    const lightView = mat4Identity(mat4());
    mat4LookAt(
      lightView,
      new Float32Array([lookX, lookY, lookZ]),
      new Float32Array([cxw, cyw, czw]),
      lightUp,
    );
    // Snap origin to texel grid in light view space.
    const originLightX = lightView[0] * cxw + lightView[4] * cyw + lightView[8] * czw + lightView[12];
    const originLightY = lightView[1] * cxw + lightView[5] * cyw + lightView[9] * czw + lightView[13];
    const snappedX = Math.round(originLightX * texelsPerUnit) / texelsPerUnit;
    const snappedY = Math.round(originLightY * texelsPerUnit) / texelsPerUnit;
    const dxs = snappedX - originLightX;
    const dys = snappedY - originLightY;
    lightView[12] += dxs;
    lightView[13] += dys;

    const lightProj = mat4Identity(mat4());
    // Z range covers the sphere plus a generous caster-near-plane extension.
    const zNear = -radius - 50;
    const zFar = radius + 50;
    mat4Ortho(lightProj, -radius, radius, -radius, radius, zNear, zFar);

    const viewProj = mat4Identity(mat4());
    mat4Multiply(viewProj, lightProj, lightView);
    out.push({ viewProj, radius });
  }

  return { cascades: out, splits };
};
