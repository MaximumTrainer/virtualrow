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

export interface TelemetryHandles {
  renderStats: Rower3DRenderStats;
  frameStats: Rower3DFrameStats;
  camera: Rower3DCamera;
  contextState: Rower3DContextState;
  pos: Rower3DPos;
  route: Rower3DRoute;
  clearance: Rower3DClearance;
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
    renderStats: { draws: 0, triangles: 0, instances: 0 },
    frameStats: { frame: 0, dtMs: 0, gpuMs: 0 },
    camera: { x: 0, y: 0, z: 0, lookX: 0, lookY: 0, lookZ: 0, fov: 58 },
    contextState: { kind: 'pending', backend: 'none' },
    pos: { x: 0, y: 0, z: 0, progress: 0 },
    route: { hasCurve: false, totalDistance: 0, curveLength: 0 },
    clearance: { min: 0, samples: 0 },
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
  ]) {
    delete w[key];
  }
};
