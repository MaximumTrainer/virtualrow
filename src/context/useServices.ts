/**
 * The services context object, its production adapter bundle and the
 * `useServices` hook.
 *
 * Split out of ServicesContext.tsx so that file exports only the provider
 * component: a module mixing components with other exports loses fast refresh
 * for the whole module, so every services change forced a full reload.
 */
import { createContext, useContext } from 'react';
import type { Services } from '../ports';
import { workoutService } from '../services/workoutService';
import { routeService } from '../services/routeService';
import { workoutGeneratorService } from '../services/workoutGeneratorService';
import { bluetoothService } from '../services/bluetoothService';
import { ftmsBluetoothService } from '../services/ftmsBluetoothService';
import { heartRateBluetoothService } from '../services/heartRateBluetoothService';
import { authService } from '../services/authService';
import { rownativeService } from '../services/rownativeService';
import { routeEnrichmentService } from '../services/routeEnrichmentService';

/** Production-adapter bundle wired from the existing service singletons. */
export const defaultServices: Services = {
  workoutService,
  routeService,
  workoutGeneratorService,
  pm5BluetoothService: bluetoothService,
  ftmsBluetoothService,
  heartRateBluetoothService,
  authService,
  rownativeService,
  routeEnrichmentService,
};

export const ServicesContext = createContext<Services>(defaultServices);

/**
 * Resolve the {@link Services} bundle from the nearest `ServicesProvider`.
 * Returns the production defaults if no provider is mounted, which keeps
 * existing tests that don't yet wrap their tree green.
 */
export function useServices(): Services {
  return useContext(ServicesContext);
}
