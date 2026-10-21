import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within, fireEvent } from '@testing-library/svelte';

// Chart.js needs a real 2D context jsdom lacks; stub it like the React suite
// stubbed react-chartjs-2's Line, so the test exercises the summary's markup.
vi.mock('chart.js', () => {
  class Chart {
    static register() {}
    destroy() {}
  }
  const passthrough = {};
  return {
    Chart,
    CategoryScale: passthrough,
    Legend: passthrough,
    LinearScale: passthrough,
    LineController: passthrough,
    LineElement: passthrough,
    PointElement: passthrough,
    Tooltip: passthrough,
  };
});

import * as exporters from '../lib/utils/exporters';
import Harness from './fixtures/SessionSummaryHarness.svelte';
import type { ActivityUploadResult } from '../lib/services/intervalsIcuActivityService';
import type { ActivitySample, AuthUser, GeometrySource, WorkoutSession } from '../lib/types/index';

/**
 * The signed-in end-of-session summary (issue #221, R4) and the rule that a
 * guest or demo row never reaches the upload (R5). Ported to Svelte for #542
 * P1. Auth + services come through the harness fixture, mirroring the React
 * suite's AuthContext.Provider + ServicesProvider.
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

const ATHLETE: AuthUser = { id: 'i123', name: 'Alex', email: 'alex@example.com' };

type UploadArgs = [WorkoutSession, Uint8Array, unknown];

/** A stubbed uploadActivity, defaulting to a clean success. */
function uploadMock(
  impl: (...args: UploadArgs) => Promise<ActivityUploadResult> = async () => ({
    status: 'uploaded',
    activityId: 'i9090',
    activityUrl: 'https://intervals.icu/activities/i9090',
  }),
) {
  return vi.fn(impl as (...args: unknown[]) => Promise<ActivityUploadResult>);
}

function renderSummary(
  props: Partial<{
    session: WorkoutSession;
    onDone: () => void;
    onSaved: (id: string) => void;
    isDemo: boolean;
    personalBest: number | null;
    ghost: { seconds: number | null; label: string } | null;
    routeGeometrySource: GeometrySource;
    authUser: AuthUser | null;
  }> = {},
  options: { uploadActivity?: ReturnType<typeof uploadMock> } = {},
) {
  const uploadActivity = options.uploadActivity ?? uploadMock();
  render(Harness, {
    session: makeSession(),
    onDone: vi.fn(),
    authUser: ATHLETE,
    uploadActivity,
    ...props,
  });
  return { uploadActivity };
}

describe('SessionSummary (issue #221, R4)', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:stub'), revokeObjectURL: vi.fn() }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('shows the row a signed-in athlete just finished (AC4.1)', () => {
    renderSummary();

    expect(screen.getByRole('heading', { name: /workout complete/i })).toBeTruthy();
    expect(screen.getByText('Willowbrook River')).toBeTruthy();
    const totals = within(document.querySelector('.session-summary-stats') as HTMLElement);
    expect(totals.getByText('5.00 km')).toBeTruthy();
    expect(totals.getByText('21:14')).toBeTruthy();
    expect(totals.getByText(/2:07/)).toBeTruthy();
    expect(totals.getByText('132')).toBeTruthy();
    expect(totals.getByText('147')).toBeTruthy();
    expect(totals.getByText('149')).toBeTruthy();
  });

  it('offers Save to intervals.icu when signed in with samples (AC4.2)', () => {
    renderSummary();
    const save = screen.getByRole('button', { name: /save to intervals\.icu/i }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
  });

  it('disables Save for a row that recorded nothing (AC4.2, AC1.7)', () => {
    renderSummary({ session: makeSession({ samples: [] }) });
    const save = screen.getByRole('button', { name: /save to intervals\.icu/i }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  it('shows no Save control when signed out (AC4.2)', () => {
    renderSummary({ authUser: null });
    expect(screen.queryByRole('button', { name: /save to intervals\.icu/i })).toBeNull();
  });

  it('cannot be double-submitted, and becomes a link on success (AC4.3)', async () => {
    let release: (result: ActivityUploadResult) => void = () => {};
    const uploadActivity = uploadMock(
      () => new Promise<ActivityUploadResult>((resolve) => { release = resolve; }),
    );
    renderSummary({}, { uploadActivity });

    await fireEvent.click(screen.getByRole('button', { name: /save to intervals\.icu/i }));
    await waitFor(() => expect(uploadActivity).toHaveBeenCalledTimes(1));

    const saving = screen.getByRole('button', { name: /saving/i }) as HTMLButtonElement;
    expect(saving.disabled).toBe(true);
    await fireEvent.click(saving);
    expect(uploadActivity).toHaveBeenCalledTimes(1);

    release({ status: 'uploaded', activityId: 'i9090', activityUrl: 'https://intervals.icu/activities/i9090' });

    const link = await screen.findByRole('link', { name: /view on intervals\.icu/i });
    expect(link.getAttribute('href')).toBe('https://intervals.icu/activities/i9090');
  });

  it('uploads the encoded FIT bytes for the session (AC4.4)', async () => {
    const { uploadActivity } = renderSummary();

    await fireEvent.click(screen.getByRole('button', { name: /save to intervals\.icu/i }));

    await waitFor(() => expect(uploadActivity).toHaveBeenCalledTimes(1));
    const [session, bytes] = uploadActivity.mock.calls[0] as UploadArgs;
    expect(session).toMatchObject({ id: 's-1' });
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(String.fromCharCode(...bytes.slice(8, 12))).toBe('.FIT');
  });

  it('downloads the same bytes under a route-and-date name (AC4.4)', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    renderSummary();

    await fireEvent.click(screen.getByRole('button', { name: /download \.fit/i }));

    await waitFor(() => expect(click).toHaveBeenCalled());
    const anchor = click.mock.instances[0] as unknown as HTMLAnchorElement;
    expect(anchor.download).toBe('willowbrook-river-2026-03-14.fit');
  });

  it('dismisses with Done whether or not the row was saved (AC4.5)', async () => {
    const onDone = vi.fn();
    renderSummary({ onDone });

    await fireEvent.click(screen.getByRole('button', { name: /^done$/i }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('says the row is lost before it is dismissed unsaved (AC4.6)', () => {
    renderSummary();
    expect(screen.getByText(/not been saved to intervals\.icu/i)).toBeTruthy();
  });

  it('stops warning once the row is saved (AC4.6)', async () => {
    renderSummary();

    await fireEvent.click(screen.getByRole('button', { name: /save to intervals\.icu/i }));

    await screen.findByRole('link', { name: /view on intervals\.icu/i });
    expect(screen.queryByText(/not been saved to intervals\.icu/i)).toBeNull();
  });

  it('surfaces an upload failure and stays retryable (AC3.5, AC3.6)', async () => {
    const uploadActivity = uploadMock(async () => ({
      status: 'failed',
      message: 'intervals.icu rejected the upload (502): Bad Gateway',
    }));
    renderSummary({}, { uploadActivity });

    await fireEvent.click(screen.getByRole('button', { name: /save to intervals\.icu/i }));

    expect((await screen.findByRole('alert')).textContent).toContain('502');
    const save = screen.getByRole('button', { name: /save to intervals\.icu/i }) as HTMLButtonElement;
    expect(save.disabled).toBe(false);
  });

  it('reports a session that was already saved (AC3.3)', async () => {
    const uploadActivity = uploadMock(async () => ({
      status: 'already-uploaded',
      activityId: 'i5',
      activityUrl: 'https://intervals.icu/activities/i5',
    }));
    renderSummary({}, { uploadActivity });

    await fireEvent.click(screen.getByRole('button', { name: /save to intervals\.icu/i }));

    expect(await screen.findByText(/already saved/i)).toBeTruthy();
    expect(screen.getByRole('link', { name: /view on intervals\.icu/i })).toBeTruthy();
  });

  it('tells the athlete to sign in again when the session expired (AC3.4)', async () => {
    const uploadActivity = uploadMock(async () => ({
      status: 'auth-expired',
      message: 'Your intervals.icu session expired — sign in again.',
    }));
    renderSummary({}, { uploadActivity });

    await fireEvent.click(screen.getByRole('button', { name: /save to intervals\.icu/i }));

    expect((await screen.findByRole('alert')).textContent).toMatch(/sign in again/i);
  });

  it('hands the activity id back so the row can be recorded as saved (AC6.2)', async () => {
    const onSaved = vi.fn();
    renderSummary({ onSaved });

    await fireEvent.click(screen.getByRole('button', { name: /save to intervals\.icu/i }));
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith('i9090'));
  });

  it('shows the gate-chain GPS chip only for gate-chain routes (issue #466, AC6)', () => {
    const PATTERN = /schematic line between start and finish/i;

    const { unmount } = render(Harness, {
      session: makeSession(),
      onDone: vi.fn(),
      authUser: ATHLETE,
      uploadActivity: uploadMock(),
      routeGeometrySource: 'gate-chain',
    });
    expect(screen.getByText(PATTERN)).toBeTruthy();
    unmount();

    for (const source of ['track', 'polygon-path', 'osm-derived', undefined] as const) {
      const { unmount: close } = render(Harness, {
        session: makeSession(),
        onDone: vi.fn(),
        authUser: ATHLETE,
        uploadActivity: uploadMock(),
        routeGeometrySource: source,
      });
      expect(screen.queryByText(PATTERN)).toBeNull();
      close();
    }
  });

  it('uploads the same bytes it offers for download (issue #466, AC7)', async () => {
    const trigger = vi.spyOn(exporters, 'triggerBlobDownload').mockImplementation(() => {});

    const { uploadActivity } = renderSummary();

    await fireEvent.click(screen.getByRole('button', { name: /save to intervals\.icu/i }));
    await waitFor(() => expect(uploadActivity).toHaveBeenCalledTimes(1));
    const uploadedBytes = (uploadActivity.mock.calls[0] as UploadArgs)[1];

    await fireEvent.click(screen.getByRole('button', { name: /download \.fit/i }));
    await waitFor(() => expect(trigger).toHaveBeenCalledTimes(1));
    const downloadedBytes = trigger.mock.calls[0][0] as Uint8Array;

    expect(downloadedBytes).toBeInstanceOf(Uint8Array);
    expect(downloadedBytes.byteLength).toBe(uploadedBytes.byteLength);
    expect(Array.from(downloadedBytes)).toEqual(Array.from(uploadedBytes));
  });
});

describe('SessionSummary — guest and demo rows are never uploaded (issue #221, R5)', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'URL',
      Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:stub'), revokeObjectURL: vi.fn() }),
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it('offers no upload control for a guest session (AC5.1)', () => {
    renderSummary({ session: makeSession({ isGuest: true }) });
    expect(screen.queryByRole('button', { name: /save to intervals\.icu/i })).toBeNull();
  });

  it('offers no upload control for a demo row, even signed in (AC5.2)', () => {
    renderSummary({ isDemo: true });
    expect(screen.queryByRole('button', { name: /save to intervals\.icu/i })).toBeNull();
  });

  it('still shows a signed-in demo row with its badge and a download (AC5.3)', () => {
    renderSummary({ isDemo: true });
    expect(screen.getByText(/demo row/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: /download \.fit/i })).toBeTruthy();
    expect(screen.getByText('5.00 km')).toBeTruthy();
  });

  it('never calls uploadActivity for a guest or a demo row (AC5.4)', async () => {
    const uploadActivity = uploadMock();

    const { unmount } = render(Harness, {
      session: makeSession({ isGuest: true }),
      onDone: vi.fn(),
      authUser: ATHLETE,
      uploadActivity,
    });
    await fireEvent.click(screen.getByRole('button', { name: /^done$/i }));
    unmount();

    render(Harness, {
      session: makeSession(),
      onDone: vi.fn(),
      authUser: ATHLETE,
      uploadActivity,
      isDemo: true,
    });
    await fireEvent.click(screen.getByRole('button', { name: /^done$/i }));

    expect(uploadActivity).not.toHaveBeenCalled();
  });
});

describe('SessionSummary — the row itself (#337)', () => {
  const twoKm: ActivitySample[] = Array.from({ length: 501 }, (_, t) => ({
    t,
    distance: t * 4,
    pace: 125,
    power: 170,
    cadence: 26,
    heartRate: 141,
  }));

  it('lists a split per 500 m and draws the row', () => {
    renderSummary({ session: makeSession({ distance: 2000, samples: twoKm }) });

    const rows = within(screen.getByRole('table', { name: 'Splits' })).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(4);
    expect(screen.getByTestId('row-chart')).toBeTruthy();
  });

  it('compares the row with the best on this route', () => {
    renderSummary({ session: makeSession({ averagePace: 127 }), personalBest: 125 });
    expect(screen.getByTestId('row-pb').textContent).toContain('Personal best 2:05/500m · +0:02 today');
  });

  it('calls a first row on the route a first row', () => {
    renderSummary({ personalBest: null });
    expect(screen.getByTestId('row-pb').textContent).toContain('First row on this route');
  });
});

/**
 * Issue #338 — the race, settled on the summary. ghostVerdict covers what the
 * verdict says; these are about it reaching the screen at all.
 */
describe('SessionSummary, after a race (#338)', () => {
  it('says how the race came out', () => {
    renderSummary({ ghost: { seconds: 1290, label: 'your best' } });
    expect(screen.getByRole('status').textContent).toMatch(/beat your best/i);
  });

  it('says nothing about a race for a row that raced nothing', () => {
    renderSummary();
    expect(screen.queryByText(/beat your best/i)).toBeNull();
  });
});
