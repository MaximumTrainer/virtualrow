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

export function calculateBearing(lat1: number, lng1: number, lat2: number, lng2: number) {
  const phi1 = lat1 * DEG_TO_RAD;
  const phi2 = lat2 * DEG_TO_RAD;
  const deltaLambda = (lng2 - lng1) * DEG_TO_RAD;

  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);

  return (Math.atan2(y, x) * RAD_TO_DEG + 360) % 360;
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

export function upsampleCoordinates(
  coords: Array<{ lat: number; lng: number }>,
  minResolutionMeters = 10,
): Array<{ lat: number; lng: number }> {
  if (coords.length < 2) return [...coords];

  const upsampled: Array<{ lat: number; lng: number }> = [coords[0]];

  for (let i = 1; i < coords.length; i++) {
    const prev = coords[i - 1];
    const curr = coords[i];
    const distance = distanceBetweenLatLng(prev.lat, prev.lng, curr.lat, curr.lng);

    if (distance > minResolutionMeters) {
      const numSegments = Math.ceil(distance / minResolutionMeters);
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
