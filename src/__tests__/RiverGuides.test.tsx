import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import * as THREE from 'three';
import { RiverGuides } from '../components/rower3d/RiverGuides';

/**
 * The component is thin — the geometry it draws is tested in
 * riverGuideGeometry.test.ts — but two things about it matter and are cheap to
 * assert: it draws nothing without a route, and it draws exactly three lines
 * with one (a centreline and two edges).
 *
 * R3F intrinsics render as unknown elements under jsdom, which is enough to
 * count them without a WebGL context.
 */
const curve = new THREE.CatmullRomCurve3([
  new THREE.Vector3(0, 0, -100),
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(0, 0, 100),
]);

describe('RiverGuides', () => {
  it('draws nothing without a route', () => {
    const { container } = render(<RiverGuides curve={null} />);

    expect(container.innerHTML).toBe('');
  });

  it('draws nothing when the route has no curve', () => {
    const { container } = render(<RiverGuides curve={undefined} />);

    expect(container.innerHTML).toBe('');
  });

  it('draws a centreline and two edges', () => {
    const { container } = render(<RiverGuides curve={curve} />);

    const primitives = container.querySelectorAll('primitive');
    expect(primitives.length).toBe(3);
  });


});
