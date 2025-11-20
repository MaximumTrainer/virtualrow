import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from '../App';

describe('App component', () => {
  it('renders title, routes list, and heart rate panel', () => {
    render(<App />);
    expect(screen.getByRole('heading', { name: /VirtualRow/i })).toBeInTheDocument();
    // Check Venice Grand Canal route appears (allow multiple matches)
    const matches = screen.getAllByText(/Venice Grand Canal/i);
    expect(matches.length).toBeGreaterThan(0);
    // Import panel elements
    expect(screen.getByText(/Import Route/i)).toBeInTheDocument();
    // Heart Rate panel title
    expect(screen.getByText(/Heart Rate/i)).toBeInTheDocument();
  });
});
