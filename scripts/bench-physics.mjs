/**
 * Standalone Node.js benchmark for the Wasm physics engine.
 * Run with: node scripts/bench-physics.mjs
 *
 * Target: engine.tick() must complete in < 0.1 ms per call at 60 fps.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dir = dirname(__filename);
const wasmPkg = resolve(__dir, '../src/wasm-pkg');

// Dynamic import of the wasm-bindgen JS glue
const mod = await import(resolve(wasmPkg, 'virtualrow_physics.js'));
const wasmBytes = readFileSync(resolve(wasmPkg, 'virtualrow_physics_bg.wasm'));
mod.initSync({ module: wasmBytes });

const { PhysicsEngine, PhysicsConfig, RowingMetrics } = mod;

// ── helpers ───────────────────────────────────────────────────────────────────

function bench(label, fn, { warmup = 500, time = 2000 } = {}) {
  // Warmup
  const warmupEnd = Date.now() + warmup;
  while (Date.now() < warmupEnd) fn();

  // Measure
  const samples = [];
  const measureEnd = Date.now() + time;
  while (Date.now() < measureEnd) {
    const t0 = performance.now();
    fn();
    samples.push(performance.now() - t0);
  }

  samples.sort((a, b) => a - b);
  const hz = (samples.length / (time / 1000)).toFixed(0);
  const mean = (samples.reduce((s, x) => s + x, 0) / samples.length).toFixed(4);
  const p99 = samples[Math.floor(samples.length * 0.99)].toFixed(4);
  const min = samples[0].toFixed(4);
  const max = samples[samples.length - 1].toFixed(4);

  console.log(`\n📊 ${label}`);
  console.log(`   hz:     ${hz} ops/s`);
  console.log(`   mean:   ${mean} ms`);
  console.log(`   min:    ${min} ms`);
  console.log(`   max:    ${max} ms`);
  console.log(`   p99:    ${p99} ms`);
  console.log(`   samples: ${samples.length}`);

  return { hz: Number(hz), mean: Number(mean), p99: Number(p99) };
}

// ── benchmarks ────────────────────────────────────────────────────────────────

console.log('VirtualRow Physics Engine — Wasm Benchmark');
console.log('Node.js', process.version);
console.log('Target: single tick < 0.1 ms\n');

// Single tick: create engine + tick once (measures full round-trip overhead)
const singleResult = bench('single tick at 200W / 20 SPM (fresh engine)', () => {
  const cfg = new PhysicsConfig();
  const engine = new PhysicsEngine(cfg);
  // cfg ownership transferred to PhysicsEngine
  const metrics = new RowingMetrics(200, 20, 0);
  engine.tick(1 / 60, metrics).free();
  engine.free();
  metrics.free();
});

// Steady-state tick: pre-existing engine, measures pure tick overhead
const cfg2 = new PhysicsConfig();
const engine2 = new PhysicsEngine(cfg2);
// cfg2 ownership transferred
const metrics2 = new RowingMetrics(200, 20, 0);

const steadyResult = bench('single tick on pre-existing engine (steady-state overhead)', () => {
  engine2.tick(1 / 60, metrics2).free();
});

engine2.free();
metrics2.free();

// Batch: 1000 ticks to simulate ~16 s of rowing at 60 fps
const batchResult = bench('1000 ticks at 200W / 20 SPM (simulates ~16 s at 60 fps)', () => {
  const cfg = new PhysicsConfig();
  const engine = new PhysicsEngine(cfg);
  // cfg ownership transferred
  const metrics = new RowingMetrics(200, 20, 0);
  for (let i = 0; i < 1000; i++) engine.tick(1 / 60, metrics).free();
  engine.free();
  metrics.free();
});

// ── assertions ────────────────────────────────────────────────────────────────

console.log('\n── Pass/Fail ─────────────────────────────────────────────────────');
let pass = true;

function check(label, value, limit) {
  const ok = value <= limit;
  console.log(`  ${ok ? '✅' : '❌'} ${label}: ${value.toFixed(4)} ms (limit ${limit} ms)`);
  if (!ok) pass = false;
}

check('steady-state tick mean', steadyResult.mean, 0.1);
check('steady-state tick p99', steadyResult.p99, 0.5);
check('per-tick average in 1000-tick batch', batchResult.mean / 1000, 0.1);

console.log('');
if (pass) {
  console.log('✅ All performance targets met.');
  process.exit(0);
} else {
  console.log('❌ One or more targets missed — review physics engine or Wasm build.');
  process.exit(1);
}
