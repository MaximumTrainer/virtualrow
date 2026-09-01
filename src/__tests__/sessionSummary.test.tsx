import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SessionSummary } from '../components/SessionSummary';
import { ServicesProvider } from '../context/ServicesContext';
import { AuthContext, type AuthContextValue } from '../context/useAuth';
import type { ActivityUploadAuth, ActivityUploadResult } from '../services/intervalsIcuActivityService';
import type { ActivitySample, WorkoutSession } from '../types/index';

/**
 * The signed-in end-of-session summary (issue #221, R4) and the rule that a
 * guest or demo row never reaches the upload (R5).
 */

function makeSamples(count: number): ActivitySample[] {
  return Array.from({ length: count }, (_, t) => ({
    t,
    distance: t * 4,
    pace: 127,
    power: 149,
    cadence: 24,
    heartRate: 132,
    lat: 51.5,
    lng: -0.9 + t * 0.0001,
  }));
}

function makeSession(overrides: Partial<WorkoutSession> = {}): WorkoutSession {
  return {
    id: 's-1',
    routeId: 'r1',
    routeName: 'Willowbrook River',
    startTime: new Date('2026-03-14T08:00:00Z'),
    endTime: new Date('2026-03-14T08:21:14Z'),
    duration: 1274,
    distance: 5000,
    averagePace: 127,
    calories: 240,
    splits: [],
    isActive: false,
    heartRateAvg: 132,
    heartRateMax: 147,
    samples: makeSamples(30),
    ...overrides,
  };
}

const AUTHENTICATED: AuthContextValue = {
  user: { id: 'i123', name: 'Alex', email: 'alex@example.com' },
  isAuthenticated: true,
  isLoading: false,
  authError: null,
  login: async () => {},
  logout: () => {},
  clearAuthError: () => {},
  pendingAction: null,
  setPendingAction: () => {},
};

type UploadArgs = [WorkoutSession, Uint8Array, ActivityUploadAuth];
type UploadMock = ReturnType<typeof uploadMock>;

/** A stubbed `uploadActivity`, typed to the port so a drifted stub fails the build. */
function uploadMock(
  impl: (...args: UploadArgs) => Promise<ActivityUploadResult> = async () => ({
    status: 'uploaded',
    activityId: 'i9090',
    activityUrl: 'https://intervals.icu/activities/i9090',
  }),
) {
  return vi.fn<UploadArgs, Promise<ActivityUploadResult>>(impl);
}

function renderSummary(
  props: Partial<React.ComponentProps<typeof SessionSummary>> = {},
  options: { uploadActivity?: UploadMock; auth?: AuthContextValue } = {},
) {
  const uploadActivity = options.uploadActivity ?? uploadMock();

  render(
    <AuthContext.Provider value={options.auth ?? AUTHENTICATED}>
      <ServicesProvider services={{ intervalsIcuActivityService: { uploadActivity } }}>
        <SessionSummary session={makeSession()} onDone={vi.fn()} {...props} />
      </ServicesProvider>
    </AuthContext.Provider>,
  );
  return { uploadActivity };
}

describe('SessionSummary (issue #221, R4)', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', Object.assign(URL, {
      createObjectURL: vi.fn(() => 'blob:stub'),
      revokeObjectURL: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows the row a signed-in athlete just finished (AC4.1)', () => {
    renderSummary();

    expect(screen.getByRole('heading', { name: /workout complete/i })).toBeInTheDocument();
    expect(screen.getByText('Willowbrook River')).toBeInTheDocument();
    expect(screen.getByText('5.00 km')).toBeInTheDocument();
    expect(screen.getByText('21:14')).toBeInTheDocument();
    expect(screen.getByText(/2:07/)).toBeInTheDocument();
    expect(screen.getByText('132')).toBeInTheDocument();  // avg HR
    expect(screen.getByText('147')).toBeInTheDocument();  // max HR
    expect(screen.getByText('149')).toBeInTheDocument();  // avg W
  });

  it('offers Save to intervals.icu when signed in with samples (AC4.2)', () => {
    renderSummary();
    expect(screen.getByRole('button', { name: /save to intervals\.icu/i })).toBeEnabled();
  });

  it('disables Save for a row that recorded nothing (AC4.2, AC1.7)', () => {
    renderSummary({ session: makeSession({ samples: [] }) });
    expect(screen.getByRole('button', { name: /save to intervals\.icu/i })).toBeDisabled();
  });

  it('shows no Save control when signed out (AC4.2)', () => {
    renderSummary({}, { auth: { ...AUTHENTICATED, isAuthenticated: false, user: null } });
    expect(screen.queryByRole('button', { name: /save to intervals\.icu/i })).not.toBeInTheDocument();
  });

  it('cannot be double-submitted, and becomes a link on success (AC4.3)', async () => {
    const user = userEvent.setup();
    let release: (result: ActivityUploadResult) => void = () => {};
    const uploadActivity = uploadMock(() => new Promise<ActivityUploadResult>((resolve) => {
      release = resolve;
    }));
    renderSummary({}, { uploadActivity });

    const save = screen.getByRole('button', { name: /save to intervals\.icu/i });
    await user.click(save);

    // The encoder is dynamically imported, so wait for the upload to be in
    // flight rather than for the label alone — otherwise the second click can
    // land before the first attempt has reached the service at all.
    await waitFor(() => expect(uploadActivity).toHaveBeenCalledTimes(1));

    const saving = screen.getByRole('button', { name: /saving/i });
    expect(saving).toBeDisabled();
    await user.click(saving);
    expect(uploadActivity).toHaveBeenCalledTimes(1);

    release({ status: 'uploaded', activityId: 'i9090', activityUrl: 'https://intervals.icu/activities/i9090' });

    const link = await screen.findByRole('link', { name: /view on intervals\.icu/i });
    expect(link).toHaveAttribute('href', 'https://intervals.icu/activities/i9090');
  });

  it('uploads the encoded FIT bytes for the session (AC4.4)', async () => {
    const user = userEvent.setup();
    const { uploadActivity } = renderSummary();

    await user.click(screen.getByRole('button', { name: /save to intervals\.icu/i }));

    await waitFor(() => expect(uploadActivity).toHaveBeenCalledTimes(1));
    const [session, bytes] = uploadActivity.mock.calls[0];
    expect(session).toMatchObject({ id: 's-1' });
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(String.fromCharCode(...(bytes as Uint8Array).slice(8, 12))).toBe('.FIT');
  });

  it('downloads the same bytes under a route-and-date name (AC4.4)', async () => {
    const user = userEvent.setup();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderSummary();

    await user.click(screen.getByRole('button', { name: /download \.fit/i }));

    await waitFor(() => expect(click).toHaveBeenCalled());
    const anchor = click.mock.instances[0] as unknown as HTMLAnchorElement;
    expect(anchor.download).toBe('willowbrook-river-2026-03-14.fit');
  });

  it('dismisses with Done whether or not the row was saved (AC4.5)', async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    renderSummary({ onDone });

    await user.click(screen.getByRole('button', { name: /^done$/i }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('says the row is lost before it is dismissed unsaved (AC4.6)', () => {
    renderSummary();
    expect(screen.getByText(/not been saved to intervals\.icu/i)).toBeInTheDocument();
  });

  it('stops warning once the row is saved (AC4.6)', async () => {
    const user = userEvent.setup();
    renderSummary();

    await user.click(screen.getByRole('button', { name: /save to intervals\.icu/i }));

    await screen.findByRole('link', { name: /view on intervals\.icu/i });
    expect(screen.queryByText(/not been saved to intervals\.icu/i)).not.toBeInTheDocument();
  });

  it('surfaces an upload failure and stays retryable (AC3.5, AC3.6)', async () => {
    const user = userEvent.setup();
    const uploadActivity = uploadMock(async () => ({
      status: 'failed',
      message: 'intervals.icu rejected the upload (502): Bad Gateway',
    }));
    renderSummary({}, { uploadActivity });

    await user.click(screen.getByRole('button', { name: /save to intervals\.icu/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent('502');
    expect(screen.getByRole('button', { name: /save to intervals\.icu/i })).toBeEnabled();
  });

  it('reports a session that was already saved (AC3.3)', async () => {
    const user = userEvent.setup();
    const uploadActivity = uploadMock(async () => ({
      status: 'already-uploaded',
      activityId: 'i5',
      activityUrl: 'https://intervals.icu/activities/i5',
    }));
    renderSummary({}, { uploadActivity });

    await user.click(screen.getByRole('button', { name: /save to intervals\.icu/i }));

    expect(await screen.findByText(/already saved/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /view on intervals\.icu/i })).toBeInTheDocument();
  });

  it('tells the athlete to sign in again when the session expired (AC3.4)', async () => {
    const user = userEvent.setup();
    const uploadActivity = uploadMock(async () => ({
      status: 'auth-expired',
      message: 'Your intervals.icu session expired — sign in again.',
    }));
    renderSummary({}, { uploadActivity });

    await user.click(screen.getByRole('button', { name: /save to intervals\.icu/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/sign in again/i);
  });

  it('hands the activity id back so the row can be recorded as saved (AC6.2)', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    renderSummary({ onSaved });

    await user.click(screen.getByRole('button', { name: /save to intervals\.icu/i }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('i9090'));
  });
});

describe('SessionSummary — guest and demo rows are never uploaded (issue #221, R5)', () => {
  beforeEach(() => {
    vi.stubGlobal('URL', Object.assign(URL, {
      createObjectURL: vi.fn(() => 'blob:stub'),
      revokeObjectURL: vi.fn(),
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('offers no upload control for a guest session (AC5.1)', () => {
    renderSummary({ session: makeSession({ isGuest: true }) });
    expect(screen.queryByRole('button', { name: /save to intervals\.icu/i })).not.toBeInTheDocument();
  });

  it('offers no upload control for a demo row, even signed in (AC5.2)', () => {
    renderSummary({ isDemo: true });
    expect(screen.queryByRole('button', { name: /save to intervals\.icu/i })).not.toBeInTheDocument();
  });

  it('still shows a signed-in demo row with its badge and a download (AC5.3)', () => {
    renderSummary({ isDemo: true });
    expect(screen.getByText(/demo row/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /download \.fit/i })).toBeInTheDocument();
    expect(screen.getByText('5.00 km')).toBeInTheDocument();
  });

  it('never calls uploadActivity for a guest or a demo row (AC5.4)', async () => {
    const user = userEvent.setup();
    const uploadActivity = uploadMock();

    const { unmount } = render(
      <AuthContext.Provider value={AUTHENTICATED}>
        <ServicesProvider services={{ intervalsIcuActivityService: { uploadActivity } }}>
          <SessionSummary session={makeSession({ isGuest: true })} onDone={vi.fn()} />
        </ServicesProvider>
      </AuthContext.Provider>,
    );
    await user.click(screen.getByRole('button', { name: /^done$/i }));
    unmount();

    render(
      <AuthContext.Provider value={AUTHENTICATED}>
        <ServicesProvider services={{ intervalsIcuActivityService: { uploadActivity } }}>
          <SessionSummary session={makeSession()} onDone={vi.fn()} isDemo />
        </ServicesProvider>
      </AuthContext.Provider>,
    );
    await user.click(screen.getByRole('button', { name: /^done$/i }));

    expect(uploadActivity).not.toHaveBeenCalled();
  });
});
