/**
 * Database migration system for managing schema deltas and rollbacks.
 */
import type { PoolClient } from 'pg';
import * as fs from 'fs';
import * as path from 'path';
import { getPool, transaction } from './client';

export interface Migration {
  version: number;
  name: string;
  up: string;
  down: string;
}

/**
 * Ensure the migrations tracking table exists.
 */
async function ensureMigrationsTable(client: PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id SERIAL PRIMARY KEY,
      version INTEGER NOT NULL UNIQUE,
      name VARCHAR(255) NOT NULL,
      applied_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
}

/**
 * Get the current migration version from the database.
 */
export async function getCurrentVersion(): Promise<number> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);
    const result = await client.query<{ version: number }>(
      'SELECT MAX(version) as version FROM migrations'
    );
    return result.rows[0]?.version || 0;
  } finally {
    client.release();
  }
}

/**
 * Get all applied migration versions.
 */
export async function getAppliedMigrations(): Promise<number[]> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await ensureMigrationsTable(client);
    const result = await client.query<{ version: number }>(
      'SELECT version FROM migrations ORDER BY version'
    );
    return result.rows.map(row => row.version);
  } finally {
    client.release();
  }
}

/**
 * Load migrations from the migrations directory.
 */
export function loadMigrations(migrationsDir: string): Migration[] {
  const migrations: Migration[] = [];
  
  if (!fs.existsSync(migrationsDir)) {
    console.warn(`Migrations directory does not exist: ${migrationsDir}`);
    return migrations;
  }

  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const match = file.match(/^(\d+)_(.+)\.sql$/);
    if (!match) continue;

    const version = parseInt(match[1], 10);
    const name = match[2];
    const content = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');

    // Parse up and down sections from the migration file
    const parts = content.split(/^--\s*@down\s*$/m);
    const up = parts[0]?.trim() || '';
    const down = parts[1]?.trim() || '';

    migrations.push({ version, name, up, down });
  }

  return migrations.sort((a, b) => a.version - b.version);
}

/**
 * Apply a single migration.
 */
async function applyMigration(client: PoolClient, migration: Migration): Promise<void> {
  console.log(`Applying migration ${migration.version}: ${migration.name}`);
  await client.query(migration.up);
  await client.query(
    'INSERT INTO migrations (version, name) VALUES ($1, $2)',
    [migration.version, migration.name]
  );
  console.log(`Migration ${migration.version} applied successfully`);
}

/**
 * Rollback a single migration.
 */
async function rollbackMigration(client: PoolClient, migration: Migration): Promise<void> {
  if (!migration.down) {
    throw new Error(`Migration ${migration.version} does not have a rollback script`);
  }
  console.log(`Rolling back migration ${migration.version}: ${migration.name}`);
  await client.query(migration.down);
  await client.query(
    'DELETE FROM migrations WHERE version = $1',
    [migration.version]
  );
  console.log(`Migration ${migration.version} rolled back successfully`);
}

/**
 * Run all pending migrations up to the latest version.
 */
export async function migrateUp(migrationsDir: string): Promise<number> {
  const migrations = loadMigrations(migrationsDir);
  const applied = await getAppliedMigrations();
  const pending = migrations.filter(m => !applied.includes(m.version));

  if (pending.length === 0) {
    console.log('No pending migrations');
    return 0;
  }

  let count = 0;
  for (const migration of pending) {
    await transaction(async (client) => {
      await applyMigration(client, migration);
    });
    count++;
  }

  console.log(`Applied ${count} migration(s)`);
  return count;
}

/**
 * Migrate up to a specific version.
 */
export async function migrateUpTo(migrationsDir: string, targetVersion: number): Promise<number> {
  const migrations = loadMigrations(migrationsDir);
  const applied = await getAppliedMigrations();
  const pending = migrations.filter(
    m => !applied.includes(m.version) && m.version <= targetVersion
  );

  if (pending.length === 0) {
    console.log('No pending migrations');
    return 0;
  }

  let count = 0;
  for (const migration of pending) {
    await transaction(async (client) => {
      await applyMigration(client, migration);
    });
    count++;
  }

  console.log(`Applied ${count} migration(s)`);
  return count;
}

/**
 * Rollback the last n migrations.
 */
export async function migrateDown(migrationsDir: string, steps: number = 1): Promise<number> {
  const migrations = loadMigrations(migrationsDir);
  const applied = await getAppliedMigrations();
  
  // Get the last n applied migrations in reverse order
  const toRollback = applied
    .slice(-steps)
    .reverse()
    .map(v => migrations.find(m => m.version === v))
    .filter((m): m is Migration => m !== undefined);

  if (toRollback.length === 0) {
    console.log('No migrations to rollback');
    return 0;
  }

  let count = 0;
  for (const migration of toRollback) {
    await transaction(async (client) => {
      await rollbackMigration(client, migration);
    });
    count++;
  }

  console.log(`Rolled back ${count} migration(s)`);
  return count;
}

/**
 * Rollback all migrations down to (but not including) a specific version.
 */
export async function migrateDownTo(migrationsDir: string, targetVersion: number): Promise<number> {
  const migrations = loadMigrations(migrationsDir);
  const applied = await getAppliedMigrations();
  
  // Get migrations above target version in reverse order
  const toRollback = applied
    .filter(v => v > targetVersion)
    .reverse()
    .map(v => migrations.find(m => m.version === v))
    .filter((m): m is Migration => m !== undefined);

  if (toRollback.length === 0) {
    console.log('No migrations to rollback');
    return 0;
  }

  let count = 0;
  for (const migration of toRollback) {
    await transaction(async (client) => {
      await rollbackMigration(client, migration);
    });
    count++;
  }

  console.log(`Rolled back ${count} migration(s)`);
  return count;
}

/**
 * Get migration status (pending and applied).
 */
export async function getMigrationStatus(migrationsDir: string): Promise<{
  applied: Array<{ version: number; name: string }>;
  pending: Array<{ version: number; name: string }>;
}> {
  const migrations = loadMigrations(migrationsDir);
  const appliedVersions = await getAppliedMigrations();

  const applied = migrations
    .filter(m => appliedVersions.includes(m.version))
    .map(m => ({ version: m.version, name: m.name }));

  const pending = migrations
    .filter(m => !appliedVersions.includes(m.version))
    .map(m => ({ version: m.version, name: m.name }));

  return { applied, pending };
}
