/** Types for the weighted E2E shard planner, consumed by src/__tests__/e2eShards.test.ts. */

export type Unit = { project: string; file: string };
export type Shard = { units: Unit[]; seconds: number };

export const DEFAULT_UNIT_SECONDS: number;

export function unitsFromListing(listing: unknown): Unit[];

export function planShards(units: Unit[], weights: Record<string, number>, total: number): Shard[];

export function shardArguments(shard: Shard): string[];
