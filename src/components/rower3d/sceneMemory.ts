import * as THREE from 'three';

// ============================================================================
// GPU memory sampling (#224).
//
// `renderer.info.memory` counts geometries and textures but says nothing about
// how large they are, and the acceptance criterion for a 20 km route is stated
// in megabytes. Attribute buffers are the part route geometry controls, so they
// are summed here directly.
// ============================================================================

export const MEGABYTE = 1024 * 1024;

/** The subset of `THREE.WebGLRenderer` this needs, so a stub satisfies it. */
export interface RendererMemorySource {
  info?: { memory?: { geometries?: number; textures?: number } };
}

export interface SceneMemoryUsage {
  /** Bytes of vertex and index data resident for the scene's geometry. */
  geometryBytes: number;
  /** The same figure in megabytes. */
  geometryMb: number;
  /** `renderer.info.memory.geometries`. */
  geometries: number;
  /** `renderer.info.memory.textures`. */
  textures: number;
}

/**
 * Measure the geometry the scene is holding.
 *
 * Counts each `BufferGeometry` once however many meshes share it, and counts
 * geometry that is currently switched off: chunk culling sets `visible = false`
 * to save draw calls, and the buffers stay uploaded either way.
 */
export const measureSceneMemory = (
  scene: THREE.Object3D,
  renderer: RendererMemorySource,
): SceneMemoryUsage => {
  const counted = new Set<THREE.BufferGeometry>();
  let geometryBytes = 0;

  scene.traverse((object) => {
    const geometry = (object as Partial<THREE.Mesh>).geometry as THREE.BufferGeometry | undefined;
    if (!geometry || counted.has(geometry)) return;
    counted.add(geometry);

    for (const attribute of Object.values(geometry.attributes)) {
      geometryBytes += (attribute as THREE.BufferAttribute).array.byteLength ?? 0;
    }
    geometryBytes += geometry.getIndex()?.array.byteLength ?? 0;
  });

  return {
    geometryBytes,
    geometryMb: geometryBytes / MEGABYTE,
    geometries: renderer.info?.memory?.geometries ?? 0,
    textures: renderer.info?.memory?.textures ?? 0,
  };
};
