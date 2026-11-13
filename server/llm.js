// Camada de modelo por empresa: Claude (chave da própria empresa) ou "mock" (simulado, sem custo).
import Anthropic from '@anthropic-ai/sdk';

// cacheRead: multiplicador da leitura de cache sobre o preço de entrada (0,05× no Sonnet/Opus 5.5, 0,1× no Haiku).
// priceLong: preço quando o prompt passa de "over" tokens (Haiku 5.5).
export const MODELS = [
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5', note: 'mais barato e rápido — atendimento, triagem, tarefas simples', price: [0.1, 0.5], cacheRead: 0.1, priceLong: { over: 100_000, price: [0.5, 2.5] } },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', note: 'equilíbrio entre custo e qualidade — código e marketing', price: [2, 10], cacheRead: 0.05 },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', note: 'mais capaz — trabalho longo e complexo', price: [4, 20], cacheRead: 0.05 },
  { id: 'claude-fable-5-2', label: 'Claude Fable 5.2', note: 'o mais capaz da Anthropic — para o que o Opus não resolve (caro)', price: [8, 40], cacheRead: 0.025 },
  { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', note: 'geração anterior do Sonnet', price: [2, 10], cacheRead: 0.1, legacy: true },
  { id: 'claude-opus-5', label: 'Claude Opus 5', note: 'geração anterior do Opus (mais caro que o 5.5)', price: [5, 25], cacheRead: 0.1, legacy: true },
  { id: 'claude-opus-4-8', label: 'Claude Opus 4.8', note: 'linha Opus 4 (mais caro que o 5.5)', price: [5, 25], cacheRead: 0.1, legacy: true },
];
const PRICES = Object.fromEntries(MODELS.map((m) => [m.id, m.price]));
const LONG = Object.fromEntries(MODELS.filter((m) => m.priceLong).map((m) => [m.id, m.priceLong]));
const READ_MULT = Object.fromEntries(MODELS.map((m) => [m.id, m.cacheRead]));

// Tempo de vida do cache do prompt fixo dos agentes (gravação custa 2× em 1 h, 1,25× em 5 min).
export const CACHE_TTL = process.env.IAORG_CACHE_TTL === '5m' ? '5m' : '1h';
export const cacheMark = () => (CACHE_TTL === '1h' ? { type: 'ephemeral', ttl: '1h' } : { type: 'ephemeral' });

// Uso da API -> números usados no custo (gravação de cache separada por TTL).
export function usageOf(u) {
  const cw = u?.cache_creation_input_tokens || 0;
  const cw1h = Math.min(cw, u?.cache_creation?.ephemeral_1h_input_tokens || 0);
  return { input: u?.input_tokens || 0, output: u?.output_tokens || 0, cacheRead: u?.cache_read_input_tokens || 0, cacheWrite: cw, cacheWrite1h: cw1h };
}

export function estimateCost(u, model) {
  const long = LONG[model];
  const [pin, pout] = long && u.input + u.cacheWrite + u.cacheRead > long.over ? long.price : PRICES[model] || [4, 20];
  const read = READ_MULT[model] ?? 0.1;
  const w1h = u.cacheWrite1h || 0;
  return ((u.input + (u.cacheWrite - w1h) * 1.25 + w1h * 2 + u.cacheRead * read) * pin + u.output * pout) / 1e6;
}

// Modelos que aceitam o fallback automático do servidor em caso de recusa.
const FALLBACK_MODELS = new Set(['claude-fable-5-2', 'claude-fable-5-1', 'claude-opus-5-5', 'claude-opus-5', 'claude-sonnet-5-5']);
const fallbackOff = new Set(); // empresas cuja conta recusou o fallback

const clients = new Map(); // companyId -> { key, client }
function clientFor(store) {
  const key = store.getSecret('claudeKey');
  if (!key) return null;
  const c = clients.get(store.id);
  if (c?.key === key) return c.client;
  const client = new Anthropic({ apiKey: key, maxRetries: 4 });
  clients.set(store.id, { key, client });
  return client;
}

export const providerFor = (store) => (store.getSecret('claudeKey') ? 'claude' : 'mock');

// model/effort vêm da ficha do agente quando definidos; senão, da configuração da empresa.
// system pode ser texto ou blocos [{type:'text', text, cache_control}] — os blocos fixos levam o ponto de cache longo
// e o cache automático (topo) cobre a cauda da conversa.
export async function callClaude(store, { system, messages, tools, model: agentModel, effort: agentEffort }) {
  const client = clientFor(store);
  const model = agentModel || store.company.settings.model;
  const effort = agentEffort || store.company.settings.effort;
  const params = {
    model,
    max_tokens: 16000,
    system,
    ...(tools?.length ? { tools } : {}),
    messages,
    output_config: { effort },
    cache_control: { type: 'ephemeral' },
  };
  if (FALLBACK_MODELS.has(model) && !fallbackOff.has(store.id)) {
    try {
      return await client.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
    } catch (err) {
      if (!(err instanceof Anthropic.BadRequestError)) throw err;
      console.warn('[llm] fallback recusado, desativando para', store.id, err.message);
      fallbackOff.add(store.id);
    }
  }
  return client.messages.create(params);
}

// Mantém o cache do prompt fixo quente: lê o prefixo (ferramentas + sistema) sem gerar resposta (max_tokens 0).
// Mesmo modelo, ferramentas, sistema e esforço da conversa real, senão o prefixo não casa.
export async function warmCache(store, { system, tools, model: agentModel, effort: agentEffort }) {
  const client = clientFor(store);
  if (!client) return null;
  return client.messages.create({
    model: agentModel || store.company.settings.model,
    max_tokens: 0,
    system,
    ...(tools?.length ? { tools } : {}),
    messages: [{ role: 'user', content: '.' }],
    output_config: { effort: agentEffort || store.company.settings.effort },
  });
}

// Valida uma chave sem gastar tokens (lista modelos).
export async function testKey(key) {
  const client = new Anthropic({ apiKey: key, maxRetries: 1 });
  try {
    await client.models.list({ limit: 1 });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}

// Erro que costuma passar sozinho: instabilidade da API (5xx, 529 sobrecarga), limite de requisições ou rede.
export function isTransient(err) {
  if (err instanceof Anthropic.RateLimitError || err instanceof Anthropic.APIConnectionError) return true;
  return err instanceof Anthropic.APIError && Number(err.status) >= 500;
}

export function describeError(err) {
  if (err instanceof Anthropic.APIError && Number(err.status) >= 500) return `A API do Claude está instável no momento (${err.status}${err.message ? `: ${String(err.message).replace(/^(\d{3}\s+)+/, '')}` : ''}). Não é problema da sua chave.`;
  if (err instanceof Anthropic.AuthenticationError) return 'Chave da API inválida.';
  if (err instanceof Anthropic.PermissionDeniedError) return 'Sem permissão para usar este modelo.';
  if (err instanceof Anthropic.NotFoundError) return 'Modelo não encontrado.';
  if (err instanceof Anthropic.RateLimitError) return 'Limite de requisições atingido; tentando de novo mais tarde.';
  if (err instanceof Anthropic.BadRequestError) return 'Requisição inválida: ' + err.message;
  if (err instanceof Anthropic.APIError) return `Erro da API (${err.status}): ${err.message}`;
  return err?.message || String(err);
}

// ------------------------------------------------------------------
// MOCK: ações determinísticas a partir do contexto, no formato da API.
// ------------------------------------------------------------------
let mockN = 0;
const tu = (name, input) => ({ type: 'tool_use', id: 'mock_' + ++mockN, name, input });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function callMock({ agent, ctx, iteration }) {
  await sleep(1200 + Math.random() * 1800);
  const usage = { input_tokens: 0, output_tokens: 0 };
  if (iteration > 0) return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Ciclo concluído.' }], usage };

  const calls = [];
  const reports = ctx.agents.filter((a) => a.reportsTo === agent.id && a.active !== false);
  const goal = ctx.newMessages.find((m) => ctx.isHuman(m.from));

  if (goal) {
    if (reports.length) {
      for (const r of reports) {
        calls.push(tu('create_task', {
          title: `${r.role}: ${goal.content.slice(0, 60)}`,
          description: `Cuidar da parte de ${r.role} do objetivo: "${goal.content}".`,
          assignee_id: r.id,
        }));
      }
    } else {
      calls.push(tu('send_message', { to: goal.from, content: `Recebido! Vou trabalhar nisso: "${goal.content.slice(0, 80)}".` }));
    }
  }

  const task = ctx.myTasks.find((t) => t.status === 'todo');
  if (task) {
    calls.push(tu('update_task', { task_id: task.id, status: 'doing' }));
    const aiReports = reports.filter((r) => r.kind !== 'human');
    if (aiReports.length && !task.parentId) {
      for (const r of aiReports) {
        calls.push(tu('create_task', {
          title: `${r.role}: ${task.title.replace(/^[^:]+:\s*/, '')}`.slice(0, 80),
          description: `Subtarefa de ${task.id}: ${task.description}`,
          assignee_id: r.id,
          parent_task_id: task.id,
        }));
      }
    } else {
      const file = `${agent.role.toLowerCase().replace(/\s+/g, '-')}/${task.id}.md`;
      calls.push(tu('write_file', {
        path: file,
        content: `# ${task.title}\n\nResponsável: ${agent.name} (${agent.role})\n\n${task.description}\n\n## Entrega\n- Item 1 (simulado)\n- Item 2 (simulado)\n`,
      }));
      calls.push(tu('update_task', { task_id: task.id, status: 'done', result: `Entregue em ${file}` }));
    }
  }

  for (const t of ctx.myTasks.filter((x) => x.status === 'doing')) {
    const kids = ctx.allTasks.filter((k) => k.parentId === t.id);
    if (kids.length && kids.every((k) => k.status === 'done')) {
      calls.push(tu('update_task', { task_id: t.id, status: 'done', result: `Todas as ${kids.length} subtarefas concluídas.` }));
    }
  }

  if (!agent.reportsTo || ctx.isHuman(agent.reportsTo)) {
    if (!goal && ctx.allTasks.length && ctx.allTasks.every((t) => t.status === 'done') && !ctx.reportedAll) {
      calls.push(tu('send_message', { to: 'board', content: `Objetivo concluído! ${ctx.allTasks.length} tarefas entregues. Arquivos disponíveis na aba Arquivos.` }));
    }
  }

  if (!calls.length) return { stop_reason: 'end_turn', content: [{ type: 'text', text: 'Nada a fazer.' }], usage };
  return { stop_reason: 'tool_use', content: calls, usage };
}
