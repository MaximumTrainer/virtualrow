import type { Coordinate } from '../types/index';

/**
 * #505 Phase 2d (D3-b): per-card OSM tile backdrop math.
 *
 * Spherical Mercator projection + tile math, enough for a card thumbnail to
 * draw the route's SVG polyline on top of an OSM raster tile at the right
 * geographic place.
 */

const TILE_SIZE = 256;
const MIN_ZOOM = 1;
const MAX_ZOOM = 16;

export interface TileSpec {
  /** Tile coord. */
  z: number;
  x: number;
  y: number;
  /** Full OSM tile URL. */
  url: string;
  /** Geographic bbox (west, south, east, north) of this tile, in degrees. */
  bbox: [number, number, number, number];
}

export interface ProjectedBox {
  /** Pixel-space origin (top-left) of the chosen tile within the Mercator plane at `z`. */
  originX: number;
  originY: number;
  /** The chosen tile. */
  tile: TileSpec;
}

/**
 * Project a lat/lng to Web Mercator pixel coordinates at a given zoom.
 */
export function lngLatToMercatorPixel(c: Coordinate, zoom: number): { x: number; y: number } {
  const scale = TILE_SIZE * Math.pow(2, zoom);
  const x = ((c.lng + 180) / 360) * scale;
  const latRad = (c.lat * Math.PI) / 180;
  const y =
    (0.5 - Math.log((1 + Math.sin(latRad)) / (1 - Math.sin(latRad))) / (4 * Math.PI)) * scale;
  return { x, y };
}

/**
 * Pick the highest zoom level at which the bbox around a route centroid still
 * fits comfortably inside a single 256-pixel tile.
 */
export function pickBackdropZoom(
  coords: readonly Coordinate[],
  tilePx = TILE_SIZE,
): number {
  if (coords.length === 0) return MIN_ZOOM;
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  for (const c of coords) {
    if (c.lng < minLng) minLng = c.lng;
    if (c.lng > maxLng) maxLng = c.lng;
    if (c.lat < minLat) minLat = c.lat;
    if (c.lat > maxLat) maxLat = c.lat;
  }
  if (!Number.isFinite(minLng)) return MIN_ZOOM;
  // Pad the bbox by 15% on each side so the route doesn't sit flush against
  // the tile edge.
  const padLng = Math.max(0.0005, (maxLng - minLng) * 0.15);
  const padLat = Math.max(0.0005, (maxLat - minLat) * 0.15);
  minLng -= padLng;
  maxLng += padLng;
  minLat -= padLat;
  maxLat += padLat;

  for (let z = MAX_ZOOM; z >= MIN_ZOOM; z -= 1) {
    const sw = lngLatToMercatorPixel({ lat: minLat, lng: minLng }, z);
    const ne = lngLatToMercatorPixel({ lat: maxLat, lng: maxLng }, z);
    const w = Math.abs(ne.x - sw.x);
    const h = Math.abs(ne.y - sw.y);
    if (w <= tilePx && h <= tilePx) return z;
  }
  return MIN_ZOOM;
}

/**
 * The OSM tile covering `center` at `zoom`, with its canonical URL and the
 * geographic bbox the tile covers.
 */
export function osmTileFor(center: Coordinate, zoom: number): TileSpec {
  const n = Math.pow(2, zoom);
  const x = Math.floor(((center.lng + 180) / 360) * n);
  const latRad = (center.lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n);
  const clampedX = ((x % n) + n) % n;
  const clampedY = Math.max(0, Math.min(n - 1, y));
  const url = `https://tile.openstreetmap.org/${zoom}/${clampedX}/${clampedY}.png`;
  const west = (clampedX / n) * 360 - 180;
  const east = ((clampedX + 1) / n) * 360 - 180;
  const northLat =
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * clampedY) / n))) * 180) / Math.PI;
  const southLat =
    (Math.atan(Math.sinh(Math.PI * (1 - (2 * (clampedY + 1)) / n))) * 180) / Math.PI;
  return { z: zoom, x: clampedX, y: clampedY, url, bbox: [west, southLat, east, northLat] };
}

/**
 * Project a coordinate into a 0..1 (x, y) space inside the given tile.
 * Points outside the tile land outside that range.
 */
export function projectInsideTile(
  c: Coordinate,
  tile: TileSpec,
): { u: number; v: number } {
  const px = lngLatToMercatorPixel(c, tile.z);
  const originX = tile.x * TILE_SIZE;
  const originY = tile.y * TILE_SIZE;
  return {
    u: (px.x - originX) / TILE_SIZE,
    v: (px.y - originY) / TILE_SIZE,
  };
}
