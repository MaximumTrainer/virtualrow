import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AudioService } from '../services/audioService';

/**
 * Issue #339 — sound, synthesised rather than downloaded.
 *
 * Every sound in the app is made from noise and sine waves at runtime: no
 * asset to license, nothing to fetch, and a stroke that sounds like the stroke
 * that made it, because its loudness comes from the stroke.
 *
 * The AudioContext is injected rather than stubbed into `setupTests.ts`. A
 * global fake applies to every suite whether it asked for one or not, and a
 * test that comes to depend on it by accident says nothing about this service;
 * injected, the fake is visible in the test that uses it.
 */

/** The parts of the Web Audio graph this service actually touches. */
const fakeContext = () => {
  const connections: string[] = [];
  const started: string[] = [];
  const stopped: string[] = [];
  const gains: { gain: { value: number } }[] = [];

  const node = (kind: string) => ({
    kind,
    connect: vi.fn((to: { kind: string }) => {
      connections.push(kind + '->' + to.kind);
      return to;
    }),
    disconnect: vi.fn(),
  });

  const ctx = {
    state: 'suspended',
    currentTime: 0,
    sampleRate: 48_000,
    destination: node('destination'),
    resume: vi.fn(async () => {
      ctx.state = 'running';
    }),
    close: vi.fn(async () => {
      ctx.state = 'closed';
    }),
    createGain: vi.fn(() => {
      const g = {
        ...node('gain'),
        gain: {
          value: 1,
          setValueAtTime: vi.fn(),
          linearRampToValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn(),
        },
      };
      gains.push(g);
      return g;
    }),
    createBuffer: vi.fn((_channels: number, length: number) => ({
      length,
      getChannelData: () => new Float32Array(length),
    })),
    createBufferSource: vi.fn(() => ({
      ...node('bufferSource'),
      buffer: null as unknown,
      loop: false,
      start: vi.fn(() => started.push('bufferSource')),
      stop: vi.fn(() => stopped.push('bufferSource')),
    })),
    createOscillator: vi.fn(() => ({
      ...node('oscillator'),
      type: 'sine',
      frequency: { value: 0, setValueAtTime: vi.fn() },
      start: vi.fn(() => started.push('oscillator')),
      stop: vi.fn(() => stopped.push('oscillator')),
    })),
    createBiquadFilter: vi.fn(() => ({
      ...node('filter'),
      type: '',
      frequency: { value: 0 },
      Q: { value: 0 },
    })),
  };

  return { ctx, connections, started, stopped, gains };
};

let fake: ReturnType<typeof fakeContext>;
let created: number;

const service = () => {
  created = 0;
  return new AudioService(() => {
    created += 1;
    return fake.ctx as unknown as AudioContext;
  });
};

beforeEach(() => {
  fake = fakeContext();
});

describe('sound before it is switched on', () => {
  /**
   * The Gherkin's first line, and the browser's autoplay policy.
   *
   * Constructing an AudioContext without a gesture leaves a suspended context
   * behind and, in some browsers, a console warning on every load.
   */
  it('creates no AudioContext at all', () => {
    const audio = service();

    audio.splash();
    audio.cue();
    audio.startWater();

    expect(created).toBe(0);
    expect(audio.isEnabled()).toBe(false);
  });

  it('remembers a volume set before there is anything to play it through', async () => {
    const audio = service();

    audio.setVolume(0.4);
    await audio.enable();

    expect(fake.gains[0].gain.value).toBeCloseTo(0.4, 6);
  });
});

describe('sound once it is switched on', () => {
  it('opens one context however many times it is enabled', async () => {
    const audio = service();

    await audio.enable();
    await audio.enable();

    expect(created).toBe(1);
    expect(audio.isEnabled()).toBe(true);
  });

  // A context built outside a gesture starts suspended, and a suspended
  // context plays nothing while reporting no error at all.
  it('resumes the context rather than assuming it is running', async () => {
    const audio = service();

    await audio.enable();

    expect(fake.ctx.resume).toHaveBeenCalled();
    expect(fake.ctx.state).toBe('running');
  });

  it('plays a splash as filtered noise through the master gain', async () => {
    const audio = service();
    await audio.enable();

    audio.splash();

    expect(fake.ctx.createBufferSource).toHaveBeenCalledTimes(1);
    expect(fake.started).toContain('bufferSource');
    expect(fake.connections).toContain('bufferSource->filter');
    expect(fake.connections).toContain('filter->gain');
  });

  // The stroke's own loudness: a light paddle and a racing catch are the same
  // sound at different volumes, which is what makes it feel connected.
  it('plays a harder catch louder than a gentle one', async () => {
    const audio = service();
    await audio.enable();

    audio.splash(0.2);
    const gentle = fake.gains[fake.gains.length - 1].gain.value;
    audio.splash(1);
    const hard = fake.gains[fake.gains.length - 1].gain.value;

    expect(hard).toBeGreaterThan(gentle);
  });

  it('plays a cue as a sine that stops on its own', async () => {
    const audio = service();
    await audio.enable();

    audio.cue(880, 120);

    expect(fake.ctx.createOscillator).toHaveBeenCalledTimes(1);
    expect(fake.started).toContain('oscillator');
    expect(fake.stopped).toContain('oscillator');
  });

  it('writes the volume straight onto the master gain', async () => {
    const audio = service();
    await audio.enable();

    audio.setVolume(0.25);

    expect(fake.gains[0].gain.value).toBeCloseTo(0.25, 6);
    expect(audio.getVolume()).toBeCloseTo(0.25, 6);
  });

  // A volume above 1 clips; a negative one inverts the waveform.
  it('keeps the volume inside what an amplifier can do', () => {
    const audio = service();

    audio.setVolume(4);
    expect(audio.getVolume()).toBe(1);

    audio.setVolume(-1);
    expect(audio.getVolume()).toBe(0);
  });
});

describe('the water bed', () => {
  it('loops rather than playing once and stopping', async () => {
    const audio = service();
    await audio.enable();

    audio.startWater();

    const source = fake.ctx.createBufferSource.mock.results[0].value;
    expect(source.loop).toBe(true);
    expect(fake.started).toContain('bufferSource');
  });

  it('is one bed, however many times it is asked for', async () => {
    const audio = service();
    await audio.enable();

    audio.startWater();
    audio.startWater();

    expect(fake.ctx.createBufferSource).toHaveBeenCalledTimes(1);
  });

  it('stops when it is told to, and can start again', async () => {
    const audio = service();
    await audio.enable();

    audio.startWater();
    audio.stopWater();
    audio.startWater();

    expect(fake.stopped).toContain('bufferSource');
    expect(fake.ctx.createBufferSource).toHaveBeenCalledTimes(2);
  });

  it('has nothing to stop when it never started', async () => {
    const audio = service();
    await audio.enable();

    expect(() => audio.stopWater()).not.toThrow();
  });
});

describe('switching sound back off', () => {
  /**
   * An AudioContext is a hardware handle, not a flag.
   *
   * Left open it holds the audio device awake, which on a laptop is a fan and
   * on a phone is battery — for a rower who has just turned the sound off.
   */
  it('closes the context and stops the water', async () => {
    const audio = service();
    await audio.enable();
    audio.startWater();

    await audio.disable();

    expect(fake.stopped).toContain('bufferSource');
    expect(fake.ctx.close).toHaveBeenCalled();
    expect(audio.isEnabled()).toBe(false);
  });

  it('can be switched on again afterwards', async () => {
    const audio = service();
    await audio.enable();
    await audio.disable();
    await audio.enable();

    expect(created).toBe(2);
    expect(audio.isEnabled()).toBe(true);
  });

  it('has nothing to close when it was never on', async () => {
    const audio = service();

    await expect(audio.disable()).resolves.toBeUndefined();
    expect(created).toBe(0);
  });
});

describe('a browser with no Web Audio at all', () => {
  // Older Safari, a hardened embedded browser, a page where the API is simply
  // unavailable: the row goes on in silence rather than failing.
  it('stays silent rather than throwing', async () => {
    const audio = new AudioService(() => {
      throw new Error('AudioContext is not defined');
    });

    await expect(audio.enable()).resolves.toBeUndefined();
    expect(audio.isEnabled()).toBe(false);
    expect(() => audio.splash()).not.toThrow();
  });
});
