import { describe, expect, it } from 'vitest';
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { loadGlb } from '../glbLoader';
import { LIVERIED_LANDMARKS } from '../sceneryStructures';
import { ASSET_SCALE } from '../sceneryPlacement';

/**
 * #567 "Landmark GLB chunks" slice (part of P6 optional). The three
 * tier-L landmarks are already wired through the structure pipeline
 * (`landmarkStructures` → `computeStructurePlacements` → the engine's
 * sceneryMesh pass) and the `.glb` files sit under `public/assets/
 * scenery/tier-l/`. This test is the acceptance gate for that slice:
 * every landmark file must parse via the hand-written loader without
 * throwing, decode to real-space geometry (not raw int16 quantised
 * values), and the combined on-disk size must stay within the per-
 * route landmark budget so loading them doesn't tip us over the
 * engine's memory headroom.
 */

const SCENERY_DIR = path.join(process.cwd(), 'public/assets/scenery');

const landmarkGlb = (id: string): Uint8Array =>
  new Uint8Array(readFileSync(path.join(SCENERY_DIR, 'tier-l', `${id}.glb`)));

/**
 * Per-route cap for landmark GLB bytes (uncompressed on-disk size).
 * 1 MiB covers the three current landmarks (~106 KiB combined) with
 * ~10× headroom for the sort of hero asset future routes might add.
 * This cap is NOT the GPU-side upload cost — the loader decompresses
 * meshopt + dequantises on CPU, so VRAM is a function of the primitive
 * triangle counts (also asserted below) not the file bytes.
 */
export const LANDMARK_GLB_BUDGET_BYTES = 1024 * 1024;

describe('LIVERIED_LANDMARKS GLB assets (#567)', () => {
  it('ships exactly three liveried landmarks', () => {
    expect(LIVERIED_LANDMARKS.length).toBe(3);
    for (const l of LIVERIED_LANDMARKS) {
      expect(l.id.startsWith('l-')).toBe(true);
      expect(l.label.length).toBeGreaterThan(0);
      expect(l.spansWater).toBe(true); // all three cross water in the data
    }
  });

  it('every landmark .glb file exists on disk', () => {
    for (const l of LIVERIED_LANDMARKS) {
      const p = path.join(SCENERY_DIR, 'tier-l', `${l.id}.glb`);
      const stat = statSync(p);
      expect(stat.isFile(), l.id).toBe(true);
      expect(stat.size, l.id).toBeGreaterThan(0);
    }
  });

  it('combined landmark bytes stay inside the per-route budget', () => {
    let total = 0;
    for (const l of LIVERIED_LANDMARKS) {
      total += statSync(path.join(SCENERY_DIR, 'tier-l', `${l.id}.glb`)).size;
    }
    expect(total, `combined ${total} bytes`).toBeLessThanOrEqual(LANDMARK_GLB_BUDGET_BYTES);
  });

  for (const l of LIVERIED_LANDMARKS) {
    it(`${l.id} parses + decodes into real-space triangle geometry`, async () => {
      const bytes = landmarkGlb(l.id);
      const model = await loadGlb(bytes);
      expect(model.primitives.length).toBeGreaterThan(0);
      let totalTris = 0;
      for (const prim of model.primitives) {
        expect(prim.positions.length).toBeGreaterThan(0);
        expect(prim.positions.length % 3).toBe(0);
        expect(prim.normals.length).toBe(prim.positions.length);
        expect(prim.indices.length).toBeGreaterThan(0);
        expect(prim.indices.length % 3).toBe(0);
        totalTris += prim.indices.length / 3;
        for (let i = 0; i < Math.min(90, prim.positions.length); i += 1) {
          expect(Number.isFinite(prim.positions[i])).toBe(true);
        }
      }
      // Bounds should sit in a plausible real-world metres range for a
      // bridge-sized landmark once scaled through `ASSET_SCALE` at
      // placement (positions in the GLB are in authored units, typically
      // millimetres per `ASSET_SCALE = 0.001`). A ~20-200 m extent after
      // scale brackets everything from a footbridge to a major railway
      // crossing without accepting raw int16 quantised values.
      const extentUnits = Math.max(
        model.bounds.max[0] - model.bounds.min[0],
        model.bounds.max[1] - model.bounds.min[1],
        model.bounds.max[2] - model.bounds.min[2],
      );
      const extentMetres = extentUnits * ASSET_SCALE;
      expect(extentMetres, `${l.id} extent ${extentMetres} m`).toBeGreaterThan(5);
      expect(extentMetres, `${l.id} extent ${extentMetres} m`).toBeLessThan(300);
      // Soft triangle-count ceiling — if a future hero asset blows past
      // this, we want to re-check the VRAM budget alongside this test.
      expect(totalTris, `${l.id} ${totalTris} tris`).toBeLessThanOrEqual(50_000);
    });
  }
});
