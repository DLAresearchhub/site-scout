const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const siteFinder = require('../services/site-finder');
const captureService = require('../services/capture-service');
const promptBuilder = require('../services/prompt-builder');
const imageGenerator = require('../services/image-generator');
const usageLogger = require('../services/usage-logger');
const overlays = require('../services/overlays');
const refAnalyzer = require('../services/ref-analyzer');
const presets = require('../services/presets');

const jobs = new Map();
const FREE_LIMIT = parseInt(process.env.FREE_GENERATIONS_IP || '3', 10);

// ── Auth / credits middleware ────────────────────────────────────────────────

async function checkCredits(req, res, next) {
  if (req.user) {
    const credits = usageLogger.getUserCredits(req.user.id);
    if (credits <= 0) return res.status(402).json({ error: 'No credits remaining', credits: 0 });
    req.creditSource = 'user';
  } else {
    const used = usageLogger.getCreditsByIp(req.ip);
    if (used >= FREE_LIMIT) return res.status(402).json({ error: 'Free limit reached. Sign in for more.', limit: FREE_LIMIT });
    req.creditSource = 'ip';
  }
  next();
}

// ── Free-text geocoding (Nominatim proxy) ───────────────────────────────────

router.get('/geocode', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.status(400).json({ error: 'q required' });
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&countrycodes=gb`;
    const data = await new Promise((resolve, reject) => {
      const httpsLib = require('https');
      const r = httpsLib.request({
        hostname: 'nominatim.openstreetmap.org',
        path: `/search?q=${encodeURIComponent(q)}&format=json&limit=1&countrycodes=gb`,
        method: 'GET',
        headers: { 'User-Agent': 'SiteScout/1.0 (sitescout@example.com)', 'Accept': 'application/json' },
      }, resp => {
        const chunks = [];
        resp.on('data', c => chunks.push(c));
        resp.on('end', () => {
          if (resp.statusCode !== 200) return reject(new Error('Nominatim ' + resp.statusCode));
          try { resolve(JSON.parse(Buffer.concat(chunks).toString())); } catch (e) { reject(e); }
        });
      });
      r.on('error', reject);
      r.end();
    });
    const top = (data && data[0]) || null;
    if (!top) return res.json({ found: false });
    res.json({
      found: true,
      lat: parseFloat(top.lat),
      lng: parseFloat(top.lon),
      displayName: top.display_name,
    });
  } catch (e) {
    console.error('[geocode]', e.message);
    res.status(502).json({ error: 'Geocoding failed', message: e.message });
  }
});

// ── Public client config ────────────────────────────────────────────────────

router.get('/config', (req, res) => {
  res.json({
    mapboxToken: process.env.MAPBOX_TOKEN || null,
    googleMapTilesKey: process.env.GOOGLE_MAPS_TILES_KEY || null,
  });
});

// ── Site overlays (Phase 1: Flood + Amenities; Listed/Solar stubs) ──────────

router.get('/overlay/flood', async (req, res) => {
  const lat = parseFloat(req.query.lat), lng = parseFloat(req.query.lng);
  if (!isFinite(lat) || !isFinite(lng)) return res.status(400).json({ error: 'lat & lng required' });
  try { res.json(await overlays.getFloodRisk(lat, lng)); }
  catch (e) {
    console.error('[overlay/flood]', e.message);
    res.status(502).json({ error: 'Flood data unavailable', message: e.message });
  }
});

router.get('/overlay/amenities', async (req, res) => {
  const lat = parseFloat(req.query.lat), lng = parseFloat(req.query.lng);
  if (!isFinite(lat) || !isFinite(lng)) return res.status(400).json({ error: 'lat & lng required' });
  try { res.json(await overlays.getAmenities(lat, lng)); }
  catch (e) {
    console.error('[overlay/amenities]', e.message);
    res.status(502).json({ error: 'Amenities unavailable', message: e.message });
  }
});

router.get('/overlay/listed', (req, res) => {
  res.json({ source: 'Historic England', notReady: true, message: 'Listed buildings overlay arrives in Phase 4 — needs the Historic England API wiring.' });
});

router.get('/overlay/solar', (req, res) => {
  res.json({ source: 'Google Solar API', notReady: true, message: 'Solar potential overlay arrives in Phase 4 — needs the Solar API enabled on your Google Cloud project.' });
});

// ── Presets per building type (drives the preset chip strip on Step 3) ──────

router.get('/presets', (req, res) => {
  res.json(presets.PRESETS);
});

// ── Follow-up "More photographs" generation ─────────────────────────────────
// Takes a previously-generated image URL and runs a second pass focused on
// human-scale lifestyle shots (street eye-level, plaza life, dog walkers).
const followupJobs = new Map();

router.post('/generate-followup', checkCredits, async (req, res) => {
  try {
    const { image_url, pill_state, preset_addendum, city } = req.body;
    if (!image_url || !pill_state || !pill_state.building_type) {
      return res.status(400).json({ error: 'image_url and pill_state.building_type are required' });
    }
    const jobId = uuidv4();
    followupJobs.set(jobId, { id: jobId, status: 'queued', progress: 0, images: [], error: null, message: '' });
    setImmediate(async () => {
      await processFollowupJob(jobId, { image_url, pill_state, preset_addendum, city, userId: req.user ? req.user.id : null });
    });
    res.json({ job_id: jobId, status: 'queued' });
  } catch (error) {
    console.error('Error queuing follow-up:', error);
    res.status(500).json({ error: 'Failed to queue follow-up' });
  }
});

router.get('/followup-status/:jobId', (req, res) => {
  const job = followupJobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json({ job_id: job.id, status: job.status, progress: job.progress, images: job.images, message: job.message || job.error });
});

// ── Capture from client-rendered canvas ─────────────────────────────────────

router.post('/capture-canvas', express.json({ limit: '12mb' }), (req, res) => {
  try {
    const { site_id, dataUrl, bearing, pitch, zoom } = req.body;
    if (!site_id || !dataUrl) return res.status(400).json({ error: 'site_id and dataUrl required' });

    const m = /^data:image\/(jpeg|jpg|png);base64,(.+)$/.exec(dataUrl);
    if (!m) return res.status(400).json({ error: 'dataUrl must be base64 image/jpeg or image/png' });

    const ext = m[1] === 'png' ? 'png' : 'jpg';
    const buffer = Buffer.from(m[2], 'base64');
    const safeId = String(site_id).replace(/[^a-z0-9-]/gi, '_').slice(0, 60);
    const filename = `cap-${safeId}-canvas-${Date.now()}.${ext}`;
    const dir = path.join(__dirname, '../public/site-images');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const absPath = path.join(dir, filename);
    fs.writeFileSync(absPath, buffer);

    // Store the path RELATIVE to project root so processGenerationJob's
    // path.join(__dirname, '..', file_path.replace(/^\//, '')) resolves correctly.
    const relPath = `/public/site-images/${filename}`;
    const proxyUrl = `/api/capture/file/${filename}`;
    const direction = (bearing != null) ? `b${Math.round(bearing)}p${Math.round(pitch || 0)}z${Math.round((zoom || 0) * 10) / 10}` : null;
    const id = usageLogger.cacheCapture(String(site_id), 'mapbox3d', direction, relPath, proxyUrl, null);

    res.json({ id, type: 'mapbox3d', direction, proxyUrl, label: '3D View — your angle' });
  } catch (error) {
    console.error('Error saving canvas capture:', error);
    res.status(500).json({ error: 'Failed to save capture' });
  }
});

// ── Search sites ─────────────────────────────────────────────────────────────

router.post('/search-sites', async (req, res) => {
  try {
    const { city } = req.body;
    if (!city || !city.trim()) return res.status(400).json({ error: 'City is required' });

    const sites = await siteFinder.findSites(city, { count: 20 });
    usageLogger.logSession({ city, sessionId: req.sessionID, ip: req.ip, sites_found: sites.length });
    res.json({ sites });
  } catch (error) {
    console.error('Error searching sites:', error);
    res.status(500).json({ error: 'Failed to search sites' });
  }
});

// ── Captures ─────────────────────────────────────────────────────────────────

router.post('/capture-site', async (req, res) => {
  try {
    const { site_id, lat, lng } = req.body;
    if (!site_id || lat === undefined || lng === undefined) {
      return res.status(400).json({ error: 'site_id, lat, and lng are required' });
    }

    const captures = await captureService.captureAll(parseFloat(lat), parseFloat(lng), site_id);
    res.json({ site_id, captures });
  } catch (error) {
    console.error('Error capturing site:', error);
    res.status(500).json({ error: 'Failed to capture site' });
  }
});

// Serve cached capture image by DB id (re-fetches if file missing after Railway restart)
router.get('/capture/:id', async (req, res) => {
  try {
    const capture = usageLogger.getCaptureById(parseInt(req.params.id, 10));
    if (!capture) return res.status(404).json({ error: 'Capture not found' });

    const filePath = path.join(__dirname, '..', capture.file_path.replace(/^\//, ''));
    if (fs.existsSync(filePath)) {
      return res.sendFile(filePath);
    }

    // File gone (Railway restart) — re-fetch from source
    const buffer = await captureService.refetchCapture(capture);
    if (!buffer) return res.status(404).json({ error: 'Capture unavailable' });

    // Re-save and serve
    fs.writeFileSync(filePath, buffer);
    res.set('Content-Type', 'image/jpeg').send(buffer);
  } catch (error) {
    console.error('Error serving capture:', error);
    res.status(500).json({ error: 'Failed to serve capture' });
  }
});

// Serve by filename (for captures stored in public/site-images/)
router.get('/capture/file/:filename', (req, res) => {
  const filePath = path.join(__dirname, '../public/site-images', req.params.filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });
  res.sendFile(filePath);
});

// ── Current user / credits ────────────────────────────────────────────────────

router.get('/me', (req, res) => {
  if (req.user) {
    const credits = usageLogger.getUserCredits(req.user.id);
    res.json({ authenticated: true, user: { name: req.user.name, email: req.user.email }, credits });
  } else {
    const used = usageLogger.getCreditsByIp(req.ip);
    res.json({ authenticated: false, freeUsed: used, freeLimit: FREE_LIMIT, credits: Math.max(0, FREE_LIMIT - used) });
  }
});

// ── Generate ─────────────────────────────────────────────────────────────────

router.post('/generate', checkCredits, async (req, res) => {
  try {
    const { site_id, capture_id, city, pill_state, reference_images, has_boundary, preset_addendum } = req.body;

    if (!site_id || !capture_id || !pill_state || !pill_state.building_type) {
      return res.status(400).json({ error: 'site_id, capture_id, and pill_state.building_type are required' });
    }

    const jobId = uuidv4();
    jobs.set(jobId, {
      id: jobId, status: 'queued', progress: 0,
      site_id, city: city || 'Unknown',
      building_type: pill_state.building_type,
      images: [], error: null,
    });

    setImmediate(async () => {
      await processGenerationJob(jobId, {
        site_id, capture_id, city, pill_state, reference_images,
        hasBoundary: !!has_boundary,
        presetAddendum: preset_addendum || '',
        userId: req.user ? req.user.id : null,
      });
    });

    res.json({ job_id: jobId, status: 'queued' });
  } catch (error) {
    console.error('Error queuing generation:', error);
    res.status(500).json({ error: 'Failed to queue generation' });
  }
});

router.get('/status/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found' });
  res.json({ job_id: job.id, status: job.status, progress: job.progress, images: job.images, message: job.error });
});

// ── Generation processor ──────────────────────────────────────────────────────

async function processGenerationJob(jobId, params) {
  const job = jobs.get(jobId);
  if (!job) return;
  job.status = 'processing';

  try {
    const { capture_id, pill_state, reference_images, hasBoundary, presetAddendum, userId, city } = params;

    // Deduct credit before heavy work
    if (userId) {
      const remaining = usageLogger.deductCredit(userId);
      if (remaining === -1) {
        job.status = 'error';
        job.error = 'Insufficient credits';
        return;
      }
    }

    // Load capture
    const capture = usageLogger.getCaptureById(parseInt(capture_id, 10));
    if (!capture) throw new Error('Capture not found');

    const filePath = path.join(__dirname, '..', capture.file_path.replace(/^\//, ''));
    let captureBase64;
    if (fs.existsSync(filePath)) {
      captureBase64 = fs.readFileSync(filePath).toString('base64');
    } else {
      const buf = await captureService.refetchCapture(capture);
      if (!buf) throw new Error('Could not load capture image');
      captureBase64 = buf.toString('base64');
    }

    // Pre-analyse reference images (text-vision) so the prompt can name what's in them
    let refDescriptions = [];
    if (Array.isArray(reference_images) && reference_images.length > 0) {
      job.message = `Reading ${reference_images.length} reference image${reference_images.length === 1 ? '' : 's'}...`;
      try {
        refDescriptions = await refAnalyzer.describeReferences(reference_images);
      } catch (e) {
        console.warn('[generate] ref-analyzer failed; continuing without descriptions:', e.message);
      }
    }
    const promptOpts = { refDescriptions, hasBoundary: !!hasBoundary, presetAddendum: presetAddendum || '' };

    // Pick generation strategy based on the capture type
    const is3D = capture.type === 'mapbox3d' || capture.type === 'birdseye';
    const isStreet = capture.type === 'streetview';

    let primaryView, additionalViews, primaryLabel;
    if (is3D) {
      primaryView    = 'perspective_3d';
      additionalViews = ['perspective_dusk', 'perspective_night', 'street_front'];
      primaryLabel   = 'Generating primary photograph...';
    } else if (isStreet) {
      primaryView    = 'street_front';
      additionalViews = ['street_corner', 'street_entrance', 'aerial'];
      primaryLabel   = 'Generating street-level photograph...';
    } else {
      primaryView    = 'aerial';
      additionalViews = ['street_front', 'street_corner', 'street_entrance'];
      primaryLabel   = 'Generating aerial photograph...';
    }

    const statusSteps = [
      'Analysing site context...',
      'Building architectural prompt...',
      primaryLabel,
      'Creating additional views...',
      'Finishing up...',
    ];

    for (let i = 0; i < statusSteps.length; i++) {
      job.progress = Math.round((i / statusSteps.length) * 100);
      job.message = statusSteps[i];

      if (i === 2) {
        const prompt = promptBuilder.buildPrompt(pill_state, primaryView, promptOpts);
        const imageUrl = await imageGenerator.generateFromCapture(captureBase64, 'image/jpeg', prompt, reference_images);
        job.images.push({ type: primaryView, url: imageUrl });
      }

      if (i === 3) {
        for (const viewType of additionalViews) {
          const prompt = promptBuilder.buildPrompt(pill_state, viewType, promptOpts);
          const imageUrl = await imageGenerator.generateFromCapture(captureBase64, 'image/jpeg', prompt, reference_images);
          job.images.push({ type: viewType, url: imageUrl });
        }
      }
    }

    job.status = 'completed';
    job.progress = 100;

    usageLogger.logGeneration({
      jobId,
      city: city || 'Unknown',
      building_type: pill_state.building_type,
      stories: pill_state.stories,
      images_generated: job.images.length,
      status: 'completed',
      user_id: userId,
    });
  } catch (error) {
    console.error(`Job ${jobId} failed:`, error);
    job.status = 'error';
    job.error = error.message;
  }
}

// ── Follow-up generation processor ──────────────────────────────────────────

async function processFollowupJob(jobId, params) {
  const job = followupJobs.get(jobId);
  if (!job) return;
  job.status = 'processing';

  try {
    const { image_url, pill_state, presetAddendum, presetAddendum: pa, city, userId } = params;
    const addendum = params.preset_addendum || params.presetAddendum || '';

    if (userId) {
      const remaining = usageLogger.deductCredit(userId);
      if (remaining === -1) {
        job.status = 'error';
        job.error = 'Insufficient credits';
        return;
      }
    }

    // Resolve the chosen image to disk + base64. URL shape: /api/capture/file/<filename>
    const m = /\/api\/capture\/file\/([^?#]+)$/.exec(image_url || '');
    if (!m) throw new Error('Cannot resolve chosen image URL: ' + image_url);
    const filename = decodeURIComponent(m[1]);
    const filePath = path.join(__dirname, '../public/site-images', filename);
    if (!fs.existsSync(filePath)) throw new Error('Chosen image file missing on disk');
    const sourceBase64 = fs.readFileSync(filePath).toString('base64');

    const followupViews = [
      { type: 'street_eye_level', label: 'Generating street eye-level photograph...' },
      { type: 'plaza_active',     label: 'Generating plaza / public-realm photograph...' },
      { type: 'entrance_busy',    label: 'Generating entrance close-up photograph...' },
      { type: 'lifestyle_moment', label: 'Generating lifestyle moment photograph...' },
    ];

    for (let i = 0; i < followupViews.length; i++) {
      const v = followupViews[i];
      job.message = v.label;
      job.progress = Math.round((i / followupViews.length) * 100);
      const prompt = promptBuilder.buildFollowupPrompt(pill_state, v.type, { presetAddendum: addendum });
      const url = await imageGenerator.generateFromCapture(sourceBase64, 'image/jpeg', prompt, []);
      job.images.push({ type: v.type, url });
    }

    job.status = 'completed';
    job.progress = 100;
    job.message = 'Done';

    usageLogger.logGeneration({
      jobId, city: city || 'Unknown',
      building_type: pill_state.building_type,
      stories: pill_state.stories,
      images_generated: job.images.length,
      status: 'completed',
      user_id: userId,
    });
  } catch (error) {
    console.error(`Follow-up job ${jobId} failed:`, error);
    job.status = 'error';
    job.error = error.message;
  }
}

module.exports = router;
