// ============================================================================
// LAKE OUTLINES FOR DRAWING (#493 Phase 3: FR1, FR2, D2 a, D4 c, NFR3)
//
// A lake route keeps the outline of the lake water it is on, with its islands,
// so the scene can draw the water out to the real shoreline. Only what can be
// seen is kept: each ring is clipped to the area detection looked at (the
// route's box plus the ray limit, beyond the fog), and the rings are slimmed
// to one shared vertex budget so a 30 km lake fits the route's cache entry.
//
// D4 c needs nothing here: joining a relation's ways into rings already keeps
// every way that closes and drops the pieces cut off at the query edge.
//
// Pure, no I/O: it runs in the detection worker with the rest of detection.
// ============================================================================

import type { Coordinate } from '../types/index';
import type { MaskBounds, MaskFeature } from './osmWaterMask';

export interface LakePolygon {
  /** The OSM water area, as `way/123` or `relation/456`. */
  featureId: string;
  name?: string;
  outer: Coordinate[];
  /** Islands, as holes in the water. */
  inner: Coordinate[][];
}

/**
 * The most vertices a route stores across all its lake rings: the drawing cap
 * of the most detailed tier (FR9), so no tier ever wants more than is kept.
 */
export const LAKE_POLYGON_STORE_VERTICES = 2048;

/** A ring is closed: its last vertex repeats its first. */
const closeRing = (ring: Coordinate[]) =>
  ring.length > 0 && (ring[0].lat !== ring[ring.length - 1].lat || ring[0].lng !== ring[ring.length - 1].lng)
    ? [...ring, ring[0]]
    : ring;

type Edge = 'minLat' | 'maxLat' | 'minLng' | 'maxLng';

const insideEdge = (point: Coordinate, edge: Edge, box: MaskBounds) => {
  switch (edge) {
    case 'minLat':
      return point.lat >= box.minLat;
    case 'maxLat':
      return point.lat <= box.maxLat;
    case 'minLng':
      return point.lng >= box.minLng;
    case 'maxLng':
      return point.lng <= box.maxLng;
  }
};

const crossing = (a: Coordinate, b: Coordinate, edge: Edge, box: MaskBounds): Coordinate => {
  const along = edge === 'minLat' || edge === 'maxLat' ? 'lat' : 'lng';
  const t = (box[edge] - a[along]) / (b[along] - a[along]);
  return { lat: a.lat + (b.lat - a.lat) * t, lng: a.lng + (b.lng - a.lng) * t };
};

/**
 * Sutherland-Hodgman against each side of the box. The ring may be concave:
 * where it leaves and re-enters, the clipped ring runs along the box edge
 * between the two crossings, which draws as water to the edge of the data.
 * Returns `[]` when nothing of the ring is inside.
 */
export const clipRingToBox = (ring: Coordinate[], box: MaskBounds): Coordinate[] => {
  let points = closeRing(ring).slice(0, -1);
  for (const edge of ['minLat', 'maxLat', 'minLng', 'maxLng'] as const) {
    if (points.length === 0) break;
    const next: Coordinate[] = [];
    points.forEach((current, index) => {
      const previous = points[(index + points.length - 1) % points.length];
      const currentIn = insideEdge(current, edge, box);
      if (currentIn !== insideEdge(previous, edge, box)) next.push(crossing(previous, current, edge, box));
      if (currentIn) next.push(current);
    });
    points = next;
  }
  return points.length >= 3 ? closeRing(points) : [];
};

const triangleArea = (a: Coordinate, b: Coordinate, c: Coordinate) =>
  Math.abs((b.lng - a.lng) * (c.lat - a.lat) - (c.lng - a.lng) * (b.lat - a.lat)) / 2;

/**
 * Visvalingam-Whyatt: repeatedly drop the vertex whose triangle with its
 * neighbours is smallest, so the dropped detail is the detail that changes the
 * outline's area least. Keeps the vertices it keeps exactly where they were,
 * in order, and the ring closed. `maxVertices` counts the closing repeat.
 */
export const simplifyRing = (ring: Coordinate[], maxVertices: number): Coordinate[] => {
  const open = closeRing(ring).slice(0, -1);
  const target = Math.max(3, maxVertices - 1);
  if (open.length <= target) return closeRing(ring);

  const kept = open.map(() => true);
  const neighbour = (index: number, step: 1 | -1) => {
    let next = index;
    do next = (next + step + open.length) % open.length;
    while (!kept[next]);
    return next;
  };
  const areaAt = (index: number) => triangleArea(open[neighbour(index, -1)], open[index], open[neighbour(index, 1)]);
  const areas = open.map((_, index) => areaAt(index));

  // O(n²) at worst, but n is a lake ring already clipped to the area around a
  // route, and this runs once per route in the detection worker.
  for (let remaining = open.length; remaining > target; remaining--) {
    let smallest = -1;
    for (let index = 0; index < open.length; index++) {
      if (kept[index] && (smallest === -1 || areas[index] < areas[smallest])) smallest = index;
    }
    kept[smallest] = false;
    const before = neighbour(smallest, -1);
    const after = neighbour(smallest, 1);
    areas[before] = areaAt(before);
    areas[after] = areaAt(after);
  }

  return closeRing(open.filter((_, index) => kept[index]));
};

/** 1e-7 degrees is about a centimetre: finer than OSM's own precision. */
const round = ({ lat, lng }: Coordinate): Coordinate => ({ lat: Number(lat.toFixed(7)), lng: Number(lng.toFixed(7)) });

/** Every vertex across a set of lakes, closing repeats included. */
export const vertexCount = (lakes: LakePolygon[]) =>
  lakes.reduce((sum, lake) => sum + lake.outer.length + lake.inner.reduce((holes, hole) => holes + hole.length, 0), 0);

/**
 * The outlines of the given lake water areas inside `box`, slimmed so that all
 * of them together stay within `maxVertices`. Each ring gets a share of the
 * budget in proportion to its own vertex count, and never fewer than four
 * (a triangle and its closing repeat).
 */
export const lakePolygonsFor = (
  features: MaskFeature[],
  box: MaskBounds,
  maxVertices: number = LAKE_POLYGON_STORE_VERTICES,
): LakePolygon[] => {
  const clipped = features.flatMap((feature) =>
    feature.polygons
      .map((polygon) => ({
        featureId: feature.id,
        ...(feature.name && { name: feature.name }),
        outer: clipRingToBox(polygon.outer, box),
        inner: polygon.inner.map((hole) => clipRingToBox(hole, box)).filter((hole) => hole.length > 0),
      }))
      .filter((lake) => lake.outer.length > 0),
  );

  const total = vertexCount(clipped);
  // Every ring keeps its minimum of four; the rest of the budget is shared out.
  const rings = clipped.reduce((sum, lake) => sum + 1 + lake.inner.length, 0);
  const spare = Math.max(0, maxVertices - 4 * rings);
  const share = (ring: Coordinate[]) =>
    total <= maxVertices ? ring : simplifyRing(ring, 4 + Math.floor(((ring.length - 4) / (total - 4 * rings)) * spare));
  return clipped.map((lake) => ({
    ...lake,
    outer: share(lake.outer).map(round),
    inner: lake.inner.map((hole) => share(hole).map(round)),
  }));
};
