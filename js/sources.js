import { getSettings } from './store.js';
import { keywords } from './util.js';

const OA = 'https://api.openalex.org';
const OA_FIELDS = 'id,doi,display_name,publication_year,publication_date,cited_by_count,authorships,primary_location,open_access,type,abstract_inverted_index,best_oa_location';

async function getJSON(url, opts) {
  const res = await fetch(url, opts);
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).hostname}`);
  return res.json();
}

function oaUrl(path, params) {
  const p = new URLSearchParams(params);
  const key = getSettings().openalexKey;
  if (key) p.set('api_key', key);
  return `${OA}${path}?${p}`;
}

const cleanQ = q => String(q).replace(/[,:|!()"]/g, ' ').replace(/\s+/g, ' ').trim();

function abstractFrom(inv) {
  if (!inv) return '';
  const words = [];
  for (const [w, pos] of Object.entries(inv)) for (const p of pos) words[p] = w;
  return words.filter(Boolean).join(' ');
}

export function normWork(w) {
  const loc = w.primary_location || {};
  const doi = w.doi ? w.doi.replace('https://doi.org/', '') : '';
  return {
    kind: 'paper',
    id: w.id?.replace('https://openalex.org/', ''),
    title: w.display_name || 'Untitled',
    authors: (w.authorships || []).map(a => a.author?.display_name).filter(Boolean),
    year: w.publication_year,
    date: w.publication_date,
    cites: w.cited_by_count || 0,
    venue: loc.source?.display_name || '',
    type: w.type,
    doi,
    url: w.doi || loc.landing_page_url || w.id,
    pdf: w.best_oa_location?.pdf_url || w.open_access?.oa_url || '',
    oa: !!w.open_access?.is_oa,
    abstract: abstractFrom(w.abstract_inverted_index).slice(0, 700),
  };
}

export async function searchPapers(query, { sort, filter = [], perPage = 8 } = {}) {
  const q = cleanQ(query);
  if (!q) return [];
  const params = { filter: [`title_and_abstract.search:${q}`, ...filter].join(','), per_page: perPage, select: OA_FIELDS };
  if (sort) params.sort = sort;
  const data = await getJSON(oaUrl('/works', params));
  return (data.results || []).map(normWork).filter(p => p.title && p.title !== 'Untitled');
}

export async function findPaper(title) {
  const q = cleanQ(title);
  if (q.length < 8) return null;
  const data = await getJSON(oaUrl('/works', { filter: `title.search:${q}`, per_page: 3, select: OA_FIELDS + ',related_works,referenced_works' }));
  const want = q.toLowerCase().replace(/[^a-z0-9]/g, '');
  const hit = (data.results || []).find(w => {
    const t = (w.display_name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    return t && (t === want || (t.length > 20 && (want.includes(t) || t.includes(want))));
  });
  if (!hit) return null;
  return { work: normWork(hit), related: hit.related_works || [], referenced: hit.referenced_works || [] };
}

export async function worksByIds(ids, { sort = 'cited_by_count:desc', perPage = 10 } = {}) {
  const list = ids.map(i => i.replace('https://openalex.org/', '')).slice(0, 50);
  if (!list.length) return [];
  const data = await getJSON(oaUrl('/works', { filter: `openalex:${list.join('|')}`, per_page: perPage, sort, select: OA_FIELDS }));
  return (data.results || []).map(normWork);
}

const stem = w => w.toLowerCase().slice(0, Math.max(4, w.length - 2));
const normTitle = t => String(t).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60);

// put papers whose *title* is clearly about the query first, most-cited first
function rank(list, q, n, byCites = true) {
  const kw = keywords(q, 8).map(stem);
  const score = p => kw.length ? kw.filter(k => p.title.toLowerCase().includes(k)).length / kw.length : 1;
  const strong = list.filter(p => score(p) >= 0.5);
  if (byCites) strong.sort((a, b) => b.cites - a.cites);
  return [...strong, ...list.filter(p => score(p) < 0.5)].slice(0, n);
}

async function relevantCited(q, filter, n) {
  let list = await searchPapers(q, { filter: [...filter, 'cited_by_count:>30'], perPage: 25 });
  if (list.length < 4) list = list.concat(await searchPapers(q, { filter, perPage: 25 }));
  return rank(list, q, n);
}

export async function papersBundle(queries, { recentYears = 2 } = {}) {
  const q = queries[0];
  const since = `${new Date().getFullYear() - recentYears}-01-01`;
  const settled = await Promise.allSettled([
    relevantCited(q, ['type:article|book-chapter|book'], 10),
    searchPapers(q, { filter: [`from_publication_date:${since}`, 'type:article'], perPage: 15 }).then(l => rank(l, q, 8, false)),
    relevantCited(q, ['type:review'], 6),
    searchPapers(q, { filter: [`from_publication_date:${since}`, 'type:preprint'], perPage: 12 }).then(l => rank(l, q, 6, false)),
    ...queries.slice(1, 3).map(x => searchPapers(x, { filter: ['cited_by_count:>50'], perPage: 6 }).then(l => rank(l, x, 4))),
  ]);
  const val = i => settled[i]?.status === 'fulfilled' ? settled[i].value : [];
  const extra = settled.slice(4).flatMap(s => s.status === 'fulfilled' ? s.value : []);
  const seen = new Set();
  const uniq = arr => arr.filter(p => { const k = normTitle(p.title); if (seen.has(p.id) || seen.has(k)) return false; seen.add(p.id); seen.add(k); return true; });
  return {
    foundational: uniq([...val(0), ...extra]).slice(0, 10),
    reviews: uniq(val(2)),
    recent: uniq(val(1)),
    preprints: uniq(val(3)),
    failed: settled.every(s => s.status === 'rejected'),
  };
}

export async function ongoingTrials(query, mustMatch = []) {
  const q = cleanQ(query);
  const params = new URLSearchParams({
    'query.term': q,
    'filter.overallStatus': 'RECRUITING,NOT_YET_RECRUITING,ACTIVE_NOT_RECRUITING,ENROLLING_BY_INVITATION',
    pageSize: '12',
    fields: 'NCTId,BriefTitle,OverallStatus,StartDate,PrimaryCompletionDate,Condition,LeadSponsorName,Phase,StudyType',
  });
  const data = await getJSON(`https://clinicaltrials.gov/api/v2/studies?${params}`);
  const words = (mustMatch.length ? mustMatch : keywords(q)).map(w => w.toLowerCase().slice(0, Math.max(4, w.length - 2)));
  return (data.studies || []).map(s => {
    const p = s.protocolSection || {};
    return {
      kind: 'trial',
      id: p.identificationModule?.nctId,
      title: p.identificationModule?.briefTitle,
      status: (p.statusModule?.overallStatus || '').replace(/_/g, ' ').toLowerCase(),
      start: p.statusModule?.startDateStruct?.date,
      end: p.statusModule?.primaryCompletionDateStruct?.date,
      sponsor: p.sponsorCollaboratorsModule?.leadSponsor?.name,
      conditions: p.conditionsModule?.conditions || [],
      phase: (p.designModule?.phases || []).join(', '),
      url: `https://clinicaltrials.gov/study/${p.identificationModule?.nctId}`,
    };
  }).filter(t => {
    const hay = (t.title + ' ' + t.conditions.join(' ')).toLowerCase();
    const hits = words.filter(w => hay.includes(w)).length;
    return hits >= Math.min(2, words.length);
  }).slice(0, 8);
}

export async function books(query, limit = 8) {
  const q = cleanQ(query);
  const kq = keywords(q, 5).join(' ') || q;
  const out = [];
  try {
    const data = await getJSON(`https://www.googleapis.com/books/v1/volumes?${new URLSearchParams({ q: kq, maxResults: String(limit * 2), printType: 'books', orderBy: 'relevance' })}`);
    for (const v of data.items || []) {
      const i = v.volumeInfo || {};
      out.push({ kind: 'book', title: i.title, authors: i.authors || [], year: (i.publishedDate || '').slice(0, 4), cover: (i.imageLinks?.thumbnail || '').replace('http:', 'https:'), url: i.infoLink || i.canonicalVolumeLink, source: 'Google Books', _about: [i.title, i.subtitle, ...(i.categories || []), (i.description || '').slice(0, 300)].join(' ') });
    }
  } catch {}
  try {
    const data = await getJSON(`https://openlibrary.org/search.json?${new URLSearchParams({ q: kq, limit: String(limit * 3), fields: 'key,title,subtitle,author_name,first_publish_year,cover_i,edition_count,ebook_access,subject' })}`);
    for (const d of data.docs || []) out.push({ ...olBook(d), _about: [d.title, d.subtitle, ...(d.subject || []).slice(0, 40)].join(' ') });
  } catch {}
  // keep books that are actually about the topic (title, subtitle, subjects or blurb mention it)
  const kw = keywords(q, 8).map(w => w.toLowerCase().slice(0, Math.max(4, w.length - 2)));
  const hits = b => { const t = String(b._about || b.title).toLowerCase(); return kw.filter(k => t.includes(k)).length; };
  const need = Math.min(kw.length, kw.length >= 3 ? 2 : 1);
  const seen = new Set();
  return out.filter(b => b.title && hits(b) >= need)
    .sort((a, b) => hits(b) - hits(a))
    .filter(b => { const k = normTitle(b.title); return !seen.has(k) && seen.add(k); })
    .slice(0, limit).map(({ _about, ...b }) => b);
}

function olBook(d) {
  return {
    kind: 'book',
    title: d.title,
    authors: d.author_name || [],
    year: d.first_publish_year,
    cover: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : '',
    url: `https://openlibrary.org${d.key}`,
    editions: d.edition_count,
    readable: d.ebook_access === 'public' || d.ebook_access === 'borrowable',
    source: 'Open Library',
  };
}

export async function findBook(title, author = '') {
  try {
    const p = new URLSearchParams({ title, limit: '1', fields: 'key,title,author_name,first_publish_year,cover_i,edition_count,ebook_access' });
    if (author) p.set('author', author.split(/,| and |&/)[0].trim());
    const data = await getJSON(`https://openlibrary.org/search.json?${p}`);
    if (data.docs?.[0]) return olBook(data.docs[0]);
  } catch {}
  return null;
}

export async function wiki(query, limit = 1) {
  const p = new URLSearchParams({
    action: 'query', format: 'json', origin: '*', generator: 'search', gsrsearch: query, gsrlimit: String(limit),
    prop: 'extracts|info', exintro: '1', explaintext: '1', exsentences: '2', exlimit: String(limit), inprop: 'url', redirects: '1',
  });
  const data = await getJSON(`https://en.wikipedia.org/w/api.php?${p}`);
  return Object.values(data.query?.pages || {}).sort((a, b) => a.index - b.index).map(pg => ({
    kind: 'wiki', title: pg.title, extract: pg.extract || '', url: pg.fullurl,
  }));
}

export async function wikiMany(queries) {
  const res = await Promise.allSettled(queries.slice(0, 10).map(q => wiki(q, 1)));
  const seen = new Set();
  return res.flatMap(r => r.status === 'fulfilled' ? r.value : []).filter(w => w.extract && !/may refer to/.test(w.extract) && !seen.has(w.title) && seen.add(w.title));
}

const enc = encodeURIComponent;
export const ytSearch = q => `https://www.youtube.com/results?search_query=${enc(q)}`;
export const googleSearch = q => `https://www.google.com/search?q=${enc(q)}`;

const COURSE_SITES = [
  [/coursera/i, q => `https://www.coursera.org/search?query=${enc(q)}`],
  [/edx/i, q => `https://www.edx.org/search?q=${enc(q)}`],
  [/khan/i, q => `https://www.khanacademy.org/search?page_search_query=${enc(q)}`],
  [/mit|opencourseware|ocw/i, q => `https://ocw.mit.edu/search/?q=${enc(q)}`],
  [/youtube/i, q => ytSearch(q)],
  [/futurelearn/i, q => `https://www.futurelearn.com/search?q=${enc(q)}`],
  [/udemy/i, q => `https://www.udemy.com/courses/search/?q=${enc(q)}`],
  [/open university|openlearn/i, q => `https://www.open.edu/openlearn/search-results?keys=${enc(q)}`],
  [/stanford/i, q => `https://online.stanford.edu/search-catalog?keywords=${enc(q)}`],
];
export function courseLink(provider, title) {
  for (const [re, fn] of COURSE_SITES) if (re.test(provider || '')) return fn(title);
  return googleSearch(`${title} ${provider || ''} course`);
}

export function exploreLinks(q) {
  const e = enc(q);
  return {
    papers: [
      ['Google Scholar', `https://scholar.google.com/scholar?q=${e}`],
      ['Semantic Scholar', `https://www.semanticscholar.org/search?q=${e}`],
      ['OpenAlex', `https://openalex.org/works?search=${e}`],
      ['CORE (free full texts)', `https://core.ac.uk/search?q=${e}`],
      ['BASE', `https://www.base-search.net/Search/Results?lookfor=${e}`],
      ['arXiv', `https://arxiv.org/search/?query=${e}&searchtype=all`],
      ['PubMed', `https://pubmed.ncbi.nlm.nih.gov/?term=${e}`],
      ['DOAJ (open journals)', `https://doaj.org/search/articles?ref=homepage-box&source=${enc(JSON.stringify({ query: { query_string: { query: q, default_operator: 'AND' } } }))}`],
      ['ERIC (education)', `https://eric.ed.gov/?q=${e}`],
      ['PhilPapers', `https://philpapers.org/s/${e}`],
    ],
    ongoing: [
      ['ClinicalTrials.gov', `https://clinicaltrials.gov/search?term=${e}`],
      ['WHO trial registry', `https://trialsearch.who.int/?SearchAll=${e}`],
      ['NIH RePORTER (funded projects)', `https://reporter.nih.gov/search/results?query=${e}`],
      ['NSF awards', `https://www.nsf.gov/awardsearch/simple-search-results?keyword=${e}`],
      ['UKRI Gateway to Research', `https://gtr.ukri.org/search/project?term=${e}`],
      ['CORDIS (EU research)', `https://cordis.europa.eu/search?q=${e}`],
      ['OSF preregistrations', `https://osf.io/search?search=${e}&resourceType=Registration`],
      ['bioRxiv / medRxiv preprints', `https://www.biorxiv.org/search/${e}`],
      ['SSRN preprints', `https://www.ssrn.com/index.cfm/en/search-results/?term=${e}`],
    ],
    books: [
      ['Open Library', `https://openlibrary.org/search?q=${e}`],
      ['Google Books', `https://www.google.com/search?tbm=bks&q=${e}`],
      ['Internet Archive', `https://archive.org/search?query=${e}`],
      ['OpenStax (free textbooks)', `https://openstax.org/search?q=${e}`],
      ['WorldCat (find it in a library)', `https://search.worldcat.org/search?q=${e}`],
    ],
    learn: [
      ['YouTube', ytSearch(q + ' explained')],
      ['Khan Academy', `https://www.khanacademy.org/search?page_search_query=${e}`],
      ['MIT OpenCourseWare', `https://ocw.mit.edu/search/?q=${e}`],
      ['Coursera', `https://www.coursera.org/search?query=${e}`],
      ['edX', `https://www.edx.org/search?q=${e}`],
      ['TED Talks', `https://www.ted.com/search?q=${e}`],
      ['Stanford Encyclopedia of Philosophy', `https://plato.stanford.edu/search/searcher.py?query=${e}`],
      ['Britannica', `https://www.britannica.com/search?query=${e}`],
    ],
  };
}

export function apa(p) {
  const names = (p.authors || []).map(n => {
    const parts = n.trim().split(/\s+/);
    const last = parts.pop();
    return `${last}, ${parts.map(x => x[0] + '.').join(' ')}`.trim().replace(/,\s*$/, '');
  });
  let who = names.length > 20 ? names.slice(0, 19).join(', ') + ', \u2026 ' + names[names.length - 1]
    : names.length > 1 ? names.slice(0, -1).join(', ') + ', & ' + names[names.length - 1] : names[0] || '';
  if (p.kind === 'book') return `${who}${who ? ' ' : ''}(${p.year || 'n.d.'}). *${p.title}*.`;
  const link = p.doi ? `https://doi.org/${p.doi}` : p.url;
  return `${who}${who ? ' ' : ''}(${p.year || 'n.d.'}). ${p.title}.${p.venue ? ` *${p.venue}*.` : ''} ${link || ''}`.trim();
}
