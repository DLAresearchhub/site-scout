// services/prompt-builder.js
//
// Builds the prompt sent to Gemini's image-generation model. The output is a
// single comprehensive photographic brief that:
//   1. Treats the captured image (Cesium 3D / Mapbox 3D / satellite) as the
//      EXACT camera viewpoint to be preserved.
//   2. Describes the proposed building from the user's pill selections.
//   3. Bakes in the photographic-realism rules — geometry preservation,
//      candid people, real materials, accurate light, real camera settings —
//      so Gemini renders a believable photograph instead of a generic illustration.
//
// IMPORTANT: keep this in sync with public/js/app.js → buildClientPromptPreview.
// The right-hand "View raw prompt" drawer reads from the client mirror; the
// actual generation request reads from this file. They must produce the same
// text or the user is shown a lie.

const SEGMENT_COLORS = {
  building:     '#16a34a',
  stories:      '#16a34a',
  arch_style:   '#7c3aed',
  facade:       '#ea580c',
  roof:         '#0284c7',
  landscaping:  '#0d9488',
  time_of_day:  '#d97706',
  weather:      '#475569',
  surroundings: '#be185d',
  free_text:    '#6b7280',
};

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

// Per-view framing instruction. The "perspective_*" variants explicitly tell
// the model NOT to change the camera — used for our Cesium / 3D captures.
const VIEW_INSTRUCTIONS = {
  aerial: 'Camera & framing: Aerial drone perspective looking down at approximately 45° to the ground, showing the full building footprint, roof, and immediate surrounding context. Preserve the framing and aspect ratio of the source image.',
  perspective_3d: 'Camera & framing: Use EXACTLY the same camera position, angle, framing, bearing, and aspect ratio as the source photograph. Do not change the viewpoint, zoom, or pitch. The output must be a photograph captured from this same vantage.',
  perspective_dusk: 'Camera & framing: Use EXACTLY the same camera position, angle, framing, bearing, and aspect ratio as the source photograph. The scene is captured at dusk — deep blue twilight sky with warm interior lighting glowing through windows. Do not change the viewpoint, zoom, or pitch.',
  perspective_night: 'Camera & framing: Use EXACTLY the same camera position, angle, framing, bearing, and aspect ratio as the source photograph. The scene is captured at night — fully illuminated interiors, discreet exterior uplighting, ambient street lighting. Do not change the viewpoint, zoom, or pitch.',
  street_front: 'Camera & framing: Eye-level perspective from across the street showing the full front elevation. 35mm lens framing, slight upward tilt to capture the parapet.',
  street_corner: 'Camera & framing: Eye-level corner perspective showing two facades at an oblique angle. Human-scale viewpoint.',
  street_entrance: 'Camera & framing: Eye-level perspective focused on the main entrance and ground floor — close enough to read materiality and detail.',
};

function buildBuildingClause(p) {
  const { building_type, stories, arch_style, facade, roof, surroundings, skip = {} } = p;
  const desc = BUILDING_DESCRIPTORS[building_type] || (building_type ? building_type.toLowerCase() : 'building');
  const stories_s = stories ? `${stories}-storey ` : '';
  const style_s   = (!skip.arch_style && arch_style) ? `${arch_style.toLowerCase()} ` : '';
  const facade_s  = (!skip.facade && facade) ? ` Facade: ${facade.toLowerCase()}.` : '';
  const roof_s    = (!skip.roof && roof) ? ` Roof: ${roof.toLowerCase()}.` : '';
  const surr_s    = (!skip.surroundings && surroundings) ? ` Building sits ${SURROUNDINGS_MAP[surroundings] || surroundings.toLowerCase()}.` : '';
  return `New, ${stories_s}${style_s}${desc}.${facade_s}${roof_s}${surr_s}`;
}

function buildLightingClause(p) {
  const { time_of_day, weather, skip = {} } = p;
  const time = TIME_MAP[time_of_day] || (time_of_day ? `at ${time_of_day.toLowerCase()}` : 'in soft natural daylight');
  const wx   = (!skip.weather && weather) ? ` ${WEATHER_MAP[weather] || weather.toLowerCase()}` : '';
  return `Captured ${time}${wx}. Sun position, shadow length, direction and softness physically consistent with that time. Balanced ambient illumination with realistic bounce light. Realistic reflections in glazing and polished materials. Lighting is physically accurate, neutral, and non-dramatic.`;
}

function buildPrompt(pillState, viewType = 'perspective_3d', opts = {}) {
  const p = pillState || {};
  const { landscaping, free_text, skip = {} } = p;
  const { refDescriptions = [], hasBoundary = false, presetAddendum = '' } = opts;

  const view       = VIEW_INSTRUCTIONS[viewType] || VIEW_INSTRUCTIONS.perspective_3d;
  const descriptor = BUILDING_DESCRIPTORS[p.building_type] || (p.building_type || 'building').toLowerCase();
  const building   = buildBuildingClause(p);
  const lighting   = buildLightingClause(p);
  const landscape  = (!skip.landscaping && landscaping) ? (LANDSCAPING_MAP[landscaping] || landscaping) : '';
  const free       = free_text && free_text.trim() ? `\n\nAdditional notes: ${free_text.trim()}` : '';

  const boundaryClause = hasBoundary
    ? 'A red outline has been drawn on the source image marking the build site. Place the new building strictly inside that red outline. Pixels outside the red outline must remain pixel-perfect identical to the source — do not add, remove, modify, or restyle anything beyond the outline.'
    : 'Place the new building only on the empty plot visible in the source image. Do not extend it onto neighbouring land.';

  const refClause = (refDescriptions && refDescriptions.length)
    ? `\n\nReference influences (apply ONLY to the new building, never to anything around it):\n${refDescriptions.map((d, i) => `  ${i + 1}. ${d}`).join('\n')}\n\nLift the materials, fenestration patterns, and detail treatments described above and apply them to the new building's facade and roof. Do not change neighbouring buildings to match the references — references inform the new building only.`
    : '';

  const presetClause = presetAddendum && presetAddendum.trim()
    ? `\n\n${presetAddendum.trim()}`
    : '';

  return `Please reimagine this low quality photoshop collage of a ${descriptor} on the empty site shown as a real, high-resolution photograph of a newly completed, inhabited environment captured by a professional architectural photographer.

${view}

Site & geometry: ${boundaryClause} Preserve all existing geometry — the site boundary, surrounding buildings, paths, entrances, kerbs, vegetation, and circulation — exactly as shown in the source image. Match the scale and proportion of neighbouring buildings.

PRESERVE EXACTLY (do NOT modify): Every neighbouring building must remain pixel-perfect identical to the source — same height, same parapet line, same facade material, same window grid, same roofline, same colour. Roads, kerbs, pavements, road markings, street furniture, parked vehicles, trees, hedges, planters, the horizon line and the sky must remain exactly as shown. The only change anywhere in the image is the new building inserted on the empty site.

Architecture & materials: ${building} Newly constructed and well maintained. Clean, uniform surfaces. High-resolution material definition. Sharp edges and precise junctions. Accurate light response for glass, metal, stone and concrete. Do not introduce wear, weathering, dirt, stains, damage, or surface imperfections.${presetClause}${landscape ? `\n\nLandscape (inside the build site only): ${landscape}` : ''}${refClause}

Lighting & exposure: ${lighting}

People: Introduce people naturally where the environment supports human presence — occupants, passers-by, staff, visitors. Candid and unposed; contributing scale and life without appearing staged. Close-range photographic realism: visible skin texture with pores and natural tonal variation, sharp facial detail without stylisation, individually resolved hair strands with realistic light interaction, accurate fabric textures with seams, folds and material weight, natural posture and movement. Subtle motion blur only on people moving naturally; stationary architecture and faces remain sharp.

Camera: High-end full-frame body. 35mm prime lens at f/4.5. Shutter speed appropriate to the available light and subtle human motion. Clean low ISO. Realistic depth of field with focus on the new building. Neutral white balance, accurate colour. Clean exposure with restrained contrast. No cinematic grading, no artistic filters, no stylised effects.

Treat the scene as a real place being photographed, not modified or enhanced. The result must be indistinguishable from a real, professionally captured photograph.${free}`;
}

function buildPromptSegments(pillState) {
  const {
    building_type, stories, arch_style, facade, roof,
    landscaping, time_of_day, weather, surroundings, free_text,
    skip = {}
  } = pillState;

  const segments = [];
  if (building_type) segments.push({ text: building_type, color: SEGMENT_COLORS.building, key: 'building_type' });
  if (stories)       segments.push({ text: stories, color: SEGMENT_COLORS.stories, key: 'stories' });
  if (!skip.arch_style && arch_style) segments.push({ text: arch_style, color: SEGMENT_COLORS.arch_style, key: 'arch_style' });
  if (!skip.facade && facade)         segments.push({ text: facade, color: SEGMENT_COLORS.facade, key: 'facade' });
  if (!skip.roof && roof)             segments.push({ text: roof, color: SEGMENT_COLORS.roof, key: 'roof' });
  if (!skip.landscaping && landscaping) segments.push({ text: landscaping, color: SEGMENT_COLORS.landscaping, key: 'landscaping' });
  if (time_of_day)                    segments.push({ text: time_of_day, color: SEGMENT_COLORS.time_of_day, key: 'time_of_day' });
  if (!skip.weather && weather)       segments.push({ text: weather, color: SEGMENT_COLORS.weather, key: 'weather' });
  if (!skip.surroundings && surroundings) segments.push({ text: surroundings, color: SEGMENT_COLORS.surroundings, key: 'surroundings' });
  if (free_text && free_text.trim()) segments.push({ text: free_text.trim(), color: SEGMENT_COLORS.free_text, key: 'free_text' });
  return segments;
}

// ── Follow-up "More photographs" prompts ────────────────────────────────────
// Source image is a previously-generated photograph of the new building. The
// follow-up asks Gemini to re-photograph the SAME building from a different
// human-scale viewpoint with active life around it.

// 4 sky views (each from a cardinal compass quadrant) + 6 ground views.
// Sky views vary the camera bearing while keeping an oblique drone look.
// Ground views vary the camera position + the human/lifestyle context.
const FOLLOWUP_VIEW_INSTRUCTIONS = {
  // ── SKY (4) ────────────────────────────────────────────────────────────
  sky_ne: 'Aerial drone photograph from the north-east, looking south-west toward the building at approximately 60° from horizontal, ~120 m altitude. Frame the full building footprint and roof, with the immediate neighbouring blocks visible. Clean photographic perspective; no fish-eye.',
  sky_se: 'Aerial drone photograph from the south-east, looking north-west toward the building at approximately 60° from horizontal, ~120 m altitude. Show the full building footprint and roof, with immediate neighbours visible. Clean photographic perspective.',
  sky_sw: 'Aerial drone photograph from the south-west, looking north-east toward the building at approximately 60° from horizontal, ~120 m altitude. Show the full building footprint and roof, with immediate neighbours visible. Clean photographic perspective.',
  sky_nw: 'Aerial drone photograph from the north-west, looking south-east toward the building at approximately 60° from horizontal, ~120 m altitude. Show the full building footprint and roof, with immediate neighbours visible. Clean photographic perspective.',

  // ── GROUND (6) ─────────────────────────────────────────────────────────
  street_front: 'Eye-level photograph from the pavement directly opposite the building — 35 mm lens framing the full front elevation, slight upward tilt to capture the parapet. Active street life in the foreground: a small group walking past, a parent pushing a buggy, a person on a bike. Buildings and materials remain identical to the source.',
  street_corner: 'Eye-level photograph from a street corner, showing two facades at an oblique angle. Human-scale viewpoint, pedestrians passing, a cyclist in motion. The building dominates the frame; surrounding context kept quiet.',
  street_entrance: 'Close-up photograph of the main entrance and ground floor — close enough to read material textures and signage. People arriving and leaving: someone holding the door, a small group chatting, a delivery cyclist passing. Subtle motion blur on moving people; the architecture stays sharp.',
  plaza_active: 'Photograph from a public plaza or landscaped open space immediately in front of the building — eye-level, slight upward tilt to read the parapet, families with young children playing, a couple walking a dog, people sitting on benches reading. If a green space exists, populate it richly. Mature tree planting in the foreground.',
  cafe_terrace: 'Photograph of a small cafe / restaurant terrace at the foot of the building — al fresco tables with diners, baristas serving, planters spilling with greenery, soft fabric umbrellas, a dog asleep under a chair. Late afternoon. The building anchors the background.',
  lifestyle_evening: 'Late-golden-hour lifestyle photograph — warm directional light, long shadows, busy street life: people heading home from work, cyclists, a couple with takeaway coffees, soft glow beginning from inside the building\'s ground-floor windows. The building dominates the composition.',
};

function buildFollowupPrompt(pillState, viewType, opts = {}) {
  const p = pillState || {};
  const { presetAddendum = '', buildingDescription = '' } = opts;
  const descriptor = BUILDING_DESCRIPTORS[p.building_type] || (p.building_type || 'building').toLowerCase();
  const view = FOLLOWUP_VIEW_INSTRUCTIONS[viewType] || FOLLOWUP_VIEW_INSTRUCTIONS.street_front;
  const presetClause = presetAddendum && presetAddendum.trim() ? `\n\n${presetAddendum.trim()}` : '';
  const visionClause = buildingDescription && buildingDescription.trim()
    ? `\n\nThe building shown in the source image: ${buildingDescription.trim()} — every one of these features must be preserved exactly.`
    : '';

  return `Please reimagine this low quality photoshop collage as a real, high-resolution photograph of the same building from a new viewpoint, captured by a professional architectural photographer.

Camera & framing: ${view}

PRESERVE EXACTLY (do NOT modify): The building's form, massing, materials, fenestration pattern, roofline, parapet, balconies, colour, and proportions must be IDENTICAL to the source image. Do not redesign the building. Only the camera viewpoint and the people / life around it change. Neighbouring buildings, roads, kerbs, pavements, trees, planters, and the horizon stay plausible and quiet — never compete with the subject.${visionClause}

People and human realism: Introduce people naturally where the environment supports human presence — occupants, passers-by, staff, visitors, families, dog walkers, cyclists. Candid and unposed, contributing scale and life without appearing staged. Close-range photographic realism: clearly visible skin texture with pores and natural tonal variation, sharp facial detail without stylisation, individually resolved hair strands with realistic light interaction, accurate fabric textures with seams, folds, and material weight, natural posture and movement.

Architecture and materials: All architecture remains unchanged in form and layout. Buildings appear newly constructed and well maintained. Clean, uniform surfaces. High-resolution material definition. Sharp edges and precise junctions. Accurate light response for glass, metal, stone, and concrete. No wear, weathering, dirt, stains, damage, or surface imperfections.

Time, lighting, and exposure: Physically accurate natural daylight consistent with the time of day implied by this view. Sun position and angle, shadow length, direction, and softness physically consistent. Balanced ambient illumination with realistic bounce light. Realistic reflections in glazing and polished materials. Lighting is neutral and non-dramatic.

Motion and shutter behaviour: Apply subtle motion blur only where people are moving naturally, consistent with shutter speed. Stationary architecture and faces remain sharp.

Camera, lens, and capture settings: High-end full-frame camera body. 35 mm lens at f/4.5. Shutter speed appropriate to the available light and human motion. Clean low ISO. Realistic depth of field with focus on the subject building. Neutral white balance, accurate colour response. Clean exposure with restrained contrast. No cinematic effects, artistic grading, or stylised filters.

Subject: ${descriptor} (re-photographed, not redesigned).${presetClause}

Treat the scene as a real place being photographed, not modified or enhanced. The result must be indistinguishable from a real, professionally captured photograph of a newly completed, inhabited environment.`;
}

module.exports = { buildPrompt, buildFollowupPrompt, buildPromptSegments, SEGMENT_COLORS };
