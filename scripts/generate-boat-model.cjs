#!/usr/bin/env node

/**
 * Generate a racing rowing scull glTF/GLB model (single scull)
 * Usage: node scripts/generate-boat-model.cjs
 */

const fs = require('fs');
const path = require('path');

// Creates a GLB (binary glTF) with:
// - A sleek racing shell hull (narrow, long, tapered)
// - A rower figure (torso + head)
// - Left and right sculling oars (long, thin with blade)
// - Seat (sliding seat)

function createBoatGLB() {
  // Racing shell hull - long, narrow, tapered at both ends (racing scull shape)
  const hullVertices = [
    // Hull body - very narrow sleek design (0.15 wide, 2.8 long)
    // Bow (front, pointed)
    0, 0.05, 1.4,      // Top center front
    -0.05, -0.05, 1.3, // Bottom left front
    0.05, -0.05, 1.3,  // Bottom right front
    
    // Mid-front
    -0.075, 0.03, 0.7,  -0.075, -0.05, 0.7,
    0.075, 0.03, 0.7,   0.075, -0.05, 0.7,
    
    // Center (widest point)
    -0.1, 0.05, 0,  -0.1, -0.05, 0,
    0.1, 0.05, 0,   0.1, -0.05, 0,
    
    // Mid-rear
    -0.075, 0.03, -0.7,  -0.075, -0.05, -0.7,
    0.075, 0.03, -0.7,   0.075, -0.05, -0.7,
    
    // Stern (back, tapered)
    0, 0.05, -1.4,     // Top center back
    -0.05, -0.05, -1.3, // Bottom left back
    0.05, -0.05, -1.3,  // Bottom right back
  ];

  // Hull indices - building a streamlined shell
  const hullIndices = [
    // Bow section
    0, 1, 2,  // Front tip
    1, 4, 2,  2, 4, 6,  // Front to mid-front
    1, 3, 4,  2, 6, 5,
    
    // Mid-front to center
    3, 8, 4,  4, 8, 10,
    4, 10, 6,  6, 10, 9,
    
    // Center to mid-rear
    8, 12, 10,  10, 12, 14,
    10, 14, 9,  9, 14, 13,
    
    // Mid-rear to stern
    12, 16, 14,  14, 16, 18,
    12, 17, 16,  14, 18, 15,
    
    // Stern tip
    16, 17, 18,
    
    // Bottom panels
    1, 11, 8,  1, 8, 3,
    8, 11, 12,  11, 13, 12,
    13, 15, 17,  13, 17, 12,
    
    // Top deck
    0, 7, 3,  3, 7, 8,
    8, 7, 11,  11, 7, 12,
    12, 7, 16,  7, 15, 16,
  ];

  // Rower torso (simplified body shape)
  const rowerVertices = [
    // Torso - rectangular
    -0.12, 0.1, -0.1,  0.12, 0.1, -0.1,  // Bottom front
    -0.12, 0.5, -0.1,  0.12, 0.5, -0.1,  // Top front
    -0.1, 0.1, 0.2,    0.1, 0.1, 0.2,    // Bottom back
    -0.1, 0.5, 0.2,    0.1, 0.5, 0.2,    // Top back
    
    // Head - small box on top
    -0.08, 0.5, 0.05,  0.08, 0.5, 0.05,  // Bottom
    -0.08, 0.7, 0.05,  0.08, 0.7, 0.05,  // Top
    -0.08, 0.5, 0.15,  0.08, 0.5, 0.15,
    -0.08, 0.7, 0.15,  0.08, 0.7, 0.15,
  ];
  
  const rowerIndices = [
    // Torso
    0, 1, 3,  0, 3, 2,  // Front
    4, 6, 7,  4, 7, 5,  // Back
    0, 2, 6,  0, 6, 4,  // Left
    1, 5, 7,  1, 7, 3,  // Right
    2, 3, 7,  2, 7, 6,  // Top
    0, 4, 5,  0, 5, 1,  // Bottom
    
    // Head
    8, 9, 11,  8, 11, 10,   // Front
    12, 14, 15, 12, 15, 13,  // Back
    8, 10, 14,  8, 14, 12,   // Left
    9, 13, 15,  9, 15, 11,   // Right
    10, 11, 15, 10, 15, 14,  // Top
    8, 12, 13,  8, 13, 9,    // Bottom
  ];

  // Seat (sliding seat in racing shell)
  const seatVertices = [
    -0.08, 0.08, -0.05, 0.08, 0.08, -0.05,
    -0.08, 0.11, -0.05, 0.08, 0.11, -0.05,
    -0.08, 0.08, 0.05,  0.08, 0.08, 0.05,
    -0.08, 0.11, 0.05,  0.08, 0.11, 0.05,
  ];
  const seatIndices = [
    0, 1, 3,  0, 3, 2,
    4, 6, 7,  4, 7, 5,
    0, 4, 5,  0, 5, 1,
    2, 3, 7,  2, 7, 6,
    0, 2, 6,  0, 6, 4,
    1, 5, 7,  1, 7, 3,
  ];

  // Oar shaft and blade (sculling oar - long and thin with blade at end)
  // Shaft from handle to blade
  const oarVertices = [
    // Shaft (thin cylinder approximation - 8 vertices for octagonal)
    // Handle end (near rower)
    -0.015, 0.2, -0.15,   0.015, 0.2, -0.15,
    -0.015, 0.23, -0.15,  0.015, 0.23, -0.15,
    
    // Mid shaft
    -0.02, 0.21, 0.5,     0.02, 0.21, 0.5,
    -0.02, 0.24, 0.5,     0.02, 0.24, 0.5,
    
    // Blade attachment point
    -0.025, 0.215, 1.0,   0.025, 0.215, 1.0,
    -0.025, 0.235, 1.0,   0.025, 0.235, 1.0,
    
    // Blade (flat rectangular paddle)
    -0.08, 0.2, 1.0,      0.08, 0.2, 1.0,
    -0.08, 0.25, 1.0,     0.08, 0.25, 1.0,
    -0.08, 0.2, 1.35,     0.08, 0.2, 1.35,
    -0.08, 0.25, 1.35,    0.08, 0.25, 1.35,
  ];
  
  const oarIndices = [
    // Shaft sections
    0, 1, 3,  0, 3, 2,
    1, 5, 7,  1, 7, 3,
    4, 6, 7,  4, 7, 5,
    0, 2, 6,  0, 6, 4,
    2, 3, 7,  2, 7, 6,
    0, 4, 5,  0, 5, 1,
    
    // Mid to blade attachment
    4, 5, 9,   4, 9, 8,
    5, 9, 11,  5, 11, 7,
    6, 10, 11, 6, 11, 7,
    4, 8, 10,  4, 10, 6,
    
    // Blade faces
    12, 13, 15, 12, 15, 14,  // Front face
    16, 18, 19, 16, 19, 17,  // Back face
    12, 14, 18, 12, 18, 16,  // Left edge
    13, 17, 19, 13, 19, 15,  // Right edge
    14, 15, 19, 14, 19, 18,  // Top edge
    12, 16, 17, 12, 17, 13,  // Bottom edge
    
    // Blade to shaft connection
    8, 9, 13,   8, 13, 12,
    9, 11, 15,  9, 15, 13,
    10, 14, 15, 10, 15, 11,
    8, 12, 14,  8, 14, 10,
  ];

  // Build glTF JSON structure
  const gltf = {
    asset: { version: '2.0', generator: 'boat-model-generator' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      {
        name: 'ScullBoatGroup',
        children: [1, 2, 3, 4],
        matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      },
      { name: 'Hull', mesh: 0, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
      { name: 'Rower', mesh: 1, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
      { name: 'Seat', mesh: 2, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
      // Oars - these will be animated/rotated in the scene
      { name: 'LeftOar', mesh: 3, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -0.35, 0, 0, 1] },
      { name: 'RightOar', mesh: 3, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.35, 0, 0, 1] },
    ],
    meshes: [
      {
        name: 'Hull',
        primitives: [
          {
            attributes: { POSITION: 0 },
            indices: 1,
            material: 0,
            mode: 4, // TRIANGLES
          },
        ],
      },
      {
        name: 'Rower',
        primitives: [
          {
            attributes: { POSITION: 2 },
            indices: 3,
            material: 1,
            mode: 4,
          },
        ],
      },
      {
        name: 'Seat',
        primitives: [
          {
            attributes: { POSITION: 4 },
            indices: 5,
            material: 2,
            mode: 4,
          },
        ],
      },
      {
        name: 'Oar',
        primitives: [
          {
            attributes: { POSITION: 6 },
            indices: 7,
            material: 3,
            mode: 4,
          },
        ],
      },
    ],
    materials: [
      { name: 'HullMaterial', pbrMetallicRoughness: { baseColorFactor: [0.95, 0.8, 0.1, 1.0], metallicFactor: 0.3, roughnessFactor: 0.5 } },  // Yellow/gold racing shell
      { name: 'RowerMaterial', pbrMetallicRoughness: { baseColorFactor: [0.8, 0.2, 0.1, 1.0], metallicFactor: 0.0, roughnessFactor: 0.8 } },  // Red rowing outfit
      { name: 'SeatMaterial', pbrMetallicRoughness: { baseColorFactor: [0.2, 0.2, 0.2, 1.0], metallicFactor: 0.1, roughnessFactor: 0.7 } },   // Dark gray seat
      { name: 'OarMaterial', pbrMetallicRoughness: { baseColorFactor: [0.3, 0.25, 0.2, 1.0], metallicFactor: 0.0, roughnessFactor: 0.6 } },   // Dark brown oars
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: hullVertices.length / 3, type: 'VEC3', min: [-0.1, -0.05, -1.4], max: [0.1, 0.05, 1.4] },
      { bufferView: 1, componentType: 5125, count: hullIndices.length, type: 'SCALAR' },
      { bufferView: 2, componentType: 5126, count: rowerVertices.length / 3, type: 'VEC3', min: [-0.12, 0.1, -0.1], max: [0.12, 0.7, 0.2] },
      { bufferView: 3, componentType: 5125, count: rowerIndices.length, type: 'SCALAR' },
      { bufferView: 4, componentType: 5126, count: seatVertices.length / 3, type: 'VEC3', min: [-0.08, 0.08, -0.05], max: [0.08, 0.11, 0.05] },
      { bufferView: 5, componentType: 5125, count: seatIndices.length, type: 'SCALAR' },
      { bufferView: 6, componentType: 5126, count: oarVertices.length / 3, type: 'VEC3', min: [-0.08, 0.2, -0.15], max: [0.08, 0.25, 1.35] },
      { bufferView: 7, componentType: 5125, count: oarIndices.length, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: hullVertices.length * 4, target: 34962 },
      { buffer: 0, byteOffset: hullVertices.length * 4, byteLength: hullIndices.length * 4, target: 34963 },
      { buffer: 0, byteOffset: (hullVertices.length + hullIndices.length) * 4, byteLength: rowerVertices.length * 4, target: 34962 },
      { buffer: 0, byteOffset: (hullVertices.length + hullIndices.length + rowerVertices.length) * 4, byteLength: rowerIndices.length * 4, target: 34963 },
      { buffer: 0, byteOffset: (hullVertices.length + hullIndices.length + rowerVertices.length + rowerIndices.length) * 4, byteLength: seatVertices.length * 4, target: 34962 },
      { buffer: 0, byteOffset: (hullVertices.length + hullIndices.length + rowerVertices.length + rowerIndices.length + seatVertices.length) * 4, byteLength: seatIndices.length * 4, target: 34963 },
      { buffer: 0, byteOffset: (hullVertices.length + hullIndices.length + rowerVertices.length + rowerIndices.length + seatVertices.length + seatIndices.length) * 4, byteLength: oarVertices.length * 4, target: 34962 },
      { buffer: 0, byteOffset: (hullVertices.length + hullIndices.length + rowerVertices.length + rowerIndices.length + seatVertices.length + seatIndices.length + oarVertices.length) * 4, byteLength: oarIndices.length * 4, target: 34963 },
    ],
    buffers: [{ byteLength: (hullVertices.length + hullIndices.length + rowerVertices.length + rowerIndices.length + seatVertices.length + seatIndices.length + oarVertices.length + oarIndices.length) * 4 }],
  };

  // Pack all data into a single binary buffer
  const totalBytes = (hullVertices.length + hullIndices.length + rowerVertices.length + rowerIndices.length + seatVertices.length + seatIndices.length + oarVertices.length + oarIndices.length) * 4;
  const buffer = Buffer.alloc(totalBytes);
  let offset = 0;

  // Hull vertices
  hullVertices.forEach((v) => {
    buffer.writeFloatLE(v, offset);
    offset += 4;
  });
  // Hull indices
  hullIndices.forEach((i) => {
    buffer.writeUInt32LE(i, offset);
    offset += 4;
  });
  // Rower vertices
  rowerVertices.forEach((v) => {
    buffer.writeFloatLE(v, offset);
    offset += 4;
  });
  // Rower indices
  rowerIndices.forEach((i) => {
    buffer.writeUInt32LE(i, offset);
    offset += 4;
  });
  // Seat vertices
  seatVertices.forEach((v) => {
    buffer.writeFloatLE(v, offset);
    offset += 4;
  });
  // Seat indices
  seatIndices.forEach((i) => {
    buffer.writeUInt32LE(i, offset);
    offset += 4;
  });
  // Oar vertices
  oarVertices.forEach((v) => {
    buffer.writeFloatLE(v, offset);
    offset += 4;
  });
  // Oar indices
  oarIndices.forEach((i) => {
    buffer.writeUInt32LE(i, offset);
    offset += 4;
  });

  // Build GLB file (binary glTF)
  // GLB header: 12 bytes
  // Chunk header: 8 bytes per chunk
  // JSON chunk (type 0x4E5854A) + binary chunk (type 0x004E4942)

  const jsonStr = JSON.stringify(gltf);
  const jsonBuffer = Buffer.from(jsonStr, 'utf8');
  const jsonPadded = Buffer.alloc(Math.ceil(jsonBuffer.length / 4) * 4);
  jsonBuffer.copy(jsonPadded);

  const binaryPadded = Buffer.alloc(Math.ceil(buffer.length / 4) * 4);
  buffer.copy(binaryPadded);

  const glbBuffer = Buffer.alloc(12 + 8 + jsonPadded.length + 8 + binaryPadded.length);
  let pos = 0;

  // GLB header
  glbBuffer.writeUInt32LE(0x46546C67, pos); // 'glTF' magic
  pos += 4;
  glbBuffer.writeUInt32LE(2, pos); // version
  pos += 4;
  glbBuffer.writeUInt32LE(glbBuffer.length, pos); // total file size
  pos += 4;

  // JSON chunk
  glbBuffer.writeUInt32LE(jsonPadded.length, pos); // chunk length
  pos += 4;
  glbBuffer.writeUInt32LE(0x4E5354A, pos); // 'JSON' chunk type
  pos += 4;
  jsonPadded.copy(glbBuffer, pos);
  pos += jsonPadded.length;

  // Binary chunk
  glbBuffer.writeUInt32LE(binaryPadded.length, pos); // chunk length
  pos += 4;
  glbBuffer.writeUInt32LE(0x004E4942, pos); // 'BIN\0' chunk type
  pos += 4;
  binaryPadded.copy(glbBuffer, pos);

  return glbBuffer;
}

// Generate and write the GLB file
const glb = createBoatGLB();
const outputPath = path.join(__dirname, '../public/models/boat.glb');
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, glb);
console.log(`✓ Generated rowboat model at ${outputPath} (${glb.length} bytes)`);
