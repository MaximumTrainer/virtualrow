import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CONDITIONS,
  applyConditions,
  conditionsForHour,
  type Conditions,
} from '../components/rower3d/conditions';
import { SCENE_CONFIG, type SceneConfig } from '../components/rower3d/themeConfig';
import { IS_TEST_MODE } from '../components/rower3d/constants';

/**
 * The rower's choice of conditions, remembered (issue #346).
 *
 * `auto` matches their own clock, which is the default: someone rowing at six
 * in the morning gets a dawn without opening a menu, and that is a better
 * first impression of the feature than a setting nobody finds. The presets are
 * them overruling it — a row before work that they would rather have in golden
 * hour.
 *
 * Set once, not every row, exactly as the graphics tier is.
 */

export type ConditionsChoice = 'auto' | Conditions;

export const CONDITIONS_STORAGE_KEY = 'virtualrow:conditions';

const isChoice = (value: unknown): value is ConditionsChoice =>
  value === 'auto' || CONDITIONS.includes(value as Conditions);

const readStored = (): ConditionsChoice => {
  try {
    const stored = localStorage.getItem(CONDITIONS_STORAGE_KEY);
    return isChoice(stored) ? stored : 'auto';
  } catch {
    // Private browsing, or storage disabled. The default is no worse for it.
    return 'auto';
  }
};

/**
 * What `auto` means right now.
 *
 * Under automation it means midday, not the runner's clock. Every visual
 * baseline and every contrast check would otherwise be a function of the hour
 * CI happened to start: a scene recorded at midday and compared at dusk is a
 * failure nobody caused, and a dusk scene would quietly fail the contrast
 * floors #291 exists to hold. A spec that wants another preset stores one,
 * which is the same path a rower takes.
 */
const resolveAuto = (): Conditions =>
  IS_TEST_MODE ? 'midday' : conditionsForHour(new Date().getHours());

export interface ConditionsControl {
  /** What the rower picked, including `auto`. */
  choice: ConditionsChoice;
  setChoice: (next: ConditionsChoice) => void;
  /** The preset actually in force, with `auto` resolved against the clock. */
  conditions: Conditions;
  /** `SCENE_CONFIG` with that preset applied — what the scene reads. */
  sceneConfig: SceneConfig;
}

export const useConditions = (): ConditionsControl => {
  const [choice, setStored] = useState<ConditionsChoice>(readStored);

  useEffect(() => {
    try {
      localStorage.setItem(CONDITIONS_STORAGE_KEY, choice);
    } catch {
      // Nothing to do; the choice still applies for this session.
    }
  }, [choice]);

  const setChoice = useCallback((next: ConditionsChoice) => {
    if (isChoice(next)) setStored(next);
  }, []);

  // Read when the choice changes rather than on a timer: an hour boundary
  // crossed mid-row would relight the scene under a rower halfway down the
  // course, which is not what "match my clock" is asking for.
  const conditions = useMemo(() => (choice === 'auto' ? resolveAuto() : choice), [choice]);

  const sceneConfig = useMemo(() => applyConditions(SCENE_CONFIG, conditions), [conditions]);

  return { choice, setChoice, conditions, sceneConfig };
};
