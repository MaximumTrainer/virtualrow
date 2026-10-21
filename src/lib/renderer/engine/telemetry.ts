/**
 * Writes the `__ROWER3D_*` globals the engine publishes each frame, keeping
 * the same shapes the three scene's `Rower3D.tsx` and `src/webgpu/health.ts`
 * write on `main` (P2-AC5 of #550 — a schema snapshot diffs this).
 *
 * The UI thread's host leaves these to the engine (no sink callback).
 */

export interface Rower3DRenderStats {
  draws: number;
  triangles: number;
  instances: number;
  /**
   * Per-pass counts for scenery (#555 FR6). Zero on `main`'s three scene;
   * engine-written numbers from P3 onwards.
   */
  sceneryDispatch: number;
  sceneryDraws: number;
  sceneryTriangles: number;
  /** Shadow stage counts (#559 FR7). */
  shadowDraws: number;
  shadowTriangles: number;
  shadowAtlasBytes: number;
}

export interface Rower3DFrameStats {
  frame: number;
  dtMs: number;
  gpuMs: number;
}

export interface Rower3DCamera {
  x: number;
  y: number;
  z: number;
  lookX: number;
  lookY: number;
  lookZ: number;
  fov: number;
}

export interface Rower3DContextState {
  kind: 'pending' | 'ready' | 'unavailable';
  backend: 'webgpu' | 'webgl' | 'none';
  reason?: string;
}

export interface Rower3DPos {
  x: number;
  y: number;
  z: number;
  progress: number;
}

export interface Rower3DRoute {
  hasCurve: boolean;
  totalDistance: number;
  curveLength: number;
  builds?: number;
}

export interface Rower3DClearance {
  min: number;
  samples: number;
}

/**
 * Compatible shape with today's `publishFoliage` writes in
 * `src/components/rower3d/foliageComponents.tsx` (`trees`, `meshes`, `drawn`).
 */
export interface Rower3DFoliage {
  trees: number;
  meshes: number;
  drawn: number;
}

/**
 * Per-pool scenery entry (#555 FR6). The engine writes
 * `__ROWER3D_SCENERY = { pools, dispatchCount, drawCount }`.
 */
export interface Rower3DSceneryEntry {
  kind: string;
  speciesIndex: number;
  chunkIndex: number;
  instanceCount: number;
  drawn: number;
}

export interface Rower3DScenery {
  pools: Rower3DSceneryEntry[];
  dispatchCount: number;
  drawCount: number;
}

/** Shadow telemetry (#559 FR7). */
export interface Rower3DShadows {
  cascades: number;
  atlasSize: number;
  drawsPerCascade: number;
  lastSplits: number[];
  draws: number;
  triangles: number;
  atlasBytes: number;
}

export interface TelemetryHandles {
  renderStats: Rower3DRenderStats;
  frameStats: Rower3DFrameStats;
  camera: Rower3DCamera;
  contextState: Rower3DContextState;
  pos: Rower3DPos;
  route: Rower3DRoute;
  clearance: Rower3DClearance;
  foliage: Rower3DFoliage;
  scenery: Rower3DScenery;
  shadows: Rower3DShadows;
}

// Keep this a mutable record view of `window`: on `main` these globals carry
// WebGL-flavoured shapes from `src/lib/types/index.ts`; the engine's shapes
// land here as the P1/P2 cutover removes the three scene. Using a record view
// avoids a declaration-merging duel between the two shapes while the React
// scene is still on the branch.
type Win = Record<string, unknown>;

const win = (): Win | undefined => {
  const w = (globalThis as unknown as { window?: Win }).window;
  return w;
};

export const createTelemetry = (forceRender: () => void): TelemetryHandles => {
  const handles: TelemetryHandles = {
    renderStats: {
      draws: 0,
      triangles: 0,
      instances: 0,
      sceneryDispatch: 0,
      sceneryDraws: 0,
      sceneryTriangles: 0,
      shadowDraws: 0,
      shadowTriangles: 0,
      shadowAtlasBytes: 0,
    },
    frameStats: { frame: 0, dtMs: 0, gpuMs: 0 },
    camera: { x: 0, y: 0, z: 0, lookX: 0, lookY: 0, lookZ: 0, fov: 58 },
    contextState: { kind: 'pending', backend: 'none' },
    pos: { x: 0, y: 0, z: 0, progress: 0 },
    route: { hasCurve: false, totalDistance: 0, curveLength: 0 },
    clearance: { min: 0, samples: 0 },
    foliage: { trees: 0, meshes: 0, drawn: 0 },
    scenery: { pools: [], dispatchCount: 0, drawCount: 0 },
    shadows: {
      cascades: 0,
      atlasSize: 0,
      drawsPerCascade: 0,
      lastSplits: [],
      draws: 0,
      triangles: 0,
      atlasBytes: 0,
    },
  };
  const w = win();
  if (w) {
    w['__ROWER3D_RENDER_STATS'] = handles.renderStats;
    w['__ROWER3D_FRAME_STATS'] = handles.frameStats;
    w['__ROWER3D_CAMERA'] = handles.camera;
    w['__ROWER3D_CONTEXT_STATE'] = handles.contextState;
    w['__ROWER3D_POS'] = handles.pos;
    w['__ROWER3D_ROUTE'] = handles.route;
    w['__ROWER3D_CLEARANCE'] = handles.clearance;
    w['__ROWER3D_FORCE_RENDER'] = forceRender;
    w['__ROWER3D_GPU_BACKEND'] = 'webgpu';
    w['__ROWER3D_FOLIAGE'] = handles.foliage;
    w['__ROWER3D_SCENERY'] = handles.scenery;
    w['__ROWER3D_SHADOWS'] = handles.shadows;
  }
  return handles;
};

export const releaseTelemetry = (): void => {
  const w = win();
  if (!w) return;
  for (const key of [
    '__ROWER3D_RENDER_STATS',
    '__ROWER3D_FRAME_STATS',
    '__ROWER3D_CAMERA',
    '__ROWER3D_CONTEXT_STATE',
    '__ROWER3D_POS',
    '__ROWER3D_ROUTE',
    '__ROWER3D_CLEARANCE',
    '__ROWER3D_FORCE_RENDER',
    '__ROWER3D_GPU_BACKEND',
    '__ROWER3D_FOLIAGE',
    '__ROWER3D_SCENERY',
    '__ROWER3D_SHADOWS',
  ]) {
    delete w[key];
  }
};
