import { describe, expect, it } from 'vitest';
import { extractFrustum, frustum, sphereInFrustum } from '../frustum';
import { mat4, mat4LookAt, mat4Multiply, mat4Perspective } from '../mat4';
import { vec3 } from '../vec3';

describe('frustum', () => {
  const makeViewProj = () => {
    const view = mat4();
    const proj = mat4();
    const vp = mat4();
    mat4LookAt(view, vec3(0, 0, 10), vec3(0, 0, 0), vec3(0, 1, 0));
    mat4Perspective(proj, Math.PI / 3, 1, 0.1, 100);
    mat4Multiply(vp, proj, view);
    return vp;
  };

  it('rejects a sphere behind the camera', () => {
    const planes = extractFrustum(frustum(), makeViewProj());
    expect(sphereInFrustum(planes, 0, 0, 50, 0.1)).toBe(false);
  });

  it('accepts a sphere in front of the camera', () => {
    const planes = extractFrustum(frustum(), makeViewProj());
    expect(sphereInFrustum(planes, 0, 0, 0, 0.5)).toBe(true);
  });

  it('accepts a sphere whose radius straddles a plane', () => {
    const planes = extractFrustum(frustum(), makeViewProj());
    // Just outside laterally, large radius pulls it back in.
    expect(sphereInFrustum(planes, 50, 0, 0, 60)).toBe(true);
  });
});
