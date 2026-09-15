// ============================================================================
// SCENE ERROR BOUNDARY — keeps one failure inside the Canvas from taking the
// whole scene with it.
//
// This was PhysicsErrorBoundary, named for the Rapier WASM failure it was built
// for, but a boundary catches everything its subtree throws. The guarded
// subtree loads the crew GLB, and so did its fallback: a rejected GLB threw in
// the subtree, the boundary rendered the fallback, the fallback threw the same
// error, and that second throw escaped past the boundary and unmounted the
// scene — the opposite of degrading gracefully (review of #232).
//
// So there are two rungs, as two nested boundaries. Nesting rather than a
// counter is deliberate: each boundary handles exactly one failure in
// getDerivedStateFromError, which is the path React is built around. The rich
// rung keeps the GLB boat, because physics failing is no reason to lose it.
// The bare rung is procedural and loads nothing, so it cannot fail this way.
// ============================================================================

import React from 'react';

interface OneLevelProps {
  children: React.ReactNode;
  fallback: React.ReactNode;
  /** Named in the warning, so the console says which rung gave way. */
  rung: string;
}

class OneLevelBoundary extends React.Component<OneLevelProps, { hasError: boolean }> {
  constructor(props: OneLevelProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.warn(`SceneErrorBoundary: ${this.props.rung} failed, degrading`, error, info);
  }

  render() {
    return this.state.hasError ? this.props.fallback : this.props.children;
  }
}

export interface SceneErrorBoundaryProps {
  children: React.ReactNode;
  /** Shown when the guarded subtree fails. May still load assets. */
  fallback: React.ReactNode;
  /** Shown when the fallback fails too. Must not load anything. */
  bare: React.ReactNode;
}

export const SceneErrorBoundary: React.FC<SceneErrorBoundaryProps> = ({
  children,
  fallback,
  bare,
}) => (
  <OneLevelBoundary
    rung="scene content"
    fallback={
      <OneLevelBoundary
        rung="rich fallback"
        // Last rung renders nothing rather than rethrowing: if even the
        // procedural boat fails, the rower loses the boat, not the scene.
        fallback={<OneLevelBoundary rung="bare fallback" fallback={null}>{bare}</OneLevelBoundary>}
      >
        {fallback}
      </OneLevelBoundary>
    }
  >
    {children}
  </OneLevelBoundary>
);
