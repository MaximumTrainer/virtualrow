export function formatPace(paceSeconds: number | null): string {
  if (!paceSeconds || paceSeconds <= 0) {
    return '--:--';
  }

  const minutes = Math.floor(paceSeconds / 60);
  const seconds = Math.floor(paceSeconds % 60);
  return `${minutes}:${String(seconds).padStart(2, '0')}/500m`;
}
