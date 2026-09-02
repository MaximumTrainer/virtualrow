import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { measureSceneMemory, MEGABYTE } from '../components/rower3d/sceneMemory';

const strip = (vertices: number): THREE.Mesh => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Array(vertices * 3).fill(0), 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(vertices * 3).fill(0), 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(vertices * 2).fill(0), 2));
  return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial());
};

const rendererStub = (geometries: number, textures: number) =>
  ({ info: { memory: { geometries, textures }, programs: [] } });

describe('measureSceneMemory', () => {
  it('reports nothing useful for an empty scene', () => {
    const usage = measureSceneMemory(new THREE.Scene(), rendererStub(0, 0));
    expect(usage.geometryBytes).toBe(0);
    expect(usage.geometries).toBe(0);
    expect(usage.geometryMb).toBe(0);
  });

  it('sums the attribute buffers actually uploaded', () => {
    const scene = new THREE.Scene();
    scene.add(strip(1000));
    // 1000 vertices: position 3, normal 3, uv 2 floats = 8 * 4 bytes each.
    expect(measureSceneMemory(scene, rendererStub(1, 0)).geometryBytes).toBe(1000 * 8 * 4);
  });

  it('counts the index buffer too', () => {
    const withIndex = strip(100);
    withIndex.geometry.setIndex(new Array(300).fill(0));
    const scene = new THREE.Scene();
    scene.add(withIndex);

    const bare = new THREE.Scene();
    bare.add(strip(100));

    expect(measureSceneMemory(scene, rendererStub(1, 0)).geometryBytes).toBeGreaterThan(
      measureSceneMemory(bare, rendererStub(1, 0)).geometryBytes,
    );
  });

  it('counts a geometry shared by two meshes once', () => {
    const shared = strip(500).geometry;
    const scene = new THREE.Scene();
    scene.add(new THREE.Mesh(shared, new THREE.MeshBasicMaterial()));
    scene.add(new THREE.Mesh(shared, new THREE.MeshBasicMaterial()));

    expect(measureSceneMemory(scene, rendererStub(1, 0)).geometryBytes).toBe(500 * 8 * 4);
  });

  it('walks nested groups', () => {
    const scene = new THREE.Scene();
    const group = new THREE.Group();
    group.add(strip(200));
    const inner = new THREE.Group();
    inner.add(strip(300));
    group.add(inner);
    scene.add(group);

    expect(measureSceneMemory(scene, rendererStub(2, 0)).geometryBytes).toBe(500 * 8 * 4);
  });

  it('counts geometry that is switched off but still resident', () => {
    // Chunk culling sets `visible = false`; the buffers stay on the GPU.
    const hidden = strip(400);
    hidden.visible = false;
    const scene = new THREE.Scene();
    scene.add(hidden);

    expect(measureSceneMemory(scene, rendererStub(1, 0)).geometryBytes).toBe(400 * 8 * 4);
  });

  it('passes the renderer counters through, and reports megabytes', () => {
    const scene = new THREE.Scene();
    scene.add(strip(MEGABYTE / 32)); // 8 floats * 4 bytes = 32 bytes a vertex
    const usage = measureSceneMemory(scene, rendererStub(7, 12));

    expect(usage.geometries).toBe(7);
    expect(usage.textures).toBe(12);
    expect(usage.geometryMb).toBeCloseTo(1, 3);
  });

  it('survives a renderer that exposes no info', () => {
    const usage = measureSceneMemory(new THREE.Scene(), {});
    expect(usage.geometries).toBe(0);
    expect(usage.textures).toBe(0);
  });
});
