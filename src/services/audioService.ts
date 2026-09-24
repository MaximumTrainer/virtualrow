/**
 * Sound, synthesised (issue #339).
 *
 * Rowing games lean on the catch to make the stroke feel connected to the
 * screen, and on a water bed to make the scene feel like a place. Every sound
 * here is made at runtime from noise and sine waves: nothing to fetch, nothing
 * to license, and a splash whose loudness comes from the stroke that caused it.
 *
 * Silent until a rower switches it on. A browser will not start an AudioContext
 * without a gesture, and one built anyway sits suspended, playing nothing and
 * reporting no error — so nothing is constructed until `enable()`.
 */

/** Builds the context. Injected so a test can supply the graph it inspects. */
export type AudioContextFactory = () => AudioContext;

const defaultFactory: AudioContextFactory = () => {
  const Ctor =
    (globalThis as unknown as { AudioContext?: new () => AudioContext }).AudioContext ??
    (globalThis as unknown as { webkitAudioContext?: new () => AudioContext }).webkitAudioContext;
  if (!Ctor) throw new Error('This browser has no Web Audio.');
  return new Ctor();
};

/** Loud enough to hear over an erg, quiet enough not to be the first thing changed. */
export const DEFAULT_VOLUME = 0.5;

const clampVolume = (value: number): number => Math.min(1, Math.max(0, value));

export class AudioService {
  private readonly createContext: AudioContextFactory;
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private water: AudioBufferSourceNode | null = null;
  private volume = DEFAULT_VOLUME;

  constructor(createContext: AudioContextFactory = defaultFactory) {
    this.createContext = createContext;
  }

  isEnabled(): boolean {
    return this.ctx !== null;
  }

  getVolume(): number {
    return this.volume;
  }

  /**
   * Open the audio device and resume it.
   *
   * Never rejects: a browser without Web Audio is a row in silence, not a row
   * that fails to start. Idempotent, because the settings panel and a keyboard
   * shortcut can both ask.
   */
  async enable(): Promise<void> {
    if (this.ctx) return;
    try {
      const ctx = this.createContext();
      const master = ctx.createGain();
      master.gain.value = this.volume;
      master.connect(ctx.destination);
      this.ctx = ctx;
      this.master = master;
      // A context built outside a user gesture starts suspended, and a
      // suspended context plays nothing while reporting no error at all.
      await ctx.resume();
    } catch {
      this.ctx = null;
      this.master = null;
    }
  }

  /**
   * Close the audio device.
   *
   * An AudioContext is a hardware handle, not a flag: left open it holds the
   * audio device awake, which is a fan on a laptop and battery on a phone —
   * for a rower who has just turned the sound off.
   */
  async disable(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    this.stopWater();
    this.ctx = null;
    this.master = null;
    try {
      await ctx.close();
    } catch {
      /* intentional: a context that will not close is already unusable */
    }
  }

  /** The master volume, kept across an enable/disable so it is not forgotten. */
  setVolume(volume: number): void {
    this.volume = clampVolume(volume);
    if (this.master) this.master.gain.value = this.volume;
  }

  /**
   * The catch, or the finish: a burst of band-passed noise that decays.
   *
   * `intensity` is the stroke's own loudness. A light paddle and a racing catch
   * are the same sound at different volumes, which is what makes the sound feel
   * like it came from the stroke rather than from a button.
   */
  splash(intensity = 1): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;

    const source = ctx.createBufferSource();
    source.buffer = this.noise(0.25, (i, length) => Math.exp(-i / (length * 0.18)));

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 1_800;
    filter.Q.value = 0.7;

    const gain = ctx.createGain();
    gain.gain.value = 0.35 * clampVolume(intensity);

    source.connect(filter).connect(gain).connect(master);
    source.start();
  }

  /** A countdown or finish cue: a sine with a short attack and release. */
  cue(frequency = 880, ms = 120): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master) return;

    const now = ctx.currentTime;
    const seconds = ms / 1000;
    const oscillator = ctx.createOscillator();
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;

    // Ramped rather than switched: a sine that starts at full amplitude begins
    // with a step, and a step is a click.
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(0.25, now + 0.01);
    gain.gain.linearRampToValueAtTime(0, now + seconds);

    oscillator.connect(gain).connect(master);
    oscillator.start();
    oscillator.stop(now + seconds);
  }

  /** The water bed: two seconds of band-passed noise, looped. */
  startWater(): void {
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || this.water) return;

    const source = ctx.createBufferSource();
    source.buffer = this.noise(2, () => 1);
    source.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 500;
    filter.Q.value = 0.4;

    const gain = ctx.createGain();
    gain.gain.value = 0.08;

    source.connect(filter).connect(gain).connect(master);
    source.start();
    this.water = source;
  }

  stopWater(): void {
    const water = this.water;
    if (!water) return;
    this.water = null;
    try {
      water.stop();
      water.disconnect();
    } catch {
      /* intentional: a source that already ended throws on a second stop */
    }
  }

  /**
   * White noise, shaped by an envelope.
   *
   * Mono: a splash is a point in space and the scene has no stereo field to
   * place it in, so a second channel would be the same numbers twice.
   */
  private noise(seconds: number, envelope: (i: number, length: number) => number): AudioBuffer {
    const ctx = this.ctx!;
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) {
      data[i] = (Math.random() * 2 - 1) * envelope(i, length);
    }
    return buffer;
  }
}

export const audioService = new AudioService();
