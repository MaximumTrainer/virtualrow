import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { createBankGeometry } from '../components/rower3d/bankGeometry';

const straightCurve = () =>
  new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, -50),
    new THREE.Vector3(0, 0, -100),
    new THREE.Vector3(0, 0, -150),
  ]);

describe('bank shoreDist attribute (#353)', () => {
  it('the attribute is present with the right cardinality', () => {
    const geo = createBankGeometry(straightCurve(), 'left');
    const attr = geo.getAttribute('shoreDist') as THREE.BufferAttribute;
    expect(attr).toBeDefined();
    expect(attr.itemSize).toBe(1);
    const positions = geo.getAttribute('position') as THREE.BufferAttribute;
    expect(attr.count).toBe(positions.count);
  });

  it('the inner-edge vertices sit at shoreDist 0', () => {
    // The strip is built as pairs (inner, outer) per sample: even indices are
    // the inner edge — the waterline — and must all be 0.
    const geo = createBankGeometry(straightCurve(), 'left');
    const attr = geo.getAttribute('shoreDist') as THREE.BufferAttribute;
    for (let i = 0; i < attr.count; i += 2) {
      expect(attr.getX(i)).toBe(0);
    }
  });

  it('the outer-edge vertices sit further from the waterline than the inner ones', () => {
    // Monotonic outward: odd indices (outer edge) carry positive distances.
    const geo = createBankGeometry(straightCurve(), 'left');
    const attr = geo.getAttribute('shoreDist') as THREE.BufferAttribute;
    for (let i = 1; i < attr.count; i += 2) {
      expect(attr.getX(i)).toBeGreaterThan(0);
    }
  });
});
