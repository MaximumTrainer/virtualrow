import React, { useCallback, useMemo, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { useAnimationFrame } from './animationFrame';
import { curveLengthMeters } from './curve';
import {
  CHUNK_VIEW_DISTANCE_SCENE_UNITS,
  chunkCountForRoute,
  chunkProgressRanges,
  isChunkWithinViewDistance,
  type ProgressRange,
} from './geometryChunks';
import { useProgressiveChunks } from '../../hooks/useProgressiveChunks';

// ============================================================================
// A ribbon that follows the route — the water channel, or one riverbank —
// built and drawn in pieces (#224).
//
// The pieces the boat starts on are built before the first frame; the rest
// arrive during idle time. Each frame, pieces the camera cannot see through
// view distance are switched off, so a 20 km course costs the same draw calls as a
// 2 km one.
// ============================================================================

export interface RouteStripChunksProps {
  curve: THREE.CatmullRomCurve3;
  /** Shared across every chunk: one material, one shader program, one upload. */
  material: THREE.Material;
  buildChunk: (range: ProgressRange) => THREE.BufferGeometry;
  /** Chunks built before the first frame, counted from the start of the route. */
  eagerChunks?: number;
  /**
   * Metres past which a chunk stops being drawn.
   *
   * Passed in rather than read from a constant, because how far is worth
   * drawing is decided by how far can be seen - which is the fog (#325).
   */
  viewDistance?: number;
  /**
   * A material element per chunk, instead of the shared `material` instance.
   *
   * The `high` water is drei's `MeshReflectorMaterial`, which is a component
   * rather than a material class: it owns a render target and hooks its mesh's
   * `onBeforeRender` to fill it. So it cannot be one instance shared across
   * chunks, and it is only rendered for chunks the cull has left visible —
   * an invisible mesh's `onBeforeRender` never runs, so a 20 km course pays
   * for the one or two chunks in front of the boat and not for the rest (#324).
   */
  renderMaterial?: () => React.ReactNode;
}

export const RouteStripChunks: React.FC<RouteStripChunksProps> = ({
  curve,
  material,
  buildChunk,
  eagerChunks = 2,
  viewDistance = CHUNK_VIEW_DISTANCE_SCENE_UNITS,
  renderMaterial,
}) => {
  const ranges = useMemo(
    () => chunkProgressRanges(chunkCountForRoute(curveLengthMeters(curve))),
    [curve],
  );

  const buildByIndex = useCallback(
    (index: number) => buildChunk(ranges[index]),
    [buildChunk, ranges],
  );

  const chunks = useProgressiveChunks(ranges.length, buildByIndex, eagerChunks);

  const groupRef = useRef<THREE.Group>(null);
  const { camera } = useThree();

  useAnimationFrame(() => {
    const group = groupRef.current;
    if (!group) return;
    for (const child of group.children) {
      const mesh = child as THREE.Mesh;
      mesh.visible = isChunkWithinViewDistance(
        mesh.geometry.boundingSphere,
        camera.position,
        viewDistance,
      );
    }
  });

  return (
    <group ref={groupRef}>
      {chunks.map(
        (geometry, index) =>
          geometry && (
            <mesh key={index} geometry={geometry} receiveShadow>
              {renderMaterial ? (
                renderMaterial()
              ) : (
                <primitive object={material} attach="material" />
              )}
            </mesh>
          ),
      )}
    </group>
  );
};
