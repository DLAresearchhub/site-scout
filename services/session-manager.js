/**
 * session-manager.js
 * 
 * Manages a single persistent Playwright browser instance for Site Scout.
 * Singleton pattern — reuse browser across requests to avoid cold-start overhead.
 * 
 * Typical cold start for Google Earth Web Chromium: 3-5 seconds.
 * Reusing the browser saves this overhead on subsequent captures.
 */

'use strict';

const { chromium } = require('playwright');

/**
 * Chromium launch args tuned for headless WebGL environments (Railway, Docker, etc.)
 * These are critical — without them, Google Earth's WebGL canvas renders black.
 */
const CHROMIUM_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  // NOTE: --disable-gpu sounds counterintuitive, but it forces software rendering
  // which is more reliable in headless environments without a real GPU/display.
  // For hosts WITH a GPU and a display server, remove this for potentially better quality.
  '--disable-gpu',
  '--disable-software-rasterizer',
  // Allow enough virtual time for WebGL assets to load
  '--virtual-time-budget=10000',
  // Prevent throttling of background tabs/pages
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  // Improve WebGL compatibility
  '--ignore-gpu-blocklist',
  '--enable-webgl',
  '--use-gl=swiftshader',
  // Stability
  '--disable-extensions',
  '--disable-popup-blocking',
  '--disable-translate',
  '--disable-default-apps',
  '--no-first-run',
  '--no-default-browser-check',
];

class SessionManager {
  constructor() {
    /** @type {import('playwright').Browser | null} */
    this._browser = null;

    /** @type {import('playwright').BrowserContext | null} */
    this._context = null;

    /** @type {import('playwright').Page | null} */
    this._page = null;

    this._launching = null; // Promise to prevent concurrent launches
  }

  /**
   * Returns existing browser or launches a new one.
   * Thread-safe via _launching promise guard.
   * 
   * @returns {Promise<import('playwright').Browser>}
   */
  async getBrowser() {
    if (this._browser && this._browser.isConnected()) {
      return this._browser;
    }

    // Guard against concurrent launch calls
    if (this._launching) {
      return this._launching;
    }

    this._launching = this._launch();
    try {
      this._browser = await this._launching;
      return this._browser;
    } finally {
      this._launching = null;
    }
  }

  /**
   * Internal: launch Chromium with the hardened headless args.
   * @private
   */
  async _launch() {
    console.log('[SessionManager] Launching Chromium...');

    const browser = await chromium.launch({
      headless: true,
      args: CHROMIUM_ARGS,
      // Increase timeout for slow Railway cold starts
      timeout: 30_000,
    });

    browser.on('disconnected', () => {
      console.warn('[SessionManager] Browser disconnected unexpectedly. Will re-launch on next request.');
      this._browser = null;
      this._context = null;
      this._page = null;
    });

    console.log(`[SessionManager] Chromium launched (version: ${browser.version()})`);
    return browser;
  }

  /**
   * Returns a browser context. Creates one if needed.
   * A context is like an incognito session — isolated cookies, storage, etc.
   * We create one context per session manager instance.
   * 
   * @returns {Promise<import('playwright').BrowserContext>}
   */
  async getContext() {
    const browser = await this.getBrowser();

    if (this._context) {
      // Check context is still alive
      try {
        await this._context.pages(); // lightweight liveness probe
        return this._context;
      } catch {
        console.warn('[SessionManager] Context is stale. Recreating...');
        this._context = null;
        this._page = null;
      }
    }

    this._context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      // Realistic user agent — Google Earth may behave differently for known bots
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      // Accept Google's language/locale
      locale: 'en-GB',
      timezoneId: 'Europe/London',
      // Permissions Google Earth may request
      permissions: [],
      // Disable geolocation prompts
      geolocation: undefined,
    });

    return this._context;
  }

  /**
   * Returns the shared page. Creates one if needed.
   * We reuse a single page to avoid spawning many tabs.
   * 
   * @returns {Promise<import('playwright').Page>}
   */
  async getPage() {
    const context = await this.getContext();

    if (this._page && !this._page.isClosed()) {
      return this._page;
    }

    console.log('[SessionManager] Creating new page...');
    this._page = await context.newPage();

    // Intercept and block heavy non-essential resources to speed up initial load
    await this._page.route('**/*.{woff,woff2,ttf,otf}', (route) => route.abort());

    // Log console errors from the page for debugging
    this._page.on('console', (msg) => {
      if (msg.type() === 'error') {
        console.error(`[PageConsole ERROR] ${msg.text()}`);
      }
    });

    this._page.on('pageerror', (err) => {
      console.error(`[PageError] ${err.message}`);
    });

    return this._page;
  }

  /**
   * Health check — returns true if the browser is running and connected.
   * 
   * @returns {boolean}
   */
  isReady() {
    return !!(this._browser && this._browser.isConnected());
  }

  /**
   * Gracefully close browser, context and page.
   */
  async close() {
    console.log('[SessionManager] Closing browser...');
    try {
      if (this._page && !this._page.isClosed()) {
        await this._page.close();
      }
    } catch (e) {
      console.warn('[SessionManager] Error closing page:', e.message);
    }

    try {
      if (this._context) {
        await this._context.close();
      }
    } catch (e) {
      console.warn('[SessionManager] Error closing context:', e.message);
    }

    try {
      if (this._browser) {
        await this._browser.close();
      }
    } catch (e) {
      console.warn('[SessionManager] Error closing browser:', e.message);
    }

    this._page = null;
    this._context = null;
    this._browser = null;
    console.log('[SessionManager] Browser closed.');
  }
}

// Singleton export — one browser instance per Node.js process
const sessionManager = new SessionManager();

module.exports = sessionManager;
module.exports.SessionManager = SessionManager; // Named export for testing
