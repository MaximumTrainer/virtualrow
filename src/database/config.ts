/**
 * Database configuration for PostgreSQL connection.
 * Reads connection settings from environment variables.
 */

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  ssl: boolean;
  maxPoolSize: number;
}

/**
 * Get database configuration from environment variables.
 * Falls back to defaults for local development.
 */
export function getDatabaseConfig(): DatabaseConfig {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'virtualrow',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    ssl: process.env.DB_SSL === 'true',
    maxPoolSize: parseInt(process.env.DB_MAX_POOL_SIZE || '10', 10),
  };
}

/**
 * Get the full connection string from environment or build from config.
 */
export function getConnectionString(): string {
  // Allow a full connection string override
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  const config = getDatabaseConfig();
  const sslParam = config.ssl ? '?sslmode=require' : '';
  return `postgresql://${config.user}:${config.password}@${config.host}:${config.port}/${config.database}${sslParam}`;
}
