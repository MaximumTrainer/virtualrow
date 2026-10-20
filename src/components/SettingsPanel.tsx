import React, { useEffect, useState } from 'react';
import type { CrashReportsPreferencePort } from '../lib/ports';
import './SettingsPanel.css';

/**
 * The main Settings surface (issue #473, D4 = b).
 *
 * Reached from a gear button on the Row screen. Phase 1 ships one section —
 * **Diagnostics** — with the crash-reports opt-out and an expandable
 * "What's in a report?" that lists the FR4 fields and the FR6 redaction.
 * Opt-out defaults **on** (D3 = b).
 *
 * The panel subscribes to the port's `subscribe` so a tester toggling the
 * key by hand sees the UI update, and so a reload is never required (AC8).
 */

export interface SettingsPanelProps {
  isOpen: boolean;
  onClose: () => void;
  crashReportsPreferenceStore: CrashReportsPreferencePort;
  /**
   * The signed-in intervals.icu athlete id, when there is one.
   *
   * Not stored in the panel — passed through so the "What's in a report?"
   * list can tell the rower whether their athlete id is attached (D2 = b),
   * without the panel knowing anything about auth.
   */
  intervalsIcuAthleteId: string | null;
}

const DIAGNOSTICS_LIST_ID = 'settings-diagnostics-explain';

export const SettingsPanel: React.FC<SettingsPanelProps> = ({
  isOpen,
  onClose,
  crashReportsPreferenceStore,
  intervalsIcuAthleteId,
}) => {
  const [enabled, setEnabled] = useState(() => crashReportsPreferenceStore.isEnabled());
  const [whatsInExpanded, setWhatsInExpanded] = useState(false);

  // Keep the UI in step with external writes (AC8).
  useEffect(() => {
    return crashReportsPreferenceStore.subscribe((next) => setEnabled(next));
  }, [crashReportsPreferenceStore]);

  if (!isOpen) return null;

  const handleToggle = (next: boolean) => {
    setEnabled(next);
    crashReportsPreferenceStore.setEnabled(next);
  };

  return (
    <div className="settings-panel-backdrop" role="presentation" onClick={onClose}>
      <aside
        className="settings-panel"
        role="dialog"
        aria-labelledby="settings-panel-title"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="settings-panel-header">
          <h2 id="settings-panel-title">Settings</h2>
          <button
            type="button"
            className="settings-close-btn"
            onClick={onClose}
            aria-label="Close settings"
          >
            ✕
          </button>
        </header>

        <section className="settings-section" aria-labelledby="settings-diagnostics-title">
          <h3 id="settings-diagnostics-title">Diagnostics</h3>
          <label className="settings-toggle-row">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => handleToggle(e.target.checked)}
            />
            <span className="settings-toggle-label">
              Send crash reports to help us fix bugs
            </span>
          </label>
          <p className="settings-helper">
            When VirtualRow crashes, a one-time anonymous report is sent to the
            maintainers so the bug can be found and fixed.
          </p>
          <button
            type="button"
            className="settings-explain-toggle"
            aria-expanded={whatsInExpanded}
            aria-controls={DIAGNOSTICS_LIST_ID}
            onClick={() => setWhatsInExpanded((prev) => !prev)}
          >
            {whatsInExpanded ? 'Hide' : "What's in a report?"}
          </button>
          {whatsInExpanded && (
            <ul id={DIAGNOSTICS_LIST_ID} className="settings-explain-list">
              <li>An opaque browser-profile id (not your name, not your email).</li>
              <li>The deploy's build SHA so we can map the crash to code.</li>
              <li>Your browser, viewport size and graphics tier.</li>
              <li>A short error summary (message + first stack frame).</li>
              <li>The last few minutes of scene telemetry (frames, context events).</li>
              {intervalsIcuAthleteId ? (
                <li>
                  Your intervals.icu athlete id ({intervalsIcuAthleteId}) — a number only,
                  no name, no token.
                </li>
              ) : (
                <li>No account identifier (you are not signed in).</li>
              )}
              <li>
                Tokens, email addresses and coordinates are stripped before the
                report leaves your browser.
              </li>
            </ul>
          )}
        </section>
      </aside>
    </div>
  );
};

export default SettingsPanel;
