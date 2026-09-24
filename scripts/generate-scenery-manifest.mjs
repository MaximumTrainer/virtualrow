#!/usr/bin/env node
/**
 * Write the shipped GLB kit's manifest (issue #332).
 *
 * The scene fetches a model per placement, and until now nothing in the app -
 * or in CI - knew what any of them weighed. The manifest is what the byte
 * budgets are checked against, and what lets the app warm the cache for a
 * route smallest-model-first instead of asking a static host for 58 GLBs at
 * once.
 *
 *   node scripts/generate-scenery-manifest.mjs
 *
 * Generated from the files on disk, never hand-edited; `sceneryManifest.test.ts`
 * fails if the two drift apart.
 */
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public');
export const MANIFEST_PATH = path.join(PUBLIC, 'assets', 'scenery', 'manifest.json');

const GLB_ROOTS = [path.join('assets', 'scenery'), path.join('assets', 'boat')];

const glbsUnder = (dir) => {
  const absolute = path.join(PUBLIC, dir);
  if (!fs.existsSync(absolute)) return [];
  return fs
    .readdirSync(absolute, { recursive: true })
    .map((entry) => entry.toString())
    .filter((entry) => entry.toLowerCase().endsWith('.glb'))
    .map((entry) => path.join(dir, entry).split(path.sep).join('/'))
    .sort();
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

async function main() {
  await MeshoptDecoder.ready;
  await MeshoptEncoder.ready;
  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({ 'meshopt.decoder': MeshoptDecoder, 'meshopt.encoder': MeshoptEncoder });

  const models = {};
  let totalBytes = 0;

  for (const relative of GLB_ROOTS.flatMap(glbsUnder)) {
    const file = path.join(PUBLIC, relative);
    const id = path.basename(relative, '.glb');
    const document = await io.read(file);
    const bytes = fs.statSync(file).size;
    totalBytes += bytes;
    models[id] = {
      path: relative,
      bytes,
      triangles: trianglesIn(document),
      compressed: document
        .getRoot()
        .listExtensionsUsed()
        .some((extension) => extension.extensionName === 'EXT_meshopt_compression'),
    };
  }

  const manifest = { totalBytes, models };
  fs.writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `${Object.keys(models).length} models, ${(totalBytes / 1024 / 1024).toFixed(2)} MB -> ${path.relative(ROOT, MANIFEST_PATH)}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
