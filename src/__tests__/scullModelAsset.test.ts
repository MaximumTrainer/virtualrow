/// <reference types="node" />

import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

type ScullNode = {
  name?: string;
  matrix?: number[];
};

type ScullMaterial = {
  name?: string;
  pbrMetallicRoughness?: {
    metallicFactor?: number;
    roughnessFactor?: number;
  };
};

type ScullGltf = {
  nodes?: ScullNode[];
  materials?: ScullMaterial[];
};

function parseGlbJson(glb: Buffer): ScullGltf {
  const magic = glb.readUInt32LE(0);
  const version = glb.readUInt32LE(4);
  const length = glb.readUInt32LE(8);

  expect(magic).toBe(0x46546c67);
  expect(version).toBe(2);
  expect(length).toBe(glb.length);

  const jsonChunkLength = glb.readUInt32LE(12);
  const jsonChunkType = glb.readUInt32LE(16);
  expect(jsonChunkType).toBe(0x4e4f534a);

  // GLB JSON data starts after 12-byte header + 8-byte first chunk header.
  const jsonStartOffset = 20;
  const jsonChunkRaw = glb.subarray(jsonStartOffset, jsonStartOffset + jsonChunkLength);
  let jsonEndOffset = jsonChunkRaw.length;
  while (jsonEndOffset > 0 && jsonChunkRaw[jsonEndOffset - 1] === 0) {
    jsonEndOffset -= 1;
  }
  const jsonRaw = jsonChunkRaw.subarray(0, jsonEndOffset).toString('utf8');
  return JSON.parse(jsonRaw) as ScullGltf;
}

describe('generated scull model asset', () => {
  it('contains expected single scull structure and mirrored oars', () => {
    const modelPath = path.join(process.cwd(), 'public/models/scull.glb');
    const glb = fs.readFileSync(modelPath);
    const gltf = parseGlbJson(glb);

    const nodeNames = new Set(
      (gltf.nodes ?? [])
        .filter((node) => Boolean(node.name))
        .map((node) => node.name)
    );
    [
      'ScullBoatGroup',
      'Hull',
      'Rower',
      'Seat',
      'LeftOar',
      'RightOar',
      'Riggers',
      'RailsNode',
      'FootStretcherNode',
      'FinNode',
      'BowBallNode',
    ].forEach((name) => expect(nodeNames.has(name)).toBe(true));

    const leftOar = (gltf.nodes ?? []).find((node) => node.name === 'LeftOar');
    const rightOar = (gltf.nodes ?? []).find((node) => node.name === 'RightOar');
    const leftX = leftOar?.matrix?.[12];
    const rightX = rightOar?.matrix?.[12];

    // matrix[12] holds X translation in a 4x4 node transform matrix.
    expect(leftX).toBeDefined();
    expect(rightX).toBeDefined();
    expect(leftX!).toBeLessThan(0);
    expect(rightX!).toBeGreaterThan(0);
    expect(Math.abs(leftX!)).toBeCloseTo(Math.abs(rightX!), 6);
  });

  it('uses PBR factors aligned to hull/riggers/oars/rower material intent', () => {
    const modelPath = path.join(process.cwd(), 'public/models/scull.glb');
    const glb = fs.readFileSync(modelPath);
    const gltf = parseGlbJson(glb);

    const materialByName = new Map(
      (gltf.materials ?? []).map((material) => [material.name, material] as const)
    );

    const hull = materialByName.get('HullMaterial');
    const riggers = materialByName.get('RiggerMaterial');
    const oars = materialByName.get('OarMaterial');
    const rower = materialByName.get('RowerMaterial');

    expect(hull?.pbrMetallicRoughness?.roughnessFactor).toBeLessThanOrEqual(0.2);
    expect(riggers?.pbrMetallicRoughness?.metallicFactor).toBeGreaterThanOrEqual(0.8);
    expect(oars?.pbrMetallicRoughness?.roughnessFactor).toBeGreaterThanOrEqual(0.75);
    expect(rower?.pbrMetallicRoughness?.roughnessFactor).toBeGreaterThanOrEqual(0.8);
  });
});
