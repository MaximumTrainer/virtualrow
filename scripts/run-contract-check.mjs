// ============================================================================
// Run the live mirror contract check.
//
// The contract test is opt-in behind ROWNATIVE_CONTRACT_CHECK=1 because it
// talks to the network, and its own comment says to run it "e.g. on a
// schedule" — but nothing ran it at all, so #208's AC-3 had no way to fire.
// A node runner rather than an inline env assignment in the npm script: those
// are shell-specific and this repo is developed on Windows as well as CI.
// ============================================================================

import { spawn } from 'node:child_process';

const child = spawn(
  'npx',
  ['vitest', 'run', 'src/__tests__/rownativeMirrorContract.test.ts'],
  {
    stdio: 'inherit',
    // shell: true so this resolves npx on Windows as well as POSIX without
    // hard-coding npx.cmd, which node refuses to spawn directly.
    shell: true,
    env: { ...process.env, ROWNATIVE_CONTRACT_CHECK: '1' },
  },
);

child.on('exit', (code) => process.exit(code ?? 1));
