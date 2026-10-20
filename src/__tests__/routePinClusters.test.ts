import { describe, it, expect } from 'vitest';
import { clusterRoutePins } from '../lib/utils/routePinClusters';
import type { WaterRoute } from '../lib/types/index';

const route = (id: string, lat: number, lng: number): WaterRoute => ({
  id,
  name: id,
  description: '',
  distance: 1,
  difficulty: 'easy',
  location: '',
  coordinates: [{ lat, lng }],
  elevationGain: 0,
  estimatedTime: 1,
  tags: [],
  createdAt: new Date(0),
});

describe('clusterRoutePins', () => {
  it('returns one single-pin entry per route at a zoom tight enough to separate them', () => {
    const result = clusterRoutePins([route('a', 51, -1), route('b', 48, 2)], 10);
    expect(result).toHaveLength(2);
    expect(result.every((e) => e.kind === 'pin')).toBe(true);
  });

  it('merges co-located routes into one cluster at a wide zoom', () => {
    const result = clusterRoutePins(
      [route('a', 51.5, -0.1), route('b', 51.5001, -0.1001), route('c', 51.5, -0.0999)],
      2,
    );
    const clusters = result.filter((e) => e.kind === 'cluster');
    expect(clusters).toHaveLength(1);
    expect(clusters[0].routeIds.sort()).toEqual(['a', 'b', 'c']);
  });

  it('separates clusters that sit far apart even at a wide zoom', () => {
    const result = clusterRoutePins(
      [
        route('a', 51.5, -0.1),
        route('b', 51.5001, -0.1001),
        route('c', 40.7, -74.0),
        route('d', 40.7001, -74.0001),
      ],
      2,
    );
    const clusters = result.filter((e) => e.kind === 'cluster');
    expect(clusters.length).toBe(2);
  });

  it('ignores routes with no coordinates (no pin to cluster)', () => {
    const empty: WaterRoute = { ...route('x', 0, 0), coordinates: [] };
    const result = clusterRoutePins([empty, route('a', 51, -1)], 10);
    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('pin');
  });
});
