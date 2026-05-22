/**
 * Pure helpers that build GPX / FIT-JSON document payloads from a workout
 * session + its associated route.
 *
 * Extracted from `App.tsx` so the (string-building) format logic can be unit
 * tested without rendering the whole app or stubbing `URL.createObjectURL` /
 * DOM download machinery. The DOM-side "trigger a download" step still lives
 * in `App.tsx` (see {@link triggerBlobDownload}).
 */
import type { WorkoutSession, WaterRoute } from '../types/index';

/**
 * Build a GPX 1.1 document representing the route polyline travelled during
 * `session`. The session metadata is encoded in `<metadata>` and `<trk><name>`;
 * track points come from `route.coordinates`.
 */
export function buildSessionGPX(session: WorkoutSession, route: WaterRoute): string {
  const startTime = new Date(session.startTime).toISOString();
  const routeName = escapeXml(session.routeName);
  const trkpts = route.coordinates
    .map((c) => `      <trkpt lat="${c.lat}" lon="${c.lng}"><ele>0</ele></trkpt>`)
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="VirtualRow">
  <metadata>
    <name>${routeName}</name>
    <time>${startTime}</time>
  </metadata>
  <trk>
    <name>${routeName}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Convert a session ID to a deterministic numeric serial:
 *  - Numeric IDs (e.g. `Date.now()` strings) are parsed as integers.
 *  - Non-numeric IDs are converted by summing UTF-16 code units.
 *
 * Exported separately so callers and tests can verify the mapping.
 */
export function sessionIdToSerialNumber(id: string): number {
  if (/^\d+$/.test(id)) return parseInt(id, 10);
  return id.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
}

/** Shape of the JSON document produced by {@link buildSessionFITPayload}. */
export interface FITSessionPayload {
  file_id: {
    type: 'activity';
    manufacturer: 'VirtualRow';
    product: number;
    serial_number: number;
    time_created: string;
  };
  activity: {
    timestamp: string;
    total_timer_time: number;
    num_sessions: 1;
    type: 'manual';
  };
  session: {
    timestamp: string;
    start_time: string;
    total_elapsed_time: number;
    total_timer_time: number;
    total_distance: number;
    total_calories: number;
    avg_pace: number;
    avg_heart_rate: number | undefined;
    max_heart_rate: number | undefined;
    sport: 'rowing';
    sub_sport: 'indoor_rowing';
  };
  records: Array<{
    timestamp: string;
    distance: number;
    pace: number;
    power: number | undefined;
    heart_rate: number | undefined;
  }>;
}

/**
 * Build a JSON document approximating the FIT activity file structure.
 *
 * NOTE: True FIT files are binary; this helper emits a JSON projection that
 * downstream tools (or a future FIT encoder) can consume. The shape is kept
 * intentionally close to FIT field names so the eventual binary encoder is a
 * mechanical conversion.
 */
export function buildSessionFITPayload(session: WorkoutSession): FITSessionPayload {
  const ts = new Date(session.startTime).toISOString();
  return {
    file_id: {
      type: 'activity',
      manufacturer: 'VirtualRow',
      product: 1,
      serial_number: sessionIdToSerialNumber(session.id),
      time_created: ts,
    },
    activity: {
      timestamp: ts,
      total_timer_time: session.duration,
      num_sessions: 1,
      type: 'manual',
    },
    session: {
      timestamp: ts,
      start_time: ts,
      total_elapsed_time: session.duration,
      total_timer_time: session.duration,
      total_distance: session.distance,
      total_calories: session.calories,
      avg_pace: session.averagePace,
      avg_heart_rate: session.heartRateAvg,
      max_heart_rate: session.heartRateMax,
      sport: 'rowing',
      sub_sport: 'indoor_rowing',
    },
    records: session.splits.map((split) => ({
      timestamp: new Date(split.timestamp).toISOString(),
      distance: split.distance,
      pace: split.pace,
      power: split.power,
      heart_rate: split.heartRate,
    })),
  };
}

/**
 * Programmatically trigger a browser download of `content` with the given
 * MIME type and filename. Kept isolated so the format-building helpers above
 * remain pure / unit-testable in jsdom.
 */
export function triggerBlobDownload(content: string, mimeType: string, filename: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
