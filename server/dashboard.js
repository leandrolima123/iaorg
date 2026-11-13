// Painel (folha de pagamento dos agentes): custo, produção e eficiência por agente e por período.
// Fonte do custo: o livro diário (state.costDaily, por agente e tipo) + o custo exato de cada trabalho da oficina.
const TZ = process.env.COMPANY_TZ || 'America/Sao_Paulo';
const dayOf = (ts) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(ts));
const KINDS = ['chat', 'job', 'meeting', 'sim', 'cache']; // cache = mantenedor do cache (fora do uso real)

/** Uma vez: leva para o livro o custo dos trabalhos da oficina de antes do livro existir. */
export function backfillLedger(store) {
  const s = store.state;
  // nomes de agentes já desligados: recupera pelo diário ("X demitiu Nome (Cargo).") → id = cargo normalizado
  if (!s.namesBackfill) {
    const names = (s.agentNames ||= {});
    const norm = (t) => String(t).toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    for (const e of s.events || []) {
      const m = String(e.text || '').match(/demitiu (.+?) \((.+?)\)\.?$/);
      if (m && !store.getAgent(norm(m[2])) && !names[norm(m[2])]) names[norm(m[2])] = { name: m[1], role: m[2] };
    }
    s.namesBackfill = true;
  }
  if (s.costBackfill) return;
  const book = (s.costDaily ||= {});
  for (const j of s.jobs || []) {
    if (j.ledgered || !j.costUsd) continue;
    const d = (book[dayOf(j.endedAt || j.startedAt || Date.now())] ||= {});
    const e = (d[j.agentId] ||= { chat: 0, job: 0, meeting: 0, sim: 0, calls: 0, tin: 0, tout: 0 });
    e.job += j.costUsd; e.calls += 1;
    j.ledgered = true;
  }
  // o resto do gasto histórico (conversas, reuniões) não tem agente registrado: fica à parte
  const inBook = Object.values(book).reduce((t, d) => t + Object.values(d).reduce((u, e) => u + KINDS.reduce((v, k) => v + (e[k] || 0), 0), 0), 0);
  const total = s.usage?.costUsd || 0;
  const since = Math.min(...(s.events || []).map((e) => e.ts).filter(Boolean), ...(s.messages || []).map((m) => m.ts).filter(Boolean), Date.now());
  s.costUnattributed = { usd: Math.max(0, total - inBook), since, until: Date.now() };
  for (const a of s.agents || []) if (a.kind !== 'human') (s.agentNames ||= {})[a.id] = { name: a.name, role: a.role };
  s.costBackfill = true;
}

const between = (ts, from, to) => ts && ts >= from && ts < to;

function period(q) {
  // datas AAAA-MM-DD no fuso da empresa; "to" inclusivo
  const today = dayOf(Date.now());
  const from = /^\d{4}-\d{2}-\d{2}$/.test(q.from || '') ? q.from : `${today.slice(0, 8)}01`;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(q.to || '') && q.to >= from ? q.to : today;
  const ms = (d) => Date.parse(`${d}T00:00:00-03:00`); // Brasil sem horário de verão
  const fromTs = ms(from), toTs = ms(to) + 864e5;
  const len = toTs - fromTs;
  return { from, to, fromTs, toTs, prevFromTs: fromTs - len, prevToTs: fromTs, days: Math.round(len / 864e5) };
}

function costsIn(book, fromDay, toDay) {
  const by = {};
  const daily = {};
  for (const [day, d] of Object.entries(book || {})) {
    if (day < fromDay || day > toDay) continue;
    for (const [id, e] of Object.entries(d)) {
      const b = (by[id] ||= { chat: 0, job: 0, meeting: 0, sim: 0, calls: 0, tin: 0, tout: 0 });
      for (const k of [...KINDS, 'calls', 'tin', 'tout', 'cr', 'cw', 'ci']) b[k] = (b[k] || 0) + (e[k] || 0);
      const dd = (daily[day] ||= { total: 0, by: {} });
      const c = KINDS.reduce((t, k) => t + (e[k] || 0), 0);
      dd.total += c; dd.by[id] = (dd.by[id] || 0) + c;
    }
  }
  return { by, daily };
}

export function dashboard(store, rt, q = {}) {
  backfillLedger(store);
  const s = store.state;
  const p = period(q);
  const dayStr = (ts) => dayOf(ts);
  const cur = costsIn(s.costDaily, p.from, p.to);
  const prev = costsIn(s.costDaily, dayStr(p.prevFromTs), dayStr(p.prevToTs - 1));
  const names = s.agentNames || {};
  const live = new Map((s.agents || []).map((a) => [a.id, a]));
  const ids = new Set([...(s.agents || []).filter((a) => a.kind !== 'human' && a.active !== false).map((a) => a.id), ...Object.keys(cur.by).filter((id) => id !== '_')]);
  const tasks = s.tasks || [];
  const jobs = s.jobs || [];
  const msgs = s.messages || [];
  const isHuman = (id) => live.get(id)?.kind === 'human';

  const rows = [...ids].map((id) => {
    const a = live.get(id);
    const c = cur.by[id] || { chat: 0, job: 0, meeting: 0, sim: 0, cache: 0, calls: 0, tin: 0, tout: 0, cr: 0, cw: 0 };
    const pc = prev.by[id];
    const cost = KINDS.reduce((t, k) => t + (c[k] || 0), 0);
    const prevCost = pc ? KINDS.reduce((t, k) => t + (pc[k] || 0), 0) : 0;
    const mine = tasks.filter((t) => t.assigneeId === id);
    const done = mine.filter((t) => t.status === 'done' && between(t.updatedAt, p.fromTs, p.toTs));
    const blocked = mine.filter((t) => t.status === 'blocked' && between(t.updatedAt, p.fromTs, p.toTs)).length;
    const review = mine.filter((t) => t.status === 'review').length;
    const open = mine.filter((t) => ['todo', 'doing'].includes(t.status)).length;
    const leadH = done.length ? done.reduce((t, x) => t + Math.max(0, (x.updatedAt || 0) - (x.createdAt || x.updatedAt || 0)), 0) / done.length / 36e5 : null;
    const js = jobs.filter((j) => j.agentId === id && between(j.endedAt || j.startedAt, p.fromTs, p.toTs));
    const jobsOk = js.filter((j) => j.status === 'done').length;
    const jobHours = js.reduce((t, j) => t + Math.max(0, ((j.endedAt || Date.now()) - (j.startedAt || 0))) / 36e5, 0);
    const prs = js.filter((j) => j.pr?.state === 'merged').length;
    const sent = msgs.filter((m) => m.from === id && between(m.ts, p.fromTs, p.toTs));
    const toClients = sent.filter((m) => String(m.to).startsWith('caixa:')).length;
    const toPeople = sent.filter((m) => isHuman(m.to)).length;
    const profileModel = a?.profile?.model || '';
    return {
      id, name: a?.name || names[id]?.name || id, role: a?.role || names[id]?.role || '', color: a?.color || '#8f8d86',
      active: !!a && a.active !== false, model: profileModel || store.company.settings?.model || '',
      cost: +cost.toFixed(4), prevCost: +prevCost.toFixed(4),
      breakdown: { conversas: +c.chat.toFixed(4), oficina: +c.job.toFixed(4), reunioes: +c.meeting.toFixed(4), simulador: +c.sim.toFixed(4), cache: +(c.cache || 0).toFixed(4) },
      calls: c.calls, tokensIn: c.tin, tokensOut: c.tout,
      // taxa de acerto do cache: parte da entrada lida do cache (só conta a partir de quando o livro registra cache)
      cacheRead: c.cr || 0, cacheWrite: c.cw || 0, cacheIn: c.ci || 0, cacheHit: c.ci ? +((c.cr || 0) / c.ci).toFixed(3) : null,
      tasksDone: done.length, tasksBlocked: blocked, inReview: review, open, leadHours: leadH == null ? null : +leadH.toFixed(1),
      jobs: js.length, jobsOk, jobHours: +jobHours.toFixed(2), prsMerged: prs,
      msgsToClients: toClients, msgsToPeople: toPeople, msgsTotal: sent.length,
      costPerTask: done.length ? +(cost / done.length).toFixed(4) : null,
    };
  }).sort((x, y) => y.cost - x.cost || x.name.localeCompare(y.name, 'pt-BR'));

  const sum = (k) => rows.reduce((t, r) => t + (r[k] || 0), 0);
  const unknown = KINDS.reduce((t, k) => t + (cur.by._?.[k] || 0), 0);
  const total = sum('cost') + unknown;
  const prevTotal = rows.reduce((t, r) => t + r.prevCost, 0) + KINDS.reduce((t, k) => t + (prev.by._?.[k] || 0), 0);
  const days = [];
  for (let t = p.fromTs; t < p.toTs; t += 864e5) { const d = dayOf(t + 3 * 36e5); days.push({ day: d, total: +(cur.daily[d]?.total || 0).toFixed(4), by: cur.daily[d]?.by || {} }); }
  const un = s.costUnattributed;
  if (un && !un.since) { un.since = Math.min(...(s.events || []).map((e) => e.ts).filter(Boolean), ...(s.messages || []).map((m) => m.ts).filter(Boolean), un.until); store.save(); }
  const usage = rt.usagePayload();
  return {
    period: p, rows,
    totals: {
      cost: +total.toFixed(4), prevCost: +prevTotal.toFixed(4), unassigned: +unknown.toFixed(4),
      tasksDone: sum('tasksDone'), jobs: sum('jobs'), jobHours: +sum('jobHours').toFixed(2), prsMerged: sum('prsMerged'),
      msgsToClients: sum('msgsToClients'), calls: sum('calls'),
      cacheKeep: +rows.reduce((t, r) => t + r.breakdown.cache, 0).toFixed(4),
      cacheHit: sum('cacheIn') ? +(sum('cacheRead') / sum('cacheIn')).toFixed(3) : null,
      cacheRead: sum('cacheRead'), cacheWrite: sum('cacheWrite'),
      costPerTask: sum('tasksDone') ? +(sum('cost') / sum('tasksDone')).toFixed(4) : null,
    },
    days,
    month: { spent: +(usage.monthCostUsd || 0).toFixed(4), budget: usage.budgetUsd || 0 },
    // gasto de antes do painel existir, sem agente registrado (só aparece se o período o inclui)
    legacy: un && un.usd > 0.0001 && p.fromTs < un.until && p.toTs > (un.since || 0) ? { usd: +un.usd.toFixed(4), until: un.until } : null,
  };
}

export function mountDashboard(app, { requireCompany, need, runtimeFor }) {
  app.get('/api/dashboard', requireCompany, need('admin'), (req, res) => {
    res.json(dashboard(req.company, runtimeFor(req.company), req.query));
  });
}
