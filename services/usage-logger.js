/**
 * Usage Logger Service
 * Logs user sessions and generation activities to SQLite
 */

const Database = require('better-sqlite3');
const path = require('path');

let db = null;

/**
 * Initialize database and create tables
 */
function init() {
  try {
    const dbPath = path.join(__dirname, '../database.db');
    db = new Database(dbPath);

    // Enable foreign keys
    db.pragma('foreign_keys = ON');

    // Create sessions table
    db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sessionId TEXT UNIQUE NOT NULL,
        city TEXT NOT NULL,
        sites_found INTEGER DEFAULT 0,
        ip TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
      )
    `);

    // Create generations table
    db.exec(`
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
      )
    `);

    // Create indexes for faster queries
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_sessions_createdAt ON sessions(createdAt);
      CREATE INDEX IF NOT EXISTS idx_generations_createdAt ON generations(createdAt);
    `);

    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Error initializing database:', error);
    throw error;
  }
}

/**
 * Log a user session (city search)
 * @param {Object} data - Session data
 */
function logSession(data) {
  try {
    if (!db) {
      console.error('Database not initialized');
      return;
    }

    const { sessionId, city, sites_found, ip } = data;
    const now = new Date().toISOString();

    const stmt = db.prepare(`
      INSERT INTO sessions (sessionId, city, sites_found, ip, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(sessionId) DO UPDATE SET
        updatedAt = excluded.updatedAt
    `);

    stmt.run(sessionId, city, sites_found || 0, ip || null, now, now);
  } catch (error) {
    console.error('Error logging session:', error);
  }
}

/**
 * Log a generation event
 * @param {Object} data - Generation data
 */
function logGeneration(data) {
  try {
    if (!db) {
      console.error('Database not initialized');
      return;
    }

    const {
      jobId,
      city,
      building_type,
      stories,
      images_generated,
      status = 'completed'
    } = data;
    const now = new Date().toISOString();

    const stmt = db.prepare(`
      INSERT INTO generations (jobId, city, building_type, stories, images_generated, status, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(jobId, city, building_type, stories, images_generated || 0, status, now, now);
  } catch (error) {
    console.error('Error logging generation:', error);
  }
}

/**
 * Get aggregated usage statistics
 * @returns {Object} Stats object
 */
function getStats() {
  try {
    if (!db) {
      console.error('Database not initialized');
      return {};
    }

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();

    // Total sessions
    const totalSessions = db.prepare('SELECT COUNT(*) as count FROM sessions').get().count;
    const todaysSessions = db.prepare(
      'SELECT COUNT(*) as count FROM sessions WHERE createdAt >= ?'
    ).get(todayStart).count;
    const weeksSessions = db.prepare(
      'SELECT COUNT(*) as count FROM sessions WHERE createdAt >= ?'
    ).get(weekStart).count;

    // Total images
    const totalImages = db.prepare(
      'SELECT SUM(images_generated) as count FROM generations'
    ).get().count || 0;
    const todaysImages = db.prepare(
      'SELECT SUM(images_generated) as count FROM generations WHERE createdAt >= ?'
    ).get(todayStart).count || 0;
    const weeksImages = db.prepare(
      'SELECT SUM(images_generated) as count FROM generations WHERE createdAt >= ?'
    ).get(weekStart).count || 0;

    // Daily usage (last 7 days)
    const dailyUsage = db.prepare(`
      SELECT 
        DATE(createdAt) as date,
        COUNT(*) as session_count,
        COALESCE(SUM(images_generated), 0) as total_images
      FROM (
        SELECT createdAt, 0 as images_generated FROM sessions
        UNION ALL
        SELECT createdAt, images_generated FROM generations
      )
      WHERE createdAt >= datetime('now', '-7 days')
      GROUP BY DATE(createdAt)
      ORDER BY date DESC
    `).all();

    // Top cities
    const topCities = db.prepare(`
      SELECT city, COUNT(*) as count
      FROM sessions
      GROUP BY city
      ORDER BY count DESC
      LIMIT 10
    `).all();

    // Top building types
    const topTypes = db.prepare(`
      SELECT building_type, COUNT(*) as count
      FROM generations
      GROUP BY building_type
      ORDER BY count DESC
      LIMIT 10
    `).all();

    return {
      sessions: {
        total: totalSessions,
        today: todaysSessions,
        week: weeksSessions
      },
      images: {
        total: totalImages,
        today: todaysImages,
        week: weeksImages
      },
      dailyUsage,
      topCities,
      topTypes
    };
  } catch (error) {
    console.error('Error getting stats:', error);
    return {};
  }
}

/**
 * Get recent sessions
 * @param {number} limit - Number of sessions to retrieve
 * @returns {Array} Array of session objects
 */
function getRecentSessions(limit = 10) {
  try {
    if (!db) {
      console.error('Database not initialized');
      return [];
    }

    const sessions = db.prepare(`
      SELECT 
        s.sessionId,
        s.city,
        s.sites_found,
        s.createdAt,
        COUNT(g.id) as generation_count,
        SUM(g.images_generated) as total_images
      FROM sessions s
      LEFT JOIN generations g ON DATE(s.createdAt) = DATE(g.createdAt)
      GROUP BY s.sessionId
      ORDER BY s.createdAt DESC
      LIMIT ?
    `).all(limit);

    return sessions;
  } catch (error) {
    console.error('Error getting recent sessions:', error);
    return [];
  }
}

/**
 * Clear old logs (retention policy)
 * @param {number} daysToKeep - Number of days to retain
 */
function clearOldLogs(daysToKeep = 90) {
  try {
    if (!db) {
      console.error('Database not initialized');
      return;
    }

    const cutoffDate = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000).toISOString();

    db.prepare('DELETE FROM sessions WHERE createdAt < ?').run(cutoffDate);
    db.prepare('DELETE FROM generations WHERE createdAt < ?').run(cutoffDate);

    console.log(`Cleared logs older than ${daysToKeep} days`);
  } catch (error) {
    console.error('Error clearing old logs:', error);
  }
}

/**
 * Close database connection
 */
function close() {
  try {
    if (db) {
      db.close();
      console.log('Database connection closed');
    }
  } catch (error) {
    console.error('Error closing database:', error);
  }
}

module.exports = {
  init,
  logSession,
  logGeneration,
  getStats,
  getRecentSessions,
  clearOldLogs,
  close
};
