-- Site Scout Database Schema

CREATE TABLE IF NOT EXISTS sessions (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  sessionId TEXT UNIQUE NOT NULL,
  city      TEXT NOT NULL,
  sites_found INTEGER DEFAULT 0,
  ip        TEXT,
  createdAt TEXT NOT NULL,
  updatedAt TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_createdAt ON sessions(createdAt);
CREATE INDEX IF NOT EXISTS idx_sessions_city ON sessions(city);

CREATE TABLE IF NOT EXISTS generations (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  jobId            TEXT UNIQUE NOT NULL,
  city             TEXT NOT NULL,
  building_type    TEXT NOT NULL,
  stories          TEXT,
  images_generated INTEGER DEFAULT 0,
  status           TEXT DEFAULT 'completed',
  user_id          INTEGER REFERENCES users(id),
  createdAt        TEXT NOT NULL,
  updatedAt        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_generations_createdAt    ON generations(createdAt);
CREATE INDEX IF NOT EXISTS idx_generations_building_type ON generations(building_type);
CREATE INDEX IF NOT EXISTS idx_generations_status        ON generations(status);

-- Pre-scraped brownfield/vacant sites from Overpass API + ArcGIS satellite images
-- Populated locally via: node admin/run-scrape.js [city|--all]
CREATE TABLE IF NOT EXISTS scraped_sites (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  city       TEXT NOT NULL,
  name       TEXT NOT NULL,
  address    TEXT,
  lat        REAL NOT NULL,
  lng        REAL NOT NULL,
  site_type  TEXT DEFAULT 'brownfield',
  area_m2    REAL,
  image_url  TEXT,
  source     TEXT DEFAULT 'overpass',
  scraped_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scraped_sites_city ON scraped_sites(city);

-- Google OAuth users with credit balance
CREATE TABLE IF NOT EXISTS users (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  google_id  TEXT UNIQUE NOT NULL,
  email      TEXT NOT NULL,
  name       TEXT NOT NULL,
  credits    INTEGER NOT NULL DEFAULT 3,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);

-- Cached capture images (satellite, bird's eye, street view) per site
CREATE TABLE IF NOT EXISTS captures (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id    TEXT NOT NULL,
  type       TEXT NOT NULL,   -- 'satellite' | 'birdseye' | 'streetview'
  direction  TEXT,            -- 'N' | 'S' | 'E' | 'W' | null for satellite
  file_path  TEXT NOT NULL,
  proxy_url  TEXT NOT NULL,
  source_url TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_captures_site_id ON captures(site_id);
