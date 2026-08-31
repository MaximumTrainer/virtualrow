import { vi } from 'vitest';

/**
 * Install a permissive Canvas2D stub for tests that render `App`.
 *
 * RouteMap draws on a 2D context and touches a broad slice of the API, more of
 * it than jsdom implements. Unknown members become no-op spies so the component
 * renders instead of throwing, while `getContext('webgl')` still returns null —
 * Rower3D is lazy-loaded and never mounts in jsdom.
 *
 * Returns the teardown to call from `afterAll`.
 */
export function installCanvasMock(): () => void {
  const original = HTMLCanvasElement.prototype.getContext;
  const gradient = { addColorStop: vi.fn() };
  const baseContext = {
    canvas: document.createElement('canvas'),
    getExtension: vi.fn(),
    createShader: vi.fn(),
    createProgram: vi.fn(),
    shaderSource: vi.fn(),
    compileShader: vi.fn(),
    attachShader: vi.fn(),
    linkProgram: vi.fn(),
    useProgram: vi.fn(),
    getShaderParameter: vi.fn(() => true),
    getProgramParameter: vi.fn(() => true),
    getShaderInfoLog: vi.fn(() => ''),
    getProgramInfoLog: vi.fn(() => ''),
    viewport: vi.fn(),
    clearColor: vi.fn(),
    clear: vi.fn(),
    createLinearGradient: vi.fn(() => gradient),
    createRadialGradient: vi.fn(() => gradient),
  };
  const context = new Proxy(baseContext as Record<string, unknown>, {
    get(target, prop) {
      if (!(prop in target)) target[prop as string] = vi.fn();
      return target[prop as string];
    },
  });

  HTMLCanvasElement.prototype.getContext = vi.fn(
    ((contextType: string) =>
      contextType === '2d' ? (context as unknown as CanvasRenderingContext2D) : null) as
      typeof HTMLCanvasElement.prototype.getContext,
  ) as unknown as typeof HTMLCanvasElement.prototype.getContext;

  return () => {
    HTMLCanvasElement.prototype.getContext = original;
  };
}
