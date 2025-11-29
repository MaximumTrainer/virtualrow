/**
 * PostgreSQL database client wrapper.
 * Provides a connection pool for database operations.
 */
import { Pool } from 'pg';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { getDatabaseConfig } from './config';

let pool: Pool | null = null;

/**
 * Initialize the database connection pool.
 * Call this once at application startup.
 */
export function initializePool(): Pool {
  if (pool) {
    return pool;
  }

  const config = getDatabaseConfig();
  pool = new Pool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    ssl: config.ssl ? { rejectUnauthorized: false } : false,
    max: config.maxPoolSize,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  // Handle pool errors
  pool.on('error', (err) => {
    console.error('Unexpected error on idle client', err);
  });

  return pool;
}

/**
 * Get the current pool instance.
 * Initializes if not already initialized.
 */
export function getPool(): Pool {
  if (!pool) {
    return initializePool();
  }
  return pool;
}

/**
 * Execute a query with parameters.
 */
export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  const client = getPool();
  return client.query<T>(text, params);
}

/**
 * Get a client from the pool for transactions.
 * Remember to release the client when done.
 */
export async function getClient(): Promise<PoolClient> {
  const client = getPool();
  return client.connect();
}

/**
 * Execute a transaction with automatic rollback on error.
 */
export async function transaction<T>(
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Close the connection pool.
 * Call this when shutting down the application.
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/**
 * Check if database connection is healthy.
 */
export async function healthCheck(): Promise<boolean> {
  try {
    const result = await query('SELECT 1 as health');
    return result.rows.length === 1;
  } catch {
    return false;
  }
}
