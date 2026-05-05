const Database = require('better-sqlite3');
const path = require('path');

let db = null;

function init() {
  try {
    const dbPath = path.join(__dirname, '../database.db');
    db = new Database(dbPath);
    db.pragma('foreign_keys = ON');

    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sessionId TEXT UNIQUE NOT NULL,
        city TEXT NOT NULL,
        sites_found INTEGER DEFAULT 0,
        ip TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_createdAt ON sessions(createdAt);

      CREATE TABLE IF NOT EXISTS generations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        jobId TEXT UNIQUE NOT NULL,
        city TEXT NOT NULL,
        building_type TEXT NOT NULL,
        stories TEXT,
        images_generated INTEGER DEFAULT 0,
        status TEXT DEFAULT 'completed',
        user_id INTEGER,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_generations_createdAt ON generations(createdAt);

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

      CREATE TABLE IF NOT EXISTS users (
        id        INTEGER PRIMARY KEY AUTOINCREMENT,
        google_id TEXT UNIQUE NOT NULL,
        email     TEXT NOT NULL,
        name      TEXT NOT NULL,
        credits   INTEGER NOT NULL DEFAULT 3,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_users_google_id ON users(google_id);

      CREATE TABLE IF NOT EXISTS captures (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        site_id    TEXT NOT NULL,
        type       TEXT NOT NULL,
        direction  TEXT,
        file_path  TEXT NOT NULL,
        proxy_url  TEXT NOT NULL,
        source_url TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_captures_site_id ON captures(site_id);
    `);

    // Add user_id column to generations if it doesn't exist yet (safe migration)
    try {
      db.exec(`ALTER TABLE generations ADD COLUMN user_id INTEGER`);
    } catch (_) {}

    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  }
}

function logSession(data) {
  try {
    if (!db) return;
    const { sessionId, city, sites_found, ip } = data;
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO sessions (sessionId, city, sites_found, ip, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(sessionId) DO UPDATE SET updatedAt = excluded.updatedAt
    `).run(sessionId, city, sites_found || 0, ip || null, now, now);
  } catch (error) {
    console.error('Error logging session:', error);
  }
}

function logGeneration(data) {
  try {
    if (!db) return;
    const { jobId, city, building_type, stories, images_generated, status = 'completed', user_id } = data;
    const now = new Date().toISOString();
    db.prepare(`
      INSERT INTO generations (jobId, city, building_type, stories, images_generated, status, user_id, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(jobId, city, building_type, stories, images_generated || 0, status, user_id || null, now, now);
  } catch (error) {
    console.error('Error logging generation:', error);
  }
}

function getStats() {
  try {
    if (!db) return {};
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    return {
      sessions: {
        total: db.prepare('SELECT COUNT(*) as c FROM sessions').get().c,
        today: db.prepare('SELECT COUNT(*) as c FROM sessions WHERE createdAt >= ?').get(todayStart).c,
        week:  db.prepare('SELECT COUNT(*) as c FROM sessions WHERE createdAt >= ?').get(weekStart).c,
      },
      images: {
        total: db.prepare('SELECT COALESCE(SUM(images_generated),0) as c FROM generations').get().c,
        today: db.prepare('SELECT COALESCE(SUM(images_generated),0) as c FROM generations WHERE createdAt >= ?').get(todayStart).c,
        week:  db.prepare('SELECT COALESCE(SUM(images_generated),0) as c FROM generations WHERE createdAt >= ?').get(weekStart).c,
      },
      dailyUsage: db.prepare(`
        SELECT DATE(createdAt) as date, COUNT(*) as session_count,
               COALESCE(SUM(images_generated),0) as total_images
        FROM (SELECT createdAt, 0 as images_generated FROM sessions
              UNION ALL SELECT createdAt, images_generated FROM generations)
        WHERE createdAt >= datetime('now', '-7 days')
        GROUP BY DATE(createdAt) ORDER BY date DESC
      `).all(),
      topCities: db.prepare(`SELECT city, COUNT(*) as count FROM sessions GROUP BY city ORDER BY count DESC LIMIT 10`).all(),
      topTypes:  db.prepare(`SELECT building_type, COUNT(*) as count FROM generations GROUP BY building_type ORDER BY count DESC LIMIT 10`).all(),
    };
  } catch (error) {
    console.error('Error getting stats:', error);
    return {};
  }
}

function getRecentSessions(limit = 10) {
  try {
    if (!db) return [];
    return db.prepare(`
      SELECT s.sessionId, s.city, s.sites_found, s.createdAt,
             COUNT(g.id) as generation_count, SUM(g.images_generated) as total_images
      FROM sessions s
      LEFT JOIN generations g ON DATE(s.createdAt) = DATE(g.createdAt)
      GROUP BY s.sessionId ORDER BY s.createdAt DESC LIMIT ?
    `).all(limit);
  } catch (error) {
    console.error('Error getting recent sessions:', error);
    return [];
  }
}

function clearOldLogs(daysToKeep = 90) {
  try {
    if (!db) return;
    const cutoff = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000).toISOString();
    db.prepare('DELETE FROM sessions WHERE createdAt < ?').run(cutoff);
    db.prepare('DELETE FROM generations WHERE createdAt < ?').run(cutoff);
  } catch (error) {
    console.error('Error clearing old logs:', error);
  }
}

function close() {
  try { if (db) db.close(); } catch (error) { console.error('Error closing database:', error); }
}

function getScrapedSites(city) {
  try {
    if (!db) return [];
    return db.prepare('SELECT * FROM scraped_sites WHERE city = ? ORDER BY scraped_at DESC LIMIT 15').all(city.trim().toLowerCase());
  } catch { return []; }
}

// ── User / credit functions ──────────────────────────────────────────────────

function findOrCreateUser(googleId, email, name) {
  if (!db) return null;
  const now = new Date().toISOString();
  db.prepare(`
    INSERT INTO users (google_id, email, name, credits, created_at, updated_at)
    VALUES (?, ?, ?, 3, ?, ?)
    ON CONFLICT(google_id) DO UPDATE SET email = excluded.email, name = excluded.name, updated_at = excluded.updated_at
  `).run(googleId, email, name, now, now);
  return db.prepare('SELECT * FROM users WHERE google_id = ?').get(googleId);
}

function getUserById(id) {
  if (!db) return null;
  return db.prepare('SELECT * FROM users WHERE id = ?').get(id) || null;
}

function getUserCredits(userId) {
  if (!db) return 0;
  const row = db.prepare('SELECT credits FROM users WHERE id = ?').get(userId);
  return row ? row.credits : 0;
}

function deductCredit(userId) {
  if (!db) return -1;
  const stmt = db.prepare('UPDATE users SET credits = credits - 1, updated_at = ? WHERE id = ? AND credits > 0');
  const result = stmt.run(new Date().toISOString(), userId);
  if (result.changes === 0) return -1; // insufficient credits
  return db.prepare('SELECT credits FROM users WHERE id = ?').get(userId).credits;
}

function getCreditsByIp(ip) {
  if (!db) return 0;
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const row = db.prepare(`
    SELECT COUNT(*) as c FROM generations g
    JOIN sessions s ON DATE(g.createdAt) = DATE(s.createdAt)
    WHERE s.ip = ? AND g.createdAt >= ?
  `).get(ip, since);
  return row ? row.c : 0;
}

// ── Capture cache functions ──────────────────────────────────────────────────

function cacheCapture(siteId, type, direction, filePath, proxyUrl, sourceUrl) {
  if (!db) return null;
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO captures (site_id, type, direction, file_path, proxy_url, source_url, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(siteId, type, direction || null, filePath, proxyUrl, sourceUrl || null, now);
  return result.lastInsertRowid;
}

function getCachedCaptures(siteId) {
  if (!db) return [];
  return db.prepare('SELECT * FROM captures WHERE site_id = ? ORDER BY id ASC').all(siteId);
}

function getCaptureById(id) {
  if (!db) return null;
  return db.prepare('SELECT * FROM captures WHERE id = ?').get(id) || null;
}

module.exports = {
  init,
  logSession,
  logGeneration,
  getStats,
  getRecentSessions,
  clearOldLogs,
  close,
  getScrapedSites,
  findOrCreateUser,
  getUserById,
  getUserCredits,
  deductCredit,
  getCreditsByIp,
  cacheCapture,
  getCachedCaptures,
  getCaptureById,
};
