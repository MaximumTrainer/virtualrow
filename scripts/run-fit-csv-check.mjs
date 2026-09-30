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
const FIXTURE = resolve(HERE, '..', 'src/__tests__/__fixtures__/sample-session.fit');
const OUT = resolve(HERE, '..', 'tools/sample-session');

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

const result = spawnSync('java', ['-jar', JAR, '-b', FIXTURE, OUT], {
  encoding: 'utf8',
});

const combined = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
const offending = combined.split(/\r?\n/).filter((line) => /\b(WARNING|ERROR)\b/.test(line));
if (result.status !== 0 || offending.length > 0) {
  console.error('FIT structural gate failed:');
  if (result.status !== 0) console.error(`  exit code: ${result.status}`);
  for (const line of offending) console.error(`  ${line}`);
  process.exit(1);
}

console.log('FIT structural gate passed');
