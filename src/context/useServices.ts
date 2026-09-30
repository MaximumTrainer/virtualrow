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
import { bluetoothService } from '../services/bluetoothService';
import { ftmsBluetoothService } from '../services/ftmsBluetoothService';
import { heartRateBluetoothService } from '../services/heartRateBluetoothService';
import { authService } from '../services/authService';
import { rownativeService } from '../services/rownativeService';
import { routeEnrichmentService } from '../services/routeEnrichmentService';
import { defaultRoutePreferenceStore } from '../services/defaultRoutePreferenceStore';
import { intervalsIcuActivityService } from '../services/intervalsIcuActivityService';
import { intervalsIcuWorkoutService } from '../services/intervalsIcuWorkoutService';
import { simulatorRowerTargetService } from '../services/simulatorRowerTargetService';
import { ftmsRowerTargetService } from '../services/ftmsRowerTargetService';
import { pm5RowerTargetService } from '../services/pm5RowerTargetService';
import { audioService } from '../services/audioService';
import type { RowerTargetPort } from '../ports';

/**
 * Pick the {@link RowerTargetPort} implementation to use for a given rower
 * source (issue #445). FTMS + PM5 are stubs today (D3(a) / NFR5); the
 * simulator is the only source that actually acts on prescribed targets. The
 * App composes this each render and installs it via a scoped
 * `ServicesProvider` when a real erg is connected.
 */
export function pickRowerTargets(source: 'simulator' | 'ftms' | 'pm5'): RowerTargetPort {
  if (source === 'ftms') return ftmsRowerTargetService;
  if (source === 'pm5') return pm5RowerTargetService;
  return simulatorRowerTargetService;
}

/** Production-adapter bundle wired from the existing service singletons. */
export const defaultServices: Services = {
  workoutService,
  routeService,
  pm5BluetoothService: bluetoothService,
  ftmsBluetoothService,
  heartRateBluetoothService,
  authService,
  rownativeService,
  routeEnrichmentService,
  defaultRoutePreferenceStore,
  intervalsIcuActivityService,
  intervalsIcuWorkoutService,
  rowerTargets: simulatorRowerTargetService,
  audioService,
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
