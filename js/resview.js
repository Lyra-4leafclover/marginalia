import { esc, link, truncate, safeUrl, copy, toast } from './util.js';
import { apa } from './sources.js';

const authorsShort = a => !a?.length ? '' : a.length > 3 ? `${a.slice(0, 3).join(', ')} et al.` : a.join(', ');
const keyOf = it => it.url || it.title;

function saveBtn(it, saved) {
  const on = saved?.some(s => s.key === keyOf(it));
  return `<button class="chip-btn save ${on ? 'on' : ''}" data-save="${esc(keyOf(it))}" aria-pressed="${on}">${on ? '\u2713 Saved' : '+ Save'}</button>`;
}

function paperCard(p, saved) {
  const badges = [
    p.year ? `<span class="badge">${p.year}</span>` : '',
    p.cites ? `<span class="badge">${p.cites.toLocaleString()} citations</span>` : '',
    p.type === 'review' ? '<span class="badge sage">Review</span>' : '',
    p.type === 'preprint' ? '<span class="badge rose">Preprint</span>' : '',
    p.oa ? '<span class="badge gold">Free to read</span>' : '',
  ].join('');
  const explainTarget = p.pdf || (p.oa ? p.url : '');
  return `<article class="rcard paper">
    <div class="rc-badges">${badges}</div>
    <h4>${link(p.url, p.title)}</h4>
    <p class="byline">${esc(authorsShort(p.authors))}${p.venue ? ` \u00b7 <em>${esc(p.venue)}</em>` : ''}</p>
    ${p.abstract ? `<p class="abs">${esc(truncate(p.abstract, 240))}</p>` : ''}
    <div class="rc-actions">
      ${p.pdf && safeUrl(p.pdf) ? `<a class="chip-btn" href="${esc(p.pdf)}" target="_blank" rel="noopener">PDF</a>` : ''}
      ${explainTarget ? `<a class="chip-btn" href="#/explain?url=${encodeURIComponent(explainTarget)}">Explain this</a>` : ''}
      <button class="chip-btn" data-cite="${esc(apa(p))}">Cite</button>
      ${saveBtn(p, saved)}
    </div>
  </article>`;
}

function bookCard(b, saved) {
  return `<article class="rcard book">
    <div class="cover">${b.cover ? `<img src="${esc(b.cover)}" alt="" loading="lazy">` : `<span>${esc((b.title || '?')[0])}</span>`}</div>
    <div>
      <h4>${link(b.url, b.title)}</h4>
      <p class="byline">${esc(authorsShort(b.authors))}${b.year ? ` \u00b7 ${b.year}` : ''}</p>
      ${b.why ? `<p class="why">${esc(b.why)}</p>` : ''}
      <div class="rc-actions">
        ${b.readable ? '<span class="badge gold">Borrow free</span>' : ''}
        ${b.unverified ? '<span class="badge">Search</span>' : `<span class="badge">${esc(b.source || '')}</span>`}
        <button class="chip-btn" data-cite="${esc(apa(b))}">Cite</button>
        ${saveBtn(b, saved)}
      </div>
    </div>
  </article>`;
}

function trialCard(t, saved) {
  return `<article class="rcard trial">
    <div class="rc-badges"><span class="badge sage">${esc(t.status)}</span>${t.phase ? `<span class="badge">${esc(t.phase)}</span>` : ''}${t.start ? `<span class="badge">Started ${esc(t.start)}</span>` : ''}</div>
    <h4>${link(t.url, t.title)}</h4>
    <p class="byline">${esc(t.sponsor || '')}${t.end ? ` \u00b7 expected ${esc(t.end)}` : ''}</p>
    ${t.conditions?.length ? `<p class="why">${esc(t.conditions.slice(0, 4).join(', '))}</p>` : ''}
    <div class="rc-actions"><span class="badge">${esc(t.id)}</span>${saveBtn(t, saved)}</div>
  </article>`;
}

function wikiCard(w, saved) {
  return `<article class="rcard wiki">
    <h4>${link(w.url, w.title)}</h4>
    ${w.why ? `<p class="why">${esc(w.why)}</p>` : ''}
    <p class="abs">${esc(truncate(w.extract, 260))}</p>
    <div class="rc-actions"><span class="badge">Wikipedia</span>${saveBtn(w, saved)}</div>
  </article>`;
}

function simpleCard(label) {
  return (it, saved) => `<article class="rcard simple">
    <h4>${link(it.url, it.title || it.name)}</h4>
    <p class="byline">${esc(it.creator || it.provider || it.host || '')}</p>
    ${it.why ? `<p class="why">${esc(it.why)}</p>` : ''}
    <div class="rc-actions"><span class="badge">${esc(typeof label === 'function' ? label(it) : label)}</span>${saveBtn(it, saved)}</div>
  </article>`;
}
const videoCard = simpleCard('Search YouTube');
const courseCard = simpleCard(c => c.provider || 'Course');
const webCard = simpleCard(w => w.verified ? 'Found via Google' : 'Search');

const RENDER = { paper: paperCard, book: bookCard, trial: trialCard, wiki: wikiCard, video: videoCard, course: courseCard, web: webCard };

function section(id, title, sub, items, saved, cls = '') {
  if (!items?.length) return '';
  return `<section class="rsec ${cls}" id="${id}">
    <div class="rsec-head"><h3>${esc(title)}</h3>${sub ? `<p>${esc(sub)}</p>` : ''}</div>
    <div class="rgrid">${items.map(it => (RENDER[it.kind] || webCard)(it, saved)).join('')}</div>
  </section>`;
}

function linksBlock(explore) {
  if (!explore) return '';
  const group = (t, arr) => `<div class="lgroup"><h4>${esc(t)}</h4><ul>${arr.map(([n, u]) => `<li>${link(u, n)}</li>`).join('')}</ul></div>`;
  return `<section class="rsec" id="r-more"><div class="rsec-head"><h3>Keep exploring</h3><p>One-click searches on the best free research databases.</p></div>
    <div class="lgrid">${group('Papers', explore.papers)}${group('Ongoing research', explore.ongoing)}${group('Books', explore.books)}${group('Learn', explore.learn)}</div></section>`;
}

export function readerResources(r, saved) {
  if (!r) return '';
  const nav = [];
  const parts = [
    ['r-concepts', 'Learn the foundations', 'Background concepts this paper assumes you know.', r.wiki],
    ['r-books', 'Books', 'Real books, checked against Open Library.', r.books],
    ['r-courses', 'Courses', 'Free or well-known courses.', r.courses],
    ['r-videos', 'Videos & lectures', 'Opens a YouTube search for each one.', r.videos],
    ['r-web', 'Websites & guides', 'Found with Google Search.', r.websites],
    ['r-related', 'Related papers', 'Papers similar to this one (from OpenAlex).', r.related],
    ['r-cited', 'Papers this one builds on', 'Most-cited works from its reference list.', r.cited],
    ['r-classics', 'Classic papers on the topic', 'The most-cited work in this area.', r.foundational],
    ['r-reviews', 'Review articles', 'Reviews summarise a whole field \u2014 the best place to start.', r.reviews],
    ['r-recent', 'Newest research', 'Published in the last two years.', r.recent],
    ['r-preprints', 'Fresh preprints', 'Brand-new work not yet peer reviewed.', r.preprints],
  ];
  let html = '';
  for (const [id, t, s, items] of parts) {
    const sec = section(id, t, s, items, saved);
    if (sec) { nav.push([id, t]); html += sec; }
  }
  if (r.next_steps?.length) html = `<section class="rsec next"><div class="rsec-head"><h3>What to do next</h3></div><ol class="steps-list">${r.next_steps.map(s => `<li>${esc(s)}</li>`).join('')}</ol></section>` + html;
  if (r.papersFailed) html = `<p class="notice">The paper database (OpenAlex) didn\u2019t answer. Its free daily budget for your internet connection may be used up (it resets at midnight UTC). Add a free OpenAlex key in Settings, or try again later.</p>` + html;
  html += linksBlock(r.explore);
  nav.push(['r-more', 'More databases']);
  return `<nav class="chipnav">${nav.map(([id, t]) => `<a href="javascript:void 0" data-jump="${id}">${esc(t)}</a>`).join('')}</nav>${html}`;
}

export function compassResources(r, saved) {
  if (!r) return '';
  const ongoing = [...(r.trials || [])];
  const parts = [
    ['c-classics', 'Foundational papers', 'The most-cited existing work \u2014 what everyone in the field has read.', r.foundational],
    ['c-reviews', 'Review articles', 'Read these first: each one summarises dozens of studies.', r.reviews],
    ['c-recent', 'Latest research', 'Published in the last two years.', r.recent],
    ['c-trials', 'Ongoing studies', 'Registered studies that are recruiting or still running (ClinicalTrials.gov).', ongoing],
    ['c-preprints', 'Work in progress (preprints)', 'Very new research shared before peer review.', r.preprints],
    ['c-books', 'Books', 'Checked against Open Library and Google Books.', r.books],
    ['c-wiki', 'Encyclopedia starting points', 'Quick background on each key concept.', r.wiki],
    ['c-videos', 'Videos & lectures', 'Each one opens a YouTube search.', r.videos],
    ['c-courses', 'Courses', 'Structured ways to learn the background.', r.courses],
    ['c-web', 'Websites & guides', 'Found with Google Search.', r.websites],
  ];
  const nav = [];
  let html = '';
  for (const [id, t, s, items] of parts) {
    const sec = section(id, t, s, items, saved);
    if (sec) { nav.push([id, t]); html += sec; }
  }
  if (r.papersFailed) html = `<p class="notice">The paper database (OpenAlex) didn\u2019t answer. It may be busy or your daily free limit was reached \u2014 try again later, or add a free OpenAlex key in Settings. The links under \u201cKeep exploring\u201d still work.</p>` + html;
  html += linksBlock(r.explore);
  nav.push(['r-more', 'More databases']);
  return `<nav class="chipnav">${nav.map(([id, t]) => `<a href="javascript:void 0" data-jump="${id}">${esc(t)}</a>`).join('')}</nav>${html}`;
}

export function allItems(r) {
  if (!r) return [];
  return ['related', 'cited', 'foundational', 'reviews', 'recent', 'preprints', 'trials', 'books', 'wiki', 'videos', 'courses', 'websites'].flatMap(k => r[k] || []);
}

export function bindResources(root, owner, persist) {
  root.addEventListener('click', async e => {
    const jump = e.target.closest('[data-jump]');
    if (jump) { document.getElementById(jump.dataset.jump)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
    const cite = e.target.closest('[data-cite]');
    if (cite) { copy(cite.dataset.cite.replace(/\*/g, '')); return; }
    const sv = e.target.closest('[data-save]');
    if (sv) {
      const key = sv.dataset.save;
      owner.saved = owner.saved || [];
      const i = owner.saved.findIndex(s => s.key === key);
      if (i >= 0) owner.saved.splice(i, 1);
      else {
        const it = allItems(owner.resources || owner.results).find(x => keyOf(x) === key);
        if (it) owner.saved.push({ key, kind: it.kind, title: it.title || it.name, url: it.url, cite: ['paper', 'book'].includes(it.kind) ? apa(it).replace(/\*/g, '') : '' });
      }
      const on = i < 0;
      root.querySelectorAll(`[data-save="${CSS.escape(key)}"]`).forEach(b => { b.classList.toggle('on', on); b.textContent = on ? '\u2713 Saved' : '+ Save'; b.setAttribute('aria-pressed', on); });
      await persist();
      if (on) toast('Added to your reading list', 'ok', 1600);
      document.dispatchEvent(new CustomEvent('saved-changed'));
    }
  });
}

export function readingListMarkdown(title, saved) {
  const lines = [`# Reading list: ${title}`, ''];
  const groups = { paper: 'Papers', book: 'Books', trial: 'Ongoing studies', wiki: 'Background', video: 'Videos', course: 'Courses', web: 'Websites' };
  for (const [k, label] of Object.entries(groups)) {
    const items = saved.filter(s => s.kind === k);
    if (!items.length) continue;
    lines.push(`## ${label}`, '');
    items.forEach(s => lines.push(`- ${s.cite || s.title}${s.cite && s.url && !s.cite.includes(s.url) ? ` ${s.url}` : ''}${!s.cite ? ` \u2014 ${s.url}` : ''}`));
    lines.push('');
  }
  return lines.join('\n');
}
