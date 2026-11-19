// Site público do IAORG (landing, privacidade, termos) com a lista de interesse.
// Servidor mínimo, sem dependências: arquivos estáticos + POST /api/interesse + exportação protegida.
// Serve as mesmas páginas do app (public/), em modo "lista de espera" (sem links para o login).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { validate, mergeLead, rateLimiter, toCsv, checkPassword, notify as notifyLead } from './interesse.mjs';

const ROOT = path.resolve(process.env.SITE_ROOT || '/app');
const PUB = path.join(ROOT, 'public');
const MODS = path.join(ROOT, 'node_modules');
const DATA_DIR = path.resolve(process.env.DATA_DIR || '/data');
const LEADS = path.join(DATA_DIR, 'interessados.json');
const PORT = +process.env.PORT || 8080;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const NOTIFY_ON = !!(process.env.RESEND_API_KEY && process.env.LEADS_NOTIFY_TO && process.env.LEADS_FROM);

// Rotas de páginas e pastas montadas (prefixo da URL → pasta no disco)
const PAGES = { '/': 'landing.html', '/site': 'landing.html', '/curso': 'curso.html', '/privacidade': 'privacidade.html', '/privacy': 'privacidade.html', '/termos': 'termos.html', '/terms': 'termos.html' };
const MOUNTS = [
  ['/vendor/three/', path.join(MODS, 'three')],
  ['/vendor/fonts/archivo/', path.join(MODS, '@fontsource/archivo/files')],
  ['/vendor/fonts/barlow-condensed/', path.join(MODS, '@fontsource/barlow-condensed/files')],
  ['/', PUB],
];
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.mp4': 'video/mp4', '.webm': 'video/webm', '.vtt': 'text/vtt; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8' };
const GZIP = new Set(['.html', '.css', '.js', '.mjs', '.json', '.svg', '.txt', '.gltf', '.xml']);
// Só o que o site precisa fica acessível; o resto do public/ (o app) não é servido aqui.
const ALLOW = [/^\/(landing|curso|privacidade|termos)\.html$/, /^\/site\.css$/, /^\/avatars\.js$/, /^\/brand\//, /^\/videos\//, /^\/assets\/kaykit\/(characters|animations)\//, /^\/assets\/kaykit\/LICENSE/, /^\/vendor\/three\/(build\/three\.module\.js|examples\/jsm\/)/, /^\/vendor\/fonts\//, /^\/robots\.txt$/, /^\/favicon\.ico$/];

const SECURITY = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline' https://www.googletagmanager.com https://www.googleadservices.com https://googleads.g.doubleclick.net https://www.google.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://i.ytimg.com https://www.googletagmanager.com https://googleads.g.doubleclick.net https://www.google.com https://www.google.com.br https://ad.doubleclick.net; media-src 'self'; frame-src https://www.youtube-nocookie.com https://player.vimeo.com https://td.doubleclick.net https://www.googletagmanager.com; connect-src 'self' blob: data: https://www.googletagmanager.com https://googleads.g.doubleclick.net https://www.google.com https://www.google.com.br https://ad.doubleclick.net https://*.google-analytics.com; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
};
if (process.env.NODE_ENV === 'production') SECURITY['Strict-Transport-Security'] = 'max-age=31536000';

// ---------- lista de interesse ----------
fs.mkdirSync(DATA_DIR, { recursive: true });
try { fs.accessSync(DATA_DIR, fs.constants.W_OK); } catch { console.error(`[site] ATENÇÃO: sem permissão de escrita em ${DATA_DIR}. No Railway, defina RAILWAY_RUN_UID=0 ou monte o volume em uma pasta do usuário node.`); }
let leads = [];
try { leads = JSON.parse(fs.readFileSync(LEADS, 'utf8')); } catch { /* lista vazia */ }
const saveLeads = () => { fs.writeFileSync(LEADS + '.tmp', JSON.stringify(leads, null, 1)); fs.renameSync(LEADS + '.tmp', LEADS); };

const limited = rateLimiter();

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
  const v = validate(b);
  if (v.bot) return json(res, 200, { ok: true });
  if (v.errors) return json(res, 422, { error: 'Confira os campos destacados.', campos: v.errors });
  const i = leads.findIndex((l) => l.email === v.lead.email);
  const isNew = i < 0;
  const rec = mergeLead(isNew ? null : leads[i], v.lead);
  if (isNew) leads.push(rec); else leads[i] = rec;
  try { saveLeads(); } catch (e) { console.error('[site] não consegui gravar a lista:', e.message); return json(res, 500, { error: 'Não conseguimos salvar agora. Tente de novo em instantes.' }); }
  console.log(`[site] interessado ${isNew ? 'novo' : 'atualizado'} (${leads.length} na lista)`);
  notifyLead(process.env, rec, isNew, leads.length);
  return json(res, 200, { ok: true, novo: isNew });
}

// ---------- exportação (só com senha) ----------
function exportLeads(req, res, fmt) {
  if (!ADMIN_PASSWORD) return send404(res);
  if (!checkPassword(req.headers.authorization, ADMIN_PASSWORD)) { res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="IAORG interessados", charset="UTF-8"', ...SECURITY }); return res.end('Senha necessária.'); }
  if (fmt === 'json') return json(res, 200, leads);
  res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="interessados-${new Date().toISOString().slice(0, 10)}.csv"`, 'Cache-Control': 'no-store', ...SECURITY });
  res.end(toCsv(leads));
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
    if (/^\/(landing|curso|privacidade|termos)\.html$/.test(p)) { res.writeHead(301, { Location: p === '/landing.html' ? '/' : p.replace('.html', ''), ...SECURITY }); return res.end(); }
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
server.listen(PORT, () => console.log(`[site] no ar na porta ${PORT} · ${leads.length} interessado(s) na lista · aviso por e-mail ${NOTIFY_ON ? 'ligado' : 'desligado'} · exportação ${ADMIN_PASSWORD ? 'ligada' : 'desligada'}`));
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => server.close(() => process.exit(0)));
