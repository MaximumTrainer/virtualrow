import { describe, it, expect, beforeEach } from 'vitest';
import { RownativeService } from '../services/rownativeService';
import { TrackAttachmentStore } from '../services/trackAttachmentStore';
import type { Coordinate, WaterRoute } from '../types/index';

/**
 * Attaching a track, as something a person can actually do (#313).
 *
 * Every piece of this existed and none of it was reachable. `parseTrackFile`
 * read the file, `fitCandidateToGates` checked it against the course's own
 * gates, `TrackAttachmentStore` kept it, and `resolveCourseGeometry` put it
 * first in the precedence chain — but nothing joined them up, so no rower
 * could attach anything and the E2E covering it wrote the attachment straight
 * into localStorage.
 *
 * This is the join: one call that takes the bytes a file input hands over and
 * either stores a validated track or says why it will not.
 */

/** A course whose gates sit on the line below, 24 m apart at the ends. */
const COURSE_ID = '179';

/** Start, a midpoint and finish, on the Clyde. */
const ON_LINE: Coordinate[] = [
  { lat: 55.938444, lng: -4.565349 },
  { lat: 55.92, lng: -4.5 },
  { lat: 55.857852, lng: -4.284972 },
];

/** The same water, hundreds of kilometres away. */
const WRONG_WATER: Coordinate[] = [
  { lat: 51.47, lng: -0.24 },
  { lat: 51.48, lng: -0.22 },
  { lat: 51.49, lng: -0.2 },
];

/**
 * A gate as the mirror files one: a small ring about a point.
 *
 * `lon`, not `lng` — the rownative schema and VirtualRow's internal coordinate
 * differ on that one name, and `toCoordinates` is where they are reconciled.
 * Writing `lng` here produced a course with no gates at all, which the attach
 * path then accepted a Thames track for.
 */
const gatePolygon = (name: string, order: number, at: Coordinate) => ({
  name,
  order,
  points: [
    { lat: at.lat + 0.0001, lon: at.lng - 0.0001 },
    { lat: at.lat + 0.0001, lon: at.lng + 0.0001 },
    { lat: at.lat - 0.0001, lon: at.lng + 0.0001 },
    { lat: at.lat - 0.0001, lon: at.lng - 0.0001 },
  ],
});

const COURSE_FILE = {
  id: COURSE_ID,
  name: 'Castle to Crane',
  country: 'Scotland',
  distance_m: 19_600,
  polygons: [
    gatePolygon('Start', 0, ON_LINE[0]),
    gatePolygon('Finish', 1, ON_LINE[2]),
  ],
};

const asGeoJson = (points: Coordinate[]) =>
  JSON.stringify({
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates: points.map((p) => [p.lng, p.lat]) },
  });

/** A fetch that serves the course above and nothing else. */
const courseFetch: typeof fetch = (input) => {
  const url = String(input);
  if (url.endsWith(`/${COURSE_ID}.json`)) {
    return Promise.resolve(new Response(JSON.stringify(COURSE_FILE), { status: 200 }));
  }
  return Promise.resolve(new Response('not found', { status: 404 }));
};

const importedRoutes: WaterRoute[] = [];
const importRoute = (data: { id: string; name: string; coordinates: Coordinate[] }) => {
  const route = {
    id: data.id,
    name: data.name,
    coordinates: data.coordinates,
  } as unknown as WaterRoute;
  importedRoutes.push(route);
  return route;
};

let tracks: TrackAttachmentStore;
let service: RownativeService;

beforeEach(() => {
  importedRoutes.length = 0;
  tracks = new TrackAttachmentStore();
  tracks.clear();
  service = new RownativeService(courseFetch, importRoute, tracks);
});

describe('attaching a track to a course', () => {
  it('stores a track that passes the course gates', async () => {
    const result = await service.attachTrack(COURSE_ID, 'clyde.geojson', asGeoJson(ON_LINE));

    expect(result.track.fileName).toBe('clyde.geojson');
    expect(result.track.courseId).toBe(COURSE_ID);
    expect(tracks.getCoordinates(COURSE_ID)).not.toBeNull();
  });

  it('gives back the course re-imported with the new geometry', async () => {
    // The point of attaching: the route the rower rows changes. Returning the
    // route saves the caller a second round trip and keeps the two in step.
    const result = await service.attachTrack(COURSE_ID, 'clyde.geojson', asGeoJson(ON_LINE));

    expect(result.route.id).toBe(COURSE_ID);
    expect(result.route.coordinates.length).toBeGreaterThanOrEqual(2);
  });

  it('refuses a track for the wrong water, and says which gate it missed', async () => {
    // The check that makes attaching safe: a Thames track on a Clyde course is
    // hundreds of kilometres from both gates.
    await expect(
      service.attachTrack(COURSE_ID, 'thames.geojson', asGeoJson(WRONG_WATER)),
    ).rejects.toThrow(/gate/i);

    expect(tracks.getCoordinates(COURSE_ID), 'a refused track was stored anyway').toBeNull();
  });

  it('refuses a file it cannot read, without touching what is already attached', async () => {
    await service.attachTrack(COURSE_ID, 'good.geojson', asGeoJson(ON_LINE));

    await expect(
      service.attachTrack(COURSE_ID, 'holiday.png', 'not a track at all'),
    ).rejects.toThrow(/\.gpx, \.kml or \.geojson/);

    // The good one survived. A failed attach must not cost the rower the track
    // they already had.
    expect(tracks.get(COURSE_ID)?.fileName).toBe('good.geojson');
  });

  it('replaces an attachment rather than accumulating them', async () => {
    await service.attachTrack(COURSE_ID, 'first.geojson', asGeoJson(ON_LINE));
    await service.attachTrack(COURSE_ID, 'second.geojson', asGeoJson(ON_LINE));

    expect(tracks.list()).toHaveLength(1);
    expect(tracks.get(COURSE_ID)?.fileName).toBe('second.geojson');
  });
});

describe('detaching a track', () => {
  it('removes it and re-imports the course without it', async () => {
    await service.attachTrack(COURSE_ID, 'clyde.geojson', asGeoJson(ON_LINE));

    const route = await service.detachTrack(COURSE_ID);

    expect(tracks.getCoordinates(COURSE_ID)).toBeNull();
    expect(route.id).toBe(COURSE_ID);
  });

  it('is harmless when there is nothing attached', async () => {
    await expect(service.detachTrack(COURSE_ID)).resolves.toBeTruthy();
    expect(tracks.getCoordinates(COURSE_ID)).toBeNull();
  });
});

describe('what is attached', () => {
  it('reports the attachment for a course, and nothing for one without', async () => {
    expect(service.attachedTrack(COURSE_ID)).toBeNull();

    await service.attachTrack(COURSE_ID, 'clyde.geojson', asGeoJson(ON_LINE));

    expect(service.attachedTrack(COURSE_ID)?.fileName).toBe('clyde.geojson');
    expect(service.attachedTrack('999')).toBeNull();
  });
});
