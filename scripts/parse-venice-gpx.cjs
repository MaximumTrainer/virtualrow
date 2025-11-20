// Parse Venice.gpx and extract coordinates
const fs = require('fs');
const path = require('path');

const gpxPath = path.join(__dirname, '../src/routes/Venice.gpx');
const gpxContent = fs.readFileSync(gpxPath, 'utf-8');

// Extract all trkpt elements with lat/lon
const trkptRegex = /<trkpt lat="([0-9.]+)" lon="([0-9.]+)">/g;
const coordinates = [];
let match;

while ((match = trkptRegex.exec(gpxContent)) !== null) {
  coordinates.push({
    lat: parseFloat(match[1]),
    lng: parseFloat(match[2])
  });
}

console.log(`Total coordinates found: ${coordinates.length}`);

// Subsample to reduce point count (take every 10th point for ~180 points)
const subsampleRate = 10;
const subsampledCoords = coordinates.filter((_, i) => i % subsampleRate === 0);

console.log(`Subsampled to: ${subsampledCoords.length} points`);

// Calculate total distance using Haversine formula
function haversineDistance(coord1, coord2) {
  const R = 6371; // Earth's radius in km
  const dLat = (coord2.lat - coord1.lat) * Math.PI / 180;
  const dLng = (coord2.lng - coord1.lng) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(coord1.lat * Math.PI / 180) * Math.cos(coord2.lat * Math.PI / 180) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

let totalDistance = 0;
for (let i = 1; i < subsampledCoords.length; i++) {
  totalDistance += haversineDistance(subsampledCoords[i - 1], subsampledCoords[i]);
}

console.log(`Total distance: ${totalDistance.toFixed(2)} km`);

// Find bounding box
const lats = subsampledCoords.map(c => c.lat);
const lngs = subsampledCoords.map(c => c.lng);
const bbox = {
  minLat: Math.min(...lats),
  maxLat: Math.max(...lats),
  minLng: Math.min(...lngs),
  maxLng: Math.max(...lngs)
};

console.log(`Bounding box:`, bbox);
console.log(`Center:`, {
  lat: (bbox.minLat + bbox.maxLat) / 2,
  lng: (bbox.minLng + bbox.maxLng) / 2
});

// Output as TypeScript array
const output = `// Venice route coordinates (${subsampledCoords.length} points, ${totalDistance.toFixed(2)} km)
const veniceCoords: Coordinate[] = ${JSON.stringify(subsampledCoords, null, 2)};

// Bounding box: ${JSON.stringify(bbox)}
`;

const outputPath = path.join(__dirname, 'venice-coords.ts');
fs.writeFileSync(outputPath, output);
console.log(`\nCoordinates written to: ${outputPath}`);
