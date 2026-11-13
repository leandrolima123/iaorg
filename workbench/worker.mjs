// Worker de uma tarefa: o mesmo motor do Claude Code (Agent SDK), com o kit da designação do agente.
// Fala com o runner por linhas "@@IAORG {json}" no stdout. Ao fim grava /work/out (resultado,
// memória e sessão) e o runner recolhe /work/out e /work/entregas.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { query } from '@anthropic-ai/claude-agent-sdk';

// A tarefa chega como arquivo (/work/in/job.json, lido e apagado); IAORG_JOB (base64) fica como alternativa.
function readJob() {
  const f = process.env.IAORG_JOB_FILE;
  if (f && fs.existsSync(f)) { const raw = fs.readFileSync(f, 'utf8'); try { fs.rmSync(f); } catch { /* ok */ } return JSON.parse(raw); }
  return JSON.parse(Buffer.from(process.env.IAORG_JOB || '', 'base64').toString('utf8') || '{}');
}
const job = readJob();
const W = '/work';
const OUT = `${W}/out`;
const HOME = `${W}/home`;
for (const d of [`${W}/entregas`, OUT, HOME]) fs.mkdirSync(d, { recursive: true });

const emit = (o) => process.stdout.write(`@@IAORG ${JSON.stringify({ ts: Date.now(), ...o })}\n`);
const short = (s, n = 300) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };
const tail = (s, n = 3000) => { const t = String(s ?? ''); return t.length > n ? `…${t.slice(-n)}` : t; };

// Comando de shell com tempo limite; nunca recebe o token do GitHub.
const SAFE_ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(GITHUB_TOKEN|IAORG_JOB|IAORG_JOB_FILE|IAORG_JOB_TOKEN)$/.test(k)));
function sh(cmd, { cwd = W, timeoutMs = 15 * 60_000, env = {} } = {}) {
  const r = spawnSync('/bin/bash', ['-lc', cmd], { cwd, env: { ...SAFE_ENV, ...serviceEnv(), ...env }, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, code: r.status, out: `${r.stdout || ''}${r.stderr || ''}`, timedOut: r.error?.code === 'ETIMEDOUT' };
}
// git com o token só no cabeçalho desta chamada (nunca gravado em .git/config).
function git(args, { cwd = `${W}/repo`, auth = false } = {}) {
  const pre = auth && process.env.GITHUB_TOKEN
    ? ['-c', `http.extraHeader=Authorization: Basic ${Buffer.from(`x-access-token:${process.env.GITHUB_TOKEN}`).toString('base64')}`]
    : [];
  const r = spawnSync('git', [...pre, ...args], { cwd, encoding: 'utf8', env: { ...SAFE_ENV, GIT_TERMINAL_PROMPT: '0' }, timeout: 10 * 60_000, maxBuffer: 64 * 1024 * 1024 });
  const out = `${r.stdout || ''}${r.stderr || ''}`.replaceAll(process.env.GITHUB_TOKEN || '\u0000', '***');
  return { ok: r.status === 0, out };
}
function serviceEnv() {
  const s = job.services || {};
  return {
    ...(s.postgres ? { DATABASE_URL: 'postgresql://iaorg:iaorg@postgres:5432/app', PGHOST: 'postgres', PGUSER: 'iaorg', PGPASSWORD: 'iaorg', PGDATABASE: 'app' } : {}),
    ...(s.redis ? { REDIS_URL: 'redis://redis:6379/0' } : {}),
  };
}

const result = { ok: false, summary: '', sessionId: null, costUsd: 0, usage: null, turns: 0, subtype: '', code: null, errors: [] };
const finish = (code) => {
  fs.writeFileSync(`${OUT}/result.json`, JSON.stringify(result, null, 2));
  try { fs.copyFileSync(`${W}/MEMORY.md`, `${OUT}/MEMORY.md`); } catch { /* sem memória */ }
  // Sessão do SDK (para "pedir ajuste" retomar de onde parou).
  if (fs.existsSync(`${HOME}/.claude`)) sh(`tar czf ${OUT}/session.tgz -C ${HOME} .claude 2>/dev/null || true`, { timeoutMs: 120_000 });
  emit({ type: 'phase', phase: 'fim', text: result.ok ? 'Concluído' : 'Terminou com problemas' });
  process.exit(code);
};

async function main() {
  emit({ type: 'phase', phase: 'preparando', text: 'Preparando o ambiente' });

  // Memória do agente: o agente lê e atualiza /work/MEMORY.md.
  fs.writeFileSync(`${W}/MEMORY.md`, job.memory?.trim() ? job.memory : '# Memória\n\n(ainda vazia)\n');

  // Base de conhecimento sob demanda: arquivos que o agente busca e lê quando precisa (fora do prompt).
  for (const k of job.knowledge || []) {
    const p = path.join(`${W}/conhecimento`, String(k.path).replace(/\.\.+/g, '.'));
    if (!p.startsWith(`${W}/conhecimento/`)) continue;
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, k.text || '');
  }

  // Sessão anterior (pedir ajuste)
  if (job.resumeSessionId && fs.existsSync(`${W}/in/session.tgz`)) sh(`tar xzf ${W}/in/session.tgz -C ${HOME}`, { timeoutMs: 120_000 });

  // ---------- kit Código ----------
  let cwd = `${W}/entregas`;
  let repoNotes = '';
  const code = job.kits?.code;
  if (code) {
    emit({ type: 'phase', phase: 'clonando', text: `Clonando ${code.repo}` });
    const urlRepo = `https://github.com/${code.repo}.git`;
    const branchExists = git(['ls-remote', '--exit-code', '--heads', urlRepo, code.branch], { cwd: W, auth: true }).ok;
    const c = git(['clone', '--depth', '200', '--branch', branchExists ? code.branch : code.base, urlRepo, `${W}/repo`], { cwd: W, auth: true });
    if (!c.ok) { result.errors.push(`Falha ao clonar: ${tail(c.out, 800)}`); emit({ type: 'error', text: result.errors[0] }); return finish(1); }
    if (!branchExists) git(['checkout', '-b', code.branch]);
    if (branchExists) git(['fetch', '--depth', '200', 'origin', `${code.base}:refs/remotes/origin/${code.base}`], { auth: true });
    git(['config', 'user.name', code.gitName || 'Agente IAORG']);
    git(['config', 'user.email', code.gitEmail || 'agente@iaorg.local']);
    fs.copyFileSync('/opt/iaorg/git-hooks/pre-push', `${W}/repo/.git/hooks/pre-push`);
    fs.chmodSync(`${W}/repo/.git/hooks/pre-push`, 0o755);
    cwd = `${W}/repo`;
    for (const f of ['CLAUDE.md', 'AGENTS.md', '.github/copilot-instructions.md']) {
      const p = `${W}/repo/${f}`;
      if (fs.existsSync(p)) repoNotes += `\n\n### ${f} do repositório\n${fs.readFileSync(p, 'utf8').slice(0, 20000)}`;
    }
    const setup = code.setup || (fs.existsSync(`${W}/repo/.iaorg/setup.sh`) ? 'bash .iaorg/setup.sh' : '');
    if (setup) {
      emit({ type: 'phase', phase: 'instalando', text: 'Instalando dependências' });
      const s = sh(setup, { cwd });
      emit({ type: 'tool', name: 'setup', text: `${setup} → ${s.ok ? 'ok' : `falhou (${s.code})`}` });
      if (!s.ok) repoNotes += `\n\nATENÇÃO: o setup "${setup}" falhou. Saída final:\n${tail(s.out, 2500)}`;
    }
  }

  // ---------- ferramentas do kit ----------
  const allowed = ['Read', 'Write', 'Edit', 'MultiEdit', 'Glob', 'Grep', 'TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'ToolSearch', 'LS', 'NotebookEdit', 'mcp__iaorg'];
  const disallowed = ['Bash(git push*)', 'Bash(*git push*)', 'Bash(rm -rf /*)', 'Bash(* | sh*)', 'Bash(* | bash*)', 'Bash(sudo *)', 'Bash(*docker *)'];
  if (code || job.kits?.shell) allowed.push('Bash', 'BashOutput', 'KillShell', 'Task', 'Agent');
  if (job.kits?.research) allowed.push('WebSearch', 'WebFetch');
  else disallowed.push('WebSearch', 'WebFetch');
  if (!code && !job.kits?.shell) disallowed.push('Bash');

  const mcpServers = {
    iaorg: {
      type: 'stdio', command: 'node', args: ['/opt/iaorg/mcp-iaorg.mjs'],
      env: { IAORG_CB_URL: process.env.IAORG_CB_URL || '', IAORG_JOB_TOKEN: process.env.IAORG_JOB_TOKEN || '', IAORG_TOOLS_B64: Buffer.from(JSON.stringify(job.mcpTools || [])).toString('base64'), PATH: process.env.PATH },
    },
  };
  if (job.kits?.browser) {
    mcpServers.playwright = { type: 'stdio', command: 'node', args: ['/opt/iaorg/node_modules/@playwright/mcp/cli.js', '--headless', '--isolated', '--browser', 'chromium', '--no-sandbox', '--output-dir', `${W}/tmp/navegador`], env: { PATH: process.env.PATH, PLAYWRIGHT_BROWSERS_PATH: '/opt/ms-playwright', HOME } };
    allowed.push('mcp__playwright');
  }

  // Bloqueios além das regras: escrita fora de /work, push e acesso a segredos.
  const guard = async (input) => {
    const name = input.tool_name;
    const ti = input.tool_input || {};
    const deny = (why) => ({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: why } });
    if (['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(name)) {
      const p = path.resolve(cwd, String(ti.file_path || ti.notebook_path || ''));
      if (!p.startsWith(`${W}/`)) return deny('Só é permitido escrever dentro de /work.');
      if (p.includes('/.git/')) return deny('Não altere a pasta .git diretamente; use comandos git.');
    }
    if (name === 'Bash') {
      const cmd = String(ti.command || '');
      if (/\bgit\s+push\b/.test(cmd)) return deny('O push é feito pelo IAORG ao fim da tarefa. Apenas faça commits.');
      if (/(^|\s)(env|printenv)(\s|$)|\/proc\/\d+\/environ|ANTHROPIC_API_KEY/.test(cmd)) return deny('Leitura de variáveis de ambiente sensíveis não é permitida.');
    }
    return {};
  };

  const append = `${job.append || ''}${repoNotes ? `\n\n## Notas do próprio repositório\n${repoNotes}` : ''}`;
  emit({ type: 'phase', phase: 'trabalhando', text: 'Trabalhando' });

  const q = query({
    prompt: job.prompt,
    options: {
      cwd,
      additionalDirectories: [W],
      model: job.model || undefined,
      maxTurns: job.maxTurns || 60,
      maxBudgetUsd: job.maxBudgetUsd || 3,
      permissionMode: 'dontAsk',
      allowedTools: allowed,
      disallowedTools: disallowed,
      settingSources: [],
      systemPrompt: { type: 'preset', preset: 'claude_code', append },
      mcpServers,
      hooks: { PreToolUse: [{ hooks: [guard] }] },
      ...(job.resumeSessionId ? { resume: job.resumeSessionId } : {}),
      env: {
        PATH: process.env.PATH, HOME, LANG: 'C.UTF-8',
        ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
        CLAUDE_CONFIG_DIR: `${HOME}/.claude`,
        CLAUDE_CODE_DISABLE_AUTO_MEMORY: '1',
        DISABLE_TELEMETRY: '1', DISABLE_ERROR_REPORTING: '1', DISABLE_AUTOUPDATER: '1',
        PLAYWRIGHT_BROWSERS_PATH: '/opt/ms-playwright',
        ...serviceEnv(),
      },
    },
  });

  const plan = [];
  const emitPlan = () => emit({ type: 'plan', todos: plan.map((p) => ({ text: p.text, status: p.status })) });
  try {
    for await (const m of q) {
      if (m.type === 'system' && m.subtype === 'init') { result.sessionId = m.session_id; emit({ type: 'session', sessionId: m.session_id, model: m.model }); continue; }
      if (m.type === 'assistant') {
        for (const b of m.message?.content || []) {
          if (b.type === 'text' && b.text?.trim()) emit({ type: 'text', text: short(b.text, 600) });
          if (b.type === 'tool_use') {
            // Plano: TodoWrite (versões antigas) ou TaskCreate/TaskUpdate (atuais).
            if (b.name === 'TodoWrite') { plan.splice(0, plan.length, ...(b.input?.todos || []).map((t, i) => ({ id: String(i + 1), text: t.content, status: t.status }))); emitPlan(); }
            else if (b.name === 'TaskCreate') { plan.push({ id: String(plan.length + 1), text: b.input?.subject || b.input?.description || 'Passo', status: 'pending' }); emitPlan(); }
            else if (b.name === 'TaskUpdate') {
              const it = plan.find((p) => p.id === String(b.input?.taskId));
              if (it) { if (b.input?.status) it.status = b.input.status; if (b.input?.subject) it.text = b.input.subject; if (b.input?.status === 'deleted') plan.splice(plan.indexOf(it), 1); emitPlan(); }
            } else if (!['TaskList', 'TaskGet', 'ToolSearch'].includes(b.name)) emit({ type: 'tool', name: b.name, text: describe(b.name, b.input) });
          }
        }
        continue;
      }
      if (m.type === 'result') {
        Object.assign(result, {
          ok: m.subtype === 'success' && !m.is_error, summary: m.result || (m.errors || []).join('\n'), subtype: m.subtype,
          costUsd: m.total_cost_usd || 0, usage: m.usage || null, turns: m.num_turns || 0, sessionId: m.session_id || result.sessionId,
        });
        if (m.errors?.length) result.errors.push(...m.errors);
        emit({ type: 'result', subtype: m.subtype, costUsd: result.costUsd, usage: result.usage, turns: result.turns, text: short(result.summary, 2000) });
      }
    }
  } catch (e) {
    result.errors.push(String(e?.message || e));
    emit({ type: 'error', text: short(e?.message || e, 800) });
  }

  // ---------- entrega do kit Código (determinística) ----------
  if (code) {
    const info = { repo: code.repo, base: code.base, branch: code.branch, testsOk: null, testCmd: code.test || '', testOut: '', lintOk: null, commits: 0, pushed: false, changed: [] };
    if (code.lint) {
      emit({ type: 'phase', phase: 'verificando', text: 'Rodando lint' });
      const l = sh(code.lint, { cwd });
      info.lintOk = l.ok;
      emit({ type: 'tool', name: 'lint', text: `${code.lint} → ${l.ok ? 'ok' : 'falhou'}` });
    }
    if (code.test) {
      emit({ type: 'phase', phase: 'verificando', text: 'Rodando os testes' });
      const t = sh(code.test, { cwd, timeoutMs: 20 * 60_000 });
      info.testsOk = t.ok;
      info.testOut = tail(t.out, 4000);
      emit({ type: 'tests', ok: t.ok, text: `${code.test} → ${t.ok ? 'passou' : t.timedOut ? 'tempo esgotado' : `falhou (${t.code})`}` });
    }
    git(['add', '-A']);
    if (!git(['diff', '--cached', '--quiet']).ok) {
      git(['commit', '-m', `${job.commitTitle || 'Trabalho do agente'}\n\n${job.commitBody || ''}`.trim()]);
    }
    const ahead = git(['rev-list', '--count', `origin/${code.base}..HEAD`]);
    info.commits = +ahead.out.trim() || 0;
    info.changed = git(['diff', '--name-only', `origin/${code.base}...HEAD`]).out.split('\n').filter(Boolean).slice(0, 200);
    if (info.commits > 0) {
      emit({ type: 'phase', phase: 'enviando', text: `Enviando a branch ${code.branch}` });
      const p = git(['push', `https://github.com/${code.repo}.git`, `HEAD:refs/heads/${code.branch}`], { auth: true });
      info.pushed = p.ok;
      if (!p.ok) result.errors.push(`Push falhou: ${tail(p.out, 800)}`);
      emit({ type: 'tool', name: 'git push', text: p.ok ? `${code.branch} (${info.commits} commit(s))` : 'falhou' });
    }
    result.code = info;
  }
  finish(0);
}

function describe(name, i = {}) {
  if (name === 'Bash') return short(i.command, 200);
  if (['Read', 'Write', 'Edit', 'MultiEdit'].includes(name)) return short(String(i.file_path || '').replace(/^\/work\/(repo|entregas)\//, ''), 160);
  if (name === 'Grep' || name === 'Glob') return short(i.pattern, 120);
  if (name === 'WebSearch') return short(i.query, 160);
  if (name === 'WebFetch') return short(i.url, 160);
  if (name === 'Task') return short(i.description || i.prompt, 160);
  if (name.startsWith('mcp__iaorg__')) return short(i.title || i.subject || i.content || i.text || i.consulta || JSON.stringify(i), 160);
  if (name.startsWith('mcp__playwright__')) return short(i.url || i.element || i.text || '', 160);
  return short(JSON.stringify(i), 160);
}

main().catch((e) => { result.errors.push(String(e?.stack || e)); emit({ type: 'error', text: short(e?.message || e, 800) }); finish(1); });
