import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * The deploy builds with `--base=/virtualrow/app/`. These tests pin that base
 * deliberately: under the default `/` the broken form and the correct form are
 * identical, which is the whole reason a production-wide 404 went unnoticed
 * (issue #251).
 */
const DEPLOY_BASE = '/virtualrow/app/';

describe('crew models under the deploy base', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('asks for the crewed sculls where the deploy actually publishes them', async () => {
    // CREW_URL is built at module load, so the module has to be re-imported
    // with the base in place.
    vi.stubEnv('BASE_URL', DEPLOY_BASE);
    vi.resetModules();
    const { CREW_URL, crewModelUrl } = await import('../components/rower3d/crewModel');

    expect(CREW_URL.male).toBe('/virtualrow/app/assets/boat/scull-male.glb');
    expect(CREW_URL.female).toBe('/virtualrow/app/assets/boat/scull-female.glb');
    expect(crewModelUrl('female')).toBe('/virtualrow/app/assets/boat/scull-female.glb');
  });

  it('is unchanged on a root deployment', async () => {
    vi.stubEnv('BASE_URL', '/');
    vi.resetModules();
    const { CREW_URL } = await import('../components/rower3d/crewModel');

    expect(CREW_URL.male).toBe('/assets/boat/scull-male.glb');
  });
});

describe('scenery models under the deploy base', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('prefixes every scenery path with the base', async () => {
    vi.stubEnv('BASE_URL', DEPLOY_BASE);
    vi.resetModules();
    const { sceneryAssetPath } = await import('../components/rower3d/sceneryAssets');

    expect(sceneryAssetPath('e04-english-oak')).toBe(
      '/virtualrow/app/assets/scenery/tier-e/e04-english-oak.glb',
    );
  });
});

describe('every asset URL the app can build is a file that ships', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('resolves each scenery and crew URL to a file in public/', async () => {
    vi.stubEnv('BASE_URL', DEPLOY_BASE);
    vi.resetModules();
    const assets = await import('../components/rower3d/sceneryAssets');
    const { CREW_URL } = await import('../components/rower3d/crewModel');

    // Every id the tables can yield, from the tables themselves — so a model
    // added to a kit is covered without touching this test.
    const ids = new Set<string>();
    for (const set of Object.values(assets.SCENERY_PROFILE_MODELS)) {
      Object.values(set).flat().forEach((id) => ids.add(id as string));
    }
    for (const set of Object.values(assets.WATER_BODY_MODELS)) {
      Object.values(set).flat().forEach((id) => ids.add(id as string));
    }
    for (const list of Object.values(assets.TREE_SPECIES_MODELS)) {
      list.forEach((id) => ids.add(id));
    }
    assets.UNIVERSAL_FURNITURE.forEach((id) => ids.add(id));
    for (const set of Object.values(assets.REGIONAL_MODELS)) {
      Object.values(set).flat().forEach((id) => ids.add(id as string));
    }

    // One-off structures are constructible URLs too, and are not in any kit.
    const structures = await import('../components/rower3d/sceneryStructures');
    [...structures.COURSE_FURNITURE.start, ...structures.COURSE_FURNITURE.finish].forEach((id) =>
      ids.add(id),
    );
    structures.LIVERIED_LANDMARKS.forEach((l) => ids.add(l.id));

    const urls = [
      ...[...ids].map((id) => assets.sceneryAssetPath(id)),
      ...Object.values(CREW_URL),
    ];
    // A floor, not a fixture: it only has to fail if the tables stop yielding
    // a realistic kit, not track the exact count.
    expect(urls.length).toBeGreaterThan(70);

    // Strip the deploy base back off to get the path within public/.
    const missing = urls.filter((url) => {
      const rel = url.replace(DEPLOY_BASE, '');
      return !fs.existsSync(path.join(process.cwd(), 'public', rel));
    });

    expect(missing).toEqual([]);
  });
});
