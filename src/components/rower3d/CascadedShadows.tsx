// ============================================================================
// CASCADED SHADOW MAPS — three/examples/jsm/csm, mounted the R3F way (#495).
//
// A `DirectionalLight` with one shadow map covers the whole follow-camera
// frustum, so a map texel on the near shoreline is the same width as one on
// the far horizon. Near shadows read as blocky and far shadows go missing.
//
// CSM splits the view volume into N cascades — each a slice of depth with its
// own tightly-fitting shadow map, selected per fragment by three's injected
// shader chunks. The sun's direction and intensity stay as they were, but
// three's `CSM` creates its own `DirectionalLight`s under the hood (one per
// cascade) and manages their shadow cameras from the main view camera.
//
// Phase 2 (this file now): flipped the default of `__VIRTUALROW_CSM` on in
// `isCsmEnabled`, and this component walks the scene every frame for
// `receiveShadow` meshes and calls `csm.setupMaterial` on each material
// exactly once (`shadowReceivers.ts`). For a material that already has its
// own `onBeforeCompile` (bankMaterial's triplanar chain, for one), the
// existing callback is preserved and run alongside CSM's injection.
// ============================================================================

import { useEffect, useMemo, useRef } from 'react';
import type * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import type { CSM } from 'three/examples/jsm/csm/CSM.js';
import { createCascadedShadows, type CascadedShadowsConfig } from './cascadedShadowsCore';
import {
  wireShadowReceivers,
  unwireShadowReceivers,
  type SetupRecord,
} from './shadowReceivers';

export type CascadedShadowsProps = CascadedShadowsConfig;

/**
 * Mounts a CSM instance for the duration this component is in the tree.
 *
 * `useFrame` updates CSM each frame against the main render camera and
 * rescans the scene for new shadow-receiving materials (R3F mounts can land
 * after the component's own effect runs); the cleanup effect disposes the
 * lights, reverts the materials, and clears the injected shader chunks so
 * a tier change doesn't leak directional lights or stale CSM defines.
 */
export const CascadedShadows: React.FC<CascadedShadowsProps> = (props) => {
  const camera = useThree((state) => state.camera);
  const scene = useThree((state) => state.scene);
  const csmRef = useRef<CSM | null>(null);
  const seenRef = useRef<Map<THREE.Material, SetupRecord>>(new Map());

  const stableProps = useMemo(
    () => props,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      props.cascades,
      props.shadowMapSize,
      props.lightIntensity,
      props.maxFar,
      props.lightColor,
      props.lightDirection.x,
      props.lightDirection.y,
      props.lightDirection.z,
    ],
  );

  useEffect(() => {
    const csm = createCascadedShadows(camera, scene, stableProps);
    csmRef.current = csm;
    const seen = seenRef.current;
    // Catch materials present at mount; `useFrame` catches the rest.
    wireShadowReceivers(csm, scene, seen);
    return () => {
      unwireShadowReceivers(seen);
      csm.remove();
      csm.dispose();
      csmRef.current = null;
    };
  }, [camera, scene, stableProps]);

  useFrame(() => {
    const csm = csmRef.current;
    if (!csm) return;
    wireShadowReceivers(csm, scene, seenRef.current);
    csm.update();
  });

  return null;
};
