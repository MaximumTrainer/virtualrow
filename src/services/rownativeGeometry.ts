/**
 * Where a rownative course's geometry comes from (issue #194).
 *
 * A rownative course file is a list of polygons. Most are *gates* — small
 * quadrilaterals a boat must row through — and reducing each to its centroid
 * gives a chain of two or three points, which the engine faithfully renders as
 * a straight line down a river that bends. The mirror's `distance_m` is no help
 * either: its own SCHEMA.md defines it as the centroid-to-centroid chain
 * length, so it is straight-line by construction (Castle to Crane: 19.6 km
 * declared for a ~21 km race).
 *
 * This module resolves the best geometry available, in a fixed precedence, and
 * says which one it used so the UI can be honest about it:
 *
 *   track → polygon-path → osm-derived → gate-chain
 *
 * Everything here runs before `createRoute()`. The 3D engine is untouched: give
 * it a real water path and it already renders correct curvature and scale.
 */

import type { Coordinate, GeometrySource } from '../types/index';
import { polylineLengthMeters } from '../utils/coordinateUtils';
import {
  maxVertexExtentMeters,
  projectPointOntoPolyline,
  reversePolyline,
  rotateLoopToStart,
  slicePolyline,
} from '../utils/polylineGeometry';

export type { GeometrySource };

/**
 * How close the final polyline must pass to every gate centroid, in metres.
 * Roughly half the median gate extent across the mirror's 169 courses.
 */
export const GATE_TOLERANCE_M = 40;

/** A polygon needs at least this many distinct vertices to be a path candidate. */
export const PATH_MIN_VERTICES = 12;

/**
 * …and must span at least this far end to end. Course 61's 13-vertex, 125 m
 * "Gate 1" stays a gate; course 277's 18-vertex, 8.9 km "Route" does not.
 */
export const PATH_MIN_EXTENT_M = 250;

/** Start and finish this close together along a candidate means it is a loop. */
export const LOOP_CLOSURE_M = 300;

/** A candidate must be longer than this before loop handling applies. */
export const LOOP_MIN_LENGTH_M = 1000;

/**
 * A gate chain shorter than this is not a course, it is an out-and-back whose
 * start and finish sit on top of each other (course 175: 24 m for a real row).
 *
 * R-7 states the condition as "first and last gate centroids < 300 m apart",
 * but AC-9 requires course 153 — a 35-gate out-and-back on the Charles whose
 * start and finish are 20 m apart — to import as a normal gate chain. Chain
 * length subsumes both: it is never shorter than the end-to-end separation, so
 * this rejects 175 (24 m) and keeps 153 (9.9 km).
 */
export const DEGENERATE_CHAIN_LENGTH_M = 300;

/** A single vertex of a rownative course polygon. */
export interface RownativeCoursePolygonPoint {
  lat: number;
  lon: number;
}

export interface RownativeCoursePolygon {
  name?: string;
  order?: number;
  /** Optional upstream hint. `"path"` forces a polygon to be treated as a line. */
  kind?: string;
  points?: RownativeCoursePolygonPoint[];
}

/** The subset of a course file this module reads. */
export interface RownativeCourseGeometryInput {
  id: string;
  name?: string;
  polygons?: RownativeCoursePolygon[];
  /**
   * Optional upstream traced path (issue #194 R-13/R-14). Not in the mirror
   * schema yet; when it appears it is treated as an authoritative track.
   */
  path?: RownativeCoursePolygonPoint[];
}

/** A gate the boat must row through, reduced to its centroid. */
export interface CourseGate {
  name: string;
  order: number;
  center: Coordinate;
}

/** The geometry chosen for a course, and how it was arrived at. */
export interface ResolvedGeometry {
  coordinates: Coordinate[];
  source: GeometrySource;
  /** 0–1. How closely the polyline hugs the gates; 0 for a bare gate chain. */
  confidence: number;
  gates: Coordinate[];
  /** Human-readable notes about candidates that were tried and rejected. */
  warnings: string[];
}

/** No source could produce a usable path, and the gate chain is degenerate. */
export class RownativeGeometryUnavailableError extends Error {
  readonly courseId: string;
  readonly courseName: string;
  constructor(courseId: string, courseName: string) {
    super(
      `${courseName} (${courseId}) starts and finishes in the same place, so its gates `
      + 'describe no path at all — importing it would row a few metres and stop. '
      + 'Attach a track (GPX, KML or GeoJSON) of the course to import it.',
    );
    this.name = 'RownativeGeometryUnavailableError';
    this.courseId = courseId;
    this.courseName = courseName;
  }
}

/** A candidate line missed a gate, so it cannot be this course's path. */
export class GateFidelityError extends Error {
  readonly gateName: string;
  readonly offsetMeters: number;
  constructor(gateName: string, offsetMeters: number) {
    super(
      `That line passes ${Number.isFinite(offsetMeters) ? `${Math.round(offsetMeters)} m` : 'too far'} `
      + `from the "${gateName}" gate, more than the ${GATE_TOLERANCE_M} m allowed. `
      + 'It is not a path around this course.',
    );
    this.name = 'GateFidelityError';
    this.gateName = gateName;
    this.offsetMeters = offsetMeters;
  }
}

/** Something that can propose a water path through a course's gates. */
export interface WaterwayPathProvider {
  findPath(gates: Coordinate[]): Promise<Coordinate[] | null>;
}

export interface ResolveCourseGeometryOptions {
  /** A user-attached track, which outranks everything else. */
  attachedTrack?: Coordinate[] | null;
  /** Optional OSM-backed provider. Any failure falls through silently. */
  osmProvider?: WaterwayPathProvider | null;
}

const UNORDERED_POLYGON_SORT_KEY = Number.MAX_SAFE_INTEGER;

function isUsablePoint(point: RownativeCoursePolygonPoint): boolean {
  return Number.isFinite(point?.lat) && Number.isFinite(point?.lon);
}

function toCoordinates(points: RownativeCoursePolygonPoint[] | undefined): Coordinate[] {
  return (points ?? []).filter(isUsablePoint).map((point) => ({ lat: point.lat, lng: point.lon }));
}

function centroid(points: Coordinate[]): Coordinate | null {
  if (points.length === 0) return null;
  const lat = points.reduce((sum, point) => sum + point.lat, 0) / points.length;
  const lng = points.reduce((sum, point) => sum + point.lng, 0) / points.length;
  return { lat, lng };
}

/** Drop a polygon's repeated closing vertex so vertex counts are comparable. */
function dropClosingVertex(vertices: Coordinate[]): Coordinate[] {
  const last = vertices.length - 1;
  if (last > 0 && vertices[0].lat === vertices[last].lat && vertices[0].lng === vertices[last].lng) {
    return vertices.slice(0, last);
  }
  return vertices;
}

/** A polygon shaped like a traced line rather than a gate (R-6). */
export function isPathShaped(vertices: Coordinate[]): boolean {
  return vertices.length >= PATH_MIN_VERTICES && maxVertexExtentMeters(vertices) >= PATH_MIN_EXTENT_M;
}

/** A path-shaped polygon, or an attached track, awaiting validation. */
export interface PathCandidate {
  name: string;
  /** The polygon's own `order`, kept so a rejected candidate can revert to a
   *  gate in its original place in the chain. */
  order: number;
  vertices: Coordinate[];
}

export interface ClassifiedPolygons {
  gates: CourseGate[];
  candidates: PathCandidate[];
}

/**
 * Split a course's polygons into gates and path candidates.
 *
 * Path candidates are never chained by `order` — course 277 files its "Route"
 * polygon with `order: 2`, after the finish.
 */
export function classifyPolygons(course: RownativeCourseGeometryInput): ClassifiedPolygons {
  const ordered = [...(course.polygons ?? [])].sort(
    (a, b) => (a.order ?? UNORDERED_POLYGON_SORT_KEY) - (b.order ?? UNORDERED_POLYGON_SORT_KEY),
  );

  const gates: CourseGate[] = [];
  const candidates: PathCandidate[] = [];

  ordered.forEach((polygon, index) => {
    const vertices = toCoordinates(polygon.points);
    if (vertices.length === 0) return;
    const name = polygon.name?.trim() || `Polygon ${index + 1}`;

    // Shape is judged on distinct vertices, but the centroid is still the mean
    // of every point as filed — including a ring's repeated closing vertex —
    // so gate-chain courses resolve exactly as they did before this change.
    if (polygon.kind === 'path' || isPathShaped(dropClosingVertex(vertices))) {
      candidates.push({ name, order: polygon.order ?? index, vertices: dropClosingVertex(vertices) });
      return;
    }
    const center = centroid(vertices);
    if (center) gates.push({ name, order: polygon.order ?? index, center });
  });

  return { gates, candidates };
}

/**
 * The gate a course starts at.
 *
 * Name first, `order` second: course 257 files Start and Finish *after* its
 * five waypoints, so lowest-order alone would pick WP1.
 */
function findStartGate(gates: CourseGate[]): CourseGate | undefined {
  return gates.find((gate) => /^\s*start\b/i.test(gate.name)) ?? gates[0];
}

function findFinishGate(gates: CourseGate[]): CourseGate | undefined {
  return [...gates].reverse().find((gate) => /\b(finish|end)\b/i.test(gate.name)) ?? gates[gates.length - 1];
}

/** How many neighbours in a cyclic sequence step upwards. */
function cyclicAscendingCount(orders: number[]): number {
  if (orders.length < 2) return 0;
  let ascending = 0;
  for (let i = 0; i < orders.length; i++) {
    if (orders[(i + 1) % orders.length] > orders[i]) ascending++;
  }
  return ascending;
}

function worstGateOffset(
  line: Coordinate[],
  gates: CourseGate[],
): { gate: CourseGate; offsetMeters: number } | null {
  let worst: { gate: CourseGate; offsetMeters: number } | null = null;
  for (const gate of gates) {
    const offsetMeters = projectPointOntoPolyline(gate.center, line).offsetMeters;
    if (!worst || offsetMeters > worst.offsetMeters) worst = { gate, offsetMeters };
  }
  return worst;
}

function meanGateOffset(line: Coordinate[], gates: CourseGate[]): number {
  if (gates.length === 0) return 0;
  const total = gates.reduce(
    (sum, gate) => sum + projectPointOntoPolyline(gate.center, line).offsetMeters,
    0,
  );
  return total / gates.length;
}

/** Outcome of trying to make a candidate line into this course's path. */
export type CandidateFit =
  | { ok: true; coordinates: Coordinate[]; meanOffsetMeters: number; isLoop: boolean }
  | { ok: false; error: GateFidelityError };

/**
 * Orient, trim and validate a candidate line against a course's gates
 * (R-4, R-4a, R-4b, R-4c).
 *
 * Point-to-segment offsets decide fidelity; gate `order` only chooses which way
 * round a loop is rowed and never rejects a candidate on its own, because
 * upstream ordering is not always right (course 257 has WP4 and WP5 swapped).
 */
export function fitCandidateToGates(candidate: Coordinate[], gates: CourseGate[]): CandidateFit {
  if (candidate.length < 2) {
    return { ok: false, error: new GateFidelityError('start', Number.POSITIVE_INFINITY) };
  }
  if (gates.length === 0) {
    return { ok: true, coordinates: candidate, meanOffsetMeters: 0, isLoop: false };
  }

  const worst = worstGateOffset(candidate, gates);
  if (worst && worst.offsetMeters > GATE_TOLERANCE_M) {
    return { ok: false, error: new GateFidelityError(worst.gate.name, worst.offsetMeters) };
  }

  const startGate = findStartGate(gates);
  const finishGate = findFinishGate(gates);
  if (!startGate || !finishGate || startGate === finishGate) {
    return {
      ok: true,
      coordinates: candidate,
      meanOffsetMeters: meanGateOffset(candidate, gates),
      isLoop: false,
    };
  }

  const totalLength = polylineLengthMeters(candidate);
  const startAlong = projectPointOntoPolyline(startGate.center, candidate).alongMeters;
  const finishAlong = projectPointOntoPolyline(finishGate.center, candidate).alongMeters;
  const isLoop = Math.abs(startAlong - finishAlong) <= LOOP_CLOSURE_M && totalLength > LOOP_MIN_LENGTH_M;

  let fitted: Coordinate[];
  if (isLoop) {
    // Row the whole ring from the start gate, in whichever direction visits the
    // intermediate gates closest to ascending order.
    const intermediate = gates.filter((gate) => gate !== startGate && gate !== finishGate);
    const forwardOrders = intermediate
      .map((gate) => ({
        gate,
        along: (projectPointOntoPolyline(gate.center, candidate).alongMeters - startAlong + totalLength) % totalLength,
      }))
      .sort((a, b) => a.along - b.along)
      .map((entry) => entry.gate.order);
    const backwardOrders = [...forwardOrders].reverse();

    const oriented = cyclicAscendingCount(backwardOrders) > cyclicAscendingCount(forwardOrders)
      ? reversePolyline(candidate)
      : candidate;
    const orientedStart = projectPointOntoPolyline(startGate.center, oriented).alongMeters;
    fitted = rotateLoopToStart(oriented, orientedStart);
  } else {
    const oriented = startAlong <= finishAlong ? candidate : reversePolyline(candidate);
    const from = projectPointOntoPolyline(startGate.center, oriented).alongMeters;
    const to = projectPointOntoPolyline(finishGate.center, oriented).alongMeters;
    fitted = slicePolyline(oriented, from, to);
  }

  // Trimming can cut a gate off the end of the line, so re-check what survived.
  const worstAfterFit = worstGateOffset(fitted, gates);
  if (worstAfterFit && worstAfterFit.offsetMeters > GATE_TOLERANCE_M) {
    return { ok: false, error: new GateFidelityError(worstAfterFit.gate.name, worstAfterFit.offsetMeters) };
  }
  if (fitted.length < 2 || polylineLengthMeters(fitted) <= 0) {
    return { ok: false, error: new GateFidelityError(startGate.name, Number.POSITIVE_INFINITY) };
  }

  return { ok: true, coordinates: fitted, meanOffsetMeters: meanGateOffset(fitted, gates), isLoop };
}

function confidenceFor(meanOffsetMeters: number): number {
  return Math.min(1, Math.max(0, 1 - meanOffsetMeters / GATE_TOLERANCE_M));
}

/** Gate centroids in course order, which is what the chain fallback rows. */
function orderedGateCenters(gates: CourseGate[]): Coordinate[] {
  const sortKey = (gate: CourseGate) => (Number.isFinite(gate.order) ? gate.order : UNORDERED_POLYGON_SORT_KEY);
  return [...gates].sort((a, b) => sortKey(a) - sortKey(b)).map((gate) => gate.center);
}

/**
 * Choose the geometry for a course, trying each source in precedence order.
 *
 * @throws RownativeGeometryUnavailableError when nothing works and the gate
 *   chain is degenerate — better no route than a 24 m straight line.
 */
export async function resolveCourseGeometry(
  course: RownativeCourseGeometryInput,
  options: ResolveCourseGeometryOptions = {},
): Promise<ResolvedGeometry> {
  const { gates, candidates } = classifyPolygons(course);
  const gateCenters = gates.map((gate) => gate.center);
  const warnings: string[] = [];

  // 1. A user-attached track, or an upstream `path` field, outranks everything.
  const upstreamPath = toCoordinates(course.path);
  const track = options.attachedTrack?.length
    ? options.attachedTrack
    : (upstreamPath.length >= 2 ? upstreamPath : null);
  if (track && track.length >= 2) {
    const fit = fitCandidateToGates(track, gates);
    if (fit.ok) {
      return {
        coordinates: fit.coordinates,
        source: 'track',
        confidence: confidenceFor(fit.meanOffsetMeters),
        gates: gateCenters,
        warnings,
      };
    }
    warnings.push(`Attached track ignored: ${fit.error.message}`);
  }

  // 2. Path-shaped polygons already in the course file. Each is judged on its
  //    own; the best passing one wins and the rest are discarded, never folded
  //    back in as bogus gates.
  if (candidates.length > 0) {
    const evaluated = candidates.map((candidate) => ({
      candidate,
      fit: fitCandidateToGates(candidate.vertices, gates),
    }));
    const passing = evaluated
      .filter(
        (entry): entry is { candidate: PathCandidate; fit: Extract<CandidateFit, { ok: true }> } => entry.fit.ok,
      )
      .sort((a, b) => a.fit.meanOffsetMeters - b.fit.meanOffsetMeters);

    if (passing.length > 0) {
      const [best] = passing;
      for (const other of evaluated) {
        if (other.candidate === best.candidate) continue;
        warnings.push(
          other.fit.ok
            ? `Ignored alternative traced path "${other.candidate.name}".`
            : `Discarded traced path "${other.candidate.name}": ${other.fit.error.message}`,
        );
      }
      return {
        coordinates: best.fit.coordinates,
        source: 'polygon-path',
        confidence: confidenceFor(best.fit.meanOffsetMeters),
        gates: gateCenters,
        warnings,
      };
    }

    // Nothing passed: these polygons are long "row through here" zones, not a
    // path (course 237's WP1/WP3). Treat them as gates and carry on.
    warnings.push(
      `No traced path in this course passes within ${GATE_TOLERANCE_M} m of every gate; using the gate outline.`,
    );
    for (const candidate of candidates) {
      const center = centroid(candidate.vertices);
      if (center) {
        gates.push({ name: candidate.name, order: candidate.order, center });
        gateCenters.push(center);
      }
    }
  }

  // 3. OSM waterway centrelines, when a provider is supplied. Network-tolerant
  //    by contract: any failure falls through to the gate chain.
  if (options.osmProvider && gates.length >= 2) {
    try {
      const derived = await options.osmProvider.findPath(orderedGateCenters(gates));
      if (derived && derived.length >= 2) {
        const fit = fitCandidateToGates(derived, gates);
        if (fit.ok) {
          return {
            coordinates: fit.coordinates,
            source: 'osm-derived',
            confidence: confidenceFor(fit.meanOffsetMeters),
            gates: gateCenters,
            warnings,
          };
        }
        warnings.push(`Map-derived path ignored: ${fit.error.message}`);
      }
    } catch {
      // Overpass is best-effort; never let it block or fail an import.
    }
  }

  // 4. The gate centroid chain — today's behaviour, honestly labelled. A chain
  //    of fewer than two gates is a broken course file rather than an
  //    out-and-back, and is left for the caller to report as such.
  const chain = orderedGateCenters(gates);
  if (chain.length >= 2 && polylineLengthMeters(chain) < DEGENERATE_CHAIN_LENGTH_M) {
    throw new RownativeGeometryUnavailableError(course.id, course.name ?? `Course ${course.id}`);
  }

  return { coordinates: chain, source: 'gate-chain', confidence: 0, gates: gateCenters, warnings };
}
