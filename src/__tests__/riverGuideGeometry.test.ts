import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildRiverGuides, guideLine, GUIDE_COLOURS } from '../components/rower3d/riverGuideGeometry';

/**
 * The boat looked off centre in the channel on every route, and there was no
 * way to see whether it actually was: the water renders close to white, so the
 * far bank is invisible and only the near one reads. These guides draw the
 * centreline and the two water edges so the question can be answered by
 * looking, rather than argued from screenshots.
 */
const straight = new THREE.CatmullRomCurve3([
  new THREE.Vector3(0, 0, -100),
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(0, 0, 100),
]);

describe('buildRiverGuides', () => {
  it('puts the centreline on the curve itself', () => {
    const { centre } = buildRiverGuides(straight);

    expect(centre.length).toBeGreaterThan(1);
    for (const p of centre) {
      expect(Math.abs(p.x)).toBeLessThan(0.001);
    }
  });

  it('places the two edges symmetrically either side', () => {
    const { left, right } = buildRiverGuides(straight);

    expect(left.length).toBe(right.length);
    for (let i = 0; i < left.length; i += 1) {
      // Equal and opposite about the centreline, which is the whole question
      // the guides exist to answer.
      expect(left[i].x).toBeCloseTo(-right[i].x, 4);
      expect(Math.abs(left[i].x)).toBeGreaterThan(0);
    }
  });

  it('follows a bend rather than staying straight', () => {
    const bend = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0, 0, -100),
      new THREE.Vector3(40, 0, 0),
      new THREE.Vector3(0, 0, 100),
    ]);

    const { centre } = buildRiverGuides(bend);
    const xs = centre.map((p) => p.x);

    expect(Math.max(...xs)).toBeGreaterThan(5);
  });

  it('returns nothing without a curve', () => {
    const guides = buildRiverGuides(null);

    expect(guides.centre).toEqual([]);
    expect(guides.left).toEqual([]);
    expect(guides.right).toEqual([]);
  });

  it('names the colours the guides are drawn in', () => {
    // Yellow down the middle, red at the edges — stated here so a change of
    // mind has to change a test rather than just a literal in the scene.
    expect(GUIDE_COLOURS.centre).toBe('#ffd400');
    expect(GUIDE_COLOURS.edge).toBe('#ff2d2d');
  });
});

describe('guideLine', () => {
  it('draws over the water rather than inside it', () => {
    // A guide buried in the water surface answers nothing, which is the whole
    // reason these exist.
    const line = guideLine(
      [new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 10)],
      GUIDE_COLOURS.centre,
    );

    const material = line.material as THREE.LineBasicMaterial;
    expect(material.depthTest).toBe(false);
    expect(line.renderOrder).toBeGreaterThan(0);
  });

  it('carries the colour it was asked for', () => {
    const line = guideLine([new THREE.Vector3(), new THREE.Vector3(0, 0, 1)], GUIDE_COLOURS.edge);

    const material = line.material as THREE.LineBasicMaterial;
    expect(`#${material.color.getHexString()}`).toBe(GUIDE_COLOURS.edge);
  });
});
