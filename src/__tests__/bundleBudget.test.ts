// @vitest-environment node
// esbuild's invariant check rejects jsdom's TextEncoder (not a Uint8Array); we
// only touch the file system and gzip here, so Node is the right environment.
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { gzipSync } from 'zlib';
import { transformSync } from 'esbuild';

/**
 * What a rower actually downloads to row (#322).
 *
 * The scene chunk carried `@react-three/rapier` — a physics engine wrapping the
 * scull in a rigid body that had no colliders, that nothing ever collided with,
 * and whose translation was copied from a ref every frame and read straight
 * back out. Measured on the merge of #361: removing it took the chunk from
 * 3,444.87 kB to 1,181.79 kB raw, and from 1,162.77 kB to 323.05 kB gzipped.
 * Two and a quarter megabytes, to move nothing.
 *
 * Nothing was watching that number, which is how it got there. This watches it.
 *
 * It reads `dist/`, so it runs where a build has happened — CI builds before it
 * runs the unit tests — and says so rather than passing quietly when it has not.
 * A stale `dist/` measures a stale build; CI's is always fresh, and the message
 * names the file so a local surprise is traceable.
 */

const DIST_ASSETS = path.resolve(process.cwd(), 'dist/assets');

/**
 * The ceiling on the scene chunk, gzipped.
 *
 * Measured at 323 kB. Four hundred leaves room for the scene to grow without
 * the gate crying wolf, while still catching an accidental megabyte — which is
 * the only failure it is for.
 */
const SCENE_CHUNK_BUDGET_KB = 400;

/** The built chunks, or nothing when the app has not been built. */
const builtChunks = (): string[] => {
  if (!fs.existsSync(DIST_ASSETS)) return [];
  return fs
    .readdirSync(DIST_ASSETS)
    .filter((name) => name.endsWith('.js'))
    .map((name) => path.join(DIST_ASSETS, name));
};

const chunks = builtChunks();

/**
 * #472 AC9 — the signed-out demo-workout placeholder must not bloat what the
 * guest downloads. The AC gives a budget of 2 kB gzipped against the branch
 * point (no placeholder existed there), so the whole combined weight of the
 * placeholder's three dedicated modules — the template, the service, the
 * auto-seed decider — stays inside 2048 bytes gzipped once minified.
 *
 * Measuring source bytes would include the big JSDoc blocks that explain the
 * Willowbrook distance scaling and the FR5/FR6 branches, which get stripped by
 * the production build. esbuild's own minifier (what Vite's build uses) is in
 * devDependencies anyway, so we run the same transform here, concatenate the
 * minified output, gzip once (what the browser sees after a Vite chunk), and
 * compare against the budget. This runs without `dist/`, so it works on every
 * `npx vitest run`, not only after a build.
 */
const DEMO_WORKOUT_MODULES = [
  'src/lib/data/demoWorkout.ts',
  'src/lib/services/demoWorkoutService.ts',
  'src/lib/ui/demoWorkoutAutoSeed.svelte.ts',
] as const;

/**
 * The ceiling on the signed-out demo-workout placeholder, gzipped. Measured at
 * ~0.8 kB when #472 Phase 2 landed; the budget is 2 kB (AC9), so this leaves
 * room to tune pace targets or rename segments without the gate crying wolf,
 * while catching an accidental megabyte — such as pulling the whole catalogue
 * of structured workouts into the signed-out bundle — which is the only
 * failure it is for.
 */
const DEMO_WORKOUT_BUDGET_BYTES = 2048;

describe('#472 AC9 — what the signed-out demo workout costs to download', () => {
  it('keeps the placeholder modules inside their gzip budget', () => {
    const minified = DEMO_WORKOUT_MODULES.map((file) => {
      const absolute = path.resolve(process.cwd(), file);
      const source = fs.readFileSync(absolute, 'utf8');
      return transformSync(source, { loader: 'ts', minify: true, target: 'es2022' }).code;
    }).join('');

    const gzippedBytes = gzipSync(minified).byteLength;

    expect(
      gzippedBytes,
      `the demo-workout placeholder is ${gzippedBytes} B gzipped, over the ` +
        `${DEMO_WORKOUT_BUDGET_BYTES} B budget (#472 AC9) — something new has been ` +
        `pulled into the signed-out bundle`,
    ).toBeLessThanOrEqual(DEMO_WORKOUT_BUDGET_BYTES);
  });
});

describe.skipIf(chunks.length === 0)('what the scene costs to download', () => {
  it('ships no physics engine', () => {
    const carrying = chunks.filter((file) =>
      fs.readFileSync(file, 'utf8').includes('rapier'),
    );

    expect(
      carrying.map((file) => path.basename(file)),
      'a chunk is carrying Rapier again — it moves nothing and costs 840 kB gzipped (#322)',
    ).toEqual([]);
  });

  it('keeps the scene chunk inside its budget', () => {
    const scene = chunks.find((file) => path.basename(file).startsWith('Rower3D-'));
    expect(scene, 'no Rower3D chunk in dist/assets — did the build change its name?').toBeDefined();

    const gzippedKb = gzipSync(fs.readFileSync(scene!)).byteLength / 1024;

    expect(
      gzippedKb,
      `${path.basename(scene!)} is ${gzippedKb.toFixed(1)} kB gzipped, over the ` +
        `${SCENE_CHUNK_BUDGET_KB} kB budget`,
    ).toBeLessThan(SCENE_CHUNK_BUDGET_KB);
  });
});
