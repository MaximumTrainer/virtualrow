/**
 * The start sequence's phase (#336), in its own module so tsc can read it
 * without pulling the React hook that also declares it. Mirrors the
 * `ghostChoice.ts` precedent for a shared type a `.svelte` file needs.
 *
 * Kept structurally identical to `StartPhase` in `src/hooks/useStartSequence.ts`;
 * the Svelte start sequence port will re-export from here.
 */
export type StartPhase = 'idle' | 'armed' | 'counting' | 'go' | 'rowing';
