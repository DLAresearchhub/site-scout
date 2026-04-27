const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const siteFinder = require('../services/site-finder');
const earthCapture = require('../services/earth-capture');
const promptBuilder = require('../services/prompt-builder');
const imageGenerator = require('../services/image-generator');
const usageLogger = require('../services/usage-logger');

// In-memory job storage (in production, use Redis or database)
const jobs = new Map();

/**
 * POST /api/search-sites
 * Search for sites in a given city
 */
router.post('/search-sites', async (req, res) => {
  try {
    const { city } = req.body;

    if (!city || city.trim().length === 0) {
      return res.status(400).json({ error: 'City is required' });
    }

    // Generate stubbed sites
    const sites = await siteFinder.findSites(city);

    // Log session
    usageLogger.logSession({
      city,
      timestamp: new Date().toISOString(),
      sessionId: req.sessionID,
      ip: req.ip,
      sites_found: sites.length
    });

    res.json({ sites });
  } catch (error) {
    console.error('Error searching sites:', error);
    res.status(500).json({ error: 'Failed to search sites' });
  }
});

/**
 * POST /api/capture-site
 * Capture angles of a site using Google Earth
 */
router.post('/capture-site', async (req, res) => {
  try {
    const { site_id, lat, lng } = req.body;

    if (!site_id || lat === undefined || lng === undefined) {
      return res.status(400).json({ error: 'site_id, lat, and lng are required' });
    }

    // Stub: capture angles from Earth
    const captures = await earthCapture.captureAngles(lat, lng);

    res.json({
      site_id,
      captures,
      message: 'Site captured successfully'
    });
  } catch (error) {
    console.error('Error capturing site:', error);
    res.status(500).json({ error: 'Failed to capture site' });
  }
});

/**
 * POST /api/generate
 * Queue a generation job for building visualization
 */
router.post('/generate', async (req, res) => {
  try {
    const {
      site_id,
      capture_url,
      building_type,
      stories,
      style_notes,
      include_interiors,
      city
    } = req.body;

    if (!site_id || !capture_url || !building_type) {
      return res.status(400).json({
        error: 'site_id, capture_url, and building_type are required'
      });
    }

    const jobId = uuidv4();

    // Create job record
    jobs.set(jobId, {
      id: jobId,
      status: 'queued',
      progress: 0,
      site_id,
      building_type,
      stories,
      city: city || 'Unknown',
      images: [],
      createdAt: new Date(),
      startedAt: null,
      completedAt: null,
      error: null
    });

    // Process asynchronously
    setImmediate(async () => {
      await processGenerationJob(jobId, {
        site_id,
        capture_url,
        building_type,
        stories,
        style_notes,
        include_interiors,
        city
      });
    });

    res.json({
      job_id: jobId,
      status: 'queued'
    });
  } catch (error) {
    console.error('Error queuing generation:', error);
    res.status(500).json({ error: 'Failed to queue generation' });
  }
});

/**
 * GET /api/status/:job_id
 * Get status and progress of a generation job
 */
router.get('/status/:jobId', (req, res) => {
  try {
    const { jobId } = req.params;

    const job = jobs.get(jobId);
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }

    res.json({
      job_id: job.id,
      status: job.status,
      progress: job.progress,
      images: job.images,
      message: job.status === 'error' ? job.error : null
    });
  } catch (error) {
    console.error('Error getting job status:', error);
    res.status(500).json({ error: 'Failed to get job status' });
  }
});

/**
 * Helper function to process generation job
 */
async function processGenerationJob(jobId, params) {
  try {
    const job = jobs.get(jobId);
    if (!job) return;

    job.status = 'processing';
    job.startedAt = new Date();

    const statusMessages = [
      'Analysing site context...',
      'Building architectural prompt...',
      'Generating aerial CGI...',
      'Creating street-level views...',
      'Finishing up...'
    ];

    // Simulate generation with progress updates
    for (let i = 0; i < statusMessages.length; i++) {
      job.progress = Math.round((i / statusMessages.length) * 100);
      
      // Simulate processing time (1-2 seconds per step)
      await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 1000));

      // Step 1: Aerial prompt and generation
      if (i === 2) {
        const aerialPrompt = promptBuilder.buildAerialPrompt(
          params.capture_url,
          params.building_type,
          params.stories,
          params.style_notes,
          params.city
        );
        const aerialImage = await imageGenerator.generateImage(aerialPrompt, params.capture_url);
        job.images.push({
          type: 'aerial',
          url: aerialImage,
          prompt: aerialPrompt
        });
      }

      // Steps 3-4: Street and interior views
      if (i === 3 && job.images.length > 0) {
        for (let viewIdx = 0; viewIdx < 3; viewIdx++) {
          const streetPrompt = promptBuilder.buildStreetPrompt(
            job.images[0].url,
            params.building_type,
            params.stories,
            viewIdx
          );
          const streetImage = await imageGenerator.generateImage(streetPrompt, params.capture_url);
          job.images.push({
            type: 'street',
            url: streetImage,
            viewIndex: viewIdx,
            prompt: streetPrompt
          });
        }

        // Interior views if requested
        if (params.include_interiors) {
          for (let viewIdx = 0; viewIdx < 2; viewIdx++) {
            const interiorPrompt = promptBuilder.buildInteriorPrompt(
              params.building_type,
              params.stories,
              params.style_notes,
              viewIdx
            );
            const interiorImage = await imageGenerator.generateImage(interiorPrompt, params.capture_url);
            job.images.push({
              type: 'interior',
              url: interiorImage,
              viewIndex: viewIdx,
              prompt: interiorPrompt
            });
          }
        }
      }
    }

    job.status = 'completed';
    job.progress = 100;
    job.completedAt = new Date();

    // Log generation
    usageLogger.logGeneration({
      jobId,
      city: params.city,
      building_type: params.building_type,
      stories: params.stories,
      images_generated: job.images.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error(`Error processing job ${jobId}:`, error);
    const job = jobs.get(jobId);
    if (job) {
      job.status = 'error';
      job.error = error.message;
      job.completedAt = new Date();
    }
  }
}

module.exports = router;
