import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  REGIONAL_MODELS,
  resolveSceneryModels,
  collectSceneryPaths,
} from '../components/rower3d/sceneryAssets';
import type { SceneryRegion } from '../components/rower3d/sceneryRegion';

const ALL_REGIONS: SceneryRegion[] = ['gb', 'ce', 'it', 'nl', 'us'];

describe('REGIONAL_MODELS', () => {
  it('has a kit for every region the resolver can return', () => {
    expect(Object.keys(REGIONAL_MODELS).sort()).toEqual([...ALL_REGIONS].sort());
  });

  it('only names Tier D models', () => {
    const ids = ALL_REGIONS.flatMap((r) => [
      ...REGIONAL_MODELS[r].builtUp,
      ...REGIONAL_MODELS[r].rural,
      ...REGIONAL_MODELS[r].bankEdge,
    ]);

    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(id).toMatch(/^d-(gb|ce|it|nl|us)-\d{2}-/);
  });

  it('names models that exist on disk', () => {
    const missing = ALL_REGIONS
      .flatMap((r) => [...REGIONAL_MODELS[r].builtUp, ...REGIONAL_MODELS[r].rural, ...REGIONAL_MODELS[r].bankEdge])
      .filter((id) => !fs.existsSync(path.join(process.cwd(), 'public/assets/scenery/tier-d', `${id}.glb`)));

    expect(missing).toEqual([]);
  });
});

describe('resolveSceneryModels with a region', () => {
  it('dresses a built-up bank in that region’s buildings', () => {
    const gb = resolveSceneryModels('residential', 'river', [], 'gb');

    expect(gb.buildings).toContain('d-gb-01-terrace-brick');
    expect(gb.buildings).toContain('d-gb-03-riverside-pub');
  });

  it('uses the rural kit on farmland, not the town one', () => {
    const nl = resolveSceneryModels('farmland', 'canal', [], 'nl');

    expect(nl.buildings).toContain('d-nl-02-polder-windmill');
    expect(nl.buildings).not.toContain('d-nl-01-gabled-canal-house');
  });

  it('leaves wild stretches unbuilt', () => {
    expect(resolveSceneryModels('forest', 'river', [], 'gb').buildings).toEqual([]);
    expect(resolveSceneryModels('wetland', 'river', [], 'nl').buildings).toEqual([]);
  });

  it('adds a regional bank edge where the kit has one', () => {
    expect(resolveSceneryModels('wetland', 'canal', [], 'nl').bankEdge).toContain(
      'd-nl-06-reed-bank-edge',
    );
  });

  it('falls back to the generic kit when the region is unknown', () => {
    const generic = resolveSceneryModels('residential', 'river', []);

    expect(generic.buildings).toEqual([]);
    expect(generic.bankEdge.every((id) => !id.startsWith('d-'))).toBe(true);
  });

  it('includes regional buildings in the paths to preload', () => {
    const paths = collectSceneryPaths(resolveSceneryModels('residential', 'river', [], 'it'));

    expect(paths).toContain('/assets/scenery/tier-d/d-it-01-po-palazzo.glb');
  });
});
