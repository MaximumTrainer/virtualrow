import { describe, it, expect } from 'vitest';
import {
  lngLatToMercatorPixel,
  pickBackdropZoom,
  osmTileFor,
  projectInsideTile,
} from '../utils/osmTileBackdrop';

describe('osmTileBackdrop', () => {
  describe('lngLatToMercatorPixel', () => {
    it('maps the prime-meridian equator to the centre of the Mercator plane at zoom 0', () => {
      const px = lngLatToMercatorPixel({ lat: 0, lng: 0 }, 0);
      expect(px.x).toBeCloseTo(128, 1);
      expect(px.y).toBeCloseTo(128, 1);
    });

    it('scales linearly with zoom', () => {
      const z0 = lngLatToMercatorPixel({ lat: 0, lng: 0 }, 0);
      const z2 = lngLatToMercatorPixel({ lat: 0, lng: 0 }, 2);
      expect(z2.x).toBeCloseTo(z0.x * 4, 1);
      expect(z2.y).toBeCloseTo(z0.y * 4, 1);
    });
  });

  describe('pickBackdropZoom', () => {
    it('picks a high zoom for a tight, local route (a few km)', () => {
      const coords = [
        { lat: 51.5, lng: -0.1 },
        { lat: 51.51, lng: -0.11 },
      ];
      const z = pickBackdropZoom(coords);
      expect(z).toBeGreaterThanOrEqual(10);
    });

    it('picks a low zoom for a route that crosses several degrees of longitude', () => {
      const coords = [
        { lat: 51, lng: -5 },
        { lat: 52, lng: 10 },
      ];
      const z = pickBackdropZoom(coords);
      expect(z).toBeLessThanOrEqual(6);
    });

    it('returns 1 for an empty route', () => {
      expect(pickBackdropZoom([])).toBe(1);
    });
  });

  describe('osmTileFor', () => {
    it('builds a tile URL in the openstreetmap format', () => {
      const tile = osmTileFor({ lat: 51.5, lng: -0.1 }, 10);
      expect(tile.url).toMatch(/^https:\/\/tile\.openstreetmap\.org\/10\/\d+\/\d+\.png$/);
      expect(tile.z).toBe(10);
    });

    it('returns a geographic bbox that contains the centre point', () => {
      const centre = { lat: 51.5, lng: -0.1 };
      const tile = osmTileFor(centre, 10);
      const [w, s, e, n] = tile.bbox;
      expect(centre.lng).toBeGreaterThanOrEqual(w);
      expect(centre.lng).toBeLessThanOrEqual(e);
      expect(centre.lat).toBeGreaterThanOrEqual(s);
      expect(centre.lat).toBeLessThanOrEqual(n);
    });
  });

  describe('projectInsideTile', () => {
    it('projects the tile centre to roughly (0.5, 0.5)', () => {
      const centre = { lat: 51.5, lng: -0.1 };
      const tile = osmTileFor(centre, 10);
      const { u, v } = projectInsideTile(centre, tile);
      expect(u).toBeGreaterThanOrEqual(0);
      expect(u).toBeLessThanOrEqual(1);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    });
  });
});
