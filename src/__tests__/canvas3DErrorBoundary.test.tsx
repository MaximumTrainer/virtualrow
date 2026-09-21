import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Canvas3DErrorBoundary } from '../components/Canvas3DErrorBoundary';
import { isWebGLAvailable } from '../utils/gpuUtils';

// Mocked at the module, not spied on the namespace: the component binds the
// import at load, so a namespace spy never reaches it - and the "no context"
// case would then pass on jsdom having no WebGL rather than on the code.
vi.mock('../utils/gpuUtils', () => ({ isWebGLAvailable: vi.fn(() => true) }));
const webglAvailable = vi.mocked(isWebGLAvailable);

/**
 * Issue #345 — retrying checks the renderer the scene will actually use.
 *
 * `handleRetry` used to await a WebGPU probe and, when it resolved true, clear
 * the error and declare the GPU available *without looking for a WebGL
 * context* — on a canvas R3F was always going to build in WebGL. A rower on a
 * machine with a WebGPU adapter and no usable WebGL context could press Retry
 * and be handed the same blank box, reported as working.
 *
 * The probe is gone, and with it the asynchrony: there is one question to ask
 * and it is answered synchronously.
 *
 * The TDD guard asked for this file the moment the component was touched —
 * nothing named it before, which is how the retry path came to behave that way
 * unobserved.
 */

const Boom: React.FC = () => {
  throw new Error('the canvas fell over');
};

describe('Canvas3DErrorBoundary', () => {
  let consoleError: { mockRestore: () => void };

  beforeEach(() => {
    // React logs the caught error; the test is about the boundary, not the noise.
    consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    webglAvailable.mockReturnValue(true);
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it('shows the scene while nothing has gone wrong', () => {
    render(
      <Canvas3DErrorBoundary>
        <p>the river</p>
      </Canvas3DErrorBoundary>,
    );

    expect(screen.getByText('the river')).toBeInTheDocument();
  });

  it('explains itself when the canvas throws', () => {
    render(
      <Canvas3DErrorBoundary>
        <Boom />
      </Canvas3DErrorBoundary>,
    );

    expect(screen.getByRole('heading', { name: '3D View Unavailable' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry 3D View' })).toBeInTheDocument();
  });

  it('brings the scene back when there is a context to draw into', async () => {
    const { rerender } = render(
      <Canvas3DErrorBoundary>
        <Boom />
      </Canvas3DErrorBoundary>,
    );

    // The children are swapped before the retry, not after: retrying re-renders
    // whatever is there, and a child that still throws simply throws again.
    rerender(
      <Canvas3DErrorBoundary>
        <p>the river</p>
      </Canvas3DErrorBoundary>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Retry 3D View' }));

    expect(screen.getByText('the river')).toBeInTheDocument();
  });

  // The regression the WebGPU probe allowed: retry reported success on a
  // machine that had nothing to draw with, and handed back the same blank box.
  it('keeps saying so when there is still no context', async () => {
    webglAvailable.mockReturnValue(false);
    render(
      <Canvas3DErrorBoundary>
        <Boom />
      </Canvas3DErrorBoundary>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Retry 3D View' }));

    expect(screen.getByText(/WebGL is not available/)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Retry 3D View' }),
      'still offering a retry that cannot succeed',
    ).not.toBeInTheDocument();
  });
});
