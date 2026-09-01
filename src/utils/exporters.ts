/**
 * Pure helpers that build GPX / GeoJSON document payloads from a workout
 * session, a route, or an attached track.
 *
 * The FIT activity file is *not* built here: it is binary, and
 * `services/fitEncoderService` owns it behind a dynamic import (issue #221).
 *
 * Extracted from `App.tsx` so the (string-building) format logic can be unit
 * tested without rendering the whole app or stubbing `URL.createObjectURL` /
 * DOM download machinery. The DOM-side "trigger a download" step still lives
 * in `App.tsx` (see {@link triggerBlobDownload}).
 */
import type { Coordinate, WorkoutSession, WaterRoute } from '../types/index';
import type { AttachedTrack } from '../services/trackAttachmentStore';

/**
 * Build a GPX 1.1 document representing the route polyline travelled during
 * `session`. The session metadata is encoded in `<metadata>` and `<trk><name>`;
 * track points come from `route.coordinates`.
 */
export function buildSessionGPX(session: WorkoutSession, route: WaterRoute): string {
  const startTime = new Date(session.startTime).toISOString();
  const routeName = escapeXml(session.routeName);
  const rowedDistanceMeters = escapeXml(String(session.distance));
  const trkpts = route.coordinates
    .map((c) => `      <trkpt lat="${c.lat}" lon="${c.lng}"><ele>0</ele></trkpt>`)
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="VirtualRow" xmlns:virtualrow="https://virtualrow.app/xmlns/1">
  <metadata>
    <name>${routeName}</name>
    <time>${startTime}</time>
    <extensions>
      <virtualrow:rowed_distance_m>${rowedDistanceMeters}</virtualrow:rowed_distance_m>
    </extensions>
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

/** RFC 7946 GeoJSON Feature for an attached track. */
export interface TrackGeoJSON {
  type: 'Feature';
  geometry: {
    type: 'LineString';
    coordinates: [number, number][];
  };
  properties: {
    courseId: string;
    courseName: string;
    source: 'virtualrow-attached-track';
    exportedAt: string;
  };
}

/**
 * Build a GeoJSON Feature (RFC 7946) from an attached track.
 *
 * Coordinates are emitted in `[lng, lat]` order per the spec. The Feature's
 * `properties` carry provenance so the file is self-describing when shared.
 */
export function buildAttachedTrackGeoJSON(
  track: AttachedTrack,
  courseName: string,
  now = new Date(),
): TrackGeoJSON {
  return {
    type: 'Feature',
    geometry: {
      type: 'LineString',
      coordinates: track.coordinates.map((c: Coordinate) => [c.lng, c.lat]),
    },
    properties: {
      courseId: track.courseId,
      courseName,
      source: 'virtualrow-attached-track',
      exportedAt: now.toISOString(),
    },
  };
}

/** Sanitise a name into a URL-safe slug for filenames. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'track';
}

/**
 * The filename a session's activity file is saved or uploaded under
 * (issue #221, AC4.4), e.g. `willowbrook-river-2026-03-14.fit`.
 *
 * Shared by the download button and the upload service so the athlete's disk
 * and their training log agree on what the row is called.
 */
export function activityFileName(session: WorkoutSession, extension = 'fit'): string {
  const date = new Date(session.startTime).toISOString().slice(0, 10);
  return `${slugify(session.routeName)}-${date}.${extension}`;
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
