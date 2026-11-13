// Funções: o terceiro tipo de membro da equipe (além de pessoas e agentes de IA).
// Uma função é uma automação do servidor, sem modelo de IA: roda sozinha num ritmo, com uma configuração
// própria, aparece no escritório como personagem e entra no organograma. Não recebe mensagens nem tarefas.
// Para criar uma nova: adicione uma entrada em FUNCTION_CATALOG com fields (o formulário), normalize
// (valida a configuração), schedule (de quanto em quanto tempo roda) e run (o que faz).
import { watchDesk, isConnected, can } from './integrations.js';
import { watchConfig, WATCH_DEFAULTS } from './trading.js';

const agentOptions = (store, { integration, perm } = {}) => store.aiAgents()
  .filter((a) => a.active !== false && (!integration || can(store, a, integration, perm)))
  .map((a) => ({ value: a.id, label: `${a.name} — ${a.role}` }));

export const FUNCTION_CATALOG = {
  vigia_mesa: {
    key: 'vigia_mesa', area: 'trading', icon: 'radar', color: '#0f766e',
    role: 'Vigia', title: 'Vigia da mesa', name: 'Vigia',
    summary: 'Varre os pares da mesa no servidor, sem custo de IA, e só chama o analista quando um par passa em todos os filtros.',
    does: [
      'Varre todos os pares permitidos (tendência no 1d e 4h, entrada no 1h, stop, ganho/risco)',
      'Não chama ninguém com a mesa parada, posições no máximo ou perda do dia alta',
      'Chama o analista só quando um par passa nos filtros, uma vez por par a cada período de espera',
    ],
    requires: [{ type: 'binance', label: 'Binance' }],
    look: { char: 'skeleton_rogue', parts: {}, outfit: 'agent', item: '', scale: 0.95 }, // funções: esqueletos, para diferenciar dos agentes
    fields: (store) => [
      { key: 'intervalMin', label: 'Varrer a cada', type: 'select', options: [{ value: 5, label: '5 min' }, { value: 15, label: '15 min' }, { value: 30, label: '30 min' }, { value: 60, label: '1 h' }], hint: 'Cada varredura usa só dados públicos da Binance: não custa IA.' },
      { key: 'analystId', label: 'Quem chamar', type: 'select', options: [{ value: '', label: 'O primeiro analista com permissão de propor' }, ...agentOptions(store, { integration: 'binance', perm: 'analyze' })], hint: 'Só aparecem agentes com a permissão "Propor operações" na Binance.' },
      { key: 'minRR', label: 'Ganho/risco mínimo para chamar', type: 'number', min: 1, max: 5, step: 0.1, hint: 'Já descontadas as taxas. O analista usa 2 nos procedimentos dele.' },
      { key: 'cooldownH', label: 'Espera para avisar o mesmo par de novo (horas)', type: 'number', min: 1, max: 24, step: 1 },
      { key: 'maxLossPct', label: 'Não chamar com a perda do dia acima de (% do limite)', type: 'number', min: 10, max: 100, step: 5 },
    ],
    defaults: WATCH_DEFAULTS,
    normalize: (cfg) => watchConfig(cfg),
    every: (cfg) => watchConfig(cfg).intervalMin * 60_000,
    run: (rt, member, opts) => watchDesk(rt, member, opts),
  },
};

export const isFunction = (a) => a?.kind === 'function';
const defOf = (m) => FUNCTION_CATALOG[m?.fnKey];
const stateOf = (store, id) => (store.state.fnState ||= {})[id] || null;

function view(store, m) {
  const def = defOf(m);
  const cfg = def ? def.normalize(m.fn?.config) : {};
  const st = stateOf(store, m.id);
  const enabled = m.fn?.enabled !== false;
  return {
    id: m.id, fnKey: m.fnKey, name: m.name, enabled, config: cfg,
    label: def?.title || m.fnKey, summary: def?.summary || '', icon: def?.icon || 'cpu',
    missing: (def?.requires || []).filter((r) => !isConnected(store, r.type)).map((r) => r.label),
    fields: def ? def.fields(store) : [],
    state: st ? { lastRun: st.lastRun || null, runs: st.runs || 0, sent: st.sent || 0, last: st.last || null, history: (st.history || []).slice(0, 20) } : null,
    nextRunAt: enabled && def && !store.state.paused ? Math.max(Date.now(), (st?.lastRun || 0) + def.every(m.fn?.config)) : null,
  };
}

/** Chamado pelo agendador do motor: roda cada função ativa quando chega a vez dela. */
export async function tickFunctions(rt) {
  for (const m of rt.store.state.agents) {
    if (!isFunction(m) || m.active === false || m.fn?.enabled === false) continue;
    const def = defOf(m);
    if (def) await def.run(rt, m).catch((e) => console.error(`[função ${m.id}]`, e.message));
  }
}

export function mountFunctions(app, { requireCompany, need, wrap, runtimeFor, refresh }) {
  const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
  const fnMember = (req) => { const m = req.company.getAgent(req.params.id); return isFunction(m) && m.active !== false ? m : null; };

  app.get('/api/functions/catalog', requireCompany, (req, res) => {
    const store = req.company;
    res.json(Object.values(FUNCTION_CATALOG).map((d) => ({
      key: d.key, area: d.area, icon: d.icon, color: d.color, role: d.role, title: d.title, name: d.name, summary: d.summary, does: d.does,
      requires: d.requires.map((r) => ({ ...r, connected: isConnected(store, r.type) })),
      fields: d.fields(store), defaults: d.normalize(d.defaults),
      hired: store.state.agents.filter((a) => isFunction(a) && a.active !== false && a.fnKey === d.key).map((a) => a.id),
    })));
  });

  app.get('/api/functions/:id', requireCompany, (req, res) => {
    const m = fnMember(req);
    if (!m) return bad(res, 'Função não encontrada', 404);
    res.json(view(req.company, m));
  });

  // contratar: cria o membro do tipo função com a configuração do formulário
  app.post('/api/functions', requireCompany, need('admin'), (req, res) => {
    const store = req.company;
    const def = FUNCTION_CATALOG[req.body?.key];
    if (!def) return bad(res, 'Função desconhecida');
    const name = String(req.body.name || def.name).trim().slice(0, 60) || def.name;
    const base = `${def.role}`.toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'funcao';
    let id = base;
    for (let i = 2; store.getAgent(id); i++) id = `${base}-${i}`;
    const reportsTo = req.body.reportsTo && store.getAgent(req.body.reportsTo) ? req.body.reportsTo : store.owner()?.id || null;
    const m = {
      id, kind: 'function', fnKey: def.key, name, role: def.role, title: def.title,
      color: /^#[0-9a-f]{6}$/i.test(req.body.color || '') ? req.body.color : def.color,
      reportsTo, look: { ...def.look }, fn: { enabled: req.body.enabled !== false, config: def.normalize({ ...def.defaults, ...(req.body.config || {}) }) },
    };
    store.state.agents.push(m);
    store.save();
    runtimeFor(store).logEvent('system', req.member.id, `${req.member.name} contratou ${m.name} (${def.title}, função automática).`);
    refresh(store);
    res.json(view(store, m));
  });

  app.put('/api/functions/:id', requireCompany, need('admin'), (req, res) => {
    const store = req.company;
    const m = fnMember(req);
    if (!m) return bad(res, 'Função não encontrada', 404);
    const def = defOf(m);
    m.fn ||= {};
    if (req.body?.config && def) m.fn.config = def.normalize({ ...m.fn.config, ...req.body.config });
    if (req.body?.enabled !== undefined) {
      m.fn.enabled = !!req.body.enabled;
      runtimeFor(store).logEvent('system', req.member.id, `${req.member.name} ${m.fn.enabled ? 'ativou' : 'pausou'} ${m.name} (${def?.title || 'função'}).`);
      if (!m.fn.enabled) runtimeFor(store).setStatus(m.id, { status: 'idle', bubble: '' });
    }
    store.save();
    refresh(store);
    res.json(view(store, m));
  });

  app.post('/api/functions/:id/run', requireCompany, need('admin'), wrap(async (req, res) => {
    const m = fnMember(req);
    if (!m) return bad(res, 'Função não encontrada', 404);
    const def = defOf(m);
    if (!def) return bad(res, 'Função desconhecida');
    const r = await def.run(runtimeFor(req.company), m, { force: true });
    if (!r) return bad(res, 'Ela já está rodando agora. Tente em alguns segundos.');
    res.json(view(req.company, m));
  }));
}
