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
 *
 * `pinned(before, vertex, after)` may refuse a drop; a pinned vertex stays
 * even when that leaves the ring over its budget.
 */
export const simplifyRing = (
  ring: Coordinate[],
  maxVertices: number,
  pinned: (before: Coordinate, vertex: Coordinate, after: Coordinate) => boolean = () => false,
): Coordinate[] => {
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
  const areaAt = (index: number) => {
    const [before, after] = [open[neighbour(index, -1)], open[neighbour(index, 1)]];
    return pinned(before, open[index], after) ? Infinity : triangleArea(before, open[index], after);
  };
  const areas = open.map((_, index) => areaAt(index));

  // O(n²) at worst, but n is a lake ring already clipped to the area around a
  // route, and this runs once per route in the detection worker.
  for (let remaining = open.length; remaining > target; remaining--) {
    let smallest = -1;
    for (let index = 0; index < open.length; index++) {
      if (kept[index] && (smallest === -1 || areas[index] < areas[smallest])) smallest = index;
    }
    if (areas[smallest] === Infinity) break;
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
 * Slim a set of lakes so that together they stay within `maxVertices`. Each
 * ring gets a share of the budget in proportion to its own vertex count, and
 * never fewer than four (a triangle and its closing repeat). Lakes already
 * within budget come back as they are.
 */
const slimLakes = (lakes: LakePolygon[], maxVertices: number, pinned?: Parameters<typeof simplifyRing>[2]) => {
  const total = vertexCount(lakes);
  if (total <= maxVertices) return lakes;
  // Every ring keeps its minimum of four; the rest of the budget is shared out.
  const rings = lakes.reduce((sum, lake) => sum + 1 + lake.inner.length, 0);
  const spare = Math.max(0, maxVertices - 4 * rings);
  const share = (ring: Coordinate[]) =>
    simplifyRing(ring, 4 + Math.floor(((ring.length - 4) / (total - 4 * rings)) * spare), pinned);
  return lakes.map((lake) => ({ ...lake, outer: share(lake.outer), inner: lake.inner.map(share) }));
};

/**
 * The outlines of the given lake water areas inside `box`, slimmed so that all
 * of them together stay within `maxVertices` (see `slimLakes`).
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

  return slimLakes(clipped, maxVertices).map((lake) => ({
    ...lake,
    outer: lake.outer.map(round),
    inner: lake.inner.map((hole) => hole.map(round)),
  }));
};

// ----------------------------------------------------------------------------
// Drawing detail per tier (#493 Phase 4: FR9, D7 b)
// ----------------------------------------------------------------------------

/** Metres east and north of a fixed point, near enough flat across one lake. */
const localMetres = (origin: Coordinate) => {
  const perLat = 110_574;
  const perLng = 111_320 * Math.cos((origin.lat * Math.PI) / 180);
  return ({ lat, lng }: Coordinate) => ({ x: (lng - origin.lng) * perLng, y: (lat - origin.lat) * perLat });
};

type Point = { x: number; y: number };

const distanceToSegment = (p: Point, a: Point, b: Point) => {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
};

const cross = (o: Point, a: Point, b: Point) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** Metres from `p` to the triangle abc, inside counting as zero. */
const distanceToTriangle = (p: Point, a: Point, b: Point, c: Point) => {
  const [ab, bc, ca] = [cross(a, b, p), cross(b, c, p), cross(c, a, p)];
  if ((ab >= 0 && bc >= 0 && ca >= 0) || (ab <= 0 && bc <= 0 && ca <= 0)) return 0;
  return Math.min(distanceToSegment(p, a, b), distanceToSegment(p, b, c), distanceToSegment(p, c, a));
};

/**
 * A drop that could bring the shore nearer some route sample is refused.
 * Dropping a vertex replaces its two edges with the chord between its
 * neighbours, which lies inside the triangle they make, so the shore can only
 * get closer to a sample that is nearer that triangle than it was to the
 * whole outline before any slimming.
 */
const routeShoreGuard = (lakes: LakePolygon[], route: Coordinate[]) => {
  if (route.length === 0) return undefined;
  const toMetres = localMetres(route[0]);
  const rings = lakes.flatMap((lake) => [lake.outer, ...lake.inner]).map((ring) => ring.map(toMetres));
  const samples = route.map(toMetres).map((point) => {
    let shore = Infinity;
    for (const ring of rings) {
      for (let index = 0; index + 1 < ring.length; index++) shore = Math.min(shore, distanceToSegment(point, ring[index], ring[index + 1]));
    }
    return { point, shore };
  });
  return (before: Coordinate, vertex: Coordinate, after: Coordinate) => {
    const [a, b, c] = [toMetres(before), toMetres(vertex), toMetres(after)];
    const [minX, maxX] = [Math.min(a.x, b.x, c.x), Math.max(a.x, b.x, c.x)];
    const [minY, maxY] = [Math.min(a.y, b.y, c.y), Math.max(a.y, b.y, c.y)];
    return samples.some(
      ({ point, shore }) =>
        point.x > minX - shore &&
        point.x < maxX + shore &&
        point.y > minY - shore &&
        point.y < maxY + shore &&
        distanceToTriangle(point, a, b, c) < shore,
    );
  };
};

/**
 * A route's stored lake outlines, slimmed to one tier's vertex cap for drawing
 * (FR9). Visvalingam-Whyatt drops the detail that changes the area least, and
 * no drop may pull a shoreline in towards `route`, so the blades never reach a
 * simplified bank. Deterministic, so a tier change redraws the same shape.
 */
export const lakePolygonsForTier = (lakes: LakePolygon[], cap: number, route: Coordinate[]): LakePolygon[] =>
  vertexCount(lakes) <= cap ? lakes : slimLakes(lakes, cap, routeShoreGuard(lakes, route));
