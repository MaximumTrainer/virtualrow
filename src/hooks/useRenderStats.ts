import { useEffect, useState } from 'react';
import { readRenderStats, type RenderStats } from '../components/rower3d/sceneStats';
import { readContextState, type ContextState } from '../components/rower3d/glContext';

/** How stale a sample has to be before the render loop counts as stopped. */
export const STALL_THRESHOLD_MS = 2000;

export interface RenderStatsReading {
  stats: RenderStats | null;
  /** True when the scene has drawn nothing recently — a stalled or dead loop. */
  stalled: boolean;
  /** How the WebGL context was obtained, and whether it is still there. */
  context: ContextState | null;
}

/**
 * Poll the scene's per-frame cost for display (#232).
 *
 * Polled rather than pushed: the scene samples every frame, and re-rendering
 * React at that rate to show a number would cost more than the number is worth.
 * Only runs while something is actually showing the reading.
 */
export const useRenderStats = (enabled: boolean, intervalMs = 500): RenderStatsReading => {
  const [reading, setReading] = useState<RenderStatsReading>({
    stats: null,
    stalled: false,
    context: null,
  });

  useEffect(() => {
    if (!enabled) return;
    // Staleness is decided when the sample is taken, not when it is rendered:
    // a stalled scene keeps handing back the same object, and React would skip
    // the re-render that would have noticed.
    const read = () => {
      const stats = readRenderStats();
      setReading({
        stats,
        stalled: !!stats && Date.now() - stats.sampledAt > STALL_THRESHOLD_MS,
        context: readContextState(),
      });
    };
    read();
    const timer = setInterval(read, intervalMs);
    return () => clearInterval(timer);
  }, [enabled, intervalMs]);

  return reading;
};
