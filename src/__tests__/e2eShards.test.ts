import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  unitsFromListing,
  planShards,
  shardArguments,
  DEFAULT_UNIT_SECONDS,
} from '../../scripts/e2e-shards.mjs';

/**
 * The E2E suite is split across CI runners by measured time, not by test
 * count.
 *
 * Playwright's `--shard` slices the suite into runs of equal test *count*, in
 * file order. A one-test spec that rows a boat for seven minutes counts the
 * same as a 200 ms layout check, and the heavy 3D specs sort next to each
 * other (`route-performance*`, `rower-*`, `rower3d-*`), so they landed in one
 * shard together: 1,994 s of tests on Windows shard 3 against an 18 minute
 * step limit, while shard 12 ran 59 s.
 */

const unit = (project: string, file: string) => ({ project, file });

describe('unitsFromListing', () => {
  it('turns a Playwright JSON listing into one unit per project and file', () => {
    const listing = {
      suites: [
        {
          file: 'rower-slide.spec.ts',
          specs: [{ tests: [{ projectName: 'default' }] }],
          suites: [],
        },
        {
          file: 'responsive.spec.ts',
          specs: [],
          suites: [
            {
              specs: [
                { tests: [{ projectName: 'desktop' }, { projectName: 'uhd' }] },
                { tests: [{ projectName: 'desktop' }] },
              ],
              suites: [],
            },
          ],
        },
      ],
    };

    expect(unitsFromListing(listing)).toEqual([
      unit('default', 'rower-slide.spec.ts'),
      unit('desktop', 'responsive.spec.ts'),
      unit('uhd', 'responsive.spec.ts'),
    ]);
  });
});

describe('planShards', () => {
  const weights = {
    'default:slow-a.spec.ts': 400,
    'default:slow-b.spec.ts': 390,
    'default:slow-c.spec.ts': 380,
    'default:quick.spec.ts': 10,
  };
  const units = [
    unit('default', 'quick.spec.ts'),
    unit('default', 'slow-a.spec.ts'),
    unit('default', 'slow-b.spec.ts'),
    unit('default', 'slow-c.spec.ts'),
  ];

  it('never puts the heavy files together when there is room to separate them', () => {
    const shards = planShards(units, weights, 3);
    const heavyPerShard = shards.map((s) => s.units.filter((u) => u.file.startsWith('slow')).length);
    expect(heavyPerShard).toEqual([1, 1, 1]);
  });

  it('runs every unit exactly once', () => {
    const shards = planShards(units, weights, 3);
    const placed = shards.flatMap((s) => s.units.map((u) => `${u.project}:${u.file}`)).sort();
    expect(placed).toEqual(units.map((u) => `${u.project}:${u.file}`).sort());
  });

  it('gives the same plan whatever order the listing came in', () => {
    const forwards = planShards(units, weights, 3);
    const backwards = planShards([...units].reverse(), weights, 3);
    expect(backwards).toEqual(forwards);
  });

  it('weighs a spec it has no measurement for at the default, rather than as free', () => {
    const shards = planShards([unit('default', 'brand-new.spec.ts')], {}, 2);
    expect(shards[0].seconds).toBe(DEFAULT_UNIT_SECONDS);
  });

  it('leaves a shard empty rather than inventing work when there are more shards than units', () => {
    const shards = planShards([unit('default', 'quick.spec.ts')], weights, 3);
    expect(shards.filter((s) => s.units.length === 0)).toHaveLength(2);
  });

  it('keeps the worst shard close to the ideal on the measured suite', () => {
    // The committed weights are Windows first-attempt seconds from main.
    const measured = JSON.parse(readFileSync('playwright/shard-weights.json', 'utf8')) as {
      seconds: Record<string, number>;
    };
    const measuredUnits = Object.keys(measured.seconds).map((key) => {
      const [project, file] = key.split(':');
      return unit(project, file);
    });
    const shards = planShards(measuredUnits, measured.seconds, 12);
    const total = Object.values(measured.seconds).reduce((a, b) => a + b, 0);
    const largestUnit = Math.max(...Object.values(measured.seconds));
    const worst = Math.max(...shards.map((s) => s.seconds));

    // No split can beat the larger of an even share and the biggest single
    // unit; greedy packing lands within a small margin of that.
    const floor = Math.max(total / 12, largestUnit);
    expect(worst).toBeLessThanOrEqual(floor * 1.15);
  });
});

describe('shardArguments', () => {
  it('names each file by an anchored pattern, so one spec never selects another', () => {
    // `route-performance.spec.ts` is a substring of
    // `default-route-performance.spec.ts`; a bare name would run both.
    const args = shardArguments({
      units: [unit('default', 'route-performance.spec.ts')],
      seconds: 0,
    });
    const pattern = args.find((a) => a.startsWith('/'))!;
    const re = new RegExp(pattern.slice(1, -1));
    expect(re.test('/repo/playwright/tests/route-performance.spec.ts')).toBe(true);
    expect(re.test('C:\\repo\\playwright\\tests\\route-performance.spec.ts')).toBe(true);
    expect(re.test('/repo/playwright/tests/default-route-performance.spec.ts')).toBe(false);
  });

  it('selects each project once, and only the projects the shard runs', () => {
    const args = shardArguments({
      units: [
        unit('default', 'a.spec.ts'),
        unit('desktop', 'responsive.spec.ts'),
        unit('default', 'b.spec.ts'),
      ],
      seconds: 0,
    });
    expect(args.filter((a) => a.startsWith('--project='))).toEqual([
      '--project=default',
      '--project=desktop',
    ]);
  });

  it('escapes the dots in a file name', () => {
    const [pattern] = shardArguments({ units: [unit('default', 'a.spec.ts')], seconds: 0 }).filter(
      (a) => a.startsWith('/'),
    );
    expect(new RegExp(pattern.slice(1, -1)).test('/x/aXspecXts')).toBe(false);
  });
});
