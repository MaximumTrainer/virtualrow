import { describe, it, expect, vi } from 'vitest';
import { render } from '@testing-library/react';
import { ServicesProvider, useServices, defaultServices } from '../context/ServicesContext';
import type { Services } from '../ports';

function Probe({ onResolve }: { onResolve: (s: Services) => void }) {
  const services = useServices();
  onResolve(services);
  return null;
}

describe('ServicesProvider / useServices', () => {
  it('returns the production default services when no override is provided', () => {
    let resolved: Services | null = null;
    render(
      <ServicesProvider>
        <Probe onResolve={(s) => { resolved = s; }} />
      </ServicesProvider>,
    );
    expect(resolved).not.toBeNull();
    expect(resolved!.workoutService).toBe(defaultServices.workoutService);
    expect(resolved!.routeService).toBe(defaultServices.routeService);
    expect(resolved!.pm5BluetoothService).toBe(defaultServices.pm5BluetoothService);
    expect(resolved!.rownativeService).toBe(defaultServices.rownativeService);
  });

  it('falls back to defaultServices when no provider is mounted (so legacy tests still work)', () => {
    let resolved: Services | null = null;
    render(<Probe onResolve={(s) => { resolved = s; }} />);
    expect(resolved).not.toBeNull();
    expect(resolved!.workoutService).toBe(defaultServices.workoutService);
  });

  it('lets callers override individual ports while inheriting the rest', () => {
    const stubWorkout = { __stub: true } as unknown as Services['workoutService'];
    let resolved: Services | null = null;
    render(
      <ServicesProvider services={{ workoutService: stubWorkout }}>
        <Probe onResolve={(s) => { resolved = s; }} />
      </ServicesProvider>,
    );
    expect(resolved!.workoutService).toBe(stubWorkout);
    // Non-overridden ports keep production defaults.
    expect(resolved!.routeService).toBe(defaultServices.routeService);
    expect(resolved!.heartRateBluetoothService).toBe(defaultServices.heartRateBluetoothService);
  });

  it('accepts a plain-object stub for the route enrichment port', () => {
    // The port is a method surface, not a class alias, so this literal must
    // type-check without a cast — that is what lets app tests stub enrichment
    // without module mocking.
    const routeEnrichmentService: Services['routeEnrichmentService'] = {
      enrichRoute: vi.fn(),
      readCached: vi.fn(() => ({ data: null, stale: false })),
      clearCache: vi.fn(),
      clearAllCache: vi.fn(),
    };
    let resolved: Services | null = null;
    render(
      <ServicesProvider services={{ routeEnrichmentService }}>
        <Probe onResolve={(s) => { resolved = s; }} />
      </ServicesProvider>,
    );
    expect(resolved!.routeEnrichmentService).toBe(routeEnrichmentService);
    expect(resolved!.routeService).toBe(defaultServices.routeService);
  });

  it('exposes all expected ports on the Services bundle', () => {
    const expected: Array<keyof Services> = [
      'workoutService',
      'routeService',
      'workoutGeneratorService',
      'pm5BluetoothService',
      'ftmsBluetoothService',
      'heartRateBluetoothService',
      'authService',
      'rownativeService',
      'routeEnrichmentService',
    ];
    for (const key of expected) {
      expect(defaultServices[key]).toBeDefined();
    }
  });
});
