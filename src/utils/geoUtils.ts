export function latLngToMeters(lat: number, lng: number, originLat: number, originLng: number) {
  // Approximation using equirectangular projection around origin
  const R = 6378137; // earth radius in meters
  const dLat = (lat - originLat) * (Math.PI / 180);
  const dLng = (lng - originLng) * (Math.PI / 180);
  const x = dLng * R * Math.cos(originLat * Math.PI / 180);
  const y = dLat * R;
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
  const R = 6378137; // meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) * Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}
