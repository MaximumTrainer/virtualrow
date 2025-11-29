#!/usr/bin/env node
/**
 * Database setup script for CI/CD pipelines.
 * Creates the database if it doesn't exist and runs all migrations.
 */

import { Pool } from 'pg';
import * as path from 'path';
import {
  getDatabaseConfig,
  initializePool,
  closePool,
  migrateUp,
} from '../src/database/index.js';

const MIGRATIONS_DIR = path.resolve(process.cwd(), 'migrations');

/**
 * Validate database name to prevent SQL injection.
 * Only allows alphanumeric characters and underscores.
 */
function validateDatabaseName(name: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
}

/**
 * Get SSL configuration based on environment.
 * Uses proper certificate validation in production.
 */
function getSslConfig(ssl: boolean): false | { rejectUnauthorized: boolean } {
  if (!ssl) return false;
  // In production, certificate validation should be enabled.
  // Set DB_SSL_REJECT_UNAUTHORIZED=true for strict validation.
  const rejectUnauthorized = process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false';
  return { rejectUnauthorized };
}

/**
 * Create the database if it doesn't exist.
 */
async function createDatabaseIfNotExists(): Promise<void> {
  const config = getDatabaseConfig();
  
  // Validate database name to prevent SQL injection
  if (!validateDatabaseName(config.database)) {
    throw new Error(`Invalid database name: ${config.database}. Only alphanumeric characters and underscores are allowed.`);
  }
  
  // Connect to postgres database to create our target database
  const adminPool = new Pool({
    host: config.host,
    port: config.port,
    database: 'postgres',
    user: config.user,
    password: config.password,
    ssl: getSslConfig(config.ssl),
  });

  try {
    // Check if database exists
    const result = await adminPool.query(
      `SELECT 1 FROM pg_database WHERE datname = $1`,
      [config.database]
    );

    if (result.rows.length === 0) {
      console.log(`Creating database: ${config.database}`);
      // Database names cannot be parameterized in PostgreSQL,
      // but we've validated the name above to prevent injection
      await adminPool.query(`CREATE DATABASE "${config.database}" TEMPLATE template0`);
      console.log(`Database ${config.database} created successfully`);
    } else {
      console.log(`Database ${config.database} already exists`);
    }
  } finally {
    await adminPool.end();
  }
}

/**
 * Main setup function.
 */
async function setup(): Promise<void> {
  console.log('Starting database setup...\n');

  try {
    // Step 1: Create database if needed
    await createDatabaseIfNotExists();

    // Step 2: Initialize connection pool
    initializePool();

    // Step 3: Run migrations
    console.log('\nRunning migrations...');
    const count = await migrateUp(MIGRATIONS_DIR);
    console.log(`Applied ${count} migration(s)`);

    console.log('\nDatabase setup complete!');
  } catch (error) {
    console.error('Setup failed:', error);
    process.exit(1);
  } finally {
    await closePool();
  }
}

setup();
