export { attach, default, isSceneryRoute } from './engine/attach';
export type { RideAttach, RideAttachOpts, RideRenderer, SceneryRoute } from './engine/attach';
export type { WebGPUFallbackReason, WebGPUHealth } from './engine/health';
export { buildSmokeFoliagePools, type PoolInput } from './plan/instancePools';
export {
  buildSmokeBuildings,
  BUILDING_PROFILE_INDEX,
  BUILDINGS_FLOATS_PER_INSTANCE,
  type BuildingProfile,
  type BuildingSpec,
} from './plan/buildings';
export { tierCapsFor, type BuildingTierCaps } from './engine/tierCaps';
