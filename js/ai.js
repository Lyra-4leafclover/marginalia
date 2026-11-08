import { getSettings, saveSettings } from './store.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const PREFERRED = ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3-flash-preview', 'gemini-2.5-flash'];
const BACKUPS = ['gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3-flash-preview', 'gemini-3.5-flash-lite', 'gemini-flash-lite-latest', 'gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-flash-latest'];
// the *-latest alias was often overloaded or out of quota; only use it when picked by hand
const UNRELIABLE = /^gemini-flash-latest$/;
const TIMEOUT = 90000;
let active = '';

// free keys get a small daily allowance per model; remember which ones ran out today (resets midnight Pacific)
const EX_KEY = 'marginalia.exhausted.v1';
const quotaDay = () => new Date(Date.now() - 8 * 3600e3).toISOString().slice(0, 10);
function exhausted() {
  try { const e = JSON.parse(localStorage.getItem(EX_KEY) || '{}'); return e.day === quotaDay() ? e : { day: quotaDay(), models: [] }; }
  catch { return { day: quotaDay(), models: [] }; }
}
function markExhausted(model) {
  const e = exhausted();
  if (!e.models.includes(model)) e.models.push(model);
  localStorage.setItem(EX_KEY, JSON.stringify(e));
}

// the chosen model first, then other fast models this key can use, so a busy or retired model doesn't stop the app
function modelChain() {
  const s = getSettings();
  const avail = s.models?.length ? s.models : BACKUPS;
  const chosen = s.model && !(UNRELIABLE.test(s.model) && !s.modelPicked) ? s.model : pickDefaultModel(avail);
  const first = active && avail.includes(active) ? active : chosen;
  const out = exhausted().models;
  return [...new Set([first, chosen, ...BACKUPS.filter(m => avail.includes(m))].filter(Boolean))].filter(m => !out.includes(m));
}

export class AIError extends Error {
  constructor(message, code) { super(message); this.code = code; }
}

export function hasKey() { return !!getSettings().geminiKey; }

export async function listModels(key) {
  const res = await fetch(`${BASE}/models?pageSize=200`, { headers: { 'x-goog-api-key': key } });
  if (!res.ok) throw await toError(res);
  const data = await res.json();
  return (data.models || [])
    .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map(m => m.name.replace(/^models\//, ''))
    .filter(n => /^gemini/.test(n) && !/(embedding|tts|image|live|audio|vision|robotics|computer|native)/.test(n));
}

export function pickDefaultModel(models) {
  for (const p of PREFERRED) if (models.includes(p)) return p;
  const flash = models.filter(m => /flash/.test(m) && !/lite|exp|preview|thinking|8b/.test(m));
  flash.sort((a, b) => versionOf(b) - versionOf(a));
  return flash[0] || models[0] || 'gemini-2.5-flash';
}
const versionOf = n => parseFloat((n.match(/gemini-(\d+(?:\.\d+)?)/) || [0, 0])[1]);

async function toError(res) {
  let msg = `${res.status}`;
  let retry = 0, daily = false;
  try {
    const j = await res.json();
    msg = j.error?.message || msg;
    for (const d of j.error?.details || []) {
      if (d['@type']?.includes('RetryInfo') && d.retryDelay) retry = parseFloat(d.retryDelay) * 1000;
      for (const v of d.violations || []) if (/PerDay/i.test(v.quotaId || '')) daily = true;
    }
    if (/per day|PerDay/i.test(msg)) daily = true;
  } catch {}
  const e = new AIError(friendly(res.status, msg), res.status);
  e.retryAfter = retry;
  e.daily = daily;
  e.raw = msg;
  return e;
}

function friendly(status, msg) {
  if (status === 400 && /API key not valid|API_KEY_INVALID/i.test(msg)) return 'That Gemini key doesn\u2019t look right. Open Settings and paste it again.';
  if (status === 403) return 'Google refused the key (403). Make sure it\u2019s a Gemini API key from aistudio.google.com.';
  if (status === 429) return 'The free Gemini limit was reached for now. Wait a minute and press Continue.';
  if (status === 404) return 'That AI model isn\u2019t available for your key. Pick another model in Settings.';
  if (status >= 500) return 'Google\u2019s AI is busy right now. Try again in a moment.';
  return msg;
}

function dailyError() {
  return new AIError('You\u2019ve used today\u2019s free Gemini requests on every available model (Google allows about 20 per model per day). They reset at midnight Pacific time (about 1:30 pm in India). Everything so far is saved: come back then and press Continue.', 'daily');
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function generate({ prompt, system, schema, json = !!schema, grounded = false, temperature = 0.4, signal, onWait }) {
  const s = getSettings();
  if (!s.geminiKey) throw new AIError('Add your free Gemini key in Settings to use AI features.', 'nokey');
  const chain = modelChain();
  if (!chain.length) throw dailyError();
  let mi = 0, hops = 0;
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature },
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  if (json && !grounded) {
    body.generationConfig.responseMimeType = 'application/json';
    if (schema) body.generationConfig.responseSchema = schema;
  }
  if (grounded) body.tools = [{ google_search: {} }];

  let attempt = 0;
  for (;;) {
    let res;
    const model = chain[mi];
    const v = parseFloat((model.match(/gemini-(\d+(?:\.\d+)?)/) || [0, 0])[1]);
    if (v >= 3) body.generationConfig.thinkingConfig = { thinkingLevel: 'low' }; else delete body.generationConfig.thinkingConfig;
    const ctl = new AbortController();
    const onAbort = () => ctl.abort();
    signal?.addEventListener('abort', onAbort);
    const timer = setTimeout(() => ctl.abort(), TIMEOUT);
    try {
      res = await fetch(`${BASE}/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST', signal: ctl.signal,
        headers: { 'content-type': 'application/json', 'x-goog-api-key': s.geminiKey },
        body: JSON.stringify(body),
      });
    } catch (err) {
      if (signal?.aborted) throw err;
      if (mi < chain.length - 1) { mi++; continue; }
      if (attempt++ < 3) { mi = 0; await sleep(1500 * attempt); continue; }
      throw new AIError('Couldn\u2019t reach Google\u2019s AI. Check your internet connection.', 'network');
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); }
    if (res.ok) {
      const data = await res.json();
      const cand = data.candidates?.[0];
      const text = (cand?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('');
      if (!text) {
        const why = data.promptFeedback?.blockReason || cand?.finishReason || 'empty';
        if (attempt++ < 2) { await sleep(1200); continue; }
        throw new AIError(`The AI returned nothing (${why}).`, 'empty');
      }
      active = model;
      const out = { text, grounding: cand.groundingMetadata, model };
      if (json) {
        try { out.data = parseJSON(text); }
        catch (e) {
          if (attempt++ < 2) continue;
          throw new AIError('The AI answer came back garbled. Try again.', 'parse');
        }
      }
      return out;
    }
    const err = await toError(res);
    const retriable = err.code === 429 || err.code >= 500;
    // busy or retired model: try another one; rate limit: try one other model, then wait it out
    if ((err.code >= 500 || err.code === 404) && mi < chain.length - 1) { mi++; continue; }
    if (err.code === 429 && err.daily) {
      markExhausted(model);
      if (mi < chain.length - 1) { mi++; continue; }
      throw dailyError();
    }
    if (err.code === 429 && hops < 1 && mi < chain.length - 1) { hops++; mi++; continue; }
    if (retriable && attempt < 8) {
      hops = 0; mi = 0;
      const wait = Math.max(err.retryAfter || 0, err.code === 429 ? 15000 : 3000 * 2 ** Math.min(attempt, 3)) + Math.random() * 800;
      attempt++;
      onWait?.(wait, err);
      await sleep(Math.min(wait, 65000));
      continue;
    }
    throw err;
  }
}

export function parseJSON(text) {
  let t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try { return JSON.parse(t); } catch {}
  const start = t.search(/[\[{]/);
  const end = Math.max(t.lastIndexOf('}'), t.lastIndexOf(']'));
  if (start >= 0 && end > start) return JSON.parse(t.slice(start, end + 1));
  throw new Error('no json');
}

export async function verifyKey(key) {
  const models = await listModels(key);
  if (!models.length) throw new AIError('Key works, but no Gemini text models are available for it.', 'nomodels');
  const s = getSettings();
  const model = s.model && models.includes(s.model) && (s.modelPicked || !UNRELIABLE.test(s.model)) ? s.model : pickDefaultModel(models);
  saveSettings({ geminiKey: key, model, models });
  return { models, model };
}
