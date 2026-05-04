# UXLens-AI Netlify Final Upload

This package keeps the uploaded UXLens HTML UI intact, but moves Gemini API calls behind a Netlify Function so the API key is not exposed in browser JavaScript.

## Required Netlify setting

In Netlify, open your site → Site configuration → Environment variables → Add variable:

- Key: `GEMINI_API_KEY`
- Value: your Google AI Studio Gemini API key
- Scope: must include `Functions`

Optional:

- `GEMINI_API_KEYS` = comma-separated keys if you want fallback keys.
- `GEMINI_MODEL` = `gemini-2.5-flash` or another available Gemini model.

## Upload

Drag the contents of this folder to Netlify Deploys, or push the folder to GitHub and connect it to Netlify.

Do not deploy this only on GitHub Pages if you need Gemini API calls. GitHub Pages is static and cannot safely hide API keys or run the serverless function.
