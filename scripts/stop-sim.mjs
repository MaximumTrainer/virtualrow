#!/usr/bin/env node
/**
 * Cross-platform sim-server cleanup.
 * Reads the PID written by start-sim-bg.mjs and kills the process.
 * Usage: node scripts/stop-sim.mjs
 */
import { readFileSync, unlinkSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const pidFile = join(tmpdir(), 'virtualrow-sim.pid');

try {
  const pid = parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
  if (isNaN(pid)) throw new Error('Invalid PID');

  if (process.platform === 'win32') {
    const { execSync } = await import('child_process');
    try {
      execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
    } catch {
      // Process may have already exited
    }
  } else {
    process.kill(pid, 'SIGKILL');
  }

  console.log(`Stopped sim server (PID ${pid})`);
  unlinkSync(pidFile);
} catch (err) {
  console.warn(`Could not stop sim server: ${err.message}`);
}
