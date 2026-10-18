// ============================================================================
// SHORE DETECTION ALONG A ROUTE (#493 FR15–FR17)
//
// Walks the route through the water/land mask: which water each sample is on,
// how far the shore is on each side, and which islands are within reach.
// Widths used to be a per-type guess centred on the route (G2, G3); this
// measures them from the mapped shoreline, left and right separately.
//
// Works in local metres (an equirectangular projection about the route's first
// point), which is accurate to well under a metre across a rowing course.
// ============================================================================

import type { Coordinate } from '../types/index';
import { classifyPoint, type MaskFeature, type WaterMask } from './osmWaterMask';

interface Metres {
  x: number;
  y: number;
}

const METRES_PER_DEGREE = 111_320;

export const localProjection = (origin: Coordinate) => {
  const lngScale = METRES_PER_DEGREE * Math.cos((origin.lat * Math.PI) / 180);
  return {
    toMetres: (point: Coordinate): Metres => ({
      x: (point.lng - origin.lng) * lngScale,
      y: (point.lat - origin.lat) * METRES_PER_DEGREE,
    }),
    toCoordinate: ({ x, y }: Metres): Coordinate => ({
      lat: origin.lat + y / METRES_PER_DEGREE,
      lng: origin.lng + x / lngScale,
    }),
  };
};

export interface DetectionOptions {
  /** D22 (c): one sample per enrichment segment, denser near islands and narrows. */
  spacingMeters?: number;
  /** D20: how far a ray looks for a shore. The caller passes the view distance. */
  maxRayMeters?: number;
  /** D21 (b): GPS and mapping drift allowed before a sample counts as on land. */
  landToleranceMeters?: number;
}

/**
 * D20 (a): how far a ray looks for a shore by default: the view distance,
 * chunkViewDistanceFor() — fog far 550 m plus a tenth. utils can't import the
 * scene, so callers with the live config pass their own. A side with no shore
 * this close is open water.
 */
export const SHORE_RAY_LIMIT_METERS = 605;

const DEFAULTS: Required<DetectionOptions> = {
  spacingMeters: 50,
  maxRayMeters: SHORE_RAY_LIMIT_METERS,
  landToleranceMeters: 15,
};

/** D22 (c): step through islands and narrows at this spacing. */
const DETAIL_SPACING_METERS = 10;
/** A sample this close to an island's edge is "near" it. */
const NEAR_ISLAND_METERS = 100;
/** Shore to shore narrower than this is a narrows: about four times the oar span. */
const NARROWS_WIDTH_METERS = 40;

export interface DetectedSample {
  distanceMeters: number;
  coordinate: Coordinate;
  kind: 'water' | 'land' | 'unknown';
  /** The water body the sample is on, as `way/123` or `relation/456`. */
  featureId?: string;
  /** Set when the sample was on land within the tolerance and counted as water. */
  driftMeters?: number;
  /** Distance to the shore or an island, or `null` for none within reach (or not measured). */
  leftShoreMeters: number | null;
  rightShoreMeters: number | null;
}

export interface DetectedIsland {
  /** `way/3` for a mapped island; `relation/4#inner0` for a hole in a water polygon. */
  id: string;
  name?: string;
  outline: Coordinate[];
}

export interface RouteDetection {
  samples: DetectedSample[];
  islands: DetectedIsland[];
  summary: { water: number; land: number; unknown: number };
}

interface Segment {
  a: Metres;
  b: Metres;
}

const ringSegments = (ring: Metres[]): Segment[] =>
  ring.slice(1).map((b, index) => ({ a: ring[index], b }));

const cross = (u: Metres, v: Metres) => u.x * v.y - u.y * v.x;

/** Distance along a unit ray to where it crosses a segment, or `null`. */
const rayHit = (origin: Metres, direction: Metres, { a, b }: Segment): number | null => {
  const edge = { x: b.x - a.x, y: b.y - a.y };
  const denominator = cross(direction, edge);
  if (Math.abs(denominator) < 1e-12) return null;
  const toA = { x: a.x - origin.x, y: a.y - origin.y };
  const along = cross(toA, edge) / denominator;
  const onEdge = cross(toA, direction) / denominator;
  return along > 1e-9 && onEdge >= 0 && onEdge <= 1 ? along : null;
};

const distanceToSegment = (point: Metres, { a, b }: Segment): number => {
  const edge = { x: b.x - a.x, y: b.y - a.y };
  const lengthSquared = edge.x * edge.x + edge.y * edge.y;
  const t = lengthSquared === 0
    ? 0
    : Math.max(0, Math.min(1, ((point.x - a.x) * edge.x + (point.y - a.y) * edge.y) / lengthSquared));
  return Math.hypot(point.x - (a.x + t * edge.x), point.y - (a.y + t * edge.y));
};

/**
 * Shoreline segments bucketed into square cells, so a ray or a "what's near
 * here" question looks at the few cells it passes instead of every vertex of
 * a 20,000-point lake (NFR9).
 */
const GRID_CELL_METERS = 50;

interface Region {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

// Cells as one number: a course is far smaller than a million cells across.
const cellKey = (i: number, j: number) => i * 2_097_152 + j;

class SegmentGrid<T> {
  private readonly cells = new Map<number, number[]>();
  private readonly entries: Array<{ segment: Segment; owner: T }>;

  /** Segments wholly outside `region` are dropped: nothing ever asks about them. */
  constructor(entries: Array<{ segment: Segment; owner: T }>, region: Region) {
    this.entries = entries.filter(
      ({ segment: { a, b } }) =>
        Math.max(a.x, b.x) >= region.minX && Math.min(a.x, b.x) <= region.maxX &&
        Math.max(a.y, b.y) >= region.minY && Math.min(a.y, b.y) <= region.maxY,
    );
    this.entries.forEach(({ segment: { a, b } }, index) => {
      const [x0, x1] = [Math.min(a.x, b.x), Math.max(a.x, b.x)].map((v) => Math.floor(v / GRID_CELL_METERS));
      const [y0, y1] = [Math.min(a.y, b.y), Math.max(a.y, b.y)].map((v) => Math.floor(v / GRID_CELL_METERS));
      for (let i = x0; i <= x1; i++) {
        for (let j = y0; j <= y1; j++) {
          const key = cellKey(i, j);
          const bucket = this.cells.get(key);
          if (bucket) bucket.push(index);
          else this.cells.set(key, [index]);
        }
      }
    });
  }

  private bucket(i: number, j: number) {
    return this.cells.get(cellKey(i, j)) ?? [];
  }

  /** Every entry with a segment in a cell within `radius` of the point. */
  near(point: Metres, radius: number): Array<{ segment: Segment; owner: T }> {
    const seen = new Set<number>();
    const [x0, x1] = [point.x - radius, point.x + radius].map((v) => Math.floor(v / GRID_CELL_METERS));
    const [y0, y1] = [point.y - radius, point.y + radius].map((v) => Math.floor(v / GRID_CELL_METERS));
    for (let i = x0; i <= x1; i++) for (let j = y0; j <= y1; j++) for (const index of this.bucket(i, j)) seen.add(index);
    return [...seen].map((index) => this.entries[index]);
  }

  /** Nearest crossing along a unit ray within `limit`, walking cells in order (Amanatides–Woo). */
  cast(origin: Metres, direction: Metres, limit: number): number | null {
    let i = Math.floor(origin.x / GRID_CELL_METERS);
    let j = Math.floor(origin.y / GRID_CELL_METERS);
    const stepI = direction.x > 0 ? 1 : -1;
    const stepJ = direction.y > 0 ? 1 : -1;
    const boundary = (cell: number, step: number) => (cell + (step > 0 ? 1 : 0)) * GRID_CELL_METERS;
    let nextX = direction.x === 0 ? Infinity : (boundary(i, stepI) - origin.x) / direction.x;
    let nextY = direction.y === 0 ? Infinity : (boundary(j, stepJ) - origin.y) / direction.y;
    const deltaX = direction.x === 0 ? Infinity : GRID_CELL_METERS / Math.abs(direction.x);
    const deltaY = direction.y === 0 ? Infinity : GRID_CELL_METERS / Math.abs(direction.y);
    let best: number | null = null;
    const tested = new Set<number>();
    let cellStart = 0;
    while (cellStart <= limit) {
      for (const index of this.bucket(i, j)) {
        if (tested.has(index)) continue;
        tested.add(index);
        const hit = rayHit(origin, direction, this.entries[index].segment);
        if (hit !== null && hit <= limit && (best === null || hit < best)) best = hit;
      }
      const cellEnd = Math.min(nextX, nextY);
      // A hit inside the cells walked so far can't be beaten by a later cell.
      if (best !== null && best <= cellEnd) return best;
      cellStart = cellEnd;
      if (nextX < nextY) {
        i += stepI;
        nextX += deltaX;
      } else {
        j += stepJ;
        nextY += deltaY;
      }
    }
    return best;
  }
}

const routeLength = (points: Metres[]) =>
  points.slice(1).reduce((total, point, index) => total + Math.hypot(point.x - points[index].x, point.y - points[index].y), 0);

/** Position and unit heading at a distance along the route. */
const pointAlong = (points: Metres[], distance: number): { position: Metres; heading: Metres } => {
  let travelled = 0;
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1];
    const b = points[index];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length === 0) continue;
    const heading = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
    if (travelled + length >= distance || index === points.length - 1) {
      const t = Math.min(1, Math.max(0, (distance - travelled) / length));
      return { position: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, heading };
    }
    travelled += length;
  }
  return { position: points[0], heading: { x: 0, y: 1 } };
};

const sampleDistances = (length: number, spacing: number) => {
  const distances: number[] = [];
  // Half a metre of slack so projection round-off doesn't add a near-duplicate end sample.
  for (let distance = 0; distance < length - 0.5; distance += spacing) distances.push(distance);
  distances.push(length);
  return distances;
};

/** Holes in water polygons and mapped land inside water, as one list. */
const islandsOf = (mask: WaterMask): DetectedIsland[] => [
  ...mask.water.flatMap((feature: MaskFeature) =>
    feature.polygons.flatMap((polygon) => polygon.inner).map((outline, index) => ({
      id: `${feature.id}#inner${index}`,
      outline,
    })),
  ),
  ...mask.land.flatMap((feature) =>
    feature.polygons.map((polygon) => ({ id: feature.id, name: feature.name, outline: polygon.outer })),
  ),
];

export const detectRoute = (
  route: Coordinate[],
  mask: WaterMask,
  options: DetectionOptions = {},
): RouteDetection => {
  const { spacingMeters, maxRayMeters, landToleranceMeters } = { ...DEFAULTS, ...options };
  const { toMetres, toCoordinate } = localProjection(route[0]);
  const points = route.map(toMetres);

  // Everything any question below can reach: the route plus a ray's length.
  const reach = maxRayMeters + GRID_CELL_METERS;
  const region: Region = {
    minX: Math.min(...points.map((p) => p.x)) - reach,
    maxX: Math.max(...points.map((p) => p.x)) + reach,
    minY: Math.min(...points.map((p) => p.y)) - reach,
    maxY: Math.max(...points.map((p) => p.y)) + reach,
  };

  // Every shoreline a ray can stop at: water outlines, their holes, and islands.
  const shores = new SegmentGrid<null>(
    [
      ...mask.water.flatMap((feature) =>
        feature.polygons.flatMap((polygon) => [polygon.outer, ...polygon.inner]),
      ),
      ...mask.land.flatMap((feature) => feature.polygons.map((polygon) => polygon.outer)),
    ].flatMap((ring) => ringSegments(ring.map(toMetres)).map((segment) => ({ segment, owner: null }))),
    region,
  );
  const waters = new SegmentGrid<MaskFeature>(
    mask.water.flatMap((feature) =>
      feature.polygons
        .flatMap((polygon) => [polygon.outer, ...polygon.inner])
        .flatMap((ring) => ringSegments(ring.map(toMetres)).map((segment) => ({ segment, owner: feature }))),
    ),
    region,
  );

  const castRay = (origin: Metres, direction: Metres): number | null =>
    shores.cast(origin, direction, maxRayMeters);

  /** The nearest water within the drift tolerance, if any. */
  const nearestWater = (position: Metres) =>
    waters
      .near(position, landToleranceMeters)
      .map(({ segment, owner }) => ({ feature: owner, distance: distanceToSegment(position, segment) }))
      .sort((a, b) => a.distance - b.distance)[0];

  const sampleAt = (distanceMeters: number): DetectedSample => {
    const { position, heading } = pointAlong(points, distanceMeters);
    const coordinate = toCoordinate(position);
    const base = { distanceMeters, coordinate, leftShoreMeters: null, rightShoreMeters: null };
    const point = classifyPoint(mask, coordinate);

    if (point.kind === 'unknown') return { ...base, kind: 'unknown' };

    if (point.kind === 'land') {
      const closest = point.island ? undefined : nearestWater(position);
      return closest && closest.distance <= landToleranceMeters
        ? { ...base, kind: 'water', featureId: closest.feature.id, driftMeters: closest.distance }
        : { ...base, kind: 'land' };
    }

    return {
      ...base,
      kind: 'water',
      featureId: point.feature.id,
      leftShoreMeters: castRay(position, { x: -heading.y, y: heading.x }),
      rightShoreMeters: castRay(position, { x: heading.y, y: -heading.x }),
    };
  };

  const islandList = islandsOf(mask);
  const islandGrid = new SegmentGrid<number>(
    islandList.flatMap((island, index) =>
      ringSegments(island.outline.map(toMetres)).map((segment) => ({ segment, owner: index })),
    ),
    region,
  );
  const islandsWithin = (point: Metres, radius: number) =>
    islandGrid
      .near(point, radius)
      .filter(({ segment }) => distanceToSegment(point, segment) <= radius)
      .map(({ owner }) => owner);
  const nearIsland = (sample: DetectedSample) =>
    islandsWithin(toMetres(sample.coordinate), NEAR_ISLAND_METERS).length > 0;
  const inNarrows = (sample: DetectedSample) =>
    sample.leftShoreMeters !== null &&
    sample.rightShoreMeters !== null &&
    sample.leftShoreMeters + sample.rightShoreMeters < NARROWS_WIDTH_METERS;
  const needsDetail = (sample: DetectedSample) => nearIsland(sample) || inNarrows(sample);

  // D22 (c): a first pass at the segment spacing, then 10 m steps through any
  // stretch that starts or ends beside an island or in a narrows, where a
  // 50 m step could pass a whole island or pinch without seeing it.
  const coarse = sampleDistances(routeLength(points), spacingMeters).map(sampleAt);
  const samples = coarse.flatMap((sample, index) => {
    const next = coarse[index + 1];
    if (!next || !(needsDetail(sample) || needsDetail(next))) return [sample];
    const extra: DetectedSample[] = [];
    for (let distance = sample.distanceMeters + DETAIL_SPACING_METERS; distance < next.distanceMeters - 0.5; distance += DETAIL_SPACING_METERS) {
      extra.push(sampleAt(distance));
    }
    return [sample, ...extra];
  });

  // Islands within view of the route: a cheap box test first, the exact distance only for those that pass.
  const samplePoints = coarse.map((sample) => toMetres(sample.coordinate));
  const inReach = new Set(
    islandList.flatMap((island, index) => {
      const outline = island.outline.map(toMetres);
      const xs = outline.map((p) => p.x);
      const ys = outline.map((p) => p.y);
      const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      const candidates = samplePoints.filter(
        (p) => p.x >= minX - maxRayMeters && p.x <= maxX + maxRayMeters && p.y >= minY - maxRayMeters && p.y <= maxY + maxRayMeters,
      );
      const segments = ringSegments(outline);
      return candidates.some((p) => segments.some((segment) => distanceToSegment(p, segment) <= maxRayMeters)) ? [index] : [];
    }),
  );

  return {
    samples,
    islands: islandList.filter((_island, index) => inReach.has(index)),
    summary: {
      water: samples.filter((sample) => sample.kind === 'water').length,
      land: samples.filter((sample) => sample.kind === 'land').length,
      unknown: samples.filter((sample) => sample.kind === 'unknown').length,
    },
  };
};
