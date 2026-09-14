import { useGLTF } from '@react-three/drei';
import { CREW_URL, type Crew } from './crewModel';

/**
 * Warm the cache for the crew actually in the boat.
 *
 * Both models were preloaded at module load, so every session downloaded 3.8 MB
 * to show 1.9 MB of it (issue #232).
 *
 * Separate from crewModel.ts on purpose: App.tsx imports resolveCrew from
 * there, and crewModel must stay free of drei so the 3D dependencies remain in
 * the lazily-loaded scene chunk.
 */
export const preloadCrew = (crew: Crew): void => {
  useGLTF.preload(CREW_URL[crew]);
};
