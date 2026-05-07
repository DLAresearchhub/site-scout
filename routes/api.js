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
    const filePath = path.join(dir, filename);
    fs.writeFileSync(filePath, buffer);

    const proxyUrl = `/api/capture/file/${filename}`;
    const direction = (bearing != null) ? `b${Math.round(bearing)}p${Math.round(pitch || 0)}z${Math.round((zoom || 0) * 10) / 10}` : null;
    const id = usageLogger.cacheCapture(String(site_id), 'mapbox3d', direction, filePath, proxyUrl, null);

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
    const { site_id, capture_id, city, pill_state, reference_images } = req.body;

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
      await processGenerationJob(jobId, { site_id, capture_id, city, pill_state, reference_images, userId: req.user ? req.user.id : null });
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
    const { capture_id, pill_state, reference_images, userId, city } = params;

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

    // Pick generation strategy based on the capture type
    const is3D = capture.type === 'mapbox3d' || capture.type === 'birdseye';
    const isStreet = capture.type === 'streetview';

    let primaryView, additionalViews, primaryLabel;
    if (is3D) {
      primaryView    = 'perspective_3d';
      additionalViews = ['perspective_dusk', 'perspective_night', 'street_front'];
      primaryLabel   = 'Generating 3D perspective CGI...';
    } else if (isStreet) {
      primaryView    = 'street_front';
      additionalViews = ['street_corner', 'street_entrance', 'aerial'];
      primaryLabel   = 'Generating street-level CGI...';
    } else {
      primaryView    = 'aerial';
      additionalViews = ['street_front', 'street_corner', 'street_entrance'];
      primaryLabel   = 'Generating aerial CGI...';
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
        const prompt = promptBuilder.buildPrompt(pill_state, primaryView);
        const imageUrl = await imageGenerator.generateFromCapture(captureBase64, 'image/jpeg', prompt, reference_images);
        job.images.push({ type: primaryView, url: imageUrl });
      }

      if (i === 3) {
        for (const viewType of additionalViews) {
          const prompt = promptBuilder.buildPrompt(pill_state, viewType);
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

module.exports = router;
