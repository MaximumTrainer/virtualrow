import { describe, it, expect, beforeAll } from 'vitest';
import { startTelemetry } from '../utils/telemetryBoot';
import { clearTelemetry, readTelemetry } from '../utils/sceneTelemetryLog';

/**
 * The scene records its own lifecycle — a context made, lost, restored, a
 * boundary tripped. What it cannot record is the thing that stops it running:
 * an uncaught error, or a promise nobody handled. Those are what a crash
 * usually leaves behind, so they are picked up at the top of the app.
 */

const fakeStorage = (): Storage => {
  const entries = new Map<string, string>();
  return {
    get length() {
      return entries.size;
    },
    clear: () => entries.clear(),
    getItem: (key: string) => entries.get(key) ?? null,
    key: (index: number) => Array.from(entries.keys())[index] ?? null,
    removeItem: (key: string) => void entries.delete(key),
    setItem: (key: string, value: string) => void entries.set(key, value),
  };
};

const kinds = () => readTelemetry().map((e) => e.kind);

describe('starting the telemetry log', () => {
  beforeAll(() => {
    clearTelemetry();
    startTelemetry(fakeStorage());
  });

  it('opens the log, so there is something to append to', () => {
    expect(kinds()).toContain('run-start');
  });

  it('records an uncaught error, which the scene cannot record for itself', () => {
    window.dispatchEvent(
      new ErrorEvent('error', {
        message: 'boom from nowhere',
        filename: 'app.js',
        lineno: 12,
        colno: 3,
      }),
    );

    const error = readTelemetry().find((e) => e.kind === 'error');

    expect(error, 'an uncaught error went unrecorded').toBeTruthy();
    expect(error!.detail).toMatchObject({ message: 'boom from nowhere' });
    expect(error!.detail?.source).toBe('app.js:12:3');
  });

  it('records a rejection nobody handled', () => {
    // jsdom does not raise this one on its own, so it is dispatched directly.
    const event = new Event('unhandledrejection') as Event & { reason?: unknown };
    event.reason = new Error('nobody caught me');
    window.dispatchEvent(event);

    const rejection = readTelemetry().find((e) => e.kind === 'unhandled-rejection');

    expect(rejection, 'an unhandled rejection went unrecorded').toBeTruthy();
    expect(rejection!.detail).toMatchObject({ message: 'nobody caught me' });
  });

  it('notes the page going away, so a log that just stops means something', () => {
    window.dispatchEvent(new Event('pagehide'));

    expect(kinds()).toContain('page-hide');
  });

  it('installs its listeners once, however often it is called', () => {
    // React mounts twice under StrictMode, and a hot reload calls it again.
    startTelemetry(fakeStorage());
    startTelemetry(fakeStorage());

    const before = readTelemetry().filter((e) => e.kind === 'error').length;
    window.dispatchEvent(new ErrorEvent('error', { message: 'only once please' }));
    const after = readTelemetry().filter((e) => e.kind === 'error').length;

    expect(after - before, 'the error was recorded more than once').toBe(1);
  });

  it('does not open a second log over the first', () => {
    // The repeated calls above must not have wiped what was already recorded.
    expect(readTelemetry().filter((e) => e.kind === 'run-start').length).toBe(1);
  });

  it('works with no storage at all', () => {
    expect(() => startTelemetry(null)).not.toThrow();
  });
});
