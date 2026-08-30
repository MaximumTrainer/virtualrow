import { describe, expect, it, beforeEach } from 'vitest';
import { TrackAttachmentStore, trackAttachmentStore } from '../services/trackAttachmentStore';
import {
  TrackParseError,
  detectTrackFormat,
  parseTrackFile,
} from '../utils/trackParsers';
import type { Coordinate } from '../types/index';

/** The same three points, written three ways (issue #194 AC-11). */
const POINTS: Coordinate[] = [
  { lat: 55.938444, lng: -4.565349 },
  { lat: 55.92, lng: -4.5 },
  { lat: 55.857852, lng: -4.284972 },
];

const GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><trkseg>
${POINTS.map((p) => `    <trkpt lat="${p.lat}" lon="${p.lng}" />`).join('\n')}
  </trkseg></trk>
</gpx>`;

const KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><LineString><coordinates>
${POINTS.map((p) => `${p.lng},${p.lat},0`).join(' ')}
</coordinates></LineString></Placemark></Document></kml>`;

const GEOJSON = JSON.stringify({
  type: 'Feature',
  properties: {},
  geometry: { type: 'LineString', coordinates: POINTS.map((p) => [p.lng, p.lat]) },
});

describe('track file parsing (AC-11)', () => {
  it('reads the same line out of GPX, KML and GeoJSON', () => {
    expect(parseTrackFile('track.gpx', GPX)).toEqual(POINTS);
    expect(parseTrackFile('track.kml', KML)).toEqual(POINTS);
    expect(parseTrackFile('track.geojson', GEOJSON)).toEqual(POINTS);
  });

  it('falls back to route points when a GPX has no track points', () => {
    const routeOnly = GPX.replace(/trkpt/g, 'rtept').replace(/trkseg/g, 'rte').replace(/<trk>|<\/trk>/g, '');
    expect(parseTrackFile('route.gpx', routeOnly)).toEqual(POINTS);
  });

  it('reads a MultiLineString and a FeatureCollection', () => {
    const multi = JSON.stringify({
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'MultiLineString', coordinates: [POINTS.slice(0, 2).map((p) => [p.lng, p.lat])] },
      }],
    });
    expect(parseTrackFile('multi.geojson', multi)).toEqual(POINTS.slice(0, 2));
  });

  it('names the formats it can read rather than silently ignoring a file', () => {
    expect(detectTrackFormat('photo.png')).toBeNull();
    expect(() => parseTrackFile('photo.png', 'not a track')).toThrow(TrackParseError);
    expect(() => parseTrackFile('photo.png', 'not a track')).toThrow(/\.gpx, \.kml or \.geojson/);
  });

  it('rejects a file with fewer than two usable points', () => {
    const single = GPX.replace(/<trkpt(?![^>]*55\.938)[^>]*\/>/g, '');
    expect(() => parseTrackFile('single.gpx', single)).toThrow(/at least 2 points/);
  });

  it('rejects malformed XML and JSON', () => {
    expect(() => parseTrackFile('bad.gpx', '<gpx><trk>')).toThrow(TrackParseError);
    expect(() => parseTrackFile('bad.geojson', '{ not json')).toThrow(TrackParseError);
  });
});

describe('track attachments (AC-11)', () => {
  beforeEach(() => {
    trackAttachmentStore.clear();
  });

  it('survives a reload and is found again by course id', () => {
    trackAttachmentStore.set('179', 'clyde.gpx', POINTS);

    // A fresh store reads the same browser storage a page reload would.
    const afterReload = new TrackAttachmentStore();
    expect(afterReload.getCoordinates('179')).toEqual(POINTS);
    expect(afterReload.get('179')?.fileName).toBe('clyde.gpx');
  });

  it('reverts to the next source when the track is removed', () => {
    trackAttachmentStore.set('179', 'clyde.gpx', POINTS);
    trackAttachmentStore.remove('179');

    expect(trackAttachmentStore.getCoordinates('179')).toBeNull();
    expect(trackAttachmentStore.list()).toHaveLength(0);
  });

  it('lists attachments newest first and replaces one in place', () => {
    trackAttachmentStore.set('1', 'a.gpx', POINTS, 1000);
    trackAttachmentStore.set('179', 'b.gpx', POINTS, 2000);
    trackAttachmentStore.set('1', 'c.gpx', POINTS, 3000);

    expect(trackAttachmentStore.list().map((track) => track.courseId)).toEqual(['1', '179']);
    expect(trackAttachmentStore.get('1')?.fileName).toBe('c.gpx');
  });

  it('discards unusable points and treats a too-short track as absent', () => {
    trackAttachmentStore.set('9', 'junk.gpx', [
      { lat: 55.9, lng: -4.5 },
      { lat: Number.NaN, lng: -4.5 },
      { lat: 999, lng: -4.5 },
    ]);

    expect(trackAttachmentStore.getCoordinates('9')).toBeNull();
  });

  it('never throws when browser storage is unavailable', () => {
    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', {
      value: {
        getItem() { throw new Error('blocked'); },
        setItem() { throw new Error('blocked'); },
      },
      configurable: true,
    });

    try {
      const store = new TrackAttachmentStore();
      expect(() => store.set('1', 'a.gpx', POINTS)).not.toThrow();
      expect(store.getCoordinates('1')).toBeNull();
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { value: original, configurable: true });
    }
  });
});
