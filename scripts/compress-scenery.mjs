#!/usr/bin/env node
/**
 * Compress the GLB kit in place (issue #332).
 *
 * `public/assets/scenery` held 130 uncompressed GLBs at 51 MB, plus 5.7 MB of
 * sculls, and every model a route names was fetched whole. None of it is
 * hand-modelled: `scripts/build_scenery.py` generates the kit from cadquery, so
 * the uncompressed GLB is an intermediate, not a source. That is why this
 * writes back in place - the source of truth is the Python, and keeping a
 * second 51 MB copy in the repo to protect a derivative would cost more than
 * it saves.
 *
 *   node scripts/compress-scenery.mjs [--force] [--dry-run]
 *
 * `--force` re-compresses models that already carry EXT_meshopt_compression.
 * Without it they are skipped, because simplifying an already-simplified mesh
 * compounds the error: two passes at ratio 0.6 leave 36% of the triangles.
 *
 * Simplification is attempted and then checked: any model whose bounding box
 * moves by more than 2% is rebuilt without it, so a mesh that cannot survive
 * decimation still gets quantisation and meshopt rather than being skipped or
 * silently deformed.
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, weld, simplify, quantize, meshopt } from '@gltf-transform/functions';
import { getBounds } from '@gltf-transform/core';
import { MeshoptDecoder, MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPORT = path.join(ROOT, 'assets-src', 'scenery', 'compression-report.json');

/** Everything shipped as a GLB, scenery kit and boats alike. */
export const GLB_ROOTS = [
  path.join('public', 'assets', 'scenery'),
  path.join('public', 'assets', 'boat'),
];

/** Bounding box movement a model may show before simplification is rejected. */
const BOUNDS_TOLERANCE = 0.02;

const glbsUnder = (dir) => {
  const absolute = path.join(ROOT, dir);
  if (!fs.existsSync(absolute)) return [];
  return fs
    .readdirSync(absolute, { recursive: true })
    .map((entry) => path.join(absolute, entry.toString()))
    .filter((file) => file.toLowerCase().endsWith('.glb'))
    .sort();
};

const boxOf = (document) => {
  const { min, max } = getBounds(document.getRoot().getDefaultScene() ?? document.getRoot().listScenes()[0]);
  return [...min, ...max];
};

/** The largest relative movement of any bounding box corner. */
const boxDrift = (before, after) => {
  const span = Math.max(
    ...[0, 1, 2].map((axis) => Math.abs(before[axis + 3] - before[axis])),
    1e-6,
  );
  return Math.max(...before.map((value, i) => Math.abs(value - after[i]) / span));
};

const trianglesIn = (document) =>
  document
    .getRoot()
    .listMeshes()
    .flatMap((mesh) => mesh.listPrimitives())
    .reduce((total, primitive) => {
      const indices = primitive.getIndices();
      const count = indices ? indices.getCount() : (primitive.getAttribute('POSITION')?.getCount() ?? 0);
      return total + Math.floor(count / 3);
    }, 0);

const isCompressed = (document) =>
  document
    .getRoot()
    .listExtensionsUsed()
    .some((extension) => extension.extensionName === 'EXT_meshopt_compression');

async function main() {
  const force = process.argv.includes('--force');
  const dryRun = process.argv.includes('--dry-run');

  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;
  await MeshoptSimplifier.ready;

  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

  const files = GLB_ROOTS.flatMap(glbsUnder);
  if (files.length === 0) throw new Error('No GLBs found — is this the repository root?');

  const report = fs.existsSync(REPORT) ? JSON.parse(fs.readFileSync(REPORT, 'utf8')) : { models: {} };
  let before = 0;
  let after = 0;
  let skipped = 0;

  for (const file of files) {
    const id = path.basename(file, '.glb');
    const bytesBefore = fs.statSync(file).size;
    const document = await io.read(file);

    if (isCompressed(document) && !force) {
      before += bytesBefore;
      after += bytesBefore;
      skipped += 1;
      continue;
    }

    const original = {
      bytes: bytesBefore,
      triangles: trianglesIn(document),
      bounds: boxOf(document),
    };

    // Simplify first, then measure: a model that cannot take it is rebuilt
    // from the file rather than from a document already decimated in place.
    await document.transform(
      dedup(),
      prune(),
      weld(),
      simplify({ simplifier: MeshoptSimplifier, ratio: 0.6, error: 0.001 }),
    );

    let drift = boxDrift(original.bounds, boxOf(document));
    let simplified = true;
    let output = document;

    if (drift > BOUNDS_TOLERANCE) {
      output = await io.read(file);
      await output.transform(dedup(), prune());
      simplified = false;
      drift = boxDrift(original.bounds, boxOf(output));
    }

    await output.transform(quantize(), meshopt({ encoder: MeshoptEncoder }));

    const bytes = await io.writeBinary(output);
    if (!dryRun) fs.writeFileSync(file, bytes);

    report.models[id] = {
      path: path.relative(ROOT, file).split(path.sep).join('/'),
      bytesBefore: original.bytes,
      bytesAfter: bytes.byteLength,
      trianglesBefore: original.triangles,
      trianglesAfter: trianglesIn(output),
      // The bounds the model had before anything touched it — what
      // `glbBounds.test.ts` holds the shipped file to.
      bounds: original.bounds,
      simplified,
      boundsDrift: Number(drift.toFixed(5)),
    };

    before += original.bytes;
    after += bytes.byteLength;
    const saved = ((1 - bytes.byteLength / original.bytes) * 100).toFixed(0);
    console.log(
      `${id.padEnd(34)} ${String(original.bytes).padStart(8)} -> ${String(bytes.byteLength).padStart(8)}  ${saved.padStart(3)}%${simplified ? '' : '  (kept full detail)'}`,
    );
  }

  if (!dryRun) {
    fs.mkdirSync(path.dirname(REPORT), { recursive: true });
    fs.writeFileSync(REPORT, `${JSON.stringify(report, null, 2)}\n`);
  }

  const mb = (n) => (n / 1024 / 1024).toFixed(2);
  console.log(
    `\n${files.length} models, ${skipped} already compressed. ${mb(before)} MB -> ${mb(after)} MB.`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
