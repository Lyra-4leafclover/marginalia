const SETTINGS_KEY = 'marginalia.settings.v1';
const DEFAULTS = { geminiKey: '', model: '', models: [], theme: 'auto', level: 'student', openalexKey: '', layout: 'side' };

export function getSettings() {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') }; }
  catch { return { ...DEFAULTS }; }
}
export function saveSettings(patch) {
  const next = { ...getSettings(), ...patch };
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  return next;
}

let dbp;
function db() {
  if (!dbp) dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open('marginalia', 1);
    req.onupgradeneeded = () => {
      const d = req.result;
      d.createObjectStore('docs', { keyPath: 'id' });
      d.createObjectStore('projects', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}
async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    const r = fn(s);
    t.oncomplete = () => resolve(r && 'result' in r ? r.result : undefined);
    t.onerror = () => reject(t.error);
  });
}
export const put = (store, obj) => tx(store, 'readwrite', s => s.put(JSON.parse(JSON.stringify(obj))));
export const get = (store, id) => tx(store, 'readonly', s => s.get(id));
export const del = (store, id) => tx(store, 'readwrite', s => s.delete(id));
export const all = async store => {
  const list = (await tx(store, 'readonly', s => s.getAll())) || [];
  return list.sort((a, b) => (b.updated || 0) - (a.updated || 0));
};

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
