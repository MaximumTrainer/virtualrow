import { bearingRadians, distanceBetweenMeters } from './coordinateUtils';

/**
 * WGS-84 equatorial radius, used only by the scene projection below.
 *
 * Distances go through `distanceBetweenMeters` instead — see issue #194 R-9:
 * two radii meant an imported route's reported length and the length the
 * engine rowed disagreed by ~0.1 %, which is 23 m on a 21 km course.
 */
const EARTH_RADIUS_M = 6378137;
const DEG_TO_RAD = Math.PI / 180;
const RAD_TO_DEG = 180 / Math.PI;

export function latLngToMeters(lat: number, lng: number, originLat: number, originLng: number) {
  // Approximation using equirectangular projection around origin
  const dLat = (lat - originLat) * DEG_TO_RAD;
  const dLng = (lng - originLng) * DEG_TO_RAD;
  const x = dLng * EARTH_RADIUS_M * Math.cos(originLat * DEG_TO_RAD);
  const y = dLat * EARTH_RADIUS_M;
  return { x, y };
}

export function routeTotalDistanceMeters(coords: Array<{lat:number, lng:number}>) {
  if (coords.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    const a = coords[i-1];
    const b = coords[i];
    total += distanceBetweenLatLng(a.lat, a.lng, b.lat, b.lng);
  }
  return total;
}

export function distanceBetweenLatLng(lat1:number, lng1:number, lat2:number, lng2:number) {
  return distanceBetweenMeters({ lat: lat1, lng: lng1 }, { lat: lat2, lng: lng2 });
}

export function calculateBearing(lat1: number, lng1: number, lat2: number, lng2: number) {
  const radians = bearingRadians({ lat: lat1, lng: lng1 }, { lat: lat2, lng: lng2 });
  return (radians * RAD_TO_DEG + 360) % 360;
}

export function bearingBetweenLatLng(lat1: number, lng1: number, lat2: number, lng2: number) {
  return calculateBearing(lat1, lng1, lat2, lng2);
}

export function bearingDelta(bearing1: number, bearing2: number) {
  const delta = ((bearing2 - bearing1 + 540) % 360) - 180;
  return delta === -180 ? 180 : delta;
}

export function normalizeBearingDelta(fromBearing: number, toBearing: number) {
  return Math.abs(bearingDelta(fromBearing, toBearing));
}

export function segmentRoute(
  coords: Array<{ lat: number; lng: number }>,
  segmentLengthMeters = 50,
): Array<{ startIndex: number; endIndex: number; distance: number }> {
  if (coords.length < 2) return [];

  const segments: Array<{ startIndex: number; endIndex: number; distance: number }> = [];
  let currentSegmentStart = 0;
  let currentSegmentDistance = 0;

  for (let i = 1; i < coords.length; i++) {
    const prev = coords[i - 1];
    const curr = coords[i];
    const segmentDist = distanceBetweenLatLng(prev.lat, prev.lng, curr.lat, curr.lng);
    currentSegmentDistance += segmentDist;

    if (currentSegmentDistance >= segmentLengthMeters) {
      segments.push({
        startIndex: currentSegmentStart,
        endIndex: i,
        distance: currentSegmentDistance,
      });
      currentSegmentStart = i;
      currentSegmentDistance = 0;
    }
  }

  if (currentSegmentStart < coords.length - 1) {
    segments.push({
      startIndex: currentSegmentStart,
      endIndex: coords.length - 1,
      distance: currentSegmentDistance,
    });
  }

  return segments;
}
