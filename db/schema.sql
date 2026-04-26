-- Site Scout Database Schema
-- SQLite database for logging sessions and generations

-- Sessions table: tracks user city searches
CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sessionId TEXT UNIQUE NOT NULL,
  city TEXT NOT NULL,
  sites_found INTEGER DEFAULT 0,
  ip TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

-- Generations table: tracks building visualizations created
CREATE TABLE IF NOT EXISTS generations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  jobId TEXT UNIQUE NOT NULL,
  city TEXT NOT NULL,
  building_type TEXT NOT NULL,
  stories TEXT,
  images_generated INTEGER DEFAULT 0,
  status TEXT DEFAULT 'completed',
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);

-- Indexes for faster queries
CREATE INDEX IF NOT EXISTS idx_sessions_createdAt ON sessions(createdAt);
CREATE INDEX IF NOT EXISTS idx_sessions_city ON sessions(city);
CREATE INDEX IF NOT EXISTS idx_generations_createdAt ON generations(createdAt);
CREATE INDEX IF NOT EXISTS idx_generations_building_type ON generations(building_type);
CREATE INDEX IF NOT EXISTS idx_generations_status ON generations(status);
