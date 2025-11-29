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
 * Create the database if it doesn't exist.
 */
async function createDatabaseIfNotExists(): Promise<void> {
  const config = getDatabaseConfig();
  
  // Connect to postgres database to create our target database
  const adminPool = new Pool({
    host: config.host,
    port: config.port,
    database: 'postgres',
    user: config.user,
    password: config.password,
    ssl: config.ssl ? { rejectUnauthorized: false } : false,
  });

  try {
    // Check if database exists
    const result = await adminPool.query(
      `SELECT 1 FROM pg_database WHERE datname = $1`,
      [config.database]
    );

    if (result.rows.length === 0) {
      console.log(`Creating database: ${config.database}`);
      // Use template0 to avoid encoding issues
      await adminPool.query(`CREATE DATABASE ${config.database} TEMPLATE template0`);
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
