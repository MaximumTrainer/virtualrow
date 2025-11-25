// Parse RiverThames.gpx and extract coordinates
const fs = require('fs');
const path = require('path');

const gpxPath = path.join(__dirname, '../src/routes/RiverThames.gpx');
const gpxContent = fs.readFileSync(gpxPath, 'utf-8');

// Extract all trkpt elements with lat/lon
const regex = /lat="([^"]+)"\s+lon="([^"]+)"/g;
const coordinates = [];
let match;

while ((match = regex.exec(gpxContent)) !== null) {
  coordinates.push({
    lat: parseFloat(match[1]),
    lng: parseFloat(match[2])
  });
}

console.log(`Parsed ${coordinates.length} coordinates from River Thames GPX`);
console.log(`First coordinate: ${JSON.stringify(coordinates[0])}`);
console.log(`Last coordinate: ${JSON.stringify(coordinates[coordinates.length - 1])}`);

// Write to TypeScript file
const outputPath = path.join(__dirname, 'riverthames-coords.ts');
const tsContent = `export const riverThamesCoordinates = ${JSON.stringify(coordinates)};`;
fs.writeFileSync(outputPath, tsContent);
console.log(`Wrote coordinates to ${outputPath}`);
