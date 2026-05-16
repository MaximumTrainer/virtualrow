/**
 * Wasm physics engine performance test.
 * Vitest 1.x bench API has a known bug with top-level await (samples=0).
 * Instead we use a regular test with performance.now() timing assertions.
 *
 * For a full throughput report run: node scripts/bench-physics.mjs
 *
 * Target: engine.tick() must complete in < 0.1 ms per call at 60 fps.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dir = dirname(__filename);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let PhysicsEngine: any, PhysicsConfig: any, RowingMetrics: any;

beforeAll(async () => {
  const mod = await import('../wasm-pkg/virtualrow_physics.js');
  const wasmBytes = readFileSync(resolve(__dir, '../wasm-pkg/virtualrow_physics_bg.wasm'));
  mod.initSync({ module: wasmBytes });
  PhysicsEngine = mod.PhysicsEngine;
  PhysicsConfig = mod.PhysicsConfig;
  RowingMetrics = mod.RowingMetrics;
});

describe('PhysicsEngine.tick() performance', () => {
  it('single tick completes in < 0.5 ms (steady-state engine)', () => {
    const cfg = new PhysicsConfig();
    const engine = new PhysicsEngine(cfg);
    // cfg ownership transferred to PhysicsEngine — do not call cfg.free()
    const metrics = new RowingMetrics(200, 20, 0);

    // Warmup
    for (let i = 0; i < 100; i++) engine.tick(1 / 60, metrics).free();

    // Measure 500 ticks
    const t0 = performance.now();
    for (let i = 0; i < 500; i++) engine.tick(1 / 60, metrics).free();
    const elapsed = performance.now() - t0;

    const meanMs = elapsed / 500;
    engine.free();
    metrics.free();

    console.log(`  mean tick time: ${meanMs.toFixed(4)} ms`);
    expect(meanMs).toBeLessThan(0.5);
  });

  it('1000-tick batch completes in < 100 ms (simulates ~16s at 60fps)', () => {
    const cfg = new PhysicsConfig();
    const engine = new PhysicsEngine(cfg);
    // cfg ownership transferred to PhysicsEngine — do not call cfg.free()
    const metrics = new RowingMetrics(200, 20, 0);

    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) engine.tick(1 / 60, metrics).free();
    const elapsed = performance.now() - t0;

    engine.free();
    metrics.free();

    console.log(`  1000-tick batch: ${elapsed.toFixed(2)} ms`);
    expect(elapsed).toBeLessThan(100);
  });
});
