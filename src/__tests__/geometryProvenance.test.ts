import { describe, expect, it } from 'vitest';
import type { GeometrySource } from '../types/index';
import {
  externalDistanceNote,
  formatRouteDistanceKm,
  geometryProvenanceBadge,
} from '../utils/geometryProvenance';

const ALL_SOURCES: GeometrySource[] = ['track', 'polygon-path', 'osm-derived', 'gate-chain'];

describe('geometry provenance badge (AC-9)', () => {
  it('shows the right chip for each source, and none for a real track', () => {
    // Snapshotted so a reworded chip is a deliberate change, not a drive-by.
    expect(
      Object.fromEntries(ALL_SOURCES.map((source) => [source, geometryProvenanceBadge(source)?.label ?? null])),
    ).toMatchInlineSnapshot(`
      {
        "gate-chain": "gates only — straight lines",
        "osm-derived": "path from map data",
        "polygon-path": "traced",
        "track": null,
      }
    `);
  });

  it('tells a gates-only course how to be fixed', () => {
    expect(geometryProvenanceBadge('gate-chain')?.title).toContain('Attach a track');
  });

  it('shows nothing for a route with no recorded provenance', () => {
    expect(geometryProvenanceBadge(undefined)).toBeNull();
  });
});

describe('external distance note (AC-10)', () => {
  it('shows rownative’s figure when it disagrees with what we row', () => {
    // Castle to Crane: 21.95 km of river against a 19.6 km straight line.
    expect(externalDistanceNote({ distance: 21.954, externalDistanceMeters: 19599 }))
      .toBe('rownative lists 19.60 km');
  });

  it('stays quiet when the two agree within 15%', () => {
    expect(externalDistanceNote({ distance: 4.84, externalDistanceMeters: 4703 })).toBeNull();
  });

  it('stays quiet when there is no external figure to compare', () => {
    expect(externalDistanceNote({ distance: 5 })).toBeNull();
    expect(externalDistanceNote({ distance: 5, externalDistanceMeters: 0 })).toBeNull();
  });

  it('formats distances to two decimal places', () => {
    expect(formatRouteDistanceKm(21.954)).toBe('21.95 km');
    expect(formatRouteDistanceKm(5)).toBe('5.00 km');
  });
});
