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
};

// ── Init ──────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  // Init pill UI
  const pillContainer = document.getElementById('pill-rows-container');
  window.PromptBuilder.initPillUI(pillContainer, onPillStateChange);

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

// ── Step 2: Captures ──────────────────────────────────────────────────────

async function selectSite(site) {
  state.selectedSite = site;
  state.selectedCapture = null;

  document.getElementById('step2-site-name').textContent = `${site.name}${site.address ? ' — ' + site.address : ''}`;
  document.getElementById('capture-loading').style.display = 'flex';
  document.getElementById('capture-grid').style.display = 'none';
  document.getElementById('capture-none').style.display = 'none';
  document.getElementById('step2-actions').style.display = 'none';
  document.getElementById('capture-instructions').style.display = 'none';
  goToStep(2);

  try {
    const res = await fetch('/api/capture-site', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ site_id: site.id || site.name, lat: site.lat, lng: site.lng }),
    });
    const data = await res.json();
    document.getElementById('capture-loading').style.display = 'none';

    if (!data.captures || data.captures.length === 0) {
      document.getElementById('capture-none').style.display = 'block';
    } else {
      renderCaptureGrid(data.captures);
    }
  } catch {
    document.getElementById('capture-loading').style.display = 'none';
    document.getElementById('capture-none').style.display = 'block';
  }
}

function renderCaptureGrid(captures) {
  const grid = document.getElementById('capture-grid');
  grid.innerHTML = '';

  captures.forEach(capture => {
    const card = document.createElement('div');
    card.className = 'capture-card';
    card.dataset.captureId = capture.id;

    const typeClass = { satellite: 'satellite', mapbox3d: 'mapbox3d', birdseye: 'birdseye', streetview: 'streetview' }[capture.type] || 'satellite';
    const typeText  = { satellite: 'Satellite', mapbox3d: '3D View', birdseye: "Bird's Eye", streetview: 'Street' }[capture.type] || capture.type;

    const errorSvg = `data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='200' height='140'%3E%3Crect fill='%23f1f1f1' width='200' height='140'/%3E%3Ctext x='100' y='75' text-anchor='middle' fill='%236b7280' font-size='12'%3ENo image%3C/text%3E%3C/svg%3E`;

    card.innerHTML = `
      <img src="${capture.proxyUrl}" alt="${capture.label}" loading="lazy" onerror="this.src='${errorSvg}'">
      <div class="capture-card-label">
        <span>${capture.label || typeText}</span>
        <span class="capture-type-badge ${typeClass}">${typeText}</span>
      </div>
    `;

    card.addEventListener('click', () => selectCapture(capture, card));
    grid.appendChild(card);
  });

  grid.style.display = 'grid';
  document.getElementById('step2-actions').style.display = 'flex';

  // Auto-select if only one capture, or auto-select the first 3D view if available
  const best = captures.find(c => c.type === 'mapbox3d') || captures[0];
  if (best) {
    const bestCard = grid.querySelector(`[data-capture-id="${best.id}"]`);
    if (bestCard) selectCapture(best, bestCard);
    // Only show "select a view" hint if there's more than one
    document.getElementById('capture-instructions').style.display = captures.length > 1 ? 'block' : 'none';
  }
}

function selectCapture(capture, cardEl) {
  document.querySelectorAll('.capture-card').forEach(c => c.classList.remove('selected'));
  cardEl.classList.add('selected');
  state.selectedCapture = capture;
  document.getElementById('selected-capture-label').textContent = capture.label || capture.type;
  document.getElementById('configure-btn').disabled = false;
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

function buildClientPromptPreview(pillState) {
  const BUILDING_DESCRIPTORS = {
    'Office': 'commercial office building', 'Residential': 'residential apartment building',
    'Mixed Use': 'mixed-use development with retail at ground floor', 'Retail': 'retail development',
    'School': 'educational building', 'Hotel': 'hotel', 'Industrial': 'light industrial building',
    'Healthcare': 'healthcare facility',
  };
  const { building_type, stories, arch_style, facade, roof, landscaping, time_of_day, weather, surroundings, free_text, skip = {} } = pillState;
  const desc = BUILDING_DESCRIPTORS[building_type] || building_type;
  const parts = [
    `Photorealistic aerial drone CGI.`,
    `\nNew ${desc}`,
    stories ? `, ${stories} storeys` : '',
    !skip.arch_style && arch_style ? `, ${arch_style} style` : '',
    !skip.facade && facade ? `. Facade: ${facade}` : '',
    !skip.roof && roof ? `. Roof: ${roof}` : '',
    !skip.landscaping && landscaping ? `. Landscaping: ${landscaping}` : '',
    '\n',
    time_of_day ? `Lighting: ${time_of_day}` : '',
    !skip.weather && weather ? `, ${weather}` : '',
    !skip.surroundings && surroundings ? `.\n${surroundings}` : '',
    free_text ? `\n\n${free_text}` : '',
  ];
  return parts.join('').replace(/\n{3,}/g, '\n\n').trim();
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

  // Hero (first image)
  const hero = document.getElementById('results-hero');
  hero.innerHTML = `
    <img src="${images[0].url}" alt="Aerial CGI">
    <p class="results-hero-caption">Aerial / Primary View</p>
  `;

  // Grid (remaining images)
  const grid = document.getElementById('results-grid');
  grid.innerHTML = '';
  images.slice(1).forEach(img => {
    const label = (img.type || '').replace(/_/g, ' ');
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
