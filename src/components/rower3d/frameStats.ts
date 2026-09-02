// ============================================================================
// Frame-time instrumentation (#224).
//
// A mean frame time hides exactly the thing that ruins a row: the occasional
// long frame where a chunk builds or the collector runs. What matters is the
// tail, so this keeps a trailing window of raw frame deltas and reports
// percentiles off it.
// ============================================================================

/** Trailing window the percentiles are computed over. */
export const FRAME_STATS_WINDOW_SECONDS = 10;

/**
 * Longest delta still counted as a frame.
 *
 * A sanity bound only. It used to be one second, which quietly discarded every
 * sample on a software rasteriser — exactly the slow frames worth measuring —
 * and left the recorder reporting nothing at all. Skipping a backgrounded tab
 * is the caller's job: it knows whether the document was hidden, which a delta
 * alone cannot tell you (#224).
 */
const MAX_PLAUSIBLE_FRAME_SECONDS = 30;

export interface FrameStats {
  /** Frames in the window. */
  frames: number;
  /** Seconds the window actually spans. */
  windowSeconds: number;
  /** Mean frame rate across the window. */
  fps: number;
  p50Ms: number;
  p95Ms: number;
  /** The single worst frame in the window. */
  maxMs: number;
}

/**
 * Nearest-rank percentile over frame times in milliseconds.
 *
 * Sorts a copy: the caller's ring buffer is in arrival order and stays that way.
 */
export const percentileMs = (samplesMs: number[], percentile: number): number => {
  if (samplesMs.length === 0) return 0;
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const clamped = Math.max(0, Math.min(100, percentile));
  const rank = Math.ceil((clamped / 100) * sorted.length);
  return sorted[Math.max(0, rank - 1)];
};

export interface FrameStatsRecorder {
  /** Feed one `useFrame` delta, in seconds. */
  record: (deltaSeconds: number) => void;
  /** Percentiles over the trailing window, or `null` before the first frame. */
  read: () => FrameStats | null;
  /** Drop everything — a new route is a new measurement. */
  reset: () => void;
}

export const createFrameStatsRecorder = (
  windowSeconds: number = FRAME_STATS_WINDOW_SECONDS,
): FrameStatsRecorder => {
  const samplesMs: number[] = [];
  let spanSeconds = 0;

  return {
    record(deltaSeconds) {
      if (!Number.isFinite(deltaSeconds)) return;
      if (deltaSeconds <= 0 || deltaSeconds > MAX_PLAUSIBLE_FRAME_SECONDS) return;

      samplesMs.push(deltaSeconds * 1000);
      spanSeconds += deltaSeconds;

      while (spanSeconds > windowSeconds && samplesMs.length > 1) {
        spanSeconds -= samplesMs.shift()! / 1000;
      }
    },

    read() {
      if (samplesMs.length === 0) return null;
      return {
        frames: samplesMs.length,
        windowSeconds: spanSeconds,
        fps: spanSeconds > 0 ? samplesMs.length / spanSeconds : 0,
        p50Ms: percentileMs(samplesMs, 50),
        p95Ms: percentileMs(samplesMs, 95),
        maxMs: Math.max(...samplesMs),
      };
    },

    reset() {
      samplesMs.length = 0;
      spanSeconds = 0;
    },
  };
};
