/**
 * Database repository for water routes.
 * Provides CRUD operations for route data persistence.
 */
import type { WaterRoute, Coordinate, RouteFormData } from '../types/index';
import { query } from './client';

export interface RouteRow {
  id: string;
  name: string;
  description: string;
  distance: number;
  difficulty: 'easy' | 'moderate' | 'hard';
  location: string;
  coordinates: Coordinate[];
  elevation_gain: number;
  estimated_time: number;
  image_url: string | null;
  tags: string[];
  created_at: Date;
  user_rating: number | null;
}

/**
 * Convert database row to WaterRoute.
 */
function rowToRoute(row: RouteRow): WaterRoute {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    distance: parseFloat(row.distance.toString()),
    difficulty: row.difficulty,
    location: row.location,
    coordinates: row.coordinates,
    elevationGain: parseFloat(row.elevation_gain.toString()),
    estimatedTime: row.estimated_time,
    imageUrl: row.image_url ?? undefined,
    tags: row.tags || [],
    createdAt: new Date(row.created_at),
    userRating: row.user_rating ?? undefined,
  };
}

/**
 * Create a new route.
 */
export async function createRoute(route: WaterRoute): Promise<WaterRoute> {
  const result = await query<RouteRow>(
    `INSERT INTO routes (
      id, name, description, distance, difficulty, location,
      coordinates, elevation_gain, estimated_time, image_url,
      tags, created_at, user_rating
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    RETURNING *`,
    [
      route.id,
      route.name,
      route.description,
      route.distance,
      route.difficulty,
      route.location,
      JSON.stringify(route.coordinates),
      route.elevationGain,
      route.estimatedTime,
      route.imageUrl || null,
      JSON.stringify(route.tags),
      route.createdAt,
      route.userRating ?? null,
    ]
  );

  return rowToRoute(result.rows[0]);
}

/**
 * Get a route by ID.
 */
export async function getRouteById(id: string): Promise<WaterRoute | null> {
  const result = await query<RouteRow>(
    'SELECT * FROM routes WHERE id = $1',
    [id]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return rowToRoute(result.rows[0]);
}

/**
 * Get all routes.
 */
export async function getAllRoutes(): Promise<WaterRoute[]> {
  const result = await query<RouteRow>(
    'SELECT * FROM routes ORDER BY created_at DESC'
  );

  return result.rows.map(rowToRoute);
}

/**
 * Search routes by name, location, or tags.
 */
export async function searchRoutes(searchQuery: string): Promise<WaterRoute[]> {
  const pattern = `%${searchQuery.toLowerCase()}%`;
  const result = await query<RouteRow>(
    `SELECT * FROM routes 
     WHERE LOWER(name) LIKE $1 
        OR LOWER(location) LIKE $1 
        OR EXISTS (
          SELECT 1 FROM jsonb_array_elements_text(tags) tag 
          WHERE LOWER(tag) LIKE $1
        )
     ORDER BY created_at DESC`,
    [pattern]
  );

  return result.rows.map(rowToRoute);
}

/**
 * Filter routes by difficulty.
 */
export async function filterByDifficulty(
  difficulty: 'easy' | 'moderate' | 'hard'
): Promise<WaterRoute[]> {
  const result = await query<RouteRow>(
    'SELECT * FROM routes WHERE difficulty = $1 ORDER BY created_at DESC',
    [difficulty]
  );

  return result.rows.map(rowToRoute);
}

/**
 * Filter routes by distance range.
 */
export async function filterByDistance(
  minKm: number,
  maxKm: number
): Promise<WaterRoute[]> {
  const result = await query<RouteRow>(
    'SELECT * FROM routes WHERE distance >= $1 AND distance <= $2 ORDER BY created_at DESC',
    [minKm, maxKm]
  );

  return result.rows.map(rowToRoute);
}

/**
 * Update a route.
 */
export async function updateRoute(
  id: string,
  updates: Partial<RouteFormData>
): Promise<WaterRoute | null> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (updates.name !== undefined) {
    fields.push(`name = $${paramIndex++}`);
    values.push(updates.name);
  }
  if (updates.description !== undefined) {
    fields.push(`description = $${paramIndex++}`);
    values.push(updates.description);
  }
  if (updates.location !== undefined) {
    fields.push(`location = $${paramIndex++}`);
    values.push(updates.location);
  }
  if (updates.difficulty !== undefined) {
    fields.push(`difficulty = $${paramIndex++}`);
    values.push(updates.difficulty);
  }
  if (updates.coordinates !== undefined) {
    fields.push(`coordinates = $${paramIndex++}`);
    values.push(JSON.stringify(updates.coordinates));
  }
  if (updates.tags !== undefined) {
    fields.push(`tags = $${paramIndex++}`);
    values.push(JSON.stringify(updates.tags));
  }
  if (updates.imageUrl !== undefined) {
    fields.push(`image_url = $${paramIndex++}`);
    values.push(updates.imageUrl);
  }

  if (fields.length === 0) {
    return getRouteById(id);
  }

  values.push(id);
  const result = await query<RouteRow>(
    `UPDATE routes SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    values
  );

  if (result.rows.length === 0) {
    return null;
  }

  return rowToRoute(result.rows[0]);
}

/**
 * Delete a route.
 */
export async function deleteRoute(id: string): Promise<boolean> {
  const result = await query(
    'DELETE FROM routes WHERE id = $1',
    [id]
  );

  return (result.rowCount ?? 0) > 0;
}

/**
 * Check if routes table has data.
 */
export async function hasRoutes(): Promise<boolean> {
  const result = await query<{ count: string }>(
    'SELECT COUNT(*) as count FROM routes'
  );
  return parseInt(result.rows[0].count, 10) > 0;
}
