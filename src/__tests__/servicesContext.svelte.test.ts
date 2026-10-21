import { render } from '@testing-library/svelte';
import { describe, it, expect } from 'vitest';

import ServicesProbe from './fixtures/ServicesProbe.svelte';
import { defaultServices } from '../lib/ui/services';
import type { Services } from '../lib/ports';

// #542 P1 (F2): the Svelte services context replacing React's ServicesContext.
describe('services context', () => {
  it('resolves the production defaults when provided with no overrides', () => {
    let resolved: Services | undefined;
    render(ServicesProbe, { report: (s: Services) => (resolved = s) });
    expect(resolved).toBe(defaultServices);
  });

  it('falls back to the production defaults when no provider is mounted', () => {
    let resolved: Services | undefined;
    render(ServicesProbe, { skipSet: true, report: (s: Services) => (resolved = s) });
    expect(resolved).toBe(defaultServices);
  });

  it('merges a partial override over the defaults', () => {
    const fakeAuth = { label: 'stub-auth' } as unknown as Services['authService'];
    let resolved: Services | undefined;
    render(ServicesProbe, {
      overrides: { authService: fakeAuth },
      report: (s: Services) => (resolved = s),
    });
    // The stubbed port is used; everything else stays the production singleton.
    expect(resolved?.authService).toBe(fakeAuth);
    expect(resolved?.workoutService).toBe(defaultServices.workoutService);
  });
});
