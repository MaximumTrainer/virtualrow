import * as THREE from 'three';
import { SCENE_SCALE, WATER_CHANNEL_WIDTH, RIVERBANK_WIDTH } from './constants';
import { WHOLE_ROUTE } from './geometryChunks';
import { WATER_SURFACE_Y } from './waterGeometry';
import {
  sampleStripFrame,
  stripProgressSchedule,
  type StripGeometryOptions,
} from './routeStripGeometry';
import {
  buildTerrainProfile,
  getTerrainReliefForProgress,
  getWaterWidthSceneUnitsForProgress,
} from '../../services/routeEnrichmentService';

// ============================================================================
// Pure riverbank geometry. Kept out of bankComponents.tsx so the terrain
// wiring (#202) can be asserted without a WebGL context, and so that file
// exports components only.
// ============================================================================

/**
 * Scene height of the waterline; the inner edge of both banks sits here.
 *
 * Two centimetres under the water surface, so the shore is tucked beneath it
 * rather than z-fighting with it. It was -0.5 while the water sat at -0.1, a
 * pair of numbers authored separately and neither aware of the other - so the
 * shore was a 38 cm cliff the length of the route, seen edge-on from a camera
 * two and a half metres up (#334).
 */
export const BANK_WATERLINE_Y = WATER_SURFACE_Y - 0.02;

/**
 * Builds one riverbank as a strip running from the waterline out to the top of
 * the bank. Extracted from the component so the terrain wiring can be asserted
 * without standing up a WebGL context.
 *
 * `range` builds a single chunk of the bank; the whole route is the default.
 */
/**
 * How far a strip may reach sideways before it folds through the bend.
 *
 * An offset curve inside a turn shrinks: at an offset equal to the radius of
 * curvature it collapses to a point, and beyond that it turns inside out. The
 * triangles there face backwards and a front-facing material culls them, so the
 * inside bank of a tight bend simply was not drawn - 45% of it missing at a
 * 120 m radius, which is an ordinary bend on a river (#285).
 *
 * The bank is held short of that. SAFE_FRACTION keeps it clear of the point
 * where the fold begins, because a strip reaching exactly to the centre of
 * curvature is degenerate rather than merely thin.
 */
const SAFE_FRACTION = 0.75;

/**
 * Signed curvature at `t`, per scene unit, measured along `perp`.
 *
 * Positive where the curve bends towards +perp. An offset curve at signed
 * offset `o` scales by `1 - o * k`, so it collapses when `o * k` reaches 1 and
 * turns inside out beyond that - which is the fold this exists to avoid. Taking
 * it signed rather than as a radius plus a separate 'which way is it turning'
 * test keeps it right through an inflection, where that test is answering on
 * the strength of a vanishing difference.
 */
const signedCurvatureAt = (
  curve: THREE.CatmullRomCurve3,
  t: number,
  perp: THREE.Vector3,
): number => {
  const step = 1e-3;
  const before = Math.max(0, t - step);
  const after = Math.min(1, t + step);
  if (after <= before) return 0;

  const a = curve.getTangentAt(before, new THREE.Vector3()).normalize();
  const b = curve.getTangentAt(after, new THREE.Vector3()).normalize();
  const arc = curve
    .getPointAt(before, new THREE.Vector3())
    .distanceTo(curve.getPointAt(after, new THREE.Vector3()));
  if (arc < 1e-9) return 0;

  return b.sub(a).dot(perp) / arc;
};
export const createBankGeometry = (
  curve: THREE.CatmullRomCurve3,
  side: 'left' | 'right',
  { enrichment, range = WHOLE_ROUTE }: StripGeometryOptions = {},
): THREE.BufferGeometry => {
  const schedule = stripProgressSchedule(curve, range);
  const segments = schedule.length - 1;
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  // Real elevations along the route (#202). Flat, or absent, leaves every
  // vertex exactly where it was before.
  const terrain = buildTerrainProfile(enrichment?.elevations);

  const point = new THREE.Vector3();
  const perp = new THREE.Vector3();
  const inner = new THREE.Vector3();
  const outer = new THREE.Vector3();
  const outward = side === 'left' ? -1 : 1;

  // Measured first, built second.
  //
  // How far the bank may reach depends on the bend, and clamping each sample
  // on its own made the outer edge jump - one sample reaching 48 units and its
  // neighbour 14. A quad with a step like that in it is folded whatever its
  // winding says, which is why clamping alone still left triangles facing
  // backwards. The reach is smoothed along the route before any vertex is
  // placed, so the outer edge is a curve rather than a staircase (#285).
  const frames = schedule.map((t) => {
    const p = new THREE.Vector3();
    const q = new THREE.Vector3();
    sampleStripFrame(curve, t, p, q);

    const waterWidth = getWaterWidthSceneUnitsForProgress(
      enrichment?.segmentProfiles,
      enrichment?.waterWidthMeters ?? WATER_CHANNEL_WIDTH / SCENE_SCALE,
      t,
    );
    const waterHalfWidth = waterWidth / 2;
    const wanted = waterHalfWidth + Math.max(RIVERBANK_WIDTH * 0.25, waterWidth * 2.25);

    // Where the offset curve would fold. Infinite on a straight and on the
    // outside of a bend, where an offset curve only ever grows.
    const curvature = signedCurvatureAt(curve, t, q) * outward;
    const limit = curvature > 0 ? Math.max(waterHalfWidth, SAFE_FRACTION / curvature) : Infinity;

    return { t, point: p, perp: q, waterHalfWidth, wanted, limit };
  });

  // A bend limits its neighbourhood, not just the sample that measured it:
  // the fold is a property of the arc, and the strip has to approach and leave
  // it gently.
  const WINDOW = 4;
  const limits = frames.map((_, i) => {
    let lowest = Infinity;
    for (let k = Math.max(0, i - WINDOW); k <= Math.min(frames.length - 1, i + WINDOW); k += 1) {
      lowest = Math.min(lowest, frames[k].limit);
    }
    return lowest;
  });

  let reaches = frames.map((f, i) => Math.min(f.wanted, limits[i]));
  // A few passes of averaging take the corners off what is left, each one
  // re-clamped so smoothing can never push the bank back through the fold.
  for (let pass = 0; pass < 3; pass += 1) {
    reaches = reaches.map((value, i) => {
      const before = reaches[Math.max(0, i - 1)];
      const after = reaches[Math.min(reaches.length - 1, i + 1)];
      const averaged = (before + value + after) / 3;
      return Math.max(frames[i].waterHalfWidth, Math.min(averaged, limits[i], frames[i].wanted));
    });
  }

  for (let i = 0; i <= segments; i++) {
    const { t, waterHalfWidth } = frames[i];
    point.copy(frames[i].point);
    perp.copy(frames[i].perp);

    inner.copy(point).addScaledVector(perp, outward * waterHalfWidth);
    outer.copy(point).addScaledVector(perp, outward * reaches[i]);

    // The waterline is where the water is, so the inner edge stays put and the
    // bank climbs away from it. Moving it would open a gap between land and
    // water - which is what a separate constant did (#334).
    inner.y = BANK_WATERLINE_Y;
    outer.y = BANK_WATERLINE_Y + getTerrainReliefForProgress(terrain, t);

    positions.push(inner.x, inner.y, inner.z);
    positions.push(outer.x, outer.y, outer.z);

    uvs.push(0, t * 10);
    uvs.push(1, t * 10);
    if (i < segments) {
      const base = i * 2;
      // Wound to match the side it is on.
      //
      // The two banks are mirror images - `outward` is -1 on one and +1 on the
      // other - and mirroring a triangle reverses which way it faces. Winding
      // both the same way left the right bank pointing away from the world, so
      // the material culled it and the whole right side of the river rendered
      // as sky: exactly what the published hero showed (#269).
      if (outward < 0) {
        indices.push(base, base + 2, base + 1);
        indices.push(base + 1, base + 2, base + 3);
      } else {
        indices.push(base, base + 1, base + 2);
        indices.push(base + 1, base + 3, base + 2);
      }
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  // A sloped bank lit by hardcoded (0,1,0) normals reads as flat, so the
  // relief would be invisible in anything but silhouette.
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  return geometry;
};

/** How far inside the water's edge the wet strip begins, in metres. */
export const SHORELINE_INNER_METRES = 0.4;
/** How far up the bank it reaches. */
export const SHORELINE_OUTER_METRES = 0.8;
/** Total width of the strip. */
export const SHORELINE_WIDTH_METRES = SHORELINE_INNER_METRES + SHORELINE_OUTER_METRES;

/**
 * The line where the water meets the land (#334).
 *
 * A narrow strip straddling the water's edge, carrying a foam-to-sand gradient
 * across its width: `uv.x` runs 0 at the wet end to 1 at the dry one, so the
 * material can fade out rather than stop.
 *
 * It does not need the fold-clamping the bank does. That exists because a bank
 * reaching tens of metres off a bend folds through its own centre of curvature
 * (#285); a strip 1.2 m wide cannot fold on any water a boat can turn in, so
 * this is the plain offset walk the bank cannot be.
 */
export const createShorelineGeometry = (
  curve: THREE.CatmullRomCurve3,
  side: 'left' | 'right',
  { enrichment, range = WHOLE_ROUTE }: StripGeometryOptions = {},
): THREE.BufferGeometry => {
  const schedule = stripProgressSchedule(curve, range);
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  const point = new THREE.Vector3();
  const perp = new THREE.Vector3();
  const edge = new THREE.Vector3();
  const outward = side === 'left' ? -1 : 1;

  schedule.forEach((t, i) => {
    sampleStripFrame(curve, t, point, perp);

    const waterHalfWidth =
      getWaterWidthSceneUnitsForProgress(
        enrichment?.segmentProfiles,
        enrichment?.waterWidthMeters ?? WATER_CHANNEL_WIDTH / SCENE_SCALE,
        t,
      ) / 2;

    for (const [offset, u] of [
      [waterHalfWidth - SHORELINE_INNER_METRES, 0],
      [waterHalfWidth + SHORELINE_OUTER_METRES, 1],
    ] as const) {
      edge.copy(point).addScaledVector(perp, outward * offset);
      // Just above the water, so the foam sits on the surface rather than in it.
      positions.push(edge.x, WATER_SURFACE_Y + 0.01, edge.z);
      uvs.push(u, t * 10);
    }

    if (i > 0) {
      const a = (i - 1) * 2;
      const b = i * 2;
      // Wound so the strip faces up on both banks; `outward` mirrors one of them.
      if (side === 'left') indices.push(a, a + 1, b, a + 1, b + 1, b);
      else indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
};
