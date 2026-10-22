/**
 * The per-frame data the UI shell feeds the engine (#570 FR7). Matches the
 * shape UI's `rideCanvas.ts` seam passes, kept backward-compatible: the
 * engine falls back to a canned chase camera for the smoke pages where
 * `getFrame` is absent.
 *
 * `ghost` is `GhostSource` from `src/components/rower3d/ghost.ts`; the
 * engine uses `ghostDistanceAt(ghost, elapsedSeconds)` to place the ghost.
 */

import type { GhostSource } from '../../../components/rower3d/ghost';

export interface RideFrame {
  paceSPer500: number;
  distanceMeters: number;
  cadence: number;
  isPlaying: boolean;
  holdBoat: boolean;
  finished: boolean;
  intensityFactor: number;
  elapsedSeconds: number;
  ghost: GhostSource | null;
}
