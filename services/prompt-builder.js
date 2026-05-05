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

const LANDSCAPING_MAP = {
  'Very Green':  'with extensive landscaping, mature trees, green walls, and planted areas throughout',
  'Balanced':    'with a balanced mix of soft landscaping and hardscape, tree-lined paths and plazas',
  'Minimal':     'with minimal planting, clean hardscape, simple ground treatment',
  'Very Paved':  'with predominantly paved urban hardscape, geometric plazas, and minimal vegetation',
};

const TIME_MAP = {
  'Dawn':        'at dawn with soft pink and orange light on the horizon',
  'Morning':     'in bright morning light with long shadows',
  'Midday':      'in harsh midday sun with crisp shadows',
  'Golden Hour': 'during golden hour with warm, directional light and long shadows',
  'Dusk':        'at dusk with deep blue sky and warm interior lighting glowing',
  'Night':       'at night with dramatic uplighting and illuminated interiors',
};

const WEATHER_MAP = {
  'Clear':           'under clear blue sky',
  'Overcast':        'under soft overcast light with even shadows',
  'Dramatic clouds': 'with dramatic storm clouds and dynamic sky',
  'Rain-washed':     'on a rain-washed day with reflective wet surfaces',
};

const SURROUNDINGS_MAP = {
  'Dense urban':  'surrounded by dense urban cityscape, tall buildings, and busy streets',
  'Mixed urban':  'in a mixed urban neighbourhood with mid-rise buildings and street activity',
  'Suburban':     'in a suburban context with lower-density housing and green space nearby',
  'Green belt':   'at the edge of a green belt with open countryside visible beyond',
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

const VIEW_INSTRUCTIONS = {
  aerial:          'Photorealistic aerial drone CGI looking down at approximately 45 degrees. Show the full building footprint, roof, and immediate surroundings.',
  street_front:    'Photorealistic street-level CGI of the front facade. Eye-level perspective from across the street showing the full elevation.',
  street_corner:   'Photorealistic street-level CGI from a corner angle showing two facades. Human-scale perspective with pedestrians and street activity.',
  street_entrance: 'Photorealistic street-level CGI focused on the main entrance and ground floor. Close-up perspective showing materiality and detail.',
};

function buildPrompt(pillState, viewType = 'aerial') {
  const {
    building_type, stories, arch_style, facade, roof,
    landscaping, time_of_day, weather, surroundings, free_text,
    skip = {}
  } = pillState;

  const descriptor = BUILDING_DESCRIPTORS[building_type] || building_type.toLowerCase();
  const storiesText = stories ? `, ${stories} storeys` : '';
  const styleText = (!skip.arch_style && arch_style) ? `, ${arch_style} architectural style` : '';
  const facadeText = (!skip.facade && facade) ? `. Facade: ${facade}` : '';
  const roofText = (!skip.roof && roof) ? `. Roof: ${roof}` : '';
  const landscapeText = (!skip.landscaping && landscaping) ? `. ${LANDSCAPING_MAP[landscaping] || landscaping}` : '';
  const timeText = TIME_MAP[time_of_day] || time_of_day || 'during golden hour';
  const weatherText = (!skip.weather && weather) ? ` ${WEATHER_MAP[weather] || weather}` : '';
  const surroundText = (!skip.surroundings && surroundings) ? `. ${SURROUNDINGS_MAP[surroundings] || surroundings}` : '';
  const freeText = free_text ? ` ${free_text.trim()}` : '';

  const viewInstruction = VIEW_INSTRUCTIONS[viewType] || VIEW_INSTRUCTIONS.aerial;

  return `${viewInstruction}

Take this photograph of the existing empty site and generate a photorealistic architectural visualisation showing a new ${descriptor}${storiesText}${styleText}${facadeText}${roofText}${landscapeText} built on this site${surroundText}.

Lighting: ${timeText}${weatherText}.

The building should fit naturally into the site boundaries visible in the photograph. Maintain the existing street geometry, neighbouring buildings, and surrounding context. The generated image should look like a professional architectural CGI or design-stage render — photorealistic, not cartoon or sketch.${freeText}`;
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

module.exports = { buildPrompt, buildPromptSegments, SEGMENT_COLORS };
