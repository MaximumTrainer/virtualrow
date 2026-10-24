#!/usr/bin/env node
/**
 * Build the WebGPU flora sprite atlas PNG.
 *
 * The painter is a Node port of the three-side `paintFoliage` in
 * `src/components/rower3d/foliageTexture.ts`: the pixels are the same look
 * (seeded clumps + trunk, grey-shaded for species-tint multiplication). The
 * output is one PNG at `public/assets/flora/atlas.png`, 512x512 with the three
 * shapes stacked as 512x~170 rows then down-sampled: a single atlas, D4-a of
 * #562. The KTX2 encoder reads this file and writes `atlas.ktx2` next to it.
 *
 * Pure math + sharp — no three, no canvas. Deterministic from one run to the
 * next, so the committed artifact is bit-identical across machines.
 */
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const SIZE = 512;
const SHAPE_HEIGHT = Math.floor(SIZE / 3); // ~170 px per shape row, three rows stacked.

const seededRandom = (seed) => {
  const s = Math.sin(seed * 9301 + 49297) * 233280;
  return s - Math.floor(s);
};

const drawFor = (shape) => {
  const base = { broadleaf: 1, conifer: 5003, willow: 9011 }[shape];
  return (i, k) => seededRandom(base + i * 7 + k);
};

const toneAt = (y, jitter) => (0.8 + 0.2 * jitter) * (1.12 - 0.25 * y);

const broadleafPlan = () => {
  const draw = drawFor('broadleaf');
  const blobs = Array.from({ length: 70 }, (_, i) => {
    const angle = draw(i, 1) * Math.PI * 2;
    const reach = Math.sqrt(draw(i, 2)) * 0.82;
    const y = 0.4 + Math.sin(angle) * 0.32 * reach;
    const radius = 0.06 + 0.06 * draw(i, 3);
    return { x: 0.5 + Math.cos(angle) * 0.38 * reach, y, rx: radius, ry: radius, tone: toneAt(y, draw(i, 4)) };
  });
  return { blobs, trunk: { top: 0.55, halfWidth: 0.03 } };
};

const coniferPlan = () => {
  const draw = drawFor('conifer');
  const tip = 0.04;
  const depth = 0.78;
  const blobs = Array.from({ length: 150 }, (_, i) => {
    const down = Math.pow(draw(i, 1), 0.65);
    const y = tip + depth * down;
    const halfWidth = 0.4 * down;
    const radius = (0.035 + 0.035 * draw(i, 3)) * (0.5 + 0.5 * down);
    return {
      x: 0.5 + (draw(i, 2) - 0.5) * 2 * halfWidth,
      y,
      rx: radius * 1.4,
      ry: radius * 0.75,
      tone: toneAt(y, draw(i, 4)),
    };
  });
  return { blobs, trunk: { top: 0.7, halfWidth: 0.025 } };
};

const willowPlan = () => {
  const draw = drawFor('willow');
  const dome = Array.from({ length: 48 }, (_, i) => {
    const angle = draw(i, 1) * Math.PI * 2;
    const reach = Math.sqrt(draw(i, 2)) * 0.85;
    const y = 0.3 + Math.sin(angle) * 0.22 * reach;
    const radius = 0.055 + 0.05 * draw(i, 3);
    return { x: 0.5 + Math.cos(angle) * 0.4 * reach, y, rx: radius, ry: radius, tone: toneAt(y, draw(i, 4)) };
  });
  const curtains = Array.from({ length: 56 }, (_, n) => {
    const i = n + 100;
    const across = draw(i, 1) - 0.5;
    const x = 0.5 + Math.sign(across) * (0.12 + 0.3 * Math.sqrt(Math.abs(across) * 2));
    const y = 0.42 + 0.26 * draw(i, 2);
    const radius = 0.022 + 0.018 * draw(i, 3);
    return { x, y, rx: radius, ry: radius * 4.5, tone: toneAt(y, draw(i, 4)) * 0.9 };
  });
  return { blobs: [...dome, ...curtains], trunk: { top: 0.45, halfWidth: 0.035 } };
};

const PLANS = { broadleaf: broadleafPlan, conifer: coniferPlan, willow: willowPlan };
const SHAPES = ['broadleaf', 'conifer', 'willow'];

const TRUNK_LUMA = 70;
const PAINT_OVER = 0.25;

/** Paint one shape row into `pixels` at vertical offset `yOffset`, `rowHeight` px tall, `width` px wide. */
const paintRow = (pixels, atlasWidth, yOffset, rowHeight, shape, width) => {
  const { blobs, trunk } = PLANS[shape]();
  const grainSeed = { broadleaf: 17, conifer: 29, willow: 41 }[shape];

  const x0 = Math.floor(width * (0.5 - trunk.halfWidth));
  const x1 = Math.ceil(width * (0.5 + trunk.halfWidth));
  for (let y = Math.floor(rowHeight * trunk.top); y < rowHeight; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const i = ((y + yOffset) * atlasWidth + x) * 4;
      pixels[i] = TRUNK_LUMA;
      pixels[i + 1] = TRUNK_LUMA;
      pixels[i + 2] = TRUNK_LUMA;
      pixels[i + 3] = 255;
    }
  }

  for (const blob of blobs) {
    const cx = blob.x * width;
    const cy = blob.y * rowHeight;
    const rx = blob.rx * width;
    const ry = blob.ry * rowHeight;
    const left = Math.max(0, Math.floor(cx - rx));
    const right = Math.min(width - 1, Math.ceil(cx + rx));
    const top = Math.max(0, Math.floor(cy - ry));
    const bottom = Math.min(rowHeight - 1, Math.ceil(cy + ry));
    for (let y = top; y <= bottom; y += 1) {
      for (let x = left; x <= right; x += 1) {
        const dx = (x + 0.5 - cx) / rx;
        const dy = (y + 0.5 - cy) / ry;
        const grain = seededRandom(grainSeed + x * 131 + y * 977);
        const falloff = 1 - (dx * dx + dy * dy) - 0.35 * (grain - 0.5);
        if (falloff <= 0) continue;
        const i = ((y + yOffset) * atlasWidth + x) * 4;
        const alpha = Math.round(255 * Math.min(1, falloff * 1.6));
        if (alpha > pixels[i + 3]) pixels[i + 3] = alpha;
        if (falloff < PAINT_OVER) continue;
        const lit = 1 - 0.22 * dy;
        const luma = Math.round(
          255 * blob.tone * (0.88 + 0.12 * falloff) * lit * (0.8 + 0.3 * grain),
        );
        pixels[i] = Math.max(0, Math.min(255, luma));
        pixels[i + 1] = pixels[i];
        pixels[i + 2] = pixels[i];
      }
    }
  }
};

const main = async () => {
  const pixels = new Uint8Array(SIZE * SIZE * 4);
  // Four rows: three shapes + a gutter — stacked at even thirds.
  for (let r = 0; r < SHAPES.length; r += 1) {
    paintRow(pixels, SIZE, r * SHAPE_HEIGHT, SHAPE_HEIGHT, SHAPES[r], SIZE);
  }

  const outDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'assets', 'flora');
  const outPath = join(outDir, 'atlas.png');
  await sharp(Buffer.from(pixels), { raw: { width: SIZE, height: SIZE, channels: 4 } })
    .png({ compressionLevel: 9 })
    .toFile(outPath);

  // sharp returns byte count on toFile; log a summary so CI logs show the result.
  const buf = await (await import('node:fs/promises')).readFile(outPath);
  console.log(`wrote ${outPath} (${buf.length} bytes, ${SIZE}x${SIZE})`);
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
