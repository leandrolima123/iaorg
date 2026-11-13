// Rotinas: o que se repete na empresa, configurado pelo usuário. Genérico:
//   tipo "task"    → no horário, cria uma tarefa para um agente (executa na oficina, entrega em Arquivos);
//   tipo "meeting" → no horário, reúne participantes (agentes e pessoas), cada um fala com base no
//                    que fez de verdade, o facilitador fecha com ata e encaminhamentos (viram tarefas).
// Agenda: diária, dias úteis, dias da semana escolhidos ou mensal, num horário, no fuso da empresa.
// Cada execução fica no histórico (conversa/ata ou tarefa/entrega) para ver depois.
import fs from 'node:fs';
import path from 'node:path';
import { uid } from './companies.js';
import { providerFor, callClaude, describeError } from './llm.js';
import { profileOf } from './profile.js';
import { readActivity } from './activity.js';
import { recordWrite } from './files.js';
import * as drive from './drive.js';

export const TZ = process.env.COMPANY_TZ || 'America/Sao_Paulo';
const CATCH_UP_MS = 2 * 3600 * 1000; // ficou fora do ar no horário? roda ao voltar se o atraso for até 2 h
const DOW = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

// ---------------- fuso horário ----------------
function partsIn(ts, tz = TZ) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short' })
    .formatToParts(new Date(ts)).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, dow: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
}
// Data/hora local (no fuso) → instante UTC.
function zoned(y, m, d, h, mi, tz = TZ) {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  const p = partsIn(guess, tz);
  const asIfUtc = Date.UTC(p.y, p.m - 1, p.d, p.h, p.mi);
  return guess - (asIfUtc - guess);
}

/** Próxima execução depois de `from`. schedule = { freq: daily|weekdays|weekly|monthly, days:[0-6], dayOfMonth, time:'HH:MM' } */
export function nextRun(schedule, from = Date.now()) {
  const [hh, mm] = String(schedule?.time || '09:00').split(':').map((n) => +n || 0);
  const start = partsIn(from);
  for (let i = 0; i < 400; i++) {
    const base = new Date(Date.UTC(start.y, start.m - 1, start.d + i));
    const y = base.getUTCFullYear(), m = base.getUTCMonth() + 1, d = base.getUTCDate(), dow = base.getUTCDay();
    const f = schedule?.freq || 'daily';
    const okDay = f === 'daily' || (f === 'weekdays' && dow >= 1 && dow <= 5)
      || (f === 'weekly' && (schedule.days || []).includes(dow))
      || (f === 'monthly' && d === Math.min(+schedule.dayOfMonth || 1, new Date(Date.UTC(y, m, 0)).getUTCDate()));
    if (!okDay) continue;
    const at = zoned(y, m, d, hh, mm);
    if (at > from) return at;
  }
  return null;
}

export function describeSchedule(s) {
  const t = s?.time || '09:00';
  if (s?.freq === 'weekdays') return `Dias úteis às ${t}`;
  if (s?.freq === 'weekly') return `${(s.days || []).sort().map((d) => DOW[d]).join(', ') || '(nenhum dia)'} às ${t}`;
  if (s?.freq === 'monthly') return `Todo dia ${s.dayOfMonth || 1} do mês às ${t}`;
  return `Todos os dias às ${t}`;
}

// ---------------- armazenamento ----------------
const list = (store) => (store.state.routines ||= []);
const runsOf = (store) => (store.state.routineRuns ||= []);
const runFile = (store, runId) => path.join(store.dir, 'routines', `${String(runId).replace(/[^\w-]/g, '')}.json`);
export const getRoutine = (store, id) => list(store).find((r) => r.id === id);
export function readRunDetail(store, runId) {
  try { return JSON.parse(fs.readFileSync(runFile(store, runId), 'utf8')); } catch { return null; }
}
function saveRunDetail(store, run, detail) {
  fs.mkdirSync(path.dirname(runFile(store, run.id)), { recursive: true });
  fs.writeFileSync(runFile(store, run.id), JSON.stringify(detail));
}

const S = (v, n) => String(v ?? '').trim().slice(0, n);
export function sanitizeRoutine(body, store, prev = {}) {
  const ids = new Set(store.state.agents.filter((a) => a.active !== false).map((a) => a.id));
  const sch = body.schedule || prev.schedule || {};
  const r = {
    ...prev,
    name: S(body.name ?? prev.name, 80) || 'Rotina',
    kind: ['task', 'meeting'].includes(body.kind) ? body.kind : prev.kind || 'task',
    enabled: body.enabled !== undefined ? !!body.enabled : prev.enabled ?? true,
    instructions: S(body.instructions ?? prev.instructions, 8000),
    folder: S(body.folder ?? prev.folder, 120).replace(/^\/+|\/+$/g, '').replace(/[\\:*?"<>|]/g, ''),
    schedule: {
      freq: ['daily', 'weekdays', 'weekly', 'monthly'].includes(sch.freq) ? sch.freq : 'daily',
      days: (Array.isArray(sch.days) ? sch.days : []).map(Number).filter((d) => d >= 0 && d <= 6),
      dayOfMonth: Math.min(31, Math.max(1, +sch.dayOfMonth || 1)),
      time: /^\d{1,2}:\d{2}$/.test(sch.time || '') ? sch.time.padStart(5, '0') : '09:00',
    },
    assigneeId: ids.has(body.assigneeId) ? body.assigneeId : ids.has(prev.assigneeId) ? prev.assigneeId : null,
    participants: (Array.isArray(body.participants) ? body.participants : prev.participants || []).filter((id) => ids.has(id)),
    facilitatorId: ids.has(body.facilitatorId) ? body.facilitatorId : ids.has(prev.facilitatorId) ? prev.facilitatorId : null,
    createTasks: body.createTasks !== undefined ? !!body.createTasks : prev.createTasks ?? true,
    template: S(body.template ?? prev.template, 40),
  };
  if (r.kind === 'task' && !r.assigneeId) throw new Error('Escolha quem executa a rotina.');
  if (r.kind === 'meeting') {
    if (!r.participants.length) throw new Error('Escolha os participantes da reunião.');
    const ai = r.participants.filter((id) => store.getAgent(id)?.kind !== 'human');
    if (!ai.length) throw new Error('A reunião precisa de pelo menos um agente de IA.');
    if (!r.facilitatorId || !ai.includes(r.facilitatorId)) r.facilitatorId = ai[0];
  }
  r.nextRunAt = r.enabled ? nextRun(r.schedule) : null;
  return r;
}

// ---------------- rotas ----------------
export function mountRoutines(app, { requireCompany, need, wrap, runtimeFor }) {
  const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
  const view = (store, r) => {
    const last = runsOf(store).filter((x) => x.routineId === r.id).at(-1);
    return { ...r, scheduleText: describeSchedule(r.schedule), lastRun: last || null, running: running.has(r.id), myUpdate: undefined };
  };

  app.get('/api/routines', requireCompany, (req, res) => {
    syncTaskRuns(req.company);
    res.json({ tz: TZ, routines: list(req.company).map((r) => ({ ...view(req.company, r), myUpdate: r.updates?.[req.member.id] || null })) });
  });

  app.post('/api/routines', requireCompany, need('admin'), (req, res) => {
    try {
      const r = { id: uid('rot'), createdAt: Date.now(), createdBy: req.member.id, ...sanitizeRoutine(req.body || {}, req.company) };
      list(req.company).push(r);
      req.company.save();
      runtimeFor(req.company).logEvent('system', req.member.id, `${req.member.name} criou a rotina "${r.name}" (${describeSchedule(r.schedule)}).`);
      runtimeFor(req.company).emit({ type: 'routines' });
      res.json(view(req.company, r));
    } catch (e) { bad(res, e.message); }
  });

  app.put('/api/routines/:id', requireCompany, need('admin'), (req, res) => {
    const store = req.company;
    const r = getRoutine(store, req.params.id);
    if (!r) return bad(res, 'Rotina não encontrada', 404);
    try {
      Object.assign(r, sanitizeRoutine(req.body || {}, store, r));
      store.save();
      runtimeFor(store).emit({ type: 'routines' });
      res.json(view(store, r));
    } catch (e) { bad(res, e.message); }
  });

  app.delete('/api/routines/:id', requireCompany, need('admin'), (req, res) => {
    const store = req.company;
    const i = list(store).findIndex((r) => r.id === req.params.id);
    if (i < 0) return bad(res, 'Rotina não encontrada', 404);
    const [r] = list(store).splice(i, 1);
    store.save();
    runtimeFor(store).logEvent('system', req.member.id, `${req.member.name} removeu a rotina "${r.name}". O histórico das execuções continua guardado.`);
    runtimeFor(store).emit({ type: 'routines' });
    res.json({ ok: true });
  });

  app.post('/api/routines/:id/run', requireCompany, need('admin'), wrap(async (req, res) => {
    const store = req.company;
    const r = getRoutine(store, req.params.id);
    if (!r) return bad(res, 'Rotina não encontrada', 404);
    if (running.has(r.id)) return bad(res, 'Esta rotina já está rodando.');
    runRoutine(runtimeFor(store), r, { manual: true, by: req.member.id }).catch(() => {});
    res.json({ ok: true });
  }));

  app.post('/api/routines/:id/skip', requireCompany, need('admin'), (req, res) => {
    const r = getRoutine(req.company, req.params.id);
    if (!r) return bad(res, 'Rotina não encontrada', 404);
    r.skipNext = !r.skipNext;
    req.company.save();
    runtimeFor(req.company).emit({ type: 'routines' });
    res.json({ ok: true, skipNext: r.skipNext });
  });

  // Atualização assíncrona de uma pessoa para a próxima reunião.
  app.post('/api/routines/:id/update', requireCompany, (req, res) => {
    const r = getRoutine(req.company, req.params.id);
    if (!r || r.kind !== 'meeting') return bad(res, 'Reunião não encontrada', 404);
    if (!r.participants.includes(req.member.id)) return bad(res, 'Você não participa desta reunião', 403);
    (r.updates ||= {})[req.member.id] = { text: S(req.body?.text, 3000), ts: Date.now() };
    req.company.save();
    res.json({ ok: true });
  });

  app.get('/api/routines/:id/runs', requireCompany, (req, res) => {
    syncTaskRuns(req.company);
    res.json(runsOf(req.company).filter((x) => x.routineId === req.params.id).slice().reverse().slice(0, 100));
  });

  app.get('/api/routine-runs/:runId', requireCompany, (req, res) => {
    const store = req.company;
    syncTaskRuns(store);
    const run = runsOf(store).find((x) => x.id === req.params.runId);
    if (!run) return bad(res, 'Execução não encontrada', 404);
    const task = run.taskId ? store.state.tasks.find((t) => t.id === run.taskId) : null;
    const job = run.taskId ? (store.state.jobs || []).filter((j) => j.taskId === run.taskId).at(-1) : null;
    res.json({ run, detail: readRunDetail(store, run.id), task, job: job ? { ...job, toolNames: undefined, inputs: undefined } : null });
  });
}

// ---------------- execução ----------------
const today = (ts = Date.now()) => { const p = partsIn(ts); return `${p.y}-${String(p.m).padStart(2, '0')}-${String(p.d).padStart(2, '0')}`; };
const slug = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
const running = new Set();

/** Chamado pelo agendador do motor a cada ~30 s. */
export async function tickRoutines(rt) {
  const store = rt.store;
  if (store.state.paused) return;
  const now = Date.now();
  for (const r of list(store)) {
    if (!r.enabled || !r.nextRunAt || r.nextRunAt > now || running.has(r.id)) continue;
    const late = now - r.nextRunAt;
    const scheduled = r.nextRunAt;
    r.nextRunAt = nextRun(r.schedule, now);
    if (r.skipNext) { r.skipNext = false; addRun(store, r, { status: 'skipped', note: 'Pulada a pedido', scheduledFor: scheduled }); store.save(); continue; }
    if (late > CATCH_UP_MS) { addRun(store, r, { status: 'skipped', note: 'O sistema estava fora do ar no horário', scheduledFor: scheduled }); store.save(); continue; }
    store.save();
    runRoutine(rt, r, { scheduledFor: scheduled }).catch((e) => console.error('[rotinas]', e));
  }
}

function addRun(store, r, extra) {
  const run = { id: uid('run'), routineId: r.id, name: r.name, kind: r.kind, startedAt: Date.now(), status: 'running', ...extra };
  runsOf(store).push(run);
  if (runsOf(store).length > 500) runsOf(store).splice(0, runsOf(store).length - 500);
  if (run.status !== 'running') run.endedAt = run.startedAt;
  r.lastRunId = run.id; r.lastRunAt = run.startedAt;
  return run;
}

export async function runRoutine(rt, r, { scheduledFor, manual = false, by } = {}) {
  const store = rt.store;
  if (running.has(r.id)) throw new Error('Esta rotina já está rodando.');
  running.add(r.id);
  const run = addRun(store, r, { scheduledFor: scheduledFor || Date.now(), manual, by: by || null });
  store.save();
  rt.logEvent('system', null, `Rotina "${r.name}" começou${manual ? ' (rodada manualmente)' : ''}.`);
  rt.emit({ type: 'routines' });
  try {
    if (r.kind === 'task') await runTask(rt, r, run);
    else await runMeeting(rt, r, run);
  } catch (e) {
    Object.assign(run, { status: 'failed', error: describeError(e), endedAt: Date.now() });
    rt.logEvent('error', null, `Rotina "${r.name}" falhou: ${run.error}`);
  } finally {
    running.delete(r.id);
    store.save();
    rt.emit({ type: 'routines' });
    rt.pushSnapshot();
  }
  return run;
}

// Tipo tarefa: vira uma tarefa normal para o agente (oficina), ligada à execução.
async function runTask(rt, r, run) {
  const store = rt.store;
  const agent = store.getAgent(r.assigneeId);
  if (!agent) throw new Error('O responsável não existe mais.');
  const d = today();
  const folder = r.folder || '';
  const task = rt.createTask({
    title: `${r.name} · ${d.split('-').reverse().slice(0, 2).join('/')}`,
    description: `${r.instructions || '(sem instruções)'}\n\n---\nRotina "${r.name}" (${describeSchedule(r.schedule)}).${folder ? ` Salve a entrega em ${folder}/ com a data no nome (ex.: ${folder}/${d}-${slug(r.name)}.md).` : ''} Compare com a execução anterior quando fizer sentido (veja os arquivos da pasta).`,
    assigneeId: agent.id, creatorId: r.createdBy || store.owner()?.id || 'board',
  });
  task.routineRunId = run.id;
  Object.assign(run, { taskId: task.id, agentId: agent.id, status: 'running' });
}

/** Atualiza execuções do tipo tarefa conforme a tarefa anda. */
export function syncTaskRuns(store) {
  for (const run of runsOf(store)) {
    if (run.kind !== 'task' || run.status !== 'running' || !run.taskId) continue;
    const t = store.state.tasks.find((x) => x.id === run.taskId);
    if (!t) { Object.assign(run, { status: 'failed', error: 'A tarefa foi removida', endedAt: Date.now() }); continue; }
    if (['done', 'review', 'blocked'].includes(t.status)) Object.assign(run, { status: t.status === 'blocked' ? 'failed' : 'done', endedAt: Date.now(), summary: String(t.result || '').slice(0, 4000), error: t.status === 'blocked' ? String(t.result || 'Tarefa bloqueada').slice(0, 300) : undefined });
  }
}

// Contexto real de cada participante para falar na reunião.
function recentContext(store, agentId, sinceTs) {
  const items = readActivity(store, agentId, { limit: 80 }).filter((e) => e.ts >= sinceTs && ['message', 'task', 'job', 'file', 'text', 'error'].includes(e.type));
  const open = store.state.tasks.filter((t) => t.assigneeId === agentId && t.status !== 'done').slice(-10);
  return [
    items.length ? `O que você fez (log):\n${items.reverse().map((e) => `- ${new Date(e.ts).toLocaleString('pt-BR', { timeZone: TZ, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} [${e.type}${e.name ? `:${e.name}` : ''}] ${String(e.text).slice(0, 220).replace(/\n/g, ' ')}`).join('\n')}` : 'Nada registrado no período.',
    open.length ? `Suas tarefas abertas:\n${open.map((t) => `- [${t.id}] (${t.status}) ${t.title}`).join('\n')}` : 'Nenhuma tarefa aberta.',
  ].join('\n\n');
}

async function say(rt, agent, prompt, { maxText = 1800 } = {}) {
  const store = rt.store;
  if (providerFor(store) === 'mock') return `(modo simulado) ${agent.name}: sem novidades relevantes.`;
  const p = profileOf(agent);
  const r = await callClaude(store, { system: rt.systemBlocks(agent), messages: [{ role: 'user', content: prompt }], tools: [], model: p.model, effort: p.effort });
  rt.trackUsage(r.usage, { model: p.model, agentId: agent.id, kind: 'meeting' });
  return r.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim().slice(0, maxText) || '(sem fala)';
}

async function runMeeting(rt, r, run) {
  const store = rt.store;
  const people = r.participants.map((id) => store.getAgent(id)).filter(Boolean);
  const ai = people.filter((a) => a.kind !== 'human');
  const humans = people.filter((a) => a.kind === 'human');
  const fac = store.getAgent(r.facilitatorId) || ai[0];
  const group = `grupo:${r.id}`;
  const since = (runsOf(store).filter((x) => x.routineId === r.id && x.status === 'done').at(-1)?.startedAt) || Date.now() - 26 * 3600 * 1000;
  const transcript = [];
  const push = (from, text) => { transcript.push({ ts: Date.now(), from, text }); rt.setStatus(from, { status: 'meeting', with: group, bubble: String(text).replace(/\s+/g, ' ').slice(0, 130) }); };
  run.participants = people.map((p) => p.id);
  run.facilitatorId = fac.id;
  for (const a of ai) rt.setStatus(a.id, { status: 'meeting', with: group, bubble: '' });
  await new Promise((res) => setTimeout(res, 6000)); // tempo de chegarem à sala

  push(fac.id, `Bom dia! Começando a ${r.name}.${r.instructions ? ` Pauta: ${r.instructions.split('\n')[0].slice(0, 200)}` : ''}`);
  // Pessoas: atualização enviada antes (assíncrona).
  for (const h of humans) {
    const u = r.updates?.[h.id];
    push(h.id, u && u.ts >= since ? u.text : '(não enviou atualização)');
  }
  // Agentes: cada um fala com base no próprio log.
  for (const a of ai.filter((x) => x.id !== fac.id).concat(ai.includes(fac) ? [fac] : [])) {
    const others = transcript.map((t) => `${store.getAgent(t.from)?.name || t.from}: ${t.text}`).join('\n');
    const text = await say(rt, a, `Você está na reunião "${r.name}" da empresa, com ${people.map((p) => p.name).join(', ')}.
Pauta e formato da reunião:
${r.instructions || 'Cada um diz o que fez, o que vai fazer e se tem bloqueio.'}

Use SOMENTE fatos do seu histórico abaixo (não invente).
${recentContext(store, a.id, since)}

O que já foi dito na reunião:
${others || '(ninguém falou ainda)'}

Agora é a sua vez. Fale em tópicos curtos (no máximo 6 linhas), em português, como numa reunião de verdade. Responda só com a sua fala.`);
    push(a.id, text);
    rt.emit({ type: 'routines' });
  }
  // Fechamento: ata + encaminhamentos estruturados.
  const roster = people.map((p) => `- id ${p.id}: ${p.name} (${p.role}${p.kind === 'human' ? ', pessoa' : ''})`).join('\n');
  const raw = await say(rt, fac, `Você facilitou a reunião "${r.name}". Pauta: ${r.instructions || '-'}
Participantes:
${roster}

Transcrição:
${transcript.map((t) => `${store.getAgent(t.from)?.name || t.from}: ${t.text}`).join('\n\n')}

Feche a reunião. Responda APENAS com JSON válido neste formato:
{"resumo":"3 a 6 linhas","decisoes":["..."],"bloqueios":["..."],"encaminhamentos":[{"responsavel_id":"id do participante","titulo":"curto","descricao":"o que fazer e critério de pronto"}]}
Só crie encaminhamentos concretos que saíram da conversa (pode ser lista vazia).`, { maxText: 6000 });
  let ata = { resumo: raw, decisoes: [], bloqueios: [], encaminhamentos: [] };
  try { ata = { ...ata, ...JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)) }; } catch { /* fica o texto */ }
  push(fac.id, `Encerrando. ${String(ata.resumo).split('\n')[0].slice(0, 200)}`);

  // Encaminhamentos → tarefas
  const created = [];
  if (r.createTasks) {
    for (const e of (ata.encaminhamentos || []).slice(0, 10)) {
      const who = store.getAgent(e.responsavel_id);
      if (!who || who.active === false) continue;
      const t = rt.createTask({ title: String(e.titulo || 'Encaminhamento').slice(0, 120), description: `${e.descricao || ''}\n\n(Encaminhamento da reunião "${r.name}" de ${today().split('-').reverse().join('/')})`, assigneeId: who.id, creatorId: fac.id });
      created.push({ id: t.id, title: t.title, assigneeId: who.id });
    }
  }

  // Ata em Arquivos
  const name = (id) => store.getAgent(id)?.name || id;
  const folder = r.folder || `Reunioes/${r.name.replace(/[\\/:*?"<>|]/g, '').trim() || 'Reuniao'}`;
  const rel = `${folder}/${today()}.md`;
  const md = [
    `# ${r.name} · ${today().split('-').reverse().join('/')}`,
    `Participantes: ${people.map((p) => p.name).join(', ')} · Facilitação: ${fac.name}`, '',
    '## Resumo', String(ata.resumo || ''), '',
    ...(ata.decisoes?.length ? ['## Decisões', ...ata.decisoes.map((x) => `- ${x}`), ''] : []),
    ...(ata.bloqueios?.length ? ['## Bloqueios', ...ata.bloqueios.map((x) => `- ${x}`), ''] : []),
    ...(created.length ? ['## Encaminhamentos', ...created.map((t) => `- [${t.id}] ${t.title} — ${name(t.assigneeId)}`), ''] : []),
    '## Conversa', ...transcript.map((t) => `**${name(t.from)}:** ${t.text}\n`),
  ].join('\n');
  const full = store.safePath(rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, md);
  recordWrite(store, rel, { by: fac.id });
  rt.emit({ type: 'files' });
  drive.schedule(store, rt);

  saveRunDetail(store, run, { transcript, ata, created, file: rel });
  if (r.updates) for (const h of humans) delete r.updates[h.id];
  Object.assign(run, { status: 'done', endedAt: Date.now(), summary: String(ata.resumo || '').slice(0, 1200), file: rel, tasksCreated: created.length });
  for (const a of ai) rt.setStatus(a.id, { status: 'idle', with: null, bubble: '' });
  rt.logEvent('task', fac.id, `Reunião "${r.name}" encerrada: ata em ${rel}${created.length ? `, ${created.length} encaminhamento(s) virou(aram) tarefa` : ''}.`);
  const owner = store.owner();
  if (owner) rt.emit({ type: 'notify', to: owner.id, text: `Ata da ${r.name} pronta (Rotinas)` });
}
