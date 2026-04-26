const express = require('express');
const router = express.Router();
const usageLogger = require('../services/usage-logger');

/**
 * POST /admin/login
 * Authenticate with admin password
 */
router.post('/login', (req, res) => {
  try {
    const { password } = req.body;

    if (!password) {
      return res.status(400).json({ error: 'Password is required' });
    }

    const adminPassword = process.env.ADMIN_PASSWORD || 'changeme';

    if (password !== adminPassword) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    req.session.admin = true;
    req.session.loggedInAt = new Date();

    res.json({
      success: true,
      message: 'Logged in successfully'
    });
  } catch (error) {
    console.error('Error logging in:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

/**
 * POST /admin/logout
 * Clear admin session
 */
router.post('/logout', (req, res) => {
  req.session.admin = false;
  res.json({ success: true, message: 'Logged out' });
});

/**
 * GET /admin/stats
 * Get usage statistics (requires admin session)
 */
router.get('/stats', (req, res) => {
  try {
    // Check admin session
    if (!req.session.admin) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const stats = usageLogger.getStats();
    const recentSessions = usageLogger.getRecentSessions(10);

    res.json({
      ...stats,
      recentSessions
    });
  } catch (error) {
    console.error('Error getting stats:', error);
    res.status(500).json({ error: 'Failed to get statistics' });
  }
});

/**
 * GET /admin/check-auth
 * Check if user is authenticated as admin
 */
router.get('/check-auth', (req, res) => {
  res.json({
    authenticated: !!req.session.admin
  });
});

module.exports = router;
