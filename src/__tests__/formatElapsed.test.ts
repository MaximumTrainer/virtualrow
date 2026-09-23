import { describe, it, expect } from 'vitest';
import { formatElapsed } from '../utils/formatElapsed';

describe('formatElapsed', () => {
  it('shows minutes and seconds under an hour', () => {
    expect(formatElapsed(0)).toBe('0:00');
    expect(formatElapsed(252_999)).toBe('4:12');
  });

  it('adds the hour, and pads the minutes, from the first hour', () => {
    expect(formatElapsed(3_600_000)).toBe('1:00:00');
    expect(formatElapsed(3_725_000)).toBe('1:02:05');
  });
});
