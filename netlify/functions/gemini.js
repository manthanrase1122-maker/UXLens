exports.handler = async function(event) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  const keys = String(process.env.GEMINI_API_KEYS || process.env.GEMINI_API_KEY || '')
    .split(',')
    .map(k => k.trim())
    .filter(Boolean);

  if (!keys.length) {
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        ok: false,
        error: 'Missing GEMINI_API_KEY. Add it in Netlify → Site configuration → Environment variables. Scope must include Functions.'
      })
    };
  }

  const defaultModels = [
    process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-1.5-flash'
  ].filter((model, index, arr) => model && arr.indexOf(model) === index);

  let payload = {};
  if (event.httpMethod === 'GET') {
    payload = { type: 'status', prompt: 'Return only OK.', maxTokens: 8, temperature: 0 };
  } else {
    try {
      payload = JSON.parse(event.body || '{}');
    } catch (e) {
      return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'Invalid JSON body.' }) };
    }
  }

  const type = payload.type || 'text';
  const prompt = String(payload.prompt || '').trim();
  const maxTokens = Math.min(Math.max(Number(payload.maxTokens) || 1500, 1), 8192);
  const temperature = Number.isFinite(Number(payload.temperature)) ? Number(payload.temperature) : 0.4;
  const topP = Number.isFinite(Number(payload.topP)) ? Number(payload.topP) : 0.9;

  if (!prompt) {
    return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'Missing prompt.' }) };
  }

  const parts = [{ text: prompt }];
  if (type === 'vision') {
    const imageBase64 = String(payload.imageBase64 || '').replace(/^data:image\/\w+;base64,/, '');
    if (!imageBase64) {
      return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: 'Missing imageBase64 for vision request.' }) };
    }
    parts.push({ inline_data: { mime_type: payload.mimeType || 'image/jpeg', data: imageBase64 } });
  }

  const requestBody = {
    contents: [{ parts }],
    generationConfig: { maxOutputTokens: maxTokens, temperature, topP }
  };

  let lastError = null;

  for (const key of keys) {
    for (const model of defaultModels) {
      try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody)
        });

        const data = await response.json().catch(() => ({}));

        if (response.ok) {
          const text = data?.candidates?.[0]?.content?.parts?.map(p => p.text || '').join('') || '';
          return {
            statusCode: 200,
            headers,
            body: JSON.stringify({
              ok: true,
              text,
              model,
              usageMetadata: data.usageMetadata || null
            })
          };
        }

        const message = data?.error?.message || `Gemini API error ${response.status}`;
        lastError = { status: response.status, message, details: data, model };

        if (response.status === 404 || /not found/i.test(message)) {
          continue;
        }

        if (response.status === 429 || /quota|rate.?limit|resource_exhausted|free_tier/i.test(message)) {
          break;
        }

        break;
      } catch (e) {
        lastError = { status: 500, message: e.message || 'Gemini request failed.', model };
        break;
      }
    }
  }

  const statusCode = lastError?.status && lastError.status >= 400 ? lastError.status : 500;
  const retryMatch = String(lastError?.message || '').match(/retry in\s+([\d.]+)s/i);
  const retryMs = retryMatch ? Math.ceil(Number(retryMatch[1]) * 1000) : undefined;

  return {
    statusCode,
    headers,
    body: JSON.stringify({
      ok: false,
      error: lastError?.message || 'Gemini API request failed.',
      model: lastError?.model,
      retryMs
    })
  };
};
