import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  probeRenderCapabilities,
  selectBrowserGlOptions,
  resetProbeCacheForTests,
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

// Both caches here outlive a test: the probe answers and the configuration the
// driver granted. Cleared before every test in the file rather than per
// describe, because a test answered from another's cache opens no context and
// then reports a count of zero for a reason that is not visible in the failure.
beforeEach(() => {
  resetProbeCacheForTests();
  clearContextState();
});

/** The preferences the high and low tiers bring to the probe. */
const HIGH = { preferred: { powerPreference: 'high-performance' as const, antialias: true } };
const LOW = { preferred: { powerPreference: 'low-power' as const, antialias: false } };

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
    const selection = selectGlOptions(attemptAllowing([{}]), HIGH);

    expect(selection).toMatchObject({ powerPreference: 'high-performance', antialias: true });
    expect(selection.fallbackReason).toBeUndefined();
  });

  it('falls back to the default adapter when the preferred one will not open', () => {
    // The hybrid-laptop case: asking for high-performance routes to a discrete
    // GPU whose driver refuses the context.
    const attempt = attemptAllowing([{ powerPreference: 'default' }], 'eglCreateContext failed');

    const selection = selectGlOptions(attempt, HIGH);

    expect(selection).toMatchObject({ powerPreference: 'default', antialias: true });
    expect(selection.fallbackReason).toContain('eglCreateContext failed');
  });

  it('gives up multisampling before it gives up rendering', () => {
    const attempt = attemptAllowing([{ antialias: false }], 'out of memory');

    const selection = selectGlOptions(attempt, HIGH);

    expect(selection.antialias).toBe(false);
    expect(selection.fallbackReason).toContain('out of memory');
  });

  it('never trades away resolution to get a context', () => {
    const selection = selectGlOptions(attemptAllowing([{ antialias: false }]), HIGH);

    // dpr is the caller's business and nothing here should propose changing it.
    expect(selection).not.toHaveProperty('dpr');
  });

  it('reports that nothing worked rather than pretending', () => {
    const selection = selectGlOptions(attemptAllowing([], 'no adapters'), HIGH);

    expect(selection.usable).toBe(false);
    expect(selection.fallbackReason).toContain('no adapters');
  });

  it('asks for the low-power adapter when the scene is in low quality', () => {
    const attempt = attemptAllowing([{}]);

    const selection = selectGlOptions(attempt, LOW);

    expect(selection.powerPreference).toBe('low-power');
    expect(selection.antialias).toBe(false);
  });

  it('tries the preferred configuration first', () => {
    const attempt = attemptAllowing([{ powerPreference: 'default' }]);

    selectGlOptions(attempt, HIGH);

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
    recordContextCreated({
      powerPreference: 'default',
      antialias: true,
      maxDpr: 1.5,
      fallbackReason: 'refused',
    });

    expect(readContextState()).toMatchObject({
      powerPreference: 'default',
      lost: false,
      maxDpr: 1.5,
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

  /**
   * Giving up quietly is what the rower saw (#309).
   *
   * Probed on the demo row: the context was lost, the three attempts ran out
   * at about 5.8 s, and the stage went on saying "restoring..." for the next
   * sixteen seconds and would have said it for ever. The schedule knows when
   * it has finished and was the only thing that did.
   */
  it('says when it has stopped asking', () => {
    const { queued, schedule } = fakeScheduler();
    let exhausted = 0;

    scheduleContextRestore(() => {}, () => true, schedule, () => (exhausted += 1));
    for (let i = 0; i < 10 && queued[i]; i += 1) queued[i].fn();

    expect(exhausted, 'the scene was never told the asking had stopped').toBe(1);
  });

  it('does not say so while it is still asking', () => {
    const { queued, schedule } = fakeScheduler();
    let exhausted = 0;

    scheduleContextRestore(() => {}, () => true, schedule, () => (exhausted += 1));
    queued[0].fn();

    expect(exhausted).toBe(0);
  });

  it('does not say so when the context came back', () => {
    const { queued, schedule } = fakeScheduler();
    let lost = true;
    let exhausted = 0;

    scheduleContextRestore(
      () => { lost = false; },
      () => lost,
      schedule,
      () => (exhausted += 1),
    );
    for (let i = 0; i < 10 && queued[i]; i += 1) queued[i].fn();

    expect(exhausted, 'a recovered scene was told the asking had failed').toBe(0);
  });

  it('works without being given anywhere to report it', () => {
    // The callback is optional, and every existing call-site omits it.
    const { queued, schedule } = fakeScheduler();

    expect(() => {
      scheduleContextRestore(() => {}, () => true, schedule);
      for (let i = 0; i < 10 && queued[i]; i += 1) queued[i].fn();
    }).not.toThrow();
  });
});

describe('device probes are asked once (#261)', () => {
  /**
   * Probing is a property of the machine, not of a component instance, and
   * every probe opens a throwaway WebGL context. Measured on the demo row,
   * probeRenderCapabilities ran four times and selectGlOptions four more —
   * eleven contexts for one scene, against a browser that keeps only a handful
   * alive. Caching the answer is what stops the churn.
   */
  beforeEach(() => {
    resetProbeCacheForTests();
  });

  it('probes the device once however often it is asked', () => {
    let contexts = 0;
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      if (tag !== 'canvas') return realCreate(tag);
      contexts += 1;
      return {
        getContext: () => ({
          getParameter: () => 4096,
          getExtension: () => ({ loseContext: () => {} }),
        }),
      } as unknown as HTMLCanvasElement;
    }) as typeof document.createElement);

    try {
      const first = probeRenderCapabilities();
      const second = probeRenderCapabilities();
      const third = probeRenderCapabilities();

      expect(contexts, 'the device was probed more than once').toBe(1);
      expect(second).toBe(first);
      expect(third).toBe(first);
    } finally {
      vi.restoreAllMocks();
    }
  });

});

describe('a live scene context is never risked on another probe (#context-loss)', () => {
  /**
   * The selection cache is keyed on what was asked for, so a settings change
   * mid-session asked the driver a *new* question — and every question opens a
   * throwaway context. A browser keeps only a handful alive and evicts the
   * oldest, which by then is the scene's own: measured on the demo row, the
   * scene's context was created first at ~1.4s, a probe opened a new one at
   * ~3.7s, and the scene lost its context at ~5.2s and showed 'The 3D view
   * lost the graphics context - restoring...' over the river.
   *
   * Once a context is live the question is already answered for this page, so
   * the granted selection is reused rather than re-probed.
   */

  const countingCanvas = () => {
    let contexts = 0;
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      if (tag !== 'canvas') return realCreate(tag);
      contexts += 1;
      return {
        addEventListener: () => {},
        removeEventListener: () => {},
        getContext: () => ({
          getParameter: () => 4096,
          getExtension: () => ({ loseContext: () => {} }),
        }),
      } as unknown as HTMLCanvasElement;
    }) as typeof document.createElement);
    return () => contexts;
  };

  it('opens no new context for a different request while the scene is drawing', () => {
    const contexts = countingCanvas();
    try {
      const granted = selectBrowserGlOptions({ powerPreference: 'high-performance', antialias: true });
      expect(granted.usable).toBe(true);
      const afterFirst = contexts();
      expect(afterFirst).toBeGreaterThan(0);

      // The scene is now drawing into a real context.
      recordContextCreated({ powerPreference: granted.powerPreference, antialias: granted.antialias });

      // A settings change asks a different question. It must not cost a context.
      const later = selectBrowserGlOptions({ powerPreference: 'default', antialias: false });

      expect(contexts(), 'a probe context was opened while the scene was drawing').toBe(afterFirst);
      expect(later.usable, 'the reused selection must still be usable').toBe(true);

      // And it must still be the surface that was asked for.
      //
      // Reuse used to hand back whatever the driver granted last, for whatever
      // tier asked - so a low-power, no-antialias request received the
      // high-performance adapter and MSAA that a previous request had been
      // given. canvasSurface.ts exists precisely so a tier cannot acquire a
      // setting it has no business asking for, and Rower3D feeds these
      // straight into <Canvas gl={...}>. This assertion was the one missing
      // from the test, which is how the wrong value got tested into place
      // (#297).
      expect(later.antialias, 'a tier was granted multisampling it did not ask for').toBe(false);
      expect(
        later.powerPreference,
        'a tier was granted a richer adapter than it asked for',
      ).toBe('default');
    } finally {
      vi.restoreAllMocks();
    }
  });

  it('still probes a new request when no scene context is live', () => {
    const contexts = countingCanvas();
    try {
      selectBrowserGlOptions({ powerPreference: 'high-performance', antialias: true });
      const afterFirst = contexts();
      selectBrowserGlOptions({ powerPreference: 'default', antialias: false });
      expect(contexts(), 'with nothing drawing, a new request is worth a probe').toBeGreaterThan(afterFirst);
    } finally {
      vi.restoreAllMocks();
    }
  });
});
