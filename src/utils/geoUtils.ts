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
  const dLat = (lat2 - lat1) * DEG_TO_RAD;
  const dLng = (lng2 - lng1) * DEG_TO_RAD;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * DEG_TO_RAD) * Math.cos(lat2 * DEG_TO_RAD) * Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return EARTH_RADIUS_M * c;
}

/**
 * Calculates the bearing (direction) from one coordinate to another.
 * Returns the bearing in degrees (0-360), where 0° is North, 90° is East, etc.
 *
 * @param lat1 - Starting latitude
 * @param lng1 - Starting longitude
 * @param lat2 - Ending latitude
 * @param lng2 - Ending longitude
 * @returns Bearing in degrees (0-360)
 */
export function bearingBetweenLatLng(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const lat1Rad = lat1 * DEG_TO_RAD;
  const lat2Rad = lat2 * DEG_TO_RAD;
  const dLng = (lng2 - lng1) * DEG_TO_RAD;

  const y = Math.sin(dLng) * Math.cos(lat2Rad);
  const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLng);
  const bearing = Math.atan2(y, x) * RAD_TO_DEG;

  // Normalize to 0-360
  return (bearing + 360) % 360;
}

/**
 * Calculates the bearing difference (delta) between two bearings.
 * Returns the smallest angle between the bearings (-180 to +180 degrees).
 * Positive values indicate a right turn, negative values a left turn.
 *
 * @param bearing1 - First bearing in degrees (0-360)
 * @param bearing2 - Second bearing in degrees (0-360)
 * @returns Bearing delta in degrees (-180 to +180)
 */
export function bearingDelta(bearing1: number, bearing2: number): number {
  let delta = bearing2 - bearing1;

  // Normalize to -180 to +180
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;

  return delta;
}

/**
 * Upsamples a route's coordinates to achieve a minimum resolution.
 * Inserts interpolated points between existing coordinates if they are
 * spaced further apart than the target resolution.
 *
 * @param coords - Original route coordinates
 * @param minResolutionMeters - Target resolution in meters (default: 10m)
 * @returns Upsampled coordinates array
 */
export function upsampleCoordinates(
  coords: Array<{ lat: number; lng: number }>,
  minResolutionMeters = 10
): Array<{ lat: number; lng: number }> {
  if (coords.length < 2) return [...coords];

  const upsampled: Array<{ lat: number; lng: number }> = [coords[0]];

  for (let i = 1; i < coords.length; i++) {
    const prev = coords[i - 1];
    const curr = coords[i];
    const distance = distanceBetweenLatLng(prev.lat, prev.lng, curr.lat, curr.lng);

    // If distance is greater than min resolution, insert interpolated points
    if (distance > minResolutionMeters) {
      const numSegments = Math.ceil(distance / minResolutionMeters);
      // Endpoints fall back to clamped tangents, which intentionally trends toward linear interpolation.
      const prevPrev = i > 1 ? coords[i - 2] : prev;
      const nextNext = i < coords.length - 1 ? coords[i + 1] : curr;
      const m1Lat = (curr.lat - prevPrev.lat) * 0.5;
      const m1Lng = (curr.lng - prevPrev.lng) * 0.5;
      const m2Lat = (nextNext.lat - prev.lat) * 0.5;
      const m2Lng = (nextNext.lng - prev.lng) * 0.5;

      for (let j = 1; j <= numSegments; j++) {
        const t = j / numSegments;
        const t2 = t * t;
        const t3 = t2 * t;
        const h00 = 2 * t3 - 3 * t2 + 1;
        const h10 = t3 - 2 * t2 + t;
        const h01 = -2 * t3 + 3 * t2;
        const h11 = t3 - t2;
        const lat = h00 * prev.lat + h10 * m1Lat + h01 * curr.lat + h11 * m2Lat;
        const lng = h00 * prev.lng + h10 * m1Lng + h01 * curr.lng + h11 * m2Lng;
        upsampled.push({ lat, lng });
      }
    } else {
      upsampled.push(curr);
    }
  }

  return upsampled;
}

/**
 * Segments a route into chunks based on distance.
 * Each segment will be approximately segmentLengthMeters long.
 *
 * @param coords - Route coordinates
 * @param segmentLengthMeters - Target segment length in meters (default: 50m)
 * @returns Array of segment indices and distances
 */
export function segmentRoute(
  coords: Array<{ lat: number; lng: number }>,
  segmentLengthMeters = 50
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

    // If we've accumulated enough distance, create a segment
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

  // Add final segment if there's any remaining distance
  if (currentSegmentStart < coords.length - 1) {
    segments.push({
      startIndex: currentSegmentStart,
      endIndex: coords.length - 1,
      distance: currentSegmentDistance,
    });
  }

  return segments;
}
