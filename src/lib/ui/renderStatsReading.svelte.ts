// ============================================================================
// RENDER-STATS READING (runes), ported from `src/hooks/useRenderStats.ts`.
//
// Polls the scene's per-frame cost for the debug panel (#232). Polled rather
// than pushed: the engine samples every frame, and re-rendering to show a
// number at that rate would cost more than the number is worth. Only runs while
// the panel is open. The reading is empty until the engine publishes through
// the `renderStats` seam.
// ============================================================================

import { readRenderStatsReading, type RenderStatsReading } from '../renderer/renderStats';

export class RenderStatsReadingStore {
  reading = $state<RenderStatsReading>({ stats: null, stalled: false, context: null });

  #timer: ReturnType<typeof setInterval> | null = null;
  readonly #intervalMs: number;

  constructor(intervalMs = 500) {
    this.#intervalMs = intervalMs;
  }

  /** Start or stop polling. Idempotent. Call from an `$effect` on panel open. */
  setEnabled(enabled: boolean): void {
    if (enabled) {
      if (this.#timer !== null) return;
      this.#read();
      this.#timer = setInterval(() => this.#read(), this.#intervalMs);
    } else {
      this.stop();
    }
  }

  stop(): void {
    if (this.#timer !== null) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }

  #read(): void {
    // Staleness is decided when the sample is taken, not when it is rendered:
    // a stalled scene keeps handing back the same object.
    this.reading = readRenderStatsReading();
  }
}
