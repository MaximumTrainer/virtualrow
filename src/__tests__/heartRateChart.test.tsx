import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// Mock react-chartjs-2 Line component to avoid relying on Canvas in tests
vi.mock('react-chartjs-2', () => ({
  Line: (_props: unknown) => <div data-testid="chart">Chart</div>
}));

import HeartRateChart from '../components/HeartRateChart';

const sampleData = [
  { bpm: 80, timestamp: new Date() },
  { bpm: 90, timestamp: new Date() },
  { bpm: 100, timestamp: new Date() },
];

describe('HeartRateChart', () => {
  it('renders chart placeholder and matches snapshot', () => {
    const { container } = render(<HeartRateChart samples={sampleData} />);
    const chart = screen.getByTestId('chart');
    expect(chart).toBeInTheDocument();
    expect(container.firstChild).toMatchSnapshot();
  });
});
