import { render, screen } from '@testing-library/svelte';
import { describe, it, expect } from 'vitest';

import SessionProbe from './fixtures/SessionContextProbe.svelte';
import DeepLinkProbe from './fixtures/DeepLinkContextProbe.svelte';
import { SessionStore } from '../lib/ui/sessionStore.svelte';
import { RownativeDeepLinkRunner } from '../lib/ui/deepLink.svelte';
import type { Services } from '../lib/ports';

const audioDeps = {
  audioService: {
    getVolume: () => 0.5,
    setVolume: () => {},
    enable: async () => {},
    disable: async () => {},
  },
} as never;

const services = {
  rownativeService: { importCourseById: async () => ({}) },
  routeService: { findRouteByRownativeId: () => undefined },
} as unknown as Services;

// #542 P1 Row screen: the SessionStore and deep-link Svelte contexts.
describe('sessionContext', () => {
  it('provides a SessionStore the subtree can read back', () => {
    const store = new SessionStore(audioDeps);
    store.setActiveRowerType('ftms');
    render(SessionProbe, { store, provide: true });
    expect(screen.getByTestId('resolved-rower').textContent).toBe('ftms');
  });

  it('throws when no SessionStore is provided', () => {
    expect(() => render(SessionProbe, { provide: false })).toThrow(/no SessionStore in context/);
  });
});

describe('deepLinkContext', () => {
  it('provides a deep-link runner the subtree can read back', () => {
    const runner = new RownativeDeepLinkRunner(services);
    render(DeepLinkProbe, { runner, provide: true });
    expect(screen.getByTestId('resolved-status').textContent).toBe('idle');
  });

  it('throws when no runner is provided', () => {
    expect(() => render(DeepLinkProbe, { provide: false })).toThrow(
      /no RownativeDeepLinkRunner in context/,
    );
  });
});
