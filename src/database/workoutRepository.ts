/**
 * Database repository for workout sessions.
 * Provides CRUD operations for workout data persistence.
 */
import type { WorkoutSession, Split, HeartRateSample, WorkoutProgress } from '../types/index';
import { query } from './client';

export interface WorkoutSessionRow {
  id: string;
  route_id: string | null;
  route_name: string;
  start_time: Date;
  end_time: Date | null;
  duration: number;
  distance: number;
  average_pace: number;
  calories: number;
  heart_rate_samples: HeartRateSample[];
  heart_rate_avg: number | null;
  heart_rate_max: number | null;
  splits: Split[];
  is_active: boolean;
  structured_workout_id: string | null;
  workout_progress: WorkoutProgress | null;
}

/**
 * Convert database row to WorkoutSession.
 * Note: routeId uses empty string as the domain representation of "no route",
 * while the database uses null. This conversion maintains that contract.
 */
function rowToSession(row: WorkoutSessionRow): WorkoutSession {
  return {
    id: row.id,
    // Convert null to empty string for domain model consistency
    routeId: row.route_id ?? '',
    routeName: row.route_name,
    startTime: new Date(row.start_time),
    endTime: row.end_time ? new Date(row.end_time) : undefined,
    duration: row.duration,
    distance: row.distance,
    averagePace: row.average_pace,
    calories: row.calories,
    heartRateSamples: row.heart_rate_samples || [],
    heartRateAvg: row.heart_rate_avg ?? undefined,
    heartRateMax: row.heart_rate_max ?? undefined,
    splits: (row.splits || []).map((s: Split) => ({
      ...s,
      timestamp: new Date(s.timestamp),
    })),
    isActive: row.is_active,
    structuredWorkoutId: row.structured_workout_id ?? undefined,
    workoutProgress: row.workout_progress ?? undefined,
  };
}

/**
 * Create a new workout session.
 */
export async function createSession(session: WorkoutSession): Promise<WorkoutSession> {
  const result = await query<WorkoutSessionRow>(
    `INSERT INTO workout_sessions (
      id, route_id, route_name, start_time, end_time, duration,
      distance, average_pace, calories, heart_rate_samples,
      heart_rate_avg, heart_rate_max, splits, is_active,
      structured_workout_id, workout_progress
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
    RETURNING *`,
    [
      session.id,
      // Convert empty string to null for database storage
      session.routeId || null,
      session.routeName,
      session.startTime,
      session.endTime || null,
      session.duration,
      session.distance,
      session.averagePace,
      session.calories,
      JSON.stringify(session.heartRateSamples || []),
      session.heartRateAvg ?? null,
      session.heartRateMax ?? null,
      JSON.stringify(session.splits),
      session.isActive,
      session.structuredWorkoutId || null,
      session.workoutProgress ? JSON.stringify(session.workoutProgress) : null,
    ]
  );

  return rowToSession(result.rows[0]);
}

/**
 * Get a session by ID.
 */
export async function getSessionById(id: string): Promise<WorkoutSession | null> {
  const result = await query<WorkoutSessionRow>(
    'SELECT * FROM workout_sessions WHERE id = $1',
    [id]
  );

  if (result.rows.length === 0) {
    return null;
  }

  return rowToSession(result.rows[0]);
}

/**
 * Get all sessions.
 */
export async function getAllSessions(): Promise<WorkoutSession[]> {
  const result = await query<WorkoutSessionRow>(
    'SELECT * FROM workout_sessions ORDER BY start_time DESC'
  );

  return result.rows.map(rowToSession);
}

/**
 * Get sessions by route ID.
 */
export async function getSessionsByRouteId(routeId: string): Promise<WorkoutSession[]> {
  const result = await query<WorkoutSessionRow>(
    'SELECT * FROM workout_sessions WHERE route_id = $1 ORDER BY start_time DESC',
    [routeId]
  );

  return result.rows.map(rowToSession);
}

/**
 * Get recent sessions within the specified number of days.
 */
export async function getRecentSessions(days: number = 30): Promise<WorkoutSession[]> {
  const result = await query<WorkoutSessionRow>(
    `SELECT * FROM workout_sessions 
     WHERE start_time >= NOW() - INTERVAL '1 day' * $1
     ORDER BY start_time DESC`,
    [days]
  );

  return result.rows.map(rowToSession);
}

/**
 * Update a session.
 */
export async function updateSession(
  id: string,
  updates: Partial<WorkoutSession>
): Promise<WorkoutSession | null> {
  const fields: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  if (updates.endTime !== undefined) {
    fields.push(`end_time = $${paramIndex++}`);
    values.push(updates.endTime);
  }
  if (updates.duration !== undefined) {
    fields.push(`duration = $${paramIndex++}`);
    values.push(updates.duration);
  }
  if (updates.distance !== undefined) {
    fields.push(`distance = $${paramIndex++}`);
    values.push(updates.distance);
  }
  if (updates.averagePace !== undefined) {
    fields.push(`average_pace = $${paramIndex++}`);
    values.push(updates.averagePace);
  }
  if (updates.calories !== undefined) {
    fields.push(`calories = $${paramIndex++}`);
    values.push(updates.calories);
  }
  if (updates.heartRateSamples !== undefined) {
    fields.push(`heart_rate_samples = $${paramIndex++}`);
    values.push(JSON.stringify(updates.heartRateSamples));
  }
  if (updates.heartRateAvg !== undefined) {
    fields.push(`heart_rate_avg = $${paramIndex++}`);
    values.push(updates.heartRateAvg);
  }
  if (updates.heartRateMax !== undefined) {
    fields.push(`heart_rate_max = $${paramIndex++}`);
    values.push(updates.heartRateMax);
  }
  if (updates.splits !== undefined) {
    fields.push(`splits = $${paramIndex++}`);
    values.push(JSON.stringify(updates.splits));
  }
  if (updates.isActive !== undefined) {
    fields.push(`is_active = $${paramIndex++}`);
    values.push(updates.isActive);
  }
  if (updates.workoutProgress !== undefined) {
    fields.push(`workout_progress = $${paramIndex++}`);
    values.push(JSON.stringify(updates.workoutProgress));
  }

  if (fields.length === 0) {
    return getSessionById(id);
  }

  values.push(id);
  const result = await query<WorkoutSessionRow>(
    `UPDATE workout_sessions SET ${fields.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
    values
  );

  if (result.rows.length === 0) {
    return null;
  }

  return rowToSession(result.rows[0]);
}

/**
 * Delete a session.
 */
export async function deleteSession(id: string): Promise<boolean> {
  const result = await query(
    'DELETE FROM workout_sessions WHERE id = $1',
    [id]
  );

  return (result.rowCount ?? 0) > 0;
}

/**
 * Get workout statistics.
 */
export async function getWorkoutStats(): Promise<{
  totalWorkouts: number;
  totalDistance: number;
  totalTime: number;
  totalCalories: number;
  averagePace: number;
  bestPace: number;
}> {
  const result = await query<{
    total_workouts: string;
    total_distance: string;
    total_time: string;
    total_calories: string;
    average_pace: string;
    best_pace: string;
  }>(
    `SELECT 
      COUNT(*) as total_workouts,
      COALESCE(SUM(distance), 0) as total_distance,
      COALESCE(SUM(duration), 0) as total_time,
      COALESCE(SUM(calories), 0) as total_calories,
      COALESCE(AVG(average_pace), 0) as average_pace,
      COALESCE(MIN(average_pace), 0) as best_pace
     FROM workout_sessions 
     WHERE is_active = false`
  );

  const row = result.rows[0];
  return {
    totalWorkouts: parseInt(row.total_workouts, 10),
    totalDistance: parseFloat(row.total_distance),
    totalTime: parseFloat(row.total_time),
    totalCalories: parseFloat(row.total_calories),
    averagePace: Math.round(parseFloat(row.average_pace)),
    bestPace: parseFloat(row.best_pace),
  };
}
