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
  batchFoliage,
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
}) => {
  const species = SCENE_CONFIG.trees.species;

  const trees = useMemo(
    () => layoutFoliage({ curve, enrichment, track, species, avoid }),
    [curve, enrichment, track, species, avoid],
  );
  const batches = useMemo(() => batchFoliage(trees, species.length), [trees, species.length]);

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
    batches.forEach((batch, i) => {
      const mesh = meshRefs.current[i];
      if (mesh) fillAll(mesh, batch);
    });
  }, [batches]);

  useEffect(() => {
    if (!curve) return;
    publishSceneryClearance('foliage', landClearance(foliageStanding(trees), curve, enrichment));
    publishFoliage({
      trees: trees.length,
      meshes: batches.filter((b) => b.count > 0).length,
      drawn: trees.length,
    });
  }, [curve, enrichment, trees, batches]);

  const cullFrameRef = useRef(0);
  useAnimationFrame((time) => {
    advanceSway(swayTime, time);

    const boat = positionRef?.current;
    if (!boat) return;
    cullFrameRef.current += 1;
    if (cullFrameRef.current % FOLIAGE_CULL_FRAME_INTERVAL !== 0) return;

    let drawn = 0;
    batches.forEach((batch, i) => {
      const mesh = meshRefs.current[i];
      if (mesh) drawn += cullTo(mesh, batch, boat, viewDistance);
    });
    if (window.__ROWER3D_FOLIAGE && window.__ROWER3D_FOLIAGE.drawn !== drawn) {
      publishFoliage({ ...window.__ROWER3D_FOLIAGE, drawn });
    }
  });

  return (
    <group name={BANK_FOLIAGE_NAME}>
      {parts.map((part, i) =>
        batches[i].count === 0 ? null : (
          <instancedMesh
            key={`${part.name}-${batches[i].count}`}
            ref={(mesh: THREE.InstancedMesh | null) => {
              meshRefs.current[i] = mesh;
            }}
            args={[part.geometry, part.material, batches[i].count]}
            name={part.name}
            // The instances move about the buffer as the cull packs it, so a
            // bounding sphere computed once would be wrong by the next cull.
            frustumCulled={false}
            castShadow={!(window as unknown as { __BENCH?: { noshadow?: boolean } }).__BENCH?.noshadow}
          />
        ),
      )}
    </group>
  );
};
