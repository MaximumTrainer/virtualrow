/**
 * The "a report was sent last time" banner (issue #473, FR9).
 *
 * Non-modal, dismissible, one-line, top-right. Shown on the FIRST load after
 * a crash was reported successfully, with a link to the Settings opt-out.
 * Dismissal persists for this browser profile until the next distinct crash
 * signature is seen (see `crashBannerStore`).
 *
 * Hidden entirely when the opt-out is off, so a rower who turned reporting
 * off never sees a disclosure about a report that would not have been sent.
 */
import { useEffect, useState } from 'react';
import { crashBannerStore } from '../lib/services/crashBannerStore';
import { crashReportsPreferenceStore } from '../lib/services/crashReportsPreferenceStore';

interface Props {
  /** Fires when the viewer taps the opt-out link. The App opens Settings. */
  onOpenSettings?: () => void;
}

export const CrashReportedBanner: React.FC<Props> = ({ onOpenSettings }) => {
  const [visible, setVisible] = useState<boolean>(() => {
    try {
      if (!crashReportsPreferenceStore.isEnabled()) return false;
      return crashBannerStore.current() !== null;
    } catch {
      return false;
    }
  });

  // Opt-out may be toggled while the banner is up; mirror that live so a
  // rower who turns reporting off also loses the "a report was sent"
  // disclosure for the signature they turned it off against.
  useEffect(() => {
    try {
      const unsubscribe = crashReportsPreferenceStore.subscribe((enabled) => {
        if (!enabled) setVisible(false);
      });
      return unsubscribe;
    } catch {
      return undefined;
    }
  }, []);

  if (!visible) return null;

  const handleDismiss = (): void => {
    try {
      crashBannerStore.dismiss();
    } catch {
      // ignored
    }
    setVisible(false);
  };

  return (
    <div
      role="status"
      aria-live="polite"
      className="crash-reported-banner"
      style={{
        position: 'fixed',
        top: 12,
        right: 12,
        zIndex: 1500,
        maxWidth: 'calc(100vw - 24px)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '8px 12px',
        background: 'rgba(26, 26, 46, 0.95)',
        color: '#e0e0e0',
        border: '1px solid rgba(224, 224, 224, 0.2)',
        borderRadius: 6,
        fontSize: 13,
        lineHeight: '18px',
        boxShadow: '0 2px 10px rgba(0, 0, 0, 0.3)',
        pointerEvents: 'auto',
      }}
    >
      <span>
        The previous session crashed. A diagnostic report was sent to help us
        fix it.{' '}
        {onOpenSettings ? (
          <button
            type="button"
            onClick={onOpenSettings}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              color: '#8bbcff',
              cursor: 'pointer',
              textDecoration: 'underline',
              font: 'inherit',
            }}
          >
            Opt out
          </button>
        ) : null}
      </span>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={handleDismiss}
        style={{
          marginLeft: 'auto',
          background: 'none',
          border: 'none',
          color: '#a0a0a0',
          cursor: 'pointer',
          font: 'inherit',
          fontSize: 18,
          padding: '0 4px',
          lineHeight: '18px',
        }}
      >
        ×
      </button>
    </div>
  );
};
