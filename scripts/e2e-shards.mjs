#!/usr/bin/env node
/**
 * Run one CI shard of the E2E suite, with the suite split by measured time.
 *
 *   node scripts/e2e-shards.mjs 3/12 [extra playwright args]
 *
 * Playwright's own `--shard` cuts the suite into runs of equal test *count*,
 * in file order. Counts are not costs: `rower-slide.spec.ts` is one test that
 * rows a boat for seven minutes on Windows, and the heavy 3D specs sort next
 * to each other, so they shared a shard - 1,994 s of tests on Windows shard 3
 * against an 18 minute limit, while shard 12 ran 59 s.
 *
 * So the unit here is a (project, spec file) pair - only `responsive.spec.ts`
 * runs under more than one project - weighed by `playwright/shard-weights.json`
 * and packed greedily, heaviest first, into whichever shard is lightest. The
 * plan depends only on the listing and the weights, so every runner computes
 * the same one and each unit runs exactly once.
 */
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Seconds assumed for a spec with no measurement yet: about a median unit. */
export const DEFAULT_UNIT_SECONDS = 60;

const CONFIG = 'playwright/playwright.config.ci.ts';
const WEIGHTS = 'playwright/shard-weights.json';
const CLI = 'node_modules/@playwright/test/cli.js';

const keyOf = (unit) => `${unit.project}:${unit.file}`;

/** One unit per (project, file) in a `--list --reporter=json` listing. */
export function unitsFromListing(listing) {
  const seen = new Map();
  const walk = (suite, file) => {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        const unit = { project: test.projectName, file };
        seen.set(keyOf(unit), unit);
      }
    }
    for (const child of suite.suites ?? []) walk(child, file);
  };
  for (const fileSuite of listing.suites ?? []) walk(fileSuite, fileSuite.file);
  return [...seen.values()];
}

/**
 * Pack units into `total` shards, heaviest first into the lightest shard.
 *
 * Ties break on the unit's name and the shard's index, so the plan does not
 * depend on the order the listing arrived in.
 */
export function planShards(units, weights, total) {
  const weighed = units
    .map((unit) => ({ unit, seconds: weights[keyOf(unit)] ?? DEFAULT_UNIT_SECONDS }))
    .sort((a, b) => b.seconds - a.seconds || keyOf(a.unit).localeCompare(keyOf(b.unit)));

  const shards = Array.from({ length: total }, () => ({ units: [], seconds: 0 }));
  for (const { unit, seconds } of weighed) {
    let lightest = 0;
    for (let i = 1; i < total; i += 1) {
      if (shards[i].seconds < shards[lightest].seconds) lightest = i;
    }
    shards[lightest].units.push(unit);
    shards[lightest].seconds += seconds;
  }
  return shards;
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Playwright arguments that select exactly one shard's units.
 *
 * A file argument is a regular expression tested against the absolute path,
 * so each is anchored at a path separator - `route-performance.spec.ts` is a
 * substring of `default-route-performance.spec.ts` - and accepts either
 * separator, because on Windows the path has backslashes. Projects and files
 * combine as a cross product, which is exact here: only `responsive.spec.ts`
 * belongs to more than one project, and the default project ignores it.
 */
export function shardArguments(shard) {
  const projects = [...new Set(shard.units.map((u) => u.project))].sort();
  const files = [...new Set(shard.units.map((u) => u.file))].sort();
  return [
    ...projects.map((p) => `--project=${p}`),
    ...files.map((f) => `/[\\\\/]${escapeRegExp(f)}$/`),
  ];
}

const playwright = (args, options = {}) =>
  spawnSync(process.execPath, [CLI, 'test', `--config=${CONFIG}`, ...args], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });

function main() {
  const [spec, ...passThrough] = process.argv.slice(2);
  const match = /^(\d+)\/(\d+)$/.exec(spec ?? '');
  if (!match) {
    console.error('usage: node scripts/e2e-shards.mjs <current>/<total> [playwright args]');
    process.exit(2);
  }
  const [current, total] = [Number(match[1]), Number(match[2])];

  const listed = playwright(['--list', '--reporter=json']);
  if (listed.status !== 0) {
    process.stderr.write(listed.stderr);
    process.exit(listed.status ?? 1);
  }
  const weights = JSON.parse(readFileSync(WEIGHTS, 'utf8')).seconds;
  const shards = planShards(unitsFromListing(JSON.parse(listed.stdout)), weights, total);

  console.log(`E2E shards by measured time (${WEIGHTS}):`);
  shards.forEach((s, i) => {
    const mark = i + 1 === current ? '>' : ' ';
    console.log(`${mark} ${String(i + 1).padStart(2)}: ~${Math.round(s.seconds)} s, ${s.units.map(keyOf).join(', ')}`);
  });

  const mine = shards[current - 1];
  if (!mine || mine.units.length === 0) {
    console.log(`Shard ${current}/${total} has nothing to run.`);
    return;
  }
  const run = playwright([...shardArguments(mine), ...passThrough], { stdio: 'inherit' });
  process.exit(run.status ?? 1);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
