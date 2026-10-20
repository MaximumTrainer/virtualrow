import { describe, it, expect } from 'vitest';

import { defaultServices, pickRowerTargets } from '../lib/ui/services';
import { simulatorRowerTargetService } from '../lib/services/simulatorRowerTargetService';
import { ftmsRowerTargetService } from '../lib/services/ftmsRowerTargetService';
import { pm5RowerTargetService } from '../lib/services/pm5RowerTargetService';

// #542 P1 (F2): the production services bundle and the rower-target picker,
// lifted framework-free out of the old React `useServices.ts`. The Svelte
// shell consumes these through the services context.
describe('services bundle', () => {
  it('wires every port in the Services bundle', () => {
    // The bundle must be complete: a missing port would surface as an
    // undefined service deep in a screen, not here.
    for (const [name, service] of Object.entries(defaultServices)) {
      expect(service, `${name} should be wired`).toBeDefined();
    }
    // The simulator is the active rower-target source (FTMS/PM5 are stubs).
    expect(defaultServices.rowerTargets).toBe(simulatorRowerTargetService);
  });
});

describe('pickRowerTargets', () => {
  it('maps each rower source to its target service', () => {
    expect(pickRowerTargets('simulator')).toBe(simulatorRowerTargetService);
    expect(pickRowerTargets('ftms')).toBe(ftmsRowerTargetService);
    expect(pickRowerTargets('pm5')).toBe(pm5RowerTargetService);
  });
});
