import { describe, it, expect, beforeEach } from 'vitest';
import {
  selectGlOptions,
  readContextState,
  recordContextCreated,
  recordContextLost,
  recordContextRestored,
  clearContextState,
  scheduleContextRestore,
  RESTORE_DELAYS_MS,
  type ContextAttempt,
} from '../components/rower3d/glContext';

/** An attempt that succeeds only for the configurations named. */
const attemptAllowing = (
  allowed: Array<{ powerPreference?: string; antialias?: boolean }>,
  reason = 'context creation failed',
): ContextAttempt => {
  const tried: WebGLContextAttributes[] = [];
  const attempt: ContextAttempt = (options) => {
    tried.push(options);
    const ok = allowed.some(
      (a) =>
        (a.powerPreference === undefined || a.powerPreference === options.powerPreference) &&
        (a.antialias === undefined || a.antialias === options.antialias),
    );
    return ok ? { ok: true } : { ok: false, reason };
  };
  return Object.assign(attempt, { tried });
};

describe('selectGlOptions', () => {
  it('keeps the discrete GPU and antialiasing when the driver takes them', () => {
    const selection = selectGlOptions(attemptAllowing([{}]), { preferHighPerformance: true });

    expect(selection).toMatchObject({ powerPreference: 'high-performance', antialias: true });
    expect(selection.fallbackReason).toBeUndefined();
  });

  it('falls back to the default adapter when the preferred one will not open', () => {
    // The hybrid-laptop case: asking for high-performance routes to a discrete
    // GPU whose driver refuses the context.
    const attempt = attemptAllowing([{ powerPreference: 'default' }], 'eglCreateContext failed');

    const selection = selectGlOptions(attempt, { preferHighPerformance: true });

    expect(selection).toMatchObject({ powerPreference: 'default', antialias: true });
    expect(selection.fallbackReason).toContain('eglCreateContext failed');
  });

  it('gives up multisampling before it gives up rendering', () => {
    const attempt = attemptAllowing([{ antialias: false }], 'out of memory');

    const selection = selectGlOptions(attempt, { preferHighPerformance: true });

    expect(selection.antialias).toBe(false);
    expect(selection.fallbackReason).toContain('out of memory');
  });

  it('never trades away resolution to get a context', () => {
    const selection = selectGlOptions(attemptAllowing([{ antialias: false }]), {
      preferHighPerformance: true,
    });

    // dpr is the caller's business and nothing here should propose changing it.
    expect(selection).not.toHaveProperty('dpr');
  });

  it('reports that nothing worked rather than pretending', () => {
    const selection = selectGlOptions(attemptAllowing([], 'no adapters'), {
      preferHighPerformance: true,
    });

    expect(selection.usable).toBe(false);
    expect(selection.fallbackReason).toContain('no adapters');
  });

  it('asks for the low-power adapter when the scene is in low quality', () => {
    const attempt = attemptAllowing([{}]);

    const selection = selectGlOptions(attempt, { preferHighPerformance: false });

    expect(selection.powerPreference).toBe('low-power');
    expect(selection.antialias).toBe(false);
  });

  it('tries the preferred configuration first', () => {
    const attempt = attemptAllowing([{ powerPreference: 'default' }]);

    selectGlOptions(attempt, { preferHighPerformance: true });

    expect((attempt as unknown as { tried: WebGLContextAttributes[] }).tried[0]).toMatchObject({
      powerPreference: 'high-performance',
      antialias: true,
    });
  });
});

describe('context state', () => {
  beforeEach(() => clearContextState());

  it('knows nothing before a canvas has been created', () => {
    expect(readContextState()).toBeNull();
  });

  it('records how the context was obtained', () => {
    recordContextCreated({ powerPreference: 'default', antialias: true, fallbackReason: 'refused' });

    expect(readContextState()).toMatchObject({
      powerPreference: 'default',
      lost: false,
      fallbackReason: 'refused',
    });
  });

  it('remembers a loss, which is what a blank canvas needs to explain itself', () => {
    recordContextCreated({ powerPreference: 'high-performance', antialias: true });

    recordContextLost('GPU process exited');

    expect(readContextState()).toMatchObject({ lost: true, lostReason: 'GPU process exited' });
  });

  it('counts restore attempts, so a loop of them is visible', () => {
    recordContextCreated({ powerPreference: 'default', antialias: false });
    recordContextLost();
    recordContextLost();

    expect(readContextState()?.losses).toBe(2);
  });

  it('clears the loss when the context comes back', () => {
    recordContextCreated({ powerPreference: 'default', antialias: false });
    recordContextLost();

    recordContextRestored();

    expect(readContextState()).toMatchObject({ lost: false, losses: 1 });
  });
});

describe('scheduleContextRestore', () => {
  /** Collects the callbacks a scheduler was handed, so they can be run by hand. */
  const fakeScheduler = () => {
    const queued: Array<{ fn: () => void; delay: number }> = [];
    const schedule = (fn: () => void, delay: number) => {
      queued.push({ fn, delay });
      return 0 as unknown as ReturnType<typeof setTimeout>;
    };
    return { queued, schedule };
  };

  it('does not ask during the lost event, which the spec ignores', () => {
    const { queued, schedule } = fakeScheduler();
    let restores = 0;

    scheduleContextRestore(() => (restores += 1), () => true, schedule);

    expect(restores).toBe(0);
    expect(queued[0].delay).toBe(RESTORE_DELAYS_MS[0]);
  });

  it('keeps asking, with more patience each time', () => {
    const { queued, schedule } = fakeScheduler();

    scheduleContextRestore(() => {}, () => true, schedule);
    queued[0].fn();
    queued[1].fn();

    expect(queued.map((q) => q.delay)).toEqual(RESTORE_DELAYS_MS.slice(0, 3));
  });

  it('stops once the context is back', () => {
    const { queued, schedule } = fakeScheduler();
    let lost = true;
    let restores = 0;

    scheduleContextRestore(
      () => {
        restores += 1;
        lost = false;
      },
      () => lost,
      schedule,
    );
    queued[0].fn();

    expect(restores).toBe(1);
    // Nothing further is queued: the scene is drawing again.
    expect(queued).toHaveLength(1);
  });

  it('gives up rather than retrying for ever', () => {
    const { queued, schedule } = fakeScheduler();

    scheduleContextRestore(() => {}, () => true, schedule);
    for (let i = 0; i < 10 && queued[i]; i += 1) queued[i].fn();

    expect(queued).toHaveLength(RESTORE_DELAYS_MS.length);
  });
});
