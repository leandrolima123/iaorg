// Oficina: cada tarefa de um agente de IA vira um job num container isolado (via runner), onde o
// agente trabalha com o motor do Claude Code e o kit da sua designação. Este módulo monta o job,
// recebe os eventos ao vivo, faz a ponte das ferramentas do IAORG e fecha a entrega (arquivos,
// memória, e no kit Código: PR, CI e merge automático).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import { allCompanies, uid } from './companies.js';
import { profileOf } from './profile.js';
import { can, allowedRepos, githubSecret } from './integrations.js';
import * as github from './github.js';
import { readMemory, writeMemory } from './memory.js';
import { recordWrite } from './files.js';
import { logActivity } from './activity.js';
import * as drive from './drive.js';
import { knowledgeMode } from './knowledge.js';

const RUNNER_URL = (process.env.RUNNER_URL || '').replace(/\/$/, '');
const RUNNER_TOKEN = process.env.RUNNER_TOKEN || '';
const PER_COMPANY = +process.env.WORKSHOP_MAX_PER_COMPANY || 2;
const MAX_IN_FILES = 20 * 1024 * 1024;
// Ferramentas do ciclo antigo substituídas pelas do Claude Code dentro do container.
// Na oficina a memória é o /work/MEMORY.md (gravado ao fim do trabalho), então guardar_na_memoria não entra.
const REPLACED = new Set(['read_file', 'list_files', 'write_file', 'guardar_na_memoria']);
const REPLACED_CODE = new Set(['repo_list_files', 'repo_read_file', 'repo_open_pr']);
// Em job de teste, nada irreversível sai do IAORG.
const BLOCKED_IN_TEST = new Set(['railway_redeploy', 'railway_restart', 'railway_set_variable', 'calendar_create', 'repo_open_pr', 'gmail_draft', 'chat_resolve']);

export const enabled = () => !!(RUNNER_URL && RUNNER_TOKEN);
const slug = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 36) || 'tarefa';
const short = (s, n = 160) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };
const PHASE_LABEL = { preparando: 'Preparando o ambiente', clonando: 'Clonando o repositório', instalando: 'Instalando dependências', trabalhando: 'Trabalhando', verificando: 'Verificando', enviando: 'Enviando a branch', fim: 'Finalizando' };

async function runner(method, p, body) {
  const r = await fetch(RUNNER_URL + p, {
    method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RUNNER_TOKEN}` },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(60000),
  });
  const data = await r.json().catch(() => ({}));
  return { status: r.status, data };
}

const jobsOf = (store) => (store.state.jobs ||= []);
export const findJob = (store, id) => jobsOf(store).find((j) => j.id === id);
function locate(jobId) {
  for (const store of allCompanies()) { const j = findJob(store, jobId); if (j) return { store, job: j }; }
  return null;
}
const sessionFile = (store, taskId) => path.join(store.dir, 'sessions', `${String(taskId).replace(/[^\w-]/g, '')}.tgz`);

// Kit de trabalho a partir dos acessos e da ficha (mesmo motor para todos; muda o que o agente tem à mão).
export function kitsFor(store, agent) {
  const w = profileOf(agent).workshop;
  const kits = { research: !!w.research, browser: !!w.browser, code: null, shell: false };
  if (can(store, agent, 'github', 'code')) {
    const repos = allowedRepos(store, agent);
    const repo = w.code.repo && repos.includes(w.code.repo) ? w.code.repo : repos[0];
    if (repo) {
      const meta = (store.state.integrations?.github?.config?.repos || []).find((r) => r.fullName === repo);
      kits.code = { repo, base: w.code.baseBranch || meta?.defaultBranch || 'main', setup: w.code.setup, test: w.code.test, lint: w.code.lint, postgres: w.code.postgres, redis: w.code.redis, autoMerge: w.code.autoMerge, ciWaitMin: w.code.ciWaitMin };
    }
  }
  if (kits.browser) kits.shell = true; // navegador costuma precisar de terminal (servir o app, scripts)
  return kits;
}

const sha1 = (buf) => crypto.createHash('sha1').update(buf).digest('hex');
function workspaceFiles(store) {
  const out = []; let total = 0;
  for (const f of store.listFiles()) {
    if (f.size > 5 * 1024 * 1024 || total + f.size > MAX_IN_FILES) continue;
    total += f.size;
    const data = fs.readFileSync(store.safePath(f.path));
    out.push({ path: f.path, b64: data.toString('base64'), sha: sha1(data) });
  }
  return out;
}

/** Manda uma tarefa para a oficina. */
// Base de conhecimento do agente como arquivos (/work/conhecimento): um por trecho, por categoria, mais um índice.
// O agente busca e lê só o que precisa, em vez de carregar a base inteira no prompt a cada passo.
export function knowledgeFiles(store, agent) {
  const { chunks } = knowledgeMode(store, agent);
  if (!chunks.length) return [];
  const used = new Set();
  const files = chunks.map((k, i) => {
    let p = `${slug(k.category || k.collection || 'geral')}/${String(i + 1).padStart(3, '0')}-${slug(k.title)}.md`;
    while (used.has(p)) p = p.replace(/\.md$/, '-b.md');
    used.add(p);
    const head = [`# ${k.title}`, k.category && `Categoria: ${k.category}`, k.plans?.length && `Planos: ${k.plans.join(', ')}`, k.questions?.length && `Perguntas típicas: ${k.questions.join(' | ')}`].filter(Boolean).join('\n');
    return { path: p, text: `${head}\n\n${k.text}\n`, title: k.title, questions: k.questions || [] };
  });
  const index = `# Base de conhecimento (${files.length} trechos)\n\nBusque com Grep nesta pasta e leia só os arquivos que importam.\n\n${files.map((f) => `- ${f.path} — ${f.title}${f.questions.length ? ` (ex.: ${f.questions.slice(0, 2).join(' | ')})` : ''}`).join('\n')}\n`;
  return [{ path: 'INDICE.md', text: index }, ...files.map(({ path: p, text }) => ({ path: p, text }))];
}

export async function startJob(rt, agent, task, { test = false } = {}) {
  const store = rt.store;
  // Uma tarefa de teste continua de teste em qualquer rodada (inclusive "pedir ajuste"): nunca faz merge.
  if (test) task.test = true;
  test = test || !!task.test || /^\[Teste\]/.test(task.title);
  if (test) task.test = true;
  const profile = profileOf(agent);
  const w = profile.workshop;
  const kits = kitsFor(store, agent);
  const prev = jobsOf(store).filter((j) => j.taskId === task.id).at(-1);
  const adjust = task.adjust || '';
  const job = {
    id: uid('job'), agentId: agent.id, taskId: task.id, status: 'starting', phase: 'preparando', phaseText: PHASE_LABEL.preparando,
    plan: [], steps: [], startedAt: Date.now(), costUsd: 0, test, adjust: adjust || null,
    kits: { code: kits.code?.repo || null, research: kits.research, browser: kits.browser },
  };
  if (kits.code) job.branch = prev?.branch || `iaorg/${task.id.toLowerCase()}-${slug(task.title)}`;
  task.presented = true;
  delete task.adjust;
  jobsOf(store).push(job);
  if (jobsOf(store).length > 200) jobsOf(store).splice(0, jobsOf(store).length - 200);
  if (task.status === 'todo') { task.status = 'doing'; task.updatedAt = Date.now(); }
  store.save();
  rt.setStatus(agent.id, { status: 'working', bubble: `Oficina: ${short(task.title, 60)}` });
  rt.logEvent('task', agent.id, `${agent.name} começou ${task.id} na oficina${kits.code ? ` (${kits.code.repo})` : ''}${adjust ? ' — ajuste pedido' : ''}${test ? ' [teste]' : ''}`);
  rt.pushSnapshot();

  const tools = rt.tools(agent).filter((t) => !REPLACED.has(t.name) && !(kits.code && REPLACED_CODE.has(t.name)));
  job.toolNames = tools.map((t) => t.name);
  const creator = rt.nameOf(task.creatorId);
  const files = workspaceFiles(store);
  job.inputs = Object.fromEntries(files.map((f) => [f.path, f.sha])); // para saber o que o agente moveu/apagou
  const prompt = [
    `# Tarefa ${task.id}: ${task.title}`,
    `Pedida por: ${creator}${task.parentId ? ` · parte de ${task.parentId}` : ''}`,
    '', '## Descrição e critério de pronto', task.description || '(sem descrição: entenda pelo título e, se faltar algo essencial, pergunte a quem pediu com send_message antes de seguir)',
    adjust ? `\n## AJUSTE PEDIDO (continue o trabalho anterior)\n${adjust}` : '',
    prev?.summary && adjust ? `\n## Resumo da rodada anterior\n${prev.summary}` : '',
    kits.code ? `\n## Repositório\n${kits.code.repo} · você está na branch ${job.branch} (base ${kits.code.base}).${kits.code.test ? ` Testes: \`${kits.code.test}\`.` : ''}${kits.code.lint ? ` Lint: \`${kits.code.lint}\`.` : ''}${kits.code.postgres ? ' Postgres disponível em DATABASE_URL.' : ''}${kits.code.redis ? ' Redis em REDIS_URL.' : ''}` : '',
    files.length ? `\n## Arquivos da empresa em /work/entregas\n${files.slice(0, 60).map((f) => `- ${f.path}`).join('\n')}` : '',
    test ? '\n(Esta é uma TAREFA DE TESTE: trabalhe normalmente, mas saiba que nada irreversível será executado e envios ficam em rascunho.)' : '',
  ].filter(Boolean).join('\n');

  const session = prev?.sessionId && adjust && fs.existsSync(sessionFile(store, task.id)) ? fs.readFileSync(sessionFile(store, task.id)).toString('base64') : null;
  const spec = {
    id: job.id, companyId: store.id, perCompanyMax: PER_COMPANY,
    limits: { timeoutMin: w.timeoutMin, memoryMb: kits.browser || kits.code ? 3072 : 1536, cpus: 2 },
    services: { postgres: !!kits.code?.postgres, redis: !!kits.code?.redis },
    secrets: { anthropicKey: store.getSecret('claudeKey'), githubToken: kits.code ? githubSecret(store) : undefined },
    files: files.map(({ path: p, b64 }) => ({ path: p, b64 })), session,
    worker: {
      prompt, append: rt.systemPrompt(agent, { mode: 'job' }),
      model: profile.model || store.company.settings.model, maxTurns: w.maxTurns, maxBudgetUsd: w.maxBudgetUsd,
      kits: { research: kits.research, browser: kits.browser, shell: kits.shell, code: kits.code ? { repo: kits.code.repo, base: kits.code.base, branch: job.branch, setup: kits.code.setup, test: kits.code.test, lint: kits.code.lint, gitName: `${agent.name} (IAORG)`, gitEmail: `${slug(agent.name)}+${agent.id}@agentes.iaorg.local` } : null },
      services: { postgres: !!kits.code?.postgres, redis: !!kits.code?.redis },
      mcpTools: tools, memory: readMemory(store, agent.id), knowledge: knowledgeFiles(store, agent), resumeSessionId: session ? prev.sessionId : null,
      commitTitle: `${task.id}: ${task.title}`.slice(0, 72), commitBody: `Feito por ${agent.name} (${agent.role}) na oficina do IAORG.`,
    },
  };

  let r;
  try { r = await runner('POST', '/jobs', spec); } catch (e) { r = { status: 0, data: { error: e.message } }; }
  if (r.status === 202) { job.status = 'running'; store.save(); rt.pushSnapshot(); return job; }
  // Fila cheia: devolve a tarefa para a fila e tenta de novo daqui a pouco.
  const busy = r.status === 429;
  Object.assign(job, { status: busy ? 'queued' : 'failed', endedAt: Date.now(), error: busy ? null : `Oficina indisponível: ${r.data?.error || r.status}` });
  if (busy) { jobsOf(store).splice(jobsOf(store).indexOf(job), 1); task.presented = false; task.status = 'todo'; task.retryAt = Date.now() + 30_000; if (adjust) task.adjust = adjust; }
  else { rt.updateTask(task, { status: 'blocked', result: job.error }, agent.id); }
  store.save();
  rt.setStatus(agent.id, { status: 'idle', bubble: busy ? 'Aguardando vaga na oficina' : '' });
  rt.pushSnapshot();
  return null;
}

// ---------- eventos ao vivo ----------
function onEvents(rt, job, events) {
  const agent = rt.store.getAgent(job.agentId);
  for (const ev of events) {
    // log completo do agente (oficina): fases, plano, ferramentas, texto, testes e erros
    if (ev.type === 'phase') logActivity(rt.store, job.agentId, { type: 'job', name: 'fase', task: job.taskId, text: ev.text || ev.phase });
    else if (ev.type === 'plan') logActivity(rt.store, job.agentId, { type: 'job', name: 'plano', task: job.taskId, text: (ev.todos || []).map((t) => `${t.status === 'completed' ? '☑' : t.status === 'in_progress' ? '▶' : '☐'} ${t.text}`).join('\n') });
    else if (['tool', 'text', 'tests', 'error'].includes(ev.type)) logActivity(rt.store, job.agentId, { type: ev.type === 'error' ? 'error' : ev.type === 'text' ? 'text' : 'job', name: ev.type === 'tests' ? 'testes' : ev.name || '', ok: ev.ok, task: job.taskId, text: ev.text });
    else if (ev.type === 'result') logActivity(rt.store, job.agentId, { type: 'job', name: 'resultado', task: job.taskId, text: `${ev.subtype === 'success' ? 'Terminou' : `Parou (${ev.subtype})`} · ${ev.turns || 0} passos · US$ ${(ev.costUsd || 0).toFixed(3)}` });
    if (ev.type === 'phase') {
      if (ev.phase !== job.phase && ['clonando', 'verificando', 'enviando'].includes(ev.phase)) rt.logEvent('task', job.agentId, `${agent?.name}: ${ev.text}`);
      Object.assign(job, { phase: ev.phase, phaseText: ev.text || PHASE_LABEL[ev.phase] || ev.phase });
      rt.setStatus(job.agentId, { status: 'working', bubble: job.phaseText });
    } else if (ev.type === 'plan') {
      job.plan = (ev.todos || []).slice(0, 30).map((t) => ({ text: short(t.text, 200), status: t.status }));
      const cur = job.plan.find((t) => t.status === 'in_progress');
      if (cur) rt.setStatus(job.agentId, { status: 'working', bubble: short(cur.text, 90) });
    } else if (ev.type === 'tool' || ev.type === 'text' || ev.type === 'tests' || ev.type === 'error') {
      job.steps.push({ ts: ev.ts, type: ev.type, name: ev.name || '', text: short(ev.text, 400), ok: ev.ok });
      if (job.steps.length > 80) job.steps.splice(0, job.steps.length - 80);
      if (ev.type === 'tool') rt.setStatus(job.agentId, { status: 'working', bubble: short(`${toolLabel(ev.name)} ${ev.text}`, 90) });
      if (ev.type === 'tests') { job.testsOk = ev.ok; rt.logEvent('task', job.agentId, `${agent?.name}: testes ${ev.ok ? 'passaram' : 'falharam'} (${short(ev.text, 80)})`); }
    } else if (ev.type === 'session') job.sessionId = ev.sessionId;
    else if (ev.type === 'result') {
      job.costUsd = ev.costUsd || 0;
      job.turns = ev.turns || 0;
      // custo exato informado pela oficina (já considera modelo, cache e subagentes)
      rt.trackUsage(ev.usage, { costUsd: ev.costUsd || 0, agentId: job.agentId, kind: 'job' });
      job.ledgered = true;
      if (rt.overBudget() && !rt.s.paused) {
        rt.pauseForBudget(' e a oficina parou');
        // o trabalho que acabou de entregar segue (só não começa mais nada); os outros param
        for (const j of jobsOf(rt.store)) if (j.id !== job.id && ['starting', 'running'].includes(j.status)) cancelJob(rt, j, 'limite de gasto do mês atingido').catch(() => {});
      }
    }
  }
  rt.store.save();
  rt.emit({ type: 'job', job: publicJob(job) });
}
const toolLabel = (n = '') => ({ Bash: 'Terminal:', Read: 'Lendo', Edit: 'Editando', Write: 'Escrevendo', MultiEdit: 'Editando', Grep: 'Buscando', Glob: 'Procurando', WebSearch: 'Pesquisando', WebFetch: 'Lendo página', Task: 'Subagente:' }[n] || (n.startsWith('mcp__iaorg__') ? n.slice(12).replace(/_/g, ' ') : n.startsWith('mcp__playwright__') ? 'Navegador:' : n));
export const publicJob = (j) => ({ ...j, toolNames: undefined, inputs: undefined });

// ---------- fim do job ----------
async function onEnd(rt, job, p) {
  const store = rt.store;
  const agent = store.getAgent(job.agentId);
  const task = store.state.tasks.find((t) => t.id === job.taskId);
  const r = p.result || {};
  Object.assign(job, { endedAt: Date.now(), summary: short(r.summary || '', 4000), costUsd: r.costUsd ?? job.costUsd, turns: r.turns ?? job.turns, sessionId: r.sessionId || job.sessionId, code: r.code || null, errors: [...(r.errors || [])].slice(0, 5) });

  // Entregas em arquivo: grava o que é novo/alterado e reflete o que o agente moveu ou apagou
  // (só quando o arquivo daqui ainda é o mesmo que ele recebeu: nunca apaga trabalho de outra pessoa).
  let saved = 0;
  let removed = 0;
  const out = new Set();
  for (const f of p.files || []) {
    try {
      const full = store.safePath(f.path);
      out.add(f.path);
      const data = Buffer.from(f.b64, 'base64');
      if (fs.existsSync(full) && fs.readFileSync(full).equals(data)) continue;
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, data);
      recordWrite(store, f.path, { by: job.agentId, task: job.taskId });
      saved++;
    } catch { /* caminho inválido */ }
  }
  if (p.result && !p.filesTruncated && !p.cancelled && !p.timedOut) {
    for (const [rel, sha] of Object.entries(job.inputs || {})) {
      if (out.has(rel)) continue;
      try {
        const full = store.safePath(rel);
        if (!fs.existsSync(full) || sha1(fs.readFileSync(full)) !== sha) continue;
        const trash = store.safePath(`.lixeira/${new Date().toISOString().replace(/[:.]/g, '-')}/${rel}`);
        fs.mkdirSync(path.dirname(trash), { recursive: true });
        fs.renameSync(full, trash);
        removed++;
        // remove pastas que ficaram vazias
        let dir = path.dirname(full);
        while (dir.startsWith(store.workspace + path.sep) && fs.readdirSync(dir).length === 0) { fs.rmdirSync(dir); dir = path.dirname(dir); }
      } catch { /* ignora */ }
    }
  }
  if (saved || removed) {
    rt.logEvent('file', job.agentId, `${agent?.name} ${saved ? `entregou ${saved} arquivo(s)` : ''}${saved && removed ? ' e ' : ''}${removed ? `reorganizou/removeu ${removed}` : ''} em Arquivos`);
    rt.emit({ type: 'files' });
    drive.schedule(store, rt);
  }
  job.filesSaved = saved;
  job.filesRemoved = removed;
  delete job.inputs;

  // Memória
  if (agent && typeof p.memory === 'string' && writeMemory(store, agent.id, p.memory, `${agent.name} (${job.taskId})`)) {
    rt.logEvent('system', agent.id, `${agent.name} atualizou a própria memória`);
  }
  // Sessão (para "pedir ajuste")
  if (p.session) { fs.mkdirSync(path.dirname(sessionFile(store, job.taskId)), { recursive: true }); fs.writeFileSync(sessionFile(store, job.taskId), Buffer.from(p.session, 'base64')); }

  const why = p.cancelled ? (job.cancelReason || 'cancelada por uma pessoa') : p.timedOut ? 'tempo máximo esgotado' : r.subtype === 'error_max_budget_usd' ? 'limite de custo da tarefa atingido' : r.subtype === 'error_max_turns' ? 'limite de passos atingido' : !p.result ? `o ambiente falhou${p.logTail ? `: ${short(p.logTail.split('\n').filter(Boolean).slice(-3).join(' | '), 300)}` : ''}` : '';
  rt.setStatus(job.agentId, { status: 'idle', bubble: '' });

  if (job.code?.pushed && task) {
    job.status = 'finishing';
    store.save(); rt.pushSnapshot();
    finishCode(rt, job, task, agent).catch((e) => { job.status = 'done'; job.error = e.message; rt.updateTask(task, { status: 'review', result: `${job.summary}\n\nNão consegui fechar o PR automaticamente: ${e.message}` }, job.agentId); });
    return;
  }
  if (why) {
    job.status = p.cancelled ? 'cancelled' : 'failed';
    job.error = why;
    if (task && task.status !== 'done') rt.updateTask(task, { status: 'blocked', result: `Parou: ${why}.${job.summary ? `\n\n${job.summary}` : ''}` }, job.agentId);
  } else {
    job.status = 'done';
    if (task && task.status !== 'done') {
      // Sem código: a entrega já está em Arquivos/mensagens → concluída. Com kit Código e nada commitado → você decide.
      const noCode = job.kits.code && !job.code?.commits;
      rt.updateTask(task, { status: noCode ? 'review' : 'done', result: job.summary || 'Concluída na oficina.' }, job.agentId);
    }
  }
  store.save();
  rt.emit({ type: 'job', job: publicJob(job) });
  rt.pushSnapshot();
}

// Kit Código: PR, espera do CI e merge automático (só com testes/CI verdes e sem conflito).
async function finishCode(rt, job, task, agent) {
  const store = rt.store;
  const token = githubSecret(store);
  const c = job.code;
  const w = profileOf(agent).workshop.code;
  const testsLine = c.testCmd ? `Testes (\`${c.testCmd}\`): ${c.testsOk ? '✅ passaram' : '❌ falharam'}` : 'Testes: nenhum comando configurado na ficha';
  const body = `${job.summary || ''}\n\n---\n${testsLine}${c.lintOk === false ? '\nLint: ❌ falhou' : ''}\nArquivos alterados: ${c.changed.length}\n\nFeito por **${agent.name}** (${agent.role}) na oficina do IAORG · tarefa ${task.id}.`;
  const pr = await github.openOrFindPull(token, c.repo, { head: c.branch, base: c.base, title: `${task.id}: ${task.title}`.slice(0, 120), body });
  job.pr = { url: pr.url, number: pr.number, state: 'open' };
  rt.logEvent('task', agent.id, `${agent.name} ${pr.existed ? 'atualizou' : 'abriu'} o PR #${pr.number} em ${c.repo}`, { link: pr.url });
  rt.emit({ type: 'job', job: publicJob(job) }); store.save();

  const review = (why) => {
    job.status = 'done'; job.pr.state = 'review'; job.mergeNote = why;
    rt.updateTask(task, { status: 'review', result: `PR: ${pr.url}\n${why}\n\n${job.summary}` }, agent.id);
    // Aparece em "Aguardando sua revisão" (Minha mesa) para quem pediu; avisa também por notificação.
    const reviewer = rt.isHuman(task.creatorId) ? task.creatorId : store.owner()?.id;
    if (reviewer) rt.emit({ type: 'notify', to: reviewer, text: `${agent.name} abriu o PR #${pr.number} (${task.id}) para sua revisão` });
    store.save(); rt.emit({ type: 'job', job: publicJob(job) }); rt.pushSnapshot();
  };

  if (job.test) return review('Tarefa de teste: o merge automático não é feito.');
  if (!w.autoMerge) return review('Merge automático desligado na ficha: aguardando sua revisão.');
  if (c.testsOk === false) return review('Os testes falharam na oficina: não fiz o merge.');
  if (c.lintOk === false) return review('O lint falhou: não fiz o merge.');

  const deadline = Date.now() + (w.ciWaitMin || 0) * 60_000;
  job.phaseText = 'Aguardando o CI';
  rt.setStatus(agent.id, { status: 'working', bubble: `Aguardando CI do PR #${pr.number}` });
  for (;;) {
    const st = await github.pullState(token, c.repo, pr.number);
    if (st.merged) { job.pr.state = 'merged'; break; }
    if (st.mergeableState === 'dirty') return review('O PR tem conflito com a branch base.');
    const ci = await github.ciState(token, c.repo, st.headSha);
    job.ci = ci.state;
    if (ci.state === 'failure') return review(`O CI falhou (${ci.items.filter((i) => i.state === 'failure').map((i) => i.name).join(', ')}).`);
    const ready = ci.state === 'success' || (ci.state === 'none' && c.testsOk === true);
    if (ready && st.mergeable !== false) {
      const m = await github.mergePull(token, c.repo, pr.number, { title: `${task.id}: ${task.title} (#${pr.number})`.slice(0, 120), sha: st.headSha });
      if (!m.merged) return review(`Não consegui fazer o merge (${m.error || 'recusado'}). Provavelmente a branch exige revisão.`);
      job.pr.state = 'merged';
      break;
    }
    if (ci.state === 'none' && c.testsOk !== true) return review('Sem CI e sem testes configurados: o merge automático exige ao menos um dos dois.');
    if (Date.now() > deadline) return review('O CI não terminou no tempo de espera configurado.');
    await new Promise((r) => setTimeout(r, 20_000));
  }
  job.status = 'done';
  rt.logEvent('task', agent.id, `${agent.name} fez o merge do PR #${pr.number} (testes e CI verdes)`, { link: pr.url });
  rt.updateTask(task, { status: 'done', result: `Mergeado: ${pr.url}\n\n${job.summary}` }, agent.id);
  rt.setStatus(agent.id, { status: 'idle', bubble: '' });
  store.save(); rt.emit({ type: 'job', job: publicJob(job) }); rt.pushSnapshot();
}

export async function cancelJob(rt, job, reason = 'cancelada por uma pessoa') {
  if (!['starting', 'running'].includes(job.status)) return { error: 'Este trabalho já terminou.' };
  job.cancelReason = reason;
  const r = await runner('POST', `/jobs/${job.id}/cancel`).catch((e) => ({ status: 0, data: { error: e.message } }));
  if (r.status !== 200) return { error: r.data?.error || 'Não foi possível cancelar' };
  job.cancelRequested = true;
  return { ok: true };
}

// Trabalhos "órfãos": o app acha que estão rodando, mas o runner não os conhece mais (reiniciou, ou o
// Docker travou e voltou). Sem isso a tarefa fica "Preparando o ambiente" até estourar o tempo.
// A tarefa volta sozinha para a fila (até 2 vezes); depois disso fica bloqueada com o motivo.
export async function reconcileJobs(rt) {
  const store = rt.store;
  const live = jobsOf(store).filter((j) => ['starting', 'running'].includes(j.status) && Date.now() - (j.startedAt || 0) > 90_000);
  if (!live.length || !enabled()) return;
  const r = await runner('GET', '/jobs').catch(() => null);
  if (!r || r.status !== 200 || !Array.isArray(r.data)) return; // runner fora do ar: tenta na próxima
  const known = new Set(r.data.map((j) => j.id));
  for (const job of live) {
    if (known.has(job.id)) continue;
    job.status = 'failed';
    job.endedAt = Date.now();
    job.error = 'a oficina reiniciou no meio do trabalho';
    const task = store.state.tasks.find((t) => t.id === job.taskId);
    if (task && !['done', 'review'].includes(task.status)) {
      task.autoRetries = (task.autoRetries || 0) + 1;
      if (task.autoRetries <= 2) {
        task.presented = false; task.retryAt = Date.now() + 10_000;
        rt.updateTask(task, { status: 'todo' }, job.agentId);
        rt.logEvent('system', job.agentId, `${task.id}: a oficina reiniciou no meio do trabalho; a tarefa voltou para a fila e recomeça sozinha.`);
      } else {
        rt.updateTask(task, { status: 'blocked', result: 'Parou: a oficina reiniciou no meio do trabalho várias vezes. Use "Tentar de novo".' }, job.agentId);
      }
    }
    rt.setStatus(job.agentId, { status: 'idle', bubble: '' });
    rt.emit({ type: 'job', job: publicJob(job) });
  }
  store.save();
  rt.pushSnapshot();
}

// Acompanha os PRs abertos pela oficina: merge feito por uma pessoa no GitHub conclui a tarefa;
// PR fechado sem merge bloqueia a tarefa com o motivo.
export async function watchPullRequests(rt) {
  const store = rt.store;
  const token = githubSecret(store);
  if (!token) return;
  const open = jobsOf(store).filter((j) => j.pr && j.code?.repo && ['open', 'review'].includes(j.pr.state) && j.status !== 'finishing').slice(-15);
  const seen = new Set();
  for (const j of open) {
    const key = `${j.code.repo}#${j.pr.number}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const st = await github.pullState(token, j.code.repo, j.pr.number).catch(() => null);
    if (!st || (!st.merged && st.state === 'open')) continue;
    for (const x of open.filter((y) => `${y.code.repo}#${y.pr.number}` === key)) x.pr.state = st.merged ? 'merged' : 'closed';
    const task = store.state.tasks.find((t) => t.id === j.taskId);
    const agent = store.getAgent(j.agentId);
    if (st.merged) {
      rt.logEvent('task', null, `PR #${j.pr.number} de ${agent?.name || 'agente'} foi mergeado no GitHub`, { link: j.pr.url });
      if (task && task.status !== 'done') rt.updateTask(task, { status: 'done', result: `Mergeado no GitHub: ${j.pr.url}\n\n${j.summary || ''}`.trim() }, rt.ownerId());
    } else {
      rt.logEvent('task', null, `PR #${j.pr.number} de ${agent?.name || 'agente'} foi fechado sem merge`, { link: j.pr.url });
      if (task && task.status === 'review') rt.updateTask(task, { status: 'blocked', result: `O PR ${j.pr.url} foi fechado sem merge. Use "Pedir ajuste" se quiser outra versão.` }, rt.ownerId());
    }
    store.save();
    rt.pushSnapshot();
  }
}

// Jobs que ficaram sem notícia (runner reiniciado, por exemplo) viram falha.
export function sweepStale(rt) {
  const now = Date.now();
  for (const j of jobsOf(rt.store)) {
    if (['starting', 'running'].includes(j.status) && now - j.startedAt > 4 * 3600_000) {
      Object.assign(j, { status: 'failed', error: 'sem notícias do ambiente', endedAt: now });
      const t = rt.s.tasks.find((x) => x.id === j.taskId);
      if (t && t.status === 'doing') rt.updateTask(t, { status: 'blocked', result: 'A oficina parou de responder.' }, j.agentId);
    }
  }
}

// ---------- rotas ----------
export function mountWorkbench(app, { requireCompany, need, wrap, runtimeFor }) {
  const big = express.json({ limit: '80mb' });
  const fromRunner = (req, res, next) => {
    const a = Buffer.from(String(req.headers.authorization || '')); const b = Buffer.from(`Bearer ${RUNNER_TOKEN}`);
    if (!RUNNER_TOKEN || a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.status(401).json({ error: 'não autorizado' });
    const hit = locate(req.params.jobId);
    if (!hit) return res.status(404).json({ error: 'job desconhecido' });
    req.hit = { ...hit, rt: runtimeFor(hit.store) };
    next();
  };

  app.post('/api/workbench/event/:jobId', big, fromRunner, (req, res) => { onEvents(req.hit.rt, req.hit.job, req.body?.events || []); res.json({ ok: true }); });
  app.post('/api/workbench/end/:jobId', big, fromRunner, wrap(async (req, res) => { await onEnd(req.hit.rt, req.hit.job, req.body || {}); res.json({ ok: true }); }));
  app.post('/api/workbench/tool/:jobId', big, fromRunner, wrap(async (req, res) => {
    const { rt, job } = req.hit;
    const { name, input } = req.body || {};
    if (!['starting', 'running'].includes(job.status)) return res.json({ error: 'Este trabalho já terminou.' });
    if (!job.toolNames?.includes(name)) return res.json({ error: `Ferramenta não disponível para este agente: ${name}` });
    if (job.test && BLOCKED_IN_TEST.has(name)) return res.json({ ok: true, simulado: true, aviso: 'Tarefa de teste: esta ação não foi executada.' });
    const agent = rt.store.getAgent(job.agentId);
    if (!agent) return res.json({ error: 'Agente não existe mais' });
    let out;
    try { out = await rt.executeTool(agent, name, input || {}, job.taskId, { forceApproval: job.test }); } catch (e) { out = { error: e.message }; }
    job.steps.push({ ts: Date.now(), type: 'tool', name, text: short(JSON.stringify(input || {}), 200) });
    res.json(out ?? { ok: true });
  }));

  // Pessoas: cancelar, pedir ajuste e rodar tarefa de teste
  app.post('/api/jobs/:id/cancel', requireCompany, need('admin'), wrap(async (req, res) => {
    const job = findJob(req.company, req.params.id);
    if (!job) return res.status(404).json({ error: 'Trabalho não encontrado' });
    const out = await cancelJob(runtimeFor(req.company), job);
    if (out.error) return res.status(400).json(out);
    runtimeFor(req.company).logEvent('task', req.member.id, `${req.member.name} cancelou o trabalho de ${req.company.getAgent(job.agentId)?.name} em ${job.taskId}`);
    res.json(out);
  }));

  app.post('/api/tasks/:id/adjust', requireCompany, (req, res) => {
    const store = req.company;
    const rt = runtimeFor(store);
    const task = store.state.tasks.find((t) => t.id === req.params.id);
    if (!task) return res.status(404).json({ error: 'Tarefa não encontrada' });
    const agent = store.getAgent(task.assigneeId);
    if (!agent || agent.kind === 'human') return res.status(400).json({ error: 'Só tarefas de agentes de IA voltam para a oficina.' });
    if (!['owner', 'admin'].includes(req.member.appRole) && task.creatorId !== req.member.id) return res.status(403).json({ error: 'Sem permissão' });
    if (jobsOf(store).some((j) => j.taskId === task.id && ['starting', 'running', 'finishing'].includes(j.status))) return res.status(400).json({ error: 'A tarefa ainda está em andamento.' });
    const text = String(req.body?.text || '').trim().slice(0, 4000);
    if (!text) return res.status(400).json({ error: 'Descreva o ajuste' });
    Object.assign(task, { adjust: text, status: 'todo', presented: false, updatedAt: Date.now() });
    store.save();
    rt.logEvent('task', req.member.id, `${req.member.name} pediu ajuste em ${task.id} para ${agent.name}: ${short(text, 120)}`);
    rt.pushSnapshot();
    res.json({ ok: true });
  });

  app.post('/api/agents/:id/workshop-test', requireCompany, need('admin'), wrap(async (req, res) => {
    const store = req.company;
    const rt = runtimeFor(store);
    const agent = store.getAgent(req.params.id);
    if (!agent || agent.kind === 'human') return res.status(404).json({ error: 'Agente de IA não encontrado' });
    if (!enabled()) return res.status(400).json({ error: 'A oficina não está configurada (RUNNER_URL / RUNNER_TOKEN).' });
    if (!store.getSecret('claudeKey')) return res.status(400).json({ error: 'Cadastre a chave do Claude primeiro.' });
    const title = String(req.body?.title || '').trim().slice(0, 140);
    if (!title) return res.status(400).json({ error: 'Escreva a tarefa' });
    const task = rt.createTask({ title: `[Teste] ${title}`, description: String(req.body?.description || '').slice(0, 4000), assigneeId: agent.id, creatorId: req.member.id });
    task.presented = true; // a oficina pega agora, não o agendador
    const job = await startJob(rt, agent, task, { test: true });
    if (!job) return res.status(503).json({ error: 'Oficina ocupada ou indisponível. Tente de novo em instantes.' });
    res.json({ ok: true, taskId: task.id, jobId: job.id });
  }));
}
