/**
 * The production services bundle and the rower-target picker.
 *
 * Framework-free: this is the same wiring that `src/context/useServices.ts`
 * held for the React app, lifted out so it can be shared by the Svelte shell
 * (#542 P1). Components depend on the {@link Services} *port* interface and
 * resolve the bundle through the Svelte services context (`servicesContext`),
 * never by importing the concrete `*Service` singletons directly — the same
 * rule `agents.md` sets for the React tree.
 */
import type { Services, RowerTargetPort } from '../ports';
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
import { crashReporterService } from '../services/crashReporterService';
import { crashReportsPreferenceStore } from '../services/crashReportsPreferenceStore';

/**
 * Pick the {@link RowerTargetPort} implementation for a given rower source
 * (issue #445). FTMS + PM5 are stubs today (D3(a) / NFR5); the simulator is
 * the only source that acts on prescribed targets. The shell composes this
 * and installs it via a scoped services context when a real erg is connected.
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
