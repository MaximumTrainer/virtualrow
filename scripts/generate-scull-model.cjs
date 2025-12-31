#!/usr/bin/env node

/**
 * Generate a single scull rowing boat glTF/GLB model (original, inspired by typical proportions)
 * Usage: node scripts/generate-scull-model.cjs
 */

const fs = require('fs');
const path = require('path');

function createBoatGLB() {
  // Single scull hull - elongated, narrow, tapered bow/stern
  // Overall length ~8.2m (normalized here to ~4 units each side), beam ~0.3m (normalized ~0.24)
  const hullVertices = [
    // Bow tip (slightly longer, narrower)
    0, 0.065, 4.2,
    -0.055, -0.06, 4.0,
    0.055, -0.06, 4.0,

    // Front quarter (reduced beam, slight deck camber)
    -0.095, 0.05, 2.2,   -0.095, -0.06, 2.2,
     0.095, 0.05, 2.2,    0.095, -0.06, 2.2,

    // Mid (widest, a touch more camber)
    -0.12, 0.065, 0.0,    -0.12, -0.06, 0.0,
     0.12, 0.065, 0.0,     0.12, -0.06, 0.0,

    // Rear quarter (reduced beam)
    -0.095, 0.05, -2.2,  -0.095, -0.06, -2.2,
     0.095, 0.05, -2.2,   0.095, -0.06, -2.2,

    // Stern tip (longer, narrow)
    0, 0.065, -4.2,
    -0.055, -0.06, -4.0,
    0.055, -0.06, -4.0,
  ];

  // Hull indices - streamlined shell panels
  const hullIndices = [
    // Bow section
    0, 1, 2,
    1, 4, 2,   2, 4, 6,
    1, 3, 4,   2, 6, 5,

    // Mid-front to center
    3, 8, 4,   4, 8, 10,
    4, 10, 6,  6, 10, 9,

    // Center to mid-rear
    8, 12, 10,  10, 12, 14,
    10, 14, 9,   9, 14, 13,

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

  // Rower torso (simplified figure)
  const rowerVertices = [
    // Torso - rectangular
    -0.12, 0.1, -0.1,  0.12, 0.1, -0.1,
    -0.12, 0.5, -0.1,  0.12, 0.5, -0.1,
    -0.1, 0.1, 0.2,    0.1, 0.1, 0.2,
    -0.1, 0.5, 0.2,    0.1, 0.5, 0.2,

    // Head - small box on top
    -0.08, 0.5, 0.05,  0.08, 0.5, 0.05,
    -0.08, 0.7, 0.05,  0.08, 0.7, 0.05,
    -0.08, 0.5, 0.15,  0.08, 0.5, 0.15,
    -0.08, 0.7, 0.15,  0.08, 0.7, 0.15,
  ];
  const rowerIndices = [
    // Torso
    0, 1, 3,  0, 3, 2,
    4, 6, 7,  4, 7, 5,
    0, 2, 6,  0, 6, 4,
    1, 5, 7,  1, 7, 3,
    2, 3, 7,  2, 7, 6,
    0, 4, 5,  0, 5, 1,

    // Head
    8, 9, 11,  8, 11, 10,
    12, 14, 15, 12, 15, 13,
    8, 10, 14,  8, 14, 12,
    9, 13, 15,  9, 15, 11,
    10, 11, 15, 10, 15, 14,
    8, 12, 13,  8, 13, 9,
  ];

  // Seat (sliding seat)
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

  // Oar shaft and blade (sculling oar)
  const oarVertices = [
    // Handle end
    -0.015, 0.2, -0.15,   0.015, 0.2, -0.15,
    -0.015, 0.23, -0.15,  0.015, 0.23, -0.15,

    // Mid shaft
    -0.02, 0.21, 0.5,     0.02, 0.21, 0.5,
    -0.02, 0.24, 0.5,     0.02, 0.24, 0.5,

    // Blade attachment point
    -0.025, 0.215, 1.05,   0.025, 0.215, 1.05,
    -0.025, 0.235, 1.05,   0.025, 0.235, 1.05,

    // Blade (flat rectangular paddle)
    -0.09, 0.205, 1.05,      0.09, 0.205, 1.05,
    -0.09, 0.255, 1.05,      0.09, 0.255, 1.05,
    -0.085, 0.205, 1.45,     0.085, 0.205, 1.45,
    -0.085, 0.255, 1.45,     0.085, 0.255, 1.45,
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
    12, 13, 15, 12, 15, 14,
    16, 18, 19, 16, 19, 17,
    12, 14, 18, 12, 18, 16,
    13, 17, 19, 13, 19, 15,
    14, 15, 19, 14, 19, 18,
    12, 16, 17, 12, 17, 13,

    // Blade to shaft connection
    8, 9, 13,   8, 13, 12,
    9, 11, 15,  9, 15, 13,
    10, 14, 15, 10, 15, 11,
    8, 12, 14,  8, 14, 10,
  ];

  // Simple aluminum riggers (left/right) + oarlocks
  const riggerVertices = [
    // Wing riggers (angled supports)
    // Left wing: root near midship, wing tip outboard
    -0.10, 0.03, -0.15,   -0.38, 0.03, 0.0,   -0.10, 0.03, 0.15,
    // Right wing
     0.10, 0.03, -0.15,    0.38, 0.03, 0.0,    0.10, 0.03, 0.15,
    // Oarlocks (small blocks at wing tips)
    -0.40, 0.045, 0.0,    -0.36, 0.045, 0.0,   -0.40, 0.025, 0.0,   -0.36, 0.025, 0.0,
     0.36, 0.045, 0.0,     0.40, 0.045, 0.0,    0.36, 0.025, 0.0,    0.40, 0.025, 0.0,
  ];
  const riggerIndices = [
    // Left triangle
    0, 1, 2,
    // Right triangle
    3, 4, 5,
    // Left oarlock quad
    6, 7, 9,  6, 9, 8,
    // Right oarlock quad
    10, 11, 13,  10, 13, 12,
  ];

  // Seat rails (two long thin rectangles along z)
  const railsVertices = [
    // Left rail top face (quad)
    -0.07, 0.025, -0.5,  -0.05, 0.025, -0.5,
    -0.07, 0.025,  0.5,  -0.05, 0.025,  0.5,
    // Right rail top face (quad)
     0.05, 0.025, -0.5,   0.07, 0.025, -0.5,
     0.05, 0.025,  0.5,   0.07, 0.025,  0.5,
  ];
  const railsIndices = [
    // Left rail two triangles
    0, 1, 3,  0, 3, 2,
    // Right rail two triangles
    4, 5, 7,  4, 7, 6,
  ];

  // Foot stretcher plate + two shoe blocks
  const footStretcherVertices = [
    // Plate (quad)
    -0.12, 0.03, 0.05,   0.12, 0.03, 0.05,
    -0.12, 0.03, 0.25,   0.12, 0.03, 0.25,
    // Left shoe (small box top face)
    -0.06, 0.06, 0.08,  -0.01, 0.06, 0.08,
    -0.06, 0.06, 0.20,  -0.01, 0.06, 0.20,
    // Right shoe (small box top face)
     0.01, 0.06, 0.08,   0.06, 0.06, 0.08,
     0.01, 0.06, 0.20,   0.06, 0.06, 0.20,
  ];
  const footStretcherIndices = [
    // Plate
    0, 1, 3,  0, 3, 2,
    // Left shoe top
    4, 5, 7,  4, 7, 6,
    // Right shoe top
    8, 9, 11,  8, 11, 10,
  ];

  // Stern fin/skeg (two triangles)
  const finVertices = [
    -0.01, -0.085, -4.0,   0.01, -0.085, -4.0,   0.0, -0.165, -3.95,
    -0.01, -0.085, -4.0,   0.01, -0.085, -4.0,   0.0, -0.165, -4.05,
  ];
  const finIndices = [
    0, 1, 2,  3, 4, 5,
  ];

  // Bow ball (small cube at bow tip top)
  const bowBallVertices = [
    // Top face quad
    -0.03, 0.095, 4.15,   0.03, 0.095, 4.15,
    -0.03, 0.095, 4.09,   0.03, 0.095, 4.09,
    // Front face quad
    -0.03, 0.065, 4.15,   0.03, 0.065, 4.15,
    -0.03, 0.095, 4.15,   0.03, 0.095, 4.15,
  ];
  const bowBallIndices = [
    // Top
    0, 1, 3,  0, 3, 2,
    // Front
    4, 5, 7,  4, 7, 6,
  ];

  // Build glTF JSON structure
  const gltf = {
    asset: { version: '2.0', generator: 'boat-model-generator' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [
      {
        name: 'ScullBoatGroup',
        children: [1, 2, 3, 4, 5, 6, 7, 8, 9],
        matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
      },
      { name: 'Hull', mesh: 0, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
      { name: 'Rower', mesh: 1, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
      { name: 'Seat', mesh: 2, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] },
      // Oars - these will be animated/rotated in the scene
      { name: 'LeftOar', mesh: 3, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -0.35, 0.0, 0, 1] },
      { name: 'RightOar', mesh: 3, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.35, 0.0, 0, 1] },
      { name: 'Riggers', mesh: 4, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0.0, 0, 1] },
      { name: 'RailsNode', mesh: 5, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0.0, 0, 1] },
      { name: 'FootStretcherNode', mesh: 6, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, -0.02, 0.0, 0, 1] },
      { name: 'FinNode', mesh: 7, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -0.02, 0, 1] },
      { name: 'BowBallNode', mesh: 8, matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0.0, 0, 1] },
    ],
    meshes: [
      {
        name: 'Hull',
        primitives: [
          { attributes: { POSITION: 0 }, indices: 1, material: 0, mode: 4 },
        ],
      },
      {
        name: 'Rower',
        primitives: [
          { attributes: { POSITION: 2 }, indices: 3, material: 1, mode: 4 },
        ],
      },
      {
        name: 'Seat',
        primitives: [
          { attributes: { POSITION: 4 }, indices: 5, material: 2, mode: 4 },
        ],
      },
      {
        name: 'Oar',
        primitives: [
          { attributes: { POSITION: 6 }, indices: 7, material: 3, mode: 4 },
        ],
      },
      {
        name: 'Riggers',
        primitives: [
          { attributes: { POSITION: 8 }, indices: 9, material: 4, mode: 4 },
        ],
      },
      {
        name: 'Rails',
        primitives: [
          { attributes: { POSITION: 10 }, indices: 11, material: 5, mode: 4 },
        ],
      },
      {
        name: 'FootStretcher',
        primitives: [
          { attributes: { POSITION: 12 }, indices: 13, material: 6, mode: 4 },
        ],
      },
      {
        name: 'Fin',
        primitives: [
          { attributes: { POSITION: 14 }, indices: 15, material: 7, mode: 4 },
        ],
      },
      {
        name: 'BowBall',
        primitives: [
          { attributes: { POSITION: 16 }, indices: 17, material: 8, mode: 4 },
        ],
      },
    ],
    materials: [
      { name: 'HullMaterial', pbrMetallicRoughness: { baseColorFactor: [0.9, 0.9, 0.9, 1.0], metallicFactor: 0.2, roughnessFactor: 0.4 } },
      { name: 'RowerMaterial', pbrMetallicRoughness: { baseColorFactor: [0.8, 0.2, 0.1, 1.0], metallicFactor: 0.0, roughnessFactor: 0.8 } },
      { name: 'SeatMaterial', pbrMetallicRoughness: { baseColorFactor: [0.2, 0.2, 0.2, 1.0], metallicFactor: 0.1, roughnessFactor: 0.7 } },
      { name: 'OarMaterial', pbrMetallicRoughness: { baseColorFactor: [0.1, 0.1, 0.1, 1.0], metallicFactor: 0.1, roughnessFactor: 0.5 } },
      { name: 'RiggerMaterial', pbrMetallicRoughness: { baseColorFactor: [0.7, 0.75, 0.8, 1.0], metallicFactor: 0.6, roughnessFactor: 0.4 } },
      { name: 'RailsMaterial', pbrMetallicRoughness: { baseColorFactor: [0.15, 0.15, 0.15, 1.0], metallicFactor: 0.3, roughnessFactor: 0.5 } },
      { name: 'StretcherMaterial', pbrMetallicRoughness: { baseColorFactor: [0.1, 0.1, 0.1, 1.0], metallicFactor: 0.2, roughnessFactor: 0.7 } },
      { name: 'FinMaterial', pbrMetallicRoughness: { baseColorFactor: [0.05, 0.05, 0.05, 1.0], metallicFactor: 0.1, roughnessFactor: 0.6 } },
      { name: 'BowBallMaterial', pbrMetallicRoughness: { baseColorFactor: [1.0, 0.95, 0.2, 1.0], metallicFactor: 0.0, roughnessFactor: 0.6 } },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: hullVertices.length / 3, type: 'VEC3', min: [-0.12, -0.06, -4.0], max: [0.12, 0.06, 4.0] },
      { bufferView: 1, componentType: 5125, count: hullIndices.length, type: 'SCALAR' },
      { bufferView: 2, componentType: 5126, count: rowerVertices.length / 3, type: 'VEC3', min: [-0.12, 0.1, -0.1], max: [0.12, 0.7, 0.2] },
      { bufferView: 3, componentType: 5125, count: rowerIndices.length, type: 'SCALAR' },
      { bufferView: 4, componentType: 5126, count: seatVertices.length / 3, type: 'VEC3', min: [-0.08, 0.08, -0.05], max: [0.08, 0.11, 0.05] },
      { bufferView: 5, componentType: 5125, count: seatIndices.length, type: 'SCALAR' },
      { bufferView: 6, componentType: 5126, count: oarVertices.length / 3, type: 'VEC3', min: [-0.08, 0.2, -0.15], max: [0.08, 0.25, 1.35] },
      { bufferView: 7, componentType: 5125, count: oarIndices.length, type: 'SCALAR' },
      { bufferView: 8, componentType: 5126, count: riggerVertices.length / 3, type: 'VEC3' },
      { bufferView: 9, componentType: 5125, count: riggerIndices.length, type: 'SCALAR' },
      { bufferView: 10, componentType: 5126, count: railsVertices.length / 3, type: 'VEC3' },
      { bufferView: 11, componentType: 5125, count: railsIndices.length, type: 'SCALAR' },
      { bufferView: 12, componentType: 5126, count: footStretcherVertices.length / 3, type: 'VEC3' },
      { bufferView: 13, componentType: 5125, count: footStretcherIndices.length, type: 'SCALAR' },
      { bufferView: 14, componentType: 5126, count: finVertices.length / 3, type: 'VEC3' },
      { bufferView: 15, componentType: 5125, count: finIndices.length, type: 'SCALAR' },
      { bufferView: 16, componentType: 5126, count: bowBallVertices.length / 3, type: 'VEC3' },
      { bufferView: 17, componentType: 5125, count: bowBallIndices.length, type: 'SCALAR' },
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
      { buffer: 0, byteOffset: (hullVertices.length + hullIndices.length + rowerVertices.length + rowerIndices.length + seatVertices.length + seatIndices.length + oarVertices.length + oarIndices.length) * 4, byteLength: riggerVertices.length * 4, target: 34962 },
      { buffer: 0, byteOffset: (hullVertices.length + hullIndices.length + rowerVertices.length + rowerIndices.length + seatVertices.length + seatIndices.length + oarVertices.length + oarIndices.length + riggerVertices.length) * 4, byteLength: riggerIndices.length * 4, target: 34963 },
      { buffer: 0, byteOffset: (hullVertices.length + hullIndices.length + rowerVertices.length + rowerIndices.length + seatVertices.length + seatIndices.length + oarVertices.length + oarIndices.length + riggerVertices.length + riggerIndices.length) * 4, byteLength: railsVertices.length * 4, target: 34962 },
      { buffer: 0, byteOffset: (hullVertices.length + hullIndices.length + rowerVertices.length + rowerIndices.length + seatVertices.length + seatIndices.length + oarVertices.length + oarIndices.length + riggerVertices.length + riggerIndices.length + railsVertices.length) * 4, byteLength: railsIndices.length * 4, target: 34963 },
      { buffer: 0, byteOffset: (hullVertices.length + hullIndices.length + rowerVertices.length + rowerIndices.length + seatVertices.length + seatIndices.length + oarVertices.length + oarIndices.length + riggerVertices.length + riggerIndices.length + railsVertices.length + railsIndices.length) * 4, byteLength: footStretcherVertices.length * 4, target: 34962 },
      { buffer: 0, byteOffset: (hullVertices.length + hullIndices.length + rowerVertices.length + rowerIndices.length + seatVertices.length + seatIndices.length + oarVertices.length + oarIndices.length + riggerVertices.length + riggerIndices.length + railsVertices.length + railsIndices.length + footStretcherVertices.length) * 4, byteLength: footStretcherIndices.length * 4, target: 34963 },
      { buffer: 0, byteOffset: (hullVertices.length + hullIndices.length + rowerVertices.length + rowerIndices.length + seatVertices.length + seatIndices.length + oarVertices.length + oarIndices.length + riggerVertices.length + riggerIndices.length + railsVertices.length + railsIndices.length + footStretcherVertices.length + footStretcherIndices.length) * 4, byteLength: finVertices.length * 4, target: 34962 },
      { buffer: 0, byteOffset: (hullVertices.length + hullIndices.length + rowerVertices.length + rowerIndices.length + seatVertices.length + seatIndices.length + oarVertices.length + oarIndices.length + riggerVertices.length + riggerIndices.length + railsVertices.length + railsIndices.length + footStretcherVertices.length + footStretcherIndices.length + finVertices.length) * 4, byteLength: finIndices.length * 4, target: 34963 },
      { buffer: 0, byteOffset: (hullVertices.length + hullIndices.length + rowerVertices.length + rowerIndices.length + seatVertices.length + seatIndices.length + oarVertices.length + oarIndices.length + riggerVertices.length + riggerIndices.length + railsVertices.length + railsIndices.length + footStretcherVertices.length + footStretcherIndices.length + finVertices.length + finIndices.length) * 4, byteLength: bowBallVertices.length * 4, target: 34962 },
      { buffer: 0, byteOffset: (hullVertices.length + hullIndices.length + rowerVertices.length + rowerIndices.length + seatVertices.length + seatIndices.length + oarVertices.length + oarIndices.length + riggerVertices.length + riggerIndices.length + railsVertices.length + railsIndices.length + footStretcherVertices.length + footStretcherIndices.length + finVertices.length + finIndices.length + bowBallVertices.length) * 4, byteLength: bowBallIndices.length * 4, target: 34963 },
    ],
    buffers: [{ byteLength: (hullVertices.length + hullIndices.length + rowerVertices.length + rowerIndices.length + seatVertices.length + seatIndices.length + oarVertices.length + oarIndices.length + riggerVertices.length + riggerIndices.length + railsVertices.length + railsIndices.length + footStretcherVertices.length + footStretcherIndices.length + finVertices.length + finIndices.length + bowBallVertices.length + bowBallIndices.length) * 4 }],
  };

  // Pack all data into a single binary buffer
  const totalBytes = (
    hullVertices.length + hullIndices.length +
    rowerVertices.length + rowerIndices.length +
    seatVertices.length + seatIndices.length +
    oarVertices.length + oarIndices.length +
    riggerVertices.length + riggerIndices.length +
    railsVertices.length + railsIndices.length +
    footStretcherVertices.length + footStretcherIndices.length +
    finVertices.length + finIndices.length +
    bowBallVertices.length + bowBallIndices.length
  ) * 4;
  const buffer = Buffer.alloc(totalBytes);
  let offset = 0;

  // Hull vertices
  hullVertices.forEach((v) => { buffer.writeFloatLE(v, offset); offset += 4; });
  // Hull indices
  hullIndices.forEach((i) => { buffer.writeUInt32LE(i, offset); offset += 4; });
  // Rower vertices
  rowerVertices.forEach((v) => { buffer.writeFloatLE(v, offset); offset += 4; });
  // Rower indices
  rowerIndices.forEach((i) => { buffer.writeUInt32LE(i, offset); offset += 4; });
  // Seat vertices
  seatVertices.forEach((v) => { buffer.writeFloatLE(v, offset); offset += 4; });
  // Seat indices
  seatIndices.forEach((i) => { buffer.writeUInt32LE(i, offset); offset += 4; });
  // Oar vertices
  oarVertices.forEach((v) => { buffer.writeFloatLE(v, offset); offset += 4; });
  // Oar indices
  oarIndices.forEach((i) => { buffer.writeUInt32LE(i, offset); offset += 4; });
  // Rigger vertices
  riggerVertices.forEach((v) => { buffer.writeFloatLE(v, offset); offset += 4; });
  // Rigger indices
  riggerIndices.forEach((i) => { buffer.writeUInt32LE(i, offset); offset += 4; });

  // Rails vertices/indices
  railsVertices.forEach((v) => { buffer.writeFloatLE(v, offset); offset += 4; });
  railsIndices.forEach((i) => { buffer.writeUInt32LE(i, offset); offset += 4; });

  // Foot stretcher vertices/indices
  footStretcherVertices.forEach((v) => { buffer.writeFloatLE(v, offset); offset += 4; });
  footStretcherIndices.forEach((i) => { buffer.writeUInt32LE(i, offset); offset += 4; });

  // Fin vertices/indices
  finVertices.forEach((v) => { buffer.writeFloatLE(v, offset); offset += 4; });
  finIndices.forEach((i) => { buffer.writeUInt32LE(i, offset); offset += 4; });

  // Bow ball vertices/indices
  bowBallVertices.forEach((v) => { buffer.writeFloatLE(v, offset); offset += 4; });
  bowBallIndices.forEach((i) => { buffer.writeUInt32LE(i, offset); offset += 4; });

  // Build GLB file (binary glTF)
  const jsonStr = JSON.stringify(gltf);
  const jsonBuffer = Buffer.from(jsonStr, 'utf8');
  const jsonPadded = Buffer.alloc(Math.ceil(jsonBuffer.length / 4) * 4);
  jsonBuffer.copy(jsonPadded);

  const binaryPadded = Buffer.alloc(Math.ceil(buffer.length / 4) * 4);
  buffer.copy(binaryPadded);

  const glbBuffer = Buffer.alloc(12 + 8 + jsonPadded.length + 8 + binaryPadded.length);
  let pos = 0;

  // GLB header
  glbBuffer.writeUInt32LE(0x46546C67, pos); pos += 4; // 'glTF'
  glbBuffer.writeUInt32LE(2, pos); pos += 4; // version
  glbBuffer.writeUInt32LE(glbBuffer.length, pos); pos += 4; // total length

  // JSON chunk
  glbBuffer.writeUInt32LE(jsonPadded.length, pos); pos += 4; // chunk length
  glbBuffer.writeUInt32LE(0x4E4F534A, pos); pos += 4; // 'JSON'
  jsonPadded.copy(glbBuffer, pos); pos += jsonPadded.length;

  // BIN chunk
  glbBuffer.writeUInt32LE(binaryPadded.length, pos); pos += 4; // chunk length
  glbBuffer.writeUInt32LE(0x004E4942, pos); pos += 4; // 'BIN\0'
  binaryPadded.copy(glbBuffer, pos);

  return glbBuffer;
}

// Generate and write the GLB file
const glb = createBoatGLB();
const outputPath = path.join(__dirname, '../public/models/scull.glb');
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, glb);
console.log(`✓ Generated single scull model at ${outputPath} (${glb.length} bytes)`);
