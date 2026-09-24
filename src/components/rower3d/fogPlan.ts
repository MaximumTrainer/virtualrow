import { SCENE_CONFIG, type SceneConfig } from './themeConfig';

/**
 * How far a rower can see, and where the world stops being drawn (#325).
 *
 * The scene config has carried `fogColor`, `fogNear` and `fogFar` since it was
 * written and nothing has ever read them, so the water strip simply ended:
 * `geometryChunks.ts` records that the cut used to be hidden by `fogExp2` and
 * has been bare since, and #321 had to hold the cull out at seven kilometres
 * rather than expose an edge nothing softened.
 *
 * Those are one decision, not two, which is why they are computed together.
 * Fog says how far can be seen; the cull says how far is worth building. A
 * chunk beyond the fog's far plane is geometry uploaded and drawn into solid
 * colour, and a cull inside it is a hole in the world.
 */

export interface FogPlan {
  /** What the distance fades to. Matched to the sky so the horizon closes. */
  color: string;
  /** Metres from the camera at which the fade begins. */
  near: number;
  /** Metres at which nothing is visible at all. */
  far: number;
}

/**
 * The fog, from whichever config the scene is running under.
 *
 * Defaulted to `SCENE_CONFIG` so every existing call-site is unchanged; the
 * conditions presets (#346) pass the config they produced.
 */
export const fogFor = (config: SceneConfig = SCENE_CONFIG): FogPlan => {
  const { fogColor, fogNear, fogFar } = config.atmosphere;
  return { color: fogColor, near: fogNear, far: fogFar };
};

/**
 * How far out to keep drawing route chunks.
 *
 * A tenth past the fog's far plane. The margin is there because a chunk is
 * culled on its bounding sphere and appears at its near edge: cutting exactly
 * at `far` would pop a chunk in while part of it was still short of full fog.
 */
export const chunkViewDistanceFor = (config: SceneConfig = SCENE_CONFIG): number =>
  fogFor(config).far * 1.1;
