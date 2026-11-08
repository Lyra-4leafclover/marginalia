// Turn PDFs, Word docs, web pages or pasted text into a clean list of blocks:
// { id, type: 'heading' | 'para' | 'caption', text }
let pdfjs;
async function loadPdfJs() {
  if (!pdfjs) {
    pdfjs = await import('../vendor/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdf.worker.min.mjs', import.meta.url).href;
  }
  return pdfjs;
}

let mammothP;
function loadMammoth() {
  if (!mammothP) mammothP = new Promise((resolve, reject) => {
    if (window.mammoth) return resolve(window.mammoth);
    const s = document.createElement('script');
    s.src = new URL('../vendor/mammoth.browser.min.js', import.meta.url).href;
    s.onload = () => resolve(window.mammoth);
    s.onerror = () => reject(new Error('Could not load the Word reader.'));
    document.head.appendChild(s);
  });
  return mammothP;
}

const HEADING_WORDS = /^(abstract|introduction|background|related work|literature review|method(s|ology)?|materials and methods|experiments?|results?|discussion|conclusions?|limitations|future work|acknowledge?ments?|references|bibliography|appendix|summary|keywords?|findings|analysis|evaluation|implications)\b/i;
const SKIP_HEAD = /^(acknowledge?ments?|author contributions?|funding|competing interests|conflicts? of interest|declaration of competing interest|supporting information|data availability|ethics declarations?|additional information)\b/i;
const REF_HEAD = /^(\d+\.?\s*)?(references|bibliography|works cited|literature cited|reference list)\s*$/i;

export async function fromFile(file, onProgress) {
  const name = file.name.toLowerCase();
  if (name.endsWith('.pdf') || file.type === 'application/pdf') return fromPdf(await file.arrayBuffer(), onProgress, file.name);
  if (name.endsWith('.docx')) {
    const mammoth = await loadMammoth();
    const { value } = await mammoth.convertToHtml({ arrayBuffer: await file.arrayBuffer() }, { styleMap: ["p[style-name='Title'] => h1:fresh", "p[style-name='Subtitle'] => p:fresh"] });
    return fromHtml(value, file.name.replace(/\.docx$/i, ''));
  }
  if (name.endsWith('.html') || name.endsWith('.htm')) return fromHtml(await file.text(), file.name);
  if (/\.(txt|md|markdown|text)$/.test(name) || file.type.startsWith('text/')) return fromText(await file.text(), file.name.replace(/\.\w+$/, ''));
  throw new Error('That file type isn\u2019t supported yet. Try a PDF, Word (.docx), .txt or .md file.');
}

export async function fromPdf(buffer, onProgress, fallbackTitle = '') {
  const lib = await loadPdfJs();
  const pdf = await lib.getDocument({ data: buffer, isEvalSupported: false }).promise;
  const pages = [];
  let metaTitle = '';
  try { metaTitle = (await pdf.getMetadata()).info?.Title || ''; } catch {}
  for (let p = 1; p <= pdf.numPages; p++) {
    onProgress?.(`Reading page ${p} of ${pdf.numPages}\u2026`);
    const page = await pdf.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    pages.push({ lines: orderColumns(toLines(content.items, vp.width), vp.width), height: vp.height, width: vp.width });
  }
  if (!pages.some(pg => pg.lines.length)) throw new Error('This PDF has no selectable text (it\u2019s probably a scan or image). Try copying the text in instead.');
  const blocks = linesToBlocks(pages);
  const title = guessTitle(pages, metaTitle) || fallbackTitle.replace(/\.pdf$/i, '');
  return finish(blocks, title);
}

function toLines(items, width = 600) {
  const mid = width / 2;
  const lines = [];
  let cur = null;
  for (const it of items) {
    if (!('str' in it)) continue;
    const x = it.transform[4], y = it.transform[5];
    const h = Math.abs(it.transform[3]) || it.height || 10;
    if (!it.str && !it.hasEOL) continue;
    if (cur && Math.abs(y - cur.y) < Math.max(2, h * 0.5) && x >= cur.xEnd - h * 2 && x - cur.xEnd < h * 2.5 && !(cur.xEnd < mid + h && x > mid - h && x - cur.xEnd > h * 0.6)) {
      const gap = x - cur.xEnd;
      if (it.str) cur.text += (gap > h * 0.15 && !cur.text.endsWith(' ') && !it.str.startsWith(' ') ? ' ' : '') + it.str;
      cur.xEnd = Math.max(cur.xEnd, x + (it.width || 0));
      cur.h = Math.max(cur.h, h);
    } else {
      if (cur && cur.text.trim()) lines.push(cur);
      cur = { text: it.str, x, y, xEnd: x + (it.width || 0), h };
    }
    if (it.hasEOL && cur) { if (cur.text.trim()) lines.push(cur); cur = null; }
  }
  if (cur && cur.text.trim()) lines.push(cur);
  return lines.map(l => ({ ...l, text: l.text.replace(/\s+/g, ' ').trim() }));
}

// two-column pages: read the left column, then the right, band by band between full-width lines
function orderColumns(lines, width) {
  const mid = width / 2;
  const isL = l => l.xEnd < mid + width * 0.02, isR = l => l.x > mid - width * 0.02;
  if (lines.filter(isL).length < 8 || lines.filter(isR).length < 8) return lines;
  const sorted = [...lines].sort((a, b) => b.y - a.y || a.x - b.x);
  const out = [];
  let L = [], R = [];
  const dump = () => { out.push(...L, ...R); L = []; R = []; };
  for (const l of sorted) {
    if (isL(l)) L.push(l);
    else if (isR(l)) R.push(l);
    else { dump(); out.push(l); }
  }
  dump();
  return out;
}

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}

function guessTitle(pages, meta) {
  if (meta && meta.length > 8 && !/^(untitled|microsoft word|document\d*)/i.test(meta) && !/\.(docx?|pdf|tex)$/i.test(meta)) return meta.trim();
  const first = pages[0]?.lines || [];
  if (!first.length) return '';
  const top = first.filter(l => l.y > pages[0].height * 0.45);
  const maxH = Math.max(...top.map(l => l.h));
  const big = top.filter(l => l.h >= maxH * 0.92 && l.text.length > 3);
  const t = big.map(l => l.text).join(' ').trim();
  return t.length > 6 && t.length < 260 ? t : '';
}

function linesToBlocks(pages) {
  // drop running headers/footers: short lines repeating on many pages near the edges
  const counts = new Map();
  const norm = t => t.toLowerCase().replace(/\d+/g, '#').trim();
  pages.forEach(pg => new Set(pg.lines.filter(l => l.y < pg.height * 0.09 || l.y > pg.height * 0.91).map(l => norm(l.text))).forEach(k => counts.set(k, (counts.get(k) || 0) + 1)));
  const repeatMin = Math.max(3, Math.floor(pages.length * 0.4));

  const all = [];
  pages.forEach((pg, pi) => pg.lines.forEach(l => {
    const edge = l.y < pg.height * 0.09 || l.y > pg.height * 0.91;
    if (edge && (counts.get(norm(l.text)) || 0) >= repeatMin) return;
    if (/^[\divxlc\s\-\u2013|/]{1,8}$/i.test(l.text)) return;
    if (/^(page\s*)?\d+\s*(of\s*\d+)?$/i.test(l.text)) return;
    if (/^(arxiv:|https?:\/\/doi\.org|doi:\s*10\.|downloaded from|©|\(c\)\s*\d{4}|copyright)/i.test(l.text) && l.text.length < 140) return;
    all.push({ ...l, page: pi });
  }));
  const bodyH = median(all.filter(l => l.text.length > 50).map(l => l.h)) || median(all.map(l => l.h)) || 10;
  const gaps = [];
  for (let i = 1; i < all.length; i++) {
    const a = all[i - 1], b = all[i];
    if (a.page === b.page && a.y > b.y) gaps.push(a.y - b.y);
  }
  const lineGap = median(gaps.filter(g => g > bodyH * 0.6 && g < bodyH * 3)) || bodyH * 1.25;
  const widths = all.filter(l => l.text.length > 40).map(l => l.xEnd - l.x);
  const fullW = median(widths) || 300;

  const blocks = [];
  let buf = null;
  const flush = () => { if (buf && buf.text.trim()) blocks.push(buf); buf = null; };
  for (let i = 0; i < all.length; i++) {
    const l = all[i], prev = all[i - 1];
    const isBig = l.h > bodyH * 1.18;
    const short = l.text.length < 90;
    const looksHeading = short && !/[.,;:]$/.test(l.text) && (
      (isBig && l.text.length > 2) ||
      HEADING_WORDS.test(l.text.replace(/^[\dIVX]+(\.\d+)*\.?\s+/, '')) && l.text.split(' ').length <= 6 && /^([\dIVX]+(\.\d+)*\.?\s+)?[A-Z]/.test(l.text) && !/[-,]$|\.\s/.test(l.text) ||
      /^(\d+(\.\d+)*\.?|[IVX]+\.)\s+[A-Z][^.]{2,70}$/.test(l.text) && !/[-,]$/.test(l.text) && l.text.split(' ').length <= 10
    );
    if (looksHeading) {
      if (buf?.type === 'heading' && prev && prev.page === l.page && Math.abs(prev.y - l.y) < l.h * 2 && Math.abs(prev.h - l.h) < 0.6 && buf.text.length > 30 && buf.text.length < 120 && !HEADING_WORDS.test(l.text)) { buf.text += ' ' + l.text; continue; }
      flush();
      buf = { type: 'heading', text: l.text };
      continue;
    }
    let newPara = !buf || buf.type === 'heading';
    if (!newPara && prev) {
      const samePage = prev.page === l.page;
      const dy = prev.y - l.y;
      const prevShort = (prev.xEnd - prev.x) < fullW * 0.72 && /[.!?:"\u201d)]$/.test(prev.text);
      const indent = l.x - prev.x > bodyH * 0.8 && l.x - prev.x < fullW * 0.3;
      if (samePage && dy > 0 && dy > lineGap * 1.45) newPara = true;
      else if (prevShort) newPara = true;
      else if (samePage && dy > 0 && indent && /[.!?:]$/.test(prev.text)) newPara = true;
      else if (Math.abs(l.h - prev.h) > bodyH * 0.25 && dy > 0) newPara = true;
    }
    if (/^(fig(ure)?|table|tab\.)\s*\.?\s*\d+[.:]/i.test(l.text)) { flush(); buf = { type: 'caption', text: l.text }; continue; }
    if (newPara) { flush(); buf = { type: 'para', text: l.text }; }
    else buf.text = joinLine(buf.text, l.text);
  }
  flush();
  return blocks;
}

function joinLine(a, b) {
  if (/[a-z]-$/.test(a) && /^[a-z]/.test(b)) return a.slice(0, -1) + b;
  return a + ' ' + b;
}

export function fromHtml(html, fallbackTitle = '') {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script,style,nav,footer,header,aside,form,noscript,svg,figure img').forEach(n => n.remove());
  doc.querySelectorAll('table').forEach(t => {
    const p = doc.createElement('p');
    p.dataset.table = '1';
    p.textContent = [...t.rows].map(r => [...r.cells].map(c => c.textContent.replace(/\s+/g, ' ').trim()).join(' | ')).join('\n');
    t.replaceWith(p);
  });
  const blocks = [];
  let title = doc.querySelector('h1')?.textContent.trim() || doc.title || '';
  if (!title || HEADING_WORDS.test(title)) title = fallbackTitle || title;
  doc.body.querySelectorAll('h1,h2,h3,h4,p,li,blockquote,figcaption,pre').forEach(n => {
    if (n.closest('li') && n.tagName !== 'LI') return;
    if (n.dataset?.table) { blocks.push({ type: 'caption', text: 'Table\n' + n.textContent }); return; }
    const text = n.textContent.replace(/\s+/g, ' ').trim();
    if (!text) return;
    if (/^H[1-4]$/.test(n.tagName)) blocks.push({ type: 'heading', text });
    else if (n.tagName === 'FIGCAPTION') blocks.push({ type: 'caption', text });
    else blocks.push({ type: 'para', text });
  });
  return finish(mergeListItems(blocks), title);
}

function mergeListItems(blocks) {
  const out = [];
  for (const b of blocks) {
    const last = out[out.length - 1];
    if (b.type === 'para' && b.text.length < 160 && last?.type === 'para' && last.text.length < 900 && last._short) {
      last.text += '\n\u2022 ' + b.text;
      continue;
    }
    out.push({ ...b, _short: b.type === 'para' && b.text.length < 160 });
  }
  return out.map(({ _short, ...b }) => b);
}

export function fromText(raw, fallbackTitle = '') {
  const text = raw.replace(/\r\n?/g, '\n')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/\[\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\((?:https?:|\/|#)[^)]*\)/g, '$1');
  const chunks = text.split(/\n\s*\n+/).map(c => c.trim()).filter(Boolean);
  const blocks = [];
  let title = '';
  for (const c of chunks) {
    const lines = c.split('\n').map(s => s.trim()).filter(Boolean);
    const mdHead = c.match(/^#{1,6}\s+(.+)$/);
    if (mdHead && lines.length === 1) {
      if (!title && /^#\s/.test(c)) title = mdHead[1].trim();
      blocks.push({ type: 'heading', text: mdHead[1].replace(/[#*_]+/g, '').trim() });
      continue;
    }
    if (/^(Title|URL Source|Published Time|Markdown Content):/i.test(lines[0])) {
      const t = c.match(/^Title:\s*(.+)$/im);
      if (t && !title) title = t[1].trim();
      continue;
    }
    if (/^[=\-]{3,}$/.test(lines[lines.length - 1]) && lines.length === 2) { blocks.push({ type: 'heading', text: lines[0] }); continue; }
    const items = lines.filter(l => /^[*\-+]\s/.test(l));
    if (items.length >= 3 && items.length === lines.length && items.reduce((a, l) => a + l.length, 0) / items.length < 32) continue;
    const joined = lines.map(l => l.replace(/^[*\-+]\s+/, '\u2022 ').replace(/^#{1,6}\s+/, '')).join(lines.some(l => /^[*\-+]\s/.test(l)) ? '\n' : ' ')
      .replace(/[*_]{2}([^*_]+)[*_]{2}/g, '$1').replace(/(\w)-\s(\w)/g, '$1$2').trim();
    if (joined.length < 90 && lines.length === 1 && !/[.!?,;:]$/.test(joined) && (HEADING_WORDS.test(joined.replace(/^[\d.]+\s*/, '')) || /^(\d+(\.\d+)*\.?|[IVX]+\.)\s+\S/.test(joined) || joined.split(' ').length <= 7)) {
      blocks.push({ type: 'heading', text: joined });
    } else blocks.push({ type: /^(fig(ure)?|table)\s*\d+[.:]/i.test(joined) ? 'caption' : 'para', text: joined });
  }
  if (!title) title = blocks.find(b => b.type === 'heading')?.text || fallbackTitle || 'Untitled reading';
  return finish(blocks, title);
}

const OA_API = 'https://api.openalex.org';

async function fetchPdf(url, onProgress) {
  onProgress?.('Downloading the PDF\u2026');
  const res = await fetch(url);
  if (!res.ok) throw new Error('pdf ' + res.status);
  const buf = await res.arrayBuffer();
  if (new TextDecoder().decode(new Uint8Array(buf.slice(0, 5))) !== '%PDF-') throw new Error('not a pdf');
  return fromPdf(buf, onProgress);
}

function fromJats(xmlText) {
  const xml = new DOMParser().parseFromString(xmlText, 'text/xml');
  const txt = n => (n?.textContent || '').replace(/\s+/g, ' ').trim();
  const blocks = [];
  const abs = xml.querySelector('front abstract');
  if (abs) { blocks.push({ type: 'heading', text: 'Abstract' }); abs.querySelectorAll('p').forEach(p => blocks.push({ type: 'para', text: txt(p) })); }
  const walk = el => {
    for (const n of el.children) {
      const tag = n.tagName.toLowerCase();
      if (tag === 'sec') walk(n);
      else if (tag === 'title') blocks.push({ type: 'heading', text: txt(n) });
      else if (tag === 'p') blocks.push({ type: 'para', text: txt(n) });
      else if (tag === 'fig' || tag === 'table-wrap') { const c = n.querySelector('caption'); if (c) blocks.push({ type: 'caption', text: (txt(n.querySelector('label')) + ' ' + txt(c)).trim() }); }
      else if (tag === 'list') n.querySelectorAll('list-item').forEach(li => blocks.push({ type: 'para', text: txt(li) }));
    }
  };
  const body = xml.querySelector('body');
  if (body) walk(body);
  const refs = [...xml.querySelectorAll('ref-list ref')].map(txt);
  const doc = finish(blocks, txt(xml.querySelector('article-meta title-group article-title')) || 'Untitled paper');
  if (refs.length) doc.references = refs.slice(0, 400);
  return doc;
}

async function viaReader(url, onProgress, selectors = true) {
  onProgress?.('Reading the page\u2026');
  const headers = { 'x-return-format': 'markdown', accept: 'text/plain', 'x-retain-images': 'none', 'x-md-link-style': 'discarded' };
  if (selectors) { headers['x-target-selector'] = 'article, main, [role=main], #content'; headers['x-remove-selector'] = 'nav, header, footer, aside, form, .sidebar, .related, .share, .newsletter, .comments, [aria-label=breadcrumb]'; }
  const res = await fetch('https://r.jina.ai/' + url, { headers });
  if (!res.ok) throw new Error(res.status === 429 || res.status === 403 ? 'busy' : 'fail');
  const doc = fromText(await res.text(), url);
  if (doc.blocks.filter(b => b.type === 'para').length < 2) {
    if (selectors) return viaReader(url, onProgress, false);
    throw new Error('empty');
  }
  return doc;
}

async function fromWikipedia(m, onProgress) {
  onProgress?.('Opening Wikipedia\u2026');
  const res = await fetch(`https://${m[1]}.wikipedia.org/api/rest_v1/page/html/${m[2]}`);
  if (!res.ok) throw new Error('wiki');
  const html = (await res.text()).replace(/<(table|figure|style|sup)[\s\S]*?<\/\1>/gi, '');
  const doc = fromHtml(html, decodeURIComponent(m[2]).replace(/_/g, ' '));
  doc.blocks = doc.blocks.filter(b => !/^(see also|notes|further reading|external links|sources|citations)$/i.test(b.text));
  return doc;
}

export async function fromUrl(input, onProgress) {
  let url = input.trim();
  if (/^10\.\d{4,9}\//.test(url)) url = 'https://doi.org/' + url;
  if (/^doi:/i.test(url)) url = 'https://doi.org/' + url.slice(4).trim();
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  const done = d => { d.source = url; return d; };

  const arx = url.match(/arxiv\.org\/(?:abs|pdf|html)\/([\w.\/-]+?)(?:v\d+)?(?:\.pdf)?\/?$/i);
  if (arx) return done(await fetchPdf(`https://arxiv.org/pdf/${arx[1]}`, onProgress));

  const wiki = url.match(/^https?:\/\/(\w+)\.(?:m\.)?wikipedia\.org\/wiki\/([^?#]+)/i);
  if (wiki) return done(await fromWikipedia(wiki, onProgress));

  if (/\.pdf(\?|$)/i.test(url)) { try { return done(await fetchPdf(url, onProgress)); } catch {} }

  // DOI or publisher page: look the paper up in OpenAlex, then try open full text
  const doi = (url.match(/10\.\d{4,9}\/[^\s?#]+/) || [])[0];
  if (doi) {
    onProgress?.('Looking up the paper\u2026');
    try {
      const w = await (await fetch(`${OA_API}/works/doi:${encodeURIComponent(doi.replace(/[.,;]$/, ''))}`)).json();
      const pmcid = (w.ids?.pmcid?.split('/').pop() || '').replace(/^(\d)/, 'PMC$1');
      if (pmcid) {
        onProgress?.('Opening the free full text\u2026');
        const r = await fetch(`https://www.ebi.ac.uk/europepmc/webservices/rest/${pmcid}/fullTextXML`);
        if (r.ok) { const d = fromJats(await r.text()); if (d.blocks.length > 3) return done(d); }
      }
      const pdfs = [w.best_oa_location?.pdf_url, ...(w.locations || []).map(l => l.pdf_url)].filter(Boolean);
      for (const p of [...new Set(pdfs)].slice(0, 3)) { try { return done(await fetchPdf(p, onProgress)); } catch {} }
      const land = w.best_oa_location?.landing_page_url || w.primary_location?.landing_page_url;
      if (land) { try { return done(await viaReader(land, onProgress)); } catch {} }
    } catch {}
  }
  try { return done(await viaReader(url, onProgress)); }
  catch (e) {
    throw new Error(e.message === 'busy'
      ? 'That website blocked our page reader for now. Download the article (PDF or Save Page As) and upload the file instead.'
      : 'Couldn\u2019t read that link (it may need a login or be paywalled). Download the PDF and upload it instead, or paste the text.');
  }
}

function finish(blocks, title) {
  // stop at references, drop junk, split huge paragraphs
  const out = [];
  let references = [];
  let inRefs = false, skip = false;
  for (const b of blocks) {
    const t = b.text.trim();
    if (b.type === 'heading' && REF_HEAD.test(t)) { inRefs = true; continue; }
    if (b.type === 'heading') skip = SKIP_HEAD.test(t.replace(/^[\dIVX.]+\s*/, ''));
    if (skip) continue;
    if (b.type === 'para' && t.length < 900 && /(Creative Commons Attribution|is an open access article|Editor:.{0,120}Received:|Received:.{0,60}Accepted:)/i.test(t)) continue;
    if (b.type === 'para' && /^(open access\b|citation:|editor:|received:|accepted:|published:|copyright:|data availability|funding:|competing interests:|keywords?:)/i.test(t)) continue;
    if (b.type === 'para' && (t.match(/[a-z\u00c0-\u024f]/gi) || []).length < t.length * 0.45) continue;
    if (inRefs) {
      if (b.type === 'heading' && /^(appendix|supplementary)/i.test(t)) { inRefs = false; out.push(b); continue; }
      references.push(t);
      continue;
    }
    if (b.type === 'para' && t.length < 25 && !/[.!?]$/.test(t)) continue;
    if (b.type === 'heading' && t.length > 160) { out.push({ type: 'para', text: t }); continue; }
    if (b.type === 'para' && t.length > 2200) splitLong(t).forEach(x => out.push({ type: 'para', text: x }));
    else out.push({ type: b.type, text: t });
  }
  // merge consecutive headings that are actually a single wrapped heading, drop leading title dup
  const cleaned = [];
  for (const b of out) {
    const last = cleaned[cleaned.length - 1];
    if (b.type === 'heading' && last?.type === 'heading' && /^(\d+(\.\d+)*\.?|[IVX]+\.)$/.test(last.text)) { last.text += ' ' + b.text; continue; }
    if (b.type === 'heading' && title && b.text.toLowerCase() === title.toLowerCase() && cleaned.length < 2) continue;
    if (b.type === 'para' && last?.type === 'para' && /^[a-z]/.test(b.text) && !/[.!?:"\u201d)]$/.test(last.text) && last.text.length < 2400) { last.text = joinLine(last.text, b.text); continue; }
    if (b.type === 'para' && last?.type === 'para' && b.text.length < 70 && (/^[a-z(\[]/.test(b.text) || !/[.!?:"\u201d)]$/.test(last.text)) && last.text.length < 2400) { last.text = joinLine(last.text, b.text); continue; }
    cleaned.push(b);
  }
  let body = cleaned.filter(b => !(b.type === 'para' && (/^[\u2217\u2020\u2021\u00a7\u00b6]/.test(b.text) && b.text.length < 1600 || /^\d+(st|nd|rd|th) (Annual )?(Conference|Workshop|Symposium)/i.test(b.text) && b.text.length < 220 || (b.text.match(/\S+@\S+\.\w+/g) || []).length > 0 && b.text.length < 220)));
  // skip title-page front matter (authors, affiliations, licence notes) when an abstract is found early
  const abs = body.findIndex(b => b.type === 'heading' ? /^abstract\b/i.test(b.text) : /^abstract[\s.:\u2014\u2013-]/i.test(b.text));
  if (abs > 0 && abs < 80) body = body.slice(abs);
  while (body.length && body[body.length - 1].type === 'heading') body.pop();
  const withIds = body.map((b, i) => ({ id: 'b' + i, ...b }));
  return { title: title.replace(/\s+/g, ' ').trim(), blocks: withIds, references: references.slice(0, 400) };
}

function splitLong(t) {
  const sentences = t.match(/[^.!?]+[.!?]+["\u201d)]?\s*|[^.!?]+$/g) || [t];
  const parts = [];
  let cur = '';
  for (const s of sentences) {
    if ((cur + s).length > 1400 && cur.length > 400) { parts.push(cur.trim()); cur = ''; }
    cur += s;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}
