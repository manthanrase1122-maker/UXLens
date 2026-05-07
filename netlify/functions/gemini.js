const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const FALLBACK_MODELS = [DEFAULT_MODEL, 'gemini-2.0-flash', 'gemini-1.5-flash'].filter((v, i, a) => v && a.indexOf(v) === i);

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
    },
    body: JSON.stringify(body)
  };
}

function getKeys() {
  const keys = [];
  if (process.env.GEMINI_API_KEYS) {
    process.env.GEMINI_API_KEYS.split(',').map(v => v.trim()).filter(Boolean).forEach(k => keys.push(k));
  }
  if (process.env.GEMINI_API_KEY) keys.push(process.env.GEMINI_API_KEY.trim());
  return [...new Set(keys.filter(Boolean))];
}

function parseRetryMs(message) {
  const m = String(message || '').match(/retry[^\d]*([\d.]+)s/i);
  return m ? Math.ceil(Number(m[1]) * 1000) : 60000;
}

function isQuota(status, message) {
  return Number(status) === 429 || /quota|rate.?limit|resource_exhausted|free_tier|exhausted/i.test(String(message || ''));
}

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') return json(204, { ok: true });

  const keys = getKeys();
  if (!keys.length) return json(500, { ok: false, error: 'Missing GEMINI_API_KEY Netlify environment variable.' });

  if (event.httpMethod === 'GET') {
    return json(200, { ok: true, message: 'Gemini Netlify function is reachable.', model: DEFAULT_MODEL, keysConfigured: keys.length });
  }

  if (event.httpMethod !== 'POST') return json(405, { ok: false, error: 'Method not allowed.' });

  let input;
  try { input = JSON.parse(event.body || '{}'); }
  catch (e) { return json(400, { ok: false, error: 'Invalid JSON body.' }); }

  const type = input.type || 'text';
  const prompt = String(input.prompt || '').trim();
  if (!prompt) return json(400, { ok: false, error: 'Missing prompt.' });

  const maxTokens = Number(input.maxTokens || 1500);
  const temperature = Number(input.temperature ?? 0.4);
  const topP = Number(input.topP ?? 0.9);

  const parts = [{ text: prompt }];
  if (type === 'vision') {
    const imageBase64 = String(input.imageBase64 || '').replace(/^data:image\/\w+;base64,/, '');
    if (!imageBase64) return json(400, { ok: false, error: 'Missing imageBase64 for vision request.' });
    parts.push({ inline_data: { mime_type: 'image/jpeg', data: imageBase64 } });
  }

  const body = {
    contents: [{ parts }],
    generationConfig: { maxOutputTokens: maxTokens, temperature, topP }
  };

  let lastError = null;
  for (const key of keys) {
    for (const model of FALLBACK_MODELS) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        const data = await resp.json().catch(() => ({}));
        if (resp.ok) {
          const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('\n').trim() || '';
          return json(200, { ok: true, text, model, usageMetadata: data.usageMetadata || null });
        }
        const msg = data?.error?.message || `HTTP ${resp.status}`;
        lastError = { status: resp.status, message: msg };
        if (resp.status === 404 || /not found|invalid model/i.test(msg)) continue;
        if (isQuota(resp.status, msg)) break;
        if (resp.status === 400 || resp.status === 403) break;
      } catch (e) {
        lastError = { status: 500, message: e.message || 'Gemini request failed.' };
        break;
      }
    }
  }

  const status = lastError?.status || 500;
  const message = lastError?.message || 'Gemini request failed.';
  return json(isQuota(status, message) ? 429 : status, {
    ok: false,
    error: message,
    retryMs: parseRetryMs(message)
  });
};
