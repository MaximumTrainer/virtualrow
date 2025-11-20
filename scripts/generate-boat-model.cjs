#!/usr/bin/env node

/**
 * Generate a minimal rowboat glTF/GLB model
 * Usage: node scripts/generate-boat-model.js
 */

const fs = require('fs');
const path = require('path');

// Minimal glTF structure for a simple rowboat
// This creates a GLB (binary glTF) with:
// - A boat hull (long box)
// - A rowing seat (small box)
// - Left and right oars (thin boxes)
// - A handle (small box)

function createBoatGLB() {
  // Define vertices for the boat hull (elongated box)
  const hullVertices = [
    // Front face
    -0.6, -0.1, 0.3,   0.6, -0.1, 0.3,   0.6, 0.1, 0.3,   -0.6, 0.1, 0.3,
    // Back face
    -0.6, -0.1, -0.3,  0.6, -0.1, -0.3, 0.6, 0.1, -0.3,   -0.6, 0.1, -0.3,
    // Top face
    -0.6, 0.1, 0.3,    0.6, 0.1, 0.3,   0.6, 0.1, -0.3,   -0.6, 0.1, -0.3,
    // Bottom face
    -0.6, -0.1, 0.3,   0.6, -0.1, 0.3,  0.6, -0.1, -0.3,  -0.6, -0.1, -0.3,
    // Left face
    -0.6, -0.1, 0.3,   -0.6, 0.1, 0.3,  -0.6, 0.1, -0.3,  -0.6, -0.1, -0.3,
    // Right face
    0.6, -0.1, 0.3,    0.6, 0.1, 0.3,   0.6, 0.1, -0.3,   0.6, -0.1, -0.3,
  ];

  // Indices for hull triangles
  const hullIndices = [
    0, 1, 2,   0, 2, 3,     // Front
    4, 6, 5,   4, 7, 6,     // Back
    8, 9, 10,  8, 10, 11,   // Top
    12, 15, 14, 12, 14, 13, // Bottom
    16, 19, 18, 16, 18, 17, // Left
    20, 21, 22, 20, 22, 23, // Right
  ];

  // Seat vertices (small box at center)
  const seatVertices = [
    -0.3, 0.15, -0.05, 0.3, 0.15, -0.05, 0.3, 0.18, -0.05, -0.3, 0.18, -0.05,
    -0.3, 0.15, 0.05,  0.3, 0.15, 0.05,  0.3, 0.18, 0.05,  -0.3, 0.18, 0.05,
  ];
  const seatIndices = [
    0, 1, 2,   0, 2, 3,     // Front
    4, 6, 5,   4, 7, 6,     // Back
    0, 4, 5,   0, 5, 1,     // Top
    2, 6, 7,   2, 7, 3,     // Bottom
    0, 3, 7,   0, 7, 4,     // Left
    1, 5, 6,   1, 6, 2,     // Right
  ];

  // Left oar (thin box, left side)
  const leftOarVertices = [
    -0.05, 0.15, -0.5,  0.05, 0.15, -0.5,  0.05, 0.2, -0.5,  -0.05, 0.2, -0.5,
    -0.05, 0.15, 0.5,   0.05, 0.15, 0.5,   0.05, 0.2, 0.5,   -0.05, 0.2, 0.5,
  ];
  const oarIndices = [
    0, 1, 2,   0, 2, 3,
    4, 6, 5,   4, 7, 6,
    0, 4, 5,   0, 5, 1,
    2, 6, 7,   2, 7, 3,
    0, 3, 7,   0, 7, 4,
    1, 5, 6,   1, 6, 2,
  ];

  // Right oar (thin box, right side)
  const rightOarVertices = [
    -0.05, 0.15, -0.5,  0.05, 0.15, -0.5,  0.05, 0.2, -0.5,  -0.05, 0.2, -0.5,
    -0.05, 0.15, 0.5,   0.05, 0.15, 0.5,   0.05, 0.2, 0.5,   -0.05, 0.2, 0.5,
  ];

  // Handle (small box at front)
  const handleVertices = [
    -0.1, 0.15, 0.35, 0.1, 0.15, 0.35, 0.1, 0.25, 0.35, -0.1, 0.25, 0.35,
  ];
  const handleIndices = [
    0, 1, 2,   0, 2, 3,     // Front only (simplified)
  ];

  // Build glTF JSON structure
  const gltf = {
    asset: { version: '2.0', generator: 'boat-model-generator' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      {
        name: 'RowboatGroup',
        children: [1, 2, 3, 4],
        matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      },
      { name: 'Hull', mesh: 0, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
      { name: 'Seat', mesh: 1, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
      { name: 'LeftOar', mesh: 2, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -0.7, 0, 0, 1] },
      { name: 'RightOar', mesh: 3, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.7, 0, 0, 1] },
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
        name: 'Seat',
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
        name: 'LeftOar',
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
        name: 'RightOar',
        primitives: [
          {
            attributes: { POSITION: 6 },
            indices: 7,
            material: 2,
            mode: 4,
          },
        ],
      },
    ],
    materials: [
      { name: 'HullMaterial', pbrMetallicRoughness: { baseColorFactor: [0.2, 0.4, 0.7, 1.0], metallicFactor: 0.0, roughnessFactor: 0.7 } },
      { name: 'SeatMaterial', pbrMetallicRoughness: { baseColorFactor: [0.8, 0.6, 0.4, 1.0], metallicFactor: 0.0, roughnessFactor: 0.8 } },
      { name: 'OarMaterial', pbrMetallicRoughness: { baseColorFactor: [0.5, 0.35, 0.2, 1.0], metallicFactor: 0.0, roughnessFactor: 0.6 } },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 24, type: 'VEC3', min: [-0.6, -0.1, -0.3], max: [0.6, 0.1, 0.3] },
      { bufferView: 1, componentType: 5125, count: 36, type: 'SCALAR' },
      { bufferView: 2, componentType: 5126, count: 8, type: 'VEC3', min: [-0.3, 0.15, -0.05], max: [0.3, 0.18, 0.05] },
      { bufferView: 3, componentType: 5125, count: 36, type: 'SCALAR' },
      { bufferView: 4, componentType: 5126, count: 8, type: 'VEC3', min: [-0.05, 0.15, -0.5], max: [0.05, 0.2, 0.5] },
      { bufferView: 5, componentType: 5125, count: 36, type: 'SCALAR' },
      { bufferView: 6, componentType: 5126, count: 8, type: 'VEC3', min: [-0.05, 0.15, -0.5], max: [0.05, 0.2, 0.5] },
      { bufferView: 7, componentType: 5125, count: 36, type: 'SCALAR' },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 288, target: 34962 }, // Hull vertices
      { buffer: 0, byteOffset: 288, byteLength: 144, target: 34963 }, // Hull indices
      { buffer: 0, byteOffset: 432, byteLength: 96, target: 34962 }, // Seat vertices
      { buffer: 0, byteOffset: 528, byteLength: 144, target: 34963 }, // Seat indices
      { buffer: 0, byteOffset: 672, byteLength: 96, target: 34962 }, // Left oar vertices
      { buffer: 0, byteOffset: 768, byteLength: 144, target: 34963 }, // Left oar indices
      { buffer: 0, byteOffset: 912, byteLength: 96, target: 34962 }, // Right oar vertices
      { buffer: 0, byteOffset: 1008, byteLength: 144, target: 34963 }, // Right oar indices
    ],
    buffers: [{ byteLength: 1152 }], // Will be filled with binary data
  };

  // Pack all data into a single binary buffer
  const buffer = Buffer.alloc(1152);
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
  // Left oar vertices
  leftOarVertices.forEach((v) => {
    buffer.writeFloatLE(v, offset);
    offset += 4;
  });
  // Left oar indices
  oarIndices.forEach((i) => {
    buffer.writeUInt32LE(i, offset);
    offset += 4;
  });
  // Right oar vertices
  rightOarVertices.forEach((v) => {
    buffer.writeFloatLE(v, offset);
    offset += 4;
  });
  // Right oar indices
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
