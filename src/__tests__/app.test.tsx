import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import App, { formatPace } from '../App';

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
