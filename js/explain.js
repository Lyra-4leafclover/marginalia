import { generate } from './ai.js';
import { put } from './store.js';
import { findPaper, worksByIds, papersBundle, findBook, wikiMany, ytSearch, courseLink, googleSearch, exploreLinks } from './sources.js';

export const LEVELS = {
  simple: { label: 'Simple', hint: 'Like you\u2019re 14', prompt: 'a curious 14-year-old. Use everyday words and short sentences, add a quick analogy when it helps, and explain every technical word.' },
  student: { label: 'Student', hint: 'Clear, keeps key terms', prompt: 'a first-year university student. Be clear and precise, keep the important technical terms but explain them, and connect ideas to the bigger argument.' },
  expert: { label: 'Expert', hint: 'Dense & critical', prompt: 'a researcher from a neighbouring field. Be concise, focus on methods, assumptions, evidence and significance, and point out limitations or open questions.' },
};

const SYSTEM = `You are Marginalia, a warm, brilliant tutor who writes margin notes that explain academic papers and articles paragraph by paragraph.
Rules: explain only what the text actually says (plus brief background needed to understand it). Never invent results, numbers or citations.
Keep the authors' level of certainty: an association or correlation is not proof of cause, so say "is linked to" or "suggests" unless the study design (e.g. a randomised experiment) supports a causal claim.
Text may come from a PDF and be garbled (broken equations, table fragments, stray citation numbers); in that case say briefly what it most likely shows.
Write in the same language as the paper unless it is not English and the reader asked otherwise. Use plain text, you may use **bold** for one key idea.`;

const S = (type, extra = {}) => ({ type, ...extra });
const STR = S('STRING');
const ARR = items => S('ARRAY', { items });
const OBJ = (properties, required = Object.keys(properties)) => S('OBJECT', { properties, required });

const OVERVIEW_SCHEMA = OBJ({
  title: STR, authors: STR, field: STR, kind: STR,
  tldr: STR, problem: STR, approach: STR, findings: STR, why_it_matters: STR,
  search_queries: ARR(STR), concepts: ARR(STR),
});

const NOTES_SCHEMA = OBJ({
  notes: ARR(OBJ({
    id: STR, gist: STR, explanation: STR,
    terms: ARR(OBJ({ term: STR, meaning: STR })),
  }, ['id', 'gist', 'explanation'])),
});

const RES_SCHEMA = OBJ({
  concepts: ARR(OBJ({ name: STR, why: STR })),
  textbooks: ARR(OBJ({ title: STR, author: STR, why: STR })),
  courses: ARR(OBJ({ title: STR, provider: STR, why: STR })),
  videos: ARR(OBJ({ title: STR, creator: STR, why: STR })),
  next_steps: ARR(STR),
});

export function paragraphs(doc) { return doc.blocks.filter(b => b.type !== 'heading'); }

function outline(doc, max = 14000) {
  let s = '';
  for (const b of doc.blocks) {
    const line = b.type === 'heading' ? `\n## ${b.text}\n` : b.text + '\n';
    if (s.length + line.length > max) break;
    s += line;
  }
  const heads = doc.blocks.filter(b => b.type === 'heading').map(b => b.text).join(' | ');
  return { start: s, heads };
}

export async function makeOverview(doc, opts) {
  const { start, heads } = outline(doc);
  const prompt = `Read the beginning of this document and its section list, then fill in the overview for a reader who is ${LEVELS[doc.level].prompt}

Detected title: ${doc.title}
Section headings: ${heads || '(none detected)'}

--- DOCUMENT START ---
${start}
--- END ---

Fields: title (the real title), authors (short, e.g. "Smith et al., 2021" or "" if unknown), field (academic field), kind (e.g. research paper, review, news article, essay),
tldr (2 sentences), problem, approach, findings, why_it_matters (each 1\u20133 sentences),
search_queries (4 short scholarly search phrases, 2\u20135 words each, most specific first, in English),
concepts (6\u201310 core concepts or background topics someone should learn to really understand this, as short Wikipedia-style names).`;
  const { data } = await generate({ prompt, system: SYSTEM, schema: OVERVIEW_SCHEMA, ...opts });
  return data;
}

export function makeBatches(doc, maxChars = 26000, maxItems = 28) {
  const todo = [];
  let section = '';
  for (const b of doc.blocks) {
    if (b.type === 'heading') { section = b.text; continue; }
    if (!doc.notes[b.id]) todo.push({ ...b, section });
  }
  const batches = [];
  let cur = [], len = 0;
  for (const b of todo) {
    if (cur.length && (len + b.text.length > maxChars || cur.length >= maxItems)) { batches.push(cur); cur = []; len = 0; }
    cur.push(b); len += b.text.length;
  }
  if (cur.length) batches.push(cur);
  return batches;
}

async function explainBatch(doc, batch, opts) {
  const ov = doc.overview || {};
  const body = batch.map(b => `[${b.id}]${b.type === 'caption' ? ' (figure/table caption)' : ''}${b.section ? ` (section: ${b.section})` : ''}\n${b.text}`).join('\n\n');
  const prompt = `Document: "${ov.title || doc.title}"${ov.field ? ` (${ov.field})` : ''}
What it is about: ${ov.tldr || '(unknown)'}

Write a margin note for EACH paragraph below for a reader who is ${LEVELS[doc.level].prompt}
For each paragraph return: id (exactly as given in brackets), gist (max 10 words, the paragraph's point), explanation (${doc.level === 'expert' ? '2\u20134' : '3\u20136'} sentences explaining what it says and why it matters to the argument), terms (0\u20133 jargon words FROM that paragraph with a one-sentence meaning; skip common words).

${body}`;
  const { data } = await generate({ prompt, system: SYSTEM, schema: NOTES_SCHEMA, ...opts });
  const ids = new Set(batch.map(b => b.id));
  const out = {};
  for (const n of data.notes || []) if (ids.has(n.id) && n.explanation) out[n.id] = { gist: n.gist || '', explanation: n.explanation, terms: (n.terms || []).filter(t => t.term && t.meaning).slice(0, 4) };
  return out;
}

export async function reexplain(doc, block, mode, opts) {
  const ov = doc.overview || {};
  const how = mode === 'simpler'
    ? `Explain it again much more simply, for a 12-year-old, with one everyday analogy. 3\u20135 short sentences.`
    : `Explain it in more depth for ${LEVELS[doc.level].prompt} Include background the paragraph assumes. 5\u20138 sentences.`;
  const prompt = `Document: "${ov.title || doc.title}". ${ov.tldr || ''}\n\nParagraph:\n${block.text}\n\n${how}\nReturn id "${block.id}", gist, explanation and terms.`;
  const { data } = await generate({ prompt, system: SYSTEM, schema: NOTES_SCHEMA, ...opts });
  const n = (data.notes || [])[0];
  if (!n) throw new Error('No answer came back.');
  return { gist: n.gist || '', explanation: n.explanation, terms: n.terms || [] };
}

export async function ask(doc, block, question, opts) {
  const ov = doc.overview || {};
  const prompt = `Document: "${ov.title || doc.title}". ${ov.tldr || ''}\n\nParagraph the reader is looking at:\n${block.text}\n\nReader's question: ${question}\n\nAnswer warmly and clearly in under 150 words for ${LEVELS[doc.level].prompt} If the paper doesn't say, say so and give general background.`;
  const { text } = await generate({ prompt, system: SYSTEM, temperature: 0.5, ...opts });
  return text.trim();
}

async function aiResources(topicTitle, ov, opts) {
  const prompt = `Someone just read "${topicTitle}" (${ov.field || 'academic'}). Summary: ${ov.tldr || ''}
Key concepts: ${(ov.concepts || []).join(', ')}

Recommend genuinely excellent, well-known learning resources to understand this topic deeply. Only recommend things you are confident really exist (famous textbooks, well-known courses and channels). Do not invent URLs.
concepts: 6\u201310 background concepts {name (Wikipedia article title), why (one sentence)}.
textbooks: 4\u20136 real books {title, author, why}.
courses: 3\u20135 real courses {title, provider (e.g. Coursera, edX, MIT OpenCourseWare, Khan Academy, YouTube), why}.
videos: 4\u20136 videos or playlists {title (what to search for), creator (channel or speaker), why}.
next_steps: 3\u20135 short suggestions of what to learn or read next.`;
  const { data } = await generate({ prompt, schema: RES_SCHEMA, temperature: 0.3, ...opts });
  return data;
}

export async function groundedWebsites(topic, opts) {
  try {
    const prompt = `Find 6\u20138 of the best free websites, tutorials, interactive explainers or articles for learning about: ${topic}.
Use Google Search. Prefer universities, reputable organisations, well-known educational sites and high-quality blogs.
Reply ONLY with JSON: {"websites":[{"name":"...","url":"https://...","why":"one sentence"}]}`;
    const { data, grounding } = await generate({ prompt, grounded: true, json: true, temperature: 0.2, ...opts });
    const domains = new Set((grounding?.groundingChunks || []).map(c => (c.web?.title || '').toLowerCase().replace(/^www\./, '')).filter(Boolean));
    return (data.websites || []).map(w => {
      let host = '';
      try { host = new URL(w.url).hostname.replace(/^www\./, '').toLowerCase(); } catch {}
      const verified = host && [...domains].some(d => host === d || host.endsWith('.' + d) || d.endsWith('.' + host));
      return { kind: 'web', name: w.name, why: w.why, url: verified ? w.url : googleSearch(`${w.name} ${topic}`), verified, host };
    }).filter(w => w.name);
  } catch (e) {
    if (e.name === 'AbortError') throw e;
    return [];
  }
}

export async function buildResources({ title, overview, ai = true, opts = {} }) {
  const ov = overview || {};
  const queries = (ov.search_queries && ov.search_queries.length ? ov.search_queries : [title]).filter(Boolean);
  const [paperHit, bundle, aiRes, websites] = await Promise.all([
    findPaper(ov.title || title).catch(() => null),
    papersBundle(queries).catch(() => ({ foundational: [], reviews: [], recent: [], preprints: [] })),
    ai ? aiResources(ov.title || title, ov, opts).catch(e => { if (e.name === 'AbortError') throw e; return null; }) : Promise.resolve(ov._resources || null),
    ai ? groundedWebsites(ov.title || title, opts) : Promise.resolve([]),
  ]);
  let related = [], cited = [];
  if (paperHit) {
    [related, cited] = await Promise.all([
      worksByIds(paperHit.related, { perPage: 10 }).catch(() => []),
      worksByIds(paperHit.referenced, { perPage: 8 }).catch(() => []),
    ]);
  }
  const r = aiRes || {};
  const conceptNames = (r.concepts?.length ? r.concepts.map(c => c.name) : ov.concepts || []).slice(0, 10);
  const [wikis, bookHits] = await Promise.all([
    wikiMany(conceptNames).catch(() => []),
    Promise.all((r.textbooks || []).slice(0, 6).map(async b => {
      const hit = await findBook(b.title, b.author);
      return hit ? { ...hit, why: b.why } : { kind: 'book', title: b.title, authors: [b.author], why: b.why, url: googleSearch(`${b.title} ${b.author} book`), unverified: true };
    })),
  ]);
  const why = Object.fromEntries((r.concepts || []).map(c => [c.name.toLowerCase(), c.why]));
  return {
    built: Date.now(),
    paper: paperHit?.work || null,
    related, cited,
    foundational: bundle.foundational, reviews: bundle.reviews, recent: bundle.recent, preprints: bundle.preprints,
    wiki: wikis.map(w => ({ ...w, why: why[w.title.toLowerCase()] || '' })),
    books: bookHits,
    courses: (r.courses || []).map(c => ({ kind: 'course', ...c, url: courseLink(c.provider, c.title) })),
    videos: (r.videos || []).map(v => ({ kind: 'video', ...v, url: ytSearch(`${v.title} ${v.creator || ''}`.trim()) })),
    websites,
    papersFailed: !!bundle.failed,
    next_steps: r.next_steps || [],
    explore: exploreLinks(queries[0]),
  };
}

// ---- job runner (survives navigation inside the app) ----
const jobs = new Map();
export const jobFor = id => jobs.get(id);

export function startExplain(doc, listener) {
  if (jobs.has(doc.id)) { jobs.get(doc.id).listeners.add(listener); return jobs.get(doc.id); }
  const ctrl = new AbortController();
  const job = { listeners: new Set([listener]), ctrl, status: 'running', message: '' };
  jobs.set(doc.id, job);
  const emit = (evt) => job.listeners.forEach(l => l(evt));
  const opts = { signal: ctrl.signal, onWait: (ms) => emit({ type: 'wait', ms }) };

  (async () => {
    try {
      doc.error = '';
      if (!doc.overview) {
        emit({ type: 'stage', text: 'Reading the whole thing first\u2026' });
        doc.overview = await makeOverview(doc, opts);
        if (doc.overview.title && doc.overview.title.length > 4) doc.title = doc.overview.title;
        doc.updated = Date.now(); await put('docs', doc);
        emit({ type: 'overview' });
      }
      const batches = makeBatches(doc);
      const total = paragraphs(doc).length;
      let i = 0;
      const worker = async () => {
        while (i < batches.length) {
          const batch = batches[i++];
          emit({ type: 'pending', ids: batch.map(b => b.id) });
          const notes = await explainBatch(doc, batch, opts);
          Object.assign(doc.notes, notes);
          const missing = batch.filter(b => !notes[b.id]);
          if (missing.length && missing.length < batch.length) {
            Object.assign(doc.notes, await explainBatch(doc, missing, opts).catch(() => ({})));
          }
          doc.updated = Date.now(); await put('docs', doc);
          emit({ type: 'notes', ids: batch.map(b => b.id), done: Object.keys(doc.notes).length, total });
        }
      };
      emit({ type: 'stage', text: 'Writing margin notes\u2026' });
      await worker();
      if (!doc.resources) {
        emit({ type: 'stage', text: 'Gathering the best resources\u2026' });
        doc.resources = await buildResources({ title: doc.title, overview: doc.overview, opts });
        doc.updated = Date.now(); await put('docs', doc);
        emit({ type: 'resources' });
      }
      doc.status = 'done';
      await put('docs', doc);
      job.status = 'done';
      emit({ type: 'done' });
    } catch (e) {
      job.status = 'error';
      if (e.name === 'AbortError') { emit({ type: 'stopped' }); }
      else {
        doc.error = e.message || String(e);
        await put('docs', doc).catch(() => {});
        emit({ type: 'error', error: doc.error });
      }
    } finally {
      jobs.delete(doc.id);
    }
  })();
  return job;
}
