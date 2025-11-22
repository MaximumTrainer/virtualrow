const fs = require('fs');
const path = require('path');

// Read the GPX file
const gpxPath = path.resolve(__dirname, '../src/routes/LakeBled.gpx');
const gpxContent = fs.readFileSync(gpxPath, 'utf8');

// Extract lat/lon from trkpt elements
const regex = /lat="([^"]+)"\s+lon="([^"]+)"/g;
const coordinates = [];
let match;

while ((match = regex.exec(gpxContent)) !== null) {
  const lat = parseFloat(match[1]);
  const lng = parseFloat(match[2]);
  coordinates.push({ lat, lng });
}

console.log('Lake Bled coordinates count:', coordinates.length);
console.log('First coordinate:', coordinates[0]);
console.log('Last coordinate:', coordinates[coordinates.length - 1]);

// Write to file for easy copying
const outputPath = path.resolve(__dirname, 'lakebled-coords.ts');
fs.writeFileSync(outputPath, `export const lakeBledCoordinates = ${JSON.stringify(coordinates)};`);
console.log('Written to:', outputPath);
