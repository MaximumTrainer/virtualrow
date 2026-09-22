import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import * as THREE from 'three';
import ReactThreeTestRenderer from '@react-three/test-renderer';
import { installCanvasMock } from './canvasMock';

/**
 * Issue #325 — the sky is the one thing the fog must not touch.
 *
 * Fog fades distance into a flat colour, which is the point. The skydome and
 * the horizon silhouette both sit far beyond the fog's far plane, so fogging
 * them paints them out completely: the scene loses its sun, its gradient and
 * the skyline the fade is supposed to be revealing. three fogs every material
 * by default, so both have to say otherwise.
 */
vi.mock('@react-three/drei', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@react-three/drei');
  return { ...actual, Cloud: () => null };
});

const { PhotorealisticSkydome, HorizonSilhouette } = await import(
  '../components/rower3d/skyComponents'
);

/** Every material in a mounted tree, paired with whether it takes fog. */
const materialsOf = async (element: React.ReactElement) => {
  const renderer = await ReactThreeTestRenderer.create(element);
  const found: Array<{ type: string; fog: boolean }> = [];
  (renderer.scene.instance as unknown as THREE.Scene).traverse((object) => {
    const mesh = object as THREE.Mesh;
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : mesh.material
        ? [mesh.material]
        : [];
    for (const material of materials) {
      found.push({
        type: material.type,
        fog: (material as THREE.MeshBasicMaterial).fog === true,
      });
    }
  });
  return { renderer, found };
};

describe('the sky stands outside the fog', () => {
  let uninstallCanvasMock: () => void;
  beforeAll(() => {
    uninstallCanvasMock = installCanvasMock();
  });
  afterAll(() => uninstallCanvasMock());

  it('keeps the skydome out of it', async () => {
    const { renderer, found } = await materialsOf(
      <PhotorealisticSkydome theme="willowbrook" boatZ={0} />,
    );

    expect(found.length, 'the skydome drew nothing').toBeGreaterThan(0);
    expect(
      found.filter((m) => m.fog),
      'a skydome material would be painted out by the fog',
    ).toEqual([]);

    await renderer.unmount();
  });

  it('keeps the horizon silhouette out of it', async () => {
    const { renderer, found } = await materialsOf(
      <HorizonSilhouette theme="willowbrook" boatZ={0} />,
    );

    expect(found.length, 'the silhouette drew nothing').toBeGreaterThan(0);
    expect(
      found.filter((m) => m.fog),
      'the skyline the fade is meant to reveal would be faded out with it',
    ).toEqual([]);

    await renderer.unmount();
  });
});
