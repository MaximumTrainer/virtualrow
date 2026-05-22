/**
 * React composition root for application services.
 *
 * Following the architecture rules in `agents.md`, components should depend on
 * the {@link Services} *port* interface rather than directly importing the
 * concrete `*Service` singletons. The `ServicesProvider` below is mounted
 * once (in `main.tsx`) with the production adapters, and tests/stories can
 * mount a different provider with stub adapters to inject behaviour.
 *
 * Direct singleton imports remain for now to keep the refactor surgical; new
 * code should prefer `useServices()`.
 */
import { createContext, useContext, type ReactNode } from 'react';
import type { Services } from '../ports';
import { workoutService } from '../services/workoutService';
import { routeService } from '../services/routeService';
import { workoutGeneratorService } from '../services/workoutGeneratorService';
import { bluetoothService } from '../services/bluetoothService';
import { ftmsBluetoothService } from '../services/ftmsBluetoothService';
import { heartRateBluetoothService } from '../services/heartRateBluetoothService';

/** Production-adapter bundle wired from the existing service singletons. */
export const defaultServices: Services = {
  workoutService,
  routeService,
  workoutGeneratorService,
  pm5BluetoothService: bluetoothService,
  ftmsBluetoothService,
  heartRateBluetoothService,
};

const ServicesContext = createContext<Services>(defaultServices);

export interface ServicesProviderProps {
  /**
   * Optional override bundle. Anything you omit is filled from
   * {@link defaultServices}, so tests can stub a single port without having
   * to construct the others.
   */
  services?: Partial<Services>;
  children: ReactNode;
}

/**
 * Mount once at the root of the React tree (see `main.tsx`). All descendants
 * can then resolve services via {@link useServices}.
 */
export function ServicesProvider({ services, children }: ServicesProviderProps) {
  const value: Services = services
    ? { ...defaultServices, ...services }
    : defaultServices;
  return (
    <ServicesContext.Provider value={value}>{children}</ServicesContext.Provider>
  );
}

/**
 * Resolve the {@link Services} bundle from the nearest `ServicesProvider`.
 * Returns the production defaults if no provider is mounted, which keeps
 * existing tests that don't yet wrap their tree green.
 */
export function useServices(): Services {
  return useContext(ServicesContext);
}
