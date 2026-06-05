/**
 * localStorage-based workout persistence stub.
 *
 * Stores authenticated users' workout sessions in localStorage, keyed by
 * intervals.icu athlete ID. This is a temporary adapter that will be replaced
 * by the Postgres persistence layer when issue #37 ships.
 *
 * Storage key format: `virtualrow:sessions:{userId}`
 */

import type { WorkoutSession } from '../types/index';

const STORAGE_KEY_PREFIX = 'virtualrow:sessions:';

/** Revive Date strings when parsing JSON (WorkoutSession contains Date fields). */
function reviveDates(_key: string, value: unknown): unknown {
  if (typeof value === 'string') {
    // ISO 8601 date strings — rough but sufficient for our schema
    const iso = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value);
    if (iso) return new Date(value);
  }
  return value;
}

function storageKey(userId: string): string {
  return `${STORAGE_KEY_PREFIX}${userId}`;
}

/**
 * Persist a completed workout session for an authenticated user.
 * Appends to existing sessions — does not overwrite.
 */
export function saveSession(userId: string, session: WorkoutSession): void {
  if (!userId) return;
  try {
    const existing = loadSessions(userId);
    // Avoid duplicates if called more than once
    const deduped = existing.filter((s) => s.id !== session.id);
    deduped.push(session);
    localStorage.setItem(storageKey(userId), JSON.stringify(deduped));
  } catch (err) {
    console.warn('[LocalStorageWorkoutStore] Failed to save session:', err);
  }
}

/**
 * Load all stored workout sessions for an authenticated user.
 * Returns an empty array if nothing is stored or parsing fails.
 */
export function loadSessions(userId: string): WorkoutSession[] {
  if (!userId) return [];
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return [];
    return JSON.parse(raw, reviveDates) as WorkoutSession[];
  } catch (err) {
    console.warn('[LocalStorageWorkoutStore] Failed to load sessions:', err);
    return [];
  }
}

/**
 * Remove all stored sessions for a user.
 * Called on sign-out to clear personal data from the browser.
 */
export function clearSessions(userId: string): void {
  if (!userId) return;
  try {
    localStorage.removeItem(storageKey(userId));
  } catch {
    // Ignore storage errors on clear
  }
}
