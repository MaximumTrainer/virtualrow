import fs from 'fs';
import os from 'os';
import path from 'path';
import { createRequire } from 'module';
import { describe, it, expect } from 'vitest';

const require = createRequire(import.meta.url);
const api = require('../../scripts/generate-environment-assets.cjs') as {
  createEnvironmentGLB: () => Buffer;
  align4: (value: number) => number;
  writeEnvironmentGLB: (outputPath?: string) => { outputPath: string; bytes: number };
};

describe('generate-environment-assets script', () => {
  it('produces a valid GLB header and non-empty payload', () => {
    const glb = api.createEnvironmentGLB();

    // Header structural invariants
    expect(glb.readUInt32LE(0)).toBe(0x46546c67); // glTF magic
    expect(glb.readUInt32LE(4)).toBe(2); // GLB v2
    expect(glb.readUInt32LE(8)).toBe(glb.length); // Declared total length matches actual buffer length

    // JSON chunk (offset 12): non-zero length, 4-byte aligned, correct type
    const jsonChunkLength = glb.readUInt32LE(12);
    expect(jsonChunkLength).toBeGreaterThan(0);
    expect(jsonChunkLength % 4).toBe(0);
    expect(glb.readUInt32LE(16)).toBe(0x4e4f534a); // 'JSON'

    // BIN chunk (immediately after JSON chunk header + data): non-zero length, 4-byte aligned, correct type
    const binOffset = 20 + jsonChunkLength;
    const binChunkLength = glb.readUInt32LE(binOffset);
    expect(binChunkLength).toBeGreaterThan(0);
    expect(binChunkLength % 4).toBe(0);
    expect(glb.readUInt32LE(binOffset + 4)).toBe(0x004e4942); // 'BIN\0'

    // Total declared length matches sum of header + JSON chunk header + JSON data + BIN chunk header + BIN data
    expect(12 + 8 + jsonChunkLength + 8 + binChunkLength).toBe(glb.length);
  });

  it('align4 returns values aligned to 4-byte boundaries', () => {
    expect(api.align4(0)).toBe(0);
    expect(api.align4(1)).toBe(4);
    expect(api.align4(4)).toBe(4);
    expect(api.align4(5)).toBe(8);
    expect(api.align4(1025)).toBe(1028);
  });

  it('writes the GLB file to a requested output path', () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'virtualrow-env-assets-'));
    const outputPath = path.join(tempDir, 'virtualrow-environment.glb');
    try {
      const result = api.writeEnvironmentGLB(outputPath);

      expect(result.outputPath).toBe(outputPath);
      expect(fs.existsSync(outputPath)).toBe(true);

      const file = fs.readFileSync(outputPath);
      // Reported byte count must match the actual file size on disk
      expect(result.bytes).toBe(file.length);
      // Written file must have a valid GLB structure
      expect(file.readUInt32LE(0)).toBe(0x46546c67); // glTF magic
      expect(file.readUInt32LE(4)).toBe(2); // GLB v2
      expect(file.readUInt32LE(8)).toBe(file.length); // Declared length matches file size
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
