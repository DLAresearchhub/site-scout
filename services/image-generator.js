const https = require('https');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const SITE_IMAGES_DIR = path.join(__dirname, '../public/site-images');
const MODEL = process.env.GEMINI_IMAGE_MODEL || 'gemini-2.0-flash-preview-image-generation';

function ensureDir() {
  if (!fs.existsSync(SITE_IMAGES_DIR)) fs.mkdirSync(SITE_IMAGES_DIR, { recursive: true });
}

function geminiRequest(body) {
  return new Promise((resolve, reject) => {
    const key = process.env.GEMINI_API_KEY;
    if (!key) return reject(new Error('GEMINI_API_KEY not set'));

    const payload = JSON.stringify(body);
    const opts = {
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/${MODEL}:generateContent?key=${key}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    const req = https.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        if (res.statusCode !== 200) {
          return reject(new Error(`Gemini API error ${res.statusCode}: ${text.slice(0, 300)}`));
        }
        try {
          resolve(JSON.parse(text));
        } catch {
          reject(new Error(`Failed to parse Gemini response: ${text.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function extractImageFromResponse(response) {
  const parts = response?.candidates?.[0]?.content?.parts;
  if (!parts) return null;
  for (const part of parts) {
    if (part.inlineData && part.inlineData.data) {
      return { data: part.inlineData.data, mimeType: part.inlineData.mimeType || 'image/jpeg' };
    }
  }
  return null;
}

async function generateFromCapture(captureBase64, captureMimeType, prompt, referenceImages = []) {
  ensureDir();

  const parts = [
    { text: prompt },
    { inlineData: { mimeType: captureMimeType || 'image/jpeg', data: captureBase64 } },
  ];

  // Append any reference images (style/material inspiration)
  if (referenceImages && referenceImages.length > 0) {
    for (const ref of referenceImages.slice(0, 5)) {
      if (ref && ref.data) {
        parts.push({ inlineData: { mimeType: ref.mimeType || 'image/jpeg', data: ref.data } });
      }
    }
  }

  const body = {
    contents: [{ parts }],
    generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
  };

  const response = await geminiRequest(body);
  const image = extractImageFromResponse(response);

  if (!image) {
    // Log what Gemini returned for debugging
    const textParts = response?.candidates?.[0]?.content?.parts?.filter(p => p.text) || [];
    const msg = textParts.map(p => p.text).join(' ') || 'No image in response';
    throw new Error(`Gemini did not return an image. Response: ${msg.slice(0, 200)}`);
  }

  const ext = image.mimeType.includes('png') ? 'png' : 'jpg';
  const filename = `gen-${uuidv4()}.${ext}`;
  const filePath = path.join(SITE_IMAGES_DIR, filename);
  fs.writeFileSync(filePath, Buffer.from(image.data, 'base64'));

  return `/site-images/${filename}`;
}

function isConfigured() {
  return !!process.env.GEMINI_API_KEY;
}

module.exports = { generateFromCapture, isConfigured };
