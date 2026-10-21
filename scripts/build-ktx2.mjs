#!/usr/bin/env node
/**
 * Encode `public/assets/flora/atlas.png` to `atlas.ktx2` using the
 * `basis_universal` CLI (shipped as a dev dep). The flags are the ones Dan
 * locked for D4 of #562: UASTC (not ETC1S) so the transcoder can hand WebGPU
 * BC7 bytes on `texture-compression-bc`-capable devices, mipmaps generated at
 * encode time (basisu's built-in sRGB mip filter), Y-flipped so the shader
 * samples with GPU-conventional UV origin.
 *
 * No arguments: the paths are fixed by convention and `attach.ts` fetches
 * `assets/flora/atlas.ktx2` on `high`+.
 */
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { statSync, mkdirSync } from 'node:fs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const basisu = join(root, 'node_modules', 'basis_universal', 'bin', 'basisu');
const input = join(root, 'public', 'assets', 'flora', 'atlas.png');
const outDir = join(root, 'public', 'assets', 'flora');
const output = join(outDir, 'atlas.ktx2');

mkdirSync(outDir, { recursive: true });

if (!statSync(input, { throwIfNoEntry: false })) {
  console.error(`missing input: ${input}. Run \`node scripts/build-flora-atlas.mjs\` first.`);
  process.exit(1);
}

// -uastc: the quality level that keeps colour fidelity on an sRGB atlas and
// transcodes losslessly to BC7 on WebGPU.
// -ktx2: emit a .ktx2 file (not .basis).
// -mipmap: generate the mip chain at encode time with the sRGB-aware filter.
// -y_flip: WebGPU samples with origin at top-left; flipping here saves a
// shader-side flip for every scenery sprite.
// -output_file: fixed path.
// -no_multithreading: deterministic bytes across machines (needed so the
// committed artifact is reproducible).
const args = ['-uastc', '-ktx2', '-mipmap', '-y_flip', '-no_multithreading', '-output_file', output, input];
console.log(`${basisu} ${args.join(' ')}`);
const res = spawnSync(basisu, args, { stdio: 'inherit' });
if (res.status !== 0) {
  console.error(`basisu failed with status ${res.status}`);
  process.exit(res.status ?? 1);
}
const size = statSync(output).size;
console.log(`wrote ${output} (${size} bytes)`);
