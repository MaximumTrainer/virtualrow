#!/usr/bin/env node

/**
 * Generate VirtualRow environment assets as a single GLB kit.
 * Includes: riverbed, water surface, riverbanks, trees, buildings, bridge, dock, and buoys.
 *
 * Usage: node scripts/generate-environment-assets.cjs
 */

const fs = require('fs');
const path = require('path');
const THREE = require('three');

const identityMatrix = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

const materialLibrary = [
  {
    name: 'WaterMaterial',
    pbrMetallicRoughness: {
      baseColorFactor: [0.19, 0.46, 0.64, 0.9],
      metallicFactor: 0.02,
      roughnessFactor: 0.12,
    },
    doubleSided: true,
    alphaMode: 'BLEND',
  },
  {
    name: 'RiverbankSoil',
    pbrMetallicRoughness: {
      baseColorFactor: [0.29, 0.35, 0.18, 1.0],
      metallicFactor: 0.0,
      roughnessFactor: 0.94,
    },
  },
  {
    name: 'BarkMaterial',
    pbrMetallicRoughness: {
      baseColorFactor: [0.24, 0.15, 0.08, 1.0],
      metallicFactor: 0.0,
      roughnessFactor: 0.92,
    },
  },
  {
    name: 'FoliageMaterial',
    pbrMetallicRoughness: {
      baseColorFactor: [0.15, 0.34, 0.19, 1.0],
      metallicFactor: 0.0,
      roughnessFactor: 0.86,
    },
  },
  {
    name: 'BuildingConcrete',
    pbrMetallicRoughness: {
      baseColorFactor: [0.65, 0.68, 0.71, 1.0],
      metallicFactor: 0.05,
      roughnessFactor: 0.66,
    },
  },
  {
    name: 'BuildingGlass',
    pbrMetallicRoughness: {
      baseColorFactor: [0.57, 0.75, 0.86, 0.85],
      metallicFactor: 0.0,
      roughnessFactor: 0.18,
    },
    alphaMode: 'BLEND',
  },
  {
    name: 'BridgeSteel',
    pbrMetallicRoughness: {
      baseColorFactor: [0.35, 0.37, 0.39, 1.0],
      metallicFactor: 0.72,
      roughnessFactor: 0.31,
    },
  },
  {
    name: 'PaintMarker',
    pbrMetallicRoughness: {
      baseColorFactor: [0.86, 0.25, 0.2, 1.0],
      metallicFactor: 0.0,
      roughnessFactor: 0.58,
    },
  },
  {
    name: 'DockWood',
    pbrMetallicRoughness: {
      baseColorFactor: [0.45, 0.32, 0.2, 1.0],
      metallicFactor: 0.0,
      roughnessFactor: 0.88,
    },
  },
];

function toFloatArray(attribute) {
  return new Float32Array(attribute.array);
}

function toUint32Indices(indexAttribute) {
  if (!indexAttribute) return null;
  return new Uint32Array(indexAttribute.array);
}

function computeMinMax(positions) {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];

    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }

  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
  };
}

function addMeshPart(parts, {
  name,
  geometry,
  material,
  matrix = identityMatrix,
}) {
  geometry.computeVertexNormals();
  const pos = toFloatArray(geometry.getAttribute('position'));
  const norm = toFloatArray(geometry.getAttribute('normal'));
  const index = toUint32Indices(geometry.getIndex());

  if (!index) {
    throw new Error(`Geometry for ${name} must be indexed.`);
  }

  const bounds = computeMinMax(pos);

  parts.push({
    name,
    positions: pos,
    normals: norm,
    indices: index,
    material,
    matrix,
    min: bounds.min,
    max: bounds.max,
  });
}

function translationMatrix(x, y, z) {
  return [
    1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 1, 0,
    x, y, z, 1,
  ];
}

function createEnvironmentParts() {
  const parts = [];

  // Riverbed + water + banks as modular strip.
  addMeshPart(parts, {
    name: 'Riverbed',
    geometry: new THREE.BoxGeometry(28, 0.8, 140),
    material: 1,
    matrix: translationMatrix(-75, -0.5, 0),
  });

  addMeshPart(parts, {
    name: 'WaterSurface',
    geometry: new THREE.PlaneGeometry(16, 140, 8, 32),
    material: 0,
    matrix: [
      1, 0, 0, 0,
      0, 0, -1, 0,
      0, 1, 0, 0,
      -75, -0.05, 0, 1,
    ],
  });

  addMeshPart(parts, {
    name: 'RiverbankLeft',
    geometry: new THREE.BoxGeometry(6, 1.2, 140),
    material: 1,
    matrix: translationMatrix(-86, -0.1, 0),
  });

  addMeshPart(parts, {
    name: 'RiverbankRight',
    geometry: new THREE.BoxGeometry(6, 1.2, 140),
    material: 1,
    matrix: translationMatrix(-64, -0.1, 0),
  });

  // Tree kit piece (trunk + 2 foliage cones).
  addMeshPart(parts, {
    name: 'TreeTrunk',
    geometry: new THREE.CylinderGeometry(0.22, 0.28, 3.2, 10, 1, false),
    material: 2,
    matrix: translationMatrix(-35, 1.6, -20),
  });

  addMeshPart(parts, {
    name: 'TreeCanopyLower',
    geometry: new THREE.ConeGeometry(1.9, 3.6, 12, 1, false),
    material: 3,
    matrix: translationMatrix(-35, 4.0, -20),
  });

  addMeshPart(parts, {
    name: 'TreeCanopyUpper',
    geometry: new THREE.ConeGeometry(1.35, 2.9, 12, 1, false),
    material: 3,
    matrix: translationMatrix(-35, 5.7, -20),
  });

  // Mid-rise building kit piece (core + roof + glass strip).
  addMeshPart(parts, {
    name: 'BuildingCore',
    geometry: new THREE.BoxGeometry(8, 14, 6),
    material: 4,
    matrix: translationMatrix(0, 7.0, -15),
  });

  addMeshPart(parts, {
    name: 'BuildingRoof',
    geometry: new THREE.BoxGeometry(8.4, 0.6, 6.4),
    material: 6,
    matrix: translationMatrix(0, 14.3, -15),
  });

  addMeshPart(parts, {
    name: 'BuildingWindowBand',
    geometry: new THREE.BoxGeometry(0.08, 11.5, 4.8),
    material: 5,
    matrix: translationMatrix(4.05, 7.0, -15),
  });

  // Bridge kit piece (deck + pylons + arch).
  addMeshPart(parts, {
    name: 'BridgeDeck',
    geometry: new THREE.BoxGeometry(24, 0.9, 4.2),
    material: 6,
    matrix: translationMatrix(40, 5.0, -10),
  });

  addMeshPart(parts, {
    name: 'BridgePylonLeft',
    geometry: new THREE.BoxGeometry(1.4, 8.0, 1.4),
    material: 6,
    matrix: translationMatrix(30, 2.0, -10),
  });

  addMeshPart(parts, {
    name: 'BridgePylonRight',
    geometry: new THREE.BoxGeometry(1.4, 8.0, 1.4),
    material: 6,
    matrix: translationMatrix(50, 2.0, -10),
  });

  addMeshPart(parts, {
    name: 'BridgeArch',
    geometry: new THREE.TorusGeometry(10.0, 0.18, 8, 24, Math.PI),
    material: 6,
    matrix: [
      1, 0, 0, 0,
      0, 0, -1, 0,
      0, 1, 0, 0,
      40, 4.8, -10, 1,
    ],
  });

  // Dock + buoy props.
  addMeshPart(parts, {
    name: 'DockPlatform',
    geometry: new THREE.BoxGeometry(12, 0.5, 4),
    material: 8,
    matrix: translationMatrix(72, 0.4, -6),
  });

  addMeshPart(parts, {
    name: 'DockPostA',
    geometry: new THREE.CylinderGeometry(0.2, 0.24, 3.0, 8),
    material: 8,
    matrix: translationMatrix(67, -1.0, -7.5),
  });

  addMeshPart(parts, {
    name: 'DockPostB',
    geometry: new THREE.CylinderGeometry(0.2, 0.24, 3.0, 8),
    material: 8,
    matrix: translationMatrix(77, -1.0, -7.5),
  });

  addMeshPart(parts, {
    name: 'DockPostC',
    geometry: new THREE.CylinderGeometry(0.2, 0.24, 3.0, 8),
    material: 8,
    matrix: translationMatrix(67, -1.0, -4.5),
  });

  addMeshPart(parts, {
    name: 'DockPostD',
    geometry: new THREE.CylinderGeometry(0.2, 0.24, 3.0, 8),
    material: 8,
    matrix: translationMatrix(77, -1.0, -4.5),
  });

  addMeshPart(parts, {
    name: 'BuoyBase',
    geometry: new THREE.CylinderGeometry(0.35, 0.4, 0.8, 12),
    material: 7,
    matrix: translationMatrix(94, 0.25, -10),
  });

  addMeshPart(parts, {
    name: 'BuoyTop',
    geometry: new THREE.ConeGeometry(0.28, 0.55, 12),
    material: 7,
    matrix: translationMatrix(94, 0.92, -10),
  });

  return parts;
}

function align4(value) {
  return Math.ceil(value / 4) * 4;
}

function createEnvironmentGLB() {
  const parts = createEnvironmentParts();

  const gltf = {
    asset: { version: '2.0', generator: 'virtualrow-environment-generator' },
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{
      name: 'VirtualRowEnvironmentKit',
      children: parts.map((_, i) => i + 1),
      matrix: identityMatrix,
    }],
    meshes: [],
    materials: materialLibrary,
    accessors: [],
    bufferViews: [],
    buffers: [{ byteLength: 0 }],
  };

  const binaryChunks = [];
  let byteOffset = 0;

  for (const part of parts) {
    const meshIndex = gltf.meshes.length;

    const posBytes = Buffer.from(part.positions.buffer);
    const posOffset = byteOffset;
    byteOffset += posBytes.byteLength;
    const posPadding = align4(byteOffset) - byteOffset;
    byteOffset = align4(byteOffset);

    const normalBytes = Buffer.from(part.normals.buffer);
    const normalOffset = byteOffset;
    byteOffset += normalBytes.byteLength;
    const normalPadding = align4(byteOffset) - byteOffset;
    byteOffset = align4(byteOffset);

    const indexBytes = Buffer.from(part.indices.buffer);
    const indexOffset = byteOffset;
    byteOffset += indexBytes.byteLength;
    const indexPadding = align4(byteOffset) - byteOffset;
    byteOffset = align4(byteOffset);

    binaryChunks.push(posBytes);
    if (posPadding > 0) binaryChunks.push(Buffer.alloc(posPadding));

    binaryChunks.push(normalBytes);
    if (normalPadding > 0) binaryChunks.push(Buffer.alloc(normalPadding));

    binaryChunks.push(indexBytes);
    if (indexPadding > 0) binaryChunks.push(Buffer.alloc(indexPadding));

    const positionView = gltf.bufferViews.length;
    gltf.bufferViews.push({
      buffer: 0,
      byteOffset: posOffset,
      byteLength: posBytes.byteLength,
      target: 34962,
    });

    const normalView = gltf.bufferViews.length;
    gltf.bufferViews.push({
      buffer: 0,
      byteOffset: normalOffset,
      byteLength: normalBytes.byteLength,
      target: 34962,
    });

    const indexView = gltf.bufferViews.length;
    gltf.bufferViews.push({
      buffer: 0,
      byteOffset: indexOffset,
      byteLength: indexBytes.byteLength,
      target: 34963,
    });

    const positionAccessor = gltf.accessors.length;
    gltf.accessors.push({
      bufferView: positionView,
      componentType: 5126,
      count: part.positions.length / 3,
      type: 'VEC3',
      min: part.min,
      max: part.max,
    });

    const normalAccessor = gltf.accessors.length;
    gltf.accessors.push({
      bufferView: normalView,
      componentType: 5126,
      count: part.normals.length / 3,
      type: 'VEC3',
    });

    const indexAccessor = gltf.accessors.length;
    gltf.accessors.push({
      bufferView: indexView,
      componentType: 5125,
      count: part.indices.length,
      type: 'SCALAR',
    });

    gltf.meshes.push({
      name: part.name,
      primitives: [{
        attributes: {
          POSITION: positionAccessor,
          NORMAL: normalAccessor,
        },
        indices: indexAccessor,
        material: part.material,
        mode: 4,
      }],
    });

    gltf.nodes.push({
      name: part.name,
      mesh: meshIndex,
      matrix: part.matrix,
    });
  }

  const binaryBuffer = Buffer.concat(binaryChunks);
  gltf.buffers[0].byteLength = binaryBuffer.byteLength;

  const jsonBuffer = Buffer.from(JSON.stringify(gltf), 'utf8');
  const jsonPadded = Buffer.alloc(align4(jsonBuffer.byteLength), 0x20);
  jsonBuffer.copy(jsonPadded);

  const binPadded = Buffer.alloc(align4(binaryBuffer.byteLength));
  binaryBuffer.copy(binPadded);

  const totalLength = 12 + 8 + jsonPadded.byteLength + 8 + binPadded.byteLength;
  const glbBuffer = Buffer.alloc(totalLength);

  let offset = 0;

  // Header
  glbBuffer.writeUInt32LE(0x46546c67, offset); offset += 4; // glTF
  glbBuffer.writeUInt32LE(2, offset); offset += 4; // version
  glbBuffer.writeUInt32LE(totalLength, offset); offset += 4;

  // JSON chunk
  glbBuffer.writeUInt32LE(jsonPadded.byteLength, offset); offset += 4;
  glbBuffer.writeUInt32LE(0x4E4F534A, offset); offset += 4; // JSON
  jsonPadded.copy(glbBuffer, offset); offset += jsonPadded.byteLength;

  // BIN chunk
  glbBuffer.writeUInt32LE(binPadded.byteLength, offset); offset += 4;
  glbBuffer.writeUInt32LE(0x004E4942, offset); offset += 4; // BIN\0
  binPadded.copy(glbBuffer, offset);

  return glbBuffer;
}

const glb = createEnvironmentGLB();
const outputPath = path.join(__dirname, '../public/models/virtualrow-environment.glb');
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, glb);

console.log(`✓ Generated VirtualRow environment kit at ${outputPath} (${glb.length} bytes)`);
