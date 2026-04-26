# Site Scout Image Generation Services

## Overview

Two complementary services for generating photorealistic architectural CGI visualizations:

### `image-generator.js`
**Main service** that handles Gemini API integration and image generation workflows.

**Key Features:**
- `generateAerialCGI(siteScreenshotBase64, config)` — Creates one photorealistic aerial drone view
- `generateFollowUpViews(aerialCGIBase64, config, count=5)` — Generates 5 contextual views (street-level + interiors)
- `generateSingleView(referenceImageBase64, prompt)` — Custom view generation with any prompt
- Automatic retry logic with 5-second backoff for rate limits (max 3 attempts)
- Image persistence to `/tmp/site-scout-images/` with UUID filenames
- Comprehensive error handling and logging

**Configuration:**
- Requires Google Generative AI API key
- Uses `gemini-2.0-flash-preview-image-generation` model
- Respects rate limits with exponential backoff

### `prompt-builder.js`
**Prompt generation engine** that creates rich, architectural-quality prompts.

**Key Features:**
- `buildAerialPrompt(config)` — Aerial drone photography prompt
- `buildStreetLevelPrompt(config, viewIndex)` — 5 distinct street-level perspectives
- `buildInteriorPrompt(config, viewIndex)` — Building-type-specific interior views
- `shouldIncludeInteriors(buildingType)` — Smart logic to include interiors for office, school, hotel, retail, healthcare, residential, mixed-use, cultural, civic buildings
- Smart view distribution: 60% street-level, 40% interior (when applicable)

## Usage Example

```javascript
const ImageGenerator = require('./services/image-generator');

const generator = new ImageGenerator(process.env.GOOGLE_API_KEY);

// Step 1: Generate aerial CGI
const aerial = await generator.generateAerialCGI(siteScreenshotBase64, {
  buildingType: 'office',
  stories: 8,
  styleNotes: 'Contemporary minimalist design with glass facade and steel frame',
  city: 'London',
  siteName: 'King Street Development',
  season: 'summer'
});

// Step 2: Generate follow-up views using aerial as reference
const followUps = await generator.generateFollowUpViews(aerial.imageBase64, {
  buildingType: 'office',
  stories: 8,
  styleNotes: 'Contemporary minimalist design with glass facade and steel frame',
  city: 'London',
  siteName: 'King Street Development'
});

// All images saved to /tmp/site-scout-images/
// Return both base64 and file paths in results
```

## Image Output

All generated images are saved to `/tmp/site-scout-images/` with:
- UUID-based filenames for uniqueness
- JPEG format for web delivery
- Both base64 data and file path returned in responses
- Images ready for Express static file serving

## Error Handling

- **Rate limits (429):** Automatic retry with 5s backoff, max 3 attempts
- **Generation failures:** Returns error object with message, does not crash pipeline
- **Missing API key:** Throws immediately with clear error message
- **Missing image directory:** Creates `/tmp/site-scout-images/` automatically

## Logging

All operations logged to console with `[ImageGenerator]` and `[PromptBuilder]` prefixes:
- API call initiation
- Generation success/failure
- File save operations
- Rate limit retries
- View count summaries

## Building Types Supported

The prompt builder intelligently handles:
- `office` — Office buildings with corporate spaces
- `residential` — Apartment/residential blocks
- `mixed-use` — Office + retail + residential
- `retail` — Commercial/shopping buildings
- `hotel` — Hotel properties
- `school` — Educational facilities
- `healthcare` — Medical/health facilities
- `industrial` — Warehouses/manufacturing
- `cultural` — Museums/galleries/theaters
- `civic` — Government/public buildings

Each type receives tailored interior views when appropriate.

## Integration with Express Server

Configure static file serving in `server.js`:

```javascript
const express = require('express');
const ImageGenerator = require('./services/image-generator');

const app = express();
const imageDir = ImageGenerator.getImageDir();

app.use('/generated-images', express.static(imageDir));
```

Images are then accessible via:
```
http://localhost:3000/generated-images/aerial-cgi-[uuid].jpg
```

## Prompt Quality

Prompts are engineered for:
- **Photorealism:** "Looks like a real photograph, not a render or sketch"
- **Architectural detail:** Focus on facade, materials, lighting, proportions
- **Urban context:** Surrounding streets, cars, people, neighboring buildings
- **Variety:** Different angles, times of day, weather conditions
- **Professional photography:** 8K resolution, ultra-sharp, architectural quality
- **No artifacts:** No text, labels, watermarks
