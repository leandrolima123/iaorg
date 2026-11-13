// Espelho dos arquivos da empresa no Google Drive: a pasta "IAORG — <empresa>" no Drive recebe a mesma
// árvore de pastas e arquivos do workspace. Usa o escopo drive.file (o IAORG só enxerga o que ele criou).
// Sobe o que mudou (tamanho/data, depois hash), manda para a lixeira do Drive o que saiu daqui.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as google from './google.js';
import { encrypt, decrypt } from './secrets.js';
import { mimeOf } from './files.js';

const API = 'https://www.googleapis.com/drive/v3/files';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const FOLDER = 'application/vnd.google-apps.folder';
const MAX_SIZE = 100 * 1024 * 1024;
const timers = new Map();
const running = new Map();

const conn = (store) => (store.state.integrations?.google_drive?.connected ? store.state.integrations.google_drive : null);
export const rootName = (store) => `IAORG — ${store.company.name}`;

async function token(store) {
  const c = conn(store);
  const t = JSON.parse(decrypt(c.secret) || '{}');
  return google.accessToken(t, (next) => { c.secret = encrypt(JSON.stringify(next)); store.save(); });
}

export function status(store) {
  const c = conn(store);
  if (!c) return null;
  const s = c.sync || {};
  return {
    account: c.account, folder: rootName(store), lastSync: s.lastSync || null, files: Object.keys(s.index || {}).length,
    error: c.error || '', running: running.has(store.id), url: s.rootId ? `https://drive.google.com/drive/folders/${s.rootId}` : null,
  };
}

/** Agenda um espelhamento (junta várias mudanças seguidas num só). */
export function schedule(store, rt, delay = 4000) {
  if (!conn(store)) return;
  clearTimeout(timers.get(store.id));
  timers.set(store.id, setTimeout(() => { syncNow(store, rt).catch(() => {}); }, delay));
}

export async function syncNow(store, rt) {
  const c = conn(store);
  if (!c) return { error: 'Google Drive não conectado' };
  if (running.has(store.id)) { running.set(store.id, 'de novo'); return { ok: true, queued: true }; }
  running.set(store.id, true);
  try {
    const r = await doSync(store);
    c.error = '';
    if (r.uploaded || r.removed) rt?.logEvent('file', null, `Google Drive: ${r.uploaded} arquivo(s) enviado(s)${r.removed ? `, ${r.removed} para a lixeira do Drive` : ''}`);
    return { ok: true, ...r };
  } catch (e) {
    c.error = e.message;
    return { error: e.message };
  } finally {
    store.save();
    const again = running.get(store.id) === 'de novo';
    running.delete(store.id);
    rt?.emit({ type: 'files' });
    if (again) schedule(store, rt, 1000);
  }
}

async function doSync(store) {
  const c = conn(store);
  const s = (c.sync ||= { index: {}, folders: {} });
  const tok = await token(store);
  const call = async (method, url, body, raw) => {
    const res = await fetch(url, {
      method,
      headers: { Authorization: `Bearer ${tok}`, ...(raw ? { 'Content-Type': raw.type } : body ? { 'Content-Type': 'application/json' } : {}) },
      body: raw ? raw.body : body ? JSON.stringify(body) : undefined,
    });
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) { const e = new Error(`Google Drive ${res.status}: ${data?.error?.message || res.statusText}`); e.status = res.status; throw e; }
    return data;
  };
  const createFolder = async (name, parent) => (await call('POST', `${API}?fields=id`, { name, mimeType: FOLDER, ...(parent ? { parents: [parent] } : {}) })).id;

  // Pasta raiz (recria se o dono apagou ou mandou para a lixeira).
  let rootOk = false;
  if (s.rootId) { try { rootOk = !(await call('GET', `${API}/${s.rootId}?fields=id,trashed`)).trashed; } catch { rootOk = false; } }
  if (!rootOk) { s.rootId = await createFolder(rootName(store)); s.folders = {}; s.index = {}; }

  const folderId = async (rel) => {
    if (!rel || rel === '.') return s.rootId;
    if (s.folders[rel]) return s.folders[rel];
    const parent = await folderId(path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel));
    s.folders[rel] = await createFolder(path.posix.basename(rel), parent);
    return s.folders[rel];
  };

  let uploaded = 0;
  let removed = 0;
  const files = store.listFiles();
  const here = new Set(files.map((f) => f.path));
  for (const folder of store.listFolders()) await folderId(folder); // pastas vazias também aparecem no Drive

  for (const f of files) {
    if (f.size > MAX_SIZE) continue;
    const idx = s.index[f.path];
    if (idx && idx.size === f.size && idx.mtime === f.mtime) continue;
    const data = fs.readFileSync(store.safePath(f.path));
    const sha = crypto.createHash('sha1').update(data).digest('hex');
    if (idx && idx.sha === sha) { Object.assign(idx, { size: f.size, mtime: f.mtime }); continue; }
    const mime = mimeOf(f.path).split(';')[0];
    let id = idx?.id;
    if (id) {
      try { await call('PATCH', `${UPLOAD}/${id}?uploadType=media&fields=id`, null, { type: mime, body: data }); }
      catch (e) { if (e.status === 404) id = null; else throw e; }
    }
    if (!id) {
      const parent = await folderId(path.posix.dirname(f.path) === '.' ? '' : path.posix.dirname(f.path));
      const boundary = `iaorg${crypto.randomBytes(8).toString('hex')}`;
      const meta = JSON.stringify({ name: path.posix.basename(f.path), parents: [parent] });
      const body = Buffer.concat([
        Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`),
        data, Buffer.from(`\r\n--${boundary}--`),
      ]);
      id = (await call('POST', `${UPLOAD}?uploadType=multipart&fields=id`, null, { type: `multipart/related; boundary=${boundary}`, body })).id;
    }
    s.index[f.path] = { id, size: f.size, mtime: f.mtime, sha };
    uploaded++;
  }

  // Saiu daqui (excluído/movido) → lixeira do Drive.
  for (const [p, idx] of Object.entries(s.index)) {
    if (here.has(p)) continue;
    try { await call('PATCH', `${API}/${idx.id}`, { trashed: true }); } catch (e) { if (e.status !== 404) throw e; }
    delete s.index[p];
    removed++;
  }
  const folders = new Set(store.listFolders());
  for (const [p, id] of Object.entries(s.folders).sort((a, b) => b[0].length - a[0].length)) {
    if (folders.has(p)) continue;
    try { await call('PATCH', `${API}/${id}`, { trashed: true }); } catch (e) { if (e.status !== 404) throw e; }
    delete s.folders[p];
  }
  s.lastSync = Date.now();
  return { uploaded, removed };
}
