/**
 * P5 (#562 AC8): assert the committed flora KTX2 atlas is smaller than the
 * sibling PNG AND that its GPU memory footprint is at most half the
 * uncompressed RGBA8 chain. The PNG and KTX2 are produced by the two scripts
 * under `scripts/build-{flora-atlas,ktx2}.mjs` (`npm run build:flora-atlas`),
 * and committed under `public/assets/flora/`. The test reads those files
 * from disk — no network, no GPU.
 */
import { statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { expectedAtlasBytes } from '../engine/textureLoader';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const atlasDir = join(repoRoot, 'public', 'assets', 'flora');
const PNG = join(atlasDir, 'atlas.png');
const KTX2 = join(atlasDir, 'atlas.ktx2');
const ATLAS_SIZE = 512;

describe('flora atlas bytes (#562 AC8)', () => {
  it('both artefacts are committed under public/assets/flora', () => {
    expect(statSync(PNG).size).toBeGreaterThan(1024);
    expect(statSync(KTX2).size).toBeGreaterThan(1024);
  });

  it('GPU memory for BC7 is ≤ 50% of RGBA8', () => {
    const { ktx2, uncompressed } = expectedAtlasBytes(ATLAS_SIZE, ATLAS_SIZE);
    expect(ktx2).toBeLessThanOrEqual(uncompressed / 2);
  });

  it('on-disk KTX2 bytes are smaller than the sibling PNG', () => {
    // The runtime cost on `high`+ is dominated by the GPU-memory ratio above,
    // but the download size matters too: UASTC-KTX2 should also beat PNG for
    // the atlas we actually ship. This asserts the committed artifacts, not
    // the format bound: swapping the painter must keep the ratio sane or the
    // encoding settings in `scripts/build-ktx2.mjs` were wrong.
    const pngBytes = statSync(PNG).size;
    const ktx2Bytes = statSync(KTX2).size;
    expect(ktx2Bytes).toBeLessThan(pngBytes);
  });
});
