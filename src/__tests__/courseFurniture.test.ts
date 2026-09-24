import { describe, it, expect } from 'vitest';
import { courseFurniture, MAX_DISTANCE_POSTS } from '../components/rower3d/courseFurniture';

/**
 * Issue #336 — a course you can see: buoys across the start, a finish tower
 * and a buoy line at the finish, and a post every 500 m.
 */

const posts = (routeMeters: number) =>
  courseFurniture(routeMeters).filter((f) => f.id === 'a07-distance-marker-post');

describe('courseFurniture', () => {
  it('gives a 2 000 m course four posts, at every 500 m', () => {
    expect(posts(2000).map((p) => p.progress)).toEqual([0.25, 0.5, 0.75, 1]);
  });

  it('puts the finish tower on the line', () => {
    const towers = courseFurniture(2000).filter((f) => f.id === 'a06-finish-tower');
    expect(towers).toEqual([{ id: 'a06-finish-tower', progress: 1, side: 'right', kind: 'furniture' }]);
  });

  it('lays a buoy either side of the lane at the start and at the finish', () => {
    const buoys = courseFurniture(2000).filter((f) => f.id === 'a01-buoy-lane-sphere');
    expect(buoys.map((b) => [b.progress, b.side])).toEqual([
      [0, 'left'],
      [0, 'right'],
      [1, 'left'],
      [1, 'right'],
    ]);
    // In the water, not on the bank the posts stand on.
    expect(buoys.every((b) => b.kind === 'buoy')).toBe(true);
  });

  it('stands the posts on the bank', () => {
    expect(posts(2000).every((p) => p.kind === 'furniture' && p.side === 'left')).toBe(true);
  });

  it('gives a course shorter than 500 m no posts', () => {
    expect(posts(400)).toEqual([]);
  });

  it('spaces the posts out on a long course rather than planting hundreds', () => {
    // A marathon is 84 posts at 500 m, every one a GLB clone on the GPU.
    const marathon = posts(42_195);
    expect(marathon.length).toBeLessThanOrEqual(MAX_DISTANCE_POSTS);
    // Still at whole multiples of 500 m, so a post means what it says.
    const metres = marathon.map((p) => Math.round(p.progress * 42_195));
    expect(metres.every((m) => m % 500 === 0)).toBe(true);
    expect(metres[0]).toBe(1500);
  });

  it('places nothing on a course with no length', () => {
    expect(courseFurniture(0)).toEqual([]);
    expect(courseFurniture(Number.NaN)).toEqual([]);
  });
});
