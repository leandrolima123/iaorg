// Ficha de configuração de cada agente: instruções, procedimentos, exemplos, conhecimento,
// variáveis, escalonamento, modo de envio por canal e modelo. Também guarda o histórico de versões.
import { MODELS } from './llm.js';

// Variáveis preenchidas a cada conversa (vêm no aviso que o agente recebe), não no prompt fixo.
export const DYNAMIC_VARS = ['canal', 'caixa_destino', 'nome_cliente', 'email_cliente', 'telefone_cliente'];
export const CHANNELS = { email: 'E-mail', chat: 'Chat do site', whatsapp: 'WhatsApp' };

export function profileOf(agent) {
  const p = agent.profile || {};
  return {
    instructions: p.instructions ?? agent.prompt ?? '',
    procedures: p.procedures || '',
    examples: p.examples || '',
    knowledge: p.knowledge || [],
    variables: p.variables || {},
    escalation: { to: p.escalation?.to || '', note: p.escalation?.note || '' },
    sendMode: { email: p.sendMode?.email || 'approval', chat: p.sendMode?.chat || 'approval', whatsapp: p.sendMode?.whatsapp || 'approval' },
    model: p.model || '',
    chatModel: p.chatModel || '',
    effort: p.effort || '',
    workshop: workshopOf(p.workshop),
  };
}

// Dois modelos por agente: a CONVERSA (triagem, respostas curtas, reuniões) roda num modelo barato por padrão,
// e a OFICINA (o trabalho de verdade, com plano e verificação) usa o modelo escolhido na ficha ou o padrão da empresa.
export const CHAT_DEFAULT_MODEL = process.env.CHAT_DEFAULT_MODEL || 'claude-haiku-5-5';
export const chatModelOf = (agent, store) => profileOf(agent).chatModel || store.company.settings.chatModel || CHAT_DEFAULT_MODEL;
export const jobModelOf = (agent, store) => profileOf(agent).model || store.company.settings.model;

// Oficina: como o agente trabalha numa tarefa (kits, verificação e limites). Vale para qualquer cargo.
export const WORKSHOP_DEFAULT = {
  research: false, browser: false, verify: '',
  maxTurns: 60, maxBudgetUsd: 3, timeoutMin: 45,
  code: { repo: '', baseBranch: '', setup: '', test: '', lint: '', postgres: false, redis: false, autoMerge: true, ciWaitMin: 20 },
};
export function workshopOf(w = {}) {
  const d = WORKSHOP_DEFAULT;
  return { ...d, ...w, code: { ...d.code, ...(w?.code || {}) } };
}
// Sugestão de verificação por cargo (texto pré-preenchido na tela; o agente segue o que estiver salvo).
export function verifyHint(agent) {
  const r = `${agent.role} ${agent.title}`.toLowerCase();
  if (/back|front|full|dev|desenvolv|engenh|cto|mobile|dados|data/.test(r)) return 'Antes de entregar: rode os testes e o lint do projeto, corrija o que falhar e só então finalize. Explique no resumo o que mudou e como testar.';
  if (/qa|qualidade|teste/.test(r)) return 'Reproduza o problema, registre os passos, evidências (prints) e o resultado esperado versus o obtido.';
  if (/devops|infra|sre/.test(r)) return 'Depois de qualquer mudança em produção, confira deploy, logs e saúde do serviço. Registre o que fez e o motivo.';
  if (/market|conte|social|growth/.test(r)) return 'Cite as fontes usadas, revise ortografia, tom de voz e chamadas para ação antes de entregar.';
  if (/cs|suporte|atend|customer|success/.test(r)) return 'Confira cada afirmação na base de conhecimento antes de responder. Na dúvida, escale.';
  if (/vendas|comercial|sales/.test(r)) return 'Confirme dados de preço e condições na base antes de enviar propostas.';
  return 'Releia o pedido e confira se a entrega cumpre cada ponto antes de finalizar.';
}

// Variáveis usadas nos textos da ficha (para a tela listar o que falta preencher).
export function placeholdersIn(profile) {
  const found = new Set();
  for (const t of [profile.instructions, profile.procedures, profile.examples]) {
    for (const m of String(t || '').matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)) found.add(m[1]);
  }
  return [...found];
}

// Substitui {{variáveis}}: as definidas na ficha e as da empresa; as dinâmicas viram uma indicação;
// as desconhecidas somem (como o pacote de CS recomenda: "se o app não preencher, apague").
export function fillVariables(text, { agent, company, profile }) {
  const fixed = {
    empresa: company.name, site: company.website || '', segmento: company.segment || '',
    nome_agente: agent.name, cargo_agente: agent.role,
    ...profile.variables,
  };
  return String(text || '').replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (_, k) => {
    if (fixed[k] !== undefined && fixed[k] !== '') return fixed[k];
    if (DYNAMIC_VARS.includes(k)) return `[${k}: informado em cada mensagem recebida]`;
    return '';
  });
}

export function sanitizeProfile(body, prev, { validPeople, validCollections }) {
  const s = (v, max) => String(v ?? '').slice(0, max);
  const p = { ...prev };
  if (body.instructions !== undefined) p.instructions = s(body.instructions, 60000);
  if (body.procedures !== undefined) p.procedures = s(body.procedures, 80000);
  if (body.examples !== undefined) p.examples = s(body.examples, 60000);
  if (Array.isArray(body.knowledge)) p.knowledge = body.knowledge.map(String).filter((id) => validCollections.includes(id));
  if (body.variables && typeof body.variables === 'object') {
    p.variables = Object.fromEntries(Object.entries(body.variables).slice(0, 40)
      .map(([k, v]) => [String(k).replace(/[^\w.-]/g, '').slice(0, 40), s(v, 4000)]).filter(([k]) => k));
  }
  if (body.escalation) p.escalation = { to: validPeople.includes(body.escalation.to) ? body.escalation.to : '', note: s(body.escalation.note, 2000) };
  if (body.sendMode) p.sendMode = Object.fromEntries(Object.keys(CHANNELS).map((ch) => [ch, body.sendMode[ch] === 'auto' ? 'auto' : 'approval']));
  if (body.model !== undefined) p.model = MODELS.some((m) => m.id === body.model) ? body.model : '';
  if (body.chatModel !== undefined) p.chatModel = MODELS.some((m) => m.id === body.chatModel) ? body.chatModel : '';
  if (body.effort !== undefined) p.effort = ['low', 'medium', 'high'].includes(body.effort) ? body.effort : '';
  if (body.workshop && typeof body.workshop === 'object') {
    const w = body.workshop; const c = w.code || {};
    const num = (v, lo, hi, def) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def; };
    const d = WORKSHOP_DEFAULT;
    p.workshop = {
      research: !!w.research, browser: !!w.browser, verify: s(w.verify, 3000),
      maxTurns: Math.round(num(w.maxTurns, 5, 300, d.maxTurns)), maxBudgetUsd: num(w.maxBudgetUsd, 0.1, 50, d.maxBudgetUsd), timeoutMin: Math.round(num(w.timeoutMin, 5, 180, d.timeoutMin)),
      code: {
        repo: s(c.repo, 140), baseBranch: s(c.baseBranch, 100).replace(/[^\w./-]/g, ''), setup: s(c.setup, 1000), test: s(c.test, 1000), lint: s(c.lint, 1000),
        postgres: !!c.postgres, redis: !!c.redis, autoMerge: c.autoMerge !== false, ciWaitMin: Math.round(num(c.ciWaitMin, 0, 120, d.code.ciWaitMin)),
        // Comandos por repositório (agente com mais de um repo). A tela ainda não edita: mantém o que já havia.
        perRepo: c.perRepo && typeof c.perRepo === 'object'
          ? Object.fromEntries(Object.entries(c.perRepo).slice(0, 10).map(([r, v]) => [s(r, 140), { setup: s(v?.setup, 1000), test: s(v?.test, 1000), lint: s(v?.lint, 1000), postgres: !!v?.postgres, redis: !!v?.redis }]))
          : prev.workshop?.code?.perRepo || undefined,
      },
    };
  }
  return p;
}

// Guarda a versão anterior (até 15) antes de salvar uma nova.
export function pushHistory(agent, byName) {
  const snap = JSON.parse(JSON.stringify(profileOf(agent)));
  agent.profileHistory ||= [];
  agent.profileHistory.unshift({ ts: Date.now(), by: byName, profile: snap });
  agent.profileHistory = agent.profileHistory.slice(0, 15);
}

export function applyProfile(agent, profile) {
  agent.profile = profile;
  agent.prompt = profile.instructions; // compatibilidade com telas/rotas antigas
}
