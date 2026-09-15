import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { SceneErrorBoundary } from '../components/rower3d/SceneErrorBoundary';

/** Throws on every render, the way a rejected useGLTF suspense resource does. */
const AlwaysThrows: React.FC<{ label: string }> = ({ label }) => {
  throw new Error(`boom: ${label}`);
};

describe('SceneErrorBoundary', () => {
  beforeEach(() => {
    // The boundary warns on every rung it drops; the console noise is expected.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders its children when nothing fails', () => {
    render(
      <SceneErrorBoundary fallback={<p>rich</p>} bare={<p>procedural</p>}>
        <p>physics</p>
      </SceneErrorBoundary>,
    );

    expect(screen.getByText('physics')).toBeTruthy();
  });

  it('shows the rich fallback when only the guarded subtree fails', () => {
    // Physics failing is no reason to lose the GLB boat.
    render(
      <SceneErrorBoundary fallback={<p>rich</p>} bare={<p>procedural</p>}>
        <AlwaysThrows label="physics" />
      </SceneErrorBoundary>,
    );

    expect(screen.getByText('rich')).toBeTruthy();
  });

  it('degrades to the bare fallback when the fallback throws the same error', () => {
    // The real case: the rich fallback renders the same GLB component as the
    // guarded subtree. A rejected crew GLB throws in the subtree, the boundary
    // renders the fallback, and the fallback throws the identical error. With
    // one level of fallback that escapes the boundary and unmounts the scene.
    render(
      <SceneErrorBoundary fallback={<AlwaysThrows label="glb" />} bare={<p>procedural</p>}>
        <AlwaysThrows label="glb" />
      </SceneErrorBoundary>,
    );

    expect(screen.getByText('procedural')).toBeTruthy();
  });

  it('does not rethrow past itself when every level fails', () => {
    // Nothing renders, but the Canvas above stays mounted rather than the whole
    // scene disappearing.
    expect(() =>
      render(
        <SceneErrorBoundary fallback={<AlwaysThrows label="a" />} bare={<AlwaysThrows label="b" />}>
          <AlwaysThrows label="c" />
        </SceneErrorBoundary>,
      ),
    ).not.toThrow();
  });
});
