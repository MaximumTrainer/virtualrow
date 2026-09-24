import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { NodeIO, getBounds } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder } from 'meshoptimizer';

/**
 * Issue #332 — compression must not move the models.
 *
 * `compress-scenery.mjs` simplifies, quantises and meshopt-encodes every GLB in
 * place. Quantisation rounds vertex positions and simplification removes them
 * outright, either of which can shrink a model or shift it off the waterline -
 * and the scene places these by their own extents, so a bank edge that lost
 * 5% of its height leaves a gap the route is rendered through.
 *
 * The report records what each model measured *before* anything touched it.
 * This reads the file that actually ships and holds it to that.
 */

const ROOT = path.resolve(__dirname, '..', '..');
const REPORT = path.join(ROOT, 'assets-src/scenery/compression-report.json');

interface ReportEntry {
  path: string;
  bounds: number[];
  simplified: boolean;
  trianglesBefore: number;
  trianglesAfter: number;
}

const report: { models: Record<string, ReportEntry> } = JSON.parse(fs.readFileSync(REPORT, 'utf8'));

/** The largest movement of any corner, relative to the model's longest side. */
const drift = (before: number[], after: number[]): number => {
  const span = Math.max(...[0, 1, 2].map((axis) => Math.abs(before[axis + 3] - before[axis])), 1e-6);
  return Math.max(...before.map((value, i) => Math.abs(value - after[i]) / span));
};

describe('the compressed models', () => {
  it('stand where they stood before they were compressed', { timeout: 120_000 }, async () => {
    await MeshoptDecoder.ready;
    const io = new NodeIO()
      .registerExtensions(ALL_EXTENSIONS)
      .registerDependencies({ 'meshopt.decoder': MeshoptDecoder });

    const moved: string[] = [];

    for (const [id, entry] of Object.entries(report.models)) {
      const document = await io.read(path.join(ROOT, entry.path));
      const { min, max } = getBounds(document.getRoot().listScenes()[0]);
      const moved_by = drift(entry.bounds, [...min, ...max]);
      if (moved_by > 0.02) moved.push(`${id} (${(moved_by * 100).toFixed(1)}%)`);
    }

    expect(moved, `moved more than 2%: ${moved.join(', ')}`).toEqual([]);
  });

  // Simplification is attempted on every model and rolled back where it would
  // distort one, so a model that kept its full detail is a recorded decision
  // rather than a silent skip.
  it('records which models kept their full detail', () => {
    for (const [id, entry] of Object.entries(report.models)) {
      expect(typeof entry.simplified, `${id} has no record of being simplified`).toBe('boolean');
      if (entry.simplified) {
        expect(entry.trianglesAfter, `${id} was simplified into nothing`).toBeGreaterThan(0);
      }
    }
  });
});
