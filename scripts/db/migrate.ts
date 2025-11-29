#!/usr/bin/env node
/**
 * Database migration CLI tool.
 * 
 * Usage:
 *   npm run db:migrate          - Apply all pending migrations
 *   npm run db:migrate:status   - Show migration status
 *   npm run db:rollback         - Rollback last migration
 *   npm run db:rollback:all     - Rollback all migrations
 */

import * as path from 'path';
import {
  initializePool,
  closePool,
  migrateUp,
  migrateDown,
  migrateDownTo,
  getMigrationStatus,
} from '../src/database/index.js';

const MIGRATIONS_DIR = path.resolve(process.cwd(), 'migrations');

async function main() {
  const command = process.argv[2] || 'up';
  const arg = process.argv[3];

  try {
    // Initialize database connection
    initializePool();

    switch (command) {
      case 'up': {
        const count = await migrateUp(MIGRATIONS_DIR);
        console.log(`Migration complete. Applied ${count} migration(s).`);
        break;
      }

      case 'down': {
        const steps = arg ? parseInt(arg, 10) : 1;
        if (isNaN(steps) || steps < 1) {
          console.error('Invalid step count. Usage: db:rollback [steps]');
          process.exit(1);
        }
        const count = await migrateDown(MIGRATIONS_DIR, steps);
        console.log(`Rollback complete. Rolled back ${count} migration(s).`);
        break;
      }

      case 'down:all': {
        const count = await migrateDownTo(MIGRATIONS_DIR, 0);
        console.log(`Rollback complete. Rolled back ${count} migration(s).`);
        break;
      }

      case 'status': {
        const status = await getMigrationStatus(MIGRATIONS_DIR);
        console.log('\nMigration Status:');
        console.log('=================\n');
        
        if (status.applied.length > 0) {
          console.log('Applied migrations:');
          status.applied.forEach(m => {
            console.log(`  ✓ ${m.version}: ${m.name}`);
          });
        } else {
          console.log('No migrations applied yet.');
        }
        
        console.log('');
        
        if (status.pending.length > 0) {
          console.log('Pending migrations:');
          status.pending.forEach(m => {
            console.log(`  ○ ${m.version}: ${m.name}`);
          });
        } else {
          console.log('No pending migrations.');
        }
        break;
      }

      default:
        console.error(`Unknown command: ${command}`);
        console.log('Available commands: up, down, down:all, status');
        process.exit(1);
    }
  } catch (error) {
    console.error('Migration error:', error);
    process.exit(1);
  } finally {
    await closePool();
  }
}

main();
