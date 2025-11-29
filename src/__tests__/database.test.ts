import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { QueryResult } from 'pg';

// Mock the pg module
vi.mock('pg', () => {
  const mockQuery = vi.fn();
  const mockConnect = vi.fn();
  const mockRelease = vi.fn();
  const mockEnd = vi.fn();
  const mockOn = vi.fn();
  
  const MockPool = vi.fn(() => ({
    query: mockQuery,
    connect: mockConnect.mockResolvedValue({
      query: mockQuery,
      release: mockRelease,
    }),
    end: mockEnd,
    on: mockOn,
  }));

  return {
    Pool: MockPool,
    mockQuery,
    mockConnect,
    mockRelease,
    mockEnd,
    mockOn,
  };
});

// Import after mocking
import { getDatabaseConfig, getConnectionString } from '../database/config';

describe('Database Configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('getDatabaseConfig', () => {
    it('returns default configuration when no environment variables are set', () => {
      delete process.env.DB_HOST;
      delete process.env.DB_PORT;
      delete process.env.DB_NAME;
      delete process.env.DB_USER;
      delete process.env.DB_PASSWORD;
      delete process.env.DB_SSL;
      delete process.env.DB_MAX_POOL_SIZE;

      const config = getDatabaseConfig();

      expect(config.host).toBe('localhost');
      expect(config.port).toBe(5432);
      expect(config.database).toBe('virtualrow');
      expect(config.user).toBe('postgres');
      expect(config.password).toBe('');
      expect(config.ssl).toBe(false);
      expect(config.maxPoolSize).toBe(10);
    });

    it('reads configuration from environment variables', () => {
      process.env.DB_HOST = 'production-host';
      process.env.DB_PORT = '5433';
      process.env.DB_NAME = 'mydb';
      process.env.DB_USER = 'myuser';
      process.env.DB_PASSWORD = 'secret';
      process.env.DB_SSL = 'true';
      process.env.DB_MAX_POOL_SIZE = '20';

      const config = getDatabaseConfig();

      expect(config.host).toBe('production-host');
      expect(config.port).toBe(5433);
      expect(config.database).toBe('mydb');
      expect(config.user).toBe('myuser');
      expect(config.password).toBe('secret');
      expect(config.ssl).toBe(true);
      expect(config.maxPoolSize).toBe(20);
    });
  });

  describe('getConnectionString', () => {
    it('returns DATABASE_URL if set', () => {
      process.env.DATABASE_URL = 'postgresql://user:pass@host:5432/db';

      const connString = getConnectionString();

      expect(connString).toBe('postgresql://user:pass@host:5432/db');
    });

    it('builds connection string from config when DATABASE_URL is not set', () => {
      delete process.env.DATABASE_URL;
      process.env.DB_HOST = 'localhost';
      process.env.DB_PORT = '5432';
      process.env.DB_NAME = 'testdb';
      process.env.DB_USER = 'testuser';
      process.env.DB_PASSWORD = 'testpass';
      process.env.DB_SSL = 'false';

      const connString = getConnectionString();

      expect(connString).toBe('postgresql://testuser:testpass@localhost:5432/testdb');
    });

    it('includes SSL parameter when SSL is enabled', () => {
      delete process.env.DATABASE_URL;
      process.env.DB_HOST = 'localhost';
      process.env.DB_PORT = '5432';
      process.env.DB_NAME = 'testdb';
      process.env.DB_USER = 'testuser';
      process.env.DB_PASSWORD = 'testpass';
      process.env.DB_SSL = 'true';

      const connString = getConnectionString();

      expect(connString).toContain('?sslmode=require');
    });
  });
});

describe('Migrations', () => {
  describe('loadMigrations', () => {
    it('loads migrations from directory', async () => {
      const { loadMigrations } = await import('../database/migrations');
      const path = await import('path');
      
      const migrationsDir = path.resolve(process.cwd(), 'migrations');
      const migrations = loadMigrations(migrationsDir);

      expect(migrations.length).toBeGreaterThan(0);
      expect(migrations[0].version).toBe(1);
      expect(migrations[0].name).toBe('initial_schema');
      expect(migrations[0].up).toContain('CREATE TABLE');
      expect(migrations[0].down).toContain('DROP TABLE');
    });

    it('returns empty array for non-existent directory', async () => {
      const { loadMigrations } = await import('../database/migrations');
      
      const migrations = loadMigrations('/non-existent-dir');

      expect(migrations).toEqual([]);
    });
  });
});
