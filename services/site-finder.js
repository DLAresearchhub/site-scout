/**
 * site-finder.js
 * 
 * Finds vacant/derelict sites in a given city for architectural feasibility assessment.
 * 
 * Two modes:
 *   1. LIVE (recommended): Uses Google Custom Search JSON API to find real listings.
 *      Requires GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_CX (Custom Search Engine ID).
 *      
 *   2. STUB (fallback): Generates realistic-feeling placeholder sites from the city name.
 *      Use during development/demo when no API key is configured.
 * 
 * Geocoding:
 *   Uses Nominatim (OpenStreetMap) for address → lat/lng conversion.
 *   No API key required. Rate-limited to 1 req/sec per OSM policy.
 * 
 * Environment variables:
 *   GOOGLE_SEARCH_API_KEY  — Google API key with Custom Search enabled
 *   GOOGLE_SEARCH_CX       — Custom Search Engine ID (cx parameter)
 *   NOMINATIM_EMAIL        — Your email (required by Nominatim ToS for identification)
 *   SITE_FINDER_USE_STUB   — Force stub mode even if API key present (set to "true")
 */

'use strict';

const usageLogger = require('./usage-logger');

// ─── Nominatim geocoding ──────────────────────────────────────────────────────

/**
 * Geocode an address string to lat/lng using Nominatim (OpenStreetMap).
 * 
 * @param {string} address  Free-text address (e.g. "Canal Street, Leeds, UK")
 * @returns {Promise<{lat: number, lng: number, displayName: string} | null>}
 */
async function geocodeAddress(address) {
  const email = process.env.NOMINATIM_EMAIL || 'sitescout@example.com';
  const encoded = encodeURIComponent(address);
  const url = `https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&limit=1&addressdetails=1`;

  try {
    const response = await fetch(url, {
      headers: {
        // Nominatim requires a User-Agent and contact email to identify your app
        'User-Agent': `SiteScout/1.0 (${email})`,
        'Accept': 'application/json',
      },
    });

    if (!response.ok) {
      console.warn(`[SiteFinder] Nominatim returned ${response.status} for: ${address}`);
      return null;
    }

    const results = await response.json();

    if (!results || results.length === 0) {
      console.warn(`[SiteFinder] Nominatim found no results for: ${address}`);
      return null;
    }

    const result = results[0];
    return {
      lat: parseFloat(result.lat),
      lng: parseFloat(result.lon),
      displayName: result.display_name,
    };
  } catch (e) {
    console.error(`[SiteFinder] Geocoding error for "${address}":`, e.message);
    return null;
  }
}

/**
 * Rate-limited geocoding — Nominatim policy: max 1 request/second.
 * We enforce a 1.1 second gap between calls.
 */
let _lastNominatimCall = 0;
async function geocodeAddressRateLimited(address) {
  const now = Date.now();
  const gap = now - _lastNominatimCall;
  if (gap < 1100) {
    await new Promise((r) => setTimeout(r, 1100 - gap));
  }
  _lastNominatimCall = Date.now();
  return geocodeAddress(address);
}

// ─── Google Custom Search ─────────────────────────────────────────────────────

/**
 * Search Google Custom Search for vacant/derelict sites in a city.
 * 
 * @param {string} city
 * @returns {Promise<Array<{title: string, snippet: string, link: string}>>}
 */
async function googleCustomSearch(city) {
  const apiKey = process.env.GOOGLE_SEARCH_API_KEY;
  const cx = process.env.GOOGLE_SEARCH_CX;

  if (!apiKey || !cx) {
    throw new Error('[SiteFinder] GOOGLE_SEARCH_API_KEY and GOOGLE_SEARCH_CX must be set for live search');
  }

  const queries = [
    `vacant land for sale ${city}`,
    `derelict site development opportunity ${city}`,
    `brownfield land ${city}`,
  ];

  const results = [];

  for (const query of queries) {
    const url = new URL('https://www.googleapis.com/customsearch/v1');
    url.searchParams.set('key', apiKey);
    url.searchParams.set('cx', cx);
    url.searchParams.set('q', query);
    url.searchParams.set('num', '5');

    try {
      const response = await fetch(url.toString());

      if (response.status === 429) {
        console.warn('[SiteFinder] Google Custom Search rate limited. Pausing 2s...');
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }

      if (!response.ok) {
        console.warn(`[SiteFinder] Google Custom Search error: ${response.status} for query "${query}"`);
        continue;
      }

      const data = await response.json();
      const items = data.items || [];

      for (const item of items) {
        results.push({
          title: item.title || '',
          snippet: item.snippet || '',
          link: item.link || '',
        });
      }

      // Small gap between queries to be a good API citizen
      await new Promise((r) => setTimeout(r, 300));
    } catch (e) {
      console.warn(`[SiteFinder] Search query failed: "${query}"`, e.message);
    }
  }

  return results;
}

// ─── Result parsing ───────────────────────────────────────────────────────────

/**
 * Attempt to extract lat/lng coordinates from text (e.g. listing description).
 * Handles formats like "53.7996, -1.5491" or "53°47'58\"N 1°32'57\"W"
 * 
 * @param {string} text
 * @returns {{lat: number, lng: number} | null}
 */
function extractCoordinatesFromText(text) {
  // Match decimal degrees: "53.7996, -1.5491" or "53.7996,-1.5491"
  const decimalMatch = text.match(/(-?\d{1,3}\.\d{4,})[,\s]+(-?\d{1,3}\.\d{4,})/);
  if (decimalMatch) {
    const lat = parseFloat(decimalMatch[1]);
    const lng = parseFloat(decimalMatch[2]);
    // Basic sanity check
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      return { lat, lng };
    }
  }

  return null;
}

/**
 * Determine the site type from a title/snippet.
 * @param {string} text
 * @returns {'vacant_land' | 'derelict_building' | 'development_site' | 'unknown'}
 */
function classifySiteType(text) {
  const lower = text.toLowerCase();
  if (lower.includes('derelict') || lower.includes('ruin') || lower.includes('abandoned building')) {
    return 'derelict_building';
  }
  if (lower.includes('brownfield') || lower.includes('development') || lower.includes('planning')) {
    return 'development_site';
  }
  if (lower.includes('vacant land') || lower.includes('building plot') || lower.includes('plot for sale')) {
    return 'vacant_land';
  }
  return 'development_site'; // Default for anything else in results
}

/**
 * Extract a plausible address from a search result title/snippet.
 * We try to pull out anything that looks like an address component.
 * 
 * @param {string} title
 * @param {string} snippet
 * @param {string} city
 * @returns {string}
 */
function extractAddress(title, snippet, city) {
  // Remove common listing prefixes
  const cleaned = title
    .replace(/^\d+\s*beds?\s*/i, '')
    .replace(/^(for sale|to let|sold|let agreed)[:\s]*/i, '')
    .trim();

  // If title has the city name, use it as-is
  if (cleaned.toLowerCase().includes(city.toLowerCase())) {
    return cleaned;
  }

  // Append city for geocoding
  return `${cleaned}, ${city}`;
}

// ─── Stub site generator ──────────────────────────────────────────────────────

/**
 * Street name components for generating realistic-sounding addresses.
 * Deliberately uses common British street types for the typical DLA Architecture context.
 */
const STREET_TYPES = ['Street', 'Road', 'Lane', 'Avenue', 'Way', 'Close', 'Drive', 'Terrace', 'Place', 'Grove'];
const STREET_NAMES = [
  'Canal', 'Mill', 'Station', 'Victoria', 'George', 'Church', 'Bridge', 'Market',
  'Albert', 'Wellington', 'King', 'Queen', 'Prince', 'Regent', 'Commercial',
  'Industrial', 'Forge', 'Foundry', 'Warehouse', 'Brick', 'Wharf', 'Dock',
];
const SITE_SUFFIXES = [
  'Brownfield Site', 'Development Opportunity', 'Former Works Site',
  'Cleared Site', 'Derelict Yard', 'Vacant Plot', 'Former Factory Site',
];

/**
 * Seeded pseudo-random number (deterministic from city name for reproducibility).
 * @param {string} seed
 * @param {number} index
 * @returns {number} 0–1
 */
function pseudoRand(seed, index) {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i) + index * 31;
    hash |= 0;
  }
  return Math.abs(hash % 1000) / 1000;
}

/**
 * Generate realistic stub sites for a city.
 * Used when no Google Search API key is configured.
 * 
 * Coordinates are offset from a nominal city centre by small amounts (±0.01°),
 * placing sites within ~1km of the centre — plausible for urban infill sites.
 * 
 * @param {string} city
 * @param {number} count  Number of stub sites to generate
 * @returns {Array<SiteResult>}
 */
// Hardcoded centres for common UK cities — avoids Nominatim call and silent London fallback
const UK_CITY_COORDS = {
  london: { lat: 51.5074, lng: -0.1278 },
  manchester: { lat: 53.4808, lng: -2.2426 },
  leeds: { lat: 53.8008, lng: -1.5491 },
  birmingham: { lat: 52.4862, lng: -1.8904 },
  sheffield: { lat: 53.3811, lng: -1.4701 },
  bristol: { lat: 51.4545, lng: -2.5879 },
  liverpool: { lat: 53.4084, lng: -2.9916 },
  edinburgh: { lat: 55.9533, lng: -3.1883 },
  glasgow: { lat: 55.8642, lng: -4.2518 },
  newcastle: { lat: 54.9783, lng: -1.6174 },
  cardiff: { lat: 51.4816, lng: -3.1791 },
  nottingham: { lat: 52.9548, lng: -1.1581 },
  leicester: { lat: 52.6369, lng: -1.1398 },
  coventry: { lat: 52.4068, lng: -1.5197 },
  bradford: { lat: 53.7960, lng: -1.7594 },
  hull: { lat: 53.7457, lng: -0.3367 },
  stoke: { lat: 53.0027, lng: -2.1794 },
  derby: { lat: 52.9225, lng: -1.4746 },
  reading: { lat: 51.4543, lng: -0.9781 },
  southampton: { lat: 50.9097, lng: -1.4044 },
  portsmouth: { lat: 50.8198, lng: -1.0880 },
  oxford: { lat: 51.7520, lng: -1.2577 },
  cambridge: { lat: 52.2053, lng: 0.1218 },
  york: { lat: 53.9600, lng: -1.0873 },
  exeter: { lat: 50.7236, lng: -3.5275 },
};

async function generateStubSites(city, count = 5) {
  console.log(`[SiteFinder] STUB MODE: Generating ${count} placeholder sites for "${city}"`);

  // Check hardcoded lookup first, then try Nominatim
  const cityKey = city.trim().toLowerCase().split(/[\s,]+/)[0];
  let baseLat, baseLng;

  if (UK_CITY_COORDS[cityKey]) {
    ({ lat: baseLat, lng: baseLng } = UK_CITY_COORDS[cityKey]);
    console.log(`[SiteFinder] Using hardcoded coords for "${city}"`);
  } else {
    let cityCoords = null;
    try {
      cityCoords = await geocodeAddressRateLimited(city + ', UK');
    } catch {
      // silent — fall through to London default
    }
    baseLat = cityCoords?.lat ?? 51.5074;
    baseLng = cityCoords?.lng ?? -0.1278;
  }

  const sites = [];
  for (let i = 0; i < count; i++) {
    const streetName = STREET_NAMES[Math.floor(pseudoRand(city, i * 3) * STREET_NAMES.length)];
    const streetType = STREET_TYPES[Math.floor(pseudoRand(city, i * 3 + 1) * STREET_TYPES.length)];
    const suffix = SITE_SUFFIXES[Math.floor(pseudoRand(city, i * 3 + 2) * SITE_SUFFIXES.length)];
    const houseNum = Math.floor(pseudoRand(city, i * 7) * 200) + 1;

    // Offset lat/lng by up to ±0.012° (~1.3km) from city centre
    const latOffset = (pseudoRand(city, i * 11) - 0.5) * 0.024;
    const lngOffset = (pseudoRand(city, i * 13) - 0.5) * 0.024;

    const siteTypes = ['vacant_land', 'development_site', 'vacant_land']; // empty sites only
    const siteType = siteTypes[Math.floor(pseudoRand(city, i * 17) * siteTypes.length)];

    const areaM2 = Math.floor(pseudoRand(city, i * 19) * 4500) + 500; // 500–5000 m²

    sites.push({
      name: `${houseNum} ${streetName} ${streetType} — ${suffix}`,
      address: `${houseNum} ${streetName} ${streetType}, ${city}`,
      city,
      siteType,
      areaM2,
      lat: parseFloat((baseLat + latOffset).toFixed(6)),
      lng: parseFloat((baseLng + lngOffset).toFixed(6)),
      source: 'stub',
      sourceUrl: null,
      description: `${suffix} at ${houseNum} ${streetName} ${streetType}, ${city}. ` +
        `Site area approximately ${areaM2}m². Available for development. ` +
        `(Stub data — replace with live search results in production.)`,
    });
  }

  return sites;
}

// ─── Live search + geocoding pipeline ────────────────────────────────────────

/**
 * Parse Google Custom Search results into SiteResult objects.
 * Geocodes each result using Nominatim.
 * 
 * @param {Array<{title: string, snippet: string, link: string}>} searchResults
 * @param {string} city
 * @returns {Promise<Array<SiteResult>>}
 */
async function parseAndGeocodeResults(searchResults, city) {
  // Deduplicate by title
  const seen = new Set();
  const unique = searchResults.filter((r) => {
    if (seen.has(r.title)) return false;
    seen.add(r.title);
    return true;
  });

  const sites = [];

  for (const result of unique.slice(0, 8)) { // Cap at 8 to limit geocoding calls
    const address = extractAddress(result.title, result.snippet, city);
    const siteType = classifySiteType(result.title + ' ' + result.snippet);

    // Try to extract coordinates from the text directly first
    let coords = extractCoordinatesFromText(result.title + ' ' + result.snippet);

    // Otherwise geocode the address
    if (!coords) {
      const geocoded = await geocodeAddressRateLimited(address);
      if (geocoded) {
        coords = { lat: geocoded.lat, lng: geocoded.lng };
      }
    }

    if (!coords) {
      console.warn(`[SiteFinder] Could not geocode: "${address}" — skipping`);
      continue;
    }

    sites.push({
      name: result.title,
      address,
      city,
      siteType,
      areaM2: null, // Not available from search results
      lat: coords.lat,
      lng: coords.lng,
      source: 'google_custom_search',
      sourceUrl: result.link,
      description: result.snippet,
    });
  }

  return sites;
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * @typedef {Object} SiteResult
 * @property {string}         name         — Human-readable site name
 * @property {string}         address      — Street address for geocoding
 * @property {string}         city         — City name
 * @property {'vacant_land'|'derelict_building'|'development_site'|'unknown'} siteType
 * @property {number|null}    areaM2       — Site area in m² (if known)
 * @property {number}         lat          — Latitude (decimal degrees)
 * @property {number}         lng          — Longitude (decimal degrees)
 * @property {'google_custom_search'|'stub'} source
 * @property {string|null}    sourceUrl    — Original listing URL
 * @property {string}         description  — Short description
 */

/**
 * Find vacant/derelict sites in the given city.
 * 
 * @param {string} city          — City name (e.g. "Leeds", "Sheffield", "Manchester")
 * @param {object} [options]
 * @param {number} [options.count]      — Max sites to return (default: 5)
 * @param {boolean} [options.forceStub] — Force stub mode regardless of API key
 * @returns {Promise<SiteResult[]>}
 */
/**
 * Convert a scraped_sites DB row into a SiteResult.
 */
function rowToSiteResult(row) {
  return {
    name: row.name,
    address: row.address || row.city,
    city: row.city,
    siteType: row.site_type || 'brownfield',
    areaM2: row.area_m2 || null,
    lat: row.lat,
    lng: row.lng,
    source: 'scraped',
    sourceUrl: null,
    description: `${row.site_type || 'Brownfield'} site in ${row.city}. Pre-scraped from OpenStreetMap.`,
    imageUrl: row.image_url || null,
  };
}

async function findSites(city, options = {}) {
  const { count = 5, forceStub = false } = options;

  // Check pre-scraped DB first
  if (!forceStub) {
    const scraped = usageLogger.getScrapedSites(city);
    if (scraped.length > 0) {
      console.log(`[SiteFinder] Serving ${scraped.length} pre-scraped sites for "${city}"`);
      return scraped.slice(0, count).map(rowToSiteResult);
    }
    console.log(`[SiteFinder] No pre-scraped sites for "${city}" — using stub/live fallback`);
  }

  const useStub =
    forceStub ||
    process.env.SITE_FINDER_USE_STUB === 'true' ||
    !process.env.GOOGLE_SEARCH_API_KEY;

  if (useStub) {
    return generateStubSites(city, count);
  }

  console.log(`[SiteFinder] Searching for sites in: ${city}`);

  try {
    const searchResults = await googleCustomSearch(city);

    if (searchResults.length === 0) {
      console.warn('[SiteFinder] No Google Search results found. Falling back to stub sites.');
      return generateStubSites(city, count);
    }

    const sites = await parseAndGeocodeResults(searchResults, city);

    if (sites.length === 0) {
      console.warn('[SiteFinder] Geocoding produced no usable results. Falling back to stub sites.');
      return generateStubSites(city, count);
    }

    console.log(`[SiteFinder] Found ${sites.length} sites in ${city}.`);
    return sites.slice(0, count);
  } catch (e) {
    console.error('[SiteFinder] Live search failed:', e.message);
    console.log('[SiteFinder] Falling back to stub sites.');
    return generateStubSites(city, count);
  }
}

module.exports = {
  findSites,
  geocodeAddress: geocodeAddressRateLimited,
  generateStubSites,
  // Exported for testing
  extractCoordinatesFromText,
  classifySiteType,
  buildEarthUrl: undefined, // Defined in earth-capture.js
};
