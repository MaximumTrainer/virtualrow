// ============================================================================
// FOLIAGE PLAN — where the billboard trees stand, and how they are batched
// for the GPU (#333).
//
// The procedural trees were a slot every 2 % of route progress, eleven meshes
// each. On the 6.7 km demo that was one slot per 135 m and, after the dice for
// houses and mountains, one tree per ~340 m of bank: the hero camera looked
// down a lake between two empty lawns. It could not simply be made denser -
// ten times the trees at eleven draw calls each is a thousand draw calls.
//
// So a tree is now one instance of a crossed-quad billboard, all the trees of
// a species are one `InstancedMesh`, and a forest costs as many draw calls as
// it has species. Which makes it affordable to place them the way a bank is
// planted: by the metre.
//
// Pure, so the placement and the per-frame compaction are testable without a
// canvas; `foliageComponents.tsx` is the part that draws.
// ============================================================================
import * as THREE from 'three';
import { seededRandom } from './helpers';
import { getSegmentSceneryProfile } from './segmentScenery';
import type { SceneryTrack } from './sceneryTrack';
import { SCENERY_PROFILES } from './sceneryConfig';
import { foliageShapeFor, type FoliageShape } from './foliageTexture';
import type { TreeSpeciesEntry } from './themeConfig';
import { nearestBankOffset, waterHalfWidthAt, type Standing } from './sceneryClearance';
import {
  buildTerrainProfile,
  getTerrainReliefForProgress,
  type RouteEnrichmentData,
  type SceneryProfile,
} from '../../services/routeEnrichmentService';

/**
 * Metres of bank between planting slots, on each side.
 *
 * Each slot holds a tree with a chance that follows the profile's tree density
 * (`plantingChance`), so the mean gap between trees on one bank runs from
 * 13 m in forest, through 17-19 m in suburbs and the fallback country most
 * imported routes get, to 24-27 m across open farmland and a town centre.
 * That is chosen against the crowns: a broadleaf here is 10-15 m tall and 90 %
 * as wide, so at under 20 m apart, seen along the bank from a boat, the crowns
 * overlap into one continuous line - a tree-lined bank - while the wider gaps
 * on open and built-up stretches still read as open ground. It was ~340 m.
 */
export const FOLIAGE_SLOT_METRES = 10;

/**
 * How deep the planted band behind the bank is, in metres.
 *
 * Trees are biased toward its front edge (`FRONT_BIAS`), so the bank itself is
 * lined and the band behind it thins out into the country.
 */
export const FOLIAGE_BAND_DEPTH_METRES = 36;

/** Exponent on the seeded depth: above one, trees crowd toward the water. */
const FRONT_BIAS = 1.8;

/**
 * Metres a trunk keeps from the middle of a house.
 *
 * A house is at most 6.7 m across (4.2 m at the largest landscape scale of
 * 1.6), and a crown up to about 7 m in radius; ten metres keeps the crown off
 * the wall and out of the roof.
 */
export const FOLIAGE_BUILDING_CLEARANCE_METRES = 10;

/**
 * A shape's height in metres at a profile scale of one, and its width as a
 * fraction of that height. The geometry is one unit tall and `aspect` wide,
 * so a tree's instance scale is simply its height.
 */
export const FOLIAGE_SHAPE_SIZE: Record<FoliageShape, { height: number; aspect: number }> = {
  broadleaf: { height: 14, aspect: 0.9 },
  conifer: { height: 17, aspect: 0.55 },
  willow: { height: 12, aspect: 1.15 },
};

export interface FoliageTree {
  position: [number, number, number];
  /** 0..1 along the route, where the tree was planted. */
  progress: number;
  /** Index into the species list the layout was given. */
  species: number;
  /** Metres, trunk base to crown top. */
  height: number;
  /** Radians about the vertical: which way the crossed quads face. */
  yaw: number;
}

export interface FoliageLayoutInput {
  curve: THREE.Curve<THREE.Vector3> | null;
  enrichment?: RouteEnrichmentData | null;
  /** Authored dressing, preferred over enrichment when the route has one (#232). */
  track?: SceneryTrack | null;
  /** The species the scene config colours: `SCENE_CONFIG.trees.species`. */
  species: readonly TreeSpeciesEntry[];
  /** Houses to keep clear of, on the ground plane. */
  avoid?: readonly { x: number; z: number }[];
}

/** Chance a slot is planted, from the profile's 0-1 tree density. */
const plantingChance = (density: number): number => 0.3 + 0.5 * density;

/**
 * Which of `species` a profile may plant, as indices.
 *
 * The species the profile names, where the config gives them a colour; failing
 * that, the configured species drawn in the same shapes, so a village of
 * ornamentals gets broadleaves rather than pines; failing that, all of them.
 */
const speciesFor = (profile: SceneryProfile, species: readonly TreeSpeciesEntry[]): number[] => {
  const named = new Set(SCENERY_PROFILES[profile].trees.species);
  const all = species.map((_, i) => i);
  const byName = all.filter((i) => named.has(species[i].type));
  if (byName.length > 0) return byName;
  const shapes = new Set([...named].map(foliageShapeFor));
  const byShape = all.filter((i) => shapes.has(foliageShapeFor(species[i].type)));
  return byShape.length > 0 ? byShape : all;
};

const UP = new THREE.Vector3(0, 1, 0);

/**
 * Plant both banks of a route. Pure and deterministic.
 *
 * Walks the route a slot at a time in metres, and at each slot rolls for a
 * tree on either bank. A tree stands at least the water's half-width plus
 * `SCENERY_WATER_MARGIN_METRES` from the centreline at its own progress
 * (#379), and up to `FOLIAGE_BAND_DEPTH_METRES` further back.
 */
export const layoutFoliage = ({
  curve,
  enrichment,
  track = null,
  species,
  avoid = [],
}: FoliageLayoutInput): FoliageTree[] => {
  if (!curve) return [];

  const length = curve.getLength();
  const slots = Math.floor(length / FOLIAGE_SLOT_METRES);
  // The same terrain the banks are built from, so a trunk stands on the
  // raised ground rather than in it (#202).
  const terrain = buildTerrainProfile(enrichment?.elevations);
  const clearOfHouses = (x: number, z: number) =>
    avoid.every((h) => Math.hypot(h.x - x, h.z - z) >= FOLIAGE_BUILDING_CLEARANCE_METRES);

  const trees: FoliageTree[] = [];
  for (let slot = 0; slot < slots; slot += 1) {
    for (const side of [-1, 1]) {
      const seed = slot * 13 + (side < 0 ? 1 : 7);
      const draw = (k: number) => seededRandom(seed * 11 + k);

      const metres = (slot + 0.5 + (draw(1) - 0.5) * 0.8) * FOLIAGE_SLOT_METRES;
      const t = Math.min(1, metres / length);
      const profile = getSegmentSceneryProfile(enrichment, t, track);
      const { density, scaleRange } = SCENERY_PROFILES[profile].trees;
      if (draw(2) >= plantingChance(density)) continue;

      const point = curve.getPointAt(t);
      const perp = new THREE.Vector3().crossVectors(curve.getTangentAt(t).normalize(), UP).normalize();
      const offset =
        nearestBankOffset(waterHalfWidthAt(enrichment, t)) +
        FOLIAGE_BAND_DEPTH_METRES * Math.pow(draw(3), FRONT_BIAS);
      const x = point.x + perp.x * side * offset;
      const z = point.z + perp.z * side * offset;
      if (!clearOfHouses(x, z)) continue;

      const choices = speciesFor(profile, species);
      const pick = choices[Math.floor(draw(4) * choices.length)];
      const [scaleMin, scaleMax] = scaleRange;
      const shape = foliageShapeFor(species[pick].type);
      trees.push({
        position: [x, getTerrainReliefForProgress(terrain, t), z],
        progress: t,
        species: pick,
        height: FOLIAGE_SHAPE_SIZE[shape].height * (scaleMin + draw(5) * (scaleMax - scaleMin)),
        yaw: draw(6) * Math.PI,
      });
    }
  }
  return trees;
};

/** Every tree's position and progress, in the shape `landClearance` measures. */
export const foliageStanding = (trees: readonly FoliageTree[]): Standing[] =>
  trees.map(({ position, progress }) => ({ position, progress }));

/** One species' trees, ready to hand to an `InstancedMesh`. */
export interface FoliageBatch {
  /** A column-major 4x4 per tree, as `InstancedMesh.instanceMatrix` holds them. */
  matrices: Float32Array;
  /** xz per tree, for the distance cull. */
  centres: Float32Array;
  count: number;
}

/** Group `trees` by species into instance matrices. */
export const batchFoliage = (trees: readonly FoliageTree[], speciesCount: number): FoliageBatch[] => {
  const matrix = new THREE.Matrix4();
  const rotation = new THREE.Quaternion();
  const position = new THREE.Vector3();
  const scale = new THREE.Vector3();
  return Array.from({ length: speciesCount }, (_, s) => {
    const own = trees.filter((t) => t.species === s);
    const matrices = new Float32Array(own.length * 16);
    const centres = new Float32Array(own.length * 2);
    own.forEach((tree, i) => {
      position.fromArray(tree.position);
      rotation.setFromAxisAngle(UP, tree.yaw);
      scale.setScalar(tree.height);
      matrix.compose(position, rotation, scale).toArray(matrices, i * 16);
      centres[i * 2] = tree.position[0];
      centres[i * 2 + 1] = tree.position[2];
    });
    return { matrices, centres, count: own.length };
  });
};

/**
 * Copy the matrices of the trees within `range` of the boat to the front of
 * `target`, in order, and return how many there are.
 *
 * This is the distance cull (#331) for instances: set the mesh's `count` to
 * the result and only those are drawn. It writes into `target` rather than
 * allocating, because it runs in the frame loop.
 */
export const compactVisible = (
  batch: FoliageBatch,
  boat: THREE.Vector3,
  range: number,
  target: Float32Array,
): number => {
  const rangeSquared = range * range;
  let visible = 0;
  for (let i = 0; i < batch.count; i += 1) {
    const dx = batch.centres[i * 2] - boat.x;
    const dz = batch.centres[i * 2 + 1] - boat.z;
    if (dx * dx + dz * dz > rangeSquared) continue;
    target.set(batch.matrices.subarray(i * 16, i * 16 + 16), visible * 16);
    visible += 1;
  }
  return visible;
};

/**
 * Two quads crossed at right angles, one unit tall and `aspect` wide, standing
 * on the origin.
 *
 * One geometry rather than two meshes sharing a matrix buffer: the second quad
 * is the first turned 90°, which is a fact about the shape, not the instance,
 * so it lives in the vertices and a species is one draw call instead of two.
 *
 * The normals lean up and out from the trunk, as they would on the crown's
 * surface. A flat card's normal faces sideways, so half the bank would light
 * as one card and half as the other, and every tree would show its seam.
 *
 * Each quad is in here twice, once wound each way, and the material draws
 * front faces only. A double-sided material would do with half the triangles,
 * but three flips a double-sided face's normal when it is seen from behind -
 * which points these ones into the ground, and the tree nearest the camera
 * came out black.
 */
export const createFoliageGeometry = (aspect: number): THREE.BufferGeometry => {
  const half = aspect / 2;
  const corners: Array<[number, number, number, number, number]> = [
    // x, y, z, u, v - the quad across x
    [-half, 0, 0, 0, 0], [half, 0, 0, 1, 0], [half, 1, 0, 1, 1], [-half, 1, 0, 0, 1],
    // and the quad across z
    [0, 0, -half, 0, 0], [0, 0, half, 1, 0], [0, 1, half, 1, 1], [0, 1, -half, 0, 1],
  ];
  const normal = new THREE.Vector3();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(corners.flatMap(([x, y, z]) => [x, y, z]), 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(corners.flatMap(([, , , u, v]) => [u, v]), 2));
  geometry.setAttribute(
    'normal',
    new THREE.Float32BufferAttribute(
      corners.flatMap(([x, y, z]) => normal.set((x / half) * 0.6, 1 + y * 0.4, (z / half) * 0.6).normalize().toArray()),
      3,
    ),
  );
  const front = [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7];
  const back = [0, 2, 1, 0, 3, 2, 4, 6, 5, 4, 7, 6];
  geometry.setIndex([...front, ...back]);
  return geometry;
};

/**
 * Whether the billboard foliage is drawn.
 *
 * Always, unless a spec sets `window.__VIRTUALROW_FOLIAGE = false` to measure
 * what the forest costs by the difference - the way
 * `__VIRTUALROW_SCENERY_MODELS` lets the kit's budget spec do the same.
 */
export const isFoliageEnabled = (): boolean =>
  !['nofoliage', 'bare', 'bare-maintests'].includes(import.meta.env.VITE_BENCH_VARIANT ?? '') && window.__VIRTUALROW_FOLIAGE !== false;
