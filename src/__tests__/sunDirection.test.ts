import { describe, it, expect } from 'vitest';
import {
  sunDirection,
  followerLightPosition,
  shadowFrustumCoversBoat,
  skySunPosition,
  SHADOW_HALF_EXTENT_M,
  SUN_LIGHT_DISTANCE_M,
} from '../components/rower3d/sunDirection';
import { SCENE_CONFIG } from '../components/rower3d/themeConfig';
import { CONDITIONS, applyConditions, sunPositionFrom } from '../components/rower3d/conditions';

/**
 * Issue #352 — one sun, and a shadow that goes with the boat.
 *
 * The directional light sat at a fixed position with a ±60 m shadow camera
 * around the origin and no `target`, so it pointed at the origin whatever the
 * boat did. A boat rows away from the origin: past about 60 m everything left
 * the frustum and the row finished with no shadows at all. Nothing caught it
 * because every published screenshot is taken in the first few seconds, while
 * the boat is still standing on the start.
 */

const lightingAt = (sunElevation: number, sunAzimuth: number) => ({
  ...SCENE_CONFIG.lighting,
  sunElevation,
  sunAzimuth,
});

describe('the sun’s direction', () => {
  it('points straight up at noon overhead', () => {
    const [x, y, z] = sunDirection(lightingAt(90, 0));

    expect(x).toBeCloseTo(0, 6);
    expect(y).toBeCloseTo(1, 6);
    expect(z).toBeCloseTo(0, 6);
  });

  // Azimuth is degrees clockwise from north, and the scene's north is +Z.
  it('points north on the horizon at an azimuth of nothing', () => {
    const [x, y, z] = sunDirection(lightingAt(0, 0));

    expect(x).toBeCloseTo(0, 6);
    expect(y).toBeCloseTo(0, 6);
    expect(z).toBeCloseTo(1, 6);
  });

  it('points east at an azimuth of ninety', () => {
    const [x, , z] = sunDirection(lightingAt(0, 90));

    expect(x).toBeCloseTo(1, 6);
    expect(z).toBeCloseTo(0, 6);
  });

  // A direction, not a position: everything downstream scales it itself.
  it('is a unit vector at every elevation and azimuth', () => {
    for (let elevation = 0; elevation <= 90; elevation += 15) {
      for (let azimuth = 0; azimuth < 360; azimuth += 45) {
        const length = Math.hypot(...sunDirection(lightingAt(elevation, azimuth)));
        expect(length, `${elevation}/${azimuth}`).toBeCloseTo(1, 6);
      }
    }
  });

  /**
   * The sun in the sky and the sun that lights the scene are the same sun.
   *
   * They were two authored fields that disagreed until #346 derived both from
   * the same pair of angles. This holds that line: for every preset, the sky's
   * disc and the light's direction are parallel, so a shadow points away from
   * the bright spot rather than off at its own angle.
   */
  it('is parallel to where the sky draws its sun, under every preset', () => {
    for (const condition of CONDITIONS) {
      const config = applyConditions(SCENE_CONFIG, condition);
      const direction = sunDirection(config.lighting);
      const sky = skySunPosition(config.lighting);
      const skyLength = Math.hypot(...sky);

      sky.forEach((value: number, axis: number) => {
        expect(value / skyLength, `${condition} axis ${axis}`).toBeCloseTo(direction[axis], 5);
      });
    }
  });

  it('is the same math the sky position is built from', () => {
    const direction = sunDirection(lightingAt(37, 212));
    const position = sunPositionFrom(37, 212, 1);

    position.forEach((value, axis) => expect(value).toBeCloseTo(direction[axis], 9));
  });
});

describe('the light that follows the boat', () => {
  it('sits up-sun of wherever the boat is', () => {
    const direction = sunDirection(lightingAt(90, 0));

    const position = followerLightPosition([100, 0, -250], direction);

    expect(position[0]).toBeCloseTo(100, 6);
    expect(position[1]).toBeCloseTo(SUN_LIGHT_DISTANCE_M, 6);
    expect(position[2]).toBeCloseTo(-250, 6);
  });

  it('keeps the same distance from the boat however far it has rowed', () => {
    const direction = sunDirection(lightingAt(35, 200));

    for (const boat of [[0, 0, 0], [500, 0, -2_000], [-3_000, 0, 4_000]] as const) {
      const position = followerLightPosition([...boat], direction);
      const away = Math.hypot(
        position[0] - boat[0],
        position[1] - boat[1],
        position[2] - boat[2],
      );
      expect(away).toBeCloseTo(SUN_LIGHT_DISTANCE_M, 5);
    }
  });
});

/**
 * The frustum test the Playwright spec publishes.
 *
 * Trivially true once the light is a follower — which is the point. It failed
 * for every boat past 60 m from the origin before this issue, and it is the
 * assertion that says so.
 */
describe('whether the boat is inside the shadow camera', () => {
  it('covers a boat the light is targeting', () => {
    expect(shadowFrustumCoversBoat([0, 0, 0], [0, 0, 0])).toBe(true);
  });

  it('covers a boat within half an extent of the target', () => {
    expect(shadowFrustumCoversBoat([SHADOW_HALF_EXTENT_M - 1, 0, 0], [0, 0, 0])).toBe(true);
  });

  // The old rig: light fixed on the origin, boat a kilometre down the course.
  it('does not cover a boat the light left behind', () => {
    expect(shadowFrustumCoversBoat([0, 0, -1_000], [0, 0, 0])).toBe(false);
  });

  it('measures across the ground, not through the air', () => {
    // Directly above the target by more than an extent is still covered: the
    // shadow camera is orthographic and its depth range is the `far` plane.
    expect(shadowFrustumCoversBoat([0, SHADOW_HALF_EXTENT_M + 50, 0], [0, 0, 0])).toBe(true);
  });

  it('is the extent the shadow camera is actually built with', () => {
    expect(SHADOW_HALF_EXTENT_M).toBeGreaterThan(0);
    // Tighter than the ±60 it replaces: texels spent where the camera looks.
    expect(SHADOW_HALF_EXTENT_M).toBeLessThan(60);
  });
});
