import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { GLB_ROWER_NODES, GLB_OAR_NODES } from '../components/rower3d/crewRig';

/**
 * Every node the scene animates has to exist in the shipped model.
 *
 * The rower's arms were never animated at all in the GLB scull, so nothing
 * would have noticed a rename: the failure mode is a rower sitting rigid while
 * the oars sweep, which looks like a styling choice rather than a fault (#273).
 */
/** The crewed models. scull.glb is the boat alone and carries no rower. */
const CREW_MODELS = [
  'public/assets/boat/scull-male.glb',
  'public/assets/boat/scull-female.glb',
];

/** Every boat model, crewed or not, sweeps oars. */
const ALL_BOAT_MODELS = ['public/assets/boat/scull.glb', ...CREW_MODELS];

/** Node names from a GLB's JSON chunk. */
const nodeNames = (file: string): string[] => {
  const data = fs.readFileSync(path.join(process.cwd(), file));
  const jsonLength = data.readUInt32LE(12);
  const json = JSON.parse(data.subarray(20, 20 + jsonLength).toString('utf8'));
  return (json.nodes ?? []).map((n: { name?: string }) => n.name ?? '');
};

describe('the crew rig exposes what the scene animates', () => {
  for (const model of CREW_MODELS) {
    it(`${model.split('/').pop()} carries every rower node the stroke moves`, () => {
      const names = new Set(nodeNames(model));

      const missing = GLB_ROWER_NODES.filter((n) => !names.has(n));

      expect(
        missing,
        `${model} is missing nodes the scene animates — the rower would sit still`,
      ).toEqual([]);
    });
  }

  for (const model of ALL_BOAT_MODELS) {
    it(`${model.split('/').pop()} carries both oars`, () => {
      const names = new Set(nodeNames(model));

      expect(GLB_OAR_NODES.filter((n) => !names.has(n))).toEqual([]);
    });
  }

  it('does not expect a rower in the uncrewed scull', () => {
    // scull.glb is the boat on its own. Asserting rower nodes there would fail
    // for a model that is doing exactly what it should.
    const names = new Set(nodeNames('public/assets/boat/scull.glb'));

    expect([...names].some((n) => n.includes('Rower'))).toBe(false);
  });

  // The slide. The rig has always authored it and nothing ever moved it, so
  // the rower's legs compressed while their seat stayed where it was — they
  // shrank and grew rather than sliding (#330).
  it('names the seat, so the rower can slide', () => {
    expect(GLB_ROWER_NODES).toContain('Seat');
  });

  it('names the arms and the oars, so a stroke can move both', () => {
    expect(GLB_ROWER_NODES).toContain('Rower_LeftArm');
    expect(GLB_ROWER_NODES).toContain('Rower_RightArm');
    expect(GLB_OAR_NODES).toContain('LeftOar');
    expect(GLB_OAR_NODES).toContain('RightOar');
  });
});
