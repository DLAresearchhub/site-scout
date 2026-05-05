#!/usr/bin/env node
'use strict';

/**
 * admin/run-scrape.js
 *
 * CLI tool to pre-populate the scraped_sites database table.
 * Run this locally before deploying — the populated DB is committed to git
 * and served directly from Railway (no live scraping on the server).
 *
 * Usage:
 *   node admin/run-scrape.js Leeds
 *   node admin/run-scrape.js Leeds Manchester Sheffield
 *   node admin/run-scrape.js --all
 *
 * No API keys required.
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const Database = require('better-sqlite3');
const path = require('path');
const { scrapeCity, CITY_BBOXES } = require('./scraper');

const dbPath = path.join(__dirname, '../database.db');
const db = new Database(dbPath);

// Ensure the scraped_sites table exists
db.exec(`
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
`);

async function main() {
  const args = process.argv.slice(2);

  let cities;
  if (args.length === 0 || args[0] === '--all') {
    cities = Object.keys(CITY_BBOXES);
    console.log(`Scraping all ${cities.length} cities...`);
  } else {
    cities = args;
  }

  let totalStored = 0;
  for (const city of cities) {
    try {
      const count = await scrapeCity(city, db);
      totalStored += count;
    } catch (err) {
      console.error(`Failed to scrape ${city}:`, err.message);
    }
    // Respect Overpass rate limit — 1 query per 2 seconds
    if (cities.indexOf(city) < cities.length - 1) {
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  db.close();
  console.log(`\nDone. Total sites stored: ${totalStored}`);
  console.log('Commit database.db to deploy the pre-scraped data to Railway.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
