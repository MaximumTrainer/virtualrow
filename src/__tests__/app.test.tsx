import { afterAll, beforeAll, describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from '../App';
import { formatPace } from '../utils/formatters';

const originalGetContext = HTMLCanvasElement.prototype.getContext;

beforeAll(() => {
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
  // RouteMap uses a broad Canvas2D API surface; unknown members become no-op spies
  // so jsdom can render App without requiring a full canvas implementation.
  const context = new Proxy(baseContext as Record<string, unknown>, {
    get(target, prop) {
      if (!(prop in target)) target[prop as string] = vi.fn();
      return target[prop as string];
    },
  });
  HTMLCanvasElement.prototype.getContext = vi.fn(
    ((contextType: string) => {
      if (contextType === '2d') {
        return context as unknown as CanvasRenderingContext2D;
      }
      return null;
    }) as typeof HTMLCanvasElement.prototype.getContext,
  ) as unknown as typeof HTMLCanvasElement.prototype.getContext;
});

afterAll(() => {
  HTMLCanvasElement.prototype.getContext = originalGetContext;
});

describe('App component', () => {
  it('renders title, routes list, and heart rate panel', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: /VirtualRow/i })).toBeInTheDocument();
    // Check Willowbrook River route appears (the only route now)
    const matches = screen.getAllByText(/Willowbrook River/i);
    expect(matches.length).toBeGreaterThan(0);
    // Heart Rate panel title
    expect(screen.getByText(/Heart Rate/i)).toBeInTheDocument();
  });

  it('formats pace values for the activity screen', () => {
    expect(formatPace(null)).toBe('--:--');
    expect(formatPace(0)).toBe('--:--');
    expect(formatPace(125)).toBe('2:05/500m');
    expect(formatPace(359)).toBe('5:59/500m');
  });

  it('shows Quick Start button in normal mode', () => {
    render(<App />);
    expect(screen.getByRole('button', { name: /Quick Start/i })).toBeInTheDocument();
  });

  it('shows route-only navigation in guest mode (?guest=true)', () => {
    // Simulate URL param
    const url = new URL(window.location.href);
    url.searchParams.set('guest', 'true');
    window.history.replaceState({}, '', url.toString());

    render(<App />);

    expect(screen.getByRole('button', { name: /Routes/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /History/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Workouts/i })).not.toBeInTheDocument();
    expect(screen.getAllByText(/Guest Mode/i).length).toBeGreaterThan(0);

    // Clean up URL
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete('guest');
    window.history.replaceState({}, '', cleanUrl.toString());
  });
});
