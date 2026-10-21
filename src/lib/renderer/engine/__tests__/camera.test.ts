import { describe, expect, it } from 'vitest';
import {
  BASE_FOV,
  CAMERA_VIEWS,
  cameraTarget,
  createRigTarget,
  dampedFollowOffset,
  isCameraView,
  nextView,
  portraitFov,
} from '../camera';
import { vec3 } from '../../math/vec3';

describe('camera rig', () => {
  it('ships the four views in the right order', () => {
    expect(CAMERA_VIEWS).toEqual(['chase', 'side', 'bow', 'high']);
    expect(nextView('chase')).toBe('side');
    expect(nextView('high')).toBe('chase');
    expect(nextView('unknown' as never)).toBe('chase');
  });

  it('narrows arbitrary values to camera views', () => {
    expect(isCameraView('chase')).toBe(true);
    expect(isCameraView('elsewhere')).toBe(false);
    expect(isCameraView(42)).toBe(false);
  });

  it('writes a chase target behind the boat', () => {
    const target = createRigTarget();
    cameraTarget(
      {
        boat: vec3(0, 0, 0),
        tangent: vec3(0, 0, -1),
        velocityMps: 0,
        view: 'chase',
        bendSign: 0,
      },
      target,
    );
    // Chase sits 7 m behind along -tangent, which places it +7 on z here.
    expect(target.position[2]).toBeCloseTo(7);
    expect(target.position[1]).toBeCloseTo(2.6);
    expect(target.fov).toBeCloseTo(BASE_FOV);
  });

  it('reads reducedMotion for the fov coupling', () => {
    const target = createRigTarget();
    cameraTarget(
      {
        boat: vec3(0, 0, 0),
        tangent: vec3(0, 0, -1),
        velocityMps: 10,
        view: 'chase',
        bendSign: 0,
        reducedMotion: true,
      },
      target,
    );
    expect(target.fov).toBe(BASE_FOV);
  });

  it('respects bendSign for the side view', () => {
    const target = createRigTarget();
    cameraTarget(
      {
        boat: vec3(0, 0, 0),
        tangent: vec3(0, 0, -1),
        velocityMps: 0,
        view: 'side',
        bendSign: -1,
      },
      target,
    );
    expect(target.position[0]).toBeLessThan(0);
  });

  it('clamps the fov at speed', () => {
    const target = createRigTarget();
    cameraTarget(
      {
        boat: vec3(0, 0, 0),
        tangent: vec3(0, 0, -1),
        velocityMps: 100,
        view: 'chase',
        bendSign: 0,
      },
      target,
    );
    expect(target.fov).toBeGreaterThan(BASE_FOV);
    expect(target.fov).toBeLessThanOrEqual(BASE_FOV + 11);
  });

  it('widens the field of view on a portrait aspect', () => {
    expect(portraitFov(BASE_FOV, 1.6)).toBe(BASE_FOV);
    expect(portraitFov(BASE_FOV, 0.5)).toBeGreaterThan(BASE_FOV);
    expect(portraitFov(BASE_FOV, -1)).toBe(BASE_FOV);
  });

  it('damps the offset towards the target', () => {
    const offset = vec3(0, 0, 0);
    const out = vec3();
    dampedFollowOffset(offset, vec3(0, 2, 7), vec3(0, 0, 0), 0.1, 1, out);
    expect(out[2]).toBeGreaterThan(6);
  });
});
