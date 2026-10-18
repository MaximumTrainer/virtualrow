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
// Phase 1 of #495 ships this wrapper with the runtime flag `__VIRTUALROW_CSM`
// defaulting off: the wrapper mounts only when a spec or dev console sets the
// flag to `true`. Phase 2 flips the default and calls `csm.setupMaterial()`
// on the real shadow-receiving materials (bank, water, boat, ...) so the
// cascades pick per-fragment instead of all cascades summing on every
// receiver.
// ============================================================================

import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import type { CSM } from 'three/examples/jsm/csm/CSM.js';
import { createCascadedShadows, type CascadedShadowsConfig } from './cascadedShadowsCore';

export type CascadedShadowsProps = CascadedShadowsConfig;

/**
 * Mounts a CSM instance for the duration this component is in the tree.
 *
 * `useFrame` updates CSM each frame against the main render camera; the
 * cleanup effect disposes the lights and the injected shader chunks when
 * the component unmounts, so a tier change doesn't leak directional lights.
 */
export const CascadedShadows: React.FC<CascadedShadowsProps> = (props) => {
  const camera = useThree((state) => state.camera);
  const scene = useThree((state) => state.scene);
  const csmRef = useRef<CSM | null>(null);

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
    return () => {
      csm.remove();
      csm.dispose();
      csmRef.current = null;
    };
  }, [camera, scene, stableProps]);

  useFrame(() => {
    csmRef.current?.update();
  });

  return null;
};
