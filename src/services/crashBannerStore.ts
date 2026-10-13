/**
 * The "a report was sent last time" flag (issue #473, FR9).
 *
 * Written by `crashBoot` when a crash was detected and a report was
 * successfully enqueued; read by `CrashReportedBanner` on the next render.
 * Dismissal persists until the next DISTINCT crash signature is observed:
 * the stored record keeps the last-reported signature so dismiss-of-A
 * never silences B.
 *
 * localStorage today, storage-agnostic shape so Postgres (#37) swaps the
 * adapter without touching the component — same pattern as
 * `defaultRoutePreferenceStore` and `crashReportsPreferenceStore`.
 */
export const CRASH_BANNER_KEY = 'virtualrow:crash-banner';

export interface CrashBannerRecord {
  /** The signature of the crash that produced the banner, or null for legacy entries. */
  signature: string | null;
  /** When the banner was raised. */
  raisedAt: number;
  /** The signature the viewer dismissed, if they did. */
  dismissedSignature?: string;
}

const safeRead = (): CrashBannerRecord | null => {
  try {
    const raw = localStorage.getItem(CRASH_BANNER_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const p = parsed as Partial<CrashBannerRecord>;
    if (typeof p.raisedAt !== 'number' || !Number.isFinite(p.raisedAt)) return null;
    return {
      signature: typeof p.signature === 'string' ? p.signature : null,
      raisedAt: p.raisedAt,
      dismissedSignature:
        typeof p.dismissedSignature === 'string' ? p.dismissedSignature : undefined,
    };
  } catch {
    return null;
  }
};

const safeWrite = (record: CrashBannerRecord | null): void => {
  try {
    if (record === null) {
      localStorage.removeItem(CRASH_BANNER_KEY);
    } else {
      localStorage.setItem(CRASH_BANNER_KEY, JSON.stringify(record));
    }
  } catch {
    // ignored
  }
};

export interface CrashBannerStore {
  /** Record that a crash was reported. Idempotent per signature. */
  raise(signature: string | null): void;
  /** Mark the banner dismissed. The signature it dismissed is remembered. */
  dismiss(): void;
  /**
   * The signature to show the banner for, or null to hide it.
   * Shows a raised record whose signature the viewer has NOT dismissed.
   */
  current(): string | null;
}

export const crashBannerStore: CrashBannerStore = {
  raise(signature) {
    const record = safeRead();
    // Idempotent per signature — do not reset `raisedAt` on repeat calls.
    if (record && record.signature === signature) return;
    safeWrite({ signature, raisedAt: Date.now() });
  },
  dismiss() {
    const record = safeRead();
    if (!record) return;
    safeWrite({ ...record, dismissedSignature: record.signature ?? '' });
  },
  current() {
    const record = safeRead();
    if (!record) return null;
    const sig = record.signature ?? '';
    if (record.dismissedSignature === sig) return null;
    return record.signature;
  },
};
