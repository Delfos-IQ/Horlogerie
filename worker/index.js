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
// Scout is confirmed available on Groq free tier (vision + text).
// Maverick requires preview access — do not use on free accounts.
const MODEL_VISION  = 'meta-llama/llama-4-scout-17b-16e-instruct';
const MODEL_VERIFY  = 'meta-llama/llama-4-scout-17b-16e-instruct';
const MODEL_DETAILS = 'meta-llama/llama-4-scout-17b-16e-instruct';

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
      // ── AI endpoints ──
      if (url.pathname === '/identify' && request.method === 'POST')
        return await handleIdentify(request, env);
      if (url.pathname === '/details'  && request.method === 'POST')
        return await handleDetails(request, env);

      // ── Sync / storage endpoints (require KV binding) ──
      if (url.pathname === '/sync/push'  && request.method === 'POST')
        return await handleSyncPush(request, env);
      if (url.pathname === '/sync/pull'  && request.method === 'GET')
        return await handleSyncPull(request, env);
      if (url.pathname === '/sync/clear' && request.method === 'DELETE')
        return await handleSyncClear(request, env);

      // ── Health ──
      if (url.pathname === '/' || url.pathname === '/health')
        return corsResponse({ status: 'ok', service: 'horlogerie-api', version: '3.0', kv: !!env.HORLOGERIE_KV }, 200);

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
  const movLabel = type === 'automatic' ? 'automático' : type === 'quartz' ? 'cuarzo' : 'cuerda manual';

  /* ── PASS 1: Web search for real specs and prices ── */
  // Use Groq's built-in web_search tool to fetch real data from the internet
  const searchPrompt = `Search the web for the exact technical specifications and current market price of this watch: ${watchId} (${movLabel}).

Search for:
1. Official manufacturer specs: movement/caliber, crystal type, case material, water resistance, power reserve, dimensions, bracelet
2. Current retail price in EUR from authorized dealers or official website
3. Pre-owned/secondary market price in EUR from Chrono24, WatchBox, or similar

Use multiple searches if needed. Gather factual data only — do NOT invent or guess any specification.`;

  let webData = '';
  try {
    const searchRes = await callGroqWithTools(env, {
      model: MODEL_DETAILS,
      max_tokens: 2000,
      temperature: 0.1,
      tools: [{ type: 'function', function: {
        name: 'web_search',
        description: 'Search the web for current information',
        parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }
      }}],
      tool_choice: 'auto',
      messages: [{ role: 'user', content: searchPrompt }]
    });
    // Extract all text content from the response (tool results + final answer)
    webData = searchRes.choices?.[0]?.message?.content || '';
    // Also capture tool calls context if model returned search results inline
    if (!webData && searchRes.choices?.[0]?.message?.tool_calls) {
      webData = JSON.stringify(searchRes.choices[0].message.tool_calls);
    }
  } catch(e) {
    // Web search failed — fall through to knowledge-based pass
    console.warn('Web search pass failed:', e.message);
  }

  /* ── PASS 2: Structure the real data into JSON ── */
  const structurePrompt = `You are a watch data extractor. Based on the research below about "${watchId}", extract ONLY factual information found in the research.

RESEARCH DATA:
${webData || 'No web data available — use your training knowledge but mark uncertain values with "~".'}

Extract the data and respond ONLY with this JSON (no markdown, no backticks, no extra text):
{
  "specs": {
    "calibre":     "movement caliber name and number found in research, or empty string",
    "movimiento":  "movement type, frequency, jewels found in research, or empty string",
    "cristal":     "crystal type and profile found in research, or empty string",
    "brazalete":   "bracelet or strap type and material found in research, or empty string",
    "esfera":      "dial description found in research, or empty string",
    "caja":        "case material and features found in research, or empty string",
    "resistencia": "water resistance found in research, or empty string",
    "reserva":     "power reserve found in research, empty string if quartz or not found",
    "diametro":    "case diameter found in research, or empty string",
    "grosor":      "case thickness found in research, or empty string"
  },
  "price": {
    "value": "price range in EUR found in research (e.g. 'Nuevo: ~350 € · Segundamano: 180–250 €'), or empty string if not found",
    "note":  "source and context of the price data, max 1 sentence, or empty string"
  },
  "sources": "brief list of sources consulted (e.g. 'Amazon.es, Chrono24, marca oficial')"
}
CRITICAL: If a value was NOT found in the research, use empty string. Do not invent or estimate.`;

  const structRes = await callGroq(env, {
    model: MODEL_DETAILS,
    max_tokens: 800,
    temperature: 0,
    messages: [{ role: 'user', content: structurePrompt }]
  });

  const result = parseJSON(structRes.choices?.[0]?.message?.content || '{}');
  return corsResponse(result, 200);
}

/* ═══════════════════════════════════════════════════════
   KV SYNC — Cloud storage for watch collection
   Requires KV namespace bound as HORLOGERIE_KV.
   Single user: all data stored under key "watches_v2".

   Setup in Cloudflare dashboard:
     Workers & Pages → KV → Create namespace "HORLOGERIE"
     Workers → horlogerie → Settings → Bindings → Add KV
       Variable name: HORLOGERIE_KV  →  Namespace: HORLOGERIE
═══════════════════════════════════════════════════════ */

const KV_KEY = 'watches_v2';

async function handleSyncPush(request, env) {
  if (!env.HORLOGERIE_KV) {
    return corsResponse({ error: 'KV not configured. See README for setup instructions.' }, 503);
  }
  const body = await request.json();
  if (!body.watches || !Array.isArray(body.watches)) {
    return corsResponse({ error: 'Invalid payload: expected { watches: [...] }' }, 400);
  }
  const payload = {
    watches:   body.watches,
    updatedAt: Date.now(),
    version:   2,
  };
  await env.HORLOGERIE_KV.put(KV_KEY, JSON.stringify(payload));
  return corsResponse({ ok: true, count: body.watches.length, updatedAt: payload.updatedAt }, 200);
}

async function handleSyncPull(request, env) {
  if (!env.HORLOGERIE_KV) {
    return corsResponse({ error: 'KV not configured. See README for setup instructions.' }, 503);
  }
  const raw = await env.HORLOGERIE_KV.get(KV_KEY);
  if (!raw) return corsResponse({ watches: [], updatedAt: null }, 200);
  const data = JSON.parse(raw);
  return corsResponse(data, 200);
}

async function handleSyncClear(request, env) {
  if (!env.HORLOGERIE_KV) {
    return corsResponse({ error: 'KV not configured.' }, 503);
  }
  await env.HORLOGERIE_KV.delete(KV_KEY);
  return corsResponse({ ok: true }, 200);
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

// Groq compound-beta supports real web search via the compound model
async function callGroqWithTools(env, payload) {
  // Use the compound-beta model which has native web search built in
  const compoundPayload = {
    ...payload,
    model: 'compound-beta',   // Groq's agentic model with built-in web search
    tools: undefined,
    tool_choice: undefined,
  };
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${env.GROQ_API_KEY}`
    },
    body: JSON.stringify(compoundPayload)
  });
  if (!res.ok) {
    // compound-beta not available — fall back to standard model
    const err = await res.text();
    console.warn('compound-beta failed, falling back:', err.slice(0, 100));
    return callGroq(env, { ...payload, tools: undefined, tool_choice: undefined });
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
