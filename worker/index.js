/**
 * Cloudflare Worker — Horlogerie API
 *
 * Routes:
 *   POST /identify  — Identify a watch from a photo (Groq LLaMA 4 Scout Vision)
 *   POST /details   — Fetch full specs + price (Groq LLaMA 4 Scout + web search via Groq)
 *
 * Environment variables (set in Cloudflare dashboard → Workers → Settings → Variables):
 *   GROQ_API_KEY     — Your Groq API key (console.groq.com)
 *   ALLOWED_ORIGIN   — Your GitHub Pages URL, e.g. https://yourusername.github.io
 */

export default {
  async fetch(request, env) {
    // CORS preflight
    if (request.method === 'OPTIONS') {
      return corsResponse(null, 204, env);
    }

    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';

    // Only allow requests from your GitHub Pages domain (or localhost for dev)
    const allowed = env.ALLOWED_ORIGIN || '';
    if (allowed && origin !== allowed && !origin.includes('localhost')) {
      return corsResponse({ error: 'Origin not allowed' }, 403, env);
    }

    try {
      if (url.pathname === '/identify' && request.method === 'POST') {
        return await handleIdentify(request, env);
      }
      if (url.pathname === '/details' && request.method === 'POST') {
        return await handleDetails(request, env);
      }
      return corsResponse({ error: 'Not found' }, 404, env);
    } catch (e) {
      return corsResponse({ error: e.message }, 500, env);
    }
  }
};

/* ─────────────────────────────────────────
   /identify — Vision: who made this watch?
───────────────────────────────────────── */
async function handleIdentify(request, env) {
  const body = await request.json();
  const { image, mediaType } = body;

  if (!image) return corsResponse({ error: 'Missing image' }, 400, env);

  const prompt = `You are a luxury watch expert. Look at this watch photo carefully.
Identify the watch and respond ONLY with a valid JSON object — no markdown, no backticks, no preamble:
{
  "brand": "brand name",
  "model": "model name",
  "ref": "reference number if visible, or empty string",
  "type": "automatic|quartz|manual",
  "confidence": "high|medium|low"
}
If you cannot identify it at all, use brand="Unknown" and model="Watch".`;

  const groqRes = await callGroq(env.GROQ_API_KEY, {
    model: 'meta-llama/llama-4-scout-17b-16e-instruct',
    max_tokens: 256,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: { url: `data:${mediaType};base64,${image}` }
          },
          { type: 'text', text: prompt }
        ]
      }
    ]
  });

  const text = groqRes.choices?.[0]?.message?.content || '{}';
  const json = parseJSON(text);
  return corsResponse(json, 200, env);
}

/* ─────────────────────────────────────────
   /details — Specs + price for a watch
───────────────────────────────────────── */
async function handleDetails(request, env) {
  const body = await request.json();
  const { brand, model, ref, type } = body;

  if (!brand || !model) return corsResponse({ error: 'Missing brand or model' }, 400, env);

  const watchId = [brand, model, ref].filter(Boolean).join(' ');
  const typeLabel = type === 'automatic' ? 'automatic' : type === 'quartz' ? 'quartz' : 'manual winding';

  const prompt = `You are a professional watch expert and horologist with access to current market data.
Research the watch: ${watchId} (${typeLabel} movement).

Return ONLY a valid JSON object with NO markdown, NO backticks, NO extra text:
{
  "specs": {
    "calibre": "movement/caliber name and number",
    "movimiento": "movement type description (e.g. Swiss lever escapement, 28800vph)",
    "cristal": "crystal type (sapphire/mineral/acrylic) and shape (flat/domed/double-domed)",
    "brazalete": "bracelet or strap type and material",
    "esfera": "dial description (color, indexes, complications)",
    "caja": "case material and shape",
    "resistencia": "water resistance in meters and ATM",
    "reserva": "power reserve in hours (for automatic/manual only, empty for quartz)",
    "diametro": "case diameter in mm",
    "grosor": "case thickness in mm"
  },
  "price": {
    "value": "price range in EUR (e.g. '3.500 – 4.200 €') or 'N/A'",
    "note": "brief note about price (new retail vs pre-owned, trend, year)"
  }
}
Be precise. If you don't know a specific value, use an empty string — do not guess.`;

  const groqRes = await callGroq(env.GROQ_API_KEY, {
    model: 'meta-llama/llama-4-scout-17b-16e-instruct',
    max_tokens: 800,
    messages: [
      { role: 'user', content: prompt }
    ]
  });

  const text = groqRes.choices?.[0]?.message?.content || '{}';
  const json = parseJSON(text);
  return corsResponse(json, 200, env);
}

/* ─────────────────────────────────────────
   Helpers
───────────────────────────────────────── */

async function callGroq(apiKey, payload) {
  if (!apiKey) throw new Error('GROQ_API_KEY not set in Worker environment');
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(payload)
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq error ${res.status}: ${err.slice(0, 200)}`);
  }
  return res.json();
}

function parseJSON(text) {
  // Strip markdown fences if model adds them
  const clean = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  try {
    return JSON.parse(clean);
  } catch {
    // Try to extract first {...} block
    const match = clean.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch {}
    }
    return { error: 'Could not parse response', raw: clean.slice(0, 300) };
  }
}

function corsResponse(data, status, env) {
  const origin = env?.ALLOWED_ORIGIN || '*';
  const headers = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  return new Response(data === null ? '' : JSON.stringify(data), { status, headers });
}
