import { render, screen } from '@testing-library/svelte';
import { describe, it, expect } from 'vitest';

import Probe from './fixtures/RideSessionContextProbe.svelte';
import { RideSessionStore } from '../lib/ui/rideSession.svelte';
import type { RideSessionSession, RideSessionRoutes } from '../lib/ui/rideSession.svelte';

const session = {} as unknown as RideSessionSession;
const routes: RideSessionRoutes = { selectedRoute: null };

// #542 workout slice: the RideSessionStore Svelte context.
describe('rideSessionContext', () => {
  it('provides a RideSessionStore the subtree can read back', () => {
    const store = new RideSessionStore(session, routes);
    store.activityElapsedMs = 42;
    render(Probe, { store, provide: true });
    expect(screen.getByTestId('resolved-elapsed').textContent).toBe('42');
  });

  it('throws when no RideSessionStore is provided', () => {
    expect(() => render(Probe, { provide: false })).toThrow(/no RideSessionStore in context/);
  });
});
