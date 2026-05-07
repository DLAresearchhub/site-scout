// services/ref-analyzer.js
//
// Sends each user-uploaded reference image to Gemini text-vision (gemini-2.5-
// flash) to extract a short architectural description. The descriptions are
// injected into the main image-generation prompt so the model knows which
// features (facade material, fenestration, roof, landscaping, distinctive
// details) to lift FROM the references and apply TO the new building.
//
// Costs pennies — text-vision on gemini-2.5-flash is cheap and we cap at 5
// references with ~120 output tokens each.

const https = require('https');

const TEXT_MODEL = process.env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash';
const API_VER   = process.env.GEMINI_API_VERSION || 'v1beta';

function geminiTextRequest(body) {
  return new Promise((resolve, reject) => {
    const key = process.env.GEMINI_API_KEY;
    if (!key) return reject(new Error('GEMINI_API_KEY not set'));
    const payload = JSON.stringify(body);
    const opts = {
      hostname: 'generativelanguage.googleapis.com',
      path: `/${API_VER}/models/${TEXT_MODEL}:generateContent?key=${key}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
    };
    const req = https.request(opts, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString();
        if (res.statusCode !== 200) return reject(new Error(`Gemini text error ${res.statusCode}: ${text.slice(0, 200)}`));
        try { resolve(JSON.parse(text)); } catch { reject(new Error('Bad JSON: ' + text.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function extractText(response) {
  const parts = response && response.candidates && response.candidates[0] && response.candidates[0].content && response.candidates[0].content.parts;
  if (!parts) return '';
  return parts.map(p => p.text || '').filter(Boolean).join(' ').trim();
}

async function describeReferences(refs = []) {
  if (!Array.isArray(refs) || refs.length === 0) return [];
  const max = Math.min(refs.length, 5);
  const results = [];
  for (let i = 0; i < max; i++) {
    const ref = refs[i];
    if (!ref || !ref.data) continue;
    try {
      const body = {
        contents: [{
          parts: [
            {
              text: 'In ONE concise sentence (max ~30 words), describe the architectural features an architect would lift from this image. Mention facade material, fenestration pattern, roof type, landscaping, and any distinctive details. No preamble — just the description.',
            },
            { inlineData: { mimeType: ref.mimeType || 'image/jpeg', data: ref.data } },
          ],
        }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 120 },
      };
      const resp = await geminiTextRequest(body);
      const text = extractText(resp);
      if (text) results.push(text);
    } catch (e) {
      console.warn('[ref-analyzer] reference', i, 'failed:', e.message);
    }
  }
  return results;
}

module.exports = { describeReferences };
