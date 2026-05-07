'use strict';

const https = require('https');

function httpsGetJson(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'GET',
      headers: { 'Accept': 'application/json', 'User-Agent': 'SiteScout/1.0', ...headers },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function httpsPostForm(url, body, headers = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const buf = Buffer.from(body);
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': buf.length,
        'Accept': 'application/json',
        'User-Agent': 'SiteScout/1.0',
        ...headers,
      },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}: ${text.slice(0, 120)}`));
        try { resolve(JSON.parse(text)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(buf);
    req.end();
  });
}

// ── UK Environment Agency: flood-warning areas within radius ─────────────────

async function getFloodRisk(lat, lng) {
  const dist = 2; // km
  const url = `https://environment.data.gov.uk/flood-monitoring/id/floodAreas?lat=${lat}&long=${lng}&dist=${dist}`;
  const data = await httpsGetJson(url);
  const items = (data && data.items) || [];
  const areas = items.slice(0, 5).map(a => ({
    label: a.label || a.notation,
    description: a.description || null,
    riverOrSea: a.riverOrSea || null,
  }));
  let summary, severity;
  if (items.length === 0) {
    summary = `No designated flood-warning areas within ${dist} km`;
    severity = 'none';
  } else if (items.length <= 2) {
    summary = `${items.length} flood-warning area${items.length === 1 ? '' : 's'} within ${dist} km`;
    severity = 'low';
  } else {
    summary = `${items.length} flood-warning areas within ${dist} km — review carefully`;
    severity = 'high';
  }
  return { source: 'UK Environment Agency', summary, severity, count: items.length, areas, radiusKm: dist };
}

// ── Overpass: walkable amenities within 800 m ────────────────────────────────

async function getAmenities(lat, lng) {
  const r = 800; // metres
  const ql = `[out:json][timeout:15];
(
  node(around:${r},${lat},${lng})[amenity=school];
  way(around:${r},${lat},${lng})[amenity=school];
  node(around:${r},${lat},${lng})[amenity=hospital];
  way(around:${r},${lat},${lng})[amenity=hospital];
  node(around:${r},${lat},${lng})[railway=station];
  node(around:${r},${lat},${lng})[public_transport=station];
  node(around:${r},${lat},${lng})[shop=supermarket];
  way(around:${r},${lat},${lng})[shop=supermarket];
  way(around:${r},${lat},${lng})[leisure=park];
  way(around:${r},${lat},${lng})[leisure=garden];
);
out tags center;`;

  const endpoints = [
    'https://overpass-api.de/api/interpreter',
    'https://overpass.kumi.systems/api/interpreter',
  ];

  let data, lastErr;
  for (const ep of endpoints) {
    try { data = await httpsPostForm(ep, 'data=' + encodeURIComponent(ql)); break; }
    catch (e) { lastErr = e; }
  }
  if (!data) throw lastErr || new Error('Overpass unreachable');

  const elements = data.elements || [];
  const tally = { schools: [], hospitals: [], stations: [], supermarkets: [], parks: [] };
  for (const el of elements) {
    const t = el.tags || {};
    const name = t.name || null;
    if (t.amenity === 'school')             tally.schools.push(name);
    else if (t.amenity === 'hospital')      tally.hospitals.push(name);
    else if (t.railway === 'station' || t.public_transport === 'station') tally.stations.push(name);
    else if (t.shop === 'supermarket')      tally.supermarkets.push(name);
    else if (t.leisure === 'park' || t.leisure === 'garden') tally.parks.push(name);
  }
  return {
    source: 'OpenStreetMap',
    radiusMeters: r,
    counts: {
      schools: tally.schools.length,
      hospitals: tally.hospitals.length,
      stations: tally.stations.length,
      supermarkets: tally.supermarkets.length,
      parks: tally.parks.length,
    },
    samples: {
      schools: tally.schools.filter(Boolean).slice(0, 3),
      hospitals: tally.hospitals.filter(Boolean).slice(0, 3),
      stations: tally.stations.filter(Boolean).slice(0, 3),
      supermarkets: tally.supermarkets.filter(Boolean).slice(0, 3),
      parks: tally.parks.filter(Boolean).slice(0, 3),
    },
  };
}

module.exports = { getFloodRisk, getAmenities };
