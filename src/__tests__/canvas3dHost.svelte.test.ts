import { render } from '@testing-library/svelte';
import { describe, it, expect, vi } from 'vitest';

import Canvas3DHost from '../lib/ui/Canvas3DHost.svelte';
import type { RideAttach } from '../lib/ui/rideCanvas';

// #542 P1 (F5): the ride-canvas seam host. P1 ships a bare canvas; the engine
// track attaches via the `attach` prop.
describe('Canvas3DHost', () => {
  it('renders the canvas container and markers with no engine attached', () => {
    const { container } = render(Canvas3DHost);

    const host = container.querySelector('.rower3d-canvas-container');
    expect(host).not.toBeNull();
    // The seam DOM the non-3D specs assert around.
    expect(host!.querySelector('canvas.rower3d-canvas')).not.toBeNull();
    expect(host!.querySelector('.rower3d-fallback-marker')).not.toBeNull();
    // No engine → the backend marker reads 'stub'.
    expect(
      host!.querySelector('.rower3d-gpu-backend')?.getAttribute('data-backend'),
    ).toBe('stub');
  });

  it('hands the engine the canvas and the passed-through options', async () => {
    const dispose = vi.fn();
    const attach = vi.fn<RideAttach>(() => ({ dispose }));

    const { container } = render(Canvas3DHost, {
      attach,
      tier: 'high',
      route: { id: 'r1' },
      testMode: true,
    });
    await Promise.resolve();

    expect(attach).toHaveBeenCalledTimes(1);
    const [canvasArg, optsArg] = attach.mock.calls[0];
    expect(canvasArg).toBe(container.querySelector('canvas.rower3d-canvas'));
    expect(optsArg).toEqual({ tier: 'high', route: { id: 'r1' }, testMode: true });
  });

  it('disposes the engine handle when the host unmounts', async () => {
    const dispose = vi.fn();
    const attach = vi.fn<RideAttach>(() => ({ dispose }));

    const { unmount } = render(Canvas3DHost, { attach });
    await Promise.resolve();
    unmount();

    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it('shows the unavailable placeholder when the engine declines', async () => {
    const attach = vi.fn<RideAttach>(() => null);

    const { container } = render(Canvas3DHost, { attach });
    await Promise.resolve();
    await Promise.resolve();

    expect(
      container.querySelector('.rower3d-gpu-backend')?.getAttribute('data-backend'),
    ).toBe('unavailable');
  });
});
