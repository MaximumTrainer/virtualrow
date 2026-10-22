/**
 * Shadow stage (#559 FR5). Encodes every cascade of every shadow-depth
 * pass before any lit pass, into one atlas texture. Pass order of the
 * frame graph becomes `shadowStage → sky → bank → scenery → water`.
 *
 * The scenery depth path reads centres by `instance_index` directly, so
 * it doesn't need the lit scenery pass's compute-cull compact indices
 * (D7-a: the orthographic cascade bounds + viewport scissor drop
 * instances outside the cascade just as effectively for an atlas of the
 * sizes we ship).
 */

/// <reference types="@webgpu/types" />

import type { FrameContext, Pass } from './frameGraph';
import type { ShadowAtlas } from './shadowAtlas';
import { cascadeViewport } from './shadowAtlas';
import {
  createBankDepthPipeline,
  type BankDepthPipeline,
} from '../passes/bankDepth';
import {
  createSceneryDepthPipeline,
  createSceneryDepthPoolBindGroup,
  type SceneryDepthPipeline,
} from '../passes/sceneryDepth';
import {
  createBuildingsDepthPipeline,
  createBuildingsDepthPoolBindGroup,
  type BuildingsDepthPipeline,
} from '../passes/buildingsDepth';
import { createCharactersDepthPipeline, type CharactersDepthPipeline } from '../passes/charactersDepth';
import type { BoatPass } from '../passes/boat';
import type { InstancePool } from '../plan/instancePools';
import type { BuildingPool } from '../plan/buildings';
import type { BoatMeshBuffers } from '../plan/boatMesh';
import type { Mat4 } from '../math/mat4';
import { BUILDINGS_VERTEX_COUNT } from '../passes/buildings';

export interface ShadowFramePayload {
  cascades: { viewProj: Mat4 }[];
  cascadeCount: number;
}

export interface ShadowTelemetry {
  cascades: number;
  atlasSize: number;
  drawsPerCascade: number;
  lastSplits: number[];
  draws: number;
  triangles: number;
  atlasBytes: number;
}

export interface ShadowStage extends Pass {
  readonly atlas: ShadowAtlas;
  readonly bank: BankDepthPipeline;
  readonly scenery: SceneryDepthPipeline;
  readonly buildings: BuildingsDepthPipeline;
  readonly characters: CharactersDepthPipeline | null;
  readonly payload: ShadowFramePayload;
  readonly telemetry: ShadowTelemetry;
}

export interface ShadowStageOptions {
  device: GPUDevice;
  atlas: ShadowAtlas;
  scenePools: readonly InstancePool[];
  /**
   * Building pool to cast shadows into the atlas. `null` turns the
   * buildings depth path off (#566 D4-c: `basic` / `low` tiers skip the
   * cast). Lit `buildings` pass still receives shadows via `sampleShadow`.
   */
  buildingsPool: BuildingPool | null;
  /**
   * Characters depth cast (#570 D7). `null` skips the pass entirely
   * (`basic` / `low` tiers per D7-c). When present the pass pulls the
   * boat mesh + the per-draw `boat` / `ghost` uniform bind groups.
   */
  charactersMesh?: BoatMeshBuffers | null;
  boatPass?: BoatPass | null;
  telemetry: ShadowTelemetry;
}

const CASCADE_UNIFORM_BYTES = 64;

export const createShadowStage = (
  opts: ShadowStageOptions,
): ShadowStage => {
  const { device, atlas, scenePools, buildingsPool, charactersMesh, boatPass, telemetry } = opts;
  const bank = createBankDepthPipeline(device);
  const scenery = createSceneryDepthPipeline(device);
  const buildings = createBuildingsDepthPipeline(device);
  const characters = charactersMesh ? createCharactersDepthPipeline(device, charactersMesh) : null;

  const bankCascadeBuffers: GPUBuffer[] = [];
  const bankCascadeBindGroups: GPUBindGroup[] = [];
  const sceneryCascadeBuffers: GPUBuffer[] = [];
  const sceneryCascadeBindGroups: GPUBindGroup[] = [];
  const buildingsCascadeBuffers: GPUBuffer[] = [];
  const buildingsCascadeBindGroups: GPUBindGroup[] = [];
  const charactersCascadeBuffers: GPUBuffer[] = [];
  const charactersCascadeBindGroups: GPUBindGroup[] = [];
  for (let i = 0; i < atlas.cascades; i++) {
    const bankBuf = device.createBuffer({
      label: `bankDepth-cascade:${i}`,
      size: CASCADE_UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    bankCascadeBuffers.push(bankBuf);
    bankCascadeBindGroups.push(
      device.createBindGroup({
        label: `bankDepth-cascade:${i}:bg`,
        layout: bank.cascadeLayout,
        entries: [{ binding: 0, resource: { buffer: bankBuf } }],
      }),
    );
    const sceneBuf = device.createBuffer({
      label: `sceneryDepth-cascade:${i}`,
      size: CASCADE_UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    sceneryCascadeBuffers.push(sceneBuf);
    sceneryCascadeBindGroups.push(
      device.createBindGroup({
        label: `sceneryDepth-cascade:${i}:bg`,
        layout: scenery.cascadeLayout,
        entries: [{ binding: 0, resource: { buffer: sceneBuf } }],
      }),
    );
    const buildBuf = device.createBuffer({
      label: `buildingsDepth-cascade:${i}`,
      size: CASCADE_UNIFORM_BYTES,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    buildingsCascadeBuffers.push(buildBuf);
    buildingsCascadeBindGroups.push(
      device.createBindGroup({
        label: `buildingsDepth-cascade:${i}:bg`,
        layout: buildings.cascadeLayout,
        entries: [{ binding: 0, resource: { buffer: buildBuf } }],
      }),
    );
    if (characters) {
      const charBuf = device.createBuffer({
        label: `charactersDepth-cascade:${i}`,
        size: CASCADE_UNIFORM_BYTES,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      charactersCascadeBuffers.push(charBuf);
      charactersCascadeBindGroups.push(
        device.createBindGroup({
          label: `charactersDepth-cascade:${i}:bg`,
          layout: characters.cascadeLayout,
          entries: [{ binding: 0, resource: { buffer: charBuf } }],
        }),
      );
    }
  }
  const charactersBoatBindGroup = characters && boatPass
    ? device.createBindGroup({
        label: 'charactersDepth-boat-bg',
        layout: characters.drawLayout,
        entries: [
          { binding: 0, resource: { buffer: boatPass.boat.uniforms } },
          { binding: 1, resource: { buffer: boatPass.boat.skin } },
        ],
      })
    : null;
  const charactersGhostBindGroup = characters && boatPass
    ? device.createBindGroup({
        label: 'charactersDepth-ghost-bg',
        layout: characters.drawLayout,
        entries: [
          { binding: 0, resource: { buffer: boatPass.ghost.uniforms } },
          { binding: 1, resource: { buffer: boatPass.ghost.skin } },
        ],
      })
    : null;

  const sceneryPoolBindGroups = scenePools.map((pool) =>
    createSceneryDepthPoolBindGroup(device, scenery.poolLayout, {
      centresBuffer: pool.centresBuffer,
      kind: pool.kind,
      speciesIndex: pool.speciesIndex,
    }),
  );
  const buildingsPoolBindGroup = buildingsPool
    ? createBuildingsDepthPoolBindGroup(device, buildings.poolLayout, {
        centresBuffer: buildingsPool.centresBuffer,
        sizesBuffer: buildingsPool.sizesBuffer,
      })
    : null;

  const atlasView = atlas.view;
  const uniformScratch = new Float32Array(16);
  let disposed = false;

  const payload: ShadowFramePayload = {
    cascades: [],
    cascadeCount: 0,
  };

  return {
    name: 'shadowStage',
    atlas,
    bank,
    scenery,
    buildings,
    characters,
    payload,
    telemetry,
    encode(ctx: FrameContext) {
      if (disposed) return;
      const count = Math.min(payload.cascadeCount, atlas.cascades);
      if (count === 0) return;

      for (let i = 0; i < count; i++) {
        const cascade = payload.cascades[i];
        if (!cascade) continue;
        uniformScratch.set(cascade.viewProj, 0);
        ctx.device.queue.writeBuffer(
          bankCascadeBuffers[i],
          0,
          uniformScratch as BufferSource,
        );
        ctx.device.queue.writeBuffer(
          sceneryCascadeBuffers[i],
          0,
          uniformScratch as BufferSource,
        );
        if (buildingsPoolBindGroup) {
          ctx.device.queue.writeBuffer(
            buildingsCascadeBuffers[i],
            0,
            uniformScratch as BufferSource,
          );
        }
        if (characters && charactersCascadeBuffers[i]) {
          ctx.device.queue.writeBuffer(
            charactersCascadeBuffers[i],
            0,
            uniformScratch as BufferSource,
          );
        }
      }

      let drawCount = 0;
      let triangleCount = 0;
      for (let i = 0; i < count; i++) {
        const [vx, vy, vw, vh] = cascadeViewport(atlas, i);
        const pass = ctx.encoder.beginRenderPass({
          label: `shadow-cascade:${i}`,
          colorAttachments: [],
          depthStencilAttachment: {
            view: atlasView,
            depthLoadOp: i === 0 ? 'clear' : 'load',
            depthStoreOp: 'store',
            depthClearValue: 1.0,
          },
        });
        pass.setViewport(vx, vy, vw, vh, 0, 1);
        pass.setScissorRect(vx, vy, vw, vh);

        pass.setPipeline(bank.pipeline);
        pass.setBindGroup(0, bankCascadeBindGroups[i]);
        pass.setVertexBuffer(0, bank.positions);
        pass.setVertexBuffer(1, bank.sides);
        pass.setIndexBuffer(bank.indices, 'uint16');
        pass.drawIndexed(bank.indexCount);
        drawCount += 1;
        triangleCount += bank.indexCount / 3;

        pass.setPipeline(scenery.pipeline);
        pass.setBindGroup(0, sceneryCascadeBindGroups[i]);
        for (let p = 0; p < sceneryPoolBindGroups.length; p++) {
          pass.setBindGroup(1, sceneryPoolBindGroups[p]);
          const pool = scenePools[p];
          pass.draw(12, pool.instanceCount);
          drawCount += 1;
          triangleCount += (12 / 3) * pool.instanceCount;
        }

        if (buildingsPoolBindGroup && buildingsPool && buildingsPool.instanceCount > 0) {
          pass.setPipeline(buildings.pipeline);
          pass.setBindGroup(0, buildingsCascadeBindGroups[i]);
          pass.setBindGroup(1, buildingsPoolBindGroup);
          pass.draw(BUILDINGS_VERTEX_COUNT, buildingsPool.instanceCount);
          drawCount += 1;
          triangleCount += (BUILDINGS_VERTEX_COUNT / 3) * buildingsPool.instanceCount;
        }

        if (characters && boatPass) {
          pass.setPipeline(characters.pipeline);
          pass.setBindGroup(0, charactersCascadeBindGroups[i]);
          pass.setVertexBuffer(0, characters.positions);
          pass.setIndexBuffer(characters.indices, 'uint16');
          if (boatPass.boatVisible.value && charactersBoatBindGroup) {
            pass.setBindGroup(1, charactersBoatBindGroup);
            pass.drawIndexed(characters.indexCount);
            drawCount += 1;
            triangleCount += characters.indexCount / 3;
          }
          if (boatPass.ghostVisible.value && charactersGhostBindGroup) {
            pass.setBindGroup(1, charactersGhostBindGroup);
            pass.drawIndexed(characters.indexCount);
            drawCount += 1;
            triangleCount += characters.indexCount / 3;
          }
        }

        pass.end();
      }

      telemetry.cascades = count;
      telemetry.atlasSize = atlas.tileSize;
      telemetry.draws = drawCount;
      telemetry.triangles = triangleCount;
      telemetry.drawsPerCascade = Math.floor(drawCount / Math.max(1, count));
      telemetry.atlasBytes = atlas.bytes;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const b of bankCascadeBuffers) b.destroy();
      for (const b of sceneryCascadeBuffers) b.destroy();
      for (const b of buildingsCascadeBuffers) b.destroy();
      for (const b of charactersCascadeBuffers) b.destroy();
      bank.dispose();
      scenery.dispose();
      buildings.dispose();
      characters?.dispose();
    },
  };
};
