const express = require('express');
const router = express.Router();
const path = require('path');

// Main app page
router.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// SPA permalink + gallery — serve same HTML; client JS detects the path
router.get('/explore', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});
router.get('/p/:id', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// Admin dashboard page
router.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/admin.html'));
});

// Health check
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

module.exports = router;
