/**
 * The rower's choice of conditions, remembered (issue #346) — Svelte-runes port
 * of the React `useConditions` hook.
 *
 * `auto` matches their own clock, which is the default: someone rowing at six
 * in the morning gets a dawn without opening a menu. The presets are them
 * overruling it. Set once, not every row, exactly as the graphics tier is.
 *
 * The resolution of `auto` and the derived `sceneConfig` are `$derived`, so
 * they recompute when the choice changes (not on a timer) — matching the
 * React `useMemo([choice])`, which deliberately does not relight mid-row.
 */
import {
  CONDITIONS,
  applyConditions,
  conditionsForHour,
  type Conditions,
} from '../../components/rower3d/conditions';
import { SCENE_CONFIG, type SceneConfig } from '../../components/rower3d/themeConfig';
import { IS_TEST_MODE } from '../../components/rower3d/constants';

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
 * What `auto` means right now. Under automation it means midday, not the
 * runner's clock, so visual baselines and contrast checks are not a function
 * of the hour CI happened to start (mirrors the React hook).
 */
const resolveAuto = (): Conditions =>
  IS_TEST_MODE ? 'midday' : conditionsForHour(new Date().getHours());

export class ConditionsStore {
  /** What the rower picked, including `auto`. */
  choice = $state<ConditionsChoice>(readStored());

  /** The preset actually in force, with `auto` resolved against the clock. */
  readonly conditions = $derived<Conditions>(
    this.choice === 'auto' ? resolveAuto() : this.choice,
  );

  /** `SCENE_CONFIG` with that preset applied — what the scene reads. */
  readonly sceneConfig = $derived<SceneConfig>(applyConditions(SCENE_CONFIG, this.conditions));

  setChoice(next: ConditionsChoice): void {
    if (!isChoice(next)) return;
    this.choice = next;
    try {
      localStorage.setItem(CONDITIONS_STORAGE_KEY, next);
    } catch {
      // Nothing to do; the choice still applies for this session.
    }
  }
}
