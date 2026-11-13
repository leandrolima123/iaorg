// Login com Keycloak (OIDC, Authorization Code + PKCE) no padrão BFF:
// os tokens ficam no servidor; o navegador recebe só um cookie assinado.
import fs from 'node:fs';
import path from 'node:path';
import * as oidc from 'openid-client';
import { DATA_DIR, sign, unsign, randomToken, encrypt, decrypt } from './secrets.js';
import { allCompanies, getCompany } from './companies.js';
import { authenticate, allowed } from './tokens.js';

const APP_URL = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
const PUBLIC = (process.env.KEYCLOAK_PUBLIC_URL || 'http://localhost:8081').replace(/\/$/, '');
const INTERNAL = (process.env.KEYCLOAK_INTERNAL_URL || PUBLIC).replace(/\/$/, '');
const REALM = process.env.KEYCLOAK_REALM || 'iaorg';
const CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID || 'iaorg-app';
const CLIENT_SECRET = process.env.KEYCLOAK_CLIENT_SECRET || '';
const COOKIE = 'iaorg_sid';
const SESSION_TTL = 7 * 24 * 3600 * 1000;

// O navegador usa a URL pública; o servidor fala com o Keycloak pela rede interna do Docker.
// Por isso montamos os metadados à mão em vez de usar discovery.
const pub = `${PUBLIC}/realms/${REALM}`;
const int = `${INTERNAL}/realms/${REALM}`;
const config = new oidc.Configuration(
  {
    issuer: pub,
    authorization_endpoint: `${pub}/protocol/openid-connect/auth`,
    end_session_endpoint: `${pub}/protocol/openid-connect/logout`,
    token_endpoint: `${int}/protocol/openid-connect/token`,
    userinfo_endpoint: `${int}/protocol/openid-connect/userinfo`,
    jwks_uri: `${int}/protocol/openid-connect/certs`,
  },
  CLIENT_ID,
  CLIENT_SECRET,
);
if (INTERNAL.startsWith('http:') || PUBLIC.startsWith('http:')) oidc.allowInsecureRequests(config);

// ---------------- sessões (memória + arquivo criptografado) ----------------
const SESS_FILE = path.join(DATA_DIR, 'sessions.enc');
const sessions = new Map();
try {
  const data = JSON.parse(decrypt(fs.readFileSync(SESS_FILE, 'utf8')) || '{}');
  for (const [k, v] of Object.entries(data)) if (v.expiresAt > Date.now()) sessions.set(k, v);
} catch { /* sem sessões salvas */ }

let persistTimer = null;
function persist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => fs.writeFileSync(SESS_FILE, encrypt(JSON.stringify(Object.fromEntries(sessions)))), 300);
}

const pending = new Map(); // state -> { verifier, next, createdAt }

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function sessionFromRequest(req) {
  const sid = unsign(parseCookies(req.headers.cookie)[COOKIE]);
  const s = sid && sessions.get(sid);
  if (!s) return null;
  if (s.expiresAt < Date.now()) { sessions.delete(sid); persist(); return null; }
  return { sid, ...s };
}

export function updateSession(sid, patch) {
  const s = sessions.get(sid);
  if (s) { Object.assign(s, patch); persist(); }
}

const cookieOpts = () => `Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL / 1000}${APP_URL.startsWith('https') ? '; Secure' : ''}`;

// Empresas de que a pessoa faz parte (uma pessoa pode ter várias; todas rodam ao mesmo tempo no servidor).
export const userCompanies = (session) => allCompanies().filter((s) => s.memberBySub(session.sub));

// Empresa aberta nesta sessão. Com uma empresa só, entra direto; com várias, a pessoa escolhe
// (resolve null e /api/me avisa needsChoice). newCompany = está criando uma empresa nova no onboarding.
export async function resolveCompany(session) {
  if (session.newCompany) return null;
  const cur = session.companyId && getCompany(session.companyId);
  if (cur && cur.memberBySub(session.sub)) return cur;
  const mine = userCompanies(session);
  if (mine.length === 1) { if (session.sid) updateSession(session.sid, { companyId: mine[0].id }); return mine[0]; }
  return null;
}

// ---------------- rotas /auth ----------------
export function mountAuth(app) {
  app.get('/auth/login', async (req, res) => {
    const verifier = oidc.randomPKCECodeVerifier();
    const state = oidc.randomState();
    const next = typeof req.query.next === 'string' && req.query.next.startsWith('/') ? req.query.next : '/';
    pending.set(state, { verifier, next, createdAt: Date.now() });
    for (const [k, v] of pending) if (Date.now() - v.createdAt > 600000) pending.delete(k);
    const url = oidc.buildAuthorizationUrl(config, {
      redirect_uri: `${APP_URL}/auth/callback`,
      // sem o escopo "organization": com ele o Keycloak pede para escolher a organização no login,
      // e a empresa já é escolhida no IAORG (Minhas empresas). A ligação pessoa ↔ empresa fica no IAORG.
      scope: 'openid email profile',
      code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
      code_challenge_method: 'S256',
      state,
      ...(req.query.signup ? { prompt: 'create' } : {}),
    });
    res.redirect(url.href);
  });

  app.get('/auth/callback', async (req, res) => {
    const p = pending.get(req.query.state);
    if (!p) return res.redirect('/login.html?erro=sessao');
    pending.delete(req.query.state);
    try {
      const current = new URL(req.originalUrl, APP_URL);
      const tokens = await oidc.authorizationCodeGrant(config, current, { pkceCodeVerifier: p.verifier, expectedState: req.query.state });
      const c = tokens.claims();
      const sid = randomToken();
      sessions.set(sid, {
        sub: c.sub,
        email: c.email || '',
        name: c.name || [c.given_name, c.family_name].filter(Boolean).join(' ') || c.preferred_username || c.email || 'Usuário',
        idToken: tokens.id_token,
        companyId: null,
        expiresAt: Date.now() + SESSION_TTL,
      });
      persist();
      res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(sign(sid))}; ${cookieOpts()}`);
      res.redirect(p.next || '/');
    } catch (e) {
      console.error('[auth] callback', e);
      res.redirect('/login.html?erro=login');
    }
  });

  app.get('/auth/logout', (req, res) => {
    const s = sessionFromRequest(req);
    if (s) { sessions.delete(s.sid); persist(); }
    res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
    const url = oidc.buildEndSessionUrl(config, {
      post_logout_redirect_uri: `${APP_URL}/login.html`,
      ...(s?.idToken ? { id_token_hint: s.idToken } : { client_id: CLIENT_ID }),
    });
    res.redirect(url.href);
  });
}

// ---------------- middleware ----------------
// requireUser: precisa estar logado. requireCompany: e pertencer a uma empresa ativa.
// Token pessoal (MCP / API): "Authorization: Bearer iaorg_...". Vale só para a empresa e as
// permissões de quem criou, limitado pelo nível do token (leitura, operação, administração).
function tokenAuth(req, res) {
  if (!/^Bearer\s+iaorg_/.test(req.headers.authorization || '')) return false;
  const r = authenticate(req.headers.authorization);
  if (!r || r.error) { res.status(r?.status || 401).json({ error: r?.error || 'Token inválido' }); return true; }
  const why = allowed(r.token, req.method, req.path);
  if (why) { res.status(403).json({ error: why }); return true; }
  req.tokenAuth = { id: r.token.id, name: r.token.name, level: r.token.level };
  req.session = { sid: null, sub: r.member.userSub, email: r.member.email, name: r.member.name, viaToken: true };
  req.company = r.store;
  // o nome aparece no diário com a origem: "Leandro (via Claude Code do notebook)"
  req.member = { ...r.member, name: `${r.member.name} (via ${r.token.name})` };
  return 'ok';
}

export function requireUser(req, res, next) {
  const t = tokenAuth(req, res);
  if (t === 'ok') return next();
  if (t) return;
  const s = sessionFromRequest(req);
  if (!s) return res.status(401).json({ error: 'Não autenticado', login: '/auth/login' });
  req.session = s;
  next();
}

export async function requireCompany(req, res, next) {
  const t = tokenAuth(req, res);
  if (t === 'ok') return next();
  if (t) return;
  requireUser(req, res, async () => {
    try {
      const store = await resolveCompany(req.session);
      const member = store?.memberBySub(req.session.sub);
      if (!store || !member) {
        if (userCompanies(req.session).length && !req.session.newCompany) return res.status(409).json({ error: 'Escolha qual empresa abrir', choose: '/empresas.html' });
        return res.status(403).json({ error: 'Você ainda não faz parte de uma empresa', onboarding: '/onboarding.html' });
      }
      req.company = store;
      req.member = member;
      next();
    } catch (e) { next(e); }
  });
}
