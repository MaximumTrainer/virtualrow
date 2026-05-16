import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function parseGlbJson(glb: Buffer) {
  const magic = glb.readUInt32LE(0);
  const version = glb.readUInt32LE(4);
  const length = glb.readUInt32LE(8);

  expect(magic).toBe(0x46546c67);
  expect(version).toBe(2);
  expect(length).toBe(glb.length);

  const jsonChunkLength = glb.readUInt32LE(12);
  const jsonChunkType = glb.readUInt32LE(16);
  expect(jsonChunkType).toBe(0x4e4f534a);

  const jsonRaw = glb.subarray(20, 20 + jsonChunkLength).toString('utf8').replaceAll('\0', '').trimEnd();
  return JSON.parse(jsonRaw);
}

describe('generated scull model asset', () => {
  it('contains expected single scull structure and mirrored oars', () => {
    const modelPath = path.join(process.cwd(), 'public/models/scull.glb');
    const glb = fs.readFileSync(modelPath);
    const gltf = parseGlbJson(glb);

    const nodeNames = new Set((gltf.nodes ?? []).map((node: { name?: string }) => node.name));
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

    const leftOar = (gltf.nodes ?? []).find((node: { name?: string }) => node.name === 'LeftOar');
    const rightOar = (gltf.nodes ?? []).find((node: { name?: string }) => node.name === 'RightOar');

    expect(leftOar?.matrix?.[12]).toBeLessThan(0);
    expect(rightOar?.matrix?.[12]).toBeGreaterThan(0);
    expect(Math.abs(leftOar?.matrix?.[12])).toBeCloseTo(Math.abs(rightOar?.matrix?.[12]), 6);
  });

  it('uses PBR factors aligned to hull/riggers/oars/rower material intent', () => {
    const modelPath = path.join(process.cwd(), 'public/models/scull.glb');
    const glb = fs.readFileSync(modelPath);
    const gltf = parseGlbJson(glb);

    const materialByName = new Map(
      (gltf.materials ?? []).map((material: { name?: string; pbrMetallicRoughness?: { metallicFactor?: number; roughnessFactor?: number } }) => [material.name, material])
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
