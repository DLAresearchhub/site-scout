/**
 * Site Scout - Main App JavaScript
 * Handles all UI interactions and API calls
 */

// State management
const state = {
  currentStep: 1,
  selectedSite: null,
  selectedCapture: null,
  currentCity: null,
  generationCount: 0,
  jobId: null
};

// Initialize app
document.addEventListener('DOMContentLoaded', () => {
  attachEventListeners();
});

/**
 * Attach all event listeners
 */
function attachEventListeners() {
  // Step 1: Search form
  document.getElementById('search-form').addEventListener('submit', handleSearch);

  // Step 2: Earth controls
  document.getElementById('rotate-left').addEventListener('click', () => rotateView(-45));
  document.getElementById('rotate-right').addEventListener('click', () => rotateView(45));
  document.getElementById('rotate-all').addEventListener('click', rotateAll);
  document.getElementById('capture-btn').addEventListener('click', captureSite);
  document.getElementById('use-view-btn').addEventListener('click', () => goToStep(3));

  // Step 3: Config form
  document.getElementById('config-form').addEventListener('submit', handleGenerate);

  // Step 5: Results
  document.getElementById('new-search-btn').addEventListener('click', resetApp);
}

/**
 * Step management
 */
function goToStep(step) {
  // Hide all steps
  document.querySelectorAll('.step').forEach(el => el.classList.remove('active'));

  // Show target step
  document.getElementById(`step-${step}`).classList.add('active');

  state.currentStep = step;
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

/**
 * Step 1: Handle city search
 */
async function handleSearch(e) {
  e.preventDefault();

  const city = document.getElementById('city-input').value.trim();
  if (!city) return;

  const btn = document.querySelector('#search-form button');
  btn.disabled = true;
  btn.textContent = 'Searching...';

  try {
    const response = await fetch('/api/search-sites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ city })
    });

    if (!response.ok) throw new Error('Search failed');

    const data = await response.json();
    state.currentCity = city;

    displaySearchResults(data.sites);
  } catch (error) {
    console.error('Search error:', error);
    alert('Failed to search sites. Please try again.');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Search';
  }
}

/**
 * Display search results as cards
 */
function displaySearchResults(sites) {
  const container = document.getElementById('search-results');
  container.innerHTML = '';

  sites.forEach(site => {
    const bbox = `${(site.lng-0.004).toFixed(6)},${(site.lat-0.003).toFixed(6)},${(site.lng+0.004).toFixed(6)},${(site.lat+0.003).toFixed(6)}`;
    const embedUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${site.lat},${site.lng}`;
    const siteTypeLabel = site.siteType === 'development_site' ? 'Development Site' : 'Vacant Land';
    const card = document.createElement('div');
    card.className = 'site-card';
    card.innerHTML = `
      <div class="site-card-image">
        <iframe src="${embedUrl}" style="width:100%;height:100%;border:none;border-radius:8px 8px 0 0;pointer-events:none;" loading="lazy" title="Map of ${site.address}"></iframe>
      </div>
      <div class="site-card-content">
        <div class="site-card-title">${site.name}</div>
        <div class="site-card-address">${site.address}</div>
        <div class="site-card-type">${siteTypeLabel}</div>
        <button class="btn btn-primary" onclick="selectSite(${JSON.stringify(site).replace(/"/g, '&quot;')})">
          Scout This Site
        </button>
      </div>
    `;
    container.appendChild(card);
  });
}

/**
 * Select a site and move to Earth view
 */
function selectSite(site) {
  state.selectedSite = site;
  document.getElementById('site-description').textContent = 
    `${site.name} • ${site.address}`;
  goToStep(2);
  loadEarthView(site);
}

/**
 * Load Earth view with placeholder
 */
function loadEarthView(site) {
  const earthView = document.getElementById('earth-view');
  earthView.innerHTML = `
    <img src="${generatePlaceholderEarthImage(site.lat, site.lng)}" alt="Earth View">
  `;

  // Load capture thumbnails
  loadCaptures(site);
}

/**
 * Generate Earth placeholder
 */
function generatePlaceholderEarthImage(lat, lng) {
  return `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='800' height='500'%3E%3Cdefs%3E%3ClinearGradient id='grad' x1='0%25' y1='0%25' x2='100%25' y2='100%25'%3E%3Cstop offset='0%25' style='stop-color:%231a1a2a;stop-opacity:1'/%3E%3Cstop offset='100%25' style='stop-color:%230f1a1a;stop-opacity:1'/%3E%3C/linearGradient%3E%3C/defs%3E%3Crect width='800' height='500' fill='url(%23grad)'/%3E%3Ccircle cx='300' cy='150' r='80' fill='%234f8ef7' opacity='0.3'/%3E%3Ccircle cx='500' cy='250' r='100' fill='%234caf87' opacity='0.2'/%3E%3Ctext x='400' y='250' text-anchor='middle' fill='%238888aa' font-size='18'%3EGoogle Earth View%3C/text%3E%3Ctext x='400' y='280' text-anchor='middle' fill='%238888aa' font-size='12'%3E${lat.toFixed(4)}, ${lng.toFixed(4)}%3C/text%3E%3C/svg%3E`;
}

/**
 * Load capture thumbnails
 */
async function loadCaptures(site) {
  try {
    const response = await fetch('/api/capture-site', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        site_id: site.id,
        lat: site.lat,
        lng: site.lng
      })
    });

    if (!response.ok) throw new Error('Capture failed');

    const data = await response.json();
    displayCaptures(data.captures);
  } catch (error) {
    console.error('Capture error:', error);
    // Continue anyway with placeholder captures
    const placeholders = [
      { angle: 0, screenshot_url: '' },
      { angle: 45, screenshot_url: '' },
      { angle: 90, screenshot_url: '' }
    ];
    displayCaptures(placeholders);
  }
}

/**
 * Display capture thumbnails
 */
function displayCaptures(captures) {
  const strip = document.getElementById('captures-strip');
  strip.innerHTML = '';

  captures.slice(0, 6).forEach((capture, idx) => {
    const thumb = document.createElement('div');
    thumb.className = `capture-thumb ${idx === 0 ? 'selected' : ''}`;
    thumb.onclick = () => selectCapture(capture, thumb);
    thumb.innerHTML = `
      <div style="width:100%; height:100%; background:linear-gradient(135deg, #2a2a3a 0%, #1a1a2a 100%); display:flex; align-items:center; justify-content:center; color:#888; font-size:12px;">
        ${capture.angle}°
      </div>
    `;
    strip.appendChild(thumb);
  });

  if (captures.length > 0) {
    state.selectedCapture = captures[0];
  }
}

/**
 * Select capture
 */
function selectCapture(capture, element) {
  document.querySelectorAll('.capture-thumb').forEach(el => el.classList.remove('selected'));
  element.classList.add('selected');
  state.selectedCapture = capture;
}

/**
 * Rotate view (stub)
 */
function rotateView(degrees) {
  console.log(`Rotating ${degrees} degrees`);
  alert(`View rotated ${degrees}° (stub implementation)`);
}

/**
 * Rotate all views (stub)
 */
function rotateAll() {
  console.log('Auto-rotating all angles');
  alert('Auto-rotating through all angles... (stub implementation)');
}

/**
 * Capture site
 */
function captureSite() {
  alert('Capturing current view from Google Earth... (stub implementation)');
}

/**
 * Step 3: Handle generation
 */
async function handleGenerate(e) {
  e.preventDefault();

  const buildingType = document.getElementById('building-type').value;
  const stories = document.getElementById('stories').value;
  const styleNotes = document.getElementById('style-notes').value;
  const includeInteriors = document.getElementById('include-interiors').checked;

  if (!buildingType || !stories) {
    alert('Please select building type and stories');
    return;
  }

  goToStep(4);
  startGeneration({
    buildingType,
    stories,
    styleNotes,
    includeInteriors
  });
}

/**
 * Start generation process
 */
async function startGeneration(config) {
  try {
    const response = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        site_id: state.selectedSite.id,
        capture_url: state.selectedCapture?.screenshot_url || '',
        building_type: config.buildingType,
        stories: config.stories,
        style_notes: config.styleNotes,
        include_interiors: config.includeInteriors,
        city: state.currentCity
      })
    });

    if (!response.ok) throw new Error('Generation failed');

    const data = await response.json();
    state.jobId = data.job_id;

    // Poll for progress
    pollGenerationProgress();
  } catch (error) {
    console.error('Generation error:', error);
    alert('Failed to start generation. Please try again.');
    goToStep(3);
  }
}

/**
 * Poll generation progress
 */
async function pollGenerationProgress() {
  const maxAttempts = 120; // 2 minutes with 1s intervals
  let attempt = 0;

  const poll = setInterval(async () => {
    attempt++;

    try {
      const response = await fetch(`/api/status/${state.jobId}`);
      if (!response.ok) throw new Error('Status check failed');

      const data = await response.json();

      // Update progress bar
      const progressFill = document.getElementById('progress-fill');
      progressFill.style.width = `${data.progress}%`;

      // Cycle status messages
      const messages = [
        'Analysing site context...',
        'Building architectural prompt...',
        'Generating aerial CGI...',
        'Creating street-level views...',
        'Finishing up...'
      ];
      const msgIndex = Math.floor((data.progress / 100) * (messages.length - 1));
      document.getElementById('progress-message').textContent = messages[msgIndex];

      // Check if done
      if (data.status === 'completed') {
        clearInterval(poll);
        displayResults(data.images);
      } else if (data.status === 'error') {
        clearInterval(poll);
        alert(`Generation failed: ${data.message}`);
        goToStep(3);
      }
    } catch (error) {
      console.error('Poll error:', error);
    }

    if (attempt >= maxAttempts) {
      clearInterval(poll);
      alert('Generation timeout. Please try again.');
      goToStep(3);
    }
  }, 500);
}

/**
 * Display results
 */
function displayResults(images) {
  if (images.length === 0) {
    alert('No images generated');
    goToStep(3);
    return;
  }

  // Set hero image (first image, usually aerial)
  const aerialImage = images.find(img => img.type === 'aerial') || images[0];
  document.getElementById('hero-image').src = aerialImage.url;

  // Display grid images (everything except aerial)
  const gridImages = images.filter(img => img.type !== 'aerial');
  const gridContainer = document.getElementById('grid-images');
  gridContainer.innerHTML = '';

  gridImages.forEach(img => {
    const item = document.createElement('div');
    item.className = 'grid-image-item';
    item.innerHTML = `
      <img src="${img.url}" alt="${img.type}">
      <button class="btn btn-secondary download-btn" onclick="downloadImage(this)">Download</button>
    `;
    gridContainer.appendChild(item);
  });

  // Update generation count and display
  state.generationCount++;
  document.getElementById('session-info').textContent = 
    `Session used ${state.generationCount} generation${state.generationCount !== 1 ? 's' : ''}`;

  goToStep(5);
}

/**
 * Download image
 */
function downloadImage(btn) {
  const img = btn.closest('.grid-image-item, .hero-image')?.querySelector('img');
  if (!img) return;

  const link = document.createElement('a');
  link.href = img.src;
  link.download = `site-scout-${Date.now()}.png`;
  link.click();
}

/**
 * Reset app
 */
function resetApp() {
  state.currentStep = 1;
  state.selectedSite = null;
  state.selectedCapture = null;
  state.jobId = null;

  document.getElementById('city-input').value = '';
  document.getElementById('building-type').value = '';
  document.getElementById('stories').value = '';
  document.getElementById('style-notes').value = '';
  document.getElementById('include-interiors').checked = true;
  document.getElementById('search-results').innerHTML = '';

  goToStep(1);
}
