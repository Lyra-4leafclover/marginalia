import { $, $$, esc, link, toast, download, copy, fmtDate, plural, truncate, md } from './util.js';
import { getSettings, saveSettings, put, get, del, all, uid } from './store.js';
import { hasKey, verifyKey } from './ai.js';
import * as ingest from './ingest.js';
import { LEVELS, startExplain, jobFor, paragraphs, reexplain, ask, buildResources } from './explain.js';
import { runCompass } from './compass.js';
import { readerResources, compassResources, bindResources, readingListMarkdown } from './resview.js';
import { sampleDoc } from './sample.js';
import { CONTACT } from './config.js';

const view = $('#view');
let teardown = [];
const onLeave = fn => teardown.push(fn);

// ---------- theme & chrome ----------
function applyTheme() {
  const t = getSettings().theme;
  const dark = t === 'midnight' || (t === 'auto' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'midnight' : 'parchment';
  $('meta[name="theme-color"]').content = dark ? '#121530' : '#f6efe2';
}
$('#themeBtn').addEventListener('click', () => {
  saveSettings({ theme: document.documentElement.dataset.theme === 'midnight' ? 'parchment' : 'midnight' });
  applyTheme();
  if (location.hash.startsWith('#/settings')) route();
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);
$('#contact').innerHTML = CONTACT.map(c => link(c.url, c.label)).join('');

function chrome(name) {
  $$('#nav a').forEach(a => a.classList.toggle('on', a.dataset.nav === name));
  const dot = $('#keyDot');
  dot.className = 'dot ' + (hasKey() ? 'ok' : 'warn');
  dot.title = hasKey() ? 'AI key connected' : 'Add your free AI key';
}

const keyNotice = (what = 'explain papers') => `<div class="notice key-notice">
  <img src="art/card-compass.webp" alt="" class="notice-art">
  <div><strong>One quick setup step</strong><p>To ${what}, Marginalia needs a free Google Gemini key. It takes about a minute and costs nothing.</p>
  <a class="btn primary small" href="#/settings">Set up my free key</a></div></div>`;

// ---------- router ----------
const ROUTES = [
  [/^\/?$/, viewHome, ''],
  [/^\/explain$/, viewExplain, 'explain'],
  [/^\/read\/(.+)$/, viewReader, 'explain'],
  [/^\/sample$/, () => viewReader('sample'), 'explain'],
  [/^\/compass$/, viewCompass, 'compass'],
  [/^\/compass\/(.+)$/, viewProject, 'compass'],
  [/^\/library$/, viewLibrary, 'library'],
  [/^\/settings$/, viewSettings, 'settings'],
];

async function route() {
  teardown.forEach(fn => { try { fn(); } catch {} });
  teardown = [];
  const raw = location.hash.slice(1) || '/';
  const [path, qs] = raw.split('?');
  const q = Object.fromEntries(new URLSearchParams(qs || ''));
  for (const [re, fn, nav] of ROUTES) {
    const m = path.match(re);
    if (m) {
      chrome(nav);
      view.classList.remove('enter'); void view.offsetWidth; view.classList.add('enter');
      try { await fn(m[1] ? decodeURIComponent(m[1]) : q, q); }
      catch (e) { console.error(e); view.innerHTML = `<section class="page narrow"><h1 class="page-title">Something went wrong</h1><p class="notice">${esc(e.message)}</p><a class="btn" href="#/">Go home</a></section>`; }
      window.scrollTo({ top: 0 });
      return;
    }
  }
  location.hash = '#/';
}
window.addEventListener('hashchange', route);

// ---------- home ----------
async function viewHome() {
  const [docs, projects] = await Promise.all([all('docs').catch(() => []), all('projects').catch(() => [])]);
  const recent = [...docs.map(d => ({ ...d, _k: 'doc' })), ...projects.map(p => ({ ...p, _k: 'proj' }))]
    .sort((a, b) => b.updated - a.updated).slice(0, 4);
  view.innerHTML = `
  <section class="hero">
    <div class="hero-art" aria-hidden="true">
      <img class="art-day" src="art/hero-day.webp" srcset="art/hero-day-sm.webp 900w, art/hero-day.webp 1600w" sizes="100vw" alt="">
      <img class="art-night" src="art/hero-night.webp" srcset="art/hero-night-sm.webp 900w, art/hero-night.webp 1600w" sizes="100vw" alt="">
    </div>
    <div class="hero-copy">
      <p class="eyebrow">A reading companion for curious minds</p>
      <h1>Every paragraph,<br><em>explained in the margins.</em></h1>
      <p class="lede">Drop in a research paper, journal article or any article. Marginalia writes a friendly note beside every paragraph, then hands you the best books, courses, videos and papers to truly learn the topic.</p>
      <div class="cta">
        <a class="btn primary big" href="#/explain">Explain a paper</a>
        <a class="btn ghost big" href="#/compass">Research my own topic</a>
      </div>
      <a class="sample-link" href="#/sample">or peek at a sample explanation &rarr;</a>
    </div>
  </section>

  <section class="duo">
    <a class="duo-card" href="#/explain">
      <img src="art/card-explain.webp" alt="" loading="lazy">
      <div><p class="eyebrow">Paper Explainer</p><h2>Understand anything you read</h2>
      <p>PDFs, Word files, links or pasted text. Pick Simple, Student or Expert notes, ask questions about any paragraph, and get a glossary and resource list at the end.</p>
      <span class="arrow">Start reading &rarr;</span></div>
    </a>
    <a class="duo-card" href="#/compass">
      <img src="art/card-compass.webp" alt="" loading="lazy">
      <div><p class="eyebrow">Research Compass</p><h2>Find everything for your own paper</h2>
      <p>Give it your title. It finds existing papers, ongoing studies, books, encyclopedias, videos and websites, then suggests research questions, fresh angles and an outline.</p>
      <span class="arrow">Plot a course &rarr;</span></div>
    </a>
  </section>

  <section class="how">
    <h2 class="section-title">How it works</h2>
    <ol class="how-steps">
      <li><span class="num">i.</span><h3>Bring a paper</h3><p>Upload a file, paste a link or DOI, or paste text. It stays in your browser.</p></li>
      <li><span class="num">ii.</span><h3>Read with notes</h3><p>Each paragraph gets a margin note, key terms and a one-line gist, written for your level.</p></li>
      <li><span class="num">iii.</span><h3>Keep learning</h3><p>Real, checked resources: related papers, books, courses, videos and websites.</p></li>
    </ol>
  </section>

  ${recent.length ? `<section class="recent"><h2 class="section-title">Pick up where you left off</h2><div class="lib-grid">${recent.map(libCard).join('')}</div></section>` : ''}

  <section class="contact-sec" id="contact-me">
    <div class="contact-card">
      <img src="art/card-explain.webp" alt="" loading="lazy">
      <div>
        <p class="eyebrow">Contact</p>
        <h2>Say hello</h2>
        <p>Made by Lyra. Found a bug, have an idea, or want to share what you\u2019re researching? Find me here.</p>
        <div class="contact-links">${CONTACT.map(c => `<a class="btn ${c.label === 'X' ? 'primary' : 'ghost'}" href="${esc(c.url)}" target="_blank" rel="noopener">${esc(c.label === 'X' ? 'X (Twitter)' : c.label)} <span aria-hidden="true">\u2197</span></a>`).join('')}</div>
      </div>
    </div>
  </section>  `;
}

function libCard(it) {
  if (it._k === 'doc') {
    const total = paragraphs(it).length;
    const done = paragraphs(it).filter(b => it.notes?.[b.id]).length;
    return `<a class="lib-card" href="#/read/${esc(it.id)}"><span class="eyebrow">${it.sample ? 'Sample' : 'Paper'} \u00b7 ${fmtDate(it.updated)}</span><h3>${esc(truncate(it.title, 110))}</h3>
      <div class="mini-bar"><i style="width:${total ? Math.round(done / total * 100) : 0}%"></i></div><span class="muted small">${done}/${plural(total, 'paragraph')} explained</span></a>`;
  }
  return `<a class="lib-card proj" href="#/compass/${esc(it.id)}"><span class="eyebrow">Research topic \u00b7 ${fmtDate(it.updated)}</span><h3>${esc(truncate(it.title, 110))}</h3>
    <span class="muted small">${plural((it.saved || []).length, 'saved source')}</span></a>`;
}

// ---------- explain input ----------
async function viewExplain(q) {
  const s = getSettings();
  view.innerHTML = `
  <section class="page narrow">
    <p class="eyebrow">Paper Explainer</p>
    <h1 class="page-title">What are we reading today?</h1>
    <p class="lede">Upload a research paper, journal article or any article. I\u2019ll explain it paragraph by paragraph, then gather resources so you can learn more.</p>
    ${hasKey() ? '' : keyNotice()}
    <div class="card input-card">
      <div class="tabs" role="tablist">
        <button role="tab" data-tab="file" class="on" aria-selected="true">Upload a file</button>
        <button role="tab" data-tab="url" aria-selected="false">Paste a link</button>
        <button role="tab" data-tab="text" aria-selected="false">Paste text</button>
      </div>
      <div class="tabpane" data-pane="file">
        <label class="drop" id="drop">
          <input type="file" id="file" accept=".pdf,.docx,.txt,.md,.markdown,.html,.htm,application/pdf">
          <img src="art/card-explain.webp" alt="" class="drop-art">
          <strong>Drop your PDF here</strong>
          <span>or tap to choose \u00b7 PDF, Word (.docx), .txt or .md</span>
          <span class="file-name" id="fileName"></span>
        </label>
      </div>
      <div class="tabpane" data-pane="url" hidden>
        <label class="field"><span>Link to a paper or article</span><input id="url" type="text" inputmode="url" placeholder="https://arxiv.org/abs/\u2026  or a DOI like 10.1038/\u2026" value="${esc(q.url || '')}"></label>
        <p class="hint">Works with arXiv, open-access journals, blogs and news sites. Paywalled papers can\u2019t be opened \u2014 download the PDF and upload it instead.</p>
      </div>
      <div class="tabpane" data-pane="text" hidden>
        <label class="field"><span>Title <small>(optional)</small></span><input id="ptitle" type="text" placeholder="e.g. Attention Is All You Need"></label>
        <label class="field"><span>The text</span><textarea id="ptext" rows="10" placeholder="Paste the article here. Leave an empty line between paragraphs."></textarea></label>
      </div>
      <fieldset class="levels"><legend>How should I explain it?</legend>
        ${Object.entries(LEVELS).map(([k, l]) => `<label class="level"><input type="radio" name="level" value="${k}" ${k === s.level ? 'checked' : ''}><span><strong>${l.label}</strong><small>${l.hint}</small></span></label>`).join('')}
      </fieldset>
      <button class="btn primary big wide" id="go">Explain every paragraph</button>
      <p class="status" id="status" role="status"></p>
    </div>
    <p class="privacy muted small">Your files stay in your browser. The text is only sent to Google Gemini to write the notes. On Google\u2019s free plan, Google may use what you send to improve its products, so don\u2019t upload anything confidential.</p>
  </section>`;

  let tab = 'file';
  const setTab = t => {
    tab = t;
    $$('[data-tab]').forEach(b => { b.classList.toggle('on', b.dataset.tab === t); b.setAttribute('aria-selected', b.dataset.tab === t); });
    $$('[data-pane]').forEach(p => p.hidden = p.dataset.pane !== t);
  };
  $$('[data-tab]').forEach(b => b.onclick = () => setTab(b.dataset.tab));
  if (q.url) setTab('url');

  let file = null;
  const fileInput = $('#file'), drop = $('#drop');
  const pick = f => { file = f; $('#fileName').textContent = f ? `\u2713 ${f.name}` : ''; drop.classList.toggle('has', !!f); };
  fileInput.onchange = () => pick(fileInput.files[0]);
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) pick(e.dataTransfer.files[0]); });

  const status = $('#status');
  const say = (t, kind = '') => { status.textContent = t; status.className = 'status ' + kind; };
  $('#go').onclick = async () => {
    const level = $('input[name=level]:checked').value;
    saveSettings({ level });
    const btn = $('#go');
    btn.disabled = true;
    try {
      let parsed;
      if (tab === 'file') {
        if (!file) throw new Error('Choose a file first.');
        say('Opening your file\u2026');
        parsed = await ingest.fromFile(file, say);
      } else if (tab === 'url') {
        const u = $('#url').value.trim();
        if (!u) throw new Error('Paste a link first.');
        parsed = await ingest.fromUrl(u, say);
      } else {
        const t = $('#ptext').value.trim();
        if (t.length < 80) throw new Error('Paste a bit more text (at least a paragraph).');
        parsed = ingest.fromText(t, $('#ptitle').value.trim());
        if ($('#ptitle').value.trim()) parsed.title = $('#ptitle').value.trim();
      }
      const doc = {
        id: uid(), title: parsed.title || 'Untitled reading', source: parsed.source || '', origin: tab === 'file' ? file.name : '',
        blocks: parsed.blocks, references: parsed.references || [], level, notes: {}, qa: {}, saved: [],
        created: Date.now(), updated: Date.now(), status: 'new',
      };
      const n = paragraphs(doc).length;
      if (!n) throw new Error('I couldn\u2019t find any paragraphs in that. Try pasting the text instead.');
      await put('docs', doc);
      say(`Found ${plural(n, 'paragraph')}. Opening\u2026`, 'ok');
      location.hash = '#/read/' + doc.id;
    } catch (e) {
      say(e.message || String(e), 'err');
    } finally { btn.disabled = false; }
  };
}

// ---------- reader ----------
function noteHTML(doc, b) {
  const n = doc.notes[b.id];
  const qa = (doc.qa?.[b.id] || []).map(x => `<div class="qa"><p class="q">${esc(x.q)}</p><p class="a">${md(x.a)}</p></div>`).join('');
  if (!n) return `<div class="pending" aria-label="Writing note"><i></i><i></i><i></i></div>`;
  return `<p class="gist">${esc(n.gist)}</p>
    <p class="expl">${md(n.explanation)}</p>
    ${n.terms?.length ? `<div class="terms">${n.terms.map(t => `<details class="term"><summary>${esc(t.term)}</summary><p>${esc(t.meaning)}</p></details>`).join('')}</div>` : ''}
    <div class="note-actions">
      <button class="chip-btn" data-act="simpler" data-id="${b.id}">Simpler</button>
      <button class="chip-btn" data-act="deeper" data-id="${b.id}">Go deeper</button>
      <button class="chip-btn" data-act="ask" data-id="${b.id}">Ask a question</button>
    </div>
    <form class="askbox" data-ask="${b.id}" hidden><input type="text" placeholder="What does this part mean?" aria-label="Your question"><button class="btn small primary">Ask</button></form>
    <div class="answers">${qa}</div>`;
}

function blocksHTML(doc) {
  return doc.blocks.map(b => {
    if (b.type === 'heading') return `<h2 class="r-sec" id="sec-${b.id}">${esc(b.text)}</h2>`;
    return `<div class="row ${b.type}" id="row-${b.id}">
      <div class="orig">${b.type === 'caption' ? '<span class="cap-tag">Figure / table</span>' : ''}<p>${esc(b.text).replace(/\n/g, '<br>')}</p></div>
      <aside class="note" id="note-${b.id}">${noteHTML(doc, b)}</aside>
    </div>`;
  }).join('');
}

function overviewHTML(doc) {
  const o = doc.overview;
  if (!o) return `<section class="overview card shimmer-card"><p class="eyebrow">The big picture</p><div class="pending"><i></i><i></i><i></i></div></section>`;
  const cell = (t, v) => v ? `<div><h4>${t}</h4><p>${md(v)}</p></div>` : '';
  return `<section class="overview card">
    <p class="eyebrow">The big picture</p>
    <p class="tldr">${md(o.tldr)}</p>
    <div class="ov-grid">${cell('The problem', o.problem)}${cell('What they did', o.approach)}${cell('What they found', o.findings)}${cell('Why it matters', o.why_it_matters)}</div>
  </section>`;
}

function glossaryHTML(doc) {
  const map = new Map();
  for (const b of doc.blocks) for (const t of doc.notes[b.id]?.terms || []) {
    const k = t.term.toLowerCase();
    if (!map.has(k)) map.set(k, t);
  }
  if (!map.size) return '';
  const list = [...map.values()].sort((a, b) => a.term.localeCompare(b.term));
  return `<section class="glossary card" id="glossary"><p class="eyebrow">Glossary</p><h2>Words worth knowing</h2>
    <dl>${list.map(t => `<div><dt>${esc(t.term)}</dt><dd>${esc(t.meaning)}</dd></div>`).join('')}</dl></section>`;
}

function docMarkdown(doc) {
  const o = doc.overview || {};
  const L = [`# ${doc.title}`, ''];
  if (o.tldr) L.push(`**TL;DR:** ${o.tldr}`, '', `- **Problem:** ${o.problem}`, `- **Approach:** ${o.approach}`, `- **Findings:** ${o.findings}`, `- **Why it matters:** ${o.why_it_matters}`, '');
  for (const b of doc.blocks) {
    if (b.type === 'heading') { L.push(`## ${b.text}`, ''); continue; }
    L.push(`> ${b.text.replace(/\n/g, '\n> ')}`, '');
    const n = doc.notes[b.id];
    if (n) {
      L.push(`**${n.gist}** \u2014 ${n.explanation}`, '');
      (n.terms || []).forEach(t => L.push(`- *${t.term}*: ${t.meaning}`));
      if (n.terms?.length) L.push('');
    }
  }
  const r = doc.resources;
  if (r) {
    L.push('## Resources', '');
    const sec = (t, items, f) => { if (items?.length) { L.push(`### ${t}`, ''); items.forEach(i => L.push(f(i))); L.push(''); } };
    sec('Foundations', r.wiki, w => `- [${w.title}](${w.url})`);
    sec('Books', r.books, b => `- ${b.title}${b.authors?.length ? ` \u2014 ${b.authors.join(', ')}` : ''} (${b.url})`);
    sec('Courses', r.courses, c => `- [${c.title} (${c.provider})](${c.url})`);
    sec('Videos', r.videos, v => `- [${v.title}${v.creator ? ` \u2014 ${v.creator}` : ''}](${v.url})`);
    sec('Websites', r.websites, w => `- [${w.name}](${w.url})`);
    sec('Related papers', [...(r.related || []), ...(r.reviews || [])], p => `- [${p.title}](${p.url}) (${p.year})`);
  }
  return L.join('\n');
}

async function viewReader(id) {
  let doc = await get('docs', id);
  if (!doc && id === 'sample') { doc = sampleDoc(); await put('docs', doc); }
  if (!doc) { view.innerHTML = `<section class="page narrow"><h1 class="page-title">Not found</h1><p>This reading isn\u2019t saved in this browser.</p><a class="btn" href="#/explain">Explain a paper</a></section>`; return; }
  doc.notes ||= {}; doc.qa ||= {}; doc.saved ||= [];
  const s = getSettings();
  const heads = doc.blocks.filter(b => b.type === 'heading');
  const o = doc.overview || {};

  view.innerHTML = `
  <article class="reader layout-${s.layout}" id="reader">
    <header class="r-head">
      <p class="eyebrow" id="rEyebrow">${esc([o.field, o.kind, LEVELS[doc.level]?.label + ' notes'].filter(Boolean).join(' \u00b7 '))}</p>
      <h1 class="r-title" id="rTitle">${esc(doc.title)}</h1>
      <p class="r-meta muted">${esc(o.authors || doc.origin || '')}${doc.source ? ` \u00b7 ${link(doc.source, 'original source')}` : ''}${doc.sample ? ' \u00b7 <span class="badge rose">Sample</span>' : ''}</p>
      <div class="r-tools">
        <div class="seg" role="group" aria-label="Layout">
          <button data-layout="side">Side by side</button><button data-layout="notes">Notes only</button><button data-layout="orig">Original only</button>
        </div>
        <button class="chip-btn" id="mdBtn">Download notes</button>
        <button class="chip-btn" id="printBtn">Print</button>
        ${doc.sample ? '' : '<button class="chip-btn danger" id="delBtn">Delete</button>'}
      </div>
    </header>
    <div class="r-progress" id="rProgress">
      <div class="bar"><i id="pBar"></i></div>
      <span id="pText"></span>
      ${heads.length > 1 ? `<select id="toc" aria-label="Jump to section"><option value="">Jump to\u2026</option>${heads.map(h => `<option value="sec-${h.id}">${esc(truncate(h.text, 48))}</option>`).join('')}<option value="resources">Resources</option></select>` : ''}
    </div>
    <div id="banner"></div>
    <div id="ov">${overviewHTML(doc)}</div>
    <div class="r-body" id="rBody">${blocksHTML(doc)}</div>
    <div id="gloss">${glossaryHTML(doc)}</div>
    <section class="resources" id="resources">
      <p class="eyebrow">Keep learning</p><h2 class="section-title">Resources to go deeper</h2>
      <div id="resBody">${doc.resources ? readerResources(doc.resources, doc.saved) : '<div class="pending wide"><i></i><i></i><i></i></div><p class="muted center">Resources appear here once the notes are done.</p>'}</div>
    </section>
    ${doc.references?.length ? `<details class="refs card"><summary>The paper\u2019s own reference list (${doc.references.length})</summary><ol>${doc.references.map(r => `<li>${esc(r)}</li>`).join('')}</ol></details>` : ''}
  </article>`;

  const reader = $('#reader');
  const setLayout = l => { reader.className = `reader layout-${l}`; $$('[data-layout]').forEach(b => b.classList.toggle('on', b.dataset.layout === l)); };
  setLayout(s.layout);
  $$('[data-layout]').forEach(b => b.onclick = () => { saveSettings({ layout: b.dataset.layout }); setLayout(b.dataset.layout); });
  $('#mdBtn').onclick = () => download(`${doc.title.slice(0, 60).replace(/[^\w\- ]+/g, '').trim() || 'notes'} - Marginalia.md`, docMarkdown(doc), 'text/markdown');
  $('#printBtn').onclick = () => window.print();
  $('#delBtn')?.addEventListener('click', async () => { if (confirm('Delete this reading and its notes?')) { jobFor(doc.id)?.ctrl.abort(); await del('docs', doc.id); location.hash = '#/library'; } });
  $('#toc')?.addEventListener('change', e => { if (e.target.value) document.getElementById(e.target.value)?.scrollIntoView({ behavior: 'smooth' }); e.target.value = ''; });

  const total = paragraphs(doc).length;
  const progress = (text) => {
    const done = paragraphs(doc).filter(b => doc.notes[b.id]).length;
    $('#pBar').style.width = `${total ? done / total * 100 : 0}%`;
    $('#pText').textContent = text || (done === total ? `All ${plural(total, 'paragraph')} explained` : `${done} of ${total} paragraphs explained`);
  };
  progress();

  const banner = (html) => { $('#banner').innerHTML = html; };
  const persist = () => put('docs', doc);
  bindResources($('#resources'), doc, persist);

  const refreshNote = id => { const el = $('#note-' + id); if (el) { el.innerHTML = noteHTML(doc, doc.blocks.find(b => b.id === id)); el.classList.remove('writing'); el.classList.add('fresh'); } };

  const listener = evt => {
    if (evt.type === 'stage') progress(evt.text);
    if (evt.type === 'wait') progress(`Pausing ${Math.ceil(evt.ms / 1000)}s for the free AI limit\u2026`);
    if (evt.type === 'overview') {
      $('#ov').innerHTML = overviewHTML(doc);
      $('#rTitle').textContent = doc.title;
      const ov = doc.overview;
      $('#rEyebrow').textContent = [ov.field, ov.kind, LEVELS[doc.level]?.label + ' notes'].filter(Boolean).join(' \u00b7 ');
    }
    if (evt.type === 'pending') evt.ids.forEach(id => $('#note-' + id)?.classList.add('writing'));
    if (evt.type === 'notes') { evt.ids.forEach(refreshNote); progress(); $('#gloss').innerHTML = glossaryHTML(doc); }
    if (evt.type === 'resources') { $('#resBody').innerHTML = readerResources(doc.resources, doc.saved); }
    if (evt.type === 'done') { progress(); banner(''); toast('All done! Resources are at the bottom.', 'ok'); }
    if (evt.type === 'error') { progress(); showError(); }
  };
  const showError = () => banner(`<div class="notice err"><strong>Paused.</strong> ${esc(doc.error)} <button class="btn small" id="contBtn">Continue</button></div>`);
  const begin = () => {
    if (!hasKey()) { banner(keyNotice()); return; }
    banner('');
    const job = startExplain(doc, listener);
    onLeave(() => job.listeners.delete(listener));
  };
  $('#banner').addEventListener('click', e => { if (e.target.id === 'contBtn') { doc.error = ''; begin(); } });

  if (doc.sample) {
    if (!doc.resources) {
      buildResources({ title: doc.title, overview: doc.overview, ai: false }).then(async r => {
        doc.resources = r; await put('docs', doc);
        if ($('#resBody')) $('#resBody').innerHTML = readerResources(r, doc.saved);
      }).catch(() => {});
    }
    banner(`<div class="notice soft"><strong>This is a sample.</strong> The notes were written in advance so you can see how it works. <a href="#/explain">Explain your own paper &rarr;</a></div>`);
  } else if (jobFor(doc.id)) {
    const job = startExplain(doc, listener);
    onLeave(() => job.listeners.delete(listener));
  } else if (doc.error) showError();
  else if (doc.status !== 'done') begin();

  // note actions
  $('#rBody').addEventListener('click', async e => {
    const btn = e.target.closest('[data-act]');
    if (!btn) return;
    const id = btn.dataset.id;
    const block = doc.blocks.find(b => b.id === id);
    if (btn.dataset.act === 'ask') {
      const f = $(`[data-ask="${id}"]`);
      f.hidden = !f.hidden;
      if (!f.hidden) f.querySelector('input').focus();
      return;
    }
    if (!hasKey()) { toast('Add your free Gemini key in Settings first.', 'warn'); return; }
    btn.disabled = true; btn.textContent = 'Thinking\u2026';
    try {
      doc.notes[id] = await reexplain(doc, block, btn.dataset.act);
      await persist();
      refreshNote(id);
      $('#gloss').innerHTML = glossaryHTML(doc);
    } catch (err) { toast(err.message, 'err'); btn.disabled = false; btn.textContent = btn.dataset.act === 'simpler' ? 'Simpler' : 'Go deeper'; }
  });
  $('#rBody').addEventListener('submit', async e => {
    const f = e.target.closest('[data-ask]');
    if (!f) return;
    e.preventDefault();
    const input = f.querySelector('input');
    const question = input.value.trim();
    if (!question) return;
    if (!hasKey()) { toast('Add your free Gemini key in Settings first.', 'warn'); return; }
    const id = f.dataset.ask;
    const box = f.nextElementSibling;
    const tmp = document.createElement('div');
    tmp.className = 'qa';
    tmp.innerHTML = `<p class="q">${esc(question)}</p><div class="pending"><i></i><i></i></div>`;
    box.appendChild(tmp);
    input.value = '';
    try {
      const a = await ask(doc, doc.blocks.find(b => b.id === id), question);
      (doc.qa[id] ||= []).push({ q: question, a });
      await persist();
      tmp.innerHTML = `<p class="q">${esc(question)}</p><p class="a">${md(a)}</p>`;
    } catch (err) { tmp.remove(); toast(err.message, 'err'); }
  });
}

// ---------- compass ----------
async function viewCompass(q) {
  const projects = await all('projects').catch(() => []);
  view.innerHTML = `
  <section class="page narrow">
    <p class="eyebrow">Research Compass</p>
    <h1 class="page-title">What do you want to write about?</h1>
    <p class="lede">Type your paper title or topic. I\u2019ll find existing papers, ongoing studies, books, encyclopedias, videos and websites so you can study it, then help you shape your own paper.</p>
    <form class="card input-card" id="cform">
      <label class="field"><span>Your title or topic</span><input id="ctitle" type="text" required placeholder="e.g. How social media affects teenage sleep" value="${esc(q.t || '')}"></label>
      <label class="field"><span>Anything else? <small>(optional)</small></span><textarea id="cnotes" rows="3" placeholder="e.g. It\u2019s for a high-school project, I want to focus on India, I like psychology\u2026"></textarea></label>
      <button class="btn primary big wide">Find my sources</button>
      ${hasKey() ? '' : '<p class="hint">Works without a key. With a free Gemini key you also get research questions, fresh angles, an outline and recommended books, courses and websites. <a href="#/settings">Add a key</a></p>'}
    </form>
    ${projects.length ? `<h2 class="section-title left">Your topics</h2><div class="lib-grid">${projects.map(p => libCard({ ...p, _k: 'proj' })).join('')}</div>` : ''}
  </section>`;
  $('#cform').onsubmit = async e => {
    e.preventDefault();
    const title = $('#ctitle').value.trim();
    if (title.length < 3) return;
    const p = { id: uid(), title, notes: $('#cnotes').value.trim(), created: Date.now(), updated: Date.now(), saved: [] };
    await put('projects', p);
    location.hash = '#/compass/' + p.id;
  };
  if (q.t && q.go) $('#cform').requestSubmit();
}

const running = new Map();
async function viewProject(id) {
  const p = await get('projects', id);
  if (!p) { view.innerHTML = `<section class="page narrow"><h1 class="page-title">Not found</h1><a class="btn" href="#/compass">New topic</a></section>`; return; }
  p.saved ||= [];
  const render = () => {
    const plan = p.plan || {};
    const listCard = (t, items, f = esc, ordered = false, extra = '') => items?.length ? `<div class="card plan-card"><h3>${t}</h3>${extra}<${ordered ? 'ol' : 'ul'}>${items.map(i => `<li>${f(i)}</li>`).join('')}</${ordered ? 'ol' : 'ul'}></div>` : '';
    view.innerHTML = `
    <article class="page project">
      <header class="r-head">
        <p class="eyebrow">Research Compass${plan.field ? ` \u00b7 ${esc(plan.field)}` : ''}</p>
        <h1 class="r-title">${esc(p.title)}</h1>
        ${p.notes ? `<p class="muted">${esc(p.notes)}</p>` : ''}
        <div class="r-tools">
          <button class="chip-btn" id="refresh">Search again</button>
          <button class="chip-btn danger" id="pdel">Delete</button>
        </div>
      </header>
      <div id="pstatus"></div>
      ${plan.summary ? `<section class="card overview"><p class="eyebrow">The landscape</p><p class="tldr">${md(plan.summary)}</p></section>` : ''}
      ${!plan.basic && plan.research_questions ? `<section class="plan-grid">
        ${listCard('Research questions you could ask', plan.research_questions, esc, true, '<button class="chip-btn copy-rq">Copy</button>')}
        ${listCard('Fresh angles & gaps', plan.angles, a => `<strong>${esc(a.angle)}</strong><br><span class="muted">${esc(a.why)}</span>`)}
        ${listCard('A possible outline', plan.outline, esc, true)}
        ${listCard('Methods that fit', plan.methods, m => `<strong>${esc(m.method)}</strong> \u2014 <span class="muted">${esc(m.why)}</span>`)}
        ${plan.subtopics?.length ? `<div class="card plan-card"><h3>Subtopics to explore</h3><p class="muted small">Tap one to open its own compass.</p><div class="chips">${plan.subtopics.map(s => `<a class="chip" href="#/compass?t=${encodeURIComponent(s)}&go=1">${esc(s)}</a>`).join('')}</div></div>` : ''}
      </section>` : plan.basic && !hasKey() ? keyNotice('get research questions, angles and an outline') : ''}
      <section class="resources" id="resources">
        <p class="eyebrow">Sources</p><h2 class="section-title">Everything to study</h2>
        <div id="resBody">${p.results ? compassResources(p.results, p.saved) : '<div class="pending wide"><i></i><i></i><i></i></div>'}</div>
      </section>
      <div class="readlist ${p.saved.length ? 'show' : ''}" id="readlist">
        <span><strong id="rlCount">${p.saved.length}</strong> in your reading list</span>
        <button class="btn small" id="rlCopy">Copy</button>
        <button class="btn small primary" id="rlDl">Download</button>
      </div>
    </article>`;
    $('.copy-rq')?.addEventListener('click', () => copy(plan.research_questions.map((x, i) => `${i + 1}. ${x}`).join('\n')));
    $('#refresh').onclick = () => { p.plan = p.plan?.basic ? null : p.plan; p.results = null; go(); };
    $('#pdel').onclick = async () => { if (confirm('Delete this topic?')) { await del('projects', p.id); location.hash = '#/compass'; } };
    bindResources($('#resources'), p, () => put('projects', p));
    $('#rlCopy').onclick = () => copy(readingListMarkdown(p.title, p.saved));
    $('#rlDl').onclick = () => download(`Reading list - ${p.title.slice(0, 50).replace(/[^\w\- ]+/g, '')}.md`, readingListMarkdown(p.title, p.saved), 'text/markdown');
    if (p.error) $('#pstatus').innerHTML = `<p class="notice err">The AI part had a problem: ${esc(p.error)} The database results below still work.</p>`;
  };
  const onSaved = () => { const n = p.saved.length; const rl = $('#readlist'); if (rl) { rl.classList.toggle('show', n > 0); $('#rlCount').textContent = n; } };
  document.addEventListener('saved-changed', onSaved);
  onLeave(() => document.removeEventListener('saved-changed', onSaved));

  const go = async () => {
    render();
    const stat = t => { const el = $('#pstatus'); if (el && t !== 'plan' && t !== 'done') el.innerHTML = `<p class="progress-pill"><span class="quill"></span>${esc(t)}</p>`; };
    let r = running.get(p.id);
    if (!r) { r = runCompass(p, msg => { if (msg === 'plan' && location.hash.endsWith(p.id)) render(); stat(msg); }); running.set(p.id, r); }
    try { await r; } catch (e) { p.error = e.message; } finally { running.delete(p.id); }
    if (location.hash.endsWith(p.id)) render();
  };
  if (p.results) render(); else go();
}

// ---------- library ----------
async function viewLibrary() {
  const [docs, projects] = await Promise.all([all('docs'), all('projects')]);
  view.innerHTML = `<section class="page">
    <p class="eyebrow">Library</p><h1 class="page-title">Your shelf</h1>
    <p class="lede">Everything is saved in this browser only. Use \u201cDownload notes\u201d to keep a copy.</p>
    <h2 class="section-title left">Papers you\u2019ve read</h2>
    ${docs.length ? `<div class="lib-grid">${docs.map(d => libCard({ ...d, _k: 'doc' })).join('')}</div>` : '<p class="muted">Nothing yet. <a href="#/explain">Explain your first paper</a> or <a href="#/sample">open the sample</a>.</p>'}
    <h2 class="section-title left">Research topics</h2>
    ${projects.length ? `<div class="lib-grid">${projects.map(p => libCard({ ...p, _k: 'proj' })).join('')}</div>` : '<p class="muted">No topics yet. <a href="#/compass">Start one</a>.</p>'}
  </section>`;
}

// ---------- settings ----------
async function viewSettings() {
  const s = getSettings();
  const masked = s.geminiKey ? s.geminiKey.slice(0, 4) + '\u2022'.repeat(12) + s.geminiKey.slice(-4) : '';
  view.innerHTML = `<section class="page narrow">
    <p class="eyebrow">Settings</p><h1 class="page-title">Set up Marginalia</h1>
    <div class="card setting">
      <h2>Your free AI key ${s.geminiKey ? '<span class="badge sage">Connected</span>' : '<span class="badge rose">Not set</span>'}</h2>
      <p>Marginalia uses Google\u2019s Gemini AI to write explanations. Google gives you a key for free:</p>
      <ol class="steps-list">
        <li>Open <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a> (opens in a new tab).</li>
        <li>Sign in with any Google account.</li>
        <li>Click <strong>Create API key</strong>. If it asks for a project, pick the default or click <strong>Create project</strong>.</li>
        <li>Click <strong>Copy</strong> next to your new key (it starts with <code>AIza</code> or <code>AQ.</code>).</li>
        <li>Come back here, paste it in the box below and press <strong>Save &amp; test</strong>.</li>
      </ol>
      <form id="keyForm" class="key-row">
        <input id="key" type="password" autocomplete="off" spellcheck="false" placeholder="${masked ? esc(masked) : 'Paste your key here'}" aria-label="Gemini API key">
        <button class="btn primary">Save &amp; test</button>
      </form>
      <p class="status" id="kstatus" role="status"></p>
      <p class="muted small">Your key is stored only in this browser and sent only to Google. Don\u2019t share it publicly. ${s.geminiKey ? '<button class="linklike" id="rmKey">Remove key</button>' : ''}</p>
      <label class="field ${s.models?.length ? '' : 'hide'}" id="modelField"><span>AI model</span>
        <select id="model">${(s.models || []).map(m => `<option ${m === s.model ? 'selected' : ''}>${esc(m)}</option>`).join('')}</select>
        <small class="muted">\u201cFlash\u201d models are fast and free. Pro models may need a paid plan.</small></label>
    </div>
    <div class="card setting">
      <h2>Preferences</h2>
      <label class="field"><span>Default explanation level</span>
        <select id="level">${Object.entries(LEVELS).map(([k, l]) => `<option value="${k}" ${k === s.level ? 'selected' : ''}>${l.label} \u2014 ${l.hint}</option>`).join('')}</select></label>
      <label class="field"><span>Theme</span>
        <select id="theme"><option value="auto" ${s.theme === 'auto' ? 'selected' : ''}>Match my device</option><option value="parchment" ${s.theme === 'parchment' ? 'selected' : ''}>Parchment (light)</option><option value="midnight" ${s.theme === 'midnight' ? 'selected' : ''}>Midnight Library (dark)</option></select></label>
    </div>
    <div class="card setting">
      <h2>Paper search <small class="muted">(optional)</small></h2>
      <p class="small">Paper results come from OpenAlex, which is free. If you ever see \u201cdaily limit reached\u201d, get a free key at <a href="https://openalex.org/settings/api" target="_blank" rel="noopener">openalex.org/settings/api</a> and paste it here.</p>
      <form id="oaForm" class="key-row"><input id="oakey" type="password" autocomplete="off" placeholder="${s.openalexKey ? 'Saved \u2022\u2022\u2022\u2022' : 'OpenAlex key (optional)'}" aria-label="OpenAlex key"><button class="btn">Save</button></form>
    </div>
    <div class="card setting">
      <h2>Your data</h2>
      <p class="small">Readings and topics live only in this browser. Clearing them can\u2019t be undone.</p>
      <button class="btn danger" id="wipe">Delete all readings &amp; topics</button>
    </div>
  </section>`;
  const ks = $('#kstatus');
  $('#keyForm').onsubmit = async e => {
    e.preventDefault();
    const key = $('#key').value.trim();
    if (!key) { ks.textContent = 'Paste your key first.'; ks.className = 'status err'; return; }
    ks.textContent = 'Testing your key\u2026'; ks.className = 'status';
    try {
      const { model } = await verifyKey(key);
      ks.textContent = `It works! Using ${model}.`; ks.className = 'status ok';
      toast('Key saved. You\u2019re all set!', 'ok');
      setTimeout(route, 900);
    } catch (err) { ks.textContent = err.message; ks.className = 'status err'; }
  };
  $('#rmKey')?.addEventListener('click', () => { saveSettings({ geminiKey: '', models: [], model: '' }); route(); });
  $('#model')?.addEventListener('change', e => { saveSettings({ model: e.target.value, modelPicked: true }); toast('Model updated', 'ok', 1500); });
  $('#level').onchange = e => saveSettings({ level: e.target.value });
  $('#theme').onchange = e => { saveSettings({ theme: e.target.value }); applyTheme(); };
  $('#oaForm').onsubmit = e => { e.preventDefault(); saveSettings({ openalexKey: $('#oakey').value.trim() }); toast('Saved', 'ok', 1500); route(); };
  $('#wipe').onclick = async () => {
    if (!confirm('Delete every reading and topic saved in this browser?')) return;
    for (const d of await all('docs')) await del('docs', d.id);
    for (const p of await all('projects')) await del('projects', p.id);
    toast('All cleared', 'ok');
  };
}

applyTheme();
route();
