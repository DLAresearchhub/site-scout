/* global window */
(function () {
  'use strict';

  const PILL_CONFIG = [
    { key: 'stories',     label: 'Stories',             options: ['1–2', '3–5', '6–10', '11–20', '20+'],                                          skippable: false },
    { key: 'arch_style',  label: 'Architectural Style',  options: ['Contemporary', 'Industrial', 'Victorian', 'Art Deco', 'Modernist', 'Brutalist', 'Scandinavian', 'Biophilic'], skippable: true, hasCustom: true },
    { key: 'facade',      label: 'Facade Material',      options: ['Brick', 'Glass & Steel', 'Timber', 'Concrete', 'Stone', 'Zinc', 'Copper', 'Terracotta'],                     skippable: true, hasCustom: true },
    { key: 'roof',        label: 'Roof Type',            options: ['Flat', 'Green roof', 'Solar panels', 'Pitched', 'Terrace'],                    skippable: true },
    { key: 'landscaping', label: 'Landscaping',          options: ['Very Green', 'Balanced', 'Minimal', 'Very Paved'],                             skippable: true },
    { key: 'time_of_day', label: 'Time of Day',          options: ['Dawn', 'Morning', 'Midday', 'Golden Hour', 'Dusk', 'Night'],                   skippable: false },
    { key: 'weather',     label: 'Weather',              options: ['Clear', 'Overcast', 'Dramatic clouds', 'Rain-washed'],                         skippable: true },
    { key: 'surroundings',label: 'Surroundings',         options: ['Dense urban', 'Mixed urban', 'Suburban', 'Green belt'],                        skippable: true },
  ];

  const SEGMENT_COLORS = {
    building_type: '#16a34a',
    stories:       '#16a34a',
    arch_style:    '#7c3aed',
    facade:        '#ea580c',
    roof:          '#0284c7',
    landscaping:   '#0d9488',
    time_of_day:   '#d97706',
    weather:       '#475569',
    surroundings:  '#be185d',
    free_text:     '#6b7280',
  };

  // Default state
  let _state = {
    building_type: null,
    stories: '3–5',
    arch_style: 'Contemporary',
    facade: 'Brick',
    roof: 'Flat',
    landscaping: 'Balanced',
    time_of_day: 'Golden Hour',
    weather: 'Clear',
    surroundings: 'Mixed urban',
    free_text: '',
    skip: {},
  };

  let _onStateChange = null;

  function getState() { return Object.assign({}, _state, { skip: Object.assign({}, _state.skip) }); }

  function setState(partial) {
    _state = Object.assign({}, _state, partial);
    if (partial.skip !== undefined) _state.skip = Object.assign({}, _state.skip, partial.skip);
    if (_onStateChange) _onStateChange(getState());
  }

  function initPillUI(container, onStateChange) {
    _onStateChange = onStateChange;
    container.innerHTML = '';

    PILL_CONFIG.forEach(cfg => {
      const row = document.createElement('div');
      row.className = 'pill-row';
      row.dataset.key = cfg.key;

      const label = document.createElement('span');
      label.className = 'pill-row-label';
      label.textContent = cfg.label;
      row.appendChild(label);

      const pillGroup = document.createElement('div');
      pillGroup.className = 'pill-group';

      cfg.options.forEach(opt => {
        const pill = document.createElement('button');
        pill.className = 'pill';
        pill.textContent = opt;
        pill.type = 'button';
        pill.dataset.value = opt;
        if (_state[cfg.key] === opt) pill.classList.add('selected');

        pill.addEventListener('click', () => {
          // Deselect all in this row
          pillGroup.querySelectorAll('.pill').forEach(p => p.classList.remove('selected'));
          pill.classList.add('selected');
          setState({ [cfg.key]: opt });
          // Clear custom if it exists
          const customInput = row.querySelector('.custom-pill-input');
          if (customInput) customInput.value = '';
        });

        pillGroup.appendChild(pill);
      });

      // Custom pill
      if (cfg.hasCustom) {
        const customBtn = document.createElement('button');
        customBtn.className = 'pill custom-pill';
        customBtn.type = 'button';
        customBtn.textContent = 'Custom…';

        const customInput = document.createElement('input');
        customInput.className = 'custom-pill-input';
        customInput.type = 'text';
        customInput.placeholder = 'Type custom value…';
        customInput.style.display = 'none';

        customBtn.addEventListener('click', () => {
          customInput.style.display = 'inline-block';
          customBtn.style.display = 'none';
          pillGroup.querySelectorAll('.pill:not(.custom-pill)').forEach(p => p.classList.remove('selected'));
          customInput.focus();
        });

        customInput.addEventListener('input', () => {
          setState({ [cfg.key]: customInput.value || null });
        });

        customInput.addEventListener('blur', () => {
          if (!customInput.value) {
            customInput.style.display = 'none';
            customBtn.style.display = 'inline-block';
          }
        });

        pillGroup.appendChild(customBtn);
        pillGroup.appendChild(customInput);
      }

      row.appendChild(pillGroup);

      // Skip toggle
      if (cfg.skippable) {
        const skipLabel = document.createElement('label');
        skipLabel.className = 'skip-toggle';
        const skipCb = document.createElement('input');
        skipCb.type = 'checkbox';
        skipCb.checked = !!_state.skip[cfg.key];
        skipCb.addEventListener('change', () => {
          const skips = Object.assign({}, _state.skip, { [cfg.key]: skipCb.checked });
          setState({ skip: skips });
          row.classList.toggle('skipped', skipCb.checked);
          pillGroup.style.opacity = skipCb.checked ? '0.35' : '1';
        });
        skipLabel.appendChild(skipCb);
        skipLabel.appendChild(document.createTextNode(' Skip'));
        row.appendChild(skipLabel);
      }

      container.appendChild(row);
    });
  }

  // Each segment now carries a "kind" so the renderer can apply CSS classes
  // for a unified, restrained palette (orange accent + grays + red for the
  // boundary marker). Optional second arg passes app-level state (boundary,
  // refs, presets) so they can show as dedicated chips.
  function buildPreviewSegments(pillState, ctx) {
    const { building_type, stories, arch_style, facade, roof, landscaping, time_of_day, weather, surroundings, free_text, skip = {} } = pillState;
    ctx = ctx || {};
    const segs = [];

    // 1. Boundary marker (highest priority — alters how Gemini reads the source)
    if (ctx.hasBoundary) segs.push({ text: '\u{1F7E5} Boundary drawn', kind: 'boundary' });

    // 2. References uploaded
    if (ctx.refCount > 0) segs.push({ text: `\u{1F4F7} ${ctx.refCount} reference${ctx.refCount === 1 ? '' : 's'}`, kind: 'refs' });

    // 3. Active preset (if any) — design intent name
    if (ctx.presetLabel) segs.push({ text: `\u{2728} ${ctx.presetLabel}`, kind: 'preset' });

    // 4. Lead chip — building type
    if (building_type) segs.push({ text: building_type, kind: 'lead' });

    // 5. Massing — stories
    if (stories) segs.push({ text: `${stories} storeys`, kind: 'mass' });

    // 6. Design selections — material, form
    if (!skip.arch_style && arch_style) segs.push({ text: arch_style, kind: 'design' });
    if (!skip.facade && facade)         segs.push({ text: facade,     kind: 'design' });
    if (!skip.roof && roof)             segs.push({ text: roof,       kind: 'design' });
    if (!skip.landscaping && landscaping) segs.push({ text: landscaping, kind: 'design' });

    // 7. Atmosphere — time, weather, surroundings
    if (time_of_day)                        segs.push({ text: time_of_day,  kind: 'atmos' });
    if (!skip.weather && weather)           segs.push({ text: weather,      kind: 'atmos' });
    if (!skip.surroundings && surroundings) segs.push({ text: surroundings, kind: 'atmos' });

    // 8. Free-text note — separate styling
    if (free_text && free_text.trim()) segs.push({ text: free_text.trim(), kind: 'note' });

    return segs;
  }

  window.PromptBuilder = { initPillUI, buildPreviewSegments, getState, setState, PILL_CONFIG, SEGMENT_COLORS };
})();
