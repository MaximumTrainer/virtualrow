import React, { useRef, Suspense } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { RowingScull, GltfScull } from './boatComponents';
import { IS_TEST_MODE } from './constants';
import { getRoutePositionAtProgress, distanceToProgress } from './curve';
import {
  ghostDistanceAt,
  followClock,
  lateralOffset,
  GHOST_LANE_OFFSET_M,
  type GhostSource,
} from './ghost';
import type { Crew } from './crewModel';

/**
 * The boat you are chasing (#338).
 *
 * It is not simulated: its distance at any moment is a pure function of
 * elapsed time (`ghost.ts`), so it cannot drift from the row it was recorded
 * from, and nothing it does depends on the physics the live boat runs. All
 * this component does is put it on the water.
 */

export const GHOST_GROUP_NAME = 'GhostBoat';

export interface GhostBoatProps {
  source: GhostSource;
  routeCurve: THREE.CatmullRomCurve3 | null;
  curveDistances: number[];
  curveLength: number;
  /** Metres of real route, for turning the ghost's distance into progress. */
  totalDistanceMeters: number;
  /** The row's clock. A ref, so the ghost moves without re-rendering (#331). */
  elapsedSecondsRef: React.MutableRefObject<number>;
  /** False while the row is paused, held on the line, or over. */
  playing?: boolean;
  cadence?: number;
  crew?: Crew;
}

export const GhostBoat: React.FC<GhostBoatProps> = ({
  source,
  routeCurve,
  curveDistances,
  curveLength,
  totalDistanceMeters,
  elapsedSecondsRef,
  playing = true,
  cadence = 22,
  crew = 'female',
}) => {
  const groupRef = useRef<THREE.Group>(null);
  const positionRef = useRef(new THREE.Vector3());
  const tangentRef = useRef(new THREE.Vector3());
  // Its own stroke clock: the ghost is rowing its row, not copying ours.
  const strokeCycleTRef = useRef(0);
  // And its own race clock, which fills the gaps between the erg's packets.
  const clockRef = useRef(0);

  useFrame((_, delta) => {
    if (playing) strokeCycleTRef.current += (delta * cadence) / 60;

    const group = groupRef.current;
    if (!group) return;

    clockRef.current = followClock(clockRef.current, elapsedSecondsRef.current, delta, playing);
    const meters = ghostDistanceAt(source, clockRef.current);
    const progress = distanceToProgress(meters, totalDistanceMeters, curveDistances, curveLength);
    const { angle } = getRoutePositionAtProgress(
      routeCurve,
      progress,
      positionRef.current,
      tangentRef.current,
    );

    // To port of the centreline, so the two boats read as two crews rather
    // than as one boat with z-fighting.
    const offset = lateralOffset(tangentRef.current.x, tangentRef.current.z, GHOST_LANE_OFFSET_M);
    group.position.set(
      positionRef.current.x + offset.x,
      positionRef.current.y,
      positionRef.current.z + offset.z,
    );
    group.rotation.y = angle;

    try {
      if (IS_TEST_MODE) {
        window.__ROWER3D_GHOST_METERS = meters;
        window.__ROWER3D_GHOST_POS = [group.position.x, group.position.y, group.position.z];
      }
    } catch {
      /* intentional: window access may fail in test environments */
    }
  });

  return (
    <group ref={groupRef} name={GHOST_GROUP_NAME}>
      {IS_TEST_MODE ? (
        <RowingScull cadence={cadence} strokeCycleTRef={strokeCycleTRef} />
      ) : (
        <Suspense fallback={<RowingScull cadence={cadence} strokeCycleTRef={strokeCycleTRef} />}>
          <GltfScull cadence={cadence} strokeCycleTRef={strokeCycleTRef} crew={crew} />
        </Suspense>
      )}
    </group>
  );
};

export default GhostBoat;
