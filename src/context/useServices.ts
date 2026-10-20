/**
 * The services context object, its production adapter bundle and the
 * `useServices` hook.
 *
 * Split out of ServicesContext.tsx so that file exports only the provider
 * component: a module mixing components with other exports loses fast refresh
 * for the whole module, so every services change forced a full reload.
 */
import { createContext, useContext } from 'react';
import type { Services } from '../lib/ports';
import { workoutService } from '../lib/services/workoutService';
import { routeService } from '../lib/services/routeService';
import { bluetoothService } from '../lib/services/bluetoothService';
import { ftmsBluetoothService } from '../lib/services/ftmsBluetoothService';
import { heartRateBluetoothService } from '../lib/services/heartRateBluetoothService';
import { authService } from '../lib/services/authService';
import { rownativeService } from '../lib/services/rownativeService';
import { routeEnrichmentService } from '../lib/services/routeEnrichmentService';
import { defaultRoutePreferenceStore } from '../lib/services/defaultRoutePreferenceStore';
import { intervalsIcuActivityService } from '../lib/services/intervalsIcuActivityService';
import { intervalsIcuWorkoutService } from '../lib/services/intervalsIcuWorkoutService';
import { simulatorRowerTargetService } from '../lib/services/simulatorRowerTargetService';
import { ftmsRowerTargetService } from '../lib/services/ftmsRowerTargetService';
import { pm5RowerTargetService } from '../lib/services/pm5RowerTargetService';
import { audioService } from '../lib/services/audioService';
import { crashReporterService } from '../lib/services/crashReporterService';
import { crashReportsPreferenceStore } from '../lib/services/crashReportsPreferenceStore';
import type { RowerTargetPort } from '../lib/ports';

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
  crashReporterService,
  crashReportsPreferenceStore,
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
