// Site público do IAORG (landing, privacidade, termos) com a lista de interesse.
// Servidor mínimo, sem dependências: arquivos estáticos + POST /api/interesse + exportação protegida.
// Serve as mesmas páginas do app (public/), em modo "lista de espera" (sem links para o login).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';

const ROOT = path.resolve(process.env.SITE_ROOT || '/app');
const PUB = path.join(ROOT, 'public');
const MODS = path.join(ROOT, 'node_modules');
const DATA_DIR = path.resolve(process.env.DATA_DIR || '/data');
const LEADS = path.join(DATA_DIR, 'interessados.json');
const PORT = +process.env.PORT || 8080;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const NOTIFY = { key: process.env.RESEND_API_KEY || '', to: process.env.LEADS_NOTIFY_TO || '', from: process.env.LEADS_FROM || '' };

// Rotas de páginas e pastas montadas (prefixo da URL → pasta no disco)
const PAGES = { '/': 'landing.html', '/site': 'landing.html', '/privacidade': 'privacidade.html', '/privacy': 'privacidade.html', '/termos': 'termos.html', '/terms': 'termos.html' };
const MOUNTS = [
  ['/vendor/three/', path.join(MODS, 'three')],
  ['/vendor/fonts/archivo/', path.join(MODS, '@fontsource/archivo/files')],
  ['/vendor/fonts/barlow-condensed/', path.join(MODS, '@fontsource/barlow-condensed/files')],
  ['/', PUB],
];
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.mp4': 'video/mp4', '.webm': 'video/webm', '.vtt': 'text/vtt; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8' };
const GZIP = new Set(['.html', '.css', '.js', '.mjs', '.json', '.svg', '.txt', '.gltf', '.xml']);
// Só o que o site precisa fica acessível; o resto do public/ (o app) não é servido aqui.
const ALLOW = [/^\/(landing|privacidade|termos)\.html$/, /^\/site\.css$/, /^\/avatars\.js$/, /^\/brand\//, /^\/videos\//, /^\/assets\/kaykit\/(characters|animations)\//, /^\/assets\/kaykit\/LICENSE/, /^\/vendor\/three\/(build\/three\.module\.js|examples\/jsm\/)/, /^\/vendor\/fonts\//, /^\/robots\.txt$/, /^\/favicon\.ico$/];

const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://i.ytimg.com; media-src 'self'; frame-src https://www.youtube-nocookie.com https://player.vimeo.com; connect-src 'self' blob: data:; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
};
if (process.env.NODE_ENV === 'production') SECURITY['Strict-Transport-Security'] = 'max-age=31536000';

// ---------- lista de interesse ----------
fs.mkdirSync(DATA_DIR, { recursive: true });
try { fs.accessSync(DATA_DIR, fs.constants.W_OK); } catch { console.error(`[site] ATENÇÃO: sem permissão de escrita em ${DATA_DIR}. No Railway, defina RAILWAY_RUN_UID=0 ou monte o volume em uma pasta do usuário node.`); }
let leads = [];
try { leads = JSON.parse(fs.readFileSync(LEADS, 'utf8')); } catch { /* lista vazia */ }
const saveLeads = () => { fs.writeFileSync(LEADS + '.tmp', JSON.stringify(leads, null, 1)); fs.renameSync(LEADS + '.tmp', LEADS); };

const SIZES = ['so-eu', '2-10', '11-50', '51-200', '200+'];
const AREAS = ['atendimento', 'desenvolvimento', 'marketing', 'vendas', 'operacoes', 'financeiro', 'outro'];
const EMAIL = /^[^\s@<>()[\]\\,;:"]{1,64}@[^\s@<>()[\]\\,;:"]+\.[a-z]{2,}$/i;
const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

const hits = new Map(); // ip → [timestamps] (só em memória, não é gravado)
function limited(ip) {
  const now = Date.now(), list = (hits.get(ip) || []).filter((t) => now - t < 10 * 60_000);
  list.push(now); hits.set(ip, list);
  if (hits.size > 5000) for (const [k, v] of hits) if (now - v[v.length - 1] > 10 * 60_000) hits.delete(k);
  return list.length > 6;
}

async function notify(lead, isNew) {
  if (!NOTIFY.key || !NOTIFY.to || !NOTIFY.from) return;
  const text = [`${isNew ? 'Novo interessado' : 'Interessado atualizou o cadastro'} na lista do IAORG`, '', `Nome: ${lead.nome}`, `E-mail: ${lead.email}`, `Empresa: ${lead.empresa || '-'}`, `Equipe: ${lead.tamanho || '-'}`, `Áreas: ${lead.areas.join(', ') || '-'}`, `Mensagem: ${lead.mensagem || '-'}`, '', `Total na lista: ${leads.length}`].join('\n');
  try {
    const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { authorization: `Bearer ${NOTIFY.key}`, 'content-type': 'application/json' }, body: JSON.stringify({ from: NOTIFY.from, to: NOTIFY.to.split(',').map((s) => s.trim()), subject: `IAORG: ${isNew ? 'novo interessado' : 'cadastro atualizado'} — ${lead.nome}`, text }), signal: AbortSignal.timeout(8000) });
    if (!r.ok) console.warn('[site] aviso por e-mail falhou:', r.status);
  } catch (e) { console.warn('[site] aviso por e-mail falhou:', e.message); }
}

function readBody(req, max = 12_000) {
  return new Promise((ok, fail) => {
    let size = 0; const parts = [];
    req.on('data', (c) => { size += c.length; if (size > max) { fail(Object.assign(new Error('grande demais'), { code: 413 })); req.destroy(); } else parts.push(c); });
    req.on('end', () => ok(Buffer.concat(parts).toString('utf8')));
    req.on('error', fail);
  });
}

async function postInterest(req, res, ip) {
  if (!/application\/json/.test(req.headers['content-type'] || '')) return json(res, 415, { error: 'Envie em JSON.' });
  if (limited(ip)) return json(res, 429, { error: 'Muitas tentativas. Espere alguns minutos e tente de novo.' });
  let b;
  try { b = JSON.parse(await readBody(req)); } catch (e) { return json(res, e.code === 413 ? 413 : 400, { error: 'Pedido inválido.' }); }
  if (b.site) return json(res, 200, { ok: true }); // campo-isca: robôs preenchem, pessoas não veem
  const lead = {
    nome: clean(b.nome, 80), email: clean(b.email, 120).toLowerCase(), empresa: clean(b.empresa, 100),
    tamanho: SIZES.includes(b.tamanho) ? b.tamanho : '', areas: (Array.isArray(b.areas) ? b.areas : []).filter((a) => AREAS.includes(a)).slice(0, AREAS.length),
    mensagem: clean(b.mensagem, 600),
  };
  const errors = {};
  if (lead.nome.length < 2) errors.nome = 'Diga como podemos te chamar.';
  if (!EMAIL.test(lead.email)) errors.email = 'Confira o e-mail.';
  if (b.consentimento !== true) errors.consentimento = 'Precisamos da sua autorização para guardar o contato.';
  if (Object.keys(errors).length) return json(res, 422, { error: 'Confira os campos destacados.', campos: errors });
  const now = new Date().toISOString();
  const i = leads.findIndex((l) => l.email === lead.email);
  const isNew = i < 0;
  // reenvio do mesmo e-mail: o que veio vazio mantém o valor anterior
  const prev = isNew ? {} : leads[i];
  const merged = { ...lead };
  for (const k of ['empresa', 'tamanho', 'mensagem']) if (!merged[k] && prev[k]) merged[k] = prev[k];
  if (!merged.areas.length && prev.areas?.length) merged.areas = prev.areas;
  const rec = { id: isNew ? crypto.randomUUID() : prev.id, criadoEm: isNew ? now : prev.criadoEm, atualizadoEm: now, ...merged, consentimento: { em: now, versao: '2026-11-16' } };
  if (isNew) leads.push(rec); else leads[i] = rec;
  try { saveLeads(); } catch (e) { console.error('[site] não consegui gravar a lista:', e.message); return json(res, 500, { error: 'Não conseguimos salvar agora. Tente de novo em instantes.' }); }
  console.log(`[site] interessado ${isNew ? 'novo' : 'atualizado'} (${leads.length} na lista)`);
  notify(rec, isNew);
  return json(res, 200, { ok: true, novo: isNew });
}

// ---------- exportação (só com senha) ----------
function authorized(req) {
  if (!ADMIN_PASSWORD) return false;
  const m = /^Basic (.+)$/.exec(req.headers.authorization || '');
  if (!m) return false;
  const pass = Buffer.from(m[1], 'base64').toString('utf8').split(':').slice(1).join(':');
  const a = crypto.createHash('sha256').update(pass).digest(), b = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}
const csvCell = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };
function exportLeads(req, res, fmt) {
  if (!ADMIN_PASSWORD) return send404(res);
  if (!authorized(req)) { res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="IAORG interessados", charset="UTF-8"', ...SECURITY }); return res.end('Senha necessária.'); }
  if (fmt === 'json') return json(res, 200, leads);
  const head = ['criadoEm', 'atualizadoEm', 'nome', 'email', 'empresa', 'tamanho', 'areas', 'mensagem'];
  const rows = [head.join(';'), ...leads.map((l) => head.map((k) => csvCell(Array.isArray(l[k]) ? l[k].join(', ') : l[k])).join(';'))];
  res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="interessados-${new Date().toISOString().slice(0, 10)}.csv"`, 'Cache-Control': 'no-store', ...SECURITY });
  res.end('﻿' + rows.join('\r\n'));
}

// ---------- estáticos ----------
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...SECURITY }); res.end(JSON.stringify(obj)); };
const send404 = (res) => { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY }); res.end('Página não encontrada.'); };
const gzCache = new Map();
const pageCache = new Map();

function resolveFile(urlPath) {
  for (const [prefix, dir] of MOUNTS) {
    if (!urlPath.startsWith(prefix)) continue;
    const rel = urlPath.slice(prefix.length);
    const file = path.resolve(dir, '.' + path.posix.normalize('/' + rel));
    if (!file.startsWith(dir + path.sep)) return null;
    return file;
  }
  return null;
}

function serveFile(req, res, file, { html = false } = {}) {
  let st;
  try { st = fs.statSync(file); } catch { return send404(res); }
  if (!st.isFile()) return send404(res);
  const ext = path.extname(file).toLowerCase();
  const type = TYPES[ext] || 'application/octet-stream';
  const etag = `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}"`;
  const longLived = /^\/(vendor|assets)\//.test(req.url) || ext === '.woff2';
  const headers = { 'Content-Type': type, ETag: etag, 'Cache-Control': html || ext === '.json' ? 'no-cache' : longLived ? 'public, max-age=2592000' : 'public, max-age=3600', ...SECURITY };
  if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }

  // páginas: o mesmo HTML do app, trocado para o modo "lista de espera"
  if (html) {
    const key = file + etag;
    if (!pageCache.has(key)) pageCache.set(key, Buffer.from(fs.readFileSync(file, 'utf8').replace('data-mode="app"', 'data-mode="waitlist"')));
    return sendBuffer(req, res, pageCache.get(key), headers, key);
  }
  // vídeos e arquivos grandes: aceita pedidos parciais (avançar o vídeo)
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
  if (range && (ext === '.mp4' || ext === '.webm')) {
    let start = range[1] === '' ? st.size - +range[2] : +range[1];
    let end = range[1] !== '' && range[2] !== '' ? +range[2] : st.size - 1;
    if (!(start >= 0 && start <= end && end < st.size)) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}`, ...SECURITY }); return res.end(); }
    res.writeHead(206, { ...headers, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Content-Length': end - start + 1 });
    if (req.method === 'HEAD') return res.end();
    return fs.createReadStream(file, { start, end }).pipe(res);
  }
  if (GZIP.has(ext) && st.size < 4_000_000) return sendBuffer(req, res, fs.readFileSync(file), headers, file + etag);
  res.writeHead(200, { ...headers, 'Content-Length': st.size, 'Accept-Ranges': 'bytes' });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}

function sendBuffer(req, res, buf, headers, key) {
  const gz = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  let body = buf;
  if (gz) {
    if (!gzCache.has(key)) { if (gzCache.size > 300) gzCache.clear(); gzCache.set(key, zlib.gzipSync(buf, { level: 9 })); }
    body = gzCache.get(key);
    headers = { ...headers, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding' };
  }
  res.writeHead(200, { ...headers, 'Content-Length': body.length });
  res.end(req.method === 'HEAD' ? undefined : body);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const p = decodeURIComponent(url.pathname);
    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || '';
    if (p === '/healthz') return json(res, 200, { ok: true });
    if (p === '/api/interesse') return req.method === 'POST' ? postInterest(req, res, ip) : json(res, 405, { error: 'Use POST.' });
    if (p === '/admin/interessados.csv') return exportLeads(req, res, 'csv');
    if (p === '/admin/interessados.json') return exportLeads(req, res, 'json');
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'Método não permitido.' });
    if (PAGES[p]) return serveFile(req, res, path.join(PUB, PAGES[p]), { html: true });
    if (/^\/(landing|privacidade|termos)\.html$/.test(p)) { res.writeHead(301, { Location: p === '/landing.html' ? '/' : p.replace('.html', ''), ...SECURITY }); return res.end(); }
    if (p === '/robots.txt') { res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY }); return res.end('User-agent: *\nDisallow: /admin/\nDisallow: /api/\n'); }
    if (p === '/favicon.ico') return serveFile(req, res, path.join(PUB, 'brand/iaorg-mark.svg'));
    if (!ALLOW.some((re) => re.test(p))) return send404(res);
    const file = resolveFile(p);
    return file ? serveFile(req, res, file) : send404(res);
  } catch (e) {
    console.error('[site] erro:', e);
    if (!res.headersSent) json(res, 500, { error: 'Erro interno.' }); else res.end();
  }
});
server.listen(PORT, () => console.log(`[site] no ar na porta ${PORT} · ${leads.length} interessado(s) na lista · aviso por e-mail ${NOTIFY.key && NOTIFY.to && NOTIFY.from ? 'ligado' : 'desligado'} · exportação ${ADMIN_PASSWORD ? 'ligada' : 'desligada'}`));
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => server.close(() => process.exit(0)));
