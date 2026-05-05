const https = require('https');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const usageLogger = require('./usage-logger');

const SITE_IMAGES_DIR = path.join(__dirname, '../public/site-images');

function ensureDir() {
  if (!fs.existsSync(SITE_IMAGES_DIR)) fs.mkdirSync(SITE_IMAGES_DIR, { recursive: true });
}

// Fetch a URL and return { buffer, contentType }
function fetchImageBuffer(url) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'GET',
      headers: { 'User-Agent': 'SiteScout/1.0' },
    };
    const req = https.request(opts, res => {
      // Follow one redirect
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
        return fetchImageBuffer(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      const contentType = res.headers['content-type'] || '';
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ buffer: Buffer.concat(chunks), contentType }));
    });
    req.on('error', reject);
    req.end();
  });
}

function saveCapture(buffer, filename) {
  ensureDir();
  const filePath = path.join(SITE_IMAGES_DIR, filename);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

function buildArcGISUrl(lat, lng) {
  const offset = 0.003; // ~300m
  const bbox = `${lng - offset},${lat - offset},${lng + offset},${lat + offset}`;
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=${bbox}&bboxSR=4326&size=640,480&imageSR=4326&format=jpg&f=image`;
}

async function captureSatellite(lat, lng, siteId) {
  const url = buildArcGISUrl(lat, lng);
  const filename = `cap-${siteId}-satellite.jpg`;
  try {
    const { buffer, contentType } = await fetchImageBuffer(url);
    if (!contentType.includes('image')) throw new Error(`Non-image response: ${contentType}`);
    const filePath = saveCapture(buffer, filename);
    const proxyUrl = `/api/capture/file/${filename}`;
    return { type: 'satellite', direction: null, filePath, proxyUrl, sourceUrl: url };
  } catch (err) {
    console.warn('[capture] satellite failed:', err.message);
    return null;
  }
}

async function captureBirdseye(lat, lng, siteId) {
  const key = process.env.BING_MAPS_KEY;
  if (!key) return [];

  const directions = ['North', 'South', 'East', 'West'];
  const results = [];

  for (const dir of directions) {
    const url = `https://dev.virtualearth.net/REST/v1/Imagery/Map/Birdseye/${lat},${lng}/19?dir=${dir}&mapSize=640,480&key=${key}`;
    const filename = `cap-${siteId}-birdseye-${dir[0]}.jpg`;
    try {
      const { buffer, contentType } = await fetchImageBuffer(url);
      if (!contentType.includes('image/jpeg') && !contentType.includes('image/png')) {
        console.warn(`[capture] birdseye ${dir}: no coverage (content-type: ${contentType})`);
        continue;
      }
      const filePath = saveCapture(buffer, filename);
      const proxyUrl = `/api/capture/file/${filename}`;
      results.push({ type: 'birdseye', direction: dir[0], filePath, proxyUrl, sourceUrl: url });
    } catch (err) {
      console.warn(`[capture] birdseye ${dir} failed:`, err.message);
    }
  }
  return results;
}

async function checkStreetViewCoverage(lat, lng) {
  const key = process.env.GOOGLE_STREETVIEW_KEY;
  if (!key) return false;
  const url = `https://maps.googleapis.com/maps/api/streetview/metadata?location=${lat},${lng}&key=${key}`;
  try {
    const { buffer } = await fetchImageBuffer(url);
    const data = JSON.parse(buffer.toString());
    return data.status === 'OK';
  } catch {
    return false;
  }
}

async function captureStreetView(lat, lng, siteId) {
  const key = process.env.GOOGLE_STREETVIEW_KEY;
  if (!key) return [];

  const hasCoverage = await checkStreetViewCoverage(lat, lng);
  if (!hasCoverage) {
    console.warn(`[capture] no Street View coverage at ${lat},${lng}`);
    return [];
  }

  const headings = [
    { heading: 0,   dir: 'N' },
    { heading: 90,  dir: 'E' },
    { heading: 180, dir: 'S' },
    { heading: 270, dir: 'W' },
  ];
  const results = [];

  for (const { heading, dir } of headings) {
    const url = `https://maps.googleapis.com/maps/api/streetview?size=640x480&location=${lat},${lng}&heading=${heading}&pitch=10&fov=90&key=${key}`;
    const filename = `cap-${siteId}-street-${dir}.jpg`;
    try {
      const { buffer, contentType } = await fetchImageBuffer(url);
      if (!contentType.includes('image')) continue;
      const filePath = saveCapture(buffer, filename);
      const proxyUrl = `/api/capture/file/${filename}`;
      results.push({ type: 'streetview', direction: dir, filePath, proxyUrl, sourceUrl: url });
    } catch (err) {
      console.warn(`[capture] street ${dir} failed:`, err.message);
    }
  }
  return results;
}

async function captureAll(lat, lng, siteId) {
  // Check DB cache first
  const cached = usageLogger.getCachedCaptures(String(siteId));
  if (cached.length > 0) {
    // Verify files still exist; if not, re-fetch
    const allExist = cached.every(c => fs.existsSync(path.join(__dirname, '..', c.file_path.replace(/^\//, ''))));
    if (allExist) {
      return cached.map(c => ({
        id: c.id,
        type: c.type,
        direction: c.direction,
        proxyUrl: c.proxy_url,
        label: captureLabel(c.type, c.direction),
      }));
    }
  }

  // Fetch fresh
  const [satellite, birdseye, streetview] = await Promise.all([
    captureSatellite(lat, lng, siteId),
    captureBirdseye(lat, lng, siteId),
    captureStreetView(lat, lng, siteId),
  ]);

  const all = [satellite, ...birdseye, ...streetview].filter(Boolean);

  // Persist to DB
  const results = [];
  for (const c of all) {
    const id = usageLogger.cacheCapture(String(siteId), c.type, c.direction, c.filePath, c.proxyUrl, c.sourceUrl);
    results.push({
      id,
      type: c.type,
      direction: c.direction,
      proxyUrl: c.proxyUrl,
      label: captureLabel(c.type, c.direction),
    });
  }

  return results;
}

function captureLabel(type, direction) {
  if (type === 'satellite') return 'Satellite (Top-down)';
  if (type === 'birdseye') {
    const dirs = { N: 'North', S: 'South', E: 'East', W: 'West' };
    return `Bird\'s Eye — ${dirs[direction] || direction}`;
  }
  if (type === 'streetview') {
    const dirs = { N: 'North', S: 'South', E: 'East', W: 'West' };
    return `Street Level — ${dirs[direction] || direction}`;
  }
  return type;
}

// Re-fetch a single capture's image bytes (for when file is missing after Railway restart)
async function refetchCapture(capture) {
  if (!capture.source_url) return null;
  try {
    const { buffer } = await fetchImageBuffer(capture.source_url);
    return buffer;
  } catch {
    return null;
  }
}

module.exports = { captureAll, refetchCapture, captureLabel };
