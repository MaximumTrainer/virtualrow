import { describe, it, expect } from 'vitest';
import {
  CONDITIONS,
  conditionsForHour,
  applyConditions,
  sunPositionFrom,
  conditionsLabel,
  type Conditions,
} from '../components/rower3d/conditions';
import { SCENE_CONFIG } from '../components/rower3d/themeConfig';

/**
 * Issue #346 — the same route, at a different time of day.
 *
 * Sun position, turbidity, cloud cover and fog were fixed, so every row on a
 * route looked identical to the last one. A preset is a set of overrides on
 * `SCENE_CONFIG`, applied per row rather than per route: pure, so the scene
 * only has to read the result.
 */

describe('the hour of the day', () => {
  it('is dawn early on', () => {
    expect(conditionsForHour(5)).toBe('dawn');
    expect(conditionsForHour(6)).toBe('dawn');
  });

  it('is the middle of the day through the middle of the day', () => {
    expect(conditionsForHour(7)).toBe('midday');
    expect(conditionsForHour(12)).toBe('midday');
    expect(conditionsForHour(15)).toBe('midday');
  });

  it('is golden hour as the afternoon goes', () => {
    expect(conditionsForHour(16)).toBe('golden');
    expect(conditionsForHour(18)).toBe('golden');
  });

  it('is dusk in the evening', () => {
    expect(conditionsForHour(19)).toBe('dusk');
    expect(conditionsForHour(23)).toBe('dusk');
  });

  // Rowers row at 05:30, and an hour of 0 is midnight rather than a missing
  // value: it has to land somewhere sensible rather than on the default.
  it('puts the small hours with the dawn rather than nowhere', () => {
    expect(conditionsForHour(0)).toBe('dawn');
    expect(conditionsForHour(3)).toBe('dawn');
  });
});

describe('the sun’s place in the sky', () => {
  /**
   * One sun, not two.
   *
   * `sky.sunPosition` and `lighting.sunElevation/sunAzimuth` were separate
   * fields, and they disagreed: the sky drew its sun at [90, 55, 35] while the
   * light shone from 45° elevation at 135°. Shadows fell one way and the glare
   * came from another. Both are derived from the same pair now.
   */
  it('is derived from one elevation and one azimuth', () => {
    const [x, y, z] = sunPositionFrom(45, 135, 200);

    expect(y).toBeCloseTo(Math.sin(Math.PI / 4) * 200, 5);
    expect(Math.hypot(x, y, z)).toBeCloseTo(200, 5);
  });

  it('puts a high sun overhead and a low one near the horizon', () => {
    const high = sunPositionFrom(80, 135, 200);
    const low = sunPositionFrom(5, 135, 200);

    expect(high[1]).toBeGreaterThan(low[1]);
  });

  it('agrees with the scene’s own lighting, whatever the preset', () => {
    for (const condition of CONDITIONS) {
      const scene = applyConditions(SCENE_CONFIG, condition);
      const derived = sunPositionFrom(
        scene.lighting.sunElevation,
        scene.lighting.sunAzimuth,
        Math.hypot(...scene.sky.sunPosition),
      );

      scene.sky.sunPosition.forEach((value, axis) => {
        expect(value, `${condition} axis ${axis}`).toBeCloseTo(derived[axis], 4);
      });
    }
  });
});

describe('applying a preset', () => {
  it('leaves the config it was given untouched', () => {
    const before = JSON.stringify(SCENE_CONFIG);

    applyConditions(SCENE_CONFIG, 'dusk');

    expect(JSON.stringify(SCENE_CONFIG)).toBe(before);
  });

  it('puts the sun low at dawn and high at midday', () => {
    const dawn = applyConditions(SCENE_CONFIG, 'dawn');
    const midday = applyConditions(SCENE_CONFIG, 'midday');

    expect(dawn.lighting.sunElevation).toBeLessThan(midday.lighting.sunElevation);
  });

  // Overcast is the one that changes the weather rather than the hour: a
  // flatter, dimmer, closer world.
  it('dims the sun and closes the fog in when it is overcast', () => {
    const overcast = applyConditions(SCENE_CONFIG, 'overcast');

    expect(overcast.lighting.sunIntensity).toBeLessThan(SCENE_CONFIG.lighting.sunIntensity);
    expect(overcast.atmosphere.fogFar).toBeLessThan(SCENE_CONFIG.atmosphere.fogFar);
    expect(overcast.clouds.count).toBeGreaterThan(SCENE_CONFIG.clouds.count);
    expect(overcast.clouds.opacity).toBeGreaterThan(SCENE_CONFIG.clouds.opacity);
  });

  it('warms the light at dawn, golden hour and dusk', () => {
    for (const condition of ['dawn', 'golden', 'dusk'] as Conditions[]) {
      const scene = applyConditions(SCENE_CONFIG, condition);
      const [r, , b] = [1, 3, 5].map((i) => parseInt(scene.lighting.sunColor.slice(i, i + 2), 16));

      expect(r, `${condition} is not a warm light`).toBeGreaterThan(b);
    }
  });

  it('keeps the fog near the camera nearer than the fog far from it', () => {
    for (const condition of CONDITIONS) {
      const scene = applyConditions(SCENE_CONFIG, condition);

      expect(scene.atmosphere.fogNear, condition).toBeLessThan(scene.atmosphere.fogFar);
    }
  });

  /**
   * Every preset has to hand back a config the scene can read, which is what
   * `themeConfig.test.ts` asserts about `SCENE_CONFIG` itself. A preset that
   * put the sun at 95° or gave a negative intensity would render, and look
   * wrong, and say nothing.
   */
  it('hands back a config that still satisfies the scene’s invariants', () => {
    for (const condition of CONDITIONS) {
      const scene = applyConditions(SCENE_CONFIG, condition);
      const { lighting, clouds, sky, atmosphere } = scene;

      expect(lighting.sunElevation, condition).toBeGreaterThanOrEqual(0);
      expect(lighting.sunElevation, condition).toBeLessThanOrEqual(90);
      expect(lighting.sunAzimuth, condition).toBeGreaterThanOrEqual(0);
      expect(lighting.sunAzimuth, condition).toBeLessThan(360);
      expect(lighting.sunIntensity, condition).toBeGreaterThanOrEqual(0);
      expect(lighting.ambientIntensity, condition).toBeGreaterThanOrEqual(0);
      expect(clouds.opacity, condition).toBeGreaterThanOrEqual(0);
      expect(clouds.opacity, condition).toBeLessThanOrEqual(1);
      expect(clouds.count, condition).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(clouds.count), `${condition} has a fraction of a cloud`).toBe(true);
      expect(sky.turbidity, condition).toBeGreaterThan(0);
      expect(atmosphere.fogNear, condition).toBeGreaterThanOrEqual(0);
    }
  });

  it('changes something for every preset it offers', () => {
    const rendered = CONDITIONS.map((condition) =>
      JSON.stringify(applyConditions(SCENE_CONFIG, condition)),
    );

    expect(new Set(rendered).size, 'two presets render the same scene').toBe(CONDITIONS.length);
  });
});

describe('naming the presets', () => {
  it('names every one of them in words a rower would use', () => {
    for (const condition of CONDITIONS) {
      expect(conditionsLabel(condition), condition).toMatch(/[a-z]/i);
    }
  });

  it('calls golden hour what everybody calls it', () => {
    expect(conditionsLabel('golden')).toMatch(/golden/i);
  });
});
