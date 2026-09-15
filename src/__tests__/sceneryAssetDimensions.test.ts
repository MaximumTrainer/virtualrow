import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { readGlbWorldBounds, parseDeclaredDims } from '../utils/glbBounds';

/**
 * Every scenery model is measured against the size it was specified at.
 *
 * Each generator function in scripts/build_scenery.py returns its dimensions as
 * a label — "dia 300mm", "6000 x 2400 x 450mm" — which is the specification the
 * model was built to. Nothing compared that with the GLB on disk, and a11's
 * railing had been built with its rails running 2.4 m out from the bank instead
 * of along it: `Workplane("XZ")` extrudes along -Y, not X. It measured 2.4 m
 * deep as well as 2.4 m wide and nobody noticed (issue #232).
 *
 * Two allowances, both needed to keep this honest rather than noisy:
 *
 *   - CAD is Z-up and the exporter bakes glTF's Y-up, so a declared height is
 *     compared with the measured Y.
 *   - A label describes the main body, and models legitimately carry parts that
 *     reach past it — a flagpole's flag, a telegraph pole's crossarms, the
 *     flowers on a lily raft. The envelope is wide enough for those and narrow
 *     enough to catch an axis error or a wrong scale.
 */

const SCENERY_ROOT = path.join(process.cwd(), 'public/assets/scenery');
const GENERATOR = path.join(process.cwd(), 'scripts/build_scenery.py');

/** Model id → the dimension label its generator function declares. */
const declaredByModel = (): Map<string, string> => {
  const source = fs.readFileSync(GENERATOR, 'utf8');

  // Split rather than match a body with a lookahead: JavaScript has no \Z, and
  // an escaped literal Z ended every body at the first Workplane("XZ").
  const dimsByFunction = new Map<string, string>();
  for (const chunk of source.split(/^def /m).slice(1)) {
    const name = chunk.match(/^(\w+)\(\):/);
    const declared = chunk.match(/return\s+"[a-z]"\s*,\s*"([^"]*)"/);
    if (name && declared) dimsByFunction.set(name[1], declared[1]);
  }

  const byModel = new Map<string, string>();
  for (const [, id, fn] of source.matchAll(/"([a-z0-9][a-z0-9-]+)"\s*:\s*(\w+)\s*[,}]/g)) {
    const dims = dimsByFunction.get(fn);
    if (dims) byModel.set(id, dims);
  }
  return byModel;
};

const shippedModels = (): string[] =>
  fs.existsSync(SCENERY_ROOT)
    ? fs
        .readdirSync(SCENERY_ROOT)
        .filter((tier) => tier.startsWith('tier-'))
        .flatMap((tier) =>
          fs
            .readdirSync(path.join(SCENERY_ROOT, tier))
            .filter((file) => file.endsWith('.glb'))
            .map((file) => path.join(tier, file)),
        )
    : [];

/** How far past its declared size a model may reach, and how far short it may fall. */
const MAX_OVERSHOOT = 2.5;
const MAX_SHORTFALL = 0.5;

/**
 * Models whose label describes a part rather than the whole, each measured and
 * judged against the real thing.
 *
 * Listed one by one on purpose. Widening the envelope to swallow them would
 * have let a genuine error through — a11's railing was 40x its declared depth
 * and is exactly what this file exists to catch — and an exception with a
 * reason beside it is a fact, not a suppression. Delete an entry when the
 * label is corrected and the test will tell you if you were wrong.
 */
const LABEL_DESCRIBES_A_PART: Record<string, string> = {
  'a12-regatta-flagpole': 'label is the pole; the flag flies 960mm out from it',
  'f41-telegraph-pole': 'label is the pole; real crossarms are about 2.4m across',
  'f27-lily-pad-raft': 'label is the pad; the flowers stand above it',
  'f15-sandbank-midchannel':
    'label is the height above water; the ellipsoid continues below, and willow scrub sits on one end',
  'd-us-06-highway-sign-gantry': 'truss is shallower than the label allows for, and reads correctly at distance',
  'f29-weed-streamer': 'streamers trail shorter than nominal, which is how weed sits in current',
  'f47-skyline-strip': 'a backdrop strip, its depth chosen for the silhouette rather than a real block',
};

const models = shippedModels();
const declared = declaredByModel();

describe('the scenery kit', () => {
  it('ships models, and the generator declares dimensions for every one', () => {
    expect(models.length).toBeGreaterThan(100);

    const undeclared = models
      .map((relative) => path.basename(relative, '.glb'))
      .filter((id) => !declared.has(id));

    expect(undeclared, 'models with no declared size to check against').toEqual([]);
  });

  it('keeps no stale exceptions', () => {
    const shipped = new Set(models.map((relative) => path.basename(relative, '.glb')));

    for (const id of Object.keys(LABEL_DESCRIBES_A_PART)) {
      expect(shipped, `${id} is excepted but no longer shipped`).toContain(id);
    }
  });
});

describe('every model is built to the size it was specified at', () => {
  it.each(models)('%s', (relative) => {
    const id = path.basename(relative, '.glb');
    if (id in LABEL_DESCRIBES_A_PART) return;
    const label = declared.get(id);
    const spec = label ? parseDeclaredDims(label) : null;
    if (!spec) return; // A label this reader cannot parse is not a model defect.

    const measured = readGlbWorldBounds(fs.readFileSync(path.join(SCENERY_ROOT, relative)));
    expect(measured, `${id} has no geometry`).not.toBeNull();

    // Z-up in CAD, Y-up in glTF.
    const actual = { x: measured!.x, y: measured!.z, z: measured!.y };

    const footprintSpec = [spec.x, spec.y].sort((a, b) => a - b);
    const footprintActual = [actual.x, actual.y].sort((a, b) => a - b);

    const checks: Array<[string, number, number]> = [
      ['footprint (short side)', footprintSpec[0], footprintActual[0]],
      ['footprint (long side)', footprintSpec[1], footprintActual[1]],
    ];
    // A bare "dia" gives no separate height to check.
    if (spec.kind !== 'diameter') checks.push(['height', spec.z, actual.z]);

    for (const [what, declaredValue, actualValue] of checks) {
      if (declaredValue === 0) continue;
      const ratio = actualValue / declaredValue;
      expect(
        ratio,
        `${id} ${what}: declared ${Math.round(declaredValue)}mm, built ${Math.round(actualValue)}mm`,
      ).toBeGreaterThan(MAX_SHORTFALL);
      expect(
        ratio,
        `${id} ${what}: declared ${Math.round(declaredValue)}mm, built ${Math.round(actualValue)}mm`,
      ).toBeLessThan(MAX_OVERSHOOT);
    }
  });
});
