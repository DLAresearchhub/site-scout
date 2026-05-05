'use strict';

const https = require('https');

/**
 * POST to a URL using Node's https module (avoids Node 24 fetch header issues).
 */
function httpsPost(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const bodyBuf = Buffer.from(body);
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': bodyBuf.length,
        'Accept': '*/*',
        'User-Agent': 'SiteScout/1.0',
        ...headers,
      },
    };
    const req = https.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        if (res.statusCode !== 200) {
          reject(new Error(`HTTP ${res.statusCode}: ${text.slice(0, 100)}`));
        } else {
          resolve(text);
        }
      });
    });
    req.on('error', reject);
    req.write(bodyBuf);
    req.end();
  });
}

/**
 * admin/scraper.js
 *
 * Queries the Overpass API (OpenStreetMap) for real vacant/brownfield sites
 * in a city, then generates ArcGIS satellite image URLs for each one.
 * Stores everything in the scraped_sites DB table.
 *
 * No API keys required — Overpass and ArcGIS World Imagery are both free.
 *
 * Usage (via run-scrape.js):
 *   node admin/run-scrape.js Leeds
 *   node admin/run-scrape.js --all
 */

// City bounding boxes [south, west, north, east]
const CITY_BBOXES = {
  london:       [51.46, -0.18,  51.54, -0.05],
  manchester:   [53.44, -2.30,  53.53, -2.16],
  leeds:        [53.77, -1.61,  53.83, -1.48],
  birmingham:   [52.44, -1.97,  52.52, -1.80],
  bristol:      [51.42, -2.65,  51.49, -2.54],
  sheffield:    [53.35, -1.52,  53.42, -1.44],
  liverpool:    [53.38, -3.01,  53.44, -2.91],
  edinburgh:    [55.92, -3.22,  55.98, -3.14],
  glasgow:      [55.83, -4.30,  55.90, -4.22],
  newcastle:    [54.96, -1.67,  54.99, -1.59],
  nottingham:   [52.92, -1.19,  52.97, -1.13],
  cardiff:      [51.46, -3.21,  51.50, -3.17],
  york:         [53.94, -1.12,  53.97, -1.07],
  leicester:    [52.62, -1.16,  52.65, -1.11],
  bradford:     [53.78, -1.78,  53.81, -1.74],
};

/**
 * Build an Overpass QL query for vacant/brownfield land in a bounding box.
 */
function buildOverpassQuery(bbox) {
  const [s, w, n, e] = bbox;
  const b = `${s},${w},${n},${e}`;
  return `
[out:json][timeout:30];
(
  way["landuse"="brownfield"](${b});
  way["landuse"="construction"](${b});
  way["landuse"="vacant"](${b});
  way["landuse"="landfill"](${b});
  way["abandoned:building"](${b});
  way["disused:landuse"](${b});
);
out center 25;
  `.trim();
}

/**
 * Query Overpass and return raw elements.
 */
async function queryOverpass(bbox) {
  const query = buildOverpassQuery(bbox);
  const body = 'data=' + encodeURIComponent(query);

  const endpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
  ];

  for (const url of endpoints) {
    try {
      const text = await httpsPost(url, body);
      const json = JSON.parse(text);
      return json.elements || [];
    } catch (err) {
      console.warn(`[Scraper] ${url} failed: ${err.message}`);
    }
  }
  throw new Error('All Overpass endpoints failed');
}

/**
 * Convert Overpass elements into normalised site objects.
 */
function parseElements(elements, cityName) {
  return elements
    .filter(el => el.center?.lat && el.center?.lon)
    .map(el => {
      const tags = el.tags || {};
      const streetParts = [
        tags['addr:housenumber'],
        tags['addr:street'],
        tags['addr:city'] || cityName,
      ].filter(Boolean);

      const siteType = tags.landuse
        || tags['abandoned:building'] && 'abandoned_building'
        || tags['disused:landuse']
        || 'brownfield';

      const name = tags.name
        || (tags['addr:street'] ? `${tags['addr:street']} Site` : null)
        || `${capitalise(siteType.replace(/_/g, ' '))} Site`;

      return {
        city: cityName.toLowerCase(),
        name,
        address: streetParts.length > 1 ? streetParts.join(', ') : `${name}, ${cityName}`,
        lat: el.center.lat,
        lng: el.center.lon,
        site_type: siteType,
        area_m2: null,
        source: 'overpass',
      };
    });
}

/**
 * Build an ArcGIS World Imagery export URL for a lat/lng.
 * Returns a direct PNG image at ~800×500px.
 * No API key required.
 */
function buildSatelliteImageUrl(lat, lng) {
  const w = (lng - 0.0018).toFixed(6);
  const s = (lat - 0.0012).toFixed(6);
  const e = (lng + 0.0018).toFixed(6);
  const n = (lat + 0.0012).toFixed(6);
  return (
    `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export` +
    `?bbox=${w},${s},${e},${n}&bboxSR=4326&size=800,500&format=png&f=image`
  );
}

/**
 * Scrape sites for a single city and insert into DB.
 * Clears existing scraped sites for that city first.
 *
 * @param {string} cityName
 * @param {import('better-sqlite3').Database} db
 * @returns {number} Number of sites stored
 */
async function scrapeCity(cityName, db) {
  const key = cityName.trim().toLowerCase();
  const bbox = CITY_BBOXES[key];

  if (!bbox) {
    console.error(`[Scraper] No bounding box defined for: ${cityName}`);
    console.error(`[Scraper] Available cities: ${Object.keys(CITY_BBOXES).join(', ')}`);
    return 0;
  }

  console.log(`[Scraper] Querying Overpass for ${cityName} (${bbox.join(', ')})...`);

  let elements;
  try {
    elements = await queryOverpass(bbox);
  } catch (err) {
    console.error(`[Scraper] Overpass query failed: ${err.message}`);
    return 0;
  }

  console.log(`[Scraper] Overpass returned ${elements.length} elements`);

  const sites = parseElements(elements, cityName);
  console.log(`[Scraper] Parsed ${sites.length} valid sites`);

  if (sites.length === 0) {
    console.warn(`[Scraper] No usable sites found for ${cityName}. Try expanding the bounding box.`);
    return 0;
  }

  // Keep up to 15 sites per city, spread across the bbox
  const toStore = sites.slice(0, 15);

  // Clear existing entries for this city
  db.prepare('DELETE FROM scraped_sites WHERE city = ?').run(key);

  const insert = db.prepare(`
    INSERT INTO scraped_sites
      (city, name, address, lat, lng, site_type, area_m2, image_url, source, scraped_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const now = new Date().toISOString();
  for (const site of toStore) {
    const imageUrl = buildSatelliteImageUrl(site.lat, site.lng);
    insert.run(
      site.city, site.name, site.address,
      site.lat, site.lng, site.site_type,
      site.area_m2, imageUrl, site.source, now
    );
  }

  console.log(`[Scraper] Stored ${toStore.length} sites for ${cityName}`);
  return toStore.length;
}

function capitalise(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

module.exports = { scrapeCity, CITY_BBOXES, buildSatelliteImageUrl };
