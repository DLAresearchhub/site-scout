/**
 * earth-capture.js
 * 
 * Core automation service for Site Scout.
 * Navigates Google Earth Web to specific coordinates and captures angled 3D screenshots.
 * 
 * KEY INSIGHT: Google Earth Web accepts full view state in the URL, so we never need
 * to interact with its UI for basic captures — just navigate and wait for WebGL to render.
 * 
 * URL format:
 *   https://earth.google.com/web/@{lat},{lng},{altitude}a,{range}d,{tilt}t,{heading}h
 *
 * Parameters:
 *   lat      — latitude (decimal degrees, negative = south)
 *   lng      — longitude (decimal degrees, negative = west)
 *   altitude — camera altitude in metres (above sea level, ~80-500 for street-level to aerial)
 *   range    — distance from target in metres (500-2000 typical for building-scale)
 *   tilt     — 0 = top-down, 60 = 60° angled view (55-65 for architectural shots)
 *   heading  — compass bearing 0-360 (0/360 = north; rotate this to orbit the site)
 *
 * Example:
 *   https://earth.google.com/web/@53.7996,-1.5491,80a,800d,60t,0h
 */

'use strict';

const fs = require('fs');
const path = require('path');
const sessionManager = require('./session-manager');

// ─── Constants ────────────────────────────────────────────────────────────────

const GOOGLE_EARTH_BASE = 'https://earth.google.com/web/';

/**
 * Directory for saving captured screenshots.
 * Override with SITE_SCOUT_OUTPUT_DIR env var.
 */
const OUTPUT_DIR = process.env.SITE_SCOUT_OUTPUT_DIR || '/tmp/site-scout-captures';

/**
 * How long to wait (ms) after navigation for WebGL tiles to fully render.
 * 
 * TUNING NOTE:
 *   - 5000ms: may catch tiles still loading (blurry/incomplete imagery)
 *   - 8000ms: conservative, works well on Railway (default)
 *   - 12000ms: for slow connections or high-detail areas
 *   - Increase if captures show grey tiles or unrendered terrain.
 *   - Decrease for speed once you've verified your environment.
 */
const WEBGL_RENDER_WAIT_MS = parseInt(process.env.EARTH_RENDER_WAIT_MS || '8000', 10);

/**
 * Additional wait after popup dismissal attempts before final screenshot.
 */
const POST_DISMISS_WAIT_MS = 3000;

/**
 * Maximum retry attempts if Google Earth fails to load (black screen, error page, etc.)
 */
const MAX_LOAD_RETRIES = 3;

/**
 * Default headings for a full orbit capture (6 positions, 60° apart).
 * Provides a complete view of all sides of a site.
 */
const DEFAULT_HEADINGS = [0, 60, 120, 180, 240, 300];

/**
 * Default camera parameters for architectural site scouting.
 */
const DEFAULTS = {
  altitudeM: 80,     // Camera altitude above sea level (metres). 80m ≈ low aerial.
  rangeM: 800,       // Distance from target (metres). 800m gives good building context.
  tiltDeg: 60,       // View angle from vertical (degrees). 60° gives good 3D perspective.
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Build a Google Earth Web URL for a specific view.
 * 
 * @param {number} lat 
 * @param {number} lng 
 * @param {object} opts
 * @param {number} opts.altitudeM   Camera altitude in metres
 * @param {number} opts.rangeM      Distance to target in metres
 * @param {number} opts.tiltDeg     Tilt angle (0=top-down, 60=angled)
 * @param {number} opts.headingDeg  Compass heading (0-360)
 * @returns {string}
 */
function buildEarthUrl(lat, lng, { altitudeM, rangeM, tiltDeg, headingDeg }) {
  // Round to 6 decimal places (sub-metre precision)
  const latR = parseFloat(lat.toFixed(6));
  const lngR = parseFloat(lng.toFixed(6));
  return `${GOOGLE_EARTH_BASE}@${latR},${lngR},${altitudeM}a,${rangeM}d,${tiltDeg}t,${headingDeg}h`;
}

/**
 * Ensure the output directory exists.
 * @param {string} dir 
 */
function ensureOutputDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

/**
 * Generate a safe filename for a capture.
 * @param {number} lat 
 * @param {number} lng 
 * @param {number} heading 
 * @returns {string}
 */
function captureFilename(lat, lng, heading) {
  const ts = Date.now();
  const latStr = lat.toFixed(4).replace('.', '_').replace('-', 'S');
  const lngStr = lng.toFixed(4).replace('.', '_').replace('-', 'W');
  return `earth_${latStr}_${lngStr}_h${heading}_${ts}.png`;
}

/**
 * Sleep for a given number of milliseconds.
 * @param {number} ms 
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ─── EarthCaptureService ─────────────────────────────────────────────────────

class EarthCaptureService {
  constructor() {
    /** @type {import('playwright').Page | null} */
    this._page = null;

    /** Current coordinates — tracked for retry logic */
    this._currentLat = null;
    this._currentLng = null;
    this._currentOpts = null;
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────────

  /**
   * Initialise the service — launch Playwright Chromium and prepare the page.
   * Safe to call multiple times (idempotent).
   */
  async init() {
    console.log('[EarthCapture] Initialising...');
    ensureOutputDir(OUTPUT_DIR);
    this._page = await sessionManager.getPage();
    console.log('[EarthCapture] Ready. Output dir:', OUTPUT_DIR);
  }

  /**
   * Close the browser. Call when done with all captures.
   */
  async close() {
    await sessionManager.close();
    this._page = null;
    console.log('[EarthCapture] Closed.');
  }

  // ── Navigation ──────────────────────────────────────────────────────────────

  /**
   * Navigate Google Earth to the given coordinates with default camera settings.
   * This is a low-level navigation — use captureAllAngles() for full workflow.
   * 
   * @param {number} lat 
   * @param {number} lng 
   * @param {number} [altitudeM]
   * @param {number} [rangeM]
   * @param {number} [tiltDeg]
   * @param {number} [headingDeg]
   */
  async flyToSite(
    lat,
    lng,
    altitudeM = DEFAULTS.altitudeM,
    rangeM = DEFAULTS.rangeM,
    tiltDeg = DEFAULTS.tiltDeg,
    headingDeg = 0
  ) {
    if (!this._page) await this.init();

    const opts = { altitudeM, rangeM, tiltDeg, headingDeg };
    const url = buildEarthUrl(lat, lng, opts);

    console.log(`[EarthCapture] Flying to ${lat}, ${lng} (heading ${headingDeg}°)`);
    console.log(`[EarthCapture] URL: ${url}`);

    // Store for retry
    this._currentLat = lat;
    this._currentLng = lng;
    this._currentOpts = opts;

    await this._page.goto(url, {
      // 'domcontentloaded' is faster than 'load' and sufficient — GE is a SPA.
      // 'networkidle' is unreliable with WebGL streaming tiles (never truly idle).
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });
  }

  // ── Load waiting ────────────────────────────────────────────────────────────

  /**
   * Wait for Google Earth Web's WebGL content to fully render.
   * 
   * Strategy (see module header for timing notes):
   *   1. Wait for DOM content to be interactive
   *   2. Wait a fixed period for WebGL tiles to render  
   *   3. Attempt to dismiss overlays (cookie banners, welcome dialogs)
   *   4. Brief final wait before screenshot
   * 
   * This is intentionally conservative — WebGL streaming is non-deterministic.
   * Reducing WEBGL_RENDER_WAIT_MS may produce blurry or grey-tile captures.
   */
  async waitForLoad() {
    if (!this._page) throw new Error('[EarthCapture] Not initialised. Call init() first.');

    console.log(`[EarthCapture] Waiting ${WEBGL_RENDER_WAIT_MS}ms for WebGL render...`);
    await sleep(WEBGL_RENDER_WAIT_MS);

    // Attempt popup/overlay dismissal
    await this._dismissOverlays();

    // Short final stabilisation wait
    await sleep(POST_DISMISS_WAIT_MS);
    console.log('[EarthCapture] Load wait complete.');
  }

  /**
   * Attempt to dismiss Google Earth Web overlays and popups.
   * 
   * Google Earth Web shows several overlays on first load or after consent resets:
   *   - GDPR/cookie consent banner (bottom of screen)
   *   - "Welcome to Google Earth" tour prompt
   *   - "Got it" / onboarding tooltips
   * 
   * We try multiple selectors with short timeouts — failures are non-fatal.
   * 
   * ⚠️  ALL SELECTORS BELOW NEED VERIFICATION ON LIVE GOOGLE EARTH WEB ⚠️
   * Google Earth's DOM changes with deployments. If captures show overlays, 
   * inspect the live page and update these selectors.
   * 
   * @private
   */
  async _dismissOverlays() {
    const page = this._page;
    const DISMISS_TIMEOUT = 2000; // ms to wait for each selector before giving up

    // Helper: try to click a selector, silently ignore if not found
    const tryClick = async (selector, description) => {
      try {
        await page.click(selector, { timeout: DISMISS_TIMEOUT });
        console.log(`[EarthCapture] Dismissed: ${description}`);
        await sleep(500); // Brief pause after dismissal
      } catch {
        // Not present — that's fine
      }
    };

    // ── Cookie / GDPR consent banner ──────────────────────────────────────────
    // TODO: verify selector — Google's consent banner changes by region/version
    // Inspect https://earth.google.com/web/ → look for bottom-bar with "Accept" button
    await tryClick(
      'button[aria-label="Accept all"]',
      'Cookie consent (Accept all)'
    );

    // TODO: verify selector — EU consent dialog variant
    await tryClick(
      'button[jsname="higCR"]',
      'Cookie consent (jsname variant)'
    );

    // TODO: verify selector — generic consent accept
    await tryClick(
      '[data-value="allow"]',
      'Cookie consent (data-value=allow)'
    );

    // ── Welcome / tour dialog ─────────────────────────────────────────────────
    // TODO: verify selector — "Welcome to Google Earth" intro modal close button
    await tryClick(
      'button[data-tooltip="Close dialog"]',
      'Welcome dialog close'
    );

    // TODO: verify selector — "Got it" button on onboarding tooltip
    await tryClick(
      'button.cta-button',
      '"Got it" CTA button'
    );

    // TODO: verify selector — generic "Got it" text button
    await tryClick(
      'button:has-text("Got it")',
      '"Got it" text button'
    );

    // TODO: verify selector — "Start exploring" button on welcome screen
    await tryClick(
      'button:has-text("Start exploring")',
      '"Start exploring" button'
    );

    // TODO: verify selector — dismiss any fullscreen intro video/animation
    await tryClick(
      '.earth-intro-close, [aria-label="Close"]',
      'Intro close button'
    );

    // ── Search bar / focus stealing ──────────────────────────────────────────
    // GE sometimes focuses the search bar, which can intercept keyboard events.
    // Press Escape to defocus — harmless if nothing is focused.
    try {
      await page.keyboard.press('Escape');
    } catch {
      // Ignore
    }

    // ── Sidebar / panel auto-open ─────────────────────────────────────────────
    // TODO: verify selector — GE may open a left sidebar for the navigated location
    // If it obscures the view, try to close it
    await tryClick(
      'button[aria-label="Close sidebar"]',
      'Sidebar close'
    );

    // TODO: verify selector — close any info panel that opened
    await tryClick(
      '.close-button, [data-tooltip="Close panel"]',
      'Info panel close'
    );
  }

  /**
   * Check if the current page looks like a successful Google Earth load.
   * Used to detect failure cases (error page, black screen, etc.) before retrying.
   * 
   * @returns {Promise<boolean>}
   * @private
   */
  async _isLoadedSuccessfully() {
    try {
      const url = this._page.url();
      // If we got redirected away from earth.google.com, something went wrong
      if (!url.includes('earth.google.com')) {
        console.warn('[EarthCapture] Unexpected URL after navigation:', url);
        return false;
      }

      // TODO: verify selector — check for a known GE UI element that appears after load
      // This indicates the WebGL canvas and app shell loaded successfully
      const canvasExists = await this._page.evaluate(() => {
        return !!(
          document.querySelector('canvas') ||
          document.querySelector('.earth-canvas') ||
          document.querySelector('[class*="earth"]')
        );
      });

      if (!canvasExists) {
        console.warn('[EarthCapture] No canvas found — GE may not have loaded.');
        return false;
      }

      return true;
    } catch (e) {
      console.warn('[EarthCapture] Load check failed:', e.message);
      return false;
    }
  }

  // ── Capture ─────────────────────────────────────────────────────────────────

  /**
   * Capture a screenshot at a specific heading angle.
   * Navigates to the current lat/lng with the new heading, waits for render,
   * and returns the screenshot as both a file path and base64 string.
   * 
   * Must call flyToSite() first to set the current coordinates.
   * 
   * @param {number} heading  Compass bearing 0-360
   * @returns {Promise<{
   *   heading: number,
   *   filePath: string,
   *   imageBase64: string,
   *   imageBuffer: Buffer
   * }>}
   */
  async captureAngle(heading) {
    if (!this._currentLat || !this._currentOpts) {
      throw new Error('[EarthCapture] No site set. Call flyToSite() first.');
    }

    // Navigate to this specific heading
    const opts = { ...this._currentOpts, headingDeg: heading };
    const url = buildEarthUrl(this._currentLat, this._currentLng, opts);

    console.log(`[EarthCapture] Capturing heading ${heading}°...`);

    let loaded = false;
    for (let attempt = 1; attempt <= MAX_LOAD_RETRIES; attempt++) {
      try {
        await this._page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
        await this.waitForLoad();

        loaded = await this._isLoadedSuccessfully();
        if (loaded) break;

        console.warn(`[EarthCapture] Load check failed (attempt ${attempt}/${MAX_LOAD_RETRIES}). Retrying...`);
        await sleep(2000);
      } catch (e) {
        console.warn(`[EarthCapture] Navigation error (attempt ${attempt}/${MAX_LOAD_RETRIES}):`, e.message);
        if (attempt === MAX_LOAD_RETRIES) throw e;
        await sleep(2000);
      }
    }

    if (!loaded) {
      throw new Error(`[EarthCapture] Failed to load Google Earth after ${MAX_LOAD_RETRIES} attempts at heading ${heading}°`);
    }

    // Take screenshot
    const filename = captureFilename(this._currentLat, this._currentLng, heading);
    const filePath = path.join(OUTPUT_DIR, filename);

    const imageBuffer = await this._page.screenshot({
      type: 'png',
      fullPage: false, // capture viewport only (1920x1080)
      path: filePath,
    });

    const imageBase64 = imageBuffer.toString('base64');

    console.log(`[EarthCapture] Captured heading ${heading}° → ${filename}`);

    return {
      heading,
      filePath,
      imageBase64,
      imageBuffer,
    };
  }

  /**
   * Capture the site from multiple angles — the full Site Scout workflow.
   * 
   * 1. Navigate to the site
   * 2. Capture at each heading
   * 3. Return all captures
   * 
   * @param {number} lat 
   * @param {number} lng 
   * @param {number[]} [headings]   Heading angles to capture (degrees). Default: 6-point orbit.
   * @param {object}  [cameraOpts] Override default camera parameters
   * @param {number}  [cameraOpts.altitudeM]
   * @param {number}  [cameraOpts.rangeM]
   * @param {number}  [cameraOpts.tiltDeg]
   * @returns {Promise<{
   *   lat: number,
   *   lng: number,
   *   captures: Array<{heading: number, filePath: string, imageBase64: string, imageBuffer: Buffer}>,
   *   outputDir: string,
   *   capturedAt: string
   * }>}
   */
  async captureAllAngles(lat, lng, headings = DEFAULT_HEADINGS, cameraOpts = {}) {
    if (!this._page) await this.init();

    const opts = {
      altitudeM: cameraOpts.altitudeM ?? DEFAULTS.altitudeM,
      rangeM:    cameraOpts.rangeM    ?? DEFAULTS.rangeM,
      tiltDeg:   cameraOpts.tiltDeg   ?? DEFAULTS.tiltDeg,
      headingDeg: headings[0] ?? 0,
    };

    console.log(`[EarthCapture] Starting full capture: ${lat}, ${lng}`);
    console.log(`[EarthCapture] Headings: [${headings.join(', ')}]°`);
    console.log(`[EarthCapture] Camera: alt=${opts.altitudeM}m, range=${opts.rangeM}m, tilt=${opts.tiltDeg}°`);

    // Set the current site (flyToSite sets _currentLat, _currentLng, _currentOpts)
    await this.flyToSite(lat, lng, opts.altitudeM, opts.rangeM, opts.tiltDeg, opts.headingDeg);

    const captures = [];
    for (const heading of headings) {
      try {
        const capture = await this.captureAngle(heading);
        captures.push(capture);
      } catch (e) {
        console.error(`[EarthCapture] Failed to capture heading ${heading}°:`, e.message);
        // Continue with remaining headings — partial results are better than none
        captures.push({
          heading,
          filePath: null,
          imageBase64: null,
          imageBuffer: null,
          error: e.message,
        });
      }
    }

    const successful = captures.filter((c) => c.imageBase64 !== null);
    console.log(`[EarthCapture] Complete. ${successful.length}/${headings.length} captures successful.`);

    return {
      lat,
      lng,
      captures,
      outputDir: OUTPUT_DIR,
      capturedAt: new Date().toISOString(),
    };
  }
}

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = EarthCaptureService;
module.exports.buildEarthUrl = buildEarthUrl;
module.exports.DEFAULT_HEADINGS = DEFAULT_HEADINGS;
module.exports.DEFAULTS = DEFAULTS;
module.exports.OUTPUT_DIR = OUTPUT_DIR;
