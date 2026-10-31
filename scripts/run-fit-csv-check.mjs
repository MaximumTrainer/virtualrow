// ============================================================================
// Optional FIT structural gate via Garmin's FitCSVTool (issue #446, FR4).
//
// FitCSVTool is the reference validator intervals.icu's own docs point at.
// It's a Java JAR shipped inside the FIT SDK ZIP; the licence keeps it out of
// this repo (see D5(a)), so `tools/FitCSVTool.jar` is `.gitignore`d.
//
// Skipped when either `java` or the JAR is missing (a fresh checkout has
// neither). Fails on any `WARNING` or `ERROR` line the tool prints — those
// are the structural issues Garmin's own JS `Decoder` tolerates and
// intervals.icu's importer does not.
// ============================================================================

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const JAR = resolve(HERE, '..', 'tools/FitCSVTool.jar');

/**
 * Every checked-in `.fit` fixture is run through FitCSVTool. #466 AC10 adds
 * `loop-route` (a closed loop rowed for 1.5× its length, where the sampler
 * wraps modulo the loop length) and `gate-chain` (a two-vertex polyline, the
 * shape a rownative gate-chain route produces) alongside the realistic
 * `sample-session` fixture, so a change to the encoder that passes the
 * common-case shape but breaks either edge case fails here too.
 */
const FIXTURES = [
  { name: 'sample-session', path: resolve(HERE, '..', 'src/__tests__/__fixtures__/sample-session.fit') },
  { name: 'loop-route', path: resolve(HERE, '..', 'src/__tests__/__fixtures__/loop-route.fit') },
  { name: 'gate-chain', path: resolve(HERE, '..', 'src/__tests__/__fixtures__/gate-chain.fit') },
];

function hasJava() {
  try {
    execFileSync('java', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

if (!existsSync(JAR)) {
  console.log('skipped: place FitCSVTool.jar under tools/ to enable');
  process.exit(0);
}
if (!hasJava()) {
  console.log('skipped: java is not on PATH');
  process.exit(0);
}

let failed = false;
for (const { name, path } of FIXTURES) {
  const out = resolve(HERE, '..', `tools/${name}`);
  const result = spawnSync('java', ['-jar', JAR, '-b', path, out], { encoding: 'utf8' });
  const combined = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  const offending = combined.split(/\r?\n/).filter((line) => /\b(WARNING|ERROR)\b/.test(line));
  if (result.status !== 0 || offending.length > 0) {
    console.error(`FIT structural gate failed for ${name}:`);
    if (result.status !== 0) console.error(`  exit code: ${result.status}`);
    for (const line of offending) console.error(`  ${line}`);
    failed = true;
  } else {
    console.log(`FIT structural gate passed for ${name}`);
  }
}

process.exit(failed ? 1 : 0);
