import React, { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { createWebGPUCuller } from './createWebGPUCuller';
import { applyIndicesToMesh } from './applyIndicesToMesh';
import { useWebGPUDevice } from './useWebGPUDevice';
import type { WebGPUCullPort } from './types';

/**
 * The spike's #498 FR3 component. When the flag is on and a WebGPU device
 * is ready, it mounts one `createWebGPUCuller` per chunk and takes over the
 * per-frame cull: dispatch, map, pack indices into the mesh. When the
 * device isn't ready — pending or fallback — it does nothing, and the
 * parent `BankFoliage`'s CPU `cullTo` keeps running. The handover is
 * driven by `activeRef`: parent reads it on each frame and skips the CPU
 * branch when this component says it has the mesh.
 *
 * The component is lazy-imported by `BankFoliage` behind
 * `isWebGPUCullEnabled()`, so this module (and `@webgpu/types` by
 * extension) stays out of the default bundle.
 */

export interface WebGPUFoliageChunk {
  /** Instance centres in xz pairs (parity with `FoliageBatch.centres`). */
  centres: Float32Array;
  /** The chunk's instance matrices, as handed to its `InstancedMesh`. */
  matrices: Float32Array;
  /** How many instances this chunk holds. */
  count: number;
  /** The chunk's mean ground height, for the frustum sample y. */
  groundY: number;
}

export interface WebGPUFoliageCullerProps {
  chunks: readonly WebGPUFoliageChunk[];
  meshRefs: React.RefObject<Array<THREE.InstancedMesh | null>>;
  positionRef: React.RefObject<THREE.Vector3 | null>;
  viewDistance: number;
  /** How often (frames) to cull — matches `FOLIAGE_CULL_FRAME_INTERVAL`. */
  cullFrameInterval: number;
  /** Set to true when this component is driving the mesh; parent reads it. */
  activeRef: React.MutableRefObject<boolean>;
}

const projectionViewMatrix = new THREE.Matrix4();
const frustumBuffer = new Float32Array(24);
const frustumHelper = new THREE.Frustum();

const writeFrustumPlanes = (camera: THREE.Camera): Float32Array => {
  projectionViewMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustumHelper.setFromProjectionMatrix(projectionViewMatrix);
  frustumHelper.planes.forEach((plane, i) => {
    frustumBuffer[i * 4] = plane.normal.x;
    frustumBuffer[i * 4 + 1] = plane.normal.y;
    frustumBuffer[i * 4 + 2] = plane.normal.z;
    frustumBuffer[i * 4 + 3] = plane.constant;
  });
  return frustumBuffer;
};

export const WebGPUFoliageCuller: React.FC<WebGPUFoliageCullerProps> = ({
  chunks,
  meshRefs,
  positionRef,
  viewDistance,
  cullFrameInterval,
  activeRef,
}) => {
  const deviceState = useWebGPUDevice();
  const camera = useThree((state) => state.camera);

  const cullers = useMemo<WebGPUCullPort[] | null>(() => {
    if (deviceState.kind !== 'ready') return null;
    return chunks.map((chunk) =>
      createWebGPUCuller({ device: deviceState.device, instanceCount: chunk.count }),
    );
  }, [deviceState, chunks]);

  useEffect(() => {
    if (!cullers) return;
    activeRef.current = true;
    return () => {
      activeRef.current = false;
      cullers.forEach((c) => c.dispose());
    };
  }, [cullers, activeRef]);

  const frameRef = useRef(0);
  const inFlight = useRef(false);

  useFrame(() => {
    if (!cullers) return;
    frameRef.current += 1;
    if (frameRef.current % cullFrameInterval !== 0) return;
    if (inFlight.current) return;
    const boat = positionRef.current;
    if (!boat) return;
    const planes = writeFrustumPlanes(camera);
    inFlight.current = true;
    (async () => {
      try {
        for (let i = 0; i < cullers.length; i += 1) {
          const mesh = meshRefs.current[i];
          const chunk = chunks[i];
          if (!mesh) continue;
          const indices = await cullers[i].cull({
            centres: chunk.centres,
            boat: { x: boat.x, z: boat.z },
            range: viewDistance,
            treeY: chunk.groundY,
            frustumPlanes: planes,
          });
          applyIndicesToMesh(mesh, chunk.matrices, indices);
        }
      } finally {
        inFlight.current = false;
      }
    })();
  });

  return null;
};

export default WebGPUFoliageCuller;
