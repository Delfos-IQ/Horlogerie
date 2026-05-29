/**
 * Cloudflare Worker — Horlogerie API
 * Worker URL: https://horlogerie.pedicode-app.workers.dev
 *
 * GROQ_API_KEY must be configured as a Secret in the Cloudflare dashboard:
 *   Workers & Pages → horlogerie → Settings → Variables and Secrets
 *   → Add variable → Type: Secret → Name: GROQ_API_KEY → Value: gsk_...
 *
 * Routes:
 *   POST /identify  — 2-pass watch identification (Scout vision → Maverick reasoning)
 *   POST /details   — Full specs + market price (Maverick)
 *   GET  /health    — Health check
 */

const CORS_ORIGIN   = '*';
const MODEL_VISION  = 'meta-llama/llama-4-scout-17b-16e-instruct';
const MODEL_VERIFY  = 'meta-llama/llama-4-maverick-17b-128e-instruct';
const MODEL_DETAILS = 'meta-llama/llama-4-maverick-17b-128e-instruct';

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return corsResponse(null, 204);

    if (!env.GROQ_API_KEY) {
      return corsResponse({
        error: 'GROQ_API_KEY secret not configured. Go to Cloudflare dashboard → Workers → horlogerie → Settings → Variables and Secrets → add GROQ_API_KEY as a Secret.'
      }, 500);
    }

    const url = new URL(request.url);

    try {
      if (url.pathname === '/identify' && request.method === 'POST')
        return await handleIdentify(request, env);
      if (url.pathname === '/details'  && request.method === 'POST')
        return await handleDetails(request, env);
      if (url.pathname === '/' || url.pathname === '/health')
        return corsResponse({ status: 'ok', service: 'horlogerie-api', version: '2.1' }, 200);

      return corsResponse({ error: 'Not found' }, 404);
    } catch (e) {
      console.error(e);
      return corsResponse({ error: e.message }, 500);
    }
  }
};

/* ═══════════════════════════════════════════════════════
   /identify  —  Two-pass watch identification
   Pass 1: Scout vision  → extract all visual evidence
   Pass 2: Maverick text → reason to final identification
═══════════════════════════════════════════════════════ */
async function handleIdentify(request, env) {
  const { image, mediaType } = await request.json();
  if (!image) return corsResponse({ error: 'Missing image' }, 400);

  const extractPrompt = `You are an expert watch analyst. Study this watch photo with maximum attention.

Systematically describe EVERY visible detail you can read or infer:

1. DIAL: What text, logo, brand name, or signatures appear on the dial? List exact text.
2. HANDS: Shape and style (sword, baton, dauphine, lollipop, Mercedes, etc.)
3. INDICES / HOUR MARKERS: Shape, material, color (applied, printed, Arabic, Roman)
4. BEZEL: Type (rotating, fixed, fluted, smooth), material, markings, color
5. CASE: Shape (round, cushion, tonneau), crown position, pushers visible?
6. CROWN: Shape, guards, logo engraved?
7. CASEBACK: Visible or not?
8. BRACELET/STRAP: Type, material, clasp visible?
9. COMPLICATIONS: Date window, chronograph subdials, GMT hand, moonphase?
10. COLORS: Dominant dial color, accent colors
11. OVERALL STYLE: Sport, dress, diver, pilot, racing

Be extremely precise. Quote any text you can read literally.`;

  const pass1 = await callGroq(env, {
    model: MODEL_VISION,
    max_tokens: 800,
    temperature: 0.1,
    messages: [{
      role: 'user',
      content: [
        { type: 'image_url', image_url: { url: `data:${mediaType};base64,${image}` } },
        { type: 'text', text: extractPrompt }
      ]
    }]
  });

  const visualAnalysis = pass1.choices?.[0]?.message?.content || 'No analysis available';

  const identifyPrompt = `You are a master horologist with 30 years of experience identifying watches from every brand.

A watch photo has been analysed and the following visual details were extracted:

--- VISUAL ANALYSIS ---
${visualAnalysis}
--- END ANALYSIS ---

Based on these visual clues, identify this watch using your deep knowledge of:
- Brand logos, dial typography, and signature design elements
- Model-specific bezel types, hand shapes, and case proportions
- Reference-specific dial variations and color codes
- Historical design evolution of each manufacturer

Think step by step:
1. Which brand does the dial text/logo point to?
2. Which model family do the design elements suggest?
3. Can you narrow down to a specific reference?
4. What movement type is most likely?
5. How confident are you?

Then output ONLY this JSON (no markdown, no backticks):
{
  "brand": "exact brand name",
  "model": "exact model name",
  "ref": "reference number if identifiable, else empty string",
  "type": "automatic or quartz or manual",
  "confidence": "high or medium or low",
  "reasoning": "1-2 sentences explaining the key visual clues that led to this identification"
}`;

  const pass2 = await callGroq(env, {
    model: MODEL_VERIFY,
    max_tokens: 400,
    temperature: 0.1,
    messages: [{ role: 'user', content: identifyPrompt }]
  });

  const result = parseJSON(pass2.choices?.[0]?.message?.content || '{}');
  result._analysis = visualAnalysis;
  return corsResponse(result, 200);
}

/* ═══════════════════════════════════════════════════════
   /details  —  Full technical specs + market price
═══════════════════════════════════════════════════════ */
async function handleDetails(request, env) {
  const { brand, model, ref, type } = await request.json();
  if (!brand || !model) return corsResponse({ error: 'Missing brand or model' }, 400);

  const watchId  = [brand, model, ref].filter(Boolean).join(' ');
  const movLabel = type === 'automatic' ? 'automatic' : type === 'quartz' ? 'quartz' : 'manual winding';

  const prompt = `You are a professional horologist, certified watch appraiser, and market analyst.
Provide precise technical specifications and current market data for: ${watchId} (${movLabel}).

Think carefully — only include values you are confident about.

Respond ONLY with this JSON (no markdown, no backticks):
{
  "specs": {
    "calibre":     "caliber name and number (e.g. Rolex Cal. 3135, ETA 2824-2, Sellita SW200)",
    "movimiento":  "movement detail: type, frequency, jewel count (e.g. COSC chronometer, 28800vph, 31 jewels)",
    "cristal":     "crystal: material + coating + profile (e.g. Sapphire, double anti-reflective, flat)",
    "brazalete":   "bracelet or strap: name, material, clasp (e.g. Oyster bracelet, 904L steel, Oysterlock clasp)",
    "esfera":      "dial: color, indexes, finishing, complications (e.g. Black lacquered, applied gold indices, date 3h)",
    "caja":        "case: material + treatment (e.g. 316L steel brushed/polished, screw-down crown, solid caseback)",
    "resistencia": "water resistance (e.g. 300m / 30 ATM)",
    "reserva":     "power reserve — leave empty for quartz (e.g. 48h, 70h)",
    "diametro":    "case diameter (e.g. 40mm)",
    "grosor":      "case thickness (e.g. 12.5mm)"
  },
  "price": {
    "value": "estimated price range in EUR (e.g. 'Nuevo: ~8.100 € · Segundamano: 6.500 – 7.800 €')",
    "note":  "boutique vs grey market context, demand trend, max 2 sentences"
  }
}
Leave empty string for any value you are not certain about. Never invent specifications.`;

  const groqRes = await callGroq(env, {
    model: MODEL_DETAILS,
    max_tokens: 1000,
    temperature: 0.15,
    messages: [{ role: 'user', content: prompt }]
  });

  return corsResponse(parseJSON(groqRes.choices?.[0]?.message?.content || '{}'), 200);
}

/* ═══════════════════════════════════════════════════════
   Helpers
═══════════════════════════════════════════════════════ */

async function callGroq(env, payload) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${env.GROQ_API_KEY}`
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq ${res.status}: ${err.slice(0, 300)}`);
  }
  return res.json();
}

function parseJSON(text) {
  const clean = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  try { return JSON.parse(clean); } catch {}
  const match = clean.match(/\{[\s\S]*\}/);
  if (match) { try { return JSON.parse(match[0]); } catch {} }
  return { error: 'Could not parse model response', raw: clean.slice(0, 300) };
}

function corsResponse(data, status) {
  return new Response(
    data === null ? '' : JSON.stringify(data),
    {
      status,
      headers: {
        'Content-Type':                 'application/json',
        'Access-Control-Allow-Origin':  CORS_ORIGIN,
        'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      }
    }
  );
}
