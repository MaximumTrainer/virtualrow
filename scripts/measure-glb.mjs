#!/usr/bin/env node
/**
 * Print the bounding box of one or more GLB files, in the units they were
 * authored in. Reads the position accessors' min/max out of the JSON chunk, so
 * no mesh data is decoded and no dependencies are needed (issue #232).
 */
import fs from 'node:fs';

const JSON_CHUNK = 0x4e4f534a;

const parse = (buffer) => {
  const jsonLength = buffer.readUInt32LE(12);
  if (buffer.readUInt32LE(16) !== JSON_CHUNK) throw new Error('GLB has no JSON chunk');
  const raw = buffer.subarray(20, 20 + jsonLength);
  let end = raw.length;
  while (end > 0 && (raw[end - 1] === 0 || raw[end - 1] === 0x20)) end -= 1;
  return JSON.parse(raw.subarray(0, end).toString('utf8'));
};

export const boundsOf = (gltf, nodeFilter) => {
  const accessors = gltf.accessors ?? [];
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let measured = false;

  const meshes = nodeFilter
    ? (gltf.nodes ?? []).filter((n) => n.mesh != null && nodeFilter(n.name ?? '')).map((n) => gltf.meshes[n.mesh])
    : gltf.meshes ?? [];

  for (const mesh of meshes) {
    for (const primitive of mesh?.primitives ?? []) {
      const accessor = accessors[primitive.attributes?.POSITION ?? -1];
      if (!accessor?.min || !accessor?.max) continue;
      measured = true;
      for (let axis = 0; axis < 3; axis += 1) {
        min[axis] = Math.min(min[axis], accessor.min[axis]);
        max[axis] = Math.max(max[axis], accessor.max[axis]);
      }
    }
  }
  return measured ? { min, max, size: [max[0] - min[0], max[1] - min[1], max[2] - min[2]] } : null;
};

export const readGlb = (path) => parse(fs.readFileSync(path));

if (process.argv[1]?.endsWith('measure-glb.mjs')) {
  for (const path of process.argv.slice(2)) {
    const bounds = boundsOf(readGlb(path));
    const size = bounds ? bounds.size.map((v) => v.toFixed(3)).join(' x ') : 'no geometry';
    console.log(`${path}: ${size}`);
  }
}
