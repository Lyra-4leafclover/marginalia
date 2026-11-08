import { generate, hasKey } from './ai.js';
import { put } from './store.js';
import { keywords } from './util.js';
import { papersBundle, ongoingTrials, books, findBook, wiki, wikiMany, ytSearch, courseLink, googleSearch, exploreLinks } from './sources.js';
import { groundedWebsites } from './explain.js';

const STR = { type: 'STRING' };
const ARR = items => ({ type: 'ARRAY', items });
const OBJ = (properties, required = Object.keys(properties)) => ({ type: 'OBJECT', properties, required });

const PLAN_SCHEMA = OBJ({
  field: STR, summary: STR,
  search_queries: ARR(STR),
  concepts: ARR(OBJ({ name: STR, why: STR })),
  subtopics: ARR(STR),
  research_questions: ARR(STR),
  angles: ARR(OBJ({ angle: STR, why: STR })),
  methods: ARR(OBJ({ method: STR, why: STR })),
  outline: ARR(STR),
  textbooks: ARR(OBJ({ title: STR, author: STR, why: STR })),
  courses: ARR(OBJ({ title: STR, provider: STR, why: STR })),
  videos: ARR(OBJ({ title: STR, creator: STR, why: STR })),
  health_related: { type: 'BOOLEAN' },
  trial_query: STR,
});

async function makePlan(p, opts) {
  const prompt = `A student wants to write their own research paper titled or about: "${p.title}".
${p.notes ? `Extra context from them: ${p.notes}\n` : ''}Act as a kind, expert research supervisor. Help them understand the landscape and plan.
field: academic field(s). summary: 3\u20134 sentences on what is already known and debated about this topic.
search_queries: 4 short scholarly search phrases (2\u20135 words, English, most central first) to find existing papers.
concepts: 6\u201310 key concepts to learn first {name (Wikipedia article title), why}.
subtopics: 5\u20138 subtopics to explore.
research_questions: 6\u20138 specific, answerable research questions they could investigate.
angles: 4\u20136 fresh angles or gaps in the literature {angle, why it is interesting or under-studied}.
methods: 3\u20135 suitable research methods {method, why}.
outline: 6\u20139 section headings for their paper.
textbooks: 4\u20136 real, well-known books {title, author, why}. Only books you are confident exist.
courses: 3\u20135 real courses {title, provider, why}.
videos: 4\u20136 videos, lectures or channels to search for {title, creator, why}.
health_related: true if the topic involves medicine, health, psychology interventions or clinical research.
trial_query: if health_related, a 2\u20134 word query for a clinical trials registry, else "".`;
  const { data } = await generate({ prompt, schema: PLAN_SCHEMA, temperature: 0.5, ...opts });
  return data;
}

function basicPlan(p) {
  const kw = keywords(p.title, 8);
  return { search_queries: [kw.slice(0, 5).join(' ') || p.title], concepts: [], subtopics: [p.title], basic: true };
}

export async function runCompass(project, emit = () => {}, opts = {}) {
  const ai = hasKey();
  project.error = '';
  if (!project.plan || (project.plan.basic && ai)) {
    emit('Mapping your topic\u2026');
    project.plan = ai ? await makePlan(project, opts).catch(e => { if (e.name === 'AbortError') throw e; project.error = e.message; return basicPlan(project); }) : basicPlan(project);
    await put('projects', project);
    emit('plan');
  }
  const plan = project.plan;
  const queries = (plan.search_queries?.length ? plan.search_queries : [project.title]);
  emit('Searching papers, studies, books and more\u2026');
  const wantTrials = plan.basic || plan.health_related;
  const [bundle, trials, bookList, verified, wikis, websites] = await Promise.all([
    papersBundle(queries).catch(() => ({ foundational: [], reviews: [], recent: [], preprints: [], failed: true })),
    wantTrials ? ongoingTrials(plan.trial_query || queries[0]).catch(() => []) : Promise.resolve([]),
    books(queries[0], 8).catch(() => []),
    Promise.all((plan.textbooks || []).slice(0, 6).map(async b => {
      const hit = await findBook(b.title, b.author);
      return hit ? { ...hit, why: b.why } : { kind: 'book', title: b.title, authors: [b.author], why: b.why, url: googleSearch(`${b.title} ${b.author} book`), unverified: true };
    })),
    (plan.basic ? wiki(project.title, 4).then(l => l.filter(w => w.extract && !/may refer to/.test(w.extract))) : wikiMany((plan.concepts || []).map(c => c.name))).catch(() => []),
    ai ? groundedWebsites(project.title, opts) : Promise.resolve([]),
  ]);
  const why = Object.fromEntries((plan.concepts || []).map(c => [String(c.name).toLowerCase(), c.why]));
  const seenBook = new Set();
  const subVideos = (plan.subtopics || []).slice(0, 4).map(s => ({ kind: 'video', title: s, creator: '', why: 'Search for lectures and explainers on this subtopic', url: ytSearch(`${s} explained`) }));
  project.results = {
    built: Date.now(),
    foundational: bundle.foundational, reviews: bundle.reviews, recent: bundle.recent, preprints: bundle.preprints,
    papersFailed: !!bundle.failed,
    trials,
    books: [...verified, ...bookList].filter(b => { const k = b.title.toLowerCase(); return !seenBook.has(k) && seenBook.add(k); }).slice(0, 12),
    wiki: wikis.map(w => ({ ...w, why: why[w.title.toLowerCase()] || '' })),
    videos: [...(plan.videos || []).map(v => ({ kind: 'video', ...v, url: ytSearch(`${v.title} ${v.creator || ''}`.trim()) })), ...subVideos],
    courses: (plan.courses || []).map(c => ({ kind: 'course', ...c, url: courseLink(c.provider, c.title) })),
    websites,
    explore: exploreLinks(queries[0]),
  };
  project.updated = Date.now();
  await put('projects', project);
  emit('done');
  return project;
}
