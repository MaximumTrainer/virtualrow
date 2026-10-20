// ============================================================================
// IS THERE ANYTHING IN THIS IMAGE?
//
// The published hero screenshot — docs/screenshot-rower-3d.png, served at
// maximumtrainer.github.io/virtualrow/screenshot-rower-3d.png — was a dark
// navy gradient and nothing else. No boat, no water, no banks: the skydome
// rendered and the scene did not. It is produced by an E2E capture that writes
// whatever the canvas happens to contain, and nothing checked the result, so a
// blank hero shipped to the marketing page unnoticed.
//
// The obvious checks would all have passed it. The file exists; it is a valid
// PNG; it is 1214x377; it has 343 distinct colours. What it does not have is
// *structure*: a vertical fade varies smoothly down the image and not at all
// across it. So the measure that matters is how much neighbouring pixels
// differ horizontally, which a gradient cannot fake and a rendered scene
// cannot avoid.
// ============================================================================

export interface RgbImage {
  width: number;
  height: number;
  /** RGB triplets, row-major, 3 bytes per pixel. */
  pixels: Uint8Array;
}

export interface ImageContentSummary {
  uniqueColours: number;
  /** Mean absolute difference between horizontally adjacent pixels. */
  horizontalEnergy: number;
  /** Mean absolute difference between vertically adjacent pixels. */
  verticalEnergy: number;
  /** Share of the image taken by its single most common colour, 0–1. */
  dominantShare: number;
}

/** A scene has detail across the frame; a sky fade has none. */
const MIN_HORIZONTAL_ENERGY = 0.8;

/** Below this the image is one colour, whatever else is true of it. */
const MIN_UNIQUE_COLOURS = 16;

/** A single colour covering more than this is a fill with a logo on it. */
const MAX_DOMINANT_SHARE = 0.92;

const luma = (r: number, g: number, b: number): number => 0.299 * r + 0.587 * g + 0.114 * b;

/** Measure the image without judging it — useful in a failure message. */
export const describeImageContent = ({ width, height, pixels }: RgbImage): ImageContentSummary => {
  const counts = new Map<number, number>();
  let horizontal = 0;
  let horizontalPairs = 0;
  let vertical = 0;
  let verticalPairs = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 3;
      const r = pixels[i];
      const g = pixels[i + 1];
      const b = pixels[i + 2];
      const key = (r << 16) | (g << 8) | b;
      counts.set(key, (counts.get(key) ?? 0) + 1);

      if (x + 1 < width) {
        const j = i + 3;
        horizontal += Math.abs(luma(r, g, b) - luma(pixels[j], pixels[j + 1], pixels[j + 2]));
        horizontalPairs += 1;
      }
      if (y + 1 < height) {
        const j = i + width * 3;
        vertical += Math.abs(luma(r, g, b) - luma(pixels[j], pixels[j + 1], pixels[j + 2]));
        verticalPairs += 1;
      }
    }
  }

  const total = width * height;
  let dominant = 0;
  for (const count of counts.values()) if (count > dominant) dominant = count;

  return {
    uniqueColours: counts.size,
    horizontalEnergy: horizontalPairs > 0 ? horizontal / horizontalPairs : 0,
    verticalEnergy: verticalPairs > 0 ? vertical / verticalPairs : 0,
    dominantShare: total > 0 ? dominant / total : 1,
  };
};

export interface BlankVerdict {
  blank: boolean;
  reason: string;
  summary: ImageContentSummary;
}

/**
 * Whether an image is empty of content.
 *
 * Horizontal energy is the load-bearing test. A vertical gradient — the exact
 * shape of the blank hero — has hundreds of colours and plenty of *vertical*
 * variation, so anything that counted colours or overall variance would call
 * it a picture.
 */
export const isBlankImage = (image: RgbImage): BlankVerdict => {
  const summary = describeImageContent(image);

  if (summary.uniqueColours < MIN_UNIQUE_COLOURS) {
    return { blank: true, reason: `only ${summary.uniqueColours} distinct colours`, summary };
  }
  if (summary.dominantShare > MAX_DOMINANT_SHARE) {
    return {
      blank: true,
      reason: `one colour covers ${(summary.dominantShare * 100).toFixed(1)}% of the image`,
      summary,
    };
  }
  if (summary.horizontalEnergy < MIN_HORIZONTAL_ENERGY) {
    return {
      blank: true,
      reason:
        `no horizontal structure (${summary.horizontalEnergy.toFixed(3)} < ` +
        `${MIN_HORIZONTAL_ENERGY}) — a gradient, not a rendered scene`,
      summary,
    };
  }

  return { blank: false, reason: 'has structure', summary };
};
