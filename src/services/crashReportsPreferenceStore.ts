/**
 * The opt-out setting for crash telemetry (issue #473, FR8).
 *
 * Default **on** (D3 = b), so a fresh browser profile is reporting until the
 * rower flips it off in the Settings panel. Storage mirrors
 * `defaultRoutePreferenceStore.ts` (localStorage, port-friendly) so a later
 * move to Postgres (#37) is a port swap, not a rewrite.
 *
 * A private window, blocked site data or a full quota all throw — the app
 * carries on with the in-memory default rather than failing to render.
 */

export const CRASH_REPORTS_ENABLED_KEY = 'virtualrow:crashReportsEnabled';

/** Default on (D3 = b from #473). */
export const CRASH_REPORTS_ENABLED_DEFAULT = true;

type Listener = (next: boolean) => void;

function readRaw(): boolean | null {
  try {
    const raw = localStorage.getItem(CRASH_REPORTS_ENABLED_KEY);
    if (raw === null) return null;
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    return null;
  } catch (err) {
    console.warn('[CrashReportsPreferenceStore] Failed to read preference:', err);
    return null;
  }
}

function writeRaw(value: boolean): void {
  try {
    localStorage.setItem(CRASH_REPORTS_ENABLED_KEY, value ? 'true' : 'false');
  } catch (err) {
    console.warn('[CrashReportsPreferenceStore] Failed to save preference:', err);
  }
}

export class CrashReportsPreferenceStore {
  private listeners = new Set<Listener>();

  isEnabled(): boolean {
    const stored = readRaw();
    return stored ?? CRASH_REPORTS_ENABLED_DEFAULT;
  }

  setEnabled(value: boolean): void {
    writeRaw(value);
    for (const listener of this.listeners) {
      try {
        listener(value);
      } catch (err) {
        console.warn('[CrashReportsPreferenceStore] Listener threw:', err);
      }
    }
  }

  /** Subscribe to flips so the reporter picks up a toggle without a reload (AC8). */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
}

export const crashReportsPreferenceStore = new CrashReportsPreferenceStore();
