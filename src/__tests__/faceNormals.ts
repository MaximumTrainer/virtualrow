import * as THREE from 'three';

/**
 * Which way each triangle of a strip faces.
 *
 * Winding is not decoration: a material that culls back faces draws nothing at
 * all where the winding is wrong, and `computeVertexNormals` lights such a
 * surface from underneath. Both banks and the water channel are built as
 * mirrored strips, which is exactly the shape that gets this wrong — mirroring
 * a triangle reverses which way it faces, so the two sides cannot share an
 * index order (#269, #284).
 *
 * Read off the index buffer and the positions, so it judges the geometry rather
 * than the normal attribute the builder happens to have written.
 */
export const faceNormals = (geometry: THREE.BufferGeometry): THREE.Vector3[] => {
  const position = geometry.getAttribute('position');
  const index = geometry.getIndex();
  if (!index) throw new Error('the strip geometry is expected to be indexed');

  const normals: THREE.Vector3[] = [];
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i < index.count; i += 3) {
    a.fromBufferAttribute(position, index.getX(i));
    b.fromBufferAttribute(position, index.getX(i + 1));
    c.fromBufferAttribute(position, index.getX(i + 2));
    // Three winds counter-clockwise, so (b-a) x (c-a) points out of the face.
    normals.push(
      new THREE.Vector3()
        .subVectors(b, a)
        .cross(new THREE.Vector3().subVectors(c, a))
        .normalize(),
    );
  }
  return normals;
};

/** How many of a strip's triangles point away from the sky. */
export const facingAway = (geometry: THREE.BufferGeometry): number =>
  faceNormals(geometry).filter((n) => n.y <= 0).length;
