import * as THREE from 'three';
import type { Coordinate } from '../../types/index';
import type { LakePolygon } from '../../utils/lakePolygons';
import { latLngToMeters } from '../../utils/geoUtils';
import { RIVERBANK_WIDTH, SCENE_SCALE } from './constants';
import { WATER_SURFACE_Y } from './waterGeometry';
import { BANK_WATERLINE_Y } from './bankGeometry';

// ============================================================================
// Pure lake geometry (#493 Phase 3: FR4, FR5, FR6, D4 c, D5 a, D6 a, D11 a).
//
// A lake route's water is drawn from the lake's real outline instead of the
// ribbon: one flat surface with the islands cut out of it, a bank climbing
// away from every shoreline, and each island as land. Kept out of the
// components so the shapes can be asserted without a WebGL context, like the
// ribbon (#224).
//
// Scene axes match `gpsToScenePoints`: the route's first coordinate is the
// origin, x is east and z is south (north is -z).
// ============================================================================

/**
 * #493 NFR7: lake outlines are drawn only when `window.__VIRTUALROW_LAKE_OUTLINES`
 * is `true`. Phase 3 ships them off so nothing visible moves until the
 * baselines are recorded; flipping the default is its own change.
 */
export const isLakeOutlineEnabled = (): boolean =>
  typeof window !== 'undefined' && window.__VIRTUALROW_LAKE_OUTLINES === true;

/** How high the lake's banks climb above the waterline, in metres (flat: D11 a). */
export const LAKE_SHORE_RISE_METERS = 1.5;

/** Island banks are held to this share of the island's inradius, so small islands keep a top. */
const ISLAND_BANK_SHARE = 0.5;

/** One ring in scene x/z, open (no closing repeat). */
export const projectRing = (ring: Coordinate[], origin: Coordinate, sceneScale: number = SCENE_SCALE): THREE.Vector2[] => {
  const open =
    ring.length > 1 && ring[0].lat === ring[ring.length - 1].lat && ring[0].lng === ring[ring.length - 1].lng
      ? ring.slice(0, -1)
      : ring;
  return open.map(({ lat, lng }) => {
    const { x, y } = latLngToMeters(lat, lng, origin.lat, origin.lng);
    return new THREE.Vector2(x * sceneScale, -y * sceneScale);
  });
};

/** Twice the signed area in the x/z plane; the sign says which way round the ring runs. */
const signedArea = (ring: THREE.Vector2[]) =>
  ring.reduce((sum, point, index) => {
    const next = ring[(index + 1) % ring.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0);

const perimeter = (ring: THREE.Vector2[]) =>
  ring.reduce((sum, point, index) => sum + point.distanceTo(ring[(index + 1) % ring.length]), 0);

/** Collects triangles, each wound to face the sky whatever order it came in. */
class MeshBuilder {
  readonly positions: number[] = [];
  readonly uvs: number[] = [];
  readonly shoreDist: number[] = [];
  readonly indices: number[] = [];

  vertex(x: number, y: number, z: number, u: number, v: number, shore = 0) {
    this.positions.push(x, y, z);
    this.uvs.push(u, v);
    this.shoreDist.push(shore);
    return this.positions.length / 3 - 1;
  }

  triangle(a: number, b: number, c: number) {
    const p = this.positions;
    const [ax, az, bx, bz, cx, cz] = [p[a * 3], p[a * 3 + 2], p[b * 3], p[b * 3 + 2], p[c * 3], p[c * 3 + 2]];
    // y of (b - a) × (c - a): positive faces up.
    const up = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
    if (up >= 0) this.indices.push(a, b, c);
    else this.indices.push(a, c, b);
  }

  build(withShoreDist: boolean): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    if (withShoreDist) geometry.setAttribute('shoreDist', new THREE.Float32BufferAttribute(this.shoreDist, 1));
    geometry.setIndex(this.indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
    return geometry;
  }
}

/** Fill a ring (with holes) flat at `y`. */
const fill = (mesh: MeshBuilder, outer: THREE.Vector2[], holes: THREE.Vector2[][], y: number, uvScale: number) => {
  const faces = THREE.ShapeUtils.triangulateShape(outer, holes);
  const base = mesh.positions.length / 3;
  for (const point of [outer, ...holes].flat()) mesh.vertex(point.x, y, point.y, point.x / uvScale, point.y / uvScale);
  for (const [a, b, c] of faces) mesh.triangle(base + a, base + b, base + c);
};

/** Metres per repeat of the water's uv, matching the ribbon's scale closely enough for the shader's ripples. */
const WATER_UV_METERS = 20;

/**
 * The lake's surface (FR4, D5 a): each outline filled flat at the water height
 * with its islands left out. The rower only ever sees it near the route, and
 * fog hides the far edge (D8 a), so it is drawn whole.
 */
export const createLakeWaterGeometry = (
  polygons: LakePolygon[],
  origin: Coordinate,
  y: number = WATER_SURFACE_Y,
): THREE.BufferGeometry => {
  const mesh = new MeshBuilder();
  for (const polygon of polygons) {
    const outer = projectRing(polygon.outer, origin);
    if (outer.length < 3) continue;
    fill(mesh, outer, polygon.inner.map((hole) => projectRing(hole, origin)).filter((hole) => hole.length >= 3), y, WATER_UV_METERS);
  }
  return mesh.build(false);
};

/**
 * Each vertex pushed `width` along its outward normal: the bisector of the two
 * edges' normals, lengthened at a corner so the band keeps its width, but never
 * past twice that, so a spike can't throw a vertex across the lake.
 */
const offsetRing = (ring: THREE.Vector2[], width: number, away: 'outside' | 'inside'): THREE.Vector2[] => {
  // For an anticlockwise ring in x/z, (dz, -dx) on each edge points out of it.
  const sign = (signedArea(ring) > 0 ? 1 : -1) * (away === 'outside' ? 1 : -1);
  const normal = (from: THREE.Vector2, to: THREE.Vector2) => {
    const edge = to.clone().sub(from);
    return new THREE.Vector2(edge.y, -edge.x).normalize().multiplyScalar(sign);
  };
  return ring.map((point, index) => {
    const before = normal(ring[(index + ring.length - 1) % ring.length], point);
    const after = normal(point, ring[(index + 1) % ring.length]);
    const bisector = before.clone().add(after);
    if (bisector.lengthSq() < 1e-12) return point.clone().addScaledVector(after, width);
    bisector.normalize();
    const stretch = Math.min(2, 1 / Math.max(0.5, bisector.dot(after)));
    return point.clone().addScaledVector(bisector, width * stretch);
  });
};

/** A band from the waterline at `ring` up to `rise`, `width` away from the water. */
const band = (mesh: MeshBuilder, ring: THREE.Vector2[], width: number, away: 'outside' | 'inside', rise: number) => {
  const outer = offsetRing(ring, width, away);
  const base = mesh.positions.length / 3;
  let along = 0;
  ring.forEach((point, index) => {
    if (index > 0) along += point.distanceTo(ring[index - 1]);
    mesh.vertex(point.x, BANK_WATERLINE_Y, point.y, 0, along / 10, 0);
    mesh.vertex(outer[index].x, BANK_WATERLINE_Y + rise, outer[index].y, 1, along / 10, width);
  });
  for (let index = 0; index < ring.length; index++) {
    const next = (index + 1) % ring.length;
    const [a, b, c, d] = [base + index * 2, base + index * 2 + 1, base + next * 2, base + next * 2 + 1];
    mesh.triangle(a, b, c);
    mesh.triangle(b, d, c);
  }
  return outer;
};

/**
 * The land around and inside the lake (FR5, FR6, D6 a): a bank climbing away
 * from each outer shoreline, and each island as a bank climbing in from its
 * shore to a flat top. Drawn with the bank material, so it carries the same
 * `uv` and `shoreDist` attributes as the ribbon's banks.
 */
export const createLakeLandGeometry = (
  polygons: LakePolygon[],
  origin: Coordinate,
  { width = RIVERBANK_WIDTH, rise = LAKE_SHORE_RISE_METERS }: { width?: number; rise?: number } = {},
): THREE.BufferGeometry => {
  const mesh = new MeshBuilder();
  for (const polygon of polygons) {
    const outer = projectRing(polygon.outer, origin);
    if (outer.length >= 3) band(mesh, outer, width, 'outside', rise);
    for (const hole of polygon.inner) {
      const island = projectRing(hole, origin);
      if (island.length < 3) continue;
      const inradius = Math.abs(signedArea(island)) / perimeter(island);
      const top = band(mesh, island, Math.min(width, inradius * ISLAND_BANK_SHARE), 'inside', rise);
      fill(mesh, top, [], BANK_WATERLINE_Y + rise, 10);
    }
  }
  return mesh.build(true);
};
