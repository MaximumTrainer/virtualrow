/**
 * Derive a course path from OpenStreetMap waterway centrelines (issue #194 R-12).
 *
 * Fetches every river/canal/stream/tidal-channel/fairway way around a course's
 * gates from Overpass, builds an undirected graph of their vertices, snaps each
 * gate centroid to the nearest vertex, and walks the shortest path from gate to
 * gate in order.
 *
 * ## Spike result: NO-GO — not enabled by default
 *
 * Measured against the AC-12 course set on 2026-08-30 (live Overpass):
 *
 * | course | gates snapped ≤ 150 m | path | derived length |
 * | ------ | --------------------- | ---- | -------------- |
 * | 179 Castle to Crane | Start 48 m, **Finish 215 m** | no  | (21.69 km when forced) |
 * | 261 Isle of Ely Head | Start 27 m, **Finish 151 m** | no  | — |
 * | 14 Prague Primatorky | 49 m, 46 m                   | yes | 0.88 km vs 0.886 declared |
 * | 61 HOCR Rev C        | all 19 within 48 m           | yes | 4.84 km vs 4.703 declared |
 * | 233 HOTS Stake race  | **green #13 228 m**          | no  | — |
 * | 1, 12, 13 (lakes)    | 1 snapped, 12/13 did not     | —   | fell through cleanly |
 *
 * Snap coverage passes (28 of 31 river/canal gates, 90 %) and both derived
 * lengths land within 10 %, but a path was found for only 2 of the 5
 * river/canal courses against the "≥ 4 of 5" bar. The failures are all the same
 * shape: a finish gate placed mid-estuary, hundreds of metres from the mapped
 * centreline, on exactly the wide water where the straight-line problem hurts
 * most. So the provider ships unused — `resolveCourseGeometry` is only given
 * one when a caller passes it — and the user-attached track (R-8) is the
 * supported answer. Widening the snap radius is the obvious next experiment;
 * it needs a way to reject a snap onto the wrong waterway first.
 */

import type { Coordinate } from '../types/index';
import { distanceBetweenMeters } from '../utils/coordinateUtils';
import type { WaterwayPathProvider } from './rownativeGeometry';

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

/** Waterway classes a rowing course can plausibly follow. */
const WATERWAY_FILTER = '^(river|canal|stream|tidal_channel|fairway)$';

/** Margin added around the gate bounding box, in metres. */
const BBOX_MARGIN_M = 1000;

/** A gate further than this from any mapped vertex is not on this waterway. */
export const MAX_SNAP_DISTANCE_M = 150;

/** Give up rather than delay an import; the caller falls through to gates. */
const REQUEST_TIMEOUT_MS = 8000;

const METERS_PER_DEGREE_LAT = 111_320;

interface OverpassWay {
  geometry?: { lat: number; lon: number }[];
}

interface OverpassResponse {
  elements?: OverpassWay[];
}

/** Vertices are keyed by rounded position so shared way endpoints join up. */
function vertexKey(point: Coordinate): string {
  return `${point.lat.toFixed(6)},${point.lng.toFixed(6)}`;
}

interface WaterwayGraph {
  adjacency: Map<string, [string, number][]>;
  vertices: Map<string, Coordinate>;
}

function buildGraph(ways: OverpassWay[]): WaterwayGraph {
  const adjacency = new Map<string, [string, number][]>();
  const vertices = new Map<string, Coordinate>();

  const link = (a: Coordinate, b: Coordinate) => {
    const keyA = vertexKey(a);
    const keyB = vertexKey(b);
    if (keyA === keyB) return;
    vertices.set(keyA, a);
    vertices.set(keyB, b);
    const weight = distanceBetweenMeters(a, b);
    if (!adjacency.has(keyA)) adjacency.set(keyA, []);
    if (!adjacency.has(keyB)) adjacency.set(keyB, []);
    adjacency.get(keyA)!.push([keyB, weight]);
    adjacency.get(keyB)!.push([keyA, weight]);
  };

  for (const way of ways) {
    const geometry = (way?.geometry ?? [])
      .filter((point) => Number.isFinite(point?.lat) && Number.isFinite(point?.lon))
      .map((point) => ({ lat: point.lat, lng: point.lon }));
    for (let i = 0; i < geometry.length - 1; i++) link(geometry[i], geometry[i + 1]);
  }

  return { adjacency, vertices };
}

function snapToGraph(graph: WaterwayGraph, point: Coordinate): { key: string; distanceMeters: number } | null {
  let best: { key: string; distanceMeters: number } | null = null;
  for (const [key, vertex] of graph.vertices) {
    const distanceMeters = distanceBetweenMeters(point, vertex);
    if (!best || distanceMeters < best.distanceMeters) best = { key, distanceMeters };
  }
  return best;
}

/** Dijkstra over the waterway graph. Returns the vertex path, or `null`. */
function shortestPath(graph: WaterwayGraph, from: string, to: string): Coordinate[] | null {
  const best = new Map<string, number>([[from, 0]]);
  const previous = new Map<string, string>();
  const frontier: [number, string][] = [[0, from]];

  while (frontier.length > 0) {
    // Small graphs (a few thousand vertices); a sorted array beats the code a
    // real heap would cost here.
    frontier.sort((a, b) => a[0] - b[0]);
    const [cost, key] = frontier.shift()!;
    if (key === to) break;
    if (cost > (best.get(key) ?? Infinity)) continue;

    for (const [neighbour, weight] of graph.adjacency.get(key) ?? []) {
      const next = cost + weight;
      if (next < (best.get(neighbour) ?? Infinity)) {
        best.set(neighbour, next);
        previous.set(neighbour, key);
        frontier.push([next, neighbour]);
      }
    }
  }

  if (!best.has(to)) return null;
  const path: Coordinate[] = [];
  let cursor: string | undefined = to;
  while (cursor !== undefined) {
    const vertex = graph.vertices.get(cursor);
    if (vertex) path.unshift(vertex);
    if (cursor === from) break;
    cursor = previous.get(cursor);
  }
  return path.length >= 2 ? path : null;
}

export class OsmWaterwayPathProvider implements WaterwayPathProvider {
  private readonly fetchImpl: typeof fetch;
  private readonly cache = new Map<string, Coordinate[] | null>();

  constructor(fetchImpl: typeof fetch = (input, init) => globalThis.fetch(input, init)) {
    this.fetchImpl = fetchImpl;
  }

  /** Cache key mirrors the route-enrichment scheme: the query's bounding box. */
  private static cacheKey(bbox: string): string {
    return `osm-waterway:${bbox}`;
  }

  private static boundingBox(gates: Coordinate[]): string {
    const lats = gates.map((gate) => gate.lat);
    const lngs = gates.map((gate) => gate.lng);
    const latMargin = BBOX_MARGIN_M / METERS_PER_DEGREE_LAT;
    const meanLat = lats.reduce((sum, lat) => sum + lat, 0) / lats.length;
    const lngMargin = latMargin / Math.max(0.01, Math.cos((meanLat * Math.PI) / 180));
    return [
      Math.min(...lats) - latMargin,
      Math.min(...lngs) - lngMargin,
      Math.max(...lats) + latMargin,
      Math.max(...lngs) + lngMargin,
    ].map((value) => value.toFixed(5)).join(',');
  }

  /**
   * Walk the waterway network from gate to gate.
   *
   * Returns `null` — never throws — when Overpass is unreachable, returns
   * nonsense, a gate cannot be snapped, or no path connects two gates.
   */
  async findPath(gates: Coordinate[]): Promise<Coordinate[] | null> {
    if (gates.length < 2) return null;

    const bbox = OsmWaterwayPathProvider.boundingBox(gates);
    const key = OsmWaterwayPathProvider.cacheKey(bbox);
    if (this.cache.has(key)) return this.cache.get(key) ?? null;

    const path = await this.derivePath(bbox, gates).catch(() => null);
    this.cache.set(key, path);
    return path;
  }

  private async derivePath(bbox: string, gates: Coordinate[]): Promise<Coordinate[] | null> {
    const query = `[out:json][timeout:25];way["waterway"~"${WATERWAY_FILTER}"](${bbox});out geom;`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    let response: Response;
    try {
      response = await this.fetchImpl(OVERPASS_URL, {
        method: 'POST',
        body: `data=${encodeURIComponent(query)}`,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!response?.ok) return null;

    const payload = await response.json() as OverpassResponse;
    const graph = buildGraph(Array.isArray(payload?.elements) ? payload.elements : []);
    if (graph.vertices.size === 0) return null;

    const snapped: string[] = [];
    for (const gate of gates) {
      const snap = snapToGraph(graph, gate);
      if (!snap || snap.distanceMeters > MAX_SNAP_DISTANCE_M) return null;
      snapped.push(snap.key);
    }

    let full: Coordinate[] = [];
    for (let i = 0; i < snapped.length - 1; i++) {
      if (snapped[i] === snapped[i + 1]) continue;
      const leg = shortestPath(graph, snapped[i], snapped[i + 1]);
      if (!leg) return null;
      full = full.length === 0 ? leg : full.concat(leg.slice(1));
    }

    return full.length >= 2 ? full : null;
  }
}
