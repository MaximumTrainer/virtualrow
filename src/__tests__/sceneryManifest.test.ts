import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  SCENERY_PROFILE_MODELS,
  WATER_BODY_MODELS,
  TREE_SPECIES_MODELS,
  UNIVERSAL_FURNITURE,
  REGIONAL_MODELS,
} from '../components/rower3d/sceneryAssets';
import { COURSE_FURNITURE, LIVERIED_LANDMARKS } from '../components/rower3d/sceneryStructures';

/**
 * Issue #332 — what the scenery kit costs to download.
 *
 * The kit was 130 uncompressed GLBs fetched one by one, and nothing in the app
 * or in CI knew what any of them weighed. The manifest is generated from the
 * files on disk by `scripts/generate-scenery-manifest.mjs`; these are the
 * budgets it is held to, so a model that doubles in size fails here rather
 * than on a rower's phone.
 */

interface Manifest {
  totalBytes: number;
  models: Record<string, { path: string; bytes: number; triangles: number; compressed: boolean }>;
}

const ROOT = path.resolve(__dirname, '..', '..');
const manifest: Manifest = JSON.parse(
  fs.readFileSync(path.join(ROOT, 'public/assets/scenery/manifest.json'), 'utf8'),
);

const KB = 1024;
const MB = 1024 * KB;

/** Every id the selection matrix can ask for, from every entry point. */
const referencedIds = (): string[] => {
  const ids = new Set<string>();
  const add = (list: string[] | undefined) => list?.forEach((id) => ids.add(id));

  for (const set of Object.values(SCENERY_PROFILE_MODELS)) {
    add(set.bankEdge);
    add(set.landform);
    add(set.scatter);
    add(set.backdrop);
  }
  for (const set of Object.values(WATER_BODY_MODELS)) {
    Object.values(set).forEach((value) => add(value as string[]));
  }
  for (const set of Object.values(REGIONAL_MODELS)) {
    Object.values(set).forEach((value) => add(value as string[]));
  }
  Object.values(TREE_SPECIES_MODELS).forEach(add);
  add(UNIVERSAL_FURNITURE);
  add(COURSE_FURNITURE.start);
  add(COURSE_FURNITURE.finish);
  add(LIVERIED_LANDMARKS.map((landmark) => landmark.id));

  return Array.from(ids);
};

describe('the scenery manifest', () => {
  // A model the matrix names but the kit does not ship is a 404 mid-row, and
  // the selection matrix is data - nothing type-checks it against the disk.
  it('lists every model the scene can ask for', () => {
    const missing = referencedIds().filter((id) => !(id in manifest.models));

    expect(missing, `not in the manifest: ${missing.join(', ')}`).toEqual([]);
  });

  it('describes files that are actually on disk, at the size it claims', () => {
    for (const [id, model] of Object.entries(manifest.models)) {
      const file = path.join(ROOT, 'public', model.path);
      expect(fs.existsSync(file), `${id} is in the manifest but not on disk`).toBe(true);
      expect(fs.statSync(file).size, `${id} has changed since the manifest was written`).toBe(
        model.bytes,
      );
    }
  });

  it('ships every model compressed', () => {
    const raw = Object.entries(manifest.models)
      .filter(([, model]) => !model.compressed)
      .map(([id]) => id);

    expect(raw, `uncompressed: ${raw.join(', ')}`).toEqual([]);
  });
});

describe('the scenery kit’s byte budget', () => {
  const sculls = Object.entries(manifest.models).filter(([id]) => id.startsWith('scull'));
  const scenery = Object.entries(manifest.models).filter(([id]) => !id.startsWith('scull'));

  it('keeps the whole kit under 14 MB', () => {
    expect(manifest.totalBytes).toBeLessThanOrEqual(14 * MB);
  });

  it('keeps any one scenery model under 400 kB', () => {
    const heavy = scenery.filter(([, model]) => model.bytes > 400 * KB).map(([id]) => id);

    expect(heavy, `over 400 kB: ${heavy.join(', ')}`).toEqual([]);
  });

  it('keeps the crewed scull under 700 kB', () => {
    for (const [id, model] of sculls) {
      expect(model.bytes, `${id} is over the scull budget`).toBeLessThanOrEqual(700 * KB);
    }
  });

  /**
   * The ratchet, as the coverage thresholds are ratcheted.
   *
   * The budgets above are the issue's, and the kit came in at 6.12 MB against
   * a 14 MB ceiling - which would not notice the kit doubling. This is the
   * measurement with headroom, so the gate answers "did this regress" rather
   * than "is it still within the number somebody wrote down in 2026".
   */
  it('has not drifted back up from what it measured', () => {
    expect(manifest.totalBytes).toBeLessThanOrEqual(7 * MB);
  });
});

/**
 * Vite copies `public/` into `dist/` verbatim, so anything left in there is
 * shipped - and `build_scenery.py` wrote its multi-view renders beside the
 * models it rendered. That was 133 PNGs and 39 MB of CAD provenance served to
 * every browser that loads one 90 kB tree, referenced by nothing in the app,
 * the specs or the docs. #232 moved the STEP files out for the same reason;
 * this keeps both of them out.
 */
describe('what the served tree carries', () => {
  const SERVED = path.join(ROOT, 'public/assets/scenery');

  const servedFiles = (): string[] =>
    fs
      .readdirSync(SERVED, { recursive: true })
      .map((entry) => entry.toString().split(path.sep).join('/'))
      .filter((entry) => fs.statSync(path.join(SERVED, entry)).isFile());

  it('ships models and a manifest, not the pictures they were checked against', () => {
    const provenance = servedFiles().filter((file) => /[.](png|jpe?g|step|stp|blend)$/i.test(file));

    expect(provenance, `provenance in the served tree: ${provenance.join(', ')}`).toEqual([]);
  });

  it('is the kit and nothing else', () => {
    const strays = servedFiles().filter((file) => !/[.](glb|json|md)$/i.test(file));

    expect(strays, `unexpected in the served tree: ${strays.join(', ')}`).toEqual([]);
  });
});
