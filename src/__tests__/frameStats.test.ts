import { describe, it, expect } from 'vitest';
import {
  createFrameStatsRecorder,
  percentileMs,
  FRAME_STATS_WINDOW_SECONDS,
} from '../components/rower3d/frameStats';

/** Feed `count` frames of `deltaSeconds` each into a recorder. */
const feed = (
  recorder: ReturnType<typeof createFrameStatsRecorder>,
  count: number,
  deltaSeconds: number,
) => {
  for (let i = 0; i < count; i++) recorder.record(deltaSeconds);
};

describe('percentileMs', () => {
  it('returns 0 for an empty sample', () => {
    expect(percentileMs([], 95)).toBe(0);
  });

  it('reads the worst frames at the top of the distribution', () => {
    const samples = [10, 10, 10, 10, 10, 10, 10, 10, 10, 40];
    expect(percentileMs(samples, 50)).toBe(10);
    expect(percentileMs(samples, 95)).toBe(40);
  });

  it('does not mutate the caller\u2019s array', () => {
    const samples = [30, 10, 20];
    percentileMs(samples, 50);
    expect(samples).toEqual([30, 10, 20]);
  });

  it('clamps a percentile outside 0..100', () => {
    const samples = [5, 15, 25];
    expect(percentileMs(samples, -10)).toBe(5);
    expect(percentileMs(samples, 200)).toBe(25);
  });
});

describe('frame stats recorder', () => {
  it('reports nothing until a frame has been seen', () => {
    expect(createFrameStatsRecorder().read()).toBeNull();
  });

  it('turns frame deltas into a frame rate', () => {
    const recorder = createFrameStatsRecorder();
    feed(recorder, 120, 1 / 60);

    const stats = recorder.read()!;
    expect(stats.frames).toBe(120);
    expect(stats.fps).toBeCloseTo(60, 0);
    expect(stats.p50Ms).toBeCloseTo(16.67, 1);
    expect(stats.p95Ms).toBeCloseTo(16.67, 1);
  });

  it('surfaces the slow frames a mean would hide', () => {
    const recorder = createFrameStatsRecorder();
    feed(recorder, 90, 1 / 120);
    feed(recorder, 10, 0.05); // a tenth of the frames stall for 50 ms

    const stats = recorder.read()!;
    expect(stats.p50Ms).toBeCloseTo(8.33, 1);
    expect(stats.p95Ms).toBeGreaterThan(40);
  });

  it('keeps only the trailing window, so an early stall stops counting', () => {
    const recorder = createFrameStatsRecorder();
    feed(recorder, 10, 0.2); // 2 s of very slow frames
    feed(recorder, 700, 1 / 60); // then ~11.7 s of good ones, past the window

    const stats = recorder.read()!;
    expect(stats.windowSeconds).toBeLessThanOrEqual(FRAME_STATS_WINDOW_SECONDS + 0.5);
    expect(stats.p95Ms).toBeCloseTo(16.67, 1);
  });

  it('ignores a delta that is not a usable frame time', () => {
    const recorder = createFrameStatsRecorder();
    recorder.record(0);
    recorder.record(-1);
    recorder.record(Number.NaN);
    expect(recorder.read()).toBeNull();

    recorder.record(1 / 60);
    expect(recorder.read()!.frames).toBe(1);
  });

  it('counts a genuinely slow frame rather than discarding it', () => {
    // A software rasteriser can take over a second on a frame. That is the
    // worst case the metric exists to surface, so it must not be filtered out.
    const recorder = createFrameStatsRecorder();
    feed(recorder, 20, 1.5);

    const stats = recorder.read()!;
    expect(stats.frames).toBeGreaterThan(0);
    expect(stats.maxMs).toBeCloseTo(1500, 0);
    expect(stats.fps).toBeLessThan(1);
  });

  it('ignores a delta no frame could plausibly have taken', () => {
    const recorder = createFrameStatsRecorder();
    feed(recorder, 60, 1 / 60);
    recorder.record(120);

    const stats = recorder.read()!;
    expect(stats.frames).toBe(60);
    expect(stats.p95Ms).toBeCloseTo(16.67, 1);
  });

  it('forgets everything when the route changes', () => {
    const recorder = createFrameStatsRecorder();
    feed(recorder, 30, 0.05);
    recorder.reset();
    expect(recorder.read()).toBeNull();
  });
});
