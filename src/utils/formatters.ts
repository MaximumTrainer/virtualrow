export function formatPace(paceSeconds: number | null): string {
  if (!paceSeconds || paceSeconds <= 0) {
    return '--:--';
  }

  const minutes = Math.floor(paceSeconds / 60);
  const seconds = Math.floor(paceSeconds % 60);
  return `${minutes}:${String(seconds).padStart(2, '0')}/500m`;
}

/**
 * Elapsed time as a rower reads it on a monitor: m:ss, and h:mm:ss once an
 * hour has gone by.
 *
 * It lived in `App.tsx` as a file-local helper until the metrics moved onto
 * the stage (#335) and a second component needed the same clock. Two spellings
 * of "how long have I been rowing" is one more than the screen can afford to
 * disagree about.
 */
export function formatTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}:${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}
