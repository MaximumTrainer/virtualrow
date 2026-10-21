import { render, screen } from '@testing-library/svelte';
import { describe, it, expect } from 'vitest';

import Probe from './fixtures/RoutesContextProbe.svelte';
import { RoutesStore } from '../lib/ui/routesStore.svelte';
import type { Services } from '../lib/ports';

const services = {
  routeService: { getAllRoutes: () => [] },
  routeEnrichmentService: { readCached: () => ({ data: null, stale: false }), enrichRoute: async () => ({}) },
  defaultRoutePreferenceStore: {
    resolveDefaultRouteId: () => null,
    setDefaultRouteId: () => {},
    clearDefaultRouteId: () => {},
  },
} as unknown as Services;

// #542 P1 Routes screen: the RoutesStore Svelte context provider/consumer.
describe('routesContext', () => {
  it('provides a RoutesStore the subtree can read back', () => {
    const store = new RoutesStore(services);
    store.difficultyFilter = 'hard';
    render(Probe, { store, provide: true });
    expect(screen.getByTestId('resolved-filter').textContent).toBe('hard');
  });

  it('throws when no RoutesStore is provided', () => {
    expect(() => render(Probe, { provide: false })).toThrow(/no RoutesStore in context/);
  });
});
