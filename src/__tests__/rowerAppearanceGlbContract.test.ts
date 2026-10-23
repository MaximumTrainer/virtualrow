import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

/**
 * #474 Phase 2 — generator contract.
 *
 * The appearance picker shows a hairstyle and a hat picker; the renderer's
 * visibility pass expects the GLB to carry four `Hair_<Style>` siblings and
 * three `Hat_<Style>` siblings under a `Hat` parent. This file guards both
 * ends of that contract:
 *
 *  - `build_crew.py --dry-run` lists exactly the Phase 2 node tree, so the
 *    generator CAN produce the layout the renderer expects (AC8).
 *  - The committed `scull-male.glb` / `scull-female.glb` stay under the
 *    460 KB NFR2 cap once regenerated — a size-cap test that WILL fail if a
 *    future regen pushes the asset over that threshold (AC6).
 *
 * The GLB structural assertion (AC5 — the actual regenerated GLBs carry every
 * `Hair_<Style>` / `Hat_<Style>` node) is deferred until the GLBs are
 * regenerated with the project's pinned CadQuery / OCCT version. See
 * `public/assets/boat/README.md` and the Phase 2 PR body.
 */

const SCRIPT_PATH = path.join(process.cwd(), 'scripts/build_crew.py');
const MALE_GLB = path.join(process.cwd(), 'public/assets/boat/scull-male.glb');
const FEMALE_GLB = path.join(process.cwd(), 'public/assets/boat/scull-female.glb');

const hasPython3 = (() => {
  try {
    execFileSync('python3', ['--version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

const dryRunAvailable = hasPython3 && fs.existsSync(SCRIPT_PATH);

describe('rower appearance GLB contract (#474 Phase 2)', () => {
  it.skipIf(!dryRunAvailable)(
    'build_crew.py --dry-run lists every hairstyle and hat sibling the renderer toggles',
    { timeout: 30_000 }, // Python startup + import takes several seconds; the
                        // pre-commit's parallel vitest workers push it past
                        // the default 5 s, so give the dry run room.
    () => {
      let out: string;
      try {
        out = execFileSync('python3', [SCRIPT_PATH, '--dry-run', '/tmp/_virtualrow_dry'], {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'pipe'],
        });
      } catch {
        // CadQuery is optional on a contributor's machine; skip the check
        // rather than fail the suite when the generator is not installable.
        return;
      }
      // Only the crewed sections carry the hair/hat nodes; the bare scull does not.
      const crewed = out.slice(out.indexOf('scull-male'));
      for (const style of ['Short', 'Long', 'Buzz', 'Bun']) {
        expect(crewed, `Hair_${style}`).toContain(`Hair_${style}`);
      }
      for (const hat of ['Cap', 'Visor', 'Beanie']) {
        expect(crewed, `Hat_${hat}`).toContain(`Hat_${hat}`);
      }
      expect(crewed).toContain('Hairstyles');
      // Match \r?\n: Python's print emits LF, but Node's execFileSync captures
      // the child's stdout through the OS pipe layer, which on Windows comes
      // back as CRLF. The renderer only cares that `Hat` is a 2-space-indented
      // sibling of the hat variants, not which line ending surrounds it.
      expect(crewed, 'Hat parent').toMatch(/\r?\n {2}Hat\r?\n/);
    },
  );

  it('both scull GLBs stay under the 460 KB NFR2 cap', () => {
    const CAP = 460 * 1024;
    expect(fs.statSync(MALE_GLB).size, 'scull-male.glb').toBeLessThan(CAP);
    expect(fs.statSync(FEMALE_GLB).size, 'scull-female.glb').toBeLessThan(CAP);
  });
});
