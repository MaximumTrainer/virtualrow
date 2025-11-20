const fs = require('fs');
const path = require('path');

// Parse Henley GPX file
const gpxPath = path.join(__dirname, '..', 'src', 'routes', 'HenleyRowing.gpx');
const gpxContent = fs.readFileSync(gpxPath, 'utf-8');

// Extract all trkpt coordinates using regex
const trkptRegex = /<trkpt\s+lat="([^"]+)"\s+lon="([^"]+)">/g;
const coordinates = [];
let match;

while ((match = trkptRegex.exec(gpxContent)) !== null) {
  const lat = parseFloat(match[1]);
  const lng = parseFloat(match[2]);
  coordinates.push({ lat, lng });
}

console.log(`Total coordinates found: ${coordinates.length}`);

// Haversine formula to calculate distance between two points
function haversine(coord1, coord2) {
  const R = 6371; // Earth's radius in km
  const dLat = ((coord2.lat - coord1.lat) * Math.PI) / 180;
  const dLng = ((coord2.lng - coord1.lng) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((coord1.lat * Math.PI) / 180) *
      Math.cos((coord2.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Calculate total distance
let totalDistance = 0;
for (let i = 0; i < coordinates.length - 1; i++) {
  totalDistance += haversine(coordinates[i], coordinates[i + 1]);
}

console.log(`Total distance: ${totalDistance.toFixed(2)} km`);

// Calculate bounding box
const lats = coordinates.map(c => c.lat);
const lngs = coordinates.map(c => c.lng);
const bbox = {
  minLat: Math.min(...lats),
  maxLat: Math.max(...lats),
  minLng: Math.min(...lngs),
  maxLng: Math.max(...lngs)
};

console.log(`Bounding box: ${JSON.stringify(bbox)}`);
console.log(`Center: { lat: ${((bbox.minLat + bbox.maxLat) / 2).toFixed(6)}, lng: ${((bbox.minLng + bbox.maxLng) / 2).toFixed(6)} }`);

// Output TypeScript array
const outputPath = path.join(__dirname, 'henley-coords.ts');
const tsContent = `// Henley Rowing route coordinates parsed from HenleyRowing.gpx
// ${coordinates.length} points, ${totalDistance.toFixed(2)} km

export const henleyCoordinates = ${JSON.stringify(coordinates, null, 2)};

// Bounding box: ${JSON.stringify(bbox)}
`;

fs.writeFileSync(outputPath, tsContent);
console.log(`Coordinates written to: ${outputPath}`);
