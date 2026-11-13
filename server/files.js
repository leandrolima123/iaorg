// Gerenciador de arquivos da empresa: pastas, prévia com o tipo certo, enviar, mover/renomear,
// excluir (vai para a lixeira) e quem fez cada arquivo. Toda mudança dispara o espelho no Google Drive.
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import * as drive from './drive.js';

const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', avif: 'image/avif', bmp: 'image/bmp', ico: 'image/x-icon',
  pdf: 'application/pdf', mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg',
  md: 'text/markdown; charset=utf-8', markdown: 'text/markdown; charset=utf-8', txt: 'text/plain; charset=utf-8', csv: 'text/csv; charset=utf-8', tsv: 'text/tab-separated-values; charset=utf-8',
  json: 'application/json; charset=utf-8', html: 'text/plain; charset=utf-8', htm: 'text/plain; charset=utf-8', xml: 'text/plain; charset=utf-8', yml: 'text/plain; charset=utf-8', yaml: 'text/plain; charset=utf-8',
  js: 'text/plain; charset=utf-8', ts: 'text/plain; charset=utf-8', py: 'text/plain; charset=utf-8', css: 'text/plain; charset=utf-8', sql: 'text/plain; charset=utf-8', log: 'text/plain; charset=utf-8',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', zip: 'application/zip',
};
export const mimeOf = (p) => MIME[String(p).split('.').pop().toLowerCase()] || 'application/octet-stream';

// Quem fez/alterou cada arquivo (agente ou pessoa) e em qual tarefa.
const metaOf = (store) => (store.state.fileMeta ||= {});
export function recordWrite(store, rel, { by, task } = {}) {
  metaOf(store)[rel] = { by, task: task || null, at: Date.now() };
}
function moveMeta(store, from, to) {
  const m = metaOf(store);
  for (const k of Object.keys(m)) {
    if (k === from || k.startsWith(`${from}/`)) { m[to + k.slice(from.length)] = m[k]; delete m[k]; }
  }
}
function dropMeta(store, rel) {
  const m = metaOf(store);
  for (const k of Object.keys(m)) if (k === rel || k.startsWith(`${rel}/`)) delete m[k];
}

// Nome seguro para arquivo/pasta (mantém acentos; tira barras e caracteres problemáticos).
const cleanName = (s) => String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/^\.+/, '').trim().slice(0, 120);
const cleanPath = (p) => String(p || '').split('/').map(cleanName).filter(Boolean).join('/');

export function mountFiles(app, { requireCompany, need, wrap, runtimeFor, hasRole }) {
  const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
  const changed = (store, rt, text, byId) => {
    if (text) rt.logEvent('file', byId, text);
    rt.emit({ type: 'files' });
    store.save();
    drive.schedule(store, rt);
  };

  app.get('/api/files', requireCompany, (req, res) => {
    const store = req.company;
    const meta = metaOf(store);
    const files = store.listFiles().map((f) => ({ ...f, mime: mimeOf(f.path), by: meta[f.path]?.by || null, task: meta[f.path]?.task || null }));
    res.json({ files, folders: store.listFolders(), drive: drive.status(store) });
  });

  // Conteúdo com o tipo certo: imagens, PDF, áudio e vídeo abrem no navegador; HTML/SVG nunca executam.
  app.get('/api/file', requireCompany, (req, res) => {
    try {
      const full = req.company.safePath(req.query.path);
      if (!fs.existsSync(full) || fs.statSync(full).isDirectory()) return bad(res, 'Arquivo não encontrado', 404);
      if (req.query.download) return res.download(full);
      const mime = mimeOf(full);
      res.set('X-Content-Type-Options', 'nosniff');
      // SVG pode conter script: abre isolado (sem script) se alguém abrir direto na aba.
      if (mime === 'image/svg+xml') res.set('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
      res.type(mime).sendFile(full);
    } catch (e) { bad(res, e.message); }
  });

  app.post('/api/files/upload', requireCompany, express.raw({ type: () => true, limit: '25mb' }), (req, res) => {
    try {
      const store = req.company;
      const folder = cleanPath(req.query.folder) || 'Uploads';
      const name = cleanName(path.basename(String(req.query.name || ''))) || 'arquivo';
      let rel = `${folder}/${name}`;
      let n = 1;
      while (fs.existsSync(store.safePath(rel))) { const ext = path.extname(name); rel = `${folder}/${path.basename(name, ext)} (${++n})${ext}`; }
      const full = store.safePath(rel);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, req.body);
      recordWrite(store, rel, { by: req.member.id });
      changed(store, runtimeFor(store), `${req.member.name} enviou ${rel}`, req.member.id);
      res.json({ path: rel });
    } catch (e) { bad(res, e.message); }
  });

  app.post('/api/files/folder', requireCompany, (req, res) => {
    try {
      const rel = cleanPath(req.body?.path);
      if (!rel) return bad(res, 'Nome de pasta inválido');
      fs.mkdirSync(req.company.safePath(rel), { recursive: true });
      changed(req.company, runtimeFor(req.company), '', req.member.id);
      res.json({ path: rel });
    } catch (e) { bad(res, e.message); }
  });

  // Mover ou renomear (arquivo ou pasta).
  app.post('/api/files/move', requireCompany, (req, res) => {
    try {
      const store = req.company;
      const from = cleanPath(req.body?.from);
      const to = cleanPath(req.body?.to);
      if (!from || !to) return bad(res, 'Origem e destino são obrigatórios');
      if (to === from || to.startsWith(`${from}/`)) return bad(res, 'Não dá para mover uma pasta para dentro dela mesma');
      const src = store.safePath(from);
      const dst = store.safePath(to);
      if (!fs.existsSync(src)) return bad(res, 'Não encontrado', 404);
      if (fs.existsSync(dst)) return bad(res, 'Já existe algo com esse nome no destino');
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.renameSync(src, dst);
      moveMeta(store, from, to);
      changed(store, runtimeFor(store), `${req.member.name} moveu ${from} → ${to}`, req.member.id);
      res.json({ path: to });
    } catch (e) { bad(res, e.message); }
  });

  // Excluir: vai para .lixeira (some da lista e do Drive; dá para recuperar no servidor).
  app.delete('/api/files', requireCompany, (req, res) => {
    try {
      const store = req.company;
      const rel = cleanPath(req.query.path);
      if (!rel) return bad(res, 'Caminho inválido');
      const by = metaOf(store)[rel]?.by;
      if (!hasRole(req.member, 'admin') && by !== req.member.id) return bad(res, 'Só administradores (ou quem enviou) podem excluir', 403);
      const src = store.safePath(rel);
      if (!fs.existsSync(src)) return bad(res, 'Não encontrado', 404);
      const trash = store.safePath(`.lixeira/${new Date().toISOString().replace(/[:.]/g, '-')}/${rel}`);
      fs.mkdirSync(path.dirname(trash), { recursive: true });
      fs.renameSync(src, trash);
      dropMeta(store, rel);
      changed(store, runtimeFor(store), `${req.member.name} excluiu ${rel}`, req.member.id);
      res.json({ ok: true });
    } catch (e) { bad(res, e.message); }
  });

  app.post('/api/files/drive-sync', requireCompany, need('admin'), wrap(async (req, res) => {
    const out = await drive.syncNow(req.company, runtimeFor(req.company));
    res.json(out);
  }));
}
