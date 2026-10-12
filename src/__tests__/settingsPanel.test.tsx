import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { SettingsPanel } from '../components/SettingsPanel';
import {
  CrashReportsPreferenceStore,
  CRASH_REPORTS_ENABLED_KEY,
} from '../services/crashReportsPreferenceStore';

/**
 * SettingsPanel renders the Diagnostics opt-out (#473, FR8 / AC8 / AC9).
 */
describe('SettingsPanel (#473)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('does not render when closed', () => {
    const prefs = new CrashReportsPreferenceStore();
    render(
      <SettingsPanel
        isOpen={false}
        onClose={() => {}}
        crashReportsPreferenceStore={prefs}
        intervalsIcuAthleteId={null}
      />,
    );
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('renders Diagnostics with the opt-out defaulting to on (D3=b)', () => {
    const prefs = new CrashReportsPreferenceStore();
    render(
      <SettingsPanel
        isOpen
        onClose={() => {}}
        crashReportsPreferenceStore={prefs}
        intervalsIcuAthleteId={null}
      />,
    );
    const toggle = screen.getByLabelText(/send crash reports/i) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
  });

  it('toggles the preference immediately (AC8)', () => {
    const prefs = new CrashReportsPreferenceStore();
    render(
      <SettingsPanel
        isOpen
        onClose={() => {}}
        crashReportsPreferenceStore={prefs}
        intervalsIcuAthleteId={null}
      />,
    );
    const toggle = screen.getByLabelText(/send crash reports/i) as HTMLInputElement;
    fireEvent.click(toggle);
    expect(prefs.isEnabled()).toBe(false);
    expect(localStorage.getItem(CRASH_REPORTS_ENABLED_KEY)).toBe('false');
  });

  it('updates when the store changes externally (AC8 live toggle)', () => {
    const prefs = new CrashReportsPreferenceStore();
    render(
      <SettingsPanel
        isOpen
        onClose={() => {}}
        crashReportsPreferenceStore={prefs}
        intervalsIcuAthleteId={null}
      />,
    );
    act(() => {
      prefs.setEnabled(false);
    });
    const toggle = screen.getByLabelText(/send crash reports/i) as HTMLInputElement;
    expect(toggle.checked).toBe(false);
  });

  it('expands "What\'s in a report?" and lists the FR4 fields', () => {
    const prefs = new CrashReportsPreferenceStore();
    render(
      <SettingsPanel
        isOpen
        onClose={() => {}}
        crashReportsPreferenceStore={prefs}
        intervalsIcuAthleteId="12345"
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /what's in a report/i }));
    expect(screen.getByText(/opaque browser-profile id/i)).toBeTruthy();
    expect(screen.getByText(/build SHA/i)).toBeTruthy();
    expect(screen.getByText(/intervals\.icu athlete id/i)).toBeTruthy();
    expect(screen.getByText(/tokens, email/i)).toBeTruthy();
  });

  it('says "No account identifier" when signed out (D2=b when applicable)', () => {
    const prefs = new CrashReportsPreferenceStore();
    render(
      <SettingsPanel
        isOpen
        onClose={() => {}}
        crashReportsPreferenceStore={prefs}
        intervalsIcuAthleteId={null}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /what's in a report/i }));
    expect(screen.getByText(/no account identifier/i)).toBeTruthy();
    expect(screen.queryByText(/intervals\.icu athlete id/i)).toBeNull();
  });

  it('calls onClose when the backdrop is clicked', () => {
    const prefs = new CrashReportsPreferenceStore();
    const onClose = vi.fn();
    const { container } = render(
      <SettingsPanel
        isOpen
        onClose={onClose}
        crashReportsPreferenceStore={prefs}
        intervalsIcuAthleteId={null}
      />,
    );
    const backdrop = container.querySelector('.settings-panel-backdrop') as HTMLElement;
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });
});
