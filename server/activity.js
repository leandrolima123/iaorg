// Log completo do que cada agente fez: mensagens enviadas e recebidas, tarefas, ferramentas usadas,
// passos na oficina, arquivos, erros. Um arquivo JSONL por agente (gira em 5 MB, guarda o anterior).
import fs from 'node:fs';
import path from 'node:path';

const MAX = 5 * 1024 * 1024;
const dirOf = (store) => path.join(store.dir, 'activity');
const fileOf = (store, id) => path.join(dirOf(store), `${String(id).replace(/[^\w-]/g, '')}.jsonl`);
const short = (s, n) => { const t = String(s ?? ''); return t.length > n ? `${t.slice(0, n)}…` : t; };

/** Acrescenta uma entrada ao log do agente. type: message|task|tool|job|file|text|error|system */
export function logActivity(store, agentId, entry) {
  if (!agentId || !store.getAgent?.(agentId)) return;
  try {
    fs.mkdirSync(dirOf(store), { recursive: true });
    const f = fileOf(store, agentId);
    if (fs.existsSync(f) && fs.statSync(f).size > MAX) fs.renameSync(f, `${f}.1`);
    const e = { ts: Date.now(), ...entry, text: short(entry.text, 4000) };
    if (e.detail) e.detail = short(typeof e.detail === 'string' ? e.detail : JSON.stringify(e.detail), 2000);
    fs.appendFileSync(f, `${JSON.stringify(e)}\n`);
  } catch { /* log nunca derruba o trabalho */ }
}

// Primeira vez: monta o log a partir do que já existe (diário de obra e mensagens guardadas).
function backfill(store, agentId) {
  const f = fileOf(store, agentId);
  if (fs.existsSync(f) || fs.existsSync(`${f}.1`)) return;
  const name = (id) => store.getAgent(id)?.name || (id === 'board' ? 'Dono' : id);
  const items = [];
  for (const e of store.state.events || []) {
    if (e.agentId === agentId && e.type !== 'message') items.push({ ts: e.ts, type: e.type, text: e.text, ...(e.link ? { link: e.link } : {}) });
  }
  for (const m of store.state.messages || []) {
    if (m.from === agentId) items.push({ ts: m.ts, type: 'message', dir: 'out', peer: m.to, text: `Para ${name(m.to)}: ${m.content}` });
    if (m.to === agentId) items.push({ ts: m.ts, type: 'message', dir: 'in', peer: m.from, text: `De ${name(m.from)}: ${m.content}` });
  }
  if (!items.length) return;
  items.sort((a, b) => a.ts - b.ts);
  fs.mkdirSync(dirOf(store), { recursive: true });
  fs.writeFileSync(f, `${items.map((e) => JSON.stringify(e)).join('\n')}\n`);
}

/** Lê o log (mais recente primeiro), com filtros. */
export function readActivity(store, agentId, { before, limit = 150, types, q } = {}) {
  backfill(store, agentId);
  const lines = [];
  for (const f of [`${fileOf(store, agentId)}`, `${fileOf(store, agentId)}.1`]) {
    try { lines.push(...fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).reverse()); } catch { /* sem arquivo */ }
  }
  const out = [];
  const query = String(q || '').trim().toLowerCase();
  const typeSet = types?.length ? new Set(types) : null;
  for (const l of lines) {
    let e;
    try { e = JSON.parse(l); } catch { continue; }
    if (before && e.ts >= before) continue;
    if (typeSet && !typeSet.has(e.type)) continue;
    if (query && !`${e.text} ${e.name || ''} ${e.detail || ''}`.toLowerCase().includes(query)) continue;
    out.push(e);
    if (out.length >= limit) break;
  }
  return out;
}

/** Contagem por tipo nas últimas 24 h (para os chips de filtro). */
export function activityStats(store, agentId) {
  const since = Date.now() - 24 * 3600_000;
  const stats = { total: 0 };
  for (const e of readActivity(store, agentId, { limit: 5000 })) {
    if (e.ts < since) break;
    stats.total++;
    stats[e.type] = (stats[e.type] || 0) + 1;
  }
  return stats;
}
