import { describe, it, expect, beforeEach } from 'vitest';
import {
  MAX_TELEMETRY_EVENTS,
  TELEMETRY_STORAGE_KEY,
  clearTelemetry,
  openTelemetry,
  readTelemetry,
  recordTelemetry,
  telemetryAsText,
  formatTelemetry,
} from '../utils/sceneTelemetryLog';

/**
 * A record of what the 3D scene was doing, that outlives the thing that broke.
 *
 * Everything the scene already reports — draw calls, frame pacing, context
 * state, geometry — is instantaneous and lives in memory. When the renderer is
 * killed and the tab reloads, all of it goes with it: that is exactly what
 * happened twice while #272 was being written, where the app came back at the
 * setup view with nothing left to say why.
 *
 * Session storage because that survives a reload of the same tab, which is the
 * case worth catching, and is cleared when the tab is closed so a rower's
 * machine does not accumulate our diagnostics for ever.
 */

/** A storage that behaves like the browser's, for tests. */
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

/** A storage that refuses, as a private window does. */
const hostileStorage = (): Storage =>
  ({
    get length(): number {
      throw new Error('denied');
    },
    clear: () => {
      throw new Error('denied');
    },
    getItem: () => {
      throw new Error('denied');
    },
    key: () => {
      throw new Error('denied');
    },
    removeItem: () => {
      throw new Error('denied');
    },
    setItem: () => {
      throw new Error('denied');
    },
  }) as unknown as Storage;

describe('the scene telemetry log', () => {
  beforeEach(() => {
    clearTelemetry();
  });

  it('keeps what happened, in the order it happened', () => {
    openTelemetry(fakeStorage());

    recordTelemetry('context-created', { antialias: false });
    recordTelemetry('sample', { fps: 42 });
    recordTelemetry('context-lost', { reason: 'GPU process exited' });

    const events = readTelemetry();

    expect(events.map((e) => e.kind)).toEqual([
      'run-start',
      'context-created',
      'sample',
      'context-lost',
    ]);
    expect(events[3].detail).toMatchObject({ reason: 'GPU process exited' });
  });

  it('survives the reload a renderer crash produces', () => {
    // The crash case: the tab is reloaded, memory is gone, storage is not.
    const storage = fakeStorage();
    openTelemetry(storage);
    recordTelemetry('context-lost', { reason: 'the first run' });

    // A new page, reading the same tab's storage. A reload clears memory and
    // leaves storage alone, which is what opening again models — calling
    // clearTelemetry here would wipe the very thing being recovered.
    openTelemetry(storage);

    const events = readTelemetry();
    const lost = events.find((e) => e.kind === 'context-lost');

    expect(lost, 'the previous run was not recovered from storage').toBeTruthy();
    expect(lost!.detail).toMatchObject({ reason: 'the first run' });
    // And the new run is marked, so two runs can be told apart.
    expect(events.filter((e) => e.kind === 'run-start').length).toBe(2);
  });

  it('cannot grow without bound, however long the rower rows', () => {
    openTelemetry(fakeStorage());

    for (let i = 0; i < MAX_TELEMETRY_EVENTS * 3; i += 1) {
      recordTelemetry('sample', { i });
    }

    const events = readTelemetry();

    expect(events.length).toBeLessThanOrEqual(MAX_TELEMETRY_EVENTS);
    // The oldest go first: what broke it is usually near the end.
    expect(events[events.length - 1].detail).toMatchObject({
      i: MAX_TELEMETRY_EVENTS * 3 - 1,
    });
  });

  it('writes through to storage, so a crash loses nothing recorded', () => {
    const storage = fakeStorage();
    openTelemetry(storage);

    recordTelemetry('context-lost', { reason: 'written before the crash' });

    const raw = storage.getItem(TELEMETRY_STORAGE_KEY);
    expect(raw, 'nothing reached storage').toBeTruthy();
    expect(raw!).toContain('written before the crash');
  });

  it('keeps working when the browser refuses storage', () => {
    // A private window throws on both read and write. Losing the log is
    // acceptable; taking the scene down with it is not.
    expect(() => openTelemetry(hostileStorage())).not.toThrow();
    expect(() => recordTelemetry('context-lost', { reason: 'no storage' })).not.toThrow();

    // And it still works in memory.
    expect(readTelemetry().some((e) => e.kind === 'context-lost')).toBe(true);
  });

  it('survives storage holding something that is not a log', () => {
    const storage = fakeStorage();
    storage.setItem(TELEMETRY_STORAGE_KEY, '{ this is not json');

    expect(() => openTelemetry(storage)).not.toThrow();
    expect(readTelemetry().map((e) => e.kind)).toEqual(['run-start']);
  });

  it('reads back as text a person can paste into an issue', () => {
    openTelemetry(fakeStorage());
    recordTelemetry('context-lost', { reason: 'GPU process exited' });

    const text = telemetryAsText();

    expect(text).toContain('context-lost');
    expect(text).toContain('GPU process exited');
    // One event per line, so it survives a paste.
    expect(text.split('\n').length).toBe(readTelemetry().length);
  });

  it('formats a log it did not record, for a reader in another process', () => {
    // The Playwright crash guard copies the log out of the browser and renders
    // events this process never saw. It shares the formatting rather than
    // owning a second copy free to drift from the one a rower pastes.
    const text = formatTelemetry([
      { at: 1500, kind: 'run-start', detail: { recovered: 0 } },
      { at: 6200, kind: 'context-lost', detail: { reason: 'GPU process exited' } },
    ]);

    expect(text.split('\n')).toHaveLength(2);
    expect(text).toContain('run-start');
    expect(text).toContain('GPU process exited');
    expect(text).toContain('1.5s');
    expect(text).toContain('6.2s');
  });

  it('says so plainly when there is no log to format', () => {
    // An empty attachment reads as "nothing went wrong"; this reads as what it
    // is, which is the absence of evidence.
    expect(formatTelemetry([])).toBe('no telemetry was recorded');
  });

  it('agrees with telemetryAsText about the log this process holds', () => {
    openTelemetry(fakeStorage());
    recordTelemetry('context-lost', { reason: 'GPU process exited' });

    expect(telemetryAsText()).toBe(formatTelemetry(readTelemetry()));
  });

  it('records when something was recorded, not just what', () => {
    openTelemetry(fakeStorage());
    recordTelemetry('sample', { fps: 1 });

    const [, sample] = readTelemetry();

    expect(typeof sample.at).toBe('number');
    expect(sample.at).toBeGreaterThanOrEqual(0);
  });
});
