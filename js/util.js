export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);

export function safeUrl(u) {
  try {
    const url = new URL(u);
    return /^https?:$/.test(url.protocol) ? url.href : '';
  } catch { return ''; }
}

export function link(url, text, cls = '') {
  const u = safeUrl(url);
  if (!u) return esc(text);
  return `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer" class="${cls}">${esc(text)}</a>`;
}

export function toast(msg, kind = 'info', ms = 3800) {
  let box = $('#toasts');
  const t = document.createElement('div');
  t.className = `toast toast-${kind}`;
  t.textContent = msg;
  box.appendChild(t);
  requestAnimationFrame(() => t.classList.add('show'));
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, ms);
}

export function download(name, text, type = 'text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

export async function copy(text) {
  try { await navigator.clipboard.writeText(text); toast('Copied!', 'ok', 1800); }
  catch {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    document.execCommand('copy'); ta.remove(); toast('Copied!', 'ok', 1800);
  }
}

export const fmtDate = ts => new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
export const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
export const truncate = (s, n) => (s && s.length > n ? s.slice(0, n - 1).trimEnd() + '\u2026' : s || '');

export function md(text) {
  // tiny, safe inline markdown: **bold**, *italic*, `code`
  return esc(text)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, '$1<em>$2</em>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br>');
}

const STOP = new Set('a an the of and or in on for to with from by at as is are was were be been being this that these those into over under about between among within without using use based via how what why when which who whom whose do does did can could should would may might will shall its it their our your my his her we you they i not no vs versus toward towards study studies effect effects impact role analysis approach new paper research review case'.split(' '));
export function keywords(text, max = 6) {
  const words = String(text).toLowerCase().replace(/[^a-z0-9\u00c0-\u024f\s-]/g, ' ').split(/\s+/)
    .filter(w => w.length > 2 && !STOP.has(w));
  return [...new Set(words)].slice(0, max);
}
