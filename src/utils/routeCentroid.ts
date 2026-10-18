import type { Coordinate } from '../types/index';

/**
 * Great-circle-aware centroid of a route's coordinates. Averages points on the
 * unit sphere and projects back to lat/lng, so a route near the antimeridian
 * doesn't centre on 0° longitude the way a naive arithmetic mean would.
 *
 * Issue #505 D2(b): the pin on the Routes overview map sits at the centroid
 * of the route's coordinates, computed once per route.
 */
export function routeCentroid(coordinates: readonly Coordinate[]): Coordinate | null {
  if (coordinates.length === 0) return null;
  if (coordinates.length === 1) return { ...coordinates[0] };

  const toRad = Math.PI / 180;
  const toDeg = 180 / Math.PI;

  let x = 0;
  let y = 0;
  let z = 0;
  for (const { lat, lng } of coordinates) {
    const latR = lat * toRad;
    const lngR = lng * toRad;
    const cosLat = Math.cos(latR);
    x += cosLat * Math.cos(lngR);
    y += cosLat * Math.sin(lngR);
    z += Math.sin(latR);
  }

  const n = coordinates.length;
  x /= n;
  y /= n;
  z /= n;

  const hyp = Math.sqrt(x * x + y * y);
  const latR = Math.atan2(z, hyp);
  const lngR = Math.atan2(y, x);

  return { lat: latR * toDeg, lng: lngR * toDeg };
}
