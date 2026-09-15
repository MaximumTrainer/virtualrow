import { describe, it, expect } from 'vitest';
import {
  readGlbBounds,
  readGlbWorldBounds,
  parseDeclaredDims,
  compareDims,
} from '../utils/glbBounds';

/** A minimal GLB: header, JSON chunk with one accessor's min/max, no BIN needed. */
const makeGlb = (gltf: unknown): Buffer => {
  const json = Buffer.from(JSON.stringify(gltf), 'utf8');
  const padded = Buffer.concat([json, Buffer.alloc((4 - (json.length % 4)) % 4, 0x20)]);
  const header = Buffer.alloc(12);
  header.writeUInt32LE(0x46546c67, 0);
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(12 + 8 + padded.length, 8);
  const chunk = Buffer.alloc(8);
  chunk.writeUInt32LE(padded.length, 0);
  chunk.writeUInt32LE(0x4e4f534a, 4);
  return Buffer.concat([header, chunk, padded]);
};

const positionAccessor = (min: number[], max: number[]) => ({
  meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
  accessors: [{ type: 'VEC3', min, max }],
});

describe('readGlbBounds', () => {
  it('measures a model from its position accessor', () => {
    const glb = makeGlb(positionAccessor([-150, -150, -132], [150, 150, 132]));

    expect(readGlbBounds(glb)).toEqual({ x: 300, y: 300, z: 264 });
  });

  it('spans every primitive, not just the first', () => {
    const glb = makeGlb({
      meshes: [
        { primitives: [{ attributes: { POSITION: 0 } }, { attributes: { POSITION: 1 } }] },
      ],
      accessors: [
        { type: 'VEC3', min: [0, 0, 0], max: [100, 10, 10] },
        { type: 'VEC3', min: [-50, 0, 0], max: [0, 200, 10] },
      ],
    });

    expect(readGlbBounds(glb)).toEqual({ x: 150, y: 200, z: 10 });
  });

  it('returns nothing for a model with no positions to measure', () => {
    expect(readGlbBounds(makeGlb({ meshes: [], accessors: [] }))).toBeNull();
  });

  it('rejects anything that is not a GLB', () => {
    expect(() => readGlbBounds(Buffer.from('not a glb at all'))).toThrow(/glb/i);
  });
});

describe('parseDeclaredDims', () => {
  it.each([
    ['dia 300mm', { x: 300, y: 300, z: 300, kind: 'diameter' }],
    ['dia 600 x 900mm', { x: 600, y: 600, z: 900, kind: 'diameter-height' }],
    ['6000 x 2400 x 450mm', { x: 6000, y: 2400, z: 450, kind: 'box' }],
  ])('reads %s', (label, expected) => {
    expect(parseDeclaredDims(label)).toEqual(expected);
  });

  it('reads a span given in metres', () => {
    expect(parseDeclaredDims('span 24m x 4.5m wide')).toMatchObject({ x: 24000 });
  });

  it('gives up on a label it cannot read, rather than inventing numbers', () => {
    expect(parseDeclaredDims('varies')).toBeNull();
    expect(parseDeclaredDims('')).toBeNull();
  });
});

describe('compareDims', () => {
  const declared = { x: 6000, y: 2400, z: 450, kind: 'box' as const };

  it('accepts a model built to its declared size', () => {
    expect(compareDims(declared, { x: 6000, y: 2400, z: 450 })?.withinTolerance).toBe(true);
  });

  it('accepts the small drift that comes of fillets and chamfers', () => {
    expect(compareDims(declared, { x: 6090, y: 2380, z: 455 })?.withinTolerance).toBe(true);
  });

  it('flags a model built to the wrong size', () => {
    const result = compareDims(declared, { x: 600, y: 2400, z: 450 });

    expect(result?.withinTolerance).toBe(false);
    expect(result?.worstAxis).toBe('x');
  });

  it('matches a diameter against either horizontal axis', () => {
    const round = { x: 300, y: 300, z: 300, kind: 'diameter' as const };

    expect(compareDims(round, { x: 300, y: 300, z: 264 })?.withinTolerance).toBe(true);
  });

  it('allows a model to be built on any horizontal orientation', () => {
    // A 12 x 3 m dock is the same dock whether it was modelled along x or y.
    const dock = { x: 12000, y: 3000, z: 1200, kind: 'box' as const };

    expect(compareDims(dock, { x: 3000, y: 12000, z: 1200 })?.withinTolerance).toBe(true);
  });
});

describe('readGlbWorldBounds', () => {
  /** One mesh, placed twice by nodes that move it apart. */
  const placedTwice = {
    scenes: [{ nodes: [0, 1] }],
    nodes: [
      { mesh: 0, translation: [-0.8, 0, 0] },
      { mesh: 0, translation: [0.8, 0, 0] },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
    accessors: [{ type: 'VEC3', min: [-0.1, -0.1, -0.1], max: [0.1, 0.1, 0.1] }],
  };

  it('measures where parts actually sit, not where they were modelled', () => {
    // The oars are modelled about their own pivot and placed at the gates, so
    // reading accessors alone understates the boat by the whole rigger span.
    expect(readGlbWorldBounds(makeGlb(placedTwice))?.x).toBeCloseTo(1.8, 3);
  });

  it('follows a node through its parent', () => {
    const nested = {
      scenes: [{ nodes: [0] }],
      nodes: [
        { children: [1], translation: [10, 0, 0] },
        { mesh: 0, translation: [1, 0, 0] },
      ],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      accessors: [{ type: 'VEC3', min: [0, 0, 0], max: [1, 1, 1] }],
    };

    const bounds = readGlbWorldBounds(makeGlb(nested));

    expect(bounds?.min?.[0]).toBeCloseTo(11, 3);
  });

  it('applies scale as well as position', () => {
    const scaled = {
      scenes: [{ nodes: [0] }],
      nodes: [{ mesh: 0, scale: [2, 3, 4] }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      accessors: [{ type: 'VEC3', min: [-1, -1, -1], max: [1, 1, 1] }],
    };

    expect(readGlbWorldBounds(makeGlb(scaled))).toMatchObject({ x: 4, y: 6, z: 8 });
  });

  it('measures a named group, geometry hanging off its children included', () => {
    // The exporter names a group ("Hull") and puts the mesh on a "Hull_part"
    // child, so a filter that only looked at the mesh's own node found nothing.
    const grouped = {
      scenes: [{ nodes: [0] }],
      nodes: [
        { name: 'Hull', children: [1] },
        { name: 'Hull_part', mesh: 0 },
      ],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
      accessors: [{ type: 'VEC3', min: [0, 0, 0], max: [8.1, 0.2, 0.28] }],
    };

    expect(readGlbWorldBounds(makeGlb(grouped), (name) => name === 'Hull')?.x).toBeCloseTo(8.1, 2);
  });

  it('falls back to every node when the file names no scene', () => {
    const noScene = { ...placedTwice, scenes: undefined };

    expect(readGlbWorldBounds(makeGlb(noScene))?.x).toBeCloseTo(1.8, 3);
  });
});
