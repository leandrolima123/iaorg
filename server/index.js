import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { WebSocketServer } from 'ws';
import { DATA_DIR, randomToken } from './secrets.js';
import { createCompany, allCompanies, getCompany, hasRole, uid, isSubOf, subsOf } from './companies.js';
import { mountAuth, requireUser, requireCompany, sessionFromRequest, resolveCompany, updateSession, userCompanies } from './auth.js';
import * as kc from './keycloak-admin.js';
import { mountIntegrations, startInboxPoller } from './integrations.js';
import { mountAgentConfig } from './agent-config.js';
import { mountWorkbench, cancelJob } from './workbench.js';
import { mountFiles } from './files.js';
import { mountRoutines } from './routines.js';
import { mountFunctions } from './functions.js';
import { mountMcp } from './mcp.js';
import { mountDashboard, backfillLedger } from './dashboard.js';
import { mountBrand } from './brand.js';
import { createToken, tokensOf, revokeToken, maxLevelFor, LEVEL_LABEL } from './tokens.js';
import { templateList, roleCatalog, ROLE_CATALOG, ROLE_AREAS } from './templates.js';
import { MODELS, testKey } from './llm.js';
import { hub, runtimeFor, startScheduler } from './engine.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '..');
const PORT = +process.env.PORT || 3000;
const APP_URL = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
const COLORS = ['#1f6b4a', '#2e5e8c', '#8a3b5c', '#b8401c', '#6b5b1f', '#3b3c39', '#5b4b8a', '#2d7f7a', '#9c5a1a', '#4f6b2a'];

const app = express();
app.disable('x-powered-by');
// /api/workbench/* (runner → app) usa parser próprio, com limite maior (entregas e sessão).
const json2mb = express.json({ limit: '2mb' });
app.use((req, res, next) => (req.path.startsWith('/api/workbench/') ? next() : json2mb(req, res, next)));
mountAuth(app);

app.get('/healthz', (req, res) => res.json({ ok: true }));
app.use(express.static(path.join(ROOT, 'public'), { index: false }));
app.use('/vendor/three', express.static(path.join(ROOT, 'node_modules/three')));
// Fontes e ícones servidos localmente (nada de CDN): Archivo, Barlow Condensed e o sprite do Lucide.
const longCache = { maxAge: '30d', immutable: true };
app.use('/vendor/fonts/archivo', express.static(path.join(ROOT, 'node_modules/@fontsource/archivo/files'), longCache));
app.use('/vendor/fonts/barlow-condensed', express.static(path.join(ROOT, 'node_modules/@fontsource/barlow-condensed/files'), longCache));
app.use('/vendor/lucide', express.static(path.join(ROOT, 'node_modules/lucide-static'), { maxAge: '1d' }));

// Páginas: o escritório exige login; o convite manda logar e volta.
app.get('/', (req, res) => {
  if (!sessionFromRequest(req)) return res.redirect('/login.html');
  res.sendFile(path.join(ROOT, 'public/index.html'));
});
app.get('/invite/:token', (req, res) => {
  // Tela de login do Keycloak (tem o link "Cadastre-se" para quem ainda não tem conta).
  if (!sessionFromRequest(req)) return res.redirect(`/auth/login?next=${encodeURIComponent(req.originalUrl)}`);
  res.sendFile(path.join(ROOT, 'public/invite.html'));
});

const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
const need = (role) => (req, res, next) => (hasRole(req.member, role) ? next() : bad(res, `Ação restrita a ${role === 'owner' ? 'o dono' : 'administradores'} da empresa`, 403));
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const str = (v, max) => String(v ?? '').trim().slice(0, max);
const refresh = (store) => runtimeFor(store).pushSnapshot();

// ---------------- sessão / onboarding ----------------
// Resumo de uma empresa para o seletor: o que está rodando agora (as empresas rodam todas ao mesmo tempo).
function companyCard(store, sub) {
  const m = store.memberBySub(sub);
  const run = runtimeFor(store);
  const ais = store.aiAgents().filter((a) => a.active !== false);
  const busy = ais.filter((a) => ['thinking', 'working', 'meeting', 'presenting'].includes(run.agentRuntime(a.id).status)).length;
  const u = run.usagePayload();
  return {
    id: store.id, name: store.company.name, segment: store.company.segment || '', logo: !!store.company.logo, logoVersion: store.company.logoVersion || 0,
    onboardingStep: store.company.onboardingStep, appRole: m?.appRole, role: m?.role,
    agents: ais.length, people: store.state.agents.filter((a) => a.kind === 'human').length, working: busy,
    openTasks: (store.state.tasks || []).filter((t) => ['todo', 'doing', 'review', 'approval'].includes(t.status)).length,
    approvals: (store.state.approvals || []).filter((a) => a.status === 'pending').length,
    paused: !!store.state.paused, monthCostUsd: +(u.monthCostUsd || 0).toFixed(2), simulated: !store.getSecret('claudeKey'),
  };
}

app.get('/api/me', requireUser, wrap(async (req, res) => {
  const store = await resolveCompany(req.session);
  const member = store?.memberBySub(req.session.sub);
  const mine = req.session.viaToken ? [] : userCompanies(req.session);
  res.json({
    user: { name: req.session.name, email: req.session.email },
    company: store && member ? { id: store.id, name: store.company.name, onboardingStep: store.company.onboardingStep, logo: !!store.company.logo } : null,
    member: member ? { id: member.id, appRole: member.appRole } : null,
    companies: mine.map((s) => ({ id: s.id, name: s.company.name })),
    needsChoice: !store && mine.length > 1 && !req.session.newCompany,
    creating: !!req.session.newCompany,
  });
}));

// ---------------- várias empresas por pessoa ----------------
app.get('/api/companies', requireUser, (req, res) => {
  const current = req.session.newCompany ? null : req.session.companyId;
  res.json({ current, companies: userCompanies(req.session).map((s) => companyCard(s, req.session.sub)).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')) });
});
app.post('/api/companies/select', requireUser, (req, res) => {
  if (req.session.viaToken) return bad(res, 'Tokens valem para uma empresa só', 403);
  const store = getCompany(str(req.body?.id, 80));
  if (!store || !store.memberBySub(req.session.sub)) return bad(res, 'Empresa não encontrada', 404);
  updateSession(req.session.sid, { companyId: store.id, newCompany: false });
  res.json({ ok: true, onboardingStep: store.company.onboardingStep });
});
// Começa a criar outra empresa: o onboarding abre em branco; as outras empresas continuam rodando.
app.post('/api/companies/new', requireUser, (req, res) => {
  if (req.session.viaToken) return bad(res, 'Use o navegador para criar empresas', 403);
  updateSession(req.session.sid, { newCompany: true });
  res.json({ ok: true });
});
app.get('/api/companies/:id/logo', requireUser, (req, res) => {
  const store = getCompany(req.params.id);
  if (!store || !store.memberBySub(req.session.sub)) return res.status(404).end();
  const file = store.logoFile();
  if (!file || !fs.existsSync(file)) return res.status(404).end();
  const kind = IMAGE_TYPES.find((t) => file.endsWith('.' + t.ext));
  res.set({ 'Content-Type': kind.mime, 'Cache-Control': 'private, max-age=300', 'X-Content-Type-Options': 'nosniff' });
  res.send(fs.readFileSync(file));
});

const companyFields = (b) => ({
  name: str(b.name, 60), segment: str(b.segment, 80), website: str(b.website, 200),
  description: str(b.description, 1500), mission: str(b.mission, 1000), context: str(b.context, 8000),
});

// Passo 1: cria a empresa (Organization no Keycloak) e o personagem do dono.
app.post('/api/onboarding/company', requireUser, wrap(async (req, res) => {
  const f = companyFields(req.body || {});
  if (!f.name) return bad(res, 'Informe o nome da empresa');
  let store = await resolveCompany(req.session);
  if (store) {
    if (!hasRole(store.memberBySub(req.session.sub), 'admin')) return bad(res, 'Sem permissão', 403);
    Object.assign(store.company, f);
    store.save();
    refresh(store);
    return res.json({ id: store.id });
  }
  const org = await kc.createOrganization(f.name);
  await kc.addMember(org.id, req.session.sub);
  store = createCompany(org.id, f.name);
  Object.assign(store.company, f, { onboardingStep: 'you' });
  store.state.agents.push({
    id: 'dono', kind: 'human', userSub: req.session.sub, email: req.session.email, appRole: 'owner',
    name: req.session.name, role: 'Fundador(a)', title: 'Dono(a) da empresa', color: '#c4673a', reportsTo: null, prompt: '',
  });
  migrateLegacy(store);
  store.save();
  updateSession(req.session.sid, { companyId: store.id, newCompany: false });
  runtimeFor(store); // já entra no agendador, junto com as outras empresas
  res.json({ id: store.id });
}));

// Dados de uma instalação antiga (uma empresa só) vão para a primeira empresa criada.
function migrateLegacy(store) {
  const legacy = path.join(DATA_DIR, 'state.json');
  if (!fs.existsSync(legacy) || allCompanies().length > 1) return;
  const oldWs = path.join(DATA_DIR, 'workspace');
  if (fs.existsSync(oldWs)) fs.cpSync(oldWs, store.workspace, { recursive: true });
  fs.renameSync(legacy, path.join(DATA_DIR, 'state.legacy.json'));
  console.log('[migração] arquivos da instalação antiga copiados para', store.id);
}

app.put('/api/onboarding/step', requireCompany, need('admin'), (req, res) => {
  const step = str(req.body?.step, 20);
  if (!['company', 'you', 'claude', 'repos', 'team', 'review', 'done'].includes(step)) return bad(res, 'Passo inválido');
  req.company.company.onboardingStep = step;
  req.company.save();
  refresh(req.company);
  res.json({ ok: true });
});

// ---------------- estado / empresa ----------------
app.get('/api/state', requireCompany, (req, res) => res.json(runtimeFor(req.company).snapshot(req.member)));
app.get('/api/catalog', requireUser, (req, res) => res.json({ templates: templateList(), roles: roleCatalog(), areas: ROLE_AREAS, models: MODELS }));

app.put('/api/company', requireCompany, need('admin'), (req, res) => {
  const f = companyFields({ ...req.company.company, ...req.body });
  if (!f.name) return bad(res, 'Nome obrigatório');
  Object.assign(req.company.company, f);
  req.company.save();
  refresh(req.company);
  res.json(req.company.company);
});

const IMAGE_TYPES = [
  { ext: 'png', mime: 'image/png', test: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { ext: 'jpg', mime: 'image/jpeg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'webp', mime: 'image/webp', test: (b) => b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP' },
];

app.post('/api/company/logo', requireCompany, need('admin'), express.raw({ type: () => true, limit: '5mb' }), (req, res) => {
  const buf = req.body;
  const kind = Buffer.isBuffer(buf) && buf.length > 12 && IMAGE_TYPES.find((t) => t.test(buf));
  if (!kind) return bad(res, 'Envie uma imagem PNG, JPG ou WEBP de até 5 MB');
  const old = req.company.logoFile();
  if (old && fs.existsSync(old)) fs.rmSync(old);
  const name = `logo.${kind.ext}`;
  fs.writeFileSync(path.join(req.company.dir, name), buf);
  req.company.company.logo = name;
  req.company.company.logoVersion = Date.now();
  req.company.save();
  refresh(req.company);
  res.json({ ok: true });
});

app.get('/api/company/logo', requireCompany, (req, res) => {
  const file = req.company.logoFile();
  if (!file || !fs.existsSync(file)) return res.status(404).end();
  const kind = IMAGE_TYPES.find((t) => file.endsWith('.' + t.ext));
  res.set({ 'Content-Type': kind.mime, 'Cache-Control': 'private, max-age=60', 'X-Content-Type-Options': 'nosniff' });
  res.send(fs.readFileSync(file));
});

// ---------------- Claude ----------------
app.post('/api/settings/claude/test', requireCompany, need('owner'), wrap(async (req, res) => {
  const key = str(req.body?.key, 300) || req.company.getSecret('claudeKey');
  if (!key) return bad(res, 'Cole a chave da API');
  res.json(await testKey(key));
}));

app.put('/api/settings/claude', requireCompany, need('owner'), wrap(async (req, res) => {
  const { key, model, effort, budgetUsd } = req.body || {};
  const s = req.company.company.settings;
  if (key !== undefined) {
    const k = str(key, 300);
    if (k) {
      const t = await testKey(k);
      if (!t.ok) return bad(res, t.error);
    }
    req.company.setSecret('claudeKey', k || null);
  }
  if (model && MODELS.some((m) => m.id === model)) s.model = model;
  if (['low', 'medium', 'high', 'xhigh', 'max'].includes(effort)) s.effort = effort;
  if (budgetUsd !== undefined) {
    // limite de gasto por mês em US$ (0 = sem limite). Se subir acima do gasto do mês, a pausa por limite sai sozinha.
    s.budgetUsd = Math.max(0, Math.min(100000, Math.round((+budgetUsd || 0) * 100) / 100));
    const rt = runtimeFor(req.company);
    if (req.company.state.paused && req.company.state.pausedReason === 'budget' && !rt.overBudget()) {
      req.company.state.paused = false;
      req.company.state.pausedReason = null;
      rt.logEvent('system', req.member.id, `${req.member.name} aumentou o limite de gasto para US$ ${s.budgetUsd.toFixed(2).replace('.', ',')}/mês. Empresa retomada.`);
    }
  }
  req.company.save();
  refresh(req.company);
  res.json({ ok: true, secrets: req.company.secretInfo(), settings: s });
}));

// ---------------- integrações (GitHub, Resend, Gmail, Agenda) ----------------
mountIntegrations(app, { requireCompany, need, wrap, runtimeFor, getCompany });
// Ficha dos agentes, base de conhecimento, aprovações e simulador
mountAgentConfig(app, { requireCompany, need, wrap, runtimeFor });
// Oficina: tarefas em containers (runner), eventos ao vivo, ajuste e cancelamento
mountWorkbench(app, { requireCompany, need, wrap, runtimeFor });
// Funções: membros automáticos (sem IA) com configuração própria — ex.: vigia da mesa
mountFunctions(app, { requireCompany, need, wrap, runtimeFor, refresh });

// ---------------- equipe ----------------
// Aparência do personagem 3D (escritório): personagem, acessórios, cor da roupa, objeto na mão e tamanho.
const lookField = (l) => {
  if (!l || typeof l !== 'object') return undefined;
  const parts = Object.fromEntries(Object.entries(l.parts || {}).slice(0, 12).filter(([k]) => /^[A-Za-z]{2,20}$/.test(k)).map(([k, v]) => [k, !!v]));
  return {
    char: str(l.char, 30).replace(/[^\w-]/g, ''),
    parts,
    outfit: l.outfit === 'agent' || /^#[0-9a-f]{6}$/i.test(l.outfit || '') ? l.outfit : '',
    item: ['mug', 'book'].includes(l.item) ? l.item : '',
    scale: Math.min(1.15, Math.max(0.85, Number(l.scale) || 1)),
  };
};
const agentFields = (b, store) => ({
  name: str(b.name, 60), role: str(b.role, 40), title: str(b.title || b.role, 60),
  color: /^#[0-9a-f]{6}$/i.test(b.color) ? b.color : COLORS[Math.floor(Math.random() * COLORS.length)],
  reportsTo: b.reportsTo && store.getAgent(b.reportsTo) ? b.reportsTo : null,
  prompt: str(b.prompt, 6000),
  ...(b.look ? { look: lookField(b.look) } : {}),
});
const newId = (store, base) => {
  let id = String(base || 'agente').toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'agente';
  const root = id;
  for (let i = 2; store.getAgent(id); i++) id = `${root}-${i}`;
  return id;
};

// Contrata a equipe de IA escolhida no onboarding (substitui os agentes de IA atuais).
app.post('/api/team/apply', requireCompany, need('admin'), (req, res) => {
  const store = req.company;
  const hires = Array.isArray(req.body?.hires) ? req.body.hires.slice(0, 40) : [];
  const humans = store.state.agents.filter((a) => a.kind === 'human');
  const owner = store.owner();
  const idMap = {};
  const created = [];
  for (const h of hires) {
    const id = newId({ getAgent: (x) => humans.some((a) => a.id === x) || created.some((a) => a.id === x) }, h.id || h.role);
    idMap[h.id] = id;
    const prev = store.getAgent(h.id);
    created.push({
      id, kind: 'ai', catalogKey: str(h.catalogKey || prev?.catalogKey || h.id, 40), ...agentFields(h, { getAgent: () => null }), reportsTo: h.reportsTo || null,
      ...(prev?.kind === 'ai' && prev.access ? { access: prev.access } : {}), // mantém acessos a integrações ao reeditar a equipe
    });
  }
  for (const a of created) {
    const target = a.reportsTo;
    if (target && idMap[target]) a.reportsTo = idMap[target];
    else if (target && humans.some((x) => x.id === target)) a.reportsTo = target;
    else a.reportsTo = owner?.id || null; // sem chefe na lista → reporta ao dono
  }
  // funções (automações) ficam: o onboarding só troca os agentes de IA
  store.state.agents = [...humans, ...store.state.agents.filter((a) => a.kind === 'function'), ...created];
  store.save();
  refresh(store);
  res.json(store.state.agents);
});

app.post('/api/agents', requireCompany, need('admin'), (req, res) => {
  const f = agentFields(req.body || {}, req.company);
  if (!f.name || !f.role) return bad(res, 'Nome e cargo são obrigatórios');
  const catalogKey = ROLE_CATALOG[req.body.catalogKey] ? req.body.catalogKey : undefined;
  const agent = { id: newId(req.company, req.body.id || f.role), kind: 'ai', ...f, ...(catalogKey ? { catalogKey } : {}) };
  req.company.state.agents.push(agent);
  req.company.save();
  const boss = agent.reportsTo && req.company.getAgent(agent.reportsTo);
  runtimeFor(req.company).logEvent('system', req.member.id, `${req.member.name} contratou ${agent.name} (${agent.role})${boss ? `, que responde a ${boss.name}` : ''}.`);
  refresh(req.company);
  res.json(agent);
});

app.put('/api/agents/:id', requireCompany, (req, res) => {
  const a = req.company.getAgent(req.params.id);
  if (!a) return bad(res, 'Não encontrado', 404);
  const self = a.kind === 'human' && isSubOf(a, req.session.sub);
  if (!self && !hasRole(req.member, 'admin')) return bad(res, 'Sem permissão', 403);
  const f = agentFields({ ...a, ...req.body }, req.company);
  if (f.reportsTo === a.id) f.reportsTo = null;
  if (a.kind === 'human' || a.kind === 'function') delete f.prompt;
  // papel de acesso (admin/membro) só pela interface, nunca por token
  if (a.kind === 'human' && req.body.appRole && !req.tokenAuth && hasRole(req.member, 'owner') && a.appRole !== 'owner' && ['admin', 'member'].includes(req.body.appRole)) a.appRole = req.body.appRole;
  const moved = (f.reportsTo || null) !== (a.reportsTo || null);
  Object.assign(a, f);
  req.company.save();
  if (moved) {
    const boss = a.reportsTo && req.company.getAgent(a.reportsTo);
    runtimeFor(req.company).logEvent('system', req.member.id, `${req.member.name} mudou o organograma: ${a.name} agora responde a ${boss ? boss.name : 'ninguém (topo)'}.`);
  }
  refresh(req.company);
  res.json(a);
});

app.delete('/api/agents/:id', requireCompany, need('admin'), wrap(async (req, res) => {
  const store = req.company;
  const a = store.getAgent(req.params.id);
  if (!a) return bad(res, 'Não encontrado', 404);
  if (a.appRole === 'owner') return bad(res, 'O dono não pode ser removido');
  if (a.kind === 'human') {
    for (const sub of subsOf(a)) await kc.removeMember(store.id, sub).catch((e) => console.warn('[kc] removeMember', e.message));
    a.active = false; // mantém histórico de tarefas/mensagens
  } else {
    store.state.agents = store.state.agents.filter((x) => x.id !== a.id);
  }
  for (const x of store.state.agents) if (x.reportsTo === a.id) x.reportsTo = a.reportsTo;
  (store.state.agentNames ||= {})[a.id] = { name: a.name, role: a.role }; // o Painel continua mostrando o nome de quem saiu
  store.save();
  runtimeFor(store).logEvent('system', req.member.id, `${req.member.name} ${a.kind === 'human' ? 'removeu' : 'demitiu'} ${a.name} (${a.role}).`);
  refresh(store);
  res.json({ ok: true });
}));

// ---------------- convites ----------------
app.post('/api/invites', requireCompany, need('admin'), (req, res) => {
  const store = req.company;
  const email = str(req.body?.email, 200).toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return bad(res, 'E-mail inválido');
  const f = agentFields(req.body || {}, store);
  if (!f.role) return bad(res, 'Informe o cargo');
  const appRole = req.body?.appRole === 'admin' ? 'admin' : 'member';
  const inv = { id: uid('i'), token: randomToken(), email, ...f, name: f.name || email.split('@')[0], appRole, invitedBy: req.member.id, createdAt: Date.now(), expiresAt: Date.now() + 7 * 864e5 };
  delete inv.prompt;
  store.state.invites.push(inv);
  store.save();
  refresh(store);
  res.json({ ...inv, link: `${APP_URL}/invite/${inv.token}` });
});

app.delete('/api/invites/:id', requireCompany, need('admin'), (req, res) => {
  const inv = req.company.state.invites.find((i) => i.id === req.params.id);
  if (!inv) return bad(res, 'Convite não encontrado', 404);
  inv.revokedAt = Date.now();
  req.company.save();
  refresh(req.company);
  res.json({ ok: true });
});

function findInvite(token) {
  for (const store of allCompanies()) {
    const inv = store.state.invites.find((i) => i.token === token);
    if (inv) return { store, inv };
  }
  return {};
}
const inviteProblem = (inv) => (!inv ? 'Convite não encontrado' : inv.revokedAt ? 'Convite revogado' : inv.usedAt ? 'Convite já utilizado' : inv.expiresAt < Date.now() ? 'Convite expirado' : null);

app.get('/api/invites/:token/info', requireUser, (req, res) => {
  const { store, inv } = findInvite(req.params.token);
  const problem = inviteProblem(inv);
  if (problem) return bad(res, problem, 404);
  res.json({
    company: store.company.name, hasLogo: !!store.company.logo, role: inv.role, title: inv.title, appRole: inv.appRole,
    email: inv.email, invitedBy: store.getAgent(inv.invitedBy)?.name || '', emailMatches: inv.email === String(req.session.email).toLowerCase(),
  });
});

app.post('/api/invites/:token/accept', requireUser, wrap(async (req, res) => {
  const { store, inv } = findInvite(req.params.token);
  const problem = inviteProblem(inv);
  if (problem) return bad(res, problem, 404);
  if (inv.email !== String(req.session.email).toLowerCase()) return bad(res, `Este convite é para ${inv.email}. Entre com essa conta.`, 403);
  // pode fazer parte de várias empresas: o convite só adiciona mais uma
  await kc.addMember(store.id, req.session.sub);
  let person = store.memberBySub(req.session.sub);
  if (!person) {
    person = {
      id: newId(store, inv.name || inv.role), kind: 'human', userSub: req.session.sub, email: inv.email, appRole: inv.appRole,
      name: str(req.body?.name, 60) || inv.name, role: inv.role, title: inv.title, color: inv.color, reportsTo: inv.reportsTo, prompt: '',
    };
    store.state.agents.push(person);
  }
  inv.usedAt = Date.now();
  store.save();
  updateSession(req.session.sid, { companyId: store.id, newCompany: false });
  runtimeFor(store).logEvent('system', person.id, `${person.name} entrou na empresa como ${person.role}.`);
  refresh(store);
  res.json({ ok: true });
}));

// ---------------- trabalho ----------------
app.post('/api/goal', requireCompany, (req, res) => {
  const store = req.company;
  const text = str(req.body?.text, 8000);
  if (!text) return bad(res, 'Texto vazio');
  const target = store.getAgent(req.body?.to);
  if (target?.kind === 'function') return bad(res, `${target.name} é uma função automática: não lê mensagens. Ajuste a configuração dela.`);
  const fallback = store.aiAgents().find((a) => !a.reportsTo || store.getAgent(a.reportsTo)?.kind === 'human') || store.aiAgents()[0];
  const to = target && target.active !== false ? target.id : fallback?.id;
  if (!to) return bad(res, 'Nenhum agente na empresa');
  if (to === req.member.id) return bad(res, 'Escolha outro destinatário');
  runtimeFor(store).postMessage(req.member.id, to, text);
  res.json({ ok: true });
});

app.post('/api/tasks', requireCompany, (req, res) => {
  const { title, description, assigneeId } = req.body || {};
  if (!str(title, 140) || !req.company.getAgent(assigneeId)) return bad(res, 'Título e responsável são obrigatórios');
  if (req.company.getAgent(assigneeId).kind === 'function') return bad(res, 'Funções automáticas não recebem tarefas: configure-as na ficha delas.');
  res.json(runtimeFor(req.company).createTask({ title, description, assigneeId, creatorId: req.member.id }));
});

app.post('/api/tasks/:id/update', requireCompany, (req, res) => {
  const t = req.company.state.tasks.find((x) => x.id === req.params.id);
  if (!t) return bad(res, 'Tarefa não encontrada', 404);
  if (t.assigneeId !== req.member.id && t.creatorId !== req.member.id && !hasRole(req.member, 'admin')) return bad(res, 'Sem permissão', 403);
  const status = ['todo', 'doing', 'review', 'done', 'blocked'].includes(req.body?.status) ? req.body.status : undefined;
  // Observação da pessoa (ex.: o OK que a tarefa esperava) entra na descrição, para o agente ver ao retomar.
  // Renomear: quem pediu (ou um admin).
  const newTitle = str(req.body?.title, 140);
  if (newTitle && (t.creatorId === req.member.id || hasRole(req.member, 'admin'))) t.title = newTitle;
  const note = str(req.body?.note, 2000);
  if (note) t.description = `${t.description || ''}\n\n${req.member.name} (${new Date().toLocaleDateString('pt-BR')}): ${note}`.trim();
  // "Tentar de novo": voltar para A fazer devolve a tarefa de agente para a fila da oficina.
  if (status === 'todo' && req.company.getAgent(t.assigneeId)?.kind !== 'human') { t.presented = false; delete t.retryAt; }
  const result = str(req.body?.result, 4000) || undefined;
  // Só renomeou ou anotou: salva sem registrar "marcou como …" no diário.
  if (!status && !result) { t.updatedAt = Date.now(); req.company.save(); refresh(req.company); return res.json(t); }
  runtimeFor(req.company).updateTask(t, { status, result }, req.member.id);
  res.json(t);
});

// Pedido entre áreas aguardando aprovação: quem aprova (ou um admin) decide.
app.post('/api/tasks/:id/approval', requireCompany, (req, res) => {
  const t = req.company.state.tasks.find((x) => x.id === req.params.id);
  if (!t || t.status !== 'approval') return bad(res, 'Este pedido não está aguardando aprovação', 404);
  if (t.approval?.by !== req.member.id && !hasRole(req.member, 'admin')) return bad(res, 'Só quem aprova (ou um administrador) decide este pedido', 403);
  const r = runtimeFor(req.company).decideApproval(t, { decision: req.body?.decision, reason: req.body?.reason, assigneeId: req.body?.assigneeId }, req.member.id);
  if (r.error) return bad(res, r.error);
  res.json({ ...r, task: t });
});

// Tira uma entrega da "Minha mesa" (a tarefa continua concluída e no histórico).
app.post('/api/tasks/:id/dismiss', requireCompany, (req, res) => {
  const t = req.company.state.tasks.find((x) => x.id === req.params.id);
  if (!t?.desk) return bad(res, 'Entrega não encontrada', 404);
  if (t.desk.to !== req.member.id && !hasRole(req.member, 'admin')) return bad(res, 'Sem permissão', 403);
  t.desk.dismissedAt = req.body?.undo ? null : Date.now();
  req.company.save();
  refresh(req.company);
  res.json({ ok: true });
});

// Entregas feitas por conversa (sem tarefa).
app.post('/api/deliveries/:id/dismiss', requireCompany, (req, res) => {
  const d = (req.company.state.deliveries || []).find((x) => x.id === req.params.id);
  if (!d) return bad(res, 'Entrega não encontrada', 404);
  if (d.to !== req.member.id && !hasRole(req.member, 'admin')) return bad(res, 'Sem permissão', 403);
  d.dismissedAt = req.body?.undo ? null : Date.now();
  req.company.save();
  refresh(req.company);
  res.json({ ok: true });
});

app.post('/api/control', requireCompany, need('admin'), (req, res) => {
  const { action } = req.body || {};
  const store = req.company;
  if (action === 'pause' || action === 'reset') {
    // Pausar (ou limpar) também para quem está trabalhando na oficina.
    for (const j of store.state.jobs || []) if (['starting', 'running'].includes(j.status)) cancelJob(runtimeFor(store), j, action === 'pause' ? 'a obra foi pausada' : 'o trabalho foi limpo').catch(() => {});
  }
  if (action === 'reset' && req.tokenAuth) return bad(res, 'Limpar todo o trabalho só pode ser feito pela interface do IAORG.', 403);
  if (action === 'resume' && runtimeFor(store).overBudget()) {
    return bad(res, `O limite de gasto do mês (US$ ${runtimeFor(store).budgetUsd().toFixed(2).replace('.', ',')}) já foi atingido. Aumente o limite em Ajustes → Claude para retomar.`);
  }
  if (action === 'pause') { store.state.paused = true; store.state.pausedReason = 'manual'; }
  else if (action === 'resume') { store.state.paused = false; store.state.pausedReason = null; }
  else if (action === 'reset') store.resetWork();
  else return bad(res, 'Ação inválida');
  store.save();
  runtimeFor(store).logEvent('system', req.member.id, { pause: 'Empresa pausada.', resume: 'Empresa retomada.', reset: 'Trabalho reiniciado.' }[action]);
  refresh(store);
  res.json({ ok: true });
});

// ---------------- arquivos ----------------
// Arquivos: pastas, prévia, mover/renomear, excluir e espelho no Google Drive
mountFiles(app, { requireCompany, need, wrap, runtimeFor, hasRole });
// Rotinas: tarefas e reuniões recorrentes configuradas pelo usuário
mountRoutines(app, { requireCompany, need, wrap, runtimeFor });

// ---------------- acesso por IA (MCP) e tokens pessoais ----------------
// Tokens só são criados/revogados pela interface (com a pessoa logada), nunca por outro token.
app.get('/api/tokens', requireCompany, (req, res) => {
  const mine = hasRole(req.member, 'owner') ? tokensOf(req.company) : tokensOf(req.company).filter((t) => t.memberId === req.member.id);
  res.json({ tokens: mine, maxLevel: maxLevelFor(req.member), levels: LEVEL_LABEL, mcpUrl: `${APP_URL}/mcp` });
});
app.post('/api/tokens', requireCompany, (req, res) => {
  try {
    const { token, info } = createToken(req.company, req.member, { name: req.body?.name, level: req.body?.level });
    runtimeFor(req.company).logEvent('system', req.member.id, `${req.member.name} criou o token de acesso por IA "${info.name}" (${LEVEL_LABEL[info.level].toLowerCase()}).`);
    res.json({ token, info });
  } catch (e) { bad(res, e.message, 403); }
});
app.delete('/api/tokens/:id', requireCompany, (req, res) => {
  try {
    if (!revokeToken(req.company, req.params.id, req.member)) return bad(res, 'Token não encontrado', 404);
    runtimeFor(req.company).logEvent('system', req.member.id, `${req.member.name} revogou um token de acesso por IA.`);
    res.json({ ok: true });
  } catch (e) { bad(res, e.message, 403); }
});
mountMcp(app);
// Painel: folha de pagamento dos agentes (custo, produção, eficiência por período)
mountDashboard(app, { requireCompany, need, runtimeFor });
mountBrand(app, { requireCompany, need, refresh });

app.use((err, req, res, next) => {
  if (err.type === 'entity.too.large') return bad(res, `Arquivo grande demais: o limite é ${Math.round((err.limit || 5242880) / 1048576)} MB.`, 413);
  console.error('[api]', err);
  bad(res, err.message || 'Erro interno', 500);
});

// ---------------- WebSocket ----------------
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', async (req, socket, head) => {
  try {
    const session = sessionFromRequest(req);
    const store = session && new URL(req.url, 'http://x').pathname === '/ws' ? await resolveCompany(session) : null;
    const member = store?.memberBySub(session.sub);
    if (!member) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); return socket.destroy(); }
    wss.handleUpgrade(req, socket, head, (ws) => {
      ws.userSub = session.sub;
      hub.add(store.id, ws);
      ws.send(JSON.stringify({ type: 'refresh' }));
      runtimeFor(store).pushSnapshot(); // presença mudou
      ws.on('close', () => { hub.remove(store.id, ws); runtimeFor(store).pushSnapshot(); });
    });
  } catch {
    socket.destroy();
  }
});

// Uma vez: entregas recentes (últimas 48 h) de antes da "Minha mesa" passar a guardar entregas.
for (const store of allCompanies()) {
  if (store.state.deskBackfill && store.state.deliveriesBackfill) continue;
  if (!store.state.deskBackfill) for (const t of store.state.tasks || []) {
    const creator = store.getAgent(t.creatorId), assignee = store.getAgent(t.assigneeId);
    if (t.status === 'done' && !t.desk && !t.test && !/^\[Teste\]/.test(t.title) && creator?.kind === 'human' && assignee && assignee.kind !== 'human' && Date.now() - (t.updatedAt || 0) < 48 * 3600e3) {
      t.desk = { to: creator.id, at: t.updatedAt, dismissedAt: null };
    }
  }
  store.state.deskBackfill = true;
  // Arquivos que agentes fizeram por conversa (sem tarefa) nas últimas 48 h, em resposta a uma pessoa.
  if (!store.state.deliveriesBackfill) {
    const meta = store.state.fileMeta || {};
    const byAsk = new Map();
    for (const [rel, m] of Object.entries(meta)) {
      const agent = m.by && store.getAgent(m.by);
      if (!agent || agent.kind === 'human' || m.task || Date.now() - (m.at || 0) > 48 * 3600e3) continue;
      const ask = (store.state.messages || []).filter((x) => x.to === agent.id && store.getAgent(x.from)?.kind === 'human' && x.ts <= m.at && m.at - x.ts < 30 * 60e3).at(-1);
      if (!ask) continue;
      const k = `${agent.id}|${ask.ts}`;
      if (!byAsk.has(k)) {
        const reply = (store.state.messages || []).find((x) => x.from === agent.id && x.to === ask.from && x.ts >= m.at && x.ts - m.at < 10 * 60e3);
        byAsk.set(k, { id: `E${ask.ts.toString(36)}`, agentId: agent.id, to: ask.from, request: String(ask.content).slice(0, 600), text: String(reply?.content || '').slice(0, 4000), files: [], at: m.at, dismissedAt: null });
      }
      byAsk.get(k).files.push(rel);
    }
    (store.state.deliveries ||= []).push(...byAsk.values());
    store.state.deliveriesBackfill = true;
  }
  store.save();
}

for (const store of allCompanies()) { if (!store.state.costBackfill || !store.state.namesBackfill) { backfillLedger(store); store.save(); } }

server.listen(PORT, () => {
  console.log(`IAORG rodando em ${APP_URL}`);
  startScheduler();
  startInboxPoller({ allCompanies, runtimeFor });
  kc.ensureLoginTheme().catch(() => {}); // login e cadastro com a identidade do IAORG
});
