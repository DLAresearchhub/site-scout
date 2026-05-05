const https = require('https');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const usageLogger = require('./usage-logger');

const SITE_IMAGES_DIR = path.join(__dirname, '../public/site-images');

function ensureDir() {
  if (!fs.existsSync(SITE_IMAGES_DIR)) fs.mkdirSync(SITE_IMAGES_DIR, { recursive: true });
}

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
      if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
        return fetchImageBuffer(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${u.hostname}`));
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

// ── ArcGIS top-down satellite ─────────────────────────────────────────────

function buildArcGISUrl(lat, lng) {
  const offset = 0.003;
  const bbox = `${lng - offset},${lat - offset},${lng + offset},${lat + offset}`;
  return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export?bbox=${bbox}&bboxSR=4326&size=640,480&imageSR=4326&format=jpg&f=image`;
}

async function captureSatellite(lat, lng, siteId) {
  const url = buildArcGISUrl(lat, lng);
  const filename = `cap-${siteId}-satellite.jpg`;
  try {
    const { buffer, contentType } = await fetchImageBuffer(url);
    if (!contentType.includes('image')) throw new Error(`Non-image: ${contentType}`);
    const filePath = saveCapture(buffer, filename);
    return { type: 'satellite', direction: null, filePath, proxyUrl: `/api/capture/file/${filename}`, sourceUrl: url };
  } catch (err) {
    console.warn('[capture] satellite failed:', err.message);
    return null;
  }
}

// ── Mapbox 3D perspective (4 directions, 55° pitch) ───────────────────────

function buildMapboxUrl(lat, lng, bearing) {
  const token = process.env.MAPBOX_TOKEN;
  // zoom 17 = good street detail; pitch 55 = strong 3D angle showing buildings
  return `https://api.mapbox.com/styles/v1/mapbox/satellite-streets-v12/static/${lng},${lat},17,${bearing},55/640x480?access_token=${token}`;
}

async function captureMapbox3D(lat, lng, siteId) {
  const token = process.env.MAPBOX_TOKEN;
  if (!token) return [];

  const directions = [
    { bearing: 0,   dir: 'N', label: 'North' },
    { bearing: 90,  dir: 'E', label: 'East'  },
    { bearing: 180, dir: 'S', label: 'South' },
    { bearing: 270, dir: 'W', label: 'West'  },
  ];
  const results = [];

  for (const { bearing, dir, label } of directions) {
    const url = buildMapboxUrl(lat, lng, bearing);
    const filename = `cap-${siteId}-3d-${dir}.jpg`;
    try {
      const { buffer, contentType } = await fetchImageBuffer(url);
      if (!contentType.includes('image/jpeg') && !contentType.includes('image/png')) {
        console.warn(`[capture] Mapbox 3D ${label}: unexpected content-type ${contentType}`);
        continue;
      }
      const filePath = saveCapture(buffer, filename);
      results.push({ type: 'mapbox3d', direction: dir, filePath, proxyUrl: `/api/capture/file/${filename}`, sourceUrl: url });
    } catch (err) {
      console.warn(`[capture] Mapbox 3D ${label} failed:`, err.message);
    }
  }
  return results;
}

// ── Bing Bird's Eye ───────────────────────────────────────────────────────

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
      if (!contentType.includes('image/jpeg') && !contentType.includes('image/png')) continue;
      const filePath = saveCapture(buffer, filename);
      results.push({ type: 'birdseye', direction: dir[0], filePath, proxyUrl: `/api/capture/file/${filename}`, sourceUrl: url });
    } catch (err) {
      console.warn(`[capture] birdseye ${dir} failed:`, err.message);
    }
  }
  return results;
}

// ── Google Street View ────────────────────────────────────────────────────

async function checkStreetViewCoverage(lat, lng) {
  const key = process.env.GOOGLE_STREETVIEW_KEY;
  if (!key) return false;
  try {
    const { buffer } = await fetchImageBuffer(
      `https://maps.googleapis.com/maps/api/streetview/metadata?location=${lat},${lng}&key=${key}`
    );
    return JSON.parse(buffer.toString()).status === 'OK';
  } catch { return false; }
}

async function captureStreetView(lat, lng, siteId) {
  const key = process.env.GOOGLE_STREETVIEW_KEY;
  if (!key) return [];
  if (!(await checkStreetViewCoverage(lat, lng))) return [];

  const headings = [{ h: 0, dir: 'N' }, { h: 90, dir: 'E' }, { h: 180, dir: 'S' }, { h: 270, dir: 'W' }];
  const results = [];

  for (const { h, dir } of headings) {
    const url = `https://maps.googleapis.com/maps/api/streetview?size=640x480&location=${lat},${lng}&heading=${h}&pitch=10&fov=90&key=${key}`;
    const filename = `cap-${siteId}-street-${dir}.jpg`;
    try {
      const { buffer, contentType } = await fetchImageBuffer(url);
      if (!contentType.includes('image')) continue;
      const filePath = saveCapture(buffer, filename);
      results.push({ type: 'streetview', direction: dir, filePath, proxyUrl: `/api/capture/file/${filename}`, sourceUrl: url });
    } catch (err) {
      console.warn(`[capture] street ${dir} failed:`, err.message);
    }
  }
  return results;
}

// ── Labels ────────────────────────────────────────────────────────────────

function captureLabel(type, direction) {
  const dirs = { N: 'North', S: 'South', E: 'East', W: 'West' };
  if (type === 'satellite')  return 'Satellite (Top-down)';
  if (type === 'mapbox3d')   return `3D View — ${dirs[direction] || direction}`;
  if (type === 'birdseye')   return `Bird\'s Eye — ${dirs[direction] || direction}`;
  if (type === 'streetview') return `Street Level — ${dirs[direction] || direction}`;
  return type;
}

// ── Main entry point ──────────────────────────────────────────────────────

async function captureAll(lat, lng, siteId) {
  // Check DB cache first
  const cached = usageLogger.getCachedCaptures(String(siteId));
  if (cached.length > 0) {
    const allExist = cached.every(c => {
      const rel = c.file_path.replace(/^\//, '').replace(/\\/g, '/');
      return fs.existsSync(path.join(__dirname, '..', rel));
    });
    if (allExist) {
      return cached.map(c => ({
        id: c.id, type: c.type, direction: c.direction,
        proxyUrl: c.proxy_url, label: captureLabel(c.type, c.direction),
      }));
    }
    // Files gone (Railway restart) — clear cache and re-fetch
    // (can't delete from DB easily without a new method, just re-fetch and overwrite files)
  }

  // Fetch all capture types in parallel
  const [satellite, mapbox3d, birdseye, streetview] = await Promise.all([
    captureSatellite(lat, lng, siteId),
    captureMapbox3D(lat, lng, siteId),
    captureBirdseye(lat, lng, siteId),
    captureStreetView(lat, lng, siteId),
  ]);

  // Order: satellite first, then 3D (best for generation), then birdseye, then street
  const all = [satellite, ...mapbox3d, ...birdseye, ...streetview].filter(Boolean);

  // Persist and return
  const results = [];
  for (const c of all) {
    const id = usageLogger.cacheCapture(String(siteId), c.type, c.direction, c.filePath, c.proxyUrl, c.sourceUrl);
    results.push({ id, type: c.type, direction: c.direction, proxyUrl: c.proxyUrl, label: captureLabel(c.type, c.direction) });
  }
  return results;
}

async function refetchCapture(capture) {
  if (!capture.source_url) return null;
  try {
    const { buffer } = await fetchImageBuffer(capture.source_url);
    return buffer;
  } catch { return null; }
}

module.exports = { captureAll, refetchCapture, captureLabel };
