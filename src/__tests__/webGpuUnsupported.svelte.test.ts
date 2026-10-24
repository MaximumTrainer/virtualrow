import { render } from '@testing-library/svelte';
import { describe, it, expect } from 'vitest';

import WebGpuUnsupported from '../lib/ui/WebGpuUnsupported.svelte';

// #542 AC11 (FR11, D11-a/c): "needs WebGPU" screen in the ride only; rest of
// the site stays usable. The React/WebGL legacy app lives at a separate path,
// so from here we only point the viewer away from the ride.
describe('WebGpuUnsupported', () => {
  it('names the WebGPU requirement in the heading', () => {
    const { container } = render(WebGpuUnsupported);
    const heading = container.querySelector('h1,h2');
    expect(heading?.textContent).toMatch(/WebGPU/i);
  });

  it('offers a link back to the routes screen so the rest of the site stays reachable', () => {
    const { container } = render(WebGpuUnsupported);
    const links = Array.from(container.querySelectorAll('a[href]')) as HTMLAnchorElement[];
    const back = links.find((a) => /routes|home|back/i.test(a.textContent ?? ''));
    expect(back).toBeDefined();
    expect(back!.getAttribute('href')).toMatch(/\//);
  });

  it('names at least one supported browser so the viewer knows how to proceed', () => {
    const { container } = render(WebGpuUnsupported);
    expect(container.textContent).toMatch(/Chrome|Chromium|Edge|Safari|Firefox/);
  });
});
