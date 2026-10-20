/**
 * Per-browser debug-panel preferences (issue #453).
 *
 * The debug panel's own toggles live here rather than in `useState` on
 * `App.tsx`, so a reload does not fight a tester who is verifying a
 * demo-mode regression. `localStorage`, no server hop; a private window
 * or a browser with site data blocked throws and the app falls back to
 * the default.
 *
 * Mirrors the shape of `defaultRoutePreferenceStore.ts` (per-athlete
 * preferences, port-friendly) so if these preferences ever migrate to
 * Postgres alongside #37 they can move without a rewrite.
 */

export const SHOW_DEMO_CTA_KEY = 'virtualrow:debug:showDemoCta';

/**
 * Whether the signed-in demo-row CTA override is on.
 *
 * Default off: the whole point of #453 is that a signed-in athlete does
 * not see the CTA on a fresh browser. Malformed or missing values fall
 * back to the default without throwing (mirrors
 * `defaultRoutePreferenceStore` and satisfies AC3).
 */
function getShowDemoCtaOverride(): boolean {
  try {
    const raw = localStorage.getItem(SHOW_DEMO_CTA_KEY);
    if (raw === null) return false;
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return false;
  } catch (err) {
    console.warn('[DebugPreferencesStore] Failed to read showDemoCta:', err);
    return false;
  }
}

function setShowDemoCtaOverride(value: boolean): void {
  try {
    localStorage.setItem(SHOW_DEMO_CTA_KEY, value ? 'true' : 'false');
  } catch (err) {
    console.warn('[DebugPreferencesStore] Failed to save showDemoCta:', err);
  }
}

export const LAKE_OUTLINES_KEY = 'virtualrow:debug:lakeOutlines';

/**
 * Whether lake routes draw their water and shore from the lake outline
 * (#493). On by default; a tester turns it off from the debug panel.
 * Anything but a stored `'false'` reads as on.
 */
function getLakeOutlines(): boolean {
  try {
    return localStorage.getItem(LAKE_OUTLINES_KEY) !== 'false';
  } catch (err) {
    console.warn('[DebugPreferencesStore] Failed to read lakeOutlines:', err);
    return true;
  }
}

function setLakeOutlines(value: boolean): void {
  try {
    localStorage.setItem(LAKE_OUTLINES_KEY, value ? 'true' : 'false');
  } catch (err) {
    console.warn('[DebugPreferencesStore] Failed to save lakeOutlines:', err);
  }
}

export class DebugPreferencesStore {
  getShowDemoCtaOverride = getShowDemoCtaOverride;
  setShowDemoCtaOverride = setShowDemoCtaOverride;
  getLakeOutlines = getLakeOutlines;
  setLakeOutlines = setLakeOutlines;
}

export const debugPreferencesStore = new DebugPreferencesStore();
