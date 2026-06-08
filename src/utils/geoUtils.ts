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

export function normalizeBearingDelta(fromBearing: number, toBearing: number) {
  const delta = ((toBearing - fromBearing + 540) % 360) - 180;
  return Math.abs(delta);
}
