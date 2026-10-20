// ============================================================================
// HOW MUCH OF THE WAIT IS DONE
//
// Between picking a route and rowing it, the stage showed one line of static
// text — "Loading 3D view…" — dismissed the moment the lazily-loaded scene
// *chunk* resolved. Measured on the demo route, built app, software rasteriser:
//
//   0 ms      the message appears, Rower3D chunk requested
//   ~690 ms   the chunk arrives (1,145 kB) — and the message goes
//   ~1,294 ms the route geometry is ready
//   ~1,335 ms the first frame is drawn
//   ~3,247 ms scull-male.glb finishes (1,960 kB) and the boat appears
//
// So the rower was told the wait was over at 0.7 s and it ended at 3.2 s,
// staring at an empty stage in between — with the single largest download
// happening entirely after the message had gone (#318).
//
// Pure, and in src/utils, for the same reason describeSceneHealth and
// describeCrashEvidence are: the rule can be tested without a browser, and the
// component that renders it cannot drift from it.
// ============================================================================

export type LoadPhaseKey = 'view' | 'scene' | 'frame' | 'boat';

export interface LoadPhase {
  key: LoadPhaseKey;
  /** What the rower is told is happening. */
  label: string;
  /** Share of the bar, out of 100. */
  weight: number;
}

/**
 * The four waits, and what each is worth.
 *
 * Weights are the measured shares of a 3,247 ms load, not four equal quarters:
 * view 21%, scene 19%, frame 1%, boat 59%. Two departures from the measurement,
 * both deliberate:
 *
 *   - the frame gets 5 rather than 1, so the bar visibly moves when it lands
 *     rather than appearing to stall between the scene and the boat;
 *   - the boat is rounded down to 55 to pay for it.
 *
 * `scene` is named for what it is. The geometry *computation* is 0.8 ms; the
 * 604 ms between the chunk arriving and the geometry mark is React mounting the
 * scene, and calling that "building the route" would be a nicer-sounding lie.
 */
export const LOAD_PHASES: readonly LoadPhase[] = [
  { key: 'view', label: 'Fetching the 3D view', weight: 20 },
  { key: 'scene', label: 'Preparing the scene', weight: 20 },
  { key: 'frame', label: 'Drawing the first frame', weight: 5 },
  { key: 'boat', label: 'Loading the boat', weight: 55 },
];

export interface LoadProgress {
  /** 0 to 100. Never 100 while a phase is outstanding. */
  percent: number;
  /** What is being waited for now, or the last label once complete. */
  phase: string;
  /** Whether the stage should stop showing the bar. */
  complete: boolean;
  /** Phases that gave up rather than finished, so the stage can explain. */
  failed: LoadPhaseKey[];
}

const isKnown = (key: LoadPhaseKey): boolean => LOAD_PHASES.some((phase) => phase.key === key);

/**
 * Turn "which phases have settled" into something to show.
 *
 * A sum of what is done, not a pointer into a list: on a warm cache the boat
 * can finish before the first frame is drawn, and a pointer would lose it.
 *
 * `failed` counts towards the total. A boat that 503s must not leave the rower
 * at 45% for ever — the row goes on without it, so the wait really is over.
 * #266 and #267 set that precedent: an asset that will not load does not take
 * the scene down with it.
 */
export const describeLoadProgress = (
  finished: ReadonlySet<LoadPhaseKey>,
  failed: ReadonlySet<LoadPhaseKey> = new Set(),
): LoadProgress => {
  const settled = (phase: LoadPhase): boolean => finished.has(phase.key) || failed.has(phase.key);

  const percent = LOAD_PHASES.filter(settled).reduce((sum, phase) => sum + phase.weight, 0);
  const outstanding = LOAD_PHASES.find((phase) => !settled(phase));

  return {
    percent,
    phase: (outstanding ?? LOAD_PHASES[LOAD_PHASES.length - 1]).label,
    complete: outstanding === undefined,
    failed: LOAD_PHASES.filter((phase) => failed.has(phase.key) && isKnown(phase.key)).map(
      (phase) => phase.key,
    ),
  };
};

/** What the stage says when the boat could not be fetched. */
export const BOAT_UNAVAILABLE_MESSAGE = 'The boat could not be loaded — rowing without it.';
