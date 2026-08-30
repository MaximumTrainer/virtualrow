/**
 * Track file parsing — GPX, KML and GeoJSON to a single `Coordinate[]`.
 *
 * One place for all three formats so the generic "Import Route" file input and
 * the rownative track-attach flow (issue #194 R-8) agree on what a file
 * contains. Before this existed the file input parsed the chosen file as JSON
 * whatever its extension, so a `.gpx` or `.kml` drop silently did nothing.
 */

import type { Coordinate } from '../types/index';
import { parseGeoJSONCoordinate, parseKMLCoordinateList } from './coordinateUtils';

/** Track formats the app can read. */
export type TrackFormat = 'gpx' | 'kml' | 'geojson';

/** A track file that could not be turned into a usable line. */
export class TrackParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TrackParseError';
  }
}

/**
 * Pick a parser from a file name.
 *
 * Returns `null` for extensions we do not handle, so callers can say so rather
 * than guessing and failing silently.
 */
export function detectTrackFormat(fileName: string): TrackFormat | null {
  const extension = fileName.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  switch (extension) {
    case 'gpx':
      return 'gpx';
    case 'kml':
      return 'kml';
    case 'geojson':
    case 'json':
      return 'geojson';
    default:
      return null;
  }
}

function isUsable(point: Coordinate): boolean {
  return (
    Number.isFinite(point.lat)
    && Number.isFinite(point.lng)
    && point.lat >= -90 && point.lat <= 90
    && point.lng >= -180 && point.lng <= 180
  );
}

/** Read `<trkpt>` points, falling back to `<rtept>` when a file has no track. */
export function parseGpxTrack(xml: string): Coordinate[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new TrackParseError('That GPX file could not be parsed as XML.');
  }

  for (const tagName of ['trkpt', 'rtept'] as const) {
    const nodes = Array.from(doc.getElementsByTagNameNS('*', tagName));
    if (nodes.length === 0) continue;
    const points = nodes
      .map((node) => ({
        lat: parseFloat(node.getAttribute('lat') ?? ''),
        lng: parseFloat(node.getAttribute('lon') ?? ''),
      }))
      .filter(isUsable);
    if (points.length > 0) return points;
  }

  return [];
}

/** Read every `<LineString>` in a KML file, concatenated in document order. */
export function parseKmlTrack(xml: string): Coordinate[] {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length > 0) {
    throw new TrackParseError('That KML file could not be parsed as XML.');
  }

  const points: Coordinate[] = [];
  for (const lineString of Array.from(doc.getElementsByTagNameNS('*', 'LineString'))) {
    const text = lineString.getElementsByTagNameNS('*', 'coordinates')[0]?.textContent ?? '';
    points.push(...parseKMLCoordinateList(text));
  }
  return points;
}

function collectGeoJsonGeometry(
  geometry: { type?: string; coordinates?: unknown } | null | undefined,
  into: Coordinate[],
): void {
  if (!geometry?.type) return;

  if (geometry.type === 'LineString') {
    for (const position of (geometry.coordinates as number[][]) ?? []) {
      const parsed = parseGeoJSONCoordinate(position);
      if (parsed) into.push(parsed);
    }
  } else if (geometry.type === 'MultiLineString') {
    for (const line of (geometry.coordinates as number[][][]) ?? []) {
      for (const position of line) {
        const parsed = parseGeoJSONCoordinate(position);
        if (parsed) into.push(parsed);
      }
    }
  } else if (geometry.type === 'GeometryCollection') {
    for (const child of (geometry as { geometries?: unknown[] }).geometries ?? []) {
      collectGeoJsonGeometry(child as { type?: string }, into);
    }
  }
}

/** Read `LineString` / `MultiLineString` geometry out of any GeoJSON envelope. */
export function parseGeoJsonTrack(text: string): Coordinate[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new TrackParseError('That file is not valid JSON.');
  }

  const points: Coordinate[] = [];
  const root = parsed as { type?: string; features?: unknown[]; geometry?: unknown };
  if (root?.type === 'FeatureCollection' && Array.isArray(root.features)) {
    for (const feature of root.features) {
      collectGeoJsonGeometry((feature as { geometry?: { type?: string } })?.geometry, points);
    }
  } else if (root?.type === 'Feature') {
    collectGeoJsonGeometry(root.geometry as { type?: string }, points);
  } else {
    collectGeoJsonGeometry(root as { type?: string }, points);
  }
  return points;
}

/**
 * Parse a track file of any supported format.
 *
 * @throws TrackParseError when the extension is unsupported, the file is
 *   malformed, or it holds fewer than two usable points.
 */
export function parseTrackFile(fileName: string, text: string): Coordinate[] {
  const format = detectTrackFormat(fileName);
  if (!format) {
    throw new TrackParseError(
      `${fileName} is not a track file VirtualRow can read. Use a .gpx, .kml or .geojson file.`,
    );
  }

  const points = format === 'gpx'
    ? parseGpxTrack(text)
    : format === 'kml'
      ? parseKmlTrack(text)
      : parseGeoJsonTrack(text);

  if (points.length < 2) {
    throw new TrackParseError(
      `${fileName} has no line with at least 2 points. `
      + 'GPX needs <trkpt> or <rtept>, KML needs a <LineString>, GeoJSON needs a LineString.',
    );
  }
  return points;
}
