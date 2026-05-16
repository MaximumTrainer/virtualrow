import { beforeAll, describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import App, { formatPace } from '../App';

beforeAll(() => {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
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
  })) as any;
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
});
