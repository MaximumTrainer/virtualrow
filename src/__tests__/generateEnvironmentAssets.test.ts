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

    expect(glb.length).toBeGreaterThan(1024);
    expect(glb.readUInt32LE(0)).toBe(0x46546c67); // glTF magic
    expect(glb.readUInt32LE(4)).toBe(2); // GLB v2
    expect(glb.readUInt32LE(8)).toBe(glb.length); // Declared length matches actual
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
      expect(result.bytes).toBeGreaterThan(1024);
      expect(fs.existsSync(outputPath)).toBe(true);

      const file = fs.readFileSync(outputPath);
      expect(file.readUInt32LE(0)).toBe(0x46546c67);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
