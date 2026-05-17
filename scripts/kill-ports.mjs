#!/usr/bin/env node
/**
 * Cross-platform port cleanup utility.
 * Usage: node scripts/kill-ports.mjs 9001 9002
 *
 * On Windows: uses netstat + taskkill
 * On Unix:    uses lsof + kill
 */
import { execSync } from 'child_process';

const ports = process.argv.slice(2).map(Number).filter(Boolean);
if (ports.length === 0) {
  console.log('Usage: node scripts/kill-ports.mjs <port> [port...]');
  process.exit(0);
}

for (const port of ports) {
  try {
    if (process.platform === 'win32') {
      let output = '';
      try {
        output = execSync(`netstat -ano`, { encoding: 'utf8' });
      } catch {
        continue;
      }
      const pids = new Set(
        output
          .split('\n')
          .filter((l) => l.includes(`:${port} `) || l.includes(`:${port}\t`))
          .map((l) => l.trim().split(/\s+/).pop())
          .filter((p) => p && /^\d+$/.test(p) && p !== '0'),
      );
      for (const pid of pids) {
        try {
          execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
          console.log(`Killed PID ${pid} on port ${port}`);
        } catch {
          // Process may have already exited
        }
      }
    } else {
      execSync(`lsof -ti :${port} | xargs -r kill -9 2>/dev/null || true`, { shell: true, stdio: 'inherit' });
      console.log(`Cleaned up port ${port}`);
    }
  } catch {
    // Non-fatal — port may already be free
  }
}
