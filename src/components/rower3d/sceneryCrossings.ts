// ============================================================================
// BRIDGE MODELS — which Tier C model dresses a crossing.
//
// The crossing itself (where the route passes under a bridge, and what kind of
// bridge it is) is read from Overpass in utils/bridgeCrossings.ts; this is the
// scene-layer half that turns a kind into an asset (issue #232).
// ============================================================================

import type { BridgeKind } from '../../utils/bridgeCrossings';
import type { SceneryModelId } from './sceneryAssets';

/** One Tier C model per kind — the whole kit, rather than one bridge everywhere. */
export const BRIDGE_MODELS: Record<BridgeKind, SceneryModelId> = {
  arch: 'c01-bridge-arch-masonry',
  road: 'c02-bridge-road-concrete',
  truss: 'c03-bridge-truss-steel',
  rail: 'c04-bridge-rail-girder',
  bascule: 'c05-bridge-bascule',
  foot: 'c06-bridge-foot-suspension',
  lift: 'c07-bridge-dutch-lift',
  cantilever: 'c08-bridge-cantilever',
};

export const bridgeModelFor = (kind: BridgeKind): SceneryModelId => BRIDGE_MODELS[kind];
