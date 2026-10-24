/**
 * Minimal bank-strip geometry for P2 (#550 FR7). Two strips of ground running
 * either side of the water strip. The three version in
 * `src/components/rower3d/bankGeometry.ts` is 295 lines of per-vertex
 * attributes (clearance, dryness, foliage mask); this port lands flat
 * geometry with a `side` attribute. Full parity is a later phase.
 */

export interface BankStripGeometry {
  positions: Float32Array; // x,y,z
  sides: Float32Array; // 1 attribute per vertex: -1 or +1
  indices: Uint16Array;
}

export const buildBankStrips = (
  options: {
    waterHalfWidth?: number;
    bankWidth?: number;
    length?: number;
    divisions?: number;
  } = {},
): BankStripGeometry => {
  const waterHalfWidth = options.waterHalfWidth ?? 20;
  const bankWidth = options.bankWidth ?? 60;
  const length = options.length ?? 400;
  const divisions = options.divisions ?? 40;

  const vertsPerStrip = (divisions + 1) * 2;
  const positions = new Float32Array(vertsPerStrip * 2 * 3);
  const sides = new Float32Array(vertsPerStrip * 2);
  const indices = new Uint16Array(divisions * 6 * 2);

  const writeStrip = (sign: 1 | -1, vertOffset: number, indexOffset: number): void => {
    const inner = sign * waterHalfWidth;
    const outer = sign * (waterHalfWidth + bankWidth);
    for (let i = 0; i <= divisions; i++) {
      const t = i / divisions;
      const z = -t * length;
      const vo = (vertOffset + i * 2) * 3;
      positions[vo] = inner;
      positions[vo + 1] = 0;
      positions[vo + 2] = z;
      positions[vo + 3] = outer;
      positions[vo + 4] = 0;
      positions[vo + 5] = z;
      sides[vertOffset + i * 2] = sign;
      sides[vertOffset + i * 2 + 1] = sign;
    }
    for (let i = 0; i < divisions; i++) {
      const base = vertOffset + i * 2;
      const o = (indexOffset + i) * 6;
      // Wind so the ground faces up on either side.
      if (sign > 0) {
        indices[o] = base;
        indices[o + 1] = base + 2;
        indices[o + 2] = base + 1;
        indices[o + 3] = base + 1;
        indices[o + 4] = base + 2;
        indices[o + 5] = base + 3;
      } else {
        indices[o] = base;
        indices[o + 1] = base + 1;
        indices[o + 2] = base + 2;
        indices[o + 3] = base + 1;
        indices[o + 4] = base + 3;
        indices[o + 5] = base + 2;
      }
    }
  };

  writeStrip(-1, 0, 0);
  writeStrip(1, vertsPerStrip, divisions);

  return { positions, sides, indices };
};
