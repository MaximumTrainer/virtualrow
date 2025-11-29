-- Initial database schema for VirtualRow
-- Creates tables for routes and workout sessions

-- Routes table for storing water routes
CREATE TABLE IF NOT EXISTS routes (
  id VARCHAR(255) PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  distance DECIMAL(10, 2) NOT NULL,
  difficulty VARCHAR(20) NOT NULL CHECK (difficulty IN ('easy', 'moderate', 'hard')),
  location VARCHAR(255),
  coordinates JSONB NOT NULL,
  elevation_gain DECIMAL(10, 2) DEFAULT 0,
  estimated_time INTEGER NOT NULL,
  image_url TEXT,
  tags JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  user_rating DECIMAL(3, 2)
);

-- Workout sessions table
CREATE TABLE IF NOT EXISTS workout_sessions (
  id VARCHAR(255) PRIMARY KEY,
  route_id VARCHAR(255) REFERENCES routes(id) ON DELETE SET NULL,
  route_name VARCHAR(255) NOT NULL,
  start_time TIMESTAMPTZ NOT NULL,
  end_time TIMESTAMPTZ,
  duration INTEGER DEFAULT 0,
  distance INTEGER DEFAULT 0,
  average_pace INTEGER DEFAULT 0,
  calories INTEGER DEFAULT 0,
  heart_rate_samples JSONB DEFAULT '[]'::jsonb,
  heart_rate_avg INTEGER,
  heart_rate_max INTEGER,
  splits JSONB DEFAULT '[]'::jsonb,
  is_active BOOLEAN DEFAULT true,
  structured_workout_id VARCHAR(255),
  workout_progress JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_workout_sessions_route_id ON workout_sessions(route_id);
CREATE INDEX IF NOT EXISTS idx_workout_sessions_start_time ON workout_sessions(start_time);
CREATE INDEX IF NOT EXISTS idx_workout_sessions_is_active ON workout_sessions(is_active);
CREATE INDEX IF NOT EXISTS idx_routes_difficulty ON routes(difficulty);
CREATE INDEX IF NOT EXISTS idx_routes_distance ON routes(distance);

-- @down
-- Rollback: Drop all tables and indexes

DROP INDEX IF EXISTS idx_routes_distance;
DROP INDEX IF EXISTS idx_routes_difficulty;
DROP INDEX IF EXISTS idx_workout_sessions_is_active;
DROP INDEX IF EXISTS idx_workout_sessions_start_time;
DROP INDEX IF EXISTS idx_workout_sessions_route_id;

DROP TABLE IF EXISTS workout_sessions;
DROP TABLE IF EXISTS routes;
