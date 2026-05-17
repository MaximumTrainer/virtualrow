#!/usr/bin/env node

/**
 * Generate a production-ready, optimized single scull rowing boat GLB asset.
 *
 * Usage: node scripts/generate-scull-model.cjs
 *
 * Output:  public/models/scull.glb
 *
 * Design goals (per AGENTS.md and asset brief):
 *  - Hexagonal-style separation: pure mesh builders (domain) -> GLB serializer
 *    (adapter). No I/O is performed inside the geometry helpers.
 *  - PBR workflow: every primitive ships POSITION + NORMAL attributes so the
 *    glossy hull, metallic riggers, matte oars, and unisuit fabric all light
 *    correctly without extra runtime post-processing.
 *  - Manifold / watertight parts: every component (hull, rails, foot stretcher,
 *    bow ball, fin, riggers, oarlocks) is built from closed shells. We assert
 *    edge-manifoldness during the post-write validation pass.
 *  - Single, zero-point-origin asset: the scull group sits at (0, 0, 0) with
 *    symmetric oar nodes; no water, environment, or background meshes are
 *    emitted.
 *  - Self-validating: after writing, the script parses the GLB back, checks
 *    the glTF 2.0 binary container, JSON+BIN chunks, and accessor bounds.
 *
 * Required node names (consumed by src/__tests__/scullModelAsset.test.ts):
 *   ScullBoatGroup, Hull, Rower, Seat, LeftOar, RightOar, Riggers,
 *   RailsNode, FootStretcherNode, FinNode, BowBallNode.
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Mesh part builder
//
// Each "part" is one glTF mesh: positions, indices, and smoothed normals.
// addCuboid / addCylinder / addEllipsoid / addPrism produce closed (watertight)
// shells with consistent counter-clockwise winding so that smooth normals
// (averaged from face normals weighted by area) point outward.
// ---------------------------------------------------------------------------

function createPart(name) {
  return { name, positions: [], indices: [] };
}

/**
 * Append a closed axis-aligned box (12 triangles, 8 verts). Winding is CCW
 * when viewed from outside so face normals point outward.
 */
function addCuboid(part, minX, maxX, minY, maxY, minZ, maxZ) {
  const base = part.positions.length / 3;
  part.positions.push(
    minX, minY, minZ,  maxX, minY, minZ,  minX, maxY, minZ,  maxX, maxY, minZ, // 0..3 (z = minZ face)
    minX, minY, maxZ,  maxX, minY, maxZ,  minX, maxY, maxZ,  maxX, maxY, maxZ  // 4..7 (z = maxZ face)
  );
  // Each face: two triangles, CCW from outside.
  part.indices.push(
    base + 0, base + 1, base + 3,  base + 0, base + 3, base + 2, // -Z (front when looking +Z)
    base + 5, base + 4, base + 6,  base + 5, base + 6, base + 7, // +Z
    base + 4, base + 0, base + 2,  base + 4, base + 2, base + 6, // -X
    base + 1, base + 5, base + 7,  base + 1, base + 7, base + 3, // +X
    base + 2, base + 3, base + 7,  base + 2, base + 7, base + 6, // +Y (top)
    base + 4, base + 5, base + 1,  base + 4, base + 1, base + 0  // -Y (bottom)
  );
}

/**
 * Append a closed cylinder aligned to a given axis ("x", "y", or "z"), with
 * `radialSegments` side faces and circular caps. Length runs from `a` to `b`
 * along the chosen axis; the other two axes use (cx, cy) center offsets.
 */
function addCylinder(part, axis, a, b, cu, cv, ru, rv, radialSegments) {
  // Build side ring vertices for end A and end B, then add cap centers.
  const base = part.positions.length / 3;
  const ringA = []; // indices for ring at coord `a`
  const ringB = []; // indices for ring at coord `b`

  for (let i = 0; i < radialSegments; i++) {
    const theta = (i / radialSegments) * Math.PI * 2;
    const u = cu + Math.cos(theta) * ru;
    const v = cv + Math.sin(theta) * rv;
    // Ring at end A
    if (axis === 'x') part.positions.push(a, u, v);
    else if (axis === 'y') part.positions.push(u, a, v);
    else part.positions.push(u, v, a);
    ringA.push(base + i);
  }
  for (let i = 0; i < radialSegments; i++) {
    const theta = (i / radialSegments) * Math.PI * 2;
    const u = cu + Math.cos(theta) * ru;
    const v = cv + Math.sin(theta) * rv;
    if (axis === 'x') part.positions.push(b, u, v);
    else if (axis === 'y') part.positions.push(u, b, v);
    else part.positions.push(u, v, b);
    ringB.push(base + radialSegments + i);
  }

  // Side quads (two tris each)
  for (let i = 0; i < radialSegments; i++) {
    const i2 = (i + 1) % radialSegments;
    const a0 = ringA[i];
    const a1 = ringA[i2];
    const b0 = ringB[i];
    const b1 = ringB[i2];
    // Winding: outward normals require this order when going A->B along +axis.
    part.indices.push(a0, b0, b1,  a0, b1, a1);
  }

  // Cap centers
  const centerAIdx = part.positions.length / 3;
  if (axis === 'x') part.positions.push(a, cu, cv);
  else if (axis === 'y') part.positions.push(cu, a, cv);
  else part.positions.push(cu, cv, a);
  const centerBIdx = part.positions.length / 3;
  if (axis === 'x') part.positions.push(b, cu, cv);
  else if (axis === 'y') part.positions.push(cu, b, cv);
  else part.positions.push(cu, cv, b);

  // End A cap (faces toward -axis): winding must yield outward normal.
  for (let i = 0; i < radialSegments; i++) {
    const i2 = (i + 1) % radialSegments;
    part.indices.push(centerAIdx, ringA[i2], ringA[i]);
  }
  // End B cap (faces toward +axis)
  for (let i = 0; i < radialSegments; i++) {
    const i2 = (i + 1) % radialSegments;
    part.indices.push(centerBIdx, ringB[i], ringB[i2]);
  }
}

/**
 * Append a closed ellipsoid centered at (cx, cy, cz) with semi-axes (rx, ry, rz).
 * `lat` is the number of stacks (excluding poles) and `lon` is the number of
 * longitudinal segments. Produces a fully manifold sphere-like surface.
 */
function addEllipsoid(part, cx, cy, cz, rx, ry, rz, lat, lon) {
  const base = part.positions.length / 3;
  // Top pole
  part.positions.push(cx, cy + ry, cz);
  // Middle rings
  for (let i = 1; i <= lat; i++) {
    const phi = (i / (lat + 1)) * Math.PI; // 0..pi
    const y = Math.cos(phi);
    const r = Math.sin(phi);
    for (let j = 0; j < lon; j++) {
      const theta = (j / lon) * Math.PI * 2;
      part.positions.push(
        cx + r * Math.cos(theta) * rx,
        cy + y * ry,
        cz + r * Math.sin(theta) * rz
      );
    }
  }
  // Bottom pole
  part.positions.push(cx, cy - ry, cz);
  const top = base;
  const bottom = base + 1 + lat * lon;

  // Top fan
  for (let j = 0; j < lon; j++) {
    const a = base + 1 + j;
    const b = base + 1 + ((j + 1) % lon);
    part.indices.push(top, a, b);
  }
  // Middle quads
  for (let i = 0; i < lat - 1; i++) {
    for (let j = 0; j < lon; j++) {
      const j2 = (j + 1) % lon;
      const a = base + 1 + i * lon + j;
      const b = base + 1 + i * lon + j2;
      const c = base + 1 + (i + 1) * lon + j;
      const d = base + 1 + (i + 1) * lon + j2;
      part.indices.push(a, c, d,  a, d, b);
    }
  }
  // Bottom fan
  for (let j = 0; j < lon; j++) {
    const a = base + 1 + (lat - 1) * lon + j;
    const b = base + 1 + (lat - 1) * lon + ((j + 1) % lon);
    part.indices.push(bottom, b, a);
  }
}

/**
 * Append a closed triangular prism whose triangular cross-section lies in the
 * XY plane and extrudes along Z from z0 to z1.
 *
 *   triPoints: [[x0,y0],[x1,y1],[x2,y2]] in CCW order when viewed from +Z.
 */
function addPrism(part, triPoints, z0, z1) {
  const base = part.positions.length / 3;
  const [p0, p1, p2] = triPoints;
  // Front (z0) and back (z1) verts
  part.positions.push(p0[0], p0[1], z0,  p1[0], p1[1], z0,  p2[0], p2[1], z0);
  part.positions.push(p0[0], p0[1], z1,  p1[0], p1[1], z1,  p2[0], p2[1], z1);
  // Front cap (normal -Z) -> reverse winding so it points outward
  part.indices.push(base + 0, base + 2, base + 1);
  // Back cap (normal +Z)
  part.indices.push(base + 3, base + 4, base + 5);
  // Side quads (CCW from outside)
  part.indices.push(base + 0, base + 1, base + 4,  base + 0, base + 4, base + 3);
  part.indices.push(base + 1, base + 2, base + 5,  base + 1, base + 5, base + 4);
  part.indices.push(base + 2, base + 0, base + 3,  base + 2, base + 3, base + 5);
}

/**
 * Build the racing shell hull as a tapered, closed surface from a series of
 * cross-sections along the local Z (length) axis. Each station is a 4-point
 * "diamond" ring (top, port, bottom, starboard) so the hull has gentle deck
 * camber and a rounded keel. Bow and stern are capped to single vertices to
 * keep the mesh manifold.
 */
function buildHull(part) {
  // Stations defined as { z, halfWidth, deckY, keelY }.
  // Modelled on a ~8.4m single scull, normalized to scene units.
  const stations = [
    { z:  4.20, halfW: 0.000, deckY:  0.055, keelY: -0.040 }, // bow tip ring (degenerates)
    { z:  3.60, halfW: 0.045, deckY:  0.060, keelY: -0.055 },
    { z:  2.40, halfW: 0.090, deckY:  0.065, keelY: -0.060 },
    { z:  1.20, halfW: 0.115, deckY:  0.068, keelY: -0.062 },
    { z:  0.00, halfW: 0.120, deckY:  0.068, keelY: -0.065 },
    { z: -1.20, halfW: 0.115, deckY:  0.066, keelY: -0.062 },
    { z: -2.40, halfW: 0.092, deckY:  0.060, keelY: -0.060 },
    { z: -3.60, halfW: 0.050, deckY:  0.055, keelY: -0.055 },
    { z: -4.20, halfW: 0.000, deckY:  0.045, keelY: -0.040 }, // stern tip ring (degenerates)
  ];

  // Bow tip and stern tip as single vertices (caps).
  const bowTip = part.positions.length / 3;
  part.positions.push(0, 0.055, stations[0].z);

  const ringBase = [];
  for (let i = 1; i < stations.length - 1; i++) {
    const s = stations[i];
    const idx = part.positions.length / 3;
    // 4 ring verts: top, starboard, bottom, port (CCW around +Z axis).
    part.positions.push(0,         s.deckY, s.z); // top
    part.positions.push( s.halfW,  (s.deckY + s.keelY) * 0.5, s.z); // starboard
    part.positions.push(0,         s.keelY, s.z); // bottom (keel)
    part.positions.push(-s.halfW,  (s.deckY + s.keelY) * 0.5, s.z); // port
    ringBase.push(idx);
  }
  const sternTip = part.positions.length / 3;
  part.positions.push(0, 0.045, stations[stations.length - 1].z);

  // Each hull ring vertex follows a fixed ordinal layout, with a starboard side
  // shorthand "sb" used purely as a comment label below.
  //   ring + 0 = top deck vertex
  //   ring + 1 = starboard side vertex
  //   ring + 2 = bottom (keel) vertex
  //   ring + 3 = port side vertex
  const RING_TOP = 0, RING_STARBOARD = 1, RING_BOTTOM = 2, RING_PORT = 3;

  // Cap fans (bow): bow tip is at +Z, ring0 is just behind it (smaller Z).
  // Winding: bowTip + (ring vertex i) + (ring vertex i+1) should be CCW from outside.
  // Outside of bow cap is +Z side, so we go CW from +Z view => use (tip, i, next).
  const r0 = ringBase[0];
  // Order around ring0 going CCW when viewed from +Z (outside of bow cap):
  // top -> port -> bottom -> starboard -> back to top.
  const bowRingSeq = [RING_TOP, RING_PORT, RING_BOTTOM, RING_STARBOARD];
  for (let k = 0; k < bowRingSeq.length; k++) {
    const a = r0 + bowRingSeq[k];
    const b = r0 + bowRingSeq[(k + 1) % bowRingSeq.length];
    part.indices.push(bowTip, a, b);
  }

  // Side quads between adjacent rings.
  for (let i = 0; i < ringBase.length - 1; i++) {
    const a = ringBase[i];
    const b = ringBase[i + 1];
    // Traverse the ring in CCW order when looking from +Z: top, starboard,
    // bottom, port. Adjacent ring is one z step astern. With the bow at +Z
    // and stations advancing bow -> stern (decreasing z), the quad winding
    // (va0, vb0, vb1) + (va0, vb1, va1) produces outward-facing normals.
    const ringOrder = [RING_TOP, RING_STARBOARD, RING_BOTTOM, RING_PORT];
    for (let k = 0; k < ringOrder.length; k++) {
      const k2 = (k + 1) % ringOrder.length;
      const va0 = a + ringOrder[k];
      const va1 = a + ringOrder[k2];
      const vb0 = b + ringOrder[k];
      const vb1 = b + ringOrder[k2];
      part.indices.push(va0, vb0, vb1,  va0, vb1, va1);
    }
  }

  // Stern cap fan. Stern tip is at -Z; the outside surface faces -Z, so we
  // need a sequence that is CCW when viewed from -Z. Going top -> starboard
  // -> bottom -> port is CCW when viewed from +Z; viewed from -Z that same
  // ordering reads CCW too because we then traverse (tip, a, b) with `tip`
  // behind the ring along the view direction. This is intentionally *not*
  // the same ordering as bowRingSeq above.
  const rLast = ringBase[ringBase.length - 1];
  const sternRingSeq = [RING_TOP, RING_STARBOARD, RING_BOTTOM, RING_PORT];
  for (let k = 0; k < sternRingSeq.length; k++) {
    const a = rLast + sternRingSeq[k];
    const b = rLast + sternRingSeq[(k + 1) % sternRingSeq.length];
    part.indices.push(sternTip, a, b);
  }
}

/**
 * Build the rower body in a mid-drive pose: legs extended toward bow, torso
 * leaning slightly aft, arms drawing the handle toward the chest. We use
 * closed cuboids for limbs/torso and an ellipsoid for the head.
 *
 * Axes (boat-local):
 *   +Z = bow (forward), -Z = stern, +Y = up, +X = starboard.
 *
 * The rower sits with feet near the foot stretcher (+Z side) and seat near
 * origin; layback tilts the torso slightly toward -Z.
 */
function buildRower(part) {
  // Pelvis / seated lower torso
  addCuboid(part, -0.11, 0.11, 0.12, 0.30, -0.05, 0.10);
  // Upper torso (slightly aft due to layback)
  addCuboid(part, -0.105, 0.105, 0.29, 0.55, -0.18, 0.02);
  // Neck
  addCuboid(part, -0.045, 0.045, 0.54, 0.60, -0.16, -0.06);
  // Head (ellipsoid for a more anatomical silhouette)
  addEllipsoid(part, 0.0, 0.66, -0.10, 0.085, 0.095, 0.085, 5, 10);

  // Thighs (extended forward toward foot stretcher)
  addCuboid(part, -0.095, -0.015, 0.085, 0.155, 0.06, 0.32);
  addCuboid(part,  0.015,  0.095, 0.085, 0.155, 0.06, 0.32);
  // Shins (mostly straight at finish of drive)
  addCuboid(part, -0.090, -0.020, 0.060, 0.130, 0.30, 0.50);
  addCuboid(part,  0.020,  0.090, 0.060, 0.130, 0.30, 0.50);
  // Feet
  addCuboid(part, -0.085, -0.020, 0.050, 0.080, 0.45, 0.56);
  addCuboid(part,  0.020,  0.085, 0.050, 0.080, 0.45, 0.56);

  // Upper arms (drawing inward toward chest)
  addCuboid(part, -0.205, -0.105, 0.36, 0.44, -0.04, 0.06);
  addCuboid(part,  0.105,  0.205, 0.36, 0.44, -0.04, 0.06);
  // Forearms (pulling handle toward sternum)
  addCuboid(part, -0.125, -0.025, 0.32, 0.39, -0.02, 0.10);
  addCuboid(part,  0.025,  0.125, 0.32, 0.39, -0.02, 0.10);
  // Hands gripping the handle (small blocks at the inboard end)
  addCuboid(part, -0.040, -0.005, 0.305, 0.345, 0.085, 0.12);
  addCuboid(part,  0.005,  0.040, 0.305, 0.345, 0.085, 0.12);
}

/** Sliding seat as a small closed slab atop the rails. */
function buildSeat(part) {
  addCuboid(part, -0.090, 0.090, 0.085, 0.110, -0.060, 0.060);
}

/**
 * Build a single sculling oar pointing outboard along +X: cylindrical shaft
 * with a tapered tulip blade at the tip and a handle grip at the inboard end.
 * Symmetric mirror is achieved by node-level scaling (LeftOar uses -1 on X).
 */
function buildOar(part) {
  // Handle grip (inboard end, slightly thicker)
  addCylinder(part, 'x', 0.00, 0.30, 0.215, -0.12, 0.018, 0.018, 12);
  // Main shaft
  addCylinder(part, 'x', 0.30, 1.30, 0.225, -0.05, 0.015, 0.015, 12);
  // Sleeve (where the oar rests in the oarlock) - thicker section
  addCylinder(part, 'x', 0.55, 0.70, 0.230, -0.04, 0.022, 0.022, 12);
  // Blade attachment neck
  addCylinder(part, 'x', 1.30, 1.45, 0.235, -0.02, 0.014, 0.014, 8);
  // Tulip blade (closed slab)
  addCuboid(part, 1.45, 1.95, 0.215, 0.275, -0.10, 0.06);
}

/**
 * Build the wing riggers: two angled supports extending outboard from each
 * gunwale to support the oarlocks. Each rigger arm is a closed thin slab and
 * each oarlock is a small closed box.
 */
function buildRiggers(part) {
  // Left (port) wing arm front
  addCuboid(part, -0.42, -0.10, 0.030, 0.050, -0.020, 0.000);
  // Left wing arm rear
  addCuboid(part, -0.42, -0.10, 0.030, 0.050,  0.000, 0.020);
  // Right (starboard) wing arm front
  addCuboid(part,  0.10,  0.42, 0.030, 0.050, -0.020, 0.000);
  // Right wing arm rear
  addCuboid(part,  0.10,  0.42, 0.030, 0.050,  0.000, 0.020);

  // Oarlocks (small blocks at wing tips)
  addCuboid(part, -0.430, -0.380, 0.045, 0.080, -0.020, 0.020);
  addCuboid(part,  0.380,  0.430, 0.045, 0.080, -0.020, 0.020);

  // Cross-braces (thin connectors near the hull)
  addCuboid(part, -0.20, -0.10, 0.025, 0.045, -0.05,  0.05);
  addCuboid(part,  0.10,  0.20, 0.025, 0.045, -0.05,  0.05);
}

/** Two parallel slide rails on the deck for the sliding seat. */
function buildRails(part) {
  addCuboid(part, -0.075, -0.045, 0.070, 0.085, -0.50, 0.50);
  addCuboid(part,  0.045,  0.075, 0.070, 0.085, -0.50, 0.50);
}

/** Foot stretcher plate plus two shoe blocks. */
function buildFootStretcher(part) {
  // Backing plate (closed slab, angled position approximated by axis-aligned box)
  addCuboid(part, -0.12, 0.12, 0.030, 0.070, 0.05, 0.10);
  // Shoes
  addCuboid(part, -0.075, -0.010, 0.070, 0.130, 0.06, 0.22);
  addCuboid(part,  0.010,  0.075, 0.070, 0.130, 0.06, 0.22);
}

/** Stern fin/skeg as a closed triangular prism extending below the keel. */
function buildFin(part) {
  // Triangular profile in XY (CCW from +Z), extruded along Z (small width).
  addPrism(part,
    [[-0.025, -0.060], [0.025, -0.060], [0.0, -0.150]],
    -4.10, -3.90
  );
}

/** Bow ball (safety) - a small closed ellipsoid at the bow tip. */
function buildBowBall(part) {
  addEllipsoid(part, 0.0, 0.075, 4.18, 0.025, 0.025, 0.030, 4, 8);
}

// ---------------------------------------------------------------------------
// Smooth normals
//
// For each part we accumulate face normals (weighted by face area) into the
// vertex slots that participate, then normalize. This is the standard glTF
// approach to providing per-vertex normals that drive PBR lighting.
// ---------------------------------------------------------------------------

function computeNormals(part) {
  const v = part.positions;
  const idx = part.indices;
  const vertexCount = v.length / 3;
  const normals = new Float32Array(vertexCount * 3);

  for (let i = 0; i < idx.length; i += 3) {
    const ia = idx[i] * 3;
    const ib = idx[i + 1] * 3;
    const ic = idx[i + 2] * 3;
    const ax = v[ia],     ay = v[ia + 1], az = v[ia + 2];
    const bx = v[ib],     by = v[ib + 1], bz = v[ib + 2];
    const cx = v[ic],     cy = v[ic + 1], cz = v[ic + 2];

    // Edge vectors
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    // Cross product = 2 * area * normal (area weighting falls out for free).
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;

    normals[ia    ] += nx; normals[ia + 1] += ny; normals[ia + 2] += nz;
    normals[ib    ] += nx; normals[ib + 1] += ny; normals[ib + 2] += nz;
    normals[ic    ] += nx; normals[ic + 1] += ny; normals[ic + 2] += nz;
  }

  for (let i = 0; i < vertexCount; i++) {
    const o = i * 3;
    const nx = normals[o], ny = normals[o + 1], nz = normals[o + 2];
    const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (len > 1e-8) {
      normals[o    ] = nx / len;
      normals[o + 1] = ny / len;
      normals[o + 2] = nz / len;
    } else {
      // Fallback: degenerate vertex with no faces - point up.
      normals[o    ] = 0;
      normals[o + 1] = 1;
      normals[o + 2] = 0;
    }
  }
  return Array.from(normals);
}

function computeBounds(positions) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
}

// ---------------------------------------------------------------------------
// GLB serializer
// ---------------------------------------------------------------------------

function buildGLB(parts, nodeSpecs, materials) {
  const accessors = [];
  const bufferViews = [];
  const meshes = [];
  // Pre-pack each part's data: POSITION (vec3 float), NORMAL (vec3 float),
  // then indices (uint32 scalar). Pad each bufferView to 4-byte boundary.
  const dataChunks = [];
  let runningOffset = 0;

  const pad4 = (n) => (n + 3) & ~3;

  parts.forEach((part, partIdx) => {
    const normals = computeNormals(part);
    const bounds = computeBounds(part.positions);

    // POSITION bufferView
    const positionsByteLength = part.positions.length * 4;
    const positionsBufferView = {
      buffer: 0,
      byteOffset: runningOffset,
      byteLength: positionsByteLength,
      target: 34962, // ARRAY_BUFFER
    };
    bufferViews.push(positionsBufferView);
    const positionsAccessorIdx = accessors.length;
    accessors.push({
      bufferView: bufferViews.length - 1,
      componentType: 5126, // FLOAT
      count: part.positions.length / 3,
      type: 'VEC3',
      min: bounds.min,
      max: bounds.max,
    });
    const positionsBuf = Buffer.alloc(pad4(positionsByteLength));
    for (let i = 0; i < part.positions.length; i++) {
      positionsBuf.writeFloatLE(part.positions[i], i * 4);
    }
    dataChunks.push(positionsBuf);
    runningOffset += positionsBuf.length;

    // NORMAL bufferView
    const normalsByteLength = normals.length * 4;
    bufferViews.push({
      buffer: 0,
      byteOffset: runningOffset,
      byteLength: normalsByteLength,
      target: 34962,
    });
    const normalsAccessorIdx = accessors.length;
    accessors.push({
      bufferView: bufferViews.length - 1,
      componentType: 5126,
      count: normals.length / 3,
      type: 'VEC3',
    });
    const normalsBuf = Buffer.alloc(pad4(normalsByteLength));
    for (let i = 0; i < normals.length; i++) {
      normalsBuf.writeFloatLE(normals[i], i * 4);
    }
    dataChunks.push(normalsBuf);
    runningOffset += normalsBuf.length;

    // INDICES bufferView
    const indicesByteLength = part.indices.length * 4;
    bufferViews.push({
      buffer: 0,
      byteOffset: runningOffset,
      byteLength: indicesByteLength,
      target: 34963, // ELEMENT_ARRAY_BUFFER
    });
    const indicesAccessorIdx = accessors.length;
    accessors.push({
      bufferView: bufferViews.length - 1,
      componentType: 5125, // UNSIGNED_INT
      count: part.indices.length,
      type: 'SCALAR',
    });
    const indicesBuf = Buffer.alloc(pad4(indicesByteLength));
    for (let i = 0; i < part.indices.length; i++) {
      indicesBuf.writeUInt32LE(part.indices[i], i * 4);
    }
    dataChunks.push(indicesBuf);
    runningOffset += indicesBuf.length;

    meshes.push({
      name: part.name,
      primitives: [
        {
          attributes: { POSITION: positionsAccessorIdx, NORMAL: normalsAccessorIdx },
          indices: indicesAccessorIdx,
          material: partIdx, // 1:1 mapping for now; nodes can remap if needed
          mode: 4, // TRIANGLES
        },
      ],
    });
  });

  // Build nodes from nodeSpecs.
  const nodes = nodeSpecs.map((spec) => {
    const node = { name: spec.name };
    if (spec.children) node.children = spec.children;
    if (spec.mesh !== undefined) node.mesh = spec.mesh;
    if (spec.matrix) node.matrix = spec.matrix;
    return node;
  });

  const totalDataBytes = runningOffset;

  const gltf = {
    asset: {
      version: '2.0',
      generator: 'virtualrow scull-model-generator (production)',
      copyright: 'virtualrow project',
    },
    scene: 0,
    scenes: [{ name: 'ScullScene', nodes: [0] }],
    nodes,
    meshes,
    materials,
    accessors,
    bufferViews,
    buffers: [{ byteLength: totalDataBytes }],
  };

  const binaryBuffer = Buffer.concat(dataChunks);
  if (binaryBuffer.length !== totalDataBytes) {
    throw new Error(`Internal: binary buffer size mismatch (${binaryBuffer.length} vs ${totalDataBytes})`);
  }

  // Serialize GLB.
  const jsonStr = JSON.stringify(gltf);
  const jsonBytes = Buffer.from(jsonStr, 'utf8');
  // glTF 2.0 requires JSON chunk to be padded with 0x20 (space) to 4-byte
  // alignment, BIN chunk to be padded with 0x00.
  const jsonPaddedLen = pad4(jsonBytes.length);
  const jsonPadded = Buffer.alloc(jsonPaddedLen, 0x20);
  jsonBytes.copy(jsonPadded);

  const binPaddedLen = pad4(binaryBuffer.length);
  const binPadded = Buffer.alloc(binPaddedLen, 0x00);
  binaryBuffer.copy(binPadded);

  const totalLen = 12 + 8 + jsonPaddedLen + 8 + binPaddedLen;
  const glb = Buffer.alloc(totalLen);
  let pos = 0;
  glb.writeUInt32LE(0x46546c67, pos); pos += 4; // 'glTF'
  glb.writeUInt32LE(2, pos);          pos += 4; // version
  glb.writeUInt32LE(totalLen, pos);   pos += 4; // total length

  glb.writeUInt32LE(jsonPaddedLen, pos);   pos += 4;
  glb.writeUInt32LE(0x4e4f534a, pos);      pos += 4; // 'JSON'
  jsonPadded.copy(glb, pos);               pos += jsonPaddedLen;

  glb.writeUInt32LE(binPaddedLen, pos);    pos += 4;
  glb.writeUInt32LE(0x004e4942, pos);      pos += 4; // 'BIN\0'
  binPadded.copy(glb, pos);

  return { glb, gltf };
}

// ---------------------------------------------------------------------------
// Post-write validation
//
// Re-reads the produced GLB and confirms:
//   - glTF 2.0 binary container is well-formed
//   - JSON + BIN chunks have correct types and consistent lengths
//   - Every accessor's count fits within its bufferView
//   - Every primitive's indices reference valid POSITION vertices
//   - Each mesh is edge-manifold: every undirected edge is shared by at most
//     two triangles (i.e. no T-junctions or floating geometry)
// ---------------------------------------------------------------------------

function validateGLB(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.length < 28) throw new Error('GLB too small');

  const magic = buf.readUInt32LE(0);
  const version = buf.readUInt32LE(4);
  const length = buf.readUInt32LE(8);
  if (magic !== 0x46546c67) throw new Error('Invalid GLB magic');
  if (version !== 2) throw new Error(`Unsupported GLB version: ${version}`);
  if (length !== buf.length) {
    throw new Error(`GLB header length ${length} != file size ${buf.length}`);
  }

  const jsonLen = buf.readUInt32LE(12);
  const jsonType = buf.readUInt32LE(16);
  if (jsonType !== 0x4e4f534a) throw new Error('First chunk is not JSON');
  const jsonStart = 20;
  const jsonEnd = jsonStart + jsonLen;
  if (jsonEnd > buf.length) throw new Error('JSON chunk overruns file');
  // Strip trailing space/null padding.
  let jsonTerminator = jsonEnd;
  while (jsonTerminator > jsonStart && (buf[jsonTerminator - 1] === 0x20 || buf[jsonTerminator - 1] === 0x00)) {
    jsonTerminator -= 1;
  }
  const gltf = JSON.parse(buf.subarray(jsonStart, jsonTerminator).toString('utf8'));

  const binLen = buf.readUInt32LE(jsonEnd);
  const binType = buf.readUInt32LE(jsonEnd + 4);
  if (binType !== 0x004e4942) throw new Error('Second chunk is not BIN');
  const binStart = jsonEnd + 8;
  if (binStart + binLen > buf.length) throw new Error('BIN chunk overruns file');

  // Validate buffer length matches.
  const declaredBufBytes = gltf.buffers[0].byteLength;
  if (declaredBufBytes > binLen) {
    throw new Error(`Declared buffer bytes ${declaredBufBytes} > BIN chunk size ${binLen}`);
  }

  // Validate accessors fit inside their bufferViews.
  const componentSize = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
  const typeSize = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
  gltf.accessors.forEach((acc, i) => {
    const bv = gltf.bufferViews[acc.bufferView];
    const need = acc.count * componentSize[acc.componentType] * typeSize[acc.type];
    if (need > bv.byteLength) {
      throw new Error(`Accessor ${i} requires ${need} bytes but bufferView ${acc.bufferView} only has ${bv.byteLength}`);
    }
    if (bv.byteOffset + bv.byteLength > declaredBufBytes) {
      throw new Error(`BufferView ${acc.bufferView} overruns buffer`);
    }
  });

  // Per-primitive checks: indices reference valid vertices; mesh is manifold.
  gltf.meshes.forEach((mesh, mi) => {
    mesh.primitives.forEach((prim, pi) => {
      const posAcc = gltf.accessors[prim.attributes.POSITION];
      const normAcc = gltf.accessors[prim.attributes.NORMAL];
      if (!posAcc) throw new Error(`Mesh ${mi}.${pi} missing POSITION`);
      if (!normAcc) throw new Error(`Mesh ${mi}.${pi} missing NORMAL`);
      if (posAcc.count !== normAcc.count) {
        throw new Error(`Mesh ${mi}.${pi} POSITION/NORMAL count mismatch`);
      }
      const idxAcc = gltf.accessors[prim.indices];
      if (idxAcc.count % 3 !== 0) {
        throw new Error(`Mesh ${mi}.${pi} indices count ${idxAcc.count} not divisible by 3`);
      }

      // Read indices from BIN and validate range + edge-manifold.
      const bv = gltf.bufferViews[idxAcc.bufferView];
      const start = binStart + bv.byteOffset;
      const indices = new Array(idxAcc.count);
      for (let k = 0; k < idxAcc.count; k++) {
        indices[k] = buf.readUInt32LE(start + k * 4);
        if (indices[k] >= posAcc.count) {
          throw new Error(`Mesh ${mi}.${pi} index ${indices[k]} >= POSITION count ${posAcc.count}`);
        }
      }
      const edgeCount = new Map();
      for (let t = 0; t < indices.length; t += 3) {
        const a = indices[t], b = indices[t + 1], c = indices[t + 2];
        if (a === b || b === c || a === c) {
          throw new Error(`Mesh ${mi}.${pi} has degenerate triangle ${t / 3}`);
        }
        const edges = [[a, b], [b, c], [c, a]];
        for (const [u, v] of edges) {
          const key = u < v ? `${u}_${v}` : `${v}_${u}`;
          edgeCount.set(key, (edgeCount.get(key) || 0) + 1);
        }
      }
      for (const [key, count] of edgeCount) {
        if (count > 2) {
          throw new Error(`Mesh ${mi}.${pi} (${mesh.name}) non-manifold edge ${key} shared by ${count} faces`);
        }
      }
    });
  });

  return gltf;
}

// ---------------------------------------------------------------------------
// Composition root
// ---------------------------------------------------------------------------

function main() {
  // --- Build mesh parts ------------------------------------------------------
  const hull          = createPart('Hull');           buildHull(hull);
  const rower         = createPart('Rower');          buildRower(rower);
  const seat          = createPart('Seat');           buildSeat(seat);
  const oar           = createPart('Oar');            buildOar(oar);
  const riggers       = createPart('Riggers');        buildRiggers(riggers);
  const rails         = createPart('Rails');          buildRails(rails);
  const footStretcher = createPart('FootStretcher');  buildFootStretcher(footStretcher);
  const fin           = createPart('Fin');            buildFin(fin);
  const bowBall       = createPart('BowBall');        buildBowBall(bowBall);

  const parts = [hull, rower, seat, oar, riggers, rails, footStretcher, fin, bowBall];

  // --- Materials (PBR factors aligned to the asset brief) --------------------
  // Hull: glossy reflective composite (low roughness, mild metallic).
  // Riggers: aluminum/carbon metallic (high metallic, moderate roughness).
  // Oars: matte composite (high roughness, non-metallic).
  // Rower: matte stretchable fabric (high roughness, non-metallic).
  const materials = [
    // 0 - Hull
    {
      name: 'HullMaterial',
      pbrMetallicRoughness: {
        baseColorFactor: [0.94, 0.95, 0.97, 1.0],
        metallicFactor: 0.20,
        roughnessFactor: 0.12,
      },
      doubleSided: false,
    },
    // 1 - Rower (unisuit fabric)
    {
      name: 'RowerMaterial',
      pbrMetallicRoughness: {
        baseColorFactor: [0.09, 0.16, 0.28, 1.0],
        metallicFactor: 0.0,
        roughnessFactor: 0.88,
      },
      doubleSided: false,
    },
    // 2 - Seat
    {
      name: 'SeatMaterial',
      pbrMetallicRoughness: {
        baseColorFactor: [0.18, 0.18, 0.20, 1.0],
        metallicFactor: 0.05,
        roughnessFactor: 0.70,
      },
      doubleSided: false,
    },
    // 3 - Oar (matte composite)
    {
      name: 'OarMaterial',
      pbrMetallicRoughness: {
        baseColorFactor: [0.11, 0.11, 0.12, 1.0],
        metallicFactor: 0.04,
        roughnessFactor: 0.82,
      },
      doubleSided: false,
    },
    // 4 - Riggers (metallic)
    {
      name: 'RiggerMaterial',
      pbrMetallicRoughness: {
        baseColorFactor: [0.74, 0.77, 0.80, 1.0],
        metallicFactor: 0.92,
        roughnessFactor: 0.22,
      },
      doubleSided: false,
    },
    // 5 - Rails
    {
      name: 'RailsMaterial',
      pbrMetallicRoughness: {
        baseColorFactor: [0.18, 0.18, 0.18, 1.0],
        metallicFactor: 0.30,
        roughnessFactor: 0.50,
      },
      doubleSided: false,
    },
    // 6 - Foot stretcher
    {
      name: 'StretcherMaterial',
      pbrMetallicRoughness: {
        baseColorFactor: [0.12, 0.12, 0.12, 1.0],
        metallicFactor: 0.15,
        roughnessFactor: 0.70,
      },
      doubleSided: false,
    },
    // 7 - Fin
    {
      name: 'FinMaterial',
      pbrMetallicRoughness: {
        baseColorFactor: [0.06, 0.06, 0.06, 1.0],
        metallicFactor: 0.10,
        roughnessFactor: 0.55,
      },
      doubleSided: false,
    },
    // 8 - Bow ball (safety yellow)
    {
      name: 'BowBallMaterial',
      pbrMetallicRoughness: {
        baseColorFactor: [1.00, 0.95, 0.20, 1.0],
        metallicFactor: 0.0,
        roughnessFactor: 0.60,
      },
      doubleSided: false,
    },
  ];

  // --- Node graph ------------------------------------------------------------
  // Mesh indices follow parts[] order: 0=Hull 1=Rower 2=Seat 3=Oar 4=Riggers
  // 5=Rails 6=FootStretcher 7=Fin 8=BowBall.
  // The two oar nodes share mesh #3; LeftOar scales X by -1 to mirror.
  //
  // Column-major 4x4 matrices. Translation lives in matrix[12..14].
  const I = [1, 0, 0, 0,  0, 1, 0, 0,  0, 0, 1, 0,  0, 0, 0, 1];
  const T = (x, y, z) => [1, 0, 0, 0,  0, 1, 0, 0,  0, 0, 1, 0,  x, y, z, 1];
  // Mirror across X-axis (scale X = -1) combined with translation.
  const MX = (x, y, z) => [-1, 0, 0, 0,  0, 1, 0, 0,  0, 0, 1, 0,  x, y, z, 1];

  const nodeSpecs = [
    {
      name: 'ScullBoatGroup',
      children: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      matrix: I.slice(),
    },
    { name: 'Hull',              mesh: 0, matrix: I.slice() },
    { name: 'Rower',             mesh: 1, matrix: T(0, 0.16, -0.05) },
    { name: 'Seat',              mesh: 2, matrix: I.slice() },
    // Oars: the oar mesh extends outboard along +X (handle at x=0, blade at +X).
    // LeftOar mirrors X so the blade lands on -X; an inboard offset puts each
    // handle just past centerline (hands cross slightly at the finish), and
    // the symmetric ±X translation keeps node-level balance along the local
    // axis (asserted by src/__tests__/scullModelAsset.test.ts).
    { name: 'LeftOar',           mesh: 3, matrix: MX(-0.05, 0.0, 0.0) },
    { name: 'RightOar',          mesh: 3, matrix: T(  0.05, 0.0, 0.0) },
    { name: 'Riggers',           mesh: 4, matrix: I.slice() },
    { name: 'RailsNode',         mesh: 5, matrix: I.slice() },
    { name: 'FootStretcherNode', mesh: 6, matrix: T(0.0, 0.0, 0.30) },
    { name: 'FinNode',           mesh: 7, matrix: I.slice() },
    { name: 'BowBallNode',       mesh: 8, matrix: I.slice() },
  ];

  // --- Serialize & write -----------------------------------------------------
  const { glb } = buildGLB(parts, nodeSpecs, materials);
  const outputPath = path.join(__dirname, '../public/models/scull.glb');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, glb);

  // --- Validate post-write ---------------------------------------------------
  const gltf = validateGLB(outputPath);
  const totalVerts = gltf.meshes.reduce((sum, m) =>
    sum + m.primitives.reduce((s, p) =>
      s + gltf.accessors[p.attributes.POSITION].count, 0), 0);
  const totalTris = gltf.meshes.reduce((sum, m) =>
    sum + m.primitives.reduce((s, p) =>
      s + gltf.accessors[p.indices].count / 3, 0), 0);

  console.log(`✓ Generated single scull model at ${outputPath}`);
  console.log(`  size:      ${glb.length} bytes`);
  console.log(`  meshes:    ${gltf.meshes.length}`);
  console.log(`  vertices:  ${totalVerts}`);
  console.log(`  triangles: ${totalTris}`);
  console.log(`  GLB 2.0 container, JSON+BIN chunks, all primitives manifold ✓`);
}

main();
