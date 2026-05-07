'use strict';

// ── State ─────────────────────────────────────────────────────────────────

const state = {
  currentStep: 1,
  selectedSite: null,
  selectedCapture: null,   // { id, proxyUrl, type, direction, label }
  currentCity: null,
  jobId: null,
  user: null,
  referenceImages: [],     // [{ dataUrl, data (base64), mimeType }]
  generationCount: 0,
  overviewMap: null,
  overlayPrefs: {},        // { flood: true, amenities: true, listed: false, solar: false }
  overlayCache: {},        // siteKey → { overlayName: data }
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

  // Load overlay prefs from localStorage; default on for free overlays
  loadOverlayPrefs();
  initOverlayToggles();

  // Wire viewer overlay buttons
  const resetBtn = document.getElementById('viewer-reset-btn');
  const topBtn   = document.getElementById('viewer-top-btn');
  const useBtn   = document.getElementById('configure-btn');
  if (resetBtn) resetBtn.addEventListener('click', () => resetSiteViewer());
  if (topBtn)   topBtn.addEventListener('click', () => topDownSiteViewer());
  if (useBtn)   useBtn.addEventListener('click', () => useThisView());

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

// ── Step 1: Search ────────────────────────────────────────────────────────

function quickSearch(city) {
  document.getElementById('city-input').value = city;
  searchCity(city);
}

function handleSearch(e) {
  e.preventDefault();
  const city = document.getElementById('city-input').value.trim();
  if (city) searchCity(city);
}

async function searchCity(city) {
  state.currentCity = city;
  document.getElementById('search-loading').style.display = 'flex';
  document.getElementById('site-results').innerHTML = '';
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
      document.getElementById('site-results').innerHTML = '<p class="empty-msg">No sites found for this city. Try another.</p>';
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
  loadEnabledOverlays(site);
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

    // Lock the camera to orbit a fixed target (the site lat/lng)
    const center = Cesium.Cartesian3.fromDegrees(lng, lat, 0);
    state.siteViewerCenter = center;

    viewer.camera.lookAt(center, new Cesium.HeadingPitchRange(
      Cesium.Math.toRadians(VIEWER_DEFAULTS.headingDeg),
      Cesium.Math.toRadians(VIEWER_DEFAULTS.pitchDeg),
      VIEWER_DEFAULTS.rangeMeters
    ));

    // Camera control: orbit + zoom + tilt; NO pan/translate, NO free-look
    const ctl = viewer.scene.screenSpaceCameraController;
    ctl.enableTranslate = false;
    ctl.enableLook      = false;
    ctl.enableRotate    = true;
    ctl.enableTilt      = true;
    ctl.enableZoom      = true;
    // Only allow zoom toward the lookAt target, not toward arbitrary cursor points
    ctl.zoomEventTypes  = [Cesium.CameraEventType.WHEEL, Cesium.CameraEventType.PINCH];

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
  if (!viewer || !state.siteViewerCenter) return;
  viewer.camera.lookAt(state.siteViewerCenter, new Cesium.HeadingPitchRange(
    Cesium.Math.toRadians(VIEWER_DEFAULTS.headingDeg),
    Cesium.Math.toRadians(VIEWER_DEFAULTS.pitchDeg),
    VIEWER_DEFAULTS.rangeMeters
  ));
}

function topDownSiteViewer() {
  const viewer = state.siteViewer;
  if (!viewer || !state.siteViewerCenter) return;
  viewer.camera.lookAt(state.siteViewerCenter, new Cesium.HeadingPitchRange(
    0, Cesium.Math.toRadians(-89.9), VIEWER_DEFAULTS.rangeMeters
  ));
}

async function useThisView() {
  const viewer = state.siteViewer;
  const site = state.selectedSite;
  if (!viewer || !site) return;

  const btn = document.getElementById('configure-btn');
  const original = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Capturing view…';

  try {
    // Force one render so the canvas is current, then read pixels
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
    state.selectedCapture = capture;
    goToStep(3);
  } catch (err) {
    console.error('[useThisView]', err);
    alert('Could not capture this view: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = original;
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
  updateGenerateButton();
}

function onPillStateChange(pillState) {
  updatePromptPreview(pillState);
  updateGenerateButton();
}

function updatePromptPreview(pillState) {
  const segs = window.PromptBuilder.buildPreviewSegments(pillState);
  const container = document.getElementById('prompt-preview-segments');

  if (segs.length === 0) {
    container.innerHTML = '<span class="preview-placeholder">Select a building type and options to see your prompt build here...</span>';
  } else {
    container.innerHTML = segs.map(s =>
      `<span class="prompt-segment" style="background:${s.color}">${escHtml(s.text)}</span>`
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

  return `Please reimagine this low quality photoshop collage of a ${descriptor} on the empty site shown as a real, high-resolution photograph of a newly completed, inhabited environment captured by a professional architectural photographer.

${VIEW}

Site & geometry: Preserve all existing geometry — the site boundary, surrounding buildings, paths, entrances, kerbs, vegetation, and circulation — exactly as shown in the source image. Place the new building only on the empty plot. Match the scale and proportion of neighbouring buildings.

Architecture & materials: ${building} Newly constructed and well maintained. Clean, uniform surfaces. High-resolution material definition. Sharp edges and precise junctions. Accurate light response for glass, metal, stone and concrete. Do not introduce wear, weathering, dirt, stains, damage, or surface imperfections.${landscape ? `\n\nLandscape: ${landscape}` : ''}

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
  hint.textContent = hasBuilding ? 'Ready — click to generate your CGI visualisations' : 'Select a building type to continue';
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

  // Hero (first image)
  const hero = document.getElementById('results-hero');
  const heroLabel = VIEW_LABELS[images[0].type] || 'Primary View';
  hero.innerHTML = `
    <img src="${images[0].url}" alt="${heroLabel}">
    <p class="results-hero-caption">${heroLabel}</p>
  `;

  // Grid (remaining images)
  const grid = document.getElementById('results-grid');
  grid.innerHTML = '';
  images.slice(1).forEach(img => {
    const label = VIEW_LABELS[img.type] || (img.type || '').replace(/_/g, ' ');
    const item = document.createElement('div');
    item.className = 'result-item';
    item.innerHTML = `
      <img src="${img.url}" alt="${label}">
      <div class="result-item-footer">
        <span class="result-label">${label}</span>
        <a class="result-download" href="${img.url}" download="site-scout-${img.type}.jpg">Download</a>
      </div>
    `;
    grid.appendChild(item);
  });

  goToStep(5);
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
