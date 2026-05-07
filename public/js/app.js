'use strict';

// ── State ─────────────────────────────────────────────────────────────────

const state = {
  currentStep: 1,
  selectedSite: null,
  selectedCapture: null,   // { id, proxyUrl, type, direction, label } — annotated when user drew a boundary
  originalCapture: null,   // un-annotated capture (always shown on results for compare)
  hasBoundary: false,
  currentCity: null,
  jobId: null,
  user: null,
  referenceImages: [],     // [{ dataUrl, data (base64), mimeType }]
  generationCount: 0,
  overviewMap: null,
  overlayPrefs: {},        // { flood: true, amenities: true, listed: false, solar: false }
  overlayCache: {},        // siteKey → { overlayName: data }
  presets: {},             // building_type → preset[] (from /api/presets)
  activePreset: null,      // selected preset object
  followupJobId: null,
  chosenResultUrl: null,
};

// ── Init ──────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Init pill UI
  const pillContainer = document.getElementById('pill-rows-container');
  window.PromptBuilder.initPillUI(pillContainer, onPillStateChange);

  // Pull public client config (Map Tiles key, etc.)
  fetch('/api/config').then(r => r.json()).then(cfg => {
    state.googleMapTilesKey = cfg.googleMapTilesKey;
  }).catch(() => {});

  // (Overlay toggles removed in pivot to image-generator — keep loaders in
  // the file for any future re-enable, just don't init them here.)

  // Wire viewer overlay buttons
  const resetBtn  = document.getElementById('viewer-reset-btn');
  const topBtn    = document.getElementById('viewer-top-btn');
  const useBtn    = document.getElementById('configure-btn');
  const rotLBtn   = document.getElementById('viewer-rot-l-btn');
  const rotRBtn   = document.getElementById('viewer-rot-r-btn');
  const tiltUpBtn = document.getElementById('viewer-tilt-up-btn');
  const tiltDnBtn = document.getElementById('viewer-tilt-down-btn');
  if (resetBtn)  resetBtn.addEventListener('click', () => resetSiteViewer());
  if (topBtn)    topBtn.addEventListener('click',   () => topDownSiteViewer());
  if (useBtn)    useBtn.addEventListener('click',   () => useThisView());
  if (rotLBtn)   rotLBtn.addEventListener('click',  () => nudgeViewer('rotateLeft'));
  if (rotRBtn)   rotRBtn.addEventListener('click',  () => nudgeViewer('rotateRight'));
  if (tiltUpBtn) tiltUpBtn.addEventListener('click',() => nudgeViewer('tiltUp'));
  if (tiltDnBtn) tiltDnBtn.addEventListener('click',() => nudgeViewer('tiltDown'));

  // Boundary editor buttons
  const bClear = document.getElementById('boundary-clear-btn');
  const bSkip  = document.getElementById('boundary-skip-btn');
  const bSave  = document.getElementById('boundary-save-btn');
  const bUndo  = document.getElementById('boundary-undo-btn');
  const bClose = document.getElementById('boundary-close-poly-btn');
  if (bClear) bClear.addEventListener('click', () => clearBoundary());
  if (bSkip)  bSkip.addEventListener('click',  () => skipBoundary());
  if (bSave)  bSave.addEventListener('click',  () => saveBoundary());
  if (bUndo)  bUndo.addEventListener('click',  () => undoBoundary());
  if (bClose) bClose.addEventListener('click', () => closePolygon());

  // Tool selector (brush / line / polygon / circle)
  document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      _boundary.tool = btn.dataset.tool;
      _boundary.polyVerts = []; // cancel any in-progress polygon when switching tools
      const closeBtn = document.getElementById('boundary-close-poly-btn');
      if (closeBtn) closeBtn.style.display = (_boundary.tool === 'polygon') ? 'inline-flex' : 'none';
    });
  });

  // Fetch presets (used in Step 3 when a building type is picked)
  fetch('/api/presets').then(r => r.json()).then(data => {
    state.presets = data || {};
  }).catch(err => console.warn('[presets] fetch failed:', err));

  // Load user/credits
  fetch('/api/me').then(r => r.json()).then(data => {
    state.user = data.authenticated ? data.user : null;
    updateCreditDisplay(data.credits, data.authenticated);
  }).catch(() => {});

  // Check OAuth redirect result
  const params = new URLSearchParams(location.search);
  if (params.get('auth') === 'success') {
    history.replaceState({}, '', '/');
  }
});

// ── Auth ──────────────────────────────────────────────────────────────────

function handleAuthClick() {
  if (state.user) {
    fetch('/auth/logout', { method: 'POST' }).then(() => location.reload());
  } else {
    location.href = '/auth/google';
  }
}

function updateCreditDisplay(credits, authenticated) {
  const display = document.getElementById('credit-display');
  const count = document.getElementById('credit-count');
  const btn = document.getElementById('auth-btn');

  if (credits !== undefined) {
    display.style.display = 'flex';
    count.textContent = credits;
  }

  if (authenticated && state.user) {
    btn.textContent = 'Sign out';
  }
}

// ── Navigation ────────────────────────────────────────────────────────────

function goToStep(n) {
  document.querySelectorAll('.step').forEach(s => s.classList.remove('active'));
  document.getElementById(`step-${n}`).classList.add('active');
  state.currentStep = n;

  // Step indicator
  const indicator = document.getElementById('step-indicator');
  indicator.style.display = n > 1 ? 'flex' : 'none';
  document.querySelectorAll('.step-pip').forEach(pip => {
    const s = parseInt(pip.dataset.step);
    pip.classList.remove('active', 'done');
    if (s === n) pip.classList.add('active');
    else if (s < n) pip.classList.add('done');
  });

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ── Step 1: Fly anywhere (default) + curated preset sites (optional) ──────

// Hardcoded centres for the chip cities. For free-text addresses we hit
// Nominatim via /api/geocode (added with address-search work).
const CITY_COORDS = {
  London:     [51.5074, -0.1278], Manchester: [53.4808, -2.2426],
  Leeds:      [53.8008, -1.5491], Birmingham: [52.4862, -1.8904],
  Bristol:    [51.4545, -2.5879], Sheffield:  [53.3811, -1.4701],
  Liverpool:  [53.4084, -2.9916], Edinburgh:  [55.9533, -3.1883],
  Glasgow:    [55.8642, -4.2518], Newcastle:  [54.9783, -1.6178],
  Nottingham: [52.9548, -1.1581], Cardiff:    [51.4816, -3.1791],
  York:       [53.9590, -1.0815], Leicester:  [52.6369, -1.1398],
  Bradford:   [53.7950, -1.7594],
};

function quickFlyTo(city) {
  document.getElementById('city-input').value = city;
  flyToPlace(city);
}

function handleSearch(e) {
  e.preventDefault();
  const text = document.getElementById('city-input').value.trim();
  if (text) flyToPlace(text);
}

function flyToPlace(name) {
  state.currentCity = name;
  state.selectedSite = { name, address: '', lat: 0, lng: 0 };

  const coords = CITY_COORDS[name];
  if (coords) {
    state.selectedSite.lat = coords[0];
    state.selectedSite.lng = coords[1];
    enterFreePan(coords[0], coords[1], 14, name);
    return;
  }

  // Unknown text — try Nominatim via the server proxy, fall back to London if it fails.
  document.getElementById('search-loading').style.display = 'flex';
  fetch('/api/geocode?q=' + encodeURIComponent(name))
    .then(r => r.json())
    .then(g => {
      document.getElementById('search-loading').style.display = 'none';
      if (g && g.lat && g.lng) {
        state.selectedSite.lat = g.lat;
        state.selectedSite.lng = g.lng;
        enterFreePan(g.lat, g.lng, 16, g.displayName || name);
      } else {
        alert('Couldn\'t find that place. Try a city name or a UK address.');
      }
    })
    .catch(() => {
      document.getElementById('search-loading').style.display = 'none';
      alert('Geocoding failed. Try a city name or a UK address.');
    });
}

function enterFreePan(lat, lng, zoom, label) {
  document.getElementById('step2-site-name').textContent = label || 'Free pan mode';
  document.getElementById('configure-btn').disabled = true;
  state.flyZoom = zoom || 14;
  goToStep(2);
  initSiteViewer(parseFloat(lat), parseFloat(lng));
}

function togglePresetSites() {
  const grid = document.getElementById('site-results');
  const btn = document.getElementById('preset-sites-toggle');
  const isOpen = grid.style.display !== 'none' && grid.children.length > 0;
  if (isOpen) {
    grid.style.display = 'none';
    document.getElementById('overview-map-wrap').style.display = 'none';
    btn.innerHTML = '&#9776; Preset sites &mdash; show curated brownfield list';
    return;
  }
  // Need a city to fetch presets for; use the chip city or default to Leeds (the only fully scraped one)
  const city = (document.getElementById('city-input').value.trim()) || 'Leeds';
  state.currentCity = city;
  searchCity(city);
  btn.innerHTML = '&#10005; Hide preset sites';
}

async function searchCity(city) {
  state.currentCity = city;
  document.getElementById('search-loading').style.display = 'flex';
  document.getElementById('site-results').innerHTML = '';
  document.getElementById('site-results').style.display = '';
  document.getElementById('overview-map-wrap').style.display = 'none';

  try {
    const res = await fetch('/api/search-sites', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ city }),
    });
    const data = await res.json();
    document.getElementById('search-loading').style.display = 'none';

    if (!data.sites || data.sites.length === 0) {
      document.getElementById('site-results').innerHTML = '<p class="empty-msg">No curated sites for this city yet. Pan around the 3D map and capture your own.</p>';
      return;
    }

    renderOverviewMap(data.sites);
    renderSiteGrid(data.sites);
  } catch {
    document.getElementById('search-loading').style.display = 'none';
    document.getElementById('site-results').innerHTML = '<p class="empty-msg">Search failed. Please try again.</p>';
  }
}

function renderOverviewMap(sites) {
  const wrap = document.getElementById('overview-map-wrap');
  wrap.style.display = 'block';

  if (state.overviewMap) {
    state.overviewMap.remove();
    state.overviewMap = null;
  }

  const validSites = sites.filter(s => s.lat && s.lng);
  if (!validSites.length) return;

  const map = window.L.map('overview-map', { zoomControl: true });
  state.overviewMap = map;

  window.L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles &copy; Esri',
    maxZoom: 19,
  }).addTo(map);

  const bounds = [];
  validSites.forEach(site => {
    bounds.push([site.lat, site.lng]);
    const marker = window.L.circleMarker([site.lat, site.lng], {
      radius: 8, fillColor: '#f97316', color: '#fff', weight: 2, fillOpacity: 0.9,
    }).addTo(map);
    marker.bindPopup(`<strong>${site.name}</strong><br>${site.address || ''}`);
  });

  map.fitBounds(bounds, { padding: [30, 30] });
}

function renderSiteGrid(sites) {
  const grid = document.getElementById('site-results');
  grid.innerHTML = '';

  sites.forEach(site => {
    const card = document.createElement('div');
    card.className = 'site-card';

    const siteType = site.siteType || site.site_type || 'brownfield';
    const badgeClass = siteType.includes('vacant') ? 'vacant' : 'brownfield';
    const badgeText = siteType.replace(/_/g, ' ');

    // Image / map embed
    let mediaHtml = '';
    if (site.imageUrl || site.image_url) {
      mediaHtml = `<img class="site-card-img" src="${site.imageUrl || site.image_url}" alt="${site.name}" loading="lazy" onerror="this.style.display='none'">`;
    } else if (site.lat && site.lng) {
      const osmUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${site.lng - 0.005},${site.lat - 0.005},${site.lng + 0.005},${site.lat + 0.005}&layer=mapnik&marker=${site.lat},${site.lng}`;
      mediaHtml = `<iframe class="site-card-iframe" src="${osmUrl}" title="Map" loading="lazy"></iframe>`;
    }

    card.innerHTML = `
      ${mediaHtml}
      <div class="site-card-body">
        <div class="site-card-name" title="${site.name}">${site.name}</div>
        <div class="site-card-address">${site.address || site.city || ''}</div>
        <div class="site-card-meta">
          <span class="site-badge ${badgeClass}">${badgeText}</span>
          ${site.areaM2 || site.area_m2 ? `<span class="site-badge">${Math.round((site.areaM2 || site.area_m2) / 10) / 100} ha</span>` : ''}
        </div>
      </div>
      <div class="site-card-footer">
        <button class="btn-primary" onclick="selectSite(${JSON.stringify(site).replace(/"/g, '&quot;')})">Scout This Site</button>
      </div>
    `;

    grid.appendChild(card);
  });
}

// ── Step 2: Cesium + Google Photorealistic 3D Tiles, locked-orbit ──────────

const VIEWER_DEFAULTS = { headingDeg: 0, pitchDeg: -30, rangeMeters: 600 };

function selectSite(site) {
  state.selectedSite = site;
  state.selectedCapture = null;
  document.getElementById('step2-site-name').textContent = `${site.name}${site.address ? ' — ' + site.address : ''}`;
  document.getElementById('configure-btn').disabled = true;
  goToStep(2);
  initSiteViewer(parseFloat(site.lat), parseFloat(site.lng));
}

async function initSiteViewer(lat, lng) {
  const errEl  = document.getElementById('viewer-error');
  const loadEl = document.getElementById('viewer-loading');
  const overlaySection = document.getElementById('overlay-section');
  if (overlaySection) overlaySection.style.display = '';
  errEl.style.display = 'none';
  loadEl.style.display = 'flex';

  if (!window.Cesium || !state.googleMapTilesKey) {
    loadEl.style.display = 'none';
    errEl.style.display = 'block';
    errEl.textContent = !state.googleMapTilesKey
      ? '3D viewer needs GOOGLE_MAPS_TILES_KEY set on the server.'
      : 'CesiumJS failed to load (CDN blocked?).';
    return;
  }

  // Tear down previous viewer if user picks another site
  if (state.siteViewer) { try { state.siteViewer.destroy(); } catch (_) {} state.siteViewer = null; }

  try {
    const viewer = new Cesium.Viewer('site-viewer', {
      baseLayerPicker: false, geocoder: false, homeButton: false, sceneModePicker: false,
      navigationHelpButton: false, animation: false, timeline: false, fullscreenButton: false,
      infoBox: false, selectionIndicator: false,
      // toDataURL needs preserveDrawingBuffer
      contextOptions: { webgl: { preserveDrawingBuffer: true } },
      // We use Google 3D Tiles, not Cesium's default imagery globe
      imageryProvider: false,
    });

    // Hide the default flat globe — Google 3D Tiles include terrain + buildings
    viewer.scene.globe.show = false;
    viewer.scene.skyAtmosphere.show = false;
    viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#0b0b0d');

    state.siteViewer = viewer;

    // Load Google Photorealistic 3D Tiles (Map Tiles API)
    const tileset = await Cesium.createGooglePhotorealistic3DTileset({ key: state.googleMapTilesKey });
    viewer.scene.primitives.add(tileset);
    state.siteTileset = tileset;

    // Free-pan mode: fly to the chosen lat/lng, then let the user roam.
    const center = Cesium.Cartesian3.fromDegrees(lng, lat, 0);
    state.siteViewerCenter = center;

    // Choose an initial camera height based on the requested zoom hint.
    // City overview ~14 → 1500m; address ~16 → 600m.
    const initialAltitude = state.flyZoom >= 16 ? 600 : (state.flyZoom >= 15 ? 900 : 1500);
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(lng, lat, initialAltitude),
      orientation: {
        heading: Cesium.Math.toRadians(VIEWER_DEFAULTS.headingDeg),
        pitch:   Cesium.Math.toRadians(VIEWER_DEFAULTS.pitchDeg),
        roll:    0,
      },
      duration: 1.5,
      complete: () => { document.getElementById('configure-btn').disabled = false; },
    });

    // Free pan + rotate + tilt + zoom. Rebind so right-drag actually rotates
    // the camera (Cesium's default is right-drag = zoom, which surprises users).
    const ctl = viewer.scene.screenSpaceCameraController;
    ctl.enableTranslate = true;
    ctl.enableRotate    = true;   // LEFT_DRAG: rotate globe under camera (feels like pan when close)
    ctl.enableTilt      = true;
    ctl.enableLook      = true;   // we'll bind this to RIGHT_DRAG below for rotate/tilt the camera in place
    ctl.enableZoom      = true;
    ctl.lookEventTypes  = [Cesium.CameraEventType.RIGHT_DRAG];
    ctl.zoomEventTypes  = [Cesium.CameraEventType.WHEEL, Cesium.CameraEventType.PINCH];
    ctl.tiltEventTypes  = [
      Cesium.CameraEventType.MIDDLE_DRAG,
      { eventType: Cesium.CameraEventType.LEFT_DRAG, modifier: Cesium.KeyboardEventModifier.CTRL },
    ];

    // Update readout on every render tick
    viewer.scene.postRender.addEventListener(updateViewerReadout);

    loadEl.style.display = 'none';
    document.getElementById('configure-btn').disabled = false;
  } catch (err) {
    console.error('[viewer]', err);
    loadEl.style.display = 'none';
    errEl.style.display = 'block';
    errEl.textContent = '3D viewer error: ' + (err && err.message || 'unknown');
  }
}

function updateViewerReadout() {
  const viewer = state.siteViewer;
  if (!viewer) return;
  const headingDeg = ((Cesium.Math.toDegrees(viewer.camera.heading) % 360) + 360) % 360;
  const pitchDeg   = Cesium.Math.toDegrees(viewer.camera.pitch);
  document.getElementById('readout-bearing').textContent = `${Math.round(headingDeg)}°`;
  document.getElementById('readout-pitch').textContent   = `${Math.round(Math.abs(pitchDeg))}° tilt`;
}

function resetSiteViewer() {
  const viewer = state.siteViewer;
  const site = state.selectedSite;
  if (!viewer || !site) return;
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(site.lng, site.lat, state.flyZoom >= 16 ? 600 : 1500),
    orientation: {
      heading: Cesium.Math.toRadians(VIEWER_DEFAULTS.headingDeg),
      pitch:   Cesium.Math.toRadians(VIEWER_DEFAULTS.pitchDeg),
      roll: 0,
    },
    duration: 0.8,
  });
}

function topDownSiteViewer() {
  const viewer = state.siteViewer;
  const site = state.selectedSite;
  if (!viewer || !site) return;
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(site.lng, site.lat, state.flyZoom >= 16 ? 500 : 1200),
    orientation: { heading: 0, pitch: Cesium.Math.toRadians(-89.9), roll: 0 },
    duration: 0.8,
  });
}

// Explicit rotate / tilt nudges so users don't have to discover Cesium's
// keybindings. Each click fires a short flyTo that adjusts heading or pitch
// while keeping the camera position the same.
function nudgeViewer(action) {
  const viewer = state.siteViewer;
  if (!viewer) return;
  const cam = viewer.camera;
  const headingStep = Math.PI / 12;   // 15°
  const pitchStep   = Math.PI / 18;   // 10°
  let heading = cam.heading;
  let pitch   = cam.pitch;

  if (action === 'rotateLeft')  heading -= headingStep;
  if (action === 'rotateRight') heading += headingStep;
  if (action === 'tiltUp')      pitch = Math.min( Cesium.Math.toRadians(-1),  pitch + pitchStep);
  if (action === 'tiltDown')    pitch = Math.max( Cesium.Math.toRadians(-89), pitch - pitchStep);

  cam.flyTo({
    destination: cam.position.clone(),
    orientation: { heading, pitch, roll: 0 },
    duration: 0.25,
  });
}

async function useThisView() {
  const viewer = state.siteViewer;
  const site = state.selectedSite;
  if (!viewer || !site) return;

  const btn = document.getElementById('configure-btn');
  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Capturing view…';

  try {
    viewer.render();
    const dataUrl = viewer.scene.canvas.toDataURL('image/jpeg', 0.92);

    const res = await fetch('/api/capture-canvas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        site_id: site.id || site.name,
        dataUrl,
        bearing: Cesium.Math.toDegrees(viewer.camera.heading),
        pitch:   Cesium.Math.toDegrees(viewer.camera.pitch),
        zoom:    0,
      }),
    });
    if (!res.ok) throw new Error('capture-canvas ' + res.status);
    const capture = await res.json();

    // Stash the original (un-annotated) capture for the results page comparison.
    // Boundary editor may overwrite state.selectedCapture with an annotated version.
    state.originalCapture = capture;
    state.selectedCapture = capture;
    state.hasBoundary = false;

    enterBoundaryEditor(dataUrl);
  } catch (err) {
    console.error('[useThisView]', err);
    alert('Could not capture this view: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

// ── Boundary editor (red-line site outline) ─────────────────────────────────
// Tools: brush · line · polygon · circle. Plus undo + clear + close-polygon.

const _boundary = {
  baseDataUrl: null,
  drawCtx: null,
  baseCtx: null,
  width: 0,
  height: 0,
  hasInk: false,
  tool: 'brush',
  // Brush
  drawing: false,
  lastX: 0,
  lastY: 0,
  // Line / Circle preview
  previewSnap: null,
  startX: 0,
  startY: 0,
  // Polygon (vertex-by-vertex)
  polyVerts: [],
  polyCommittedSnap: null,
  polyCursorX: 0,
  polyCursorY: 0,
  // Undo
  undoStack: [],
};

const STROKE_RGBA = 'rgba(220, 38, 38, 0.95)';
const STROKE_W = 6;
const VERTEX_R = 5;
const UNDO_LIMIT = 25;

function enterBoundaryEditor(dataUrl) {
  document.querySelector('.viewer-shell').style.display = 'none';
  document.getElementById('step2-actions').style.display = 'none';
  document.querySelector('.capture-instructions').style.display = 'none';
  const editor = document.getElementById('boundary-editor');
  editor.style.display = 'block';

  const baseCanvas = document.getElementById('boundary-base');
  const drawCanvas = document.getElementById('boundary-draw');

  const img = new Image();
  img.onload = () => {
    const maxW = Math.min(960, document.querySelector('#boundary-canvas-wrap').clientWidth || 960);
    const scale = Math.min(1, maxW / img.naturalWidth);
    const w = Math.round(img.naturalWidth * scale);
    const h = Math.round(img.naturalHeight * scale);

    baseCanvas.width = drawCanvas.width = w;
    baseCanvas.height = drawCanvas.height = h;

    _boundary.width  = w;
    _boundary.height = h;
    _boundary.baseDataUrl = dataUrl;
    _boundary.baseCtx = baseCanvas.getContext('2d');
    _boundary.drawCtx = drawCanvas.getContext('2d');
    _boundary.hasInk = false;
    _boundary.undoStack = [];
    _boundary.polyVerts = [];
    _boundary.previewSnap = null;

    _boundary.baseCtx.drawImage(img, 0, 0, w, h);
    _boundary.drawCtx.clearRect(0, 0, w, h);

    _boundary.drawCtx.lineCap = 'round';
    _boundary.drawCtx.lineJoin = 'round';
    _boundary.drawCtx.lineWidth = STROKE_W;
    _boundary.drawCtx.strokeStyle = STROKE_RGBA;
    _boundary.drawCtx.fillStyle = STROKE_RGBA;

    bindBoundaryDrawing(drawCanvas);
  };
  img.src = dataUrl;
}

function _coords(canvas, clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  return [
    (clientX - rect.left) * (canvas.width  / rect.width),
    (clientY - rect.top)  * (canvas.height / rect.height),
  ];
}

function _pushUndo() {
  if (!_boundary.drawCtx) return;
  try {
    _boundary.undoStack.push(_boundary.drawCtx.getImageData(0, 0, _boundary.width, _boundary.height));
    if (_boundary.undoStack.length > UNDO_LIMIT) _boundary.undoStack.shift();
  } catch (_) {}
}

function undoBoundary() {
  if (!_boundary.drawCtx) return;
  if (_boundary.undoStack.length === 0) return;
  const prev = _boundary.undoStack.pop();
  _boundary.drawCtx.putImageData(prev, 0, 0);
  _boundary.polyVerts = [];
  _boundary.previewSnap = null;
  _boundary.hasInk = !_isCanvasBlank();
}

function _isCanvasBlank() {
  const d = _boundary.drawCtx.getImageData(0, 0, _boundary.width, _boundary.height).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] !== 0) return false;
  return true;
}

function _drawVertexDots(verts) {
  const ctx = _boundary.drawCtx;
  ctx.save();
  ctx.fillStyle = STROKE_RGBA;
  for (const v of verts) {
    ctx.beginPath();
    ctx.arc(v.x, v.y, VERTEX_R, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function _renderPolygonPreview() {
  if (!_boundary.polyCommittedSnap) return;
  const ctx = _boundary.drawCtx;
  ctx.putImageData(_boundary.polyCommittedSnap, 0, 0);
  // Re-draw vertex dots and connecting lines so far
  const verts = _boundary.polyVerts;
  if (verts.length > 0) {
    ctx.beginPath();
    ctx.moveTo(verts[0].x, verts[0].y);
    for (let i = 1; i < verts.length; i++) ctx.lineTo(verts[i].x, verts[i].y);
    // Preview line from last vertex to current cursor
    ctx.lineTo(_boundary.polyCursorX, _boundary.polyCursorY);
    ctx.setLineDash([8, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    _drawVertexDots(verts);
  }
}

function closePolygon() {
  if (!_boundary.drawCtx || _boundary.polyVerts.length < 3) {
    _boundary.polyVerts = [];
    _boundary.polyCommittedSnap = null;
    return;
  }
  const ctx = _boundary.drawCtx;
  if (_boundary.polyCommittedSnap) ctx.putImageData(_boundary.polyCommittedSnap, 0, 0);
  ctx.beginPath();
  const verts = _boundary.polyVerts;
  ctx.moveTo(verts[0].x, verts[0].y);
  for (let i = 1; i < verts.length; i++) ctx.lineTo(verts[i].x, verts[i].y);
  ctx.closePath();
  ctx.stroke();
  _boundary.polyVerts = [];
  _boundary.polyCommittedSnap = null;
  _boundary.hasInk = true;
}

function bindBoundaryDrawing(canvas) {
  const onDown = (clientX, clientY) => {
    const [x, y] = _coords(canvas, clientX, clientY);

    if (_boundary.tool === 'brush') {
      _pushUndo();
      _boundary.drawing = true;
      _boundary.lastX = x; _boundary.lastY = y;
      // Single-pixel start dot for tap-to-mark
      const ctx = _boundary.drawCtx;
      ctx.beginPath(); ctx.arc(x, y, STROKE_W / 2, 0, Math.PI * 2); ctx.fill();
      _boundary.hasInk = true;
    } else if (_boundary.tool === 'line') {
      _pushUndo();
      _boundary.drawing = true;
      _boundary.startX = x; _boundary.startY = y;
      _boundary.previewSnap = _boundary.drawCtx.getImageData(0, 0, _boundary.width, _boundary.height);
    } else if (_boundary.tool === 'circle') {
      _pushUndo();
      _boundary.drawing = true;
      _boundary.startX = x; _boundary.startY = y;
      _boundary.previewSnap = _boundary.drawCtx.getImageData(0, 0, _boundary.width, _boundary.height);
    } else if (_boundary.tool === 'polygon') {
      // First click: snapshot for preview restore
      if (_boundary.polyVerts.length === 0) {
        _pushUndo();
        _boundary.polyCommittedSnap = _boundary.drawCtx.getImageData(0, 0, _boundary.width, _boundary.height);
      }
      _boundary.polyVerts.push({ x, y });
      _boundary.polyCursorX = x; _boundary.polyCursorY = y;
      _renderPolygonPreview();
      _boundary.hasInk = true;
    }
  };

  const onMove = (clientX, clientY) => {
    const [x, y] = _coords(canvas, clientX, clientY);
    const ctx = _boundary.drawCtx;

    if (_boundary.tool === 'brush' && _boundary.drawing) {
      ctx.beginPath();
      ctx.moveTo(_boundary.lastX, _boundary.lastY);
      ctx.lineTo(x, y);
      ctx.stroke();
      _boundary.lastX = x; _boundary.lastY = y;
      _boundary.hasInk = true;
    } else if (_boundary.tool === 'line' && _boundary.drawing && _boundary.previewSnap) {
      ctx.putImageData(_boundary.previewSnap, 0, 0);
      ctx.beginPath();
      ctx.moveTo(_boundary.startX, _boundary.startY);
      ctx.lineTo(x, y);
      ctx.stroke();
    } else if (_boundary.tool === 'circle' && _boundary.drawing && _boundary.previewSnap) {
      ctx.putImageData(_boundary.previewSnap, 0, 0);
      const r = Math.hypot(x - _boundary.startX, y - _boundary.startY);
      ctx.beginPath();
      ctx.arc(_boundary.startX, _boundary.startY, r, 0, Math.PI * 2);
      ctx.stroke();
    } else if (_boundary.tool === 'polygon' && _boundary.polyVerts.length > 0) {
      _boundary.polyCursorX = x; _boundary.polyCursorY = y;
      _renderPolygonPreview();
    }
  };

  const onUp = () => {
    if (_boundary.tool === 'line' && _boundary.drawing) {
      _boundary.drawing = false;
      _boundary.previewSnap = null;
      _boundary.hasInk = true;
    } else if (_boundary.tool === 'circle' && _boundary.drawing) {
      _boundary.drawing = false;
      _boundary.previewSnap = null;
      _boundary.hasInk = true;
    } else if (_boundary.tool === 'brush') {
      _boundary.drawing = false;
    }
  };

  const onDblClick = () => {
    if (_boundary.tool === 'polygon' && _boundary.polyVerts.length >= 3) closePolygon();
  };

  canvas.onmousedown  = (e) => { e.preventDefault(); onDown(e.clientX, e.clientY); };
  canvas.onmousemove  = (e) => onMove(e.clientX, e.clientY);
  window.addEventListener('mouseup', onUp);
  canvas.ondblclick   = onDblClick;
  canvas.ontouchstart = (e) => { e.preventDefault(); const t = e.touches[0]; onDown(t.clientX, t.clientY); };
  canvas.ontouchmove  = (e) => { e.preventDefault(); const t = e.touches[0]; onMove(t.clientX, t.clientY); };
  canvas.ontouchend   = onUp;
}

function clearBoundary() {
  if (!_boundary.drawCtx) return;
  _pushUndo();
  _boundary.drawCtx.clearRect(0, 0, _boundary.width, _boundary.height);
  _boundary.hasInk = false;
  _boundary.polyVerts = [];
  _boundary.polyCommittedSnap = null;
}

function exitBoundaryEditor() {
  document.getElementById('boundary-editor').style.display = 'none';
  document.querySelector('.viewer-shell').style.display = '';
  document.getElementById('step2-actions').style.display = '';
  document.querySelector('.capture-instructions').style.display = '';
}

function skipBoundary() {
  // Original capture already in state.selectedCapture, hasBoundary=false
  exitBoundaryEditor();
  goToStep(3);
}

async function saveBoundary() {
  if (!_boundary.hasInk) {
    if (!confirm('You haven’t drawn anything. Continue without a boundary?')) return;
    return skipBoundary();
  }

  const btn = document.getElementById('boundary-save-btn');
  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Saving boundary…';

  try {
    // Composite: draw the boundary ink on top of the base image
    const composite = document.createElement('canvas');
    composite.width = _boundary.width;
    composite.height = _boundary.height;
    const cctx = composite.getContext('2d');
    cctx.drawImage(document.getElementById('boundary-base'), 0, 0);
    cctx.drawImage(document.getElementById('boundary-draw'), 0, 0);
    const dataUrl = composite.toDataURL('image/jpeg', 0.92);

    const site = state.selectedSite;
    const res = await fetch('/api/capture-canvas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        site_id: (site.id || site.name) + '-marked',
        dataUrl,
      }),
    });
    if (!res.ok) throw new Error('capture-canvas (marked) ' + res.status);
    const annotated = await res.json();

    // selectedCapture now points at the annotated image (Gemini sees the red line);
    // originalCapture stays as the un-annotated one (results page comparison).
    state.selectedCapture = annotated;
    state.hasBoundary = true;

    exitBoundaryEditor();
    goToStep(3);
    // Refresh the live prompt preview so the boundary chip appears right away
    updatePromptPreview(window.PromptBuilder.getState());
  } catch (err) {
    console.error('[saveBoundary]', err);
    alert('Could not save boundary: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

// ── Site overlays (toggles + fetch + render + localStorage prefs) ──────────

const OVERLAY_DEFS = {
  flood:     { label: 'Flood Risk',         icon: '⚠️',  defaultOn: true  },
  amenities: { label: 'Walkable amenities', icon: '🚶',  defaultOn: true  },
  listed:    { label: 'Listed buildings',   icon: '🏛️',  defaultOn: false },
  solar:     { label: 'Solar potential',    icon: '☀️',  defaultOn: false },
};

function loadOverlayPrefs() {
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem('siteScout.overlayPrefs') || '{}'); } catch (_) {}
  const prefs = {};
  for (const k of Object.keys(OVERLAY_DEFS)) {
    prefs[k] = (k in stored) ? !!stored[k] : OVERLAY_DEFS[k].defaultOn;
  }
  state.overlayPrefs = prefs;
}

function saveOverlayPrefs() {
  try { localStorage.setItem('siteScout.overlayPrefs', JSON.stringify(state.overlayPrefs)); } catch (_) {}
}

function initOverlayToggles() {
  const chips = document.querySelectorAll('#overlay-toggles .toggle-chip');
  chips.forEach(chip => {
    const name = chip.dataset.overlay;
    syncToggleChip(chip, !!state.overlayPrefs[name]);
    chip.addEventListener('click', () => {
      state.overlayPrefs[name] = !state.overlayPrefs[name];
      saveOverlayPrefs();
      syncToggleChip(chip, state.overlayPrefs[name]);
      // If a site is currently picked, fetch (or remove) just this overlay
      if (state.selectedSite) {
        if (state.overlayPrefs[name]) loadSingleOverlay(state.selectedSite, name);
        else removeOverlayPanel(name);
      }
    });
  });
}

function syncToggleChip(chip, on) {
  chip.setAttribute('aria-pressed', on ? 'true' : 'false');
  chip.classList.toggle('on', on);
  const stateLbl = chip.querySelector('.toggle-state');
  if (stateLbl) stateLbl.textContent = on ? 'ON' : 'off';
}

function loadEnabledOverlays(site) {
  const panels = document.getElementById('overlay-panels');
  if (panels) panels.innerHTML = '';
  for (const name of Object.keys(OVERLAY_DEFS)) {
    if (state.overlayPrefs[name]) loadSingleOverlay(site, name);
  }
}

async function loadSingleOverlay(site, name) {
  const panels = document.getElementById('overlay-panels');
  if (!panels) return;
  const slot = ensureOverlayPanel(name);
  slot.innerHTML = `<div class="overlay-row loading"><div class="spinner small"></div> Loading ${OVERLAY_DEFS[name].label.toLowerCase()}…</div>`;

  try {
    const res = await fetch(`/api/overlay/${name}?lat=${encodeURIComponent(site.lat)}&lng=${encodeURIComponent(site.lng)}`);
    const data = await res.json();
    if (!res.ok || data.notReady) {
      slot.innerHTML = `<div class="overlay-row info"><span class="overlay-icon">${OVERLAY_DEFS[name].icon}</span><span><strong>${OVERLAY_DEFS[name].label}:</strong> ${data.message || data.error || 'unavailable'}</span></div>`;
      return;
    }
    slot.innerHTML = renderOverlayBody(name, data);
  } catch (err) {
    slot.innerHTML = `<div class="overlay-row error"><span class="overlay-icon">${OVERLAY_DEFS[name].icon}</span><span><strong>${OVERLAY_DEFS[name].label}:</strong> ${err.message}</span></div>`;
  }
}

function ensureOverlayPanel(name) {
  const panels = document.getElementById('overlay-panels');
  let slot = panels.querySelector(`[data-overlay-panel="${name}"]`);
  if (!slot) {
    slot = document.createElement('div');
    slot.className = 'overlay-panel';
    slot.dataset.overlayPanel = name;
    panels.appendChild(slot);
  }
  return slot;
}

function removeOverlayPanel(name) {
  const panels = document.getElementById('overlay-panels');
  const slot = panels && panels.querySelector(`[data-overlay-panel="${name}"]`);
  if (slot) slot.remove();
}

function renderOverlayBody(name, data) {
  const def = OVERLAY_DEFS[name];
  if (name === 'flood') {
    const sev = data.severity === 'high' ? 'high' : (data.severity === 'low' ? 'low' : 'none');
    return `<div class="overlay-row sev-${sev}">
      <span class="overlay-icon">${def.icon}</span>
      <div>
        <div><strong>${def.label}:</strong> ${data.summary}</div>
        ${data.areas && data.areas.length ? `<div class="overlay-sub">${data.areas.map(a => a.label).join(' · ')}</div>` : ''}
      </div>
    </div>`;
  }
  if (name === 'amenities') {
    const c = data.counts || {};
    const chips = [
      `🏫 ${c.schools || 0} school${c.schools === 1 ? '' : 's'}`,
      `🚆 ${c.stations || 0} station${c.stations === 1 ? '' : 's'}`,
      `🏥 ${c.hospitals || 0} hospital${c.hospitals === 1 ? '' : 's'}`,
      `🛒 ${c.supermarkets || 0} supermarket${c.supermarkets === 1 ? '' : 's'}`,
      `🌳 ${c.parks || 0} park${c.parks === 1 ? '' : 's'}`,
    ];
    return `<div class="overlay-row">
      <span class="overlay-icon">${def.icon}</span>
      <div>
        <div><strong>${def.label}:</strong> within ${data.radiusMeters} m</div>
        <div class="overlay-sub">${chips.join('  ·  ')}</div>
      </div>
    </div>`;
  }
  return `<div class="overlay-row"><span class="overlay-icon">${def.icon}</span><div><strong>${def.label}:</strong> data received.</div></div>`;
}

// ── Step 3: Design ────────────────────────────────────────────────────────

function selectBuildingType(btn) {
  document.querySelectorAll('.building-tile').forEach(t => t.classList.remove('selected'));
  btn.classList.add('selected');
  window.PromptBuilder.setState({ building_type: btn.dataset.type });
  state.activePreset = null;
  renderPresetStrip(btn.dataset.type);
  updateGenerateButton();
}

function renderPresetStrip(buildingType) {
  const section = document.getElementById('preset-section');
  const strip = document.getElementById('preset-strip');
  const hint = document.getElementById('preset-hint');
  if (!section || !strip) return;

  const list = (state.presets && state.presets[buildingType]) || [];
  if (list.length === 0) { section.style.display = 'none'; return; }

  section.style.display = '';
  hint.textContent = `Pick a starting direction for your ${buildingType.toLowerCase()} — applies the pills + adds design intent to the prompt. You can still tweak everything below.`;
  strip.innerHTML = '';

  list.forEach(preset => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'preset-card';
    card.dataset.presetId = preset.id;
    card.innerHTML = `
      <span class="preset-icon">${preset.icon || '✨'}</span>
      <span class="preset-label">${preset.label}</span>
    `;
    card.addEventListener('click', () => applyPreset(preset, card));
    strip.appendChild(card);
  });
}

function applyPreset(preset, cardEl) {
  document.querySelectorAll('.preset-card').forEach(c => c.classList.remove('selected'));
  if (cardEl) cardEl.classList.add('selected');
  state.activePreset = preset;

  // Apply pill overrides
  if (preset.pillOverrides) {
    window.PromptBuilder.setState(preset.pillOverrides);

    // Reflect new pill choices in the UI (tap the matching pill button)
    Object.entries(preset.pillOverrides).forEach(([key, value]) => {
      const row = document.querySelector(`.pill-row[data-key="${key}"]`);
      if (!row) return;
      row.querySelectorAll('.pill').forEach(p => {
        p.classList.toggle('selected', p.dataset.value === value);
      });
    });
  }

  updateGenerateButton();
}

function onPillStateChange(pillState) {
  updatePromptPreview(pillState);
  updateGenerateButton();
}

function updatePromptPreview(pillState) {
  const ctx = {
    hasBoundary: !!state.hasBoundary,
    refCount: (state.referenceImages && state.referenceImages.length) || 0,
    presetLabel: state.activePreset ? state.activePreset.label : null,
  };
  const segs = window.PromptBuilder.buildPreviewSegments(pillState, ctx);
  const container = document.getElementById('prompt-preview-segments');

  if (segs.length === 0) {
    container.innerHTML = '<span class="preview-placeholder">Select a building type and options to see your prompt build here…</span>';
  } else {
    container.innerHTML = segs.map(s =>
      `<span class="prompt-segment seg-${s.kind || 'design'}">${escHtml(s.text)}</span>`
    ).join('');
  }

  // Raw prompt
  const rawEl = document.getElementById('raw-prompt-text');
  if (pillState.building_type) {
    // Build a preview prompt inline (matches server logic)
    rawEl.textContent = buildClientPromptPreview(pillState);
  } else {
    rawEl.textContent = '';
  }
}

// Mirror of services/prompt-builder.js → buildPrompt(). Keep in sync.
// The right-hand "View raw prompt" drawer reads from this; the actual
// generation request reads from the server. They must produce the same text.
function buildClientPromptPreview(pillState) {
  const BUILDING_DESCRIPTORS = {
    'Office':       'commercial office building',
    'Residential':  'residential apartment building',
    'Mixed Use':    'mixed-use development with retail at ground floor and residential above',
    'Retail':       'retail development',
    'School':       'educational building',
    'Hotel':        'hotel',
    'Industrial':   'light industrial and workspace building',
    'Healthcare':   'healthcare facility',
  };
  const LANDSCAPING_MAP = {
    'Very Green':  'Extensive landscaping — mature trees, planted street edges, green walls and roof gardens.',
    'Balanced':    'Balanced landscaping — tree-lined paths, planters along the street edge, mixed soft and hard surfaces.',
    'Minimal':     'Minimal planting — clean hardscape, occasional specimen trees, simple ground treatment.',
    'Very Paved':  'Predominantly paved hardscape — geometric plazas, granite setts, almost no vegetation.',
  };
  const TIME_MAP = {
    'Dawn':        'just after dawn, the sun low on the horizon casting long, soft pink-orange light',
    'Morning':     'in mid-morning daylight with long, crisp shadows from a low sun',
    'Midday':      'in midday sun with short, hard shadows directly beneath the building',
    'Golden Hour': 'during golden hour, the sun low and warm, casting long directional shadows',
    'Dusk':        'at dusk, deep blue twilight sky with warm interior lighting glowing through windows',
    'Night':       'at night, fully illuminated interiors and discreet exterior uplighting against a dark sky',
  };
  const WEATHER_MAP = {
    'Clear':           'under a clear blue sky',
    'Overcast':        'under soft, even overcast light',
    'Dramatic clouds': 'with dramatic broken cloud cover and a dynamic sky',
    'Rain-washed':     'just after rain, with reflective wet surfaces and damp pavements',
  };
  const SURROUNDINGS_MAP = {
    'Dense urban':  'in a dense urban context surrounded by tall buildings and active street life',
    'Mixed urban':  'in a mixed urban neighbourhood of mid-rise buildings and active streets',
    'Suburban':     'in a suburban context with lower-density housing and green space nearby',
    'Green belt':   'at the edge of a green belt with open countryside visible beyond',
  };
  const VIEW = 'Camera & framing: Use EXACTLY the same camera position, angle, framing, bearing, and aspect ratio as the source photograph. Do not change the viewpoint, zoom, or pitch. The output must be a photograph captured from this same vantage.';

  const p = pillState || {};
  const { building_type, stories, arch_style, facade, roof, landscaping, time_of_day, weather, surroundings, free_text, skip = {} } = p;
  if (!building_type) return '';

  const descriptor = BUILDING_DESCRIPTORS[building_type] || building_type.toLowerCase();
  const stories_s = stories ? `${stories}-storey ` : '';
  const style_s   = (!skip.arch_style && arch_style) ? `${arch_style.toLowerCase()} ` : '';
  const facade_s  = (!skip.facade && facade) ? ` Facade: ${facade.toLowerCase()}.` : '';
  const roof_s    = (!skip.roof && roof) ? ` Roof: ${roof.toLowerCase()}.` : '';
  const surr_s    = (!skip.surroundings && surroundings) ? ` Building sits ${SURROUNDINGS_MAP[surroundings] || surroundings.toLowerCase()}.` : '';
  const building  = `New, ${stories_s}${style_s}${descriptor}.${facade_s}${roof_s}${surr_s}`;

  const time = TIME_MAP[time_of_day] || (time_of_day ? `at ${time_of_day.toLowerCase()}` : 'in soft natural daylight');
  const wx   = (!skip.weather && weather) ? ` ${WEATHER_MAP[weather] || weather.toLowerCase()}` : '';
  const lighting = `Captured ${time}${wx}. Sun position, shadow length, direction and softness physically consistent with that time. Balanced ambient illumination with realistic bounce light. Realistic reflections in glazing and polished materials. Lighting is physically accurate, neutral, and non-dramatic.`;

  const landscape = (!skip.landscaping && landscaping) ? (LANDSCAPING_MAP[landscaping] || landscaping) : '';
  const free      = free_text && free_text.trim() ? `\n\nAdditional notes: ${free_text.trim()}` : '';

  const boundaryClause = state.hasBoundary
    ? 'A red outline has been drawn on the source image marking the build site. Place the new building strictly inside that red outline. Pixels outside the red outline must remain pixel-perfect identical to the source — do not add, remove, modify, or restyle anything beyond the outline.'
    : 'Place the new building only on the empty plot visible in the source image. Do not extend it onto neighbouring land.';

  const refCount = state.referenceImages ? state.referenceImages.length : 0;
  const refClause = refCount > 0
    ? `\n\nReference influences (apply ONLY to the new building, never to anything around it):\n  [${refCount} reference image${refCount === 1 ? '' : 's'} will be auto-described by Gemini text-vision at generation time and the descriptions inserted here]\n\nLift the materials, fenestration patterns, and detail treatments from the references and apply them to the new building's facade and roof. References must NOT change neighbouring buildings.`
    : '';

  const presetClause = state.activePreset && state.activePreset.promptAddendum
    ? `\n\n${state.activePreset.promptAddendum}`
    : '';

  return `Please reimagine this low quality photoshop collage of a ${descriptor} on the empty site shown as a real, high-resolution photograph of a newly completed, inhabited environment captured by a professional architectural photographer.

${VIEW}

Site & geometry: ${boundaryClause} Preserve all existing geometry — the site boundary, surrounding buildings, paths, entrances, kerbs, vegetation, and circulation — exactly as shown in the source image. Match the scale and proportion of neighbouring buildings.

PRESERVE EXACTLY (do NOT modify): Every neighbouring building must remain pixel-perfect identical to the source — same height, same parapet line, same facade material, same window grid, same roofline, same colour. Roads, kerbs, pavements, road markings, street furniture, parked vehicles, trees, hedges, planters, the horizon line and the sky must remain exactly as shown. The only change anywhere in the image is the new building inserted on the empty site.

Architecture & materials: ${building} Newly constructed and well maintained. Clean, uniform surfaces. High-resolution material definition. Sharp edges and precise junctions. Accurate light response for glass, metal, stone and concrete. Do not introduce wear, weathering, dirt, stains, damage, or surface imperfections.${presetClause}${landscape ? `\n\nLandscape (inside the build site only): ${landscape}` : ''}${refClause}

Lighting & exposure: ${lighting}

People: Introduce people naturally where the environment supports human presence — occupants, passers-by, staff, visitors. Candid and unposed; contributing scale and life without appearing staged. Close-range photographic realism: visible skin texture with pores and natural tonal variation, sharp facial detail without stylisation, individually resolved hair strands with realistic light interaction, accurate fabric textures with seams, folds and material weight, natural posture and movement. Subtle motion blur only on people moving naturally; stationary architecture and faces remain sharp.

Camera: High-end full-frame body. 35mm prime lens at f/4.5. Shutter speed appropriate to the available light and subtle human motion. Clean low ISO. Realistic depth of field with focus on the new building. Neutral white balance, accurate colour. Clean exposure with restrained contrast. No cinematic grading, no artistic filters, no stylised effects.

Treat the scene as a real place being photographed, not modified or enhanced. The result must be indistinguishable from a real, professionally captured photograph.${free}`;
}

function updateGenerateButton() {
  const pillState = window.PromptBuilder.getState();
  const hasBuilding = !!pillState.building_type;
  const btn = document.getElementById('generate-btn');
  const hint = document.getElementById('generate-hint');
  btn.disabled = !hasBuilding;
  hint.textContent = hasBuilding ? 'Ready — click to generate your photographs' : 'Select a building type to continue';
}

function handleFreeText(val) {
  window.PromptBuilder.setState({ free_text: val });
}

// ── Reference images ──────────────────────────────────────────────────────

function handleRefDragover(e) {
  e.preventDefault();
  document.getElementById('ref-upload-zone').classList.add('dragover');
}

function handleRefDrop(e) {
  e.preventDefault();
  document.getElementById('ref-upload-zone').classList.remove('dragover');
  processRefFiles(Array.from(e.dataTransfer.files));
}

function handleRefFiles(e) {
  processRefFiles(Array.from(e.target.files));
  e.target.value = '';
}

function processRefFiles(files) {
  const remaining = 5 - state.referenceImages.length;
  const toProcess = files.filter(f => f.type.startsWith('image/')).slice(0, remaining);

  toProcess.forEach(file => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target.result;
      // Resize client-side to max 1280x960 to keep payload small
      resizeImage(dataUrl, 1280, 960, (resizedDataUrl) => {
        const base64 = resizedDataUrl.split(',')[1];
        const mimeType = file.type || 'image/jpeg';
        state.referenceImages.push({ dataUrl: resizedDataUrl, data: base64, mimeType });
        renderRefThumbs();
        updatePromptPreview(window.PromptBuilder.getState());
      });
    };
    reader.readAsDataURL(file);
  });
}

function resizeImage(dataUrl, maxW, maxH, callback) {
  const img = new Image();
  img.onload = () => {
    const scale = Math.min(1, maxW / img.width, maxH / img.height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    callback(canvas.toDataURL('image/jpeg', 0.85));
  };
  img.src = dataUrl;
}

function renderRefThumbs() {
  const container = document.getElementById('ref-thumbs');
  container.innerHTML = '';
  state.referenceImages.forEach((img, i) => {
    const thumb = document.createElement('div');
    thumb.className = 'ref-thumb';
    thumb.innerHTML = `
      <img src="${img.dataUrl}" alt="Reference ${i + 1}">
      <button class="ref-thumb-remove" onclick="removeRefImage(${i})" title="Remove">&#215;</button>
    `;
    container.appendChild(thumb);
  });
}

function removeRefImage(index) {
  state.referenceImages.splice(index, 1);
  renderRefThumbs();
  updatePromptPreview(window.PromptBuilder.getState());
}

// ── Step 4 & 5: Generate & Results ───────────────────────────────────────

async function handleGenerate() {
  const pillState = window.PromptBuilder.getState();
  if (!pillState.building_type) return;
  if (!state.selectedCapture) {
    alert('Please go back and select a site view first.');
    return;
  }

  goToStep(4);
  document.getElementById('progress-bar').style.width = '0%';
  document.getElementById('gen-status-msg').textContent = 'Queuing generation...';

  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        site_id: state.selectedSite ? (state.selectedSite.id || state.selectedSite.name) : 'unknown',
        capture_id: state.selectedCapture.id,
        city: state.currentCity,
        pill_state: pillState,
        reference_images: state.referenceImages.map(r => ({ data: r.data, mimeType: r.mimeType })),
        has_boundary: !!state.hasBoundary,
        preset_addendum: state.activePreset ? state.activePreset.promptAddendum : '',
      }),
    });

    if (res.status === 402) {
      const data = await res.json();
      goToStep(3);
      alert(data.error || 'No credits remaining. Sign in for more free generations.');
      return;
    }

    const data = await res.json();
    if (!data.job_id) throw new Error('No job ID returned');

    state.jobId = data.job_id;
    pollGenerationProgress();
  } catch (err) {
    goToStep(3);
    alert('Generation failed: ' + err.message);
  }
}

function pollGenerationProgress() {
  const maxWait = 180000; // 3 min
  const start = Date.now();

  const poll = async () => {
    if (Date.now() - start > maxWait) {
      goToStep(3);
      alert('Generation timed out. Please try again.');
      return;
    }

    try {
      const res = await fetch(`/api/status/${state.jobId}`);
      const job = await res.json();

      document.getElementById('progress-bar').style.width = `${job.progress || 0}%`;
      if (job.message) document.getElementById('gen-status-msg').textContent = job.message;

      if (job.status === 'completed') {
        state.generationCount++;
        displayResults(job.images);
        // Refresh credit count
        fetch('/api/me').then(r => r.json()).then(d => updateCreditDisplay(d.credits, d.authenticated)).catch(() => {});
        return;
      }

      if (job.status === 'error') {
        goToStep(3);
        alert('Generation error: ' + (job.message || 'Unknown error'));
        return;
      }

      setTimeout(poll, 1500);
    } catch {
      setTimeout(poll, 2000);
    }
  };

  setTimeout(poll, 1000);
}

function displayResults(images) {
  if (!images || images.length === 0) {
    goToStep(3);
    alert('No images were generated. Please try again.');
    return;
  }

  const pillState = window.PromptBuilder.getState();
  document.getElementById('results-site-label').textContent =
    `${pillState.building_type || ''}${state.currentCity ? ' — ' + state.currentCity : ''}`;

  const VIEW_LABELS = {
    aerial:             'Aerial View',
    perspective_3d:     '3D Perspective',
    perspective_dusk:   '3D — Dusk',
    perspective_night:  '3D — Night',
    street_front:       'Street — Front',
    street_corner:      'Street — Corner',
    street_entrance:    'Street — Entrance',
  };

  // Side-by-side original ↔ primary generated
  const pair = document.getElementById('results-pair');
  const heroLabel = VIEW_LABELS[images[0].type] || 'Primary View';
  if (state.originalCapture && state.originalCapture.proxyUrl) {
    document.getElementById('results-original-img').src = state.originalCapture.proxyUrl;
    document.getElementById('results-primary-img').src  = images[0].url;
    document.getElementById('results-primary-label').textContent = heroLabel;
    pair.style.display = 'grid';
    document.getElementById('results-hero').style.display = 'none';
  } else {
    pair.style.display = 'none';
    const hero = document.getElementById('results-hero');
    hero.style.display = '';
    hero.innerHTML = `
      <img src="${images[0].url}" alt="${heroLabel}">
      <p class="results-hero-caption">${heroLabel}</p>
    `;
  }

  // Hide any previous follow-up panel
  const fu = document.getElementById('followup-section');
  if (fu) { fu.style.display = 'none'; document.getElementById('followup-grid').innerHTML = ''; }
  state.chosenResultUrl = null;
  state.followupJobId = null;

  // Grid: ALL images (including the primary) get a "More from this" button.
  // Some users will want follow-ups from a different angle than the primary.
  const grid = document.getElementById('results-grid');
  grid.innerHTML = '';
  images.forEach(img => {
    const label = VIEW_LABELS[img.type] || (img.type || '').replace(/_/g, ' ');
    const item = document.createElement('div');
    item.className = 'result-item';
    item.innerHTML = `
      <img src="${img.url}" alt="${label}">
      <div class="result-item-footer">
        <span class="result-label">${label}</span>
        <div class="result-item-actions">
          <button class="result-more" type="button" title="Generate ground-level photographs of this same building">📷 More photographs</button>
          <a class="result-download" href="${img.url}" download="site-scout-${img.type}.jpg">Download</a>
        </div>
      </div>
    `;
    item.querySelector('.result-more').addEventListener('click', () => triggerFollowup(img.url, label));
    grid.appendChild(item);
  });

  goToStep(5);
}

// ── "More photographs" follow-up flow ───────────────────────────────────────

async function triggerFollowup(imageUrl, sourceLabel) {
  const pillState = window.PromptBuilder.getState();
  if (!pillState.building_type) return alert('Missing building type — go back to Step 3.');
  if (state.followupJobId) return alert('A follow-up generation is already in progress.');

  if (!confirm('This will generate 10 photographs (4 aerial + 6 ground-level) of this building — uses 10 image-generation credits. Continue?')) return;

  state.chosenResultUrl = imageUrl;
  const section = document.getElementById('followup-section');
  const status  = document.getElementById('followup-status');
  const grid    = document.getElementById('followup-grid');
  const prog    = document.getElementById('followup-progress');
  const bar     = document.getElementById('followup-progress-bar');
  section.style.display = 'block';
  status.textContent = `Reading the building & generating 10 photographs from "${sourceLabel}"… this takes ~60–90s.`;
  grid.innerHTML = '';
  prog.style.display = '';
  bar.style.width = '0%';
  section.scrollIntoView({ behavior: 'smooth', block: 'start' });

  try {
    const res = await fetch('/api/generate-followup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        image_url: imageUrl,
        pill_state: pillState,
        preset_addendum: state.activePreset ? state.activePreset.promptAddendum : '',
        city: state.currentCity,
      }),
    });
    if (res.status === 402) {
      const data = await res.json();
      status.textContent = data.error || 'No credits remaining for follow-up.';
      prog.style.display = 'none';
      return;
    }
    const data = await res.json();
    if (!data.job_id) throw new Error('No follow-up job ID returned');
    state.followupJobId = data.job_id;
    pollFollowupProgress();
  } catch (err) {
    console.error('[followup]', err);
    status.textContent = 'Follow-up failed: ' + err.message;
    prog.style.display = 'none';
    state.followupJobId = null;
  }
}

function pollFollowupProgress() {
  const start = Date.now();
  const status = document.getElementById('followup-status');
  const grid   = document.getElementById('followup-grid');
  const bar    = document.getElementById('followup-progress-bar');

  const tick = async () => {
    if (Date.now() - start > 240000) {
      status.textContent = 'Follow-up timed out. Try again.';
      state.followupJobId = null;
      return;
    }
    try {
      const res = await fetch(`/api/followup-status/${state.followupJobId}`);
      const job = await res.json();
      bar.style.width = `${job.progress || 0}%`;
      if (job.message) status.textContent = job.message;

      if (job.status === 'completed') {
        renderFollowupResults(job.images);
        state.followupJobId = null;
        document.getElementById('followup-progress').style.display = 'none';
        return;
      }
      if (job.status === 'error') {
        status.textContent = 'Follow-up failed: ' + (job.message || 'unknown');
        state.followupJobId = null;
        return;
      }
      setTimeout(tick, 1500);
    } catch (e) {
      setTimeout(tick, 2500);
    }
  };
  setTimeout(tick, 1000);
}

function renderFollowupResults(images) {
  const grid = document.getElementById('followup-grid');
  const status = document.getElementById('followup-status');
  const sky = images.filter(i => i.group === 'sky');
  const ground = images.filter(i => i.group === 'ground' || !i.group);
  status.textContent = `${images.length} photographs of the same building — ${sky.length} aerial, ${ground.length} ground-level.`;
  grid.innerHTML = '';

  const renderGroup = (heading, list) => {
    if (list.length === 0) return;
    const head = document.createElement('h4');
    head.className = 'followup-group-heading';
    head.textContent = heading;
    grid.appendChild(head);
    list.forEach(img => {
      const label = img.label || img.type;
      const item = document.createElement('div');
      item.className = 'result-item';
      item.innerHTML = `
        <img src="${img.url}" alt="${label}">
        <div class="result-item-footer">
          <span class="result-label">${label}</span>
          <div class="result-item-actions">
            <a class="result-download" href="${img.url}" download="site-scout-${img.type}.jpg">Download</a>
          </div>
        </div>
      `;
      grid.appendChild(item);
    });
  };
  renderGroup('Aerial views', sky);
  renderGroup('Ground-level views', ground);
}

function downloadAll() {
  const allImgs = document.querySelectorAll('#results-hero img, #results-grid img');
  allImgs.forEach((img, i) => {
    const a = document.createElement('a');
    a.href = img.src;
    a.download = `site-scout-${i + 1}.jpg`;
    a.click();
  });
}

function resetApp() {
  state.selectedSite = null;
  state.selectedCapture = null;
  state.currentCity = null;
  state.jobId = null;
  state.referenceImages = [];
  document.getElementById('city-input').value = '';
  document.getElementById('site-results').innerHTML = '';
  document.getElementById('ref-thumbs').innerHTML = '';
  document.getElementById('free-text-input').value = '';
  document.getElementById('overview-map-wrap').style.display = 'none';
  document.querySelectorAll('.building-tile').forEach(t => t.classList.remove('selected'));
  window.PromptBuilder.setState({ building_type: null });
  goToStep(1);
}

// ── Utilities ─────────────────────────────────────────────────────────────

function escHtml(str) {
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
