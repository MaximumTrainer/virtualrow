#!/usr/bin/env node
/**
 * Cross-platform background sim-server launcher.
 * Spawns the sim server detached, writes PID to a temp file for later cleanup.
 * Usage: node scripts/start-sim-bg.mjs
 */
import { spawn } from 'child_process';
import { writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const simPath = new URL('../playwright/simulators/sim-server.cjs', import.meta.url).pathname
  // On Windows the pathname starts with /C:/... — strip leading slash
  .replace(/^\/([A-Za-z]:)/, '$1');

const proc = spawn('node', [simPath], {
  detached: true,
  stdio: 'inherit',
  env: { ...process.env },
});

proc.unref();

const pidFile = join(tmpdir(), 'virtualrow-sim.pid');
writeFileSync(pidFile, String(proc.pid));
console.log(`Sim server started (PID ${proc.pid}), PID saved to ${pidFile}`);
