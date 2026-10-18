// ============================================================================
// BANK FOLIAGE — the route's trees, as instanced crossed billboards (#333).
//
// One `InstancedMesh` per species in the scene config, holding every tree of
// that species on the route. The layout and the cull are pure and live in
// `foliagePlan.ts`; this is the part that owns GPU objects and the frame loop.
// ============================================================================
import React, { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useAnimationFrame } from './animationFrame';
import { isTelemetryPublished } from './constants';
import { SCENE_CONFIG } from './themeConfig';
import { createFoliageTexture, foliageShapeFor, type FoliageShape } from './foliageTexture';
import { makeFoliageBillboardMaterial } from './foliageMaterial';
import {
  FOLIAGE_SHAPE_SIZE,
  batchFoliageChunked,
  compactVisible,
  createFoliageGeometry,
  foliageStanding,
  layoutFoliage,
  type FoliageBatch,
} from './foliagePlan';
import { landClearance, publishSceneryClearance } from './sceneryClearance';
import type { SceneryTrack } from './sceneryTrack';
import type { RouteEnrichmentData } from '../../services/routeEnrichmentService';

/** The group's name, and the prefix of each species mesh's: `BankFoliage:oak`. */
export const BANK_FOLIAGE_NAME = 'BankFoliage';

/**
 * Frames between foliage culls, the cadence the rest of the scenery uses: a
 * tree on a bank does not arrive in a sixtieth of a second.
 */
export const FOLIAGE_CULL_FRAME_INTERVAL = 6;

export interface BankFoliageProps {
  curve: THREE.Curve<THREE.Vector3> | null;
  /** Where the boat is, read in the frame loop to decide what is drawn (#331). */
  positionRef?: React.RefObject<THREE.Vector3 | null>;
  /** Metres past which a tree stops being drawn - the fog's far plane. */
  viewDistance: number;
  enrichment?: RouteEnrichmentData | null;
  track?: SceneryTrack | null;
  /** Houses on the bank, which the trees keep out of. */
  avoid?: readonly { x: number; z: number }[];
  /**
   * Metres of route per (species) chunk; comes from the quality tier's
   * `foliageChunkMetres` (#497). Omitted falls back to a single chunk per
   * species, i.e. the pre-#497 behaviour.
   */
  chunkMetres?: number;
}

/** What a species is drawn with: its own geometry, and a material over its shape's texture. */
interface SpeciesParts {
  name: string;
  geometry: THREE.BufferGeometry;
  material: THREE.MeshLambertMaterial;
}

/**
 * Write `batch` into `mesh` whole, so every tree is drawn until the first cull.
 *
 * Kept outside the component, like the writes in the frame loop: an instance
 * buffer is a handle the GPU reads, written in place by design.
 */
const fillAll = (mesh: THREE.InstancedMesh, batch: FoliageBatch) => {
  mesh.instanceMatrix.array.set(batch.matrices);
  mesh.count = batch.count;
  mesh.instanceMatrix.needsUpdate = true;
};

/** Draw only the trees of `batch` within `range` of `boat`; returns how many. */
const cullTo = (mesh: THREE.InstancedMesh, batch: FoliageBatch, boat: THREE.Vector3, range: number) => {
  const visible = compactVisible(batch, boat, range, mesh.instanceMatrix.array as Float32Array);
  mesh.count = visible;
  mesh.instanceMatrix.clearUpdateRanges();
  mesh.instanceMatrix.addUpdateRange(0, visible * 16);
  mesh.instanceMatrix.needsUpdate = true;
  return visible;
};

const advanceSway = (uniform: THREE.IUniform<number>, time: number) => {
  uniform.value = time;
};

const publishFoliage = (reading: NonNullable<Window['__ROWER3D_FOLIAGE']>) => {
  if (isTelemetryPublished()) window.__ROWER3D_FOLIAGE = reading;
};

export const BankFoliage: React.FC<BankFoliageProps> = ({
  curve,
  positionRef,
  viewDistance,
  enrichment,
  track = null,
  avoid,
  chunkMetres,
}) => {
  const species = SCENE_CONFIG.trees.species;

  const trees = useMemo(
    () => layoutFoliage({ curve, enrichment, track, species, avoid }),
    [curve, enrichment, track, species, avoid],
  );
  // One chunk per species when the curve isn't ready or no chunking was asked;
  // otherwise split along route progress so three's own frustum test can
  // skip whole chunks whose bounding sphere is off-camera (#497).
  const routeLengthMetres = useMemo(() => (curve ? curve.getLength() : 0), [curve]);
  const effectiveChunkMetres = useMemo(
    () => (chunkMetres && chunkMetres > 0 ? chunkMetres : Math.max(1, routeLengthMetres) || 1),
    [chunkMetres, routeLengthMetres],
  );
  const chunks = useMemo(
    () => batchFoliageChunked(trees, species.length, routeLengthMetres, effectiveChunkMetres),
    [trees, species.length, routeLengthMetres, effectiveChunkMetres],
  );

  // One texture per shape, however many species share it.
  const textures = useMemo(() => {
    const shapes = new Set(species.map((s) => foliageShapeFor(s.type)));
    return new Map<FoliageShape, THREE.Texture>([...shapes].map((shape) => [shape, createFoliageTexture(shape)]));
  }, [species]);
  const swayTime = useMemo<THREE.IUniform<number>>(() => ({ value: 0 }), []);
  const parts = useMemo<SpeciesParts[]>(
    () =>
      species.map((entry) => {
        const shape = foliageShapeFor(entry.type);
        return {
          name: `${BANK_FOLIAGE_NAME}:${entry.type}`,
          geometry: createFoliageGeometry(FOLIAGE_SHAPE_SIZE[shape].aspect),
          material: makeFoliageBillboardMaterial({ map: textures.get(shape)!, color: entry.color }, swayTime),
        };
      }),
    [species, textures, swayTime],
  );
  useEffect(
    () => () => {
      parts.forEach(({ geometry, material }) => {
        geometry.dispose();
        material.dispose();
      });
      textures.forEach((texture) => texture.dispose());
    },
    [parts, textures],
  );

  const meshRefs = useRef<Array<THREE.InstancedMesh | null>>([]);
  useLayoutEffect(() => {
    chunks.forEach((chunk, i) => {
      const mesh = meshRefs.current[i];
      if (!mesh) return;
      fillAll(mesh, chunk);
      // Fixed bounding sphere per chunk; the per-frame `cullTo` packs the
      // visible instances to the front of the buffer but never adds any that
      // weren't in this chunk, so the sphere is right until the trees move
      // (which they don't). Three's own frustum test now skips the whole
      // chunk when the camera isn't looking at it (#497).
      mesh.boundingSphere = new THREE.Sphere(
        new THREE.Vector3(chunk.boundingSphere.x, chunk.boundingSphere.y, chunk.boundingSphere.z),
        chunk.boundingSphere.radius,
      );
    });
  }, [chunks]);

  useEffect(() => {
    if (!curve) return;
    publishSceneryClearance('foliage', landClearance(foliageStanding(trees), curve, enrichment));
    publishFoliage({
      trees: trees.length,
      meshes: chunks.filter((c) => c.count > 0).length,
      drawn: trees.length,
    });
  }, [curve, enrichment, trees, chunks]);

  const cullFrameRef = useRef(0);
  useAnimationFrame((time) => {
    advanceSway(swayTime, time);

    const boat = positionRef?.current;
    if (!boat) return;
    cullFrameRef.current += 1;
    if (cullFrameRef.current % FOLIAGE_CULL_FRAME_INTERVAL !== 0) return;

    let drawn = 0;
    chunks.forEach((chunk, i) => {
      const mesh = meshRefs.current[i];
      if (mesh) drawn += cullTo(mesh, chunk, boat, viewDistance);
    });
    if (window.__ROWER3D_FOLIAGE && window.__ROWER3D_FOLIAGE.drawn !== drawn) {
      publishFoliage({ ...window.__ROWER3D_FOLIAGE, drawn });
    }
  });

  return (
    <group name={BANK_FOLIAGE_NAME}>
      {chunks.map((chunk, i) => {
        const part = parts[chunk.species];
        return (
          <instancedMesh
            key={`${part.name}:${chunk.chunkIndex}-${chunk.count}`}
            ref={(mesh: THREE.InstancedMesh | null) => {
              meshRefs.current[i] = mesh;
            }}
            args={[part.geometry, part.material, chunk.count]}
            name={`${part.name}:${chunk.chunkIndex}`}
            // Each chunk's bounding sphere encloses only its own trees, set in
            // the layout effect above; three's own test skips the whole
            // chunk when it's off-camera (#497).
            frustumCulled={true}
            /*
             * No `castShadow` (#352).
             *
             * Two reasons, and the first is correctness. A billboard's facing
             * and its sway are computed in a patched vertex shader, and three
             * casts shadows through its own `MeshDepthMaterial`, which does
             * not carry `onBeforeCompile` — so the shadow would be of an
             * unrotated, unswaying quad rather than of the tree that is drawn.
             * Casting it properly needs a matching `customDepthMaterial`,
             * which is its own piece of work.
             *
             * The second is cost. This was set before #352, and did nothing:
             * the shadow camera sat at the origin while the boat rowed away,
             * so the forest was never inside it. With the frustum following
             * the boat the forest is in it always, and drawing 400 trees a
             * second time doubled what the forest costs.
             */
          />
        );
      })}
    </group>
  );
};
