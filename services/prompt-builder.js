/**
 * Prompt Builder Service
 * Builds rich, detailed prompts for Gemini image generation
 */

/**
 * Build aerial/drone view prompt
 * @param {string} siteScreenshot - Reference screenshot or placeholder
 * @param {string} buildingType - Building type (Office, Residential, etc.)
 * @param {string} stories - Number of stories
 * @param {string} styleNotes - Style description from user
 * @param {string} city - City name
 * @returns {string} Detailed prompt for aerial CGI
 */
function buildAerialPrompt(siteScreenshot, buildingType, stories, styleNotes, city) {
  let storyCount = 'multi-storey';
  
  if (stories === '1–2') storyCount = 'two-storey';
  else if (stories === '3–5') storyCount = 'five-storey';
  else if (stories === '6–10') storyCount = 'ten-storey';
  else if (stories === '11–20') storyCount = 'high-rise';
  else if (stories === '20+') storyCount = 'tall high-rise';

  const styleSection = styleNotes && styleNotes.trim() 
    ? `Architectural style: ${styleNotes}. `
    : 'Contemporary sustainable design with emphasis on green spaces. ';

  const prompt = `A photorealistic drone photograph taken at 45 degrees from above, golden hour warm lighting, of a new ${storyCount} ${buildingType.toLowerCase()} building situated on an urban site in ${city}. ${styleSection}The building appears naturally integrated into its surroundings with seamless landscaping and pedestrian areas. High-end architectural photography quality, 8K resolution, sharp focus, professional CGI quality with no visible renders. No text overlays. Photorealistic, not a 3D model render. Professional architectural photography style.`;

  return prompt;
}

/**
 * Build street-level view prompt
 * @param {string} aerialCGI - Reference aerial image URL (for context)
 * @param {string} buildingType - Building type
 * @param {string} stories - Number of stories
 * @param {number} viewIndex - View index (0, 1, 2 for different angles)
 * @returns {string} Street-level prompt
 */
function buildStreetPrompt(aerialCGI, buildingType, stories, viewIndex) {
  const angles = [
    'front façade at street level',
    'corner view with adjacent buildings',
    'entrance and ground floor context'
  ];

  const angleDescription = angles[viewIndex % 3];

  let storyCount = 'multi-storey';
  if (stories === '1–2') storyCount = 'two-storey';
  else if (stories === '3–5') storyCount = 'five-storey';
  else if (stories === '6–10') storyCount = 'ten-storey';
  else if (stories === '11–20') storyCount = 'high-rise';
  else if (stories === '20+') storyCount = 'skyscraper';

  const prompt = `A photorealistic street-level photograph showing the ${angleDescription} of a new ${storyCount} ${buildingType.toLowerCase()} building. Shot at eye level, warm day lighting with subtle shadows. The street shows pedestrians, street trees, and urban context. Professional architectural photography, 8K quality, sharp focus, no visible CGI artifacts. Photorealistic quality matching professional real estate and architectural photography. No text overlays.`;

  return prompt;
}

/**
 * Build interior view prompt
 * @param {string} buildingType - Building type
 * @param {string} stories - Number of stories
 * @param {string} styleNotes - Style description
 * @param {number} viewIndex - View index
 * @returns {string} Interior prompt
 */
function buildInteriorPrompt(buildingType, stories, styleNotes, viewIndex) {
  const interiorTypes = {
    'Office': ['open-plan office space with natural light', 'collaborative work area with exposed beams', 'modern reception area with green walls'],
    'Residential': ['contemporary living space with floor-to-ceiling windows', 'bright master bedroom with city views', 'modern kitchen and dining area'],
    'Mixed Use': ['ground floor retail space with tall ceilings', 'residential living area with city views', 'shared community space with skylights'],
    'Retail': ['bright storefront with prominent displays', 'interior shopping mall perspective', 'checkout area with natural lighting'],
    'School': ['light-filled classroom with connected learning spaces', 'modern sports hall with natural ventilation', 'collaborative learning commons'],
    'Hotel': ['guest room with premium furnishings and city views', 'contemporary lobby and reception area', 'fine dining restaurant with elegant design'],
    'Industrial': ['open workshop space with high ceilings', 'production floor with efficient layout', 'loading bay with modern facilities'],
    'Healthcare': ['modern patient room with natural light', 'contemporary waiting area with calming design', 'treatment space with modern equipment']
  };

  const buildingKey = Object.keys(interiorTypes).find(key => 
    buildingType.toLowerCase().includes(key.toLowerCase())
  ) || 'Office';

  const interiorDescription = interiorTypes[buildingKey][viewIndex % 3];

  const styleSection = styleNotes && styleNotes.trim()
    ? `Design theme: ${styleNotes}. `
    : 'Contemporary sustainable design with natural materials. ';

  const prompt = `A photorealistic interior photograph of a ${interiorDescription} in a modern ${buildingType.toLowerCase()} building. ${styleSection}Professional architectural interior photography, daylight illumination, 8K quality, sharp focus, no visible CGI artifacts. Photorealistic quality. High-end interior design aesthetic. No people visible, clean and staged. No text overlays.`;

  return prompt;
}

module.exports = {
  buildAerialPrompt,
  buildStreetPrompt,
  buildInteriorPrompt
};
