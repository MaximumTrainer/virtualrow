import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StartCallout, FinishBanner } from '../components/RaceCallouts';
import { formatCourseMetres } from '../utils/formatters';

/**
 * Issue #336 — what the rower is told at each end of the course.
 */

describe('StartCallout', () => {
  it('asks for the first stroke while armed', () => {
    render(<StartCallout phase="armed" countdown={null} />);
    expect(screen.getByRole('status')).toHaveTextContent('Ready — take your first stroke');
  });

  it('shows the count', () => {
    render(<StartCallout phase="counting" countdown={2} />);
    expect(screen.getByRole('status')).toHaveTextContent('2');
  });

  it('says row when the boat is let go', () => {
    render(<StartCallout phase="go" countdown={null} />);
    expect(screen.getByRole('status')).toHaveTextContent('Row!');
  });

  it.each(['idle', 'rowing'] as const)('says nothing when %s', (phase) => {
    const { container } = render(<StartCallout phase={phase} countdown={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('FinishBanner', () => {
  it('says how far and how long', () => {
    render(<FinishBanner distanceMeters={1999.6} elapsedMs={492_400} />);
    expect(screen.getByRole('status')).toHaveTextContent('Finished — 2 000 m in 8:12');
  });
});

describe('formatCourseMetres', () => {
  it('groups thousands the way a course is written', () => {
    expect(formatCourseMetres(500)).toBe('500');
    expect(formatCourseMetres(2000)).toBe('2 000');
    expect(formatCourseMetres(21097.5)).toBe('21 098');
  });
});
