// Catálogo de integrações, conexão por empresa, acesso por agente e ferramentas filtradas por acesso.
// Regra: a empresa conecta uma vez; cada agente só recebe as ferramentas (e os recursos) que lhe foram dados.
import { encrypt, decrypt, randomToken } from './secrets.js';
import * as github from './github.js';
import * as resend from './resend.js';
import * as google from './google.js';
import * as railway from './railway.js';
import * as crisp from './crisp.js';
import { profileOf } from './profile.js';
import * as drive from './drive.js';
import * as kapso from './kapso.js';
import * as gads from './gads.js';
import { uid } from './companies.js';
import { renderEmail } from './brand.js';
import * as desk from './trading.js';
import * as bn from './binance.js';

const APP_URL = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
const POLL_MS = +process.env.INBOX_POLL_SECONDS * 1000 || 60000;

export const CATALOG = [
  {
    type: 'github', name: 'GitHub', category: 'Código', icon: 'git-branch', auth: 'token', status: 'available',
    description: 'Agentes leem o código dos repositórios escolhidos e entregam mudanças como Pull Requests, nunca direto na branch principal.',
    tokenLabel: 'Token fine-grained do GitHub', tokenPlaceholder: 'github_pat_…',
    tokenHelp: 'Crie em github.com/settings/personal-access-tokens com acesso só aos repositórios desejados: Contents e Pull requests (leitura e escrita), Commit statuses e Checks (leitura, para o merge automático conferir o CI).',
    tokenUrl: 'https://github.com/settings/personal-access-tokens/new',
    perms: [{ id: 'read', label: 'Ler código' }, { id: 'pr', label: 'Abrir Pull Requests' }, { id: 'code', label: 'Desenvolver na oficina (clonar, testar, commit, push e merge com CI verde)' }],
    resource: { key: 'repos', label: 'Repositórios' },
    suggest: ['cto', 'fullstack', 'backend', 'frontend', 'mobile', 'devops', 'qa', 'dados'],
  },
  {
    type: 'resend', name: 'Resend', category: 'E-mail', icon: 'mail', auth: 'apikey', status: 'available',
    description: 'Caixa de entrada e envio de e-mails do seu domínio. O agente de suporte recebe aviso a cada e-mail novo, lê e responde.',
    tokenLabel: 'API key do Resend', tokenPlaceholder: 're_…',
    tokenHelp: 'Crie em resend.com/api-keys com permissão "Full access" (ler recebidos e enviar). O domínio precisa estar verificado e com recebimento (inbound) ativo.',
    tokenUrl: 'https://resend.com/api-keys',
    configFields: [
      { key: 'from', label: 'Remetente das respostas', placeholder: 'Suporte <suporte@seudominio.com>' },
      { key: 'inboxes', label: 'Caixas que recebem (separe por vírgula)', placeholder: 'suporte@seudominio.com, contato@seudominio.com' },
    ],
    perms: [{ id: 'read', label: 'Ler caixa de entrada' }, { id: 'send', label: 'Responder e enviar' }],
    resource: { key: 'inboxes', label: 'Caixas' },
    suggest: ['cs', 'vendas'],
  },
  {
    type: 'gmail', name: 'Gmail', category: 'E-mail', icon: 'inbox', auth: 'google', status: 'available',
    description: 'Lê, cria rascunhos e envia e-mails pela conta Google conectada.',
    perms: [{ id: 'read', label: 'Ler e-mails' }, { id: 'draft', label: 'Criar rascunhos' }, { id: 'send', label: 'Enviar' }],
    suggest: ['cs', 'vendas', 'ceo', 'assistente', 'sdr'],
  },
  {
    type: 'google_calendar', name: 'Google Agenda', category: 'Agenda', icon: 'calendar-days', auth: 'google', status: 'available',
    description: 'Consulta a agenda e marca reuniões, convidando os participantes por e-mail.',
    perms: [{ id: 'read', label: 'Ver agenda' }, { id: 'write', label: 'Criar eventos' }],
    suggest: ['ceo', 'pm', 'vendas', 'rh', 'assistente'],
  },
  {
    type: 'google_drive', name: 'Google Drive', category: 'Arquivos', icon: 'hard-drive', auth: 'google', status: 'available', companyWide: true,
    description: 'Espelha os arquivos da empresa numa pasta "IAORG — <empresa>" do seu Drive, com as mesmas pastas. Tudo que os agentes e as pessoas salvam aqui vai para lá também. O IAORG só enxerga o que ele mesmo criou no Drive.',
    perms: [],
    suggest: [],
  },
  {
    type: 'railway', name: 'Railway', category: 'Infraestrutura', icon: 'server', auth: 'token', status: 'available',
    description: 'O agente de infra acompanha deploys e logs dos projetos escolhidos, faz redeploy/restart e ajusta variáveis de ambiente.',
    tokenLabel: 'Token do Railway (projeto, conta ou workspace)', tokenPlaceholder: 'rlwy_proj_… ou token da conta',
    tokenHelp: 'Mais simples: token de projeto (Project Settings → Tokens, escolha o ambiente), que dá acesso só àquele projeto e ambiente. Para vários projetos, use um token de conta (railway.com/account/tokens) ou de workspace; neste caso, informe o ID do workspace abaixo.',
    tokenUrl: 'https://railway.com/account/tokens',
    configFields: [{ key: 'workspaceId', label: 'ID do workspace (só para token de workspace)', placeholder: 'Deixe vazio com token de projeto ou de conta' }],
    perms: [{ id: 'read', label: 'Ver deploys e logs' }, { id: 'deploy', label: 'Redeploy e restart' }, { id: 'vars', label: 'Ler e alterar variáveis' }],
    resource: { key: 'projects', label: 'Projetos' },
    suggest: ['devops', 'cto', 'fullstack', 'backend'],
  },
  {
    type: 'crisp', name: 'Crisp', category: 'Atendimento', icon: 'messages-square', auth: 'token', status: 'available',
    description: 'Chat do site: o agente de atendimento é avisado de cada mensagem nova de cliente, lê a conversa, responde como operador e resolve.',
    tokenLabel: 'Token da API do Crisp', tokenPlaceholder: 'identificador:chave',
    tokenParts: [{ key: 'identifier', label: 'Identificador do token' }, { key: 'key', label: 'Chave do token', secret: true }],
    tokenHelp: 'No app.crisp.chat: Settings → Workspace Settings → Advanced configuration → API Token → Generate Token (só o dono do workspace; copie na hora, aparece uma vez). O Website ID fica em Workspace Settings → Setup & Integrations.',
    tokenUrl: 'https://app.crisp.chat/settings/',
    configFields: [
      { key: 'websiteId', label: 'Website ID do Crisp', placeholder: 'Ex.: 8c842203-7ed8-4e29-a608-7cf78a7d2fcc' },
      { key: 'tier', label: 'Tipo de token', options: [{ value: 'website', label: 'Token do workspace (app.crisp.chat)' }, { value: 'plugin', label: 'Token de plugin (Marketplace)' }] },
      { key: 'agentName', label: 'Nome mostrado ao cliente (opcional)', placeholder: 'Ex.: Equipe RapidoJa' },
    ],
    perms: [{ id: 'read', label: 'Ler conversas' }, { id: 'reply', label: 'Responder e anotar' }, { id: 'resolve', label: 'Resolver conversas' }],
    suggest: ['cs', 'vendas'],
  },
  { type: 'slack', name: 'Slack', category: 'Mensagens', icon: 'message-square', status: 'soon', description: 'Agentes leem e respondem em canais escolhidos.' },
  {
    type: 'whatsapp', name: 'WhatsApp (Kapso)', category: 'Atendimento', icon: 'message-circle', auth: 'apikey', status: 'available',
    description: 'Atendimento pelo WhatsApp Business via Kapso: o agente é avisado de cada mensagem nova do cliente, lê o histórico e responde (texto livre até 24 h depois da última mensagem do cliente, regra do WhatsApp).',
    tokenLabel: 'API key do projeto no Kapso', tokenPlaceholder: 'chave do projeto',
    tokenHelp: 'No app.kapso.ai: abra o projeto → API keys → crie uma chave. O número de WhatsApp precisa estar conectado ao projeto (WhatsApp → Numbers).',
    tokenUrl: 'https://app.kapso.ai',
    configFields: [{ key: 'phoneNumberId', label: 'ID do número no WhatsApp (opcional)', placeholder: 'Vazio = o primeiro número do projeto' }],
    perms: [{ id: 'read', label: 'Ler conversas' }, { id: 'reply', label: 'Responder' }],
    suggest: ['cs', 'vendas'],
  },
  {
    type: 'google_ads', name: 'Google Ads', category: 'Marketing', icon: 'megaphone', auth: 'google', status: 'available',
    description: 'Relatórios de campanhas, grupos e termos de pesquisa (gasto, cliques, conversões) e ajustes: pausar/ativar, orçamento diário e palavras negativas. Toda mudança passa pela sua aprovação.',
    perms: [{ id: 'read', label: 'Ver relatórios' }, { id: 'manage', label: 'Ajustar campanhas (com aprovação)' }],
    suggest: ['marketing', 'trafego', 'ceo'],
  },
  {
    type: 'binance', name: 'Binance (mesa de trading)', category: 'Finanças', icon: 'chart-candlestick', auth: 'token', status: 'available',
    description: 'Mesa de trading de cripto no spot. O analista propõe, outro agente avalia o risco e o executor compra sempre com stop. Os limites da empresa (valor por ordem, risco por operação, perda no dia, posições) são conferidos no código, e o botão "Parar a mesa" bloqueia novas compras na hora. Comece no testnet.',
    tokenLabel: 'Chave de API da Binance', tokenPlaceholder: 'API Key e Secret Key',
    tokenParts: [{ key: 'apiKey', label: 'API Key' }, { key: 'apiSecret', label: 'Secret Key', secret: true }],
    tokenHelp: 'Testnet: entre em testnet.binance.vision com o GitHub e gere uma chave (HMAC). Produção: binance.com → Gerenciamento de API → Criar API (HMAC). Marque SÓ "Enable Spot & Margin Trading" e deixe "Enable Withdrawals" DESLIGADO (o IAORG recusa chave com saque). Recomendado: restringir a chave ao IP do servidor.',
    tokenUrl: 'https://testnet.binance.vision/',
    configFields: desk.CONFIG_FIELDS,
    perms: desk.PERMS,
    suggest: ['analista_cripto', 'gestor_risco', 'trader', 'head_mesa'],
  },
  { type: 'notion', name: 'Notion', category: 'Documentos', icon: 'file-text', status: 'soon', description: 'Ler e escrever páginas da base de conhecimento.' },
  { type: 'linear', name: 'Linear', category: 'Projetos', icon: 'list-checks', status: 'soon', description: 'Sincronizar tarefas da obra com o Linear.' },
];
const DEF = Object.fromEntries(CATALOG.map((c) => [c.type, c]));
export const catalogPublic = () => CATALOG.map(({ suggest, ...c }) => ({ ...c, suggest, googleReady: c.auth === 'google' ? google.configured() : undefined }));

// ---------------- estado por empresa ----------------
const ensure = (store) => (store.state.integrations ||= {});

// Instalações antigas guardavam o GitHub em secrets/repos: migra para o novo modelo.
export function migrate(store) {
  const ints = ensure(store);
  if (!ints.github && store.state.secrets?.githubToken) {
    ints.github = { connected: true, secret: store.state.secrets.githubToken, config: { repos: (store.state.repos || []) }, connectedAt: Date.now(), account: '' };
    for (const a of store.aiAgents()) if (isSuggested('github', a)) grant(a, 'github', ['read', 'pr']);
    delete store.state.secrets.githubToken;
    store.save();
  }
}

export const isSuggested = (type, agent) => {
  const key = String(agent.catalogKey || agent.id || '').split('-')[0];
  const role = String(agent.role || '').toLowerCase();
  return (DEF[type]?.suggest || []).some((s) => s === key || role === s || role.startsWith(s));
};

function grant(agent, type, perms, resources = []) {
  agent.access ||= {};
  if (!perms.length) delete agent.access[type];
  else agent.access[type] = { perms, resources };
}

const conn = (store, type) => (ensure(store)[type]?.connected ? ensure(store)[type] : null);
const secretOf = (store, type) => decrypt(conn(store, type)?.secret);
// Para as funções (server/functions.js): o vigia da mesa usa as mesmas regras de conexão e permissão.
export const watchDesk = (rt, member, opts) => desk.watchDesk(rt, { conn, secretOf, can }, member, opts);
export const isConnected = (store, type) => !!conn(store, type);
const access = (agent, type) => agent.access?.[type] || null;
export const can = (store, agent, type, perm) => !!conn(store, type) && !!access(agent, type)?.perms?.includes(perm);
/** Canais em que o agente fala com clientes externos (só quem atende tem; dev, marketing etc. não). */
export function customerChannels(store, agent) {
  const out = [];
  if (can(store, agent, 'resend', 'send') || can(store, agent, 'resend', 'read') || can(store, agent, 'gmail', 'send') || can(store, agent, 'gmail', 'read')) out.push('email');
  if (can(store, agent, 'crisp', 'reply') || can(store, agent, 'crisp', 'read')) out.push('chat');
  if (can(store, agent, 'whatsapp', 'reply') || can(store, agent, 'whatsapp', 'read')) out.push('whatsapp');
  return out;
}

export const githubSecret = (store) => secretOf(store, 'github');
export function allowedRepos(store, agent) {
  const all = (conn(store, 'github')?.config?.repos || []).map((r) => r.fullName);
  const only = access(agent, 'github')?.resources || [];
  return only.length ? all.filter((r) => only.includes(r)) : all;
}
function allowedInboxes(store, agent) {
  const all = (conn(store, 'resend')?.config?.inboxes || []).map((s) => s.toLowerCase());
  const only = (access(agent, 'resend')?.resources || []).map((s) => s.toLowerCase());
  return only.length ? all.filter((r) => only.includes(r)) : all;
}
function allowedProjects(store, agent) {
  const all = conn(store, 'railway')?.config?.projects || [];
  const only = access(agent, 'railway')?.resources || [];
  return only.length ? all.filter((p) => only.includes(p.name) || only.includes(p.id)) : all;
}
const crispCtx = (store) => {
  const c = conn(store, 'crisp');
  return { cred: crisp.parseToken(decrypt(c.secret)), tier: c.config?.tier || 'website', site: c.config?.websiteId, nick: c.config?.agentName || '' };
};
const addrOf = (s) => (String(s).match(/<([^>]+)>/)?.[1] || String(s)).trim().toLowerCase();
const nameOfAddr = (s) => (String(s).match(/^\s*"?([^"<]+?)"?\s*</)?.[1] || addrOf(s).split('@')[0]).trim();
const matchesInbox =(to, inboxes) => !inboxes.length || [].concat(to || []).some((t) => inboxes.includes(addrOf(t)));

// ---------------- quem é o cliente de um e-mail recebido ----------------
// Formulários de site e sistemas costumam enviar como noreply@ e pôr o cliente no corpo ou no Reply-To.
const SYSTEM_SENDER = /^(no-?reply|nao-?responda|naoresponda|do-?not-?reply|donotreply|notifica\w*|notifications?|mailer(-daemon)?|postmaster|bounce\w*|sistema|system|alertas?)$/i;
const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/gi;
const isSystemAddr = (a) => SYSTEM_SENDER.test(String(a).split('@')[0]);
function ownAddresses(store) {
  const cfg = conn(store, 'resend')?.config || {};
  const own = new Set([...(cfg.inboxes || []), cfg.from].filter(Boolean).map(addrOf));
  return { own, domains: new Set([...own].map((a) => a.split('@')[1])) };
}
const bodyOf = (e) => e.text || resend.htmlToText(e.html);
/** Endereços externos citados no e-mail (Reply-To, remetente e corpo), em ordem de confiança. */
function candidatesOf(store, e) {
  const { own, domains } = ownAddresses(store);
  const ok = (a) => a && !own.has(a) && !isSystemAddr(a);
  const list = [...[].concat(e.replyTo || []).map(addrOf), addrOf(e.from), ...(bodyOf(e).match(EMAIL_RE) || []).map((s) => s.toLowerCase()).filter((a) => !domains.has(a.split('@')[1]))];
  return [...new Set(list.filter(ok))];
}
export function customerOf(store, e) {
  const replyTo = [].concat(e.replyTo || []);
  const { own } = ownAddresses(store);
  const rt = replyTo.find((r) => { const a = addrOf(r); return !own.has(a) && !isSystemAddr(a); });
  const text = bodyOf(e);
  // Nome: a linha logo acima do endereço no corpo (padrão de formulários "Nome / e-mail").
  const nameInBody = (addr) => {
    const lines = text.split(/\n/).map((l) => l.trim()).filter(Boolean);
    const i = lines.findIndex((l) => l.toLowerCase().includes(addr));
    const prev = i > 0 ? lines[i - 1] : '';
    return prev && prev.length <= 60 && !prev.includes('@') && !/:$/.test(prev) ? prev : '';
  };
  const hasDisplayName = (s) => /</.test(String(s));
  if (rt) {
    const a = addrOf(rt);
    return { email: a, name: hasDisplayName(rt) ? nameOfAddr(rt) : nameInBody(a) || a.split('@')[0], source: 'reply-to', system: isSystemAddr(addrOf(e.from)) };
  }
  const from = addrOf(e.from);
  if (!isSystemAddr(from) && !own.has(from)) return { email: from, name: nameOfAddr(e.from), source: 'remetente', system: false };
  // E-mail de sistema sem Reply-To: procura o cliente no corpo (ex.: formulário "Nova mensagem de suporte").
  const found = candidatesOf(store, e).find((a) => a !== from);
  if (!found) return { email: null, name: '', source: 'nenhum', system: true };
  return { email: found, name: nameInBody(found) || found.split('@')[0], source: 'corpo', system: true };
}
const customerNote = (c) => (c.source === 'corpo' ? ' (e-mail de sistema/formulário: cliente identificado no corpo da mensagem)' : c.source === 'reply-to' ? ' (via Reply-To)' : '');

async function googleToken(store, type) {
  const c = conn(store, type);
  const tokens = JSON.parse(decrypt(c.secret) || '{}');
  return google.accessToken(tokens, (next) => { c.secret = encrypt(JSON.stringify(next)); store.save(); });
}

// Estado público (sem segredos) para a interface.
export function publicState(store) {
  const ints = ensure(store);
  return CATALOG.filter((c) => ints[c.type]?.connected).map((c) => {
    const i = ints[c.type];
    return {
      type: c.type, account: i.account || '', connectedAt: i.connectedAt, config: i.config || {}, error: i.error || '',
      agents: store.state.agents.filter((a) => a.access?.[c.type]).map((a) => ({ id: a.id, perms: a.access[c.type].perms, resources: a.access[c.type].resources })),
    };
  });
}

// Resumo dos acessos no prompt de sistema do agente.
/** Nomes curtos das integrações conectadas que um agente pode usar (para o mapa de responsabilidades dos colegas). */
export function accessNames(store, agent) {
  return CATALOG.filter((c) => access(agent, c.type)?.perms?.length && conn(store, c.type))
    .map((c) => `${c.name} (${access(agent, c.type).perms.map((p) => c.perms.find((x) => x.id === p)?.label.toLowerCase()).filter(Boolean).join(', ')})`);
}

export function accessSummary(store, agent) {
  const lines = [];
  for (const c of CATALOG) {
    const a = access(agent, c.type);
    if (!a || !conn(store, c.type)) continue;
    const perms = a.perms.map((p) => c.perms.find((x) => x.id === p)?.label.toLowerCase()).filter(Boolean).join(', ');
    let where = '';
    if (c.type === 'github') where = ` em ${allowedRepos(store, agent).join(', ') || '(nenhum repositório)'}`;
    if (c.type === 'resend') where = ` nas caixas ${allowedInboxes(store, agent).join(', ') || '(todas)'}; respostas saem como ${conn(store, 'resend').config?.from || '(remetente não configurado)'}`;
    if (c.type === 'gmail' || c.type === 'google_calendar') where = ` da conta ${conn(store, c.type).account}`;
    if (c.type === 'railway') where = ` nos projetos ${allowedProjects(store, agent).map((p) => `${p.name} (id ${p.id})`).join(', ') || '(nenhum)'}`;
    if (c.type === 'crisp') where = ` no chat do site ${conn(store, 'crisp').account || ''}`;
    if (c.type === 'whatsapp') where = ` no número ${conn(store, 'whatsapp').account || ''} (texto livre só até 24 h após a última mensagem do cliente)`;
    if (c.type === 'google_ads') { const cfg = conn(store, 'google_ads').config || {}; where = cfg.customerId ? ` na conta ${cfg.name || cfg.customerId} (moeda ${cfg.currency || '?'}); mudanças vão para aprovação de uma pessoa` : ' (nenhuma conta escolhida ainda)'; }
    if (c.type === 'binance') where = desk.accessLine(desk.deskConfig(conn(store, 'binance').config));
    lines.push(`- ${c.name}: ${perms}${where}`);
  }
  return lines.length ? `Seus acessos a sistemas externos (use as ferramentas correspondentes):\n${lines.join('\n')}\nEntregas de código em repositórios são sempre via repo_open_pr. Ao responder clientes (e-mail ou chat), seja cordial e objetivo; se não souber a resposta, diga que vai verificar e avise o responsável na empresa. Em infraestrutura, investigue logs antes de agir; redeploy, restart e mudança de variáveis afetam produção: explique o motivo no diário (send_message ao seu chefe) antes de executar.` : '';
}

// ---------------- ferramentas por agente ----------------
const T = (name, description, properties = {}, required = []) => ({ name, description, input_schema: { type: 'object', properties, required } });
const S = (description) => ({ type: 'string', description });

export function toolsFor(store, agent) {
  const tools = [];
  if (can(store, agent, 'github', 'read')) {
    tools.push(
      T('repo_list_files', 'Lista arquivos e pastas de um repositório GitHub que você pode acessar.', { repo: S('owner/nome'), path: S('Pasta (vazio = raiz)') }, ['repo']),
      T('repo_read_file', 'Lê um arquivo da branch padrão de um repositório GitHub que você pode acessar.', { repo: S('owner/nome'), path: S('Caminho do arquivo') }, ['repo', 'path']),
      T('repo_history', 'Histórico do repositório: commits recentes da branch padrão (data, autor, mensagem) e Pull Requests recentes (estado, data do merge). Use para responder "quando foi feito/commitado/mergeado". Filtre por arquivo/pasta (path) e/ou por um texto na mensagem ou no título do PR (busca).', {
        repo: S('owner/nome'), path: S('Opcional: arquivo ou pasta'), busca: S('Opcional: texto a procurar nas mensagens de commit e títulos de PR'), limite: { type: 'number', description: 'Padrão 20' },
      }, ['repo']),
    );
  }
  if (can(store, agent, 'github', 'pr')) {
    tools.push(T('repo_open_pr', 'Entrega código: cria um branch com um commit dos arquivos (conteúdo completo de cada um) e abre um Pull Request para revisão humana. Nunca altera a branch padrão.', {
      repo: S('owner/nome'), title: S('Título do PR e do commit'), body: S('O que muda e como testar'),
      files: { type: 'array', items: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
    }, ['repo', 'title', 'files']));
  }
  if (can(store, agent, 'resend', 'read')) {
    tools.push(
      T('email_inbox_list', 'Lista os e-mails recebidos nas caixas de entrada que você atende (mais recentes primeiro), indicando quais já foram respondidos.', { limit: { type: 'number', description: 'Quantos (máx. 50)' } }),
      T('email_read', 'Lê um e-mail recebido (remetente, assunto e texto completo).', { email_id: S('id do e-mail recebido') }, ['email_id']),
    );
  }
  if (can(store, agent, 'resend', 'send')) {
    tools.push(
      T('email_reply', 'Responde um e-mail recebido para o cliente. O destinatário é escolhido automaticamente (Reply-To, remetente ou, em e-mails de formulário/noreply, o cliente citado no corpo). Use "to" só para escolher outro endereço que apareça no próprio e-mail.', { email_id: S('id do e-mail recebido'), text: S('Texto da resposta, completo e assinado'), to: S('Opcional: endereço do cliente citado no e-mail, se o automático estiver errado') }, ['email_id', 'text']),
      T('email_send', 'Envia um e-mail novo pelo remetente da empresa.', { to: S('E-mail do destinatário'), subject: S('Assunto'), text: S('Corpo do e-mail') }, ['to', 'subject', 'text']),
    );
  }
  if (can(store, agent, 'gmail', 'read')) {
    tools.push(
      T('gmail_search', 'Busca e-mails no Gmail com a sintaxe de busca do Gmail (ex.: "in:inbox is:unread", "from:cliente@x.com").', { query: S('Busca do Gmail') }),
      T('gmail_read', 'Lê um e-mail do Gmail pelo id.', { id: S('id da mensagem') }, ['id']),
    );
  }
  if (can(store, agent, 'gmail', 'draft')) {
    tools.push(T('gmail_draft', 'Cria um rascunho no Gmail (não envia). Para responder, passe reply_to_id.', { to: S('Destinatário'), subject: S('Assunto'), text: S('Corpo'), reply_to_id: S('Opcional: id da mensagem que está respondendo') }, ['to', 'subject', 'text']));
  }
  if (can(store, agent, 'gmail', 'send')) {
    tools.push(T('gmail_send', 'Envia um e-mail pelo Gmail. Para responder, passe reply_to_id.', { to: S('Destinatário'), subject: S('Assunto'), text: S('Corpo'), reply_to_id: S('Opcional: id da mensagem que está respondendo') }, ['to', 'subject', 'text']));
  }
  if (can(store, agent, 'google_calendar', 'read')) {
    tools.push(T('calendar_list', 'Lista os próximos eventos da agenda.', { from: S('Início ISO 8601 (padrão: agora)'), to: S('Fim ISO 8601 (opcional)') }));
  }
  if (can(store, agent, 'google_calendar', 'write')) {
    tools.push(T('calendar_create', 'Cria um evento na agenda e convida os participantes.', {
      title: S('Título'), description: S('Descrição'), start: S('Início ISO 8601, ex.: 2026-11-20T14:00:00'), end: S('Fim ISO 8601'),
      attendees: { type: 'array', items: { type: 'string' }, description: 'E-mails dos convidados' },
    }, ['title', 'start', 'end']));
  }
  if (can(store, agent, 'railway', 'read')) {
    tools.push(
      T('railway_projects', 'Lista os projetos do Railway que você pode acessar, com serviços e ambientes (ids necessários nas outras ferramentas).'),
      T('railway_deployments', 'Lista os últimos deploys de um serviço num ambiente, com status.', { project_id: S('id do projeto'), service_id: S('id do serviço'), environment_id: S('id do ambiente') }, ['project_id', 'service_id', 'environment_id']),
      T('railway_logs', 'Lê logs de um deploy (runtime ou build). Use filter para buscar texto, ex.: "error".', {
        project_id: S('id do projeto (para checar acesso)'), deployment_id: S('id do deploy'),
        kind: { type: 'string', enum: ['runtime', 'build'] }, filter: S('Opcional: texto a filtrar'), limit: { type: 'number', description: 'Linhas (máx. 300)' },
      }, ['project_id', 'deployment_id']),
    );
  }
  if (can(store, agent, 'railway', 'deploy')) {
    tools.push(
      T('railway_redeploy', 'Refaz o deploy (rebuild) de um deploy existente. Afeta produção: avise antes.', { project_id: S('id do projeto'), deployment_id: S('id do deploy'), reason: S('Motivo, registrado no diário') }, ['project_id', 'deployment_id', 'reason']),
      T('railway_restart', 'Reinicia um deploy sem rebuild. Afeta produção: avise antes.', { project_id: S('id do projeto'), deployment_id: S('id do deploy'), reason: S('Motivo, registrado no diário') }, ['project_id', 'deployment_id', 'reason']),
    );
  }
  if (can(store, agent, 'railway', 'vars')) {
    tools.push(
      T('railway_variables', 'Lista os nomes das variáveis de ambiente de um serviço (valores mascarados).', { project_id: S('id do projeto'), environment_id: S('id do ambiente'), service_id: S('id do serviço') }, ['project_id', 'environment_id', 'service_id']),
      T('railway_set_variable', 'Cria ou altera uma variável de ambiente de um serviço. Por padrão dispara um novo deploy.', {
        project_id: S('id do projeto'), environment_id: S('id do ambiente'), service_id: S('id do serviço'), name: S('Nome da variável'), value: S('Valor'),
        skip_deploy: { type: 'boolean', description: 'true para não redeployar agora' }, reason: S('Motivo, registrado no diário'),
      }, ['project_id', 'environment_id', 'service_id', 'name', 'value', 'reason']),
    );
  }
  if (can(store, agent, 'crisp', 'read')) {
    tools.push(
      T('chat_conversations', 'Lista conversas do chat do site (Crisp).', { filter: { type: 'string', enum: ['unread', 'unresolved', 'all'], description: 'Padrão: unresolved' } }),
      T('chat_messages', 'Lê as mensagens de uma conversa do chat.', { session_id: S('session_id da conversa') }, ['session_id']),
    );
  }
  if (can(store, agent, 'crisp', 'reply')) {
    tools.push(
      T('chat_reply', 'Responde o cliente no chat do site, como operador.', { session_id: S('session_id'), text: S('Mensagem para o cliente') }, ['session_id', 'text']),
      T('chat_note', 'Deixa uma nota interna na conversa (o cliente não vê).', { session_id: S('session_id'), text: S('Nota interna') }, ['session_id', 'text']),
    );
  }
  if (can(store, agent, 'crisp', 'resolve')) {
    tools.push(T('chat_resolve', 'Marca a conversa como resolvida.', { session_id: S('session_id') }, ['session_id']));
  }
  if (can(store, agent, 'whatsapp', 'read')) {
    tools.push(
      T('whatsapp_recent', 'Lista as conversas recentes do WhatsApp (última mensagem de cada cliente, se a janela de 24 h está aberta).'),
      T('whatsapp_messages', 'Lê o histórico de mensagens do WhatsApp com um cliente (mais antigas primeiro).', { telefone: S('Telefone do cliente (só números, com DDI, ex.: 5511999998888)') }, ['telefone']),
    );
  }
  if (can(store, agent, 'whatsapp', 'reply')) {
    tools.push(T('whatsapp_reply', 'Responde o cliente no WhatsApp (texto). Só funciona até 24 h depois da última mensagem do cliente; fora disso, escale.', { telefone: S('Telefone do cliente (com DDI)'), text: S('Mensagem para o cliente: curta, sem markdown pesado') }, ['telefone', 'text']));
  }
  if (can(store, agent, 'google_ads', 'read')) {
    tools.push(
      T('ads_report', 'Relatório do Google Ads: impressões, cliques, CTR, CPC, custo, conversões e custo por conversão, por campanha, grupo de anúncios ou termo de pesquisa.', {
        nivel: { type: 'string', enum: ['campaign', 'ad_group', 'search_term'], description: 'Padrão: campaign' },
        periodo: { type: 'string', enum: ['TODAY', 'YESTERDAY', 'LAST_7_DAYS', 'LAST_14_DAYS', 'LAST_30_DAYS', 'THIS_MONTH', 'LAST_MONTH'], description: 'Padrão: LAST_7_DAYS' },
        campaign_id: S('Opcional: filtrar uma campanha'),
      }),
      T('ads_query', 'Consulta livre em GAQL (somente SELECT) no Google Ads, para análises que o relatório pronto não cobre.', { gaql: S('Consulta GAQL, ex.: SELECT ad_group_ad.ad.id, metrics.clicks FROM ad_group_ad WHERE segments.date DURING LAST_7_DAYS') }, ['gaql']),
    );
  }
  if (can(store, agent, 'google_ads', 'manage')) {
    tools.push(
      T('ads_campaign_status', 'Pausa ou ativa uma campanha. Vai para aprovação de uma pessoa antes de valer.', { campaign_id: S('id da campanha'), status: { type: 'string', enum: ['PAUSED', 'ENABLED'] }, reason: S('Motivo, com os números que justificam') }, ['campaign_id', 'status', 'reason']),
      T('ads_set_budget', 'Muda o orçamento diário de uma campanha (na moeda da conta). Vai para aprovação de uma pessoa antes de valer.', { campaign_id: S('id da campanha'), daily_budget: { type: 'number', description: 'Novo orçamento diário, ex.: 50' }, reason: S('Motivo, com os números que justificam') }, ['campaign_id', 'daily_budget', 'reason']),
      T('ads_add_negative', 'Adiciona uma palavra-chave negativa a uma campanha (para parar de gastar com termos ruins). Vai para aprovação.', { campaign_id: S('id da campanha'), keyword: S('Termo negativo'), match_type: { type: 'string', enum: ['PHRASE', 'EXACT', 'BROAD'] }, reason: S('Motivo') }, ['campaign_id', 'keyword', 'reason']),
    );
  }
  if (conn(store, 'binance')) tools.push(...desk.deskTools((p) => can(store, agent, 'binance', p)));
  return tools;
}

const mask = (v) => { const s = String(v ?? ''); return s.length <= 6 ? '••••' : `${s.slice(0, 2)}••••${s.slice(-2)}`; };

const deny = (what) => ({ error: `Você não tem acesso para ${what}. Peça ao dono da empresa para liberar na aba Integrações.` });

// ---------------- fila de aprovação ----------------
// Ferramentas que falam com clientes. No modo "rascunho para aprovação" elas viram um item
// na fila (Minha mesa) e só são executadas quando uma pessoa aprova.
const OUTBOUND = { email_reply: 'email', email_send: 'email', gmail_send: 'email', chat_reply: 'chat', whatsapp_reply: 'whatsapp' };
// Mudanças que mexem em dinheiro: SEMPRE passam por uma pessoa (não dependem do modo de envio).
const ADS_CHANGES = new Set(['ads_campaign_status', 'ads_set_budget', 'ads_add_negative']);
const adsAccount = (store) => { const cfg = conn(store, 'google_ads')?.config || {}; return cfg.customerId ? { customerId: cfg.customerId, loginCustomerId: cfg.loginCustomerId || null, name: cfg.name, currency: cfg.currency } : null; };
const waCtx = (store) => ({ key: secretOf(store, 'whatsapp'), pnid: conn(store, 'whatsapp')?.config?.phoneNumberId });
const digits = (s) => String(s || '').replace(/\D/g, '');

async function previewOf(store, name, input) {
  try {
    if (name === 'email_reply') {
      const o = await resend.getReceived(secretOf(store, 'resend'), input.email_id);
      const c = customerOf(store, o);
      const para = input.to ? addrOf(input.to) : c.email;
      return { para: para || 'cliente não identificado', origem: input.to ? 'escolhido pelo agente' : { 'reply-to': 'Reply-To do e-mail', remetente: 'remetente', corpo: 'cliente citado no corpo (e-mail de formulário)', nenhum: '' }[c.source], assunto: /^re:/i.test(o.subject || '') ? o.subject : `Re: ${o.subject || ''}`, original: bodyOf(o).slice(0, 1500) };
    }
    if (name === 'email_send' || name === 'gmail_send') return { para: input.to, assunto: input.subject };
    if (name === 'chat_reply') {
      const x = crispCtx(store);
      const msgs = await crisp.messages(x.cred, x.tier, x.site, input.session_id);
      return { para: 'Cliente no chat do site', conversa: msgs.slice(-6).map((m) => `${m.from === 'user' ? 'Cliente' : 'Equipe'}: ${m.text}`).join('\n').slice(0, 1500) };
    }
    if (name === 'whatsapp_reply') {
      const w = waCtx(store);
      const msgs = (await kapso.messages(w.key, w.pnid, { phone: input.telefone, limit: 8 })).reverse();
      const nome = msgs.find((m) => m.direction === 'inbound' && m.name)?.name;
      return { para: `${nome ? `${nome} · ` : ''}+${digits(input.telefone)} (WhatsApp)`, conversa: msgs.map((m) => `${m.direction === 'inbound' ? 'Cliente' : 'Empresa'}: ${m.text}`).join('\n').slice(0, 1500) };
    }
    if (ADS_CHANGES.has(name)) {
      const acc = adsAccount(store);
      let camp = `campanha ${input.campaign_id}`;
      try { const c = await gads.campaignInfo(await googleToken(store, 'google_ads'), acc, input.campaign_id); camp = `"${c.name}" (hoje: ${c.status === 'ENABLED' ? 'ativa' : c.status === 'PAUSED' ? 'pausada' : c.status}, orçamento ${c.budget} ${acc.currency || ''}/dia)`; } catch { /* prévia opcional */ }
      return { para: `Google Ads · ${acc?.name || acc?.customerId || 'conta'}`, assunto: camp, original: `Motivo do agente: ${input.reason || '—'}` };
    }
  } catch { /* prévia é opcional */ }
  return {};
}

// extra (opcional, usado pela mesa de trading): { channel, text, preview, reply } — o texto não é editável.
async function queueApproval(rt, agent, name, input, extra = null) {
  const store = rt.store;
  if (extra) {
    const item = { id: uid('ap'), ts: Date.now(), status: 'pending', agentId: agent.id, tool: name, channel: extra.channel, input, text: extra.text, preview: extra.preview || {}, readOnlyText: true };
    (store.state.approvals ||= []).push(item);
    if (store.state.approvals.length > 300) store.state.approvals.splice(0, store.state.approvals.length - 300);
    store.save();
    const what = extra.channel === 'trade' ? 'uma ordem na Binance' : 'uma ação';
    rt.logEvent('task', agent.id, `${agent.name} pediu aprovação de ${what}${item.preview.para ? ` — ${item.preview.para}` : ''}`);
    for (const p of store.state.agents.filter((a) => a.kind === 'human' && ['owner', 'admin'].includes(a.appRole))) rt.emit({ type: 'notify', to: p.id, text: `${agent.name} pediu aprovação de ${what}` });
    rt.pushSnapshot();
    return { ok: true, aguardando_aprovacao: true, aviso: extra.reply || 'Foi para aprovação de uma pessoa. Não repita.' };
  }
  const adsText = {
    ads_campaign_status: () => `${input.status === 'PAUSED' ? 'Pausar' : 'Ativar'} a campanha ${input.campaign_id}.`,
    ads_set_budget: () => `Mudar o orçamento diário da campanha ${input.campaign_id} para ${input.daily_budget}.`,
    ads_add_negative: () => `Adicionar a palavra negativa "${input.keyword}" (${input.match_type || 'PHRASE'}) na campanha ${input.campaign_id}.`,
  }[name];
  const item = {
    id: uid('ap'), ts: Date.now(), status: 'pending', agentId: agent.id, tool: name, channel: OUTBOUND[name] || (ADS_CHANGES.has(name) ? 'ads' : 'outro'),
    input, text: adsText ? `${adsText()}\nMotivo: ${input.reason || '—'}` : String(input.text || ''), preview: await previewOf(store, name, input),
    readOnlyText: !!adsText,
  };
  (store.state.approvals ||= []).push(item);
  if (store.state.approvals.length > 300) store.state.approvals.splice(0, store.state.approvals.length - 300);
  store.save();
  const what = { chat: 'uma resposta no chat', email: 'um e-mail', whatsapp: 'uma resposta no WhatsApp', ads: 'uma mudança no Google Ads' }[item.channel] || 'uma ação';
  rt.logEvent('task', agent.id, `${agent.name} pediu aprovação de ${what}${item.preview.para ? ` — ${item.preview.para}` : ''}`);
  for (const p of store.state.agents.filter((a) => a.kind === 'human' && ['owner', 'admin'].includes(a.appRole))) {
    rt.emit({ type: 'notify', to: p.id, text: `${agent.name} pediu aprovação de ${what}` });
  }
  rt.pushSnapshot();
  return item.channel === 'ads'
    ? { ok: true, aguardando_aprovacao: true, aviso: 'A mudança foi para aprovação de uma pessoa e só vale depois de aprovada. Não repita o pedido; informe o que propôs e por quê.' }
    : { ok: true, aguardando_aprovacao: true, aviso: 'Sua resposta virou rascunho e só será enviada depois que uma pessoa aprovar. Não reenvie.' };
}

// Executa um item aprovado (com o texto possivelmente editado pela pessoa).
export async function approve(rt, item, { text, byName }) {
  const agent = rt.store.getAgent(item.agentId);
  if (!agent) throw new Error('Agente não existe mais');
  const input = { ...item.input, ...(text !== undefined && !item.readOnlyText ? { text } : {}) };
  const out = await executeIntegrationTool(rt, agent, item.tool, input, null, { approved: true });
  if (out?.error) throw new Error(out.error);
  Object.assign(item, { status: 'approved', decidedAt: Date.now(), decidedBy: byName, finalText: input.text });
  rt.store.save();
  return out;
}

// Nota interna no chat ao escalar (o cliente não vê).
export async function escalateNote(rt, agent, sessionId, text) {
  if (!can(rt.store, agent, 'crisp', 'read')) return;
  const x = crispCtx(rt.store);
  await crisp.send(x.cred, x.tier, x.site, sessionId, text, { note: true });
}

// Executa uma ferramenta de integração. Devolve undefined quando o nome não é de integração.
export async function executeIntegrationTool(rt, agent, name, input, taskHint, opts = {}) {
  const store = rt.store;
  const say = (bubble) => rt.setStatus(agent.id, { status: 'working', bubble });
  const channel = OUTBOUND[name];
  if (channel && !opts.approved) {
    const perm = { email_reply: ['resend', 'send'], email_send: ['resend', 'send'], gmail_send: ['gmail', 'send'], chat_reply: ['crisp', 'reply'], whatsapp_reply: ['whatsapp', 'reply'] }[name];
    if (can(store, agent, ...perm) && (opts.forceApproval || profileOf(agent).sendMode[channel] !== 'auto')) return queueApproval(rt, agent, name, input);
  }
  if (ADS_CHANGES.has(name) && !opts.approved) {
    if (!can(store, agent, 'google_ads', 'manage')) return deny('ajustar campanhas do Google Ads');
    if (!adsAccount(store)) return { error: 'Nenhuma conta do Google Ads foi escolhida em Integrações.' };
    if (!String(input.reason || '').trim()) return { error: 'Informe o motivo (reason) com os números que justificam a mudança.' };
    return queueApproval(rt, agent, name, input);
  }
  if (desk.DESK_TOOLS.has(name)) {
    try { return await desk.executeDeskTool(rt, agent, name, input, opts, { can, conn, secretOf, deny, queueApproval }); }
    catch (e) { return { error: `Binance: ${e.message}` }; }
  }
  switch (name) {
    case 'repo_list_files':
    case 'repo_read_file':
    case 'repo_history':
    case 'repo_open_pr': {
      const need = name === 'repo_open_pr' ? 'pr' : 'read';
      if (!can(store, agent, 'github', need)) return deny(need === 'pr' ? 'abrir Pull Requests' : 'ler repositórios');
      const repos = allowedRepos(store, agent);
      if (!repos.includes(input.repo)) return { error: `Repositório fora do seu acesso: ${input.repo}. Você pode usar: ${repos.join(', ') || 'nenhum'}.` };
      const token = secretOf(store, 'github');
      if (name === 'repo_list_files') { say(`Lendo ${input.repo}/${input.path || ''}`); return { items: (await github.listFiles(token, input.repo, input.path)).slice(0, 300) }; }
      if (name === 'repo_read_file') { say(`Lendo ${input.path}`); return { content: (await github.readFile(token, input.repo, input.path)).slice(0, 60000) }; }
      if (name === 'repo_history') { say(`Vendo o histórico de ${input.repo}`); return github.history(token, input.repo, { path: input.path || '', search: input.busca || '', limit: Math.min(50, +input.limite || 20) }); }
      say(`Abrindo PR em ${input.repo}`);
      const pr = await github.openPullRequest(token, input.repo, { title: input.title, body: `${input.body || ''}\n\n---\nAberto por ${agent.name} (${agent.role}) via IAORG.`, files: input.files, branchHint: taskHint || input.title });
      rt.logEvent('file', agent.id, `${agent.name} abriu o PR #${pr.number} em ${input.repo}`, { url: pr.url });
      return { ok: true, ...pr };
    }
    case 'email_inbox_list': {
      if (!can(store, agent, 'resend', 'read')) return deny('ler a caixa de entrada');
      say('Lendo a caixa de entrada');
      const inboxes = allowedInboxes(store, agent);
      const replied = new Set((store.state.emailLog || []).map((l) => l.replyTo));
      const list = (await resend.listReceived(secretOf(store, 'resend'), { limit: Math.min(+input.limit || 20, 50) }))
        .filter((e) => matchesInbox(e.to, inboxes))
        .map((e) => ({ ...e, answered: replied.has(e.id) }));
      return { emails: list };
    }
    case 'email_read': {
      if (!can(store, agent, 'resend', 'read')) return deny('ler e-mails');
      const e = await resend.getReceived(secretOf(store, 'resend'), input.email_id);
      if (!matchesInbox(e.to, allowedInboxes(store, agent))) return { error: 'Este e-mail é de uma caixa que você não atende.' };
      say(`Lendo: ${e.subject || '(sem assunto)'}`);
      const cli = customerOf(store, e);
      return { id: e.id, from: e.from, to: e.to, subject: e.subject, received: e.createdAt, cliente: { nome: cli.name, email: cli.email, origem: cli.source, email_de_sistema: cli.system }, responder_para: cli.email || 'não identificado: escale', text: bodyOf(e).slice(0, 20000) };
    }
    case 'email_reply':
    case 'email_send': {
      if (!can(store, agent, 'resend', 'send')) return deny('enviar e-mails');
      const c = conn(store, 'resend');
      if (!c.config?.from) return { error: 'O remetente do Resend não foi configurado na integração.' };
      const key = secretOf(store, 'resend');
      let to = input.to; let subject = input.subject; let inReplyTo;
      if (name === 'email_reply') {
        const orig = await resend.getReceived(key, input.email_id);
        if (!matchesInbox(orig.to, allowedInboxes(store, agent))) return { error: 'Este e-mail é de uma caixa que você não atende.' };
        const cli = customerOf(store, orig);
        if (input.to) {
          const want = addrOf(input.to);
          if (!candidatesOf(store, orig).includes(want)) return { error: `O endereço ${want} não aparece neste e-mail. Só é possível responder a quem escreveu.` };
          to = want;
        } else to = cli.email;
        if (!to) return { error: 'Não foi possível identificar o e-mail do cliente (mensagem de sistema sem endereço no corpo). Escale para uma pessoa.' };
        subject = /^re:/i.test(orig.subject || '') ? orig.subject : `Re: ${orig.subject || ''}`;
        if (!cli.system) inReplyTo = orig.messageId; // o cliente nunca viu a mensagem do sistema: não encadeia nela
      }
      to = [].concat(to).map(addrOf);
      const { own } = ownAddresses(store);
      const bad = to.find((a) => own.has(a) || isSystemAddr(a));
      if (bad) return { error: `Não envio para ${bad}: é um endereço da própria empresa ou de sistema (noreply). Responda ao cliente.` };
      say(`Respondendo ${to}`);
      const mail = renderEmail(store, agent, { text: input.text }); // modelo da marca: logo, assinatura e rodapé
      const sent = await resend.send(key, { from: c.config.from, to, subject, text: mail.text, html: mail.html, inline: mail.inline, inReplyTo });
      (store.state.emailLog ||= []).push({ ts: Date.now(), agentId: agent.id, to, subject, replyTo: input.email_id || null, id: sent.id });
      if (store.state.emailLog.length > 500) store.state.emailLog.splice(0, store.state.emailLog.length - 500);
      store.save();
      rt.logEvent('message', agent.id, `${agent.name} enviou e-mail para ${to}: ${subject}`);
      return { ok: true, id: sent.id };
    }
    case 'gmail_search':
    case 'gmail_read': {
      if (!can(store, agent, 'gmail', 'read')) return deny('ler o Gmail');
      const token = await googleToken(store, 'gmail');
      say(name === 'gmail_search' ? 'Buscando no Gmail' : 'Lendo e-mail');
      return name === 'gmail_search' ? { messages: await google.gmailSearch(token, input.query || 'in:inbox') } : await google.gmailRead(token, input.id);
    }
    case 'gmail_draft':
    case 'gmail_send': {
      const need = name === 'gmail_send' ? 'send' : 'draft';
      if (!can(store, agent, 'gmail', need)) return deny(need === 'send' ? 'enviar pelo Gmail' : 'criar rascunhos no Gmail');
      const token = await googleToken(store, 'gmail');
      let threadId; let inReplyTo;
      if (input.reply_to_id) { const o = await google.gmailRead(token, input.reply_to_id); threadId = o.threadId; inReplyTo = o.messageId; }
      const mail = renderEmail(store, agent, { text: input.text }); // modelo da marca
      const args = { to: input.to, subject: input.subject, text: mail.text, html: mail.html, inline: mail.inline, threadId, inReplyTo };
      say(need === 'send' ? `Enviando para ${input.to}` : 'Escrevendo rascunho');
      const out = need === 'send' ? await google.gmailSend(token, args) : await google.gmailDraft(token, args);
      rt.logEvent('message', agent.id, `${agent.name} ${need === 'send' ? 'enviou pelo Gmail' : 'criou um rascunho no Gmail'} para ${input.to}: ${input.subject}`);
      return { ok: true, ...out };
    }
    case 'calendar_list': {
      if (!can(store, agent, 'google_calendar', 'read')) return deny('ver a agenda');
      say('Consultando a agenda');
      return { events: await google.calendarList(await googleToken(store, 'google_calendar'), { from: input.from, to: input.to }) };
    }
    case 'calendar_create': {
      if (!can(store, agent, 'google_calendar', 'write')) return deny('criar eventos');
      say(`Marcando: ${input.title}`);
      const ev = await google.calendarCreate(await googleToken(store, 'google_calendar'), input);
      rt.logEvent('task', agent.id, `${agent.name} marcou "${input.title}" na agenda`, { url: ev.link });
      return { ok: true, ...ev };
    }
    // ---------- Railway ----------
    case 'railway_projects': {
      if (!can(store, agent, 'railway', 'read')) return deny('ver o Railway');
      say('Consultando o Railway');
      const token = secretOf(store, 'railway');
      const out = [];
      for (const p of allowedProjects(store, agent).slice(0, 10)) out.push(await railway.projectDetail(token, p.id));
      return { projects: out };
    }
    case 'railway_deployments':
    case 'railway_logs':
    case 'railway_redeploy':
    case 'railway_restart':
    case 'railway_variables':
    case 'railway_set_variable': {
      const need = { railway_deployments: 'read', railway_logs: 'read', railway_redeploy: 'deploy', railway_restart: 'deploy', railway_variables: 'vars', railway_set_variable: 'vars' }[name];
      if (!can(store, agent, 'railway', need)) return deny({ read: 'ver deploys e logs', deploy: 'fazer redeploy/restart', vars: 'mexer em variáveis' }[need]);
      const proj = allowedProjects(store, agent).find((p) => p.id === input.project_id);
      if (!proj) return { error: `Projeto fora do seu acesso: ${input.project_id}. Use railway_projects para ver os seus.` };
      const token = secretOf(store, 'railway');
      if (name === 'railway_deployments') {
        say(`Deploys de ${proj.name}`);
        return { deployments: await railway.deployments(token, { projectId: proj.id, serviceId: input.service_id, environmentId: input.environment_id, first: 5 }) };
      }
      if (name === 'railway_logs') {
        say(`Lendo logs de ${proj.name}`);
        const lines = await railway.logs(token, { deploymentId: input.deployment_id, kind: input.kind, filter: input.filter, limit: Math.min(+input.limit || 120, 300) });
        return { logs: lines.map((l) => `${l.timestamp} [${l.severity}] ${l.message}`).join('\n').slice(-30000) };
      }
      if (name === 'railway_variables') {
        const vars = await railway.variables(token, { projectId: proj.id, environmentId: input.environment_id, serviceId: input.service_id });
        return { variables: Object.fromEntries(Object.entries(vars).map(([k, v]) => [k, mask(v)])) };
      }
      const why = String(input.reason || '').slice(0, 200);
      if (name === 'railway_set_variable') {
        say(`Ajustando ${input.name} em ${proj.name}`);
        await railway.upsertVariable(token, { projectId: proj.id, environmentId: input.environment_id, serviceId: input.service_id, name: input.name, value: input.value, skipDeploys: input.skip_deploy });
        rt.logEvent('system', agent.id, `${agent.name} alterou a variável ${input.name} em ${proj.name}${input.skip_deploy ? ' (sem redeploy)' : ''}. Motivo: ${why}`);
        return { ok: true };
      }
      say(`${name === 'railway_redeploy' ? 'Redeploy' : 'Restart'} em ${proj.name}`);
      const r = name === 'railway_redeploy' ? await railway.redeploy(token, input.deployment_id) : await railway.restart(token, input.deployment_id);
      rt.logEvent('system', agent.id, `${agent.name} fez ${name === 'railway_redeploy' ? 'redeploy' : 'restart'} em ${proj.name}. Motivo: ${why}`);
      return { ok: true, ...r };
    }
    // ---------- Crisp ----------
    case 'chat_conversations': {
      if (!can(store, agent, 'crisp', 'read')) return deny('ler o chat');
      const x = crispCtx(store);
      say('Lendo o chat do site');
      return { conversations: await crisp.conversations(x.cred, x.tier, x.site, { filter: input.filter || 'unresolved' }) };
    }
    case 'chat_messages': {
      if (!can(store, agent, 'crisp', 'read')) return deny('ler o chat');
      const x = crispCtx(store);
      say('Lendo a conversa');
      return { messages: await crisp.messages(x.cred, x.tier, x.site, input.session_id) };
    }
    case 'chat_reply':
    case 'chat_note': {
      if (!can(store, agent, 'crisp', 'reply')) return deny('responder no chat');
      const x = crispCtx(store);
      say(name === 'chat_note' ? 'Anotando na conversa' : 'Respondendo no chat');
      await crisp.send(x.cred, x.tier, x.site, input.session_id, input.text, { note: name === 'chat_note', nickname: x.nick || undefined });
      if (name === 'chat_reply') {
        await crisp.markRead(x.cred, x.tier, x.site, input.session_id).catch(() => {});
        rt.logEvent('message', agent.id, `${agent.name} respondeu no chat do site: ${String(input.text).slice(0, 120)}`);
      }
      return { ok: true };
    }
    case 'chat_resolve': {
      if (!can(store, agent, 'crisp', 'resolve')) return deny('resolver conversas');
      const x = crispCtx(store);
      await crisp.setState(x.cred, x.tier, x.site, input.session_id, 'resolved');
      rt.logEvent('task', agent.id, `${agent.name} resolveu uma conversa no chat do site`);
      return { ok: true };
    }
    // ---------- WhatsApp (Kapso) ----------
    case 'whatsapp_recent': {
      if (!can(store, agent, 'whatsapp', 'read')) return deny('ler o WhatsApp');
      const w = waCtx(store);
      say('Lendo o WhatsApp');
      const list = await kapso.messages(w.key, w.pnid, { limit: 100 });
      const byPhone = new Map();
      for (const m of list) if (!byPhone.has(m.phone)) byPhone.set(m.phone, m);
      const lastIn = new Map();
      for (const m of list) if (m.direction === 'inbound' && !lastIn.has(m.phone)) lastIn.set(m.phone, m.ts);
      return {
        conversas: [...byPhone.values()].slice(0, 25).map((m) => ({
          telefone: m.phone, nome: list.find((x) => x.phone === m.phone && x.name)?.name || '', ultima: m.text.slice(0, 200), de: m.direction === 'inbound' ? 'cliente' : 'empresa',
          quando: new Date(m.ts).toISOString(), janela_24h_aberta: Date.now() - (lastIn.get(m.phone) || 0) < kapso.WINDOW_MS,
        })),
      };
    }
    case 'whatsapp_messages': {
      if (!can(store, agent, 'whatsapp', 'read')) return deny('ler o WhatsApp');
      const w = waCtx(store);
      say('Lendo a conversa no WhatsApp');
      const list = (await kapso.messages(w.key, w.pnid, { phone: input.telefone, limit: 40 })).reverse();
      const lastIn = list.filter((m) => m.direction === 'inbound').at(-1);
      return {
        cliente: { telefone: digits(input.telefone), nome: lastIn?.name || '' },
        janela_24h_aberta: !!lastIn && Date.now() - lastIn.ts < kapso.WINDOW_MS,
        mensagens: list.map((m) => ({ de: m.direction === 'inbound' ? 'cliente' : 'empresa', texto: m.text, quando: new Date(m.ts).toISOString() })),
      };
    }
    case 'whatsapp_reply': {
      if (!can(store, agent, 'whatsapp', 'reply')) return deny('responder no WhatsApp');
      const w = waCtx(store);
      const phone = digits(input.telefone);
      if (!phone) return { error: 'Informe o telefone do cliente com DDI.' };
      const hist = await kapso.messages(w.key, w.pnid, { phone, limit: 20 });
      const lastIn = hist.find((m) => m.direction === 'inbound');
      if (!lastIn) return { error: 'Esse número nunca escreveu para a empresa: o WhatsApp só permite iniciar conversa com template aprovado. Escale para uma pessoa.' };
      if (Date.now() - lastIn.ts >= kapso.WINDOW_MS) return { error: 'A janela de 24 h do WhatsApp fechou (a última mensagem do cliente tem mais de 24 h). Só dá para responder com template aprovado: escale para uma pessoa.' };
      say(`Respondendo no WhatsApp (+${phone})`);
      const sent = await kapso.sendText(w.key, w.pnid, phone, input.text);
      await kapso.markRead(w.key, w.pnid, lastIn.id).catch(() => {});
      rt.logEvent('message', agent.id, `${agent.name} respondeu no WhatsApp (+${phone}): ${String(input.text).slice(0, 120)}`);
      return { ok: true, id: sent.id };
    }
    // ---------- Google Ads ----------
    case 'ads_report':
    case 'ads_query': {
      if (!can(store, agent, 'google_ads', 'read')) return deny('ver relatórios do Google Ads');
      const acc = adsAccount(store);
      if (!acc) return { error: 'Nenhuma conta do Google Ads foi escolhida em Integrações.' };
      const token = await googleToken(store, 'google_ads');
      say(name === 'ads_report' ? 'Puxando relatório do Google Ads' : 'Consultando o Google Ads');
      if (name === 'ads_query') return { linhas: await gads.query(token, acc, input.gaql) };
      const linhas = await gads.report(token, acc, { level: input.nivel, period: input.periodo, campaignId: input.campaign_id });
      const tot = linhas.reduce((t, r) => ({ custo: t.custo + r.custo, cliques: t.cliques + r.cliques, conversoes: t.conversoes + r.conversoes }), { custo: 0, cliques: 0, conversoes: 0 });
      return { conta: acc.name || acc.customerId, moeda: acc.currency, periodo: input.periodo || 'LAST_7_DAYS', totais: { ...tot, custo: Math.round(tot.custo * 100) / 100, custo_por_conversao: tot.conversoes ? Math.round((tot.custo / tot.conversoes) * 100) / 100 : null }, linhas };
    }
    case 'ads_campaign_status':
    case 'ads_set_budget':
    case 'ads_add_negative': {
      // só chega aqui aprovado por uma pessoa (ver o portão acima)
      if (!can(store, agent, 'google_ads', 'manage')) return deny('ajustar campanhas do Google Ads');
      const acc = adsAccount(store);
      const token = await googleToken(store, 'google_ads');
      say('Ajustando o Google Ads');
      const r = name === 'ads_campaign_status' ? await gads.setCampaignStatus(token, acc, input.campaign_id, input.status)
        : name === 'ads_set_budget' ? await gads.setDailyBudget(token, acc, input.campaign_id, input.daily_budget)
          : await gads.addNegativeKeyword(token, acc, input.campaign_id, input.keyword, input.match_type);
      rt.logEvent('system', agent.id, `Google Ads: ${{ ads_campaign_status: `campanha "${r.campanha}" ${r.agora === 'PAUSED' ? 'pausada' : 'ativada'}`, ads_set_budget: `orçamento de "${r.campanha}" de ${r.antes} para ${r.agora}/dia`, ads_add_negative: `negativa "${r.negativa}" em "${r.campanha}"` }[name]} (aprovado). Motivo: ${String(input.reason || '').slice(0, 160)}`);
      return { ok: true, ...r };
    }
    default:
      return undefined;
  }
}

// ---------------- caixas de entrada: avisa os agentes quando chega e-mail ----------------
export function startInboxPoller({ allCompanies, runtimeFor }) {
  const tick = async () => {
    for (const store of allCompanies()) {
      if (store.state.paused || store.company.onboardingStep !== 'done') continue;
      await pollResend(store, runtimeFor).catch((e) => markError(store, 'resend', e));
      await pollGmail(store, runtimeFor).catch((e) => markError(store, 'gmail', e));
      await pollCrisp(store, runtimeFor).catch((e) => markError(store, 'crisp', e));
      await pollWhatsApp(store, runtimeFor).catch((e) => markError(store, 'whatsapp', e));
    }
  };
  setInterval(tick, POLL_MS);
  setTimeout(tick, 5000);
}

function markError(store, type, e) {
  const c = conn(store, type);
  if (c && c.error !== e.message) { c.error = e.message; store.save(); }
}

async function pollResend(store, runtimeFor) {
  const c = conn(store, 'resend');
  const readers = c && store.aiAgents().filter((a) => can(store, a, 'resend', 'read'));
  if (!readers?.length) return;
  const list = await resend.listReceived(secretOf(store, 'resend'), { limit: 25 });
  const seen = new Set(c.seen || []);
  const first = !c.seen;
  c.seen = list.map((e) => e.id).concat([...seen]).slice(0, 300);
  c.error = '';
  store.save();
  if (first) return; // primeira leitura: só marca o que já existia, sem avisar
  const rt = runtimeFor(store);
  const fromAddr = c.config?.from ? addrOf(c.config.from) : null;
  for (const e of list.filter((x) => !seen.has(x.id)).reverse()) {
    if (fromAddr && addrOf(e.from) === fromAddr) continue; // resposta nossa voltando para a caixa: evita laço
    const who = readers.filter((a) => matchesInbox(e.to, allowedInboxes(store, a)));
    if (!who.length) continue;
    let cli = { email: addrOf(e.from), name: nameOfAddr(e.from), source: 'remetente' };
    try { cli = customerOf(store, await resend.getReceived(secretOf(store, 'resend'), e.id)); } catch { /* usa o remetente */ }
    for (const a of who) {
      rt.postMessage('caixa:resend', a.id, `Novo e-mail de cliente${customerNote(cli)}.\nCanal: e-mail | Caixa de destino: ${[].concat(e.to).join(', ')} | Nome do cliente: ${cli.name || '—'} | E-mail do cliente: ${cli.email || 'não identificado'}\nAssunto: "${e.subject || '(sem assunto)'}" (email_id: ${e.id}). Leia com email_read e responda com email_reply se couber a você${cli.email ? '' : ' (sem e-mail do cliente: escale)'}.`);
    }
  }
}

async function pollGmail(store, runtimeFor) {
  const c = conn(store, 'gmail');
  const readers = c && store.aiAgents().filter((a) => can(store, a, 'gmail', 'read'));
  if (!readers?.length) return;
  const list = await google.gmailSearch(await googleToken(store, 'gmail'), 'in:inbox is:unread newer_than:2d', 15);
  const seen = new Set(c.seen || []);
  const first = !c.seen;
  c.seen = list.map((m) => m.id).concat([...seen]).slice(0, 300);
  c.error = '';
  store.save();
  if (first) return;
  const rt = runtimeFor(store);
  for (const m of list.filter((x) => !seen.has(x.id)).reverse()) {
    for (const a of readers) rt.postMessage('caixa:gmail', a.id, `Novo e-mail no Gmail.\nCanal: e-mail | Caixa de destino: ${c.account} | Nome do cliente: ${nameOfAddr(m.from)} | E-mail do cliente: ${addrOf(m.from)}\nAssunto: "${m.subject || '(sem assunto)'}" (id: ${m.id}). Leia com gmail_read e trate se couber a você.`);
  }
}

// Chat do site: avisa quem atende quando o CLIENTE mandou mensagem nova (não reage às respostas do próprio agente).
async function pollCrisp(store, runtimeFor) {
  const c = conn(store, 'crisp');
  const readers = c && store.aiAgents().filter((a) => can(store, a, 'crisp', 'read'));
  if (!readers?.length) return;
  const x = crispCtx(store);
  const list = await crisp.conversations(x.cred, x.tier, x.site, { filter: 'unresolved' });
  const seen = c.seenAt || {};
  const first = !c.seenAt;
  const fresh = list.filter((cv) => cv.lastFrom === 'user' && (seen[cv.sessionId] || 0) < (cv.updatedAt || 0));
  for (const cv of list) seen[cv.sessionId] = cv.updatedAt || 0;
  c.seenAt = Object.fromEntries(Object.entries(seen).sort((a, b) => b[1] - a[1]).slice(0, 300));
  c.error = '';
  store.save();
  if (first) return;
  const rt = runtimeFor(store);
  for (const cv of fresh) {
    for (const a of readers) {
      rt.postMessage('caixa:crisp', a.id, `Nova mensagem de cliente no chat do site.\nCanal: chat | Caixa de destino: chat do site | Nome do cliente: ${cv.nickname || 'visitante'} | E-mail do cliente: ${cv.email || 'não informado'}\nMensagem: "${String(cv.lastMessage).slice(0, 200)}" (session_id: ${cv.sessionId}). Leia com chat_messages e responda com chat_reply se couber a você.`);
    }
  }
}

// WhatsApp: avisa quem atende quando o CLIENTE mandou mensagem nova (uma vez por cliente, juntando a rajada).
async function pollWhatsApp(store, runtimeFor) {
  const c = conn(store, 'whatsapp');
  const readers = c && store.aiAgents().filter((a) => can(store, a, 'whatsapp', 'read'));
  if (!readers?.length || !c.config?.phoneNumberId) return;
  const w = waCtx(store);
  const list = await kapso.messages(w.key, w.pnid, { direction: 'inbound', limit: 50 });
  const seen = new Set(c.seen || []);
  const first = !c.seen;
  c.seen = list.map((m) => m.id).concat([...seen]).slice(0, 400);
  c.error = '';
  store.save();
  if (first) return; // primeira leitura: só marca o que já existia
  const fresh = list.filter((m) => !seen.has(m.id)).reverse();
  const byPhone = new Map();
  for (const m of fresh) byPhone.set(m.phone, [...(byPhone.get(m.phone) || []), m]);
  const rt = runtimeFor(store);
  for (const [phone, msgs] of byPhone) {
    const name = msgs.find((m) => m.name)?.name || '';
    const texto = msgs.map((m) => m.text).join(' / ').slice(0, 400);
    for (const a of readers) {
      rt.postMessage('caixa:whatsapp', a.id, `Nova mensagem de cliente no WhatsApp.\nCanal: whatsapp | Caixa de destino: WhatsApp ${c.account || ''} | Nome do cliente: ${name || 'não informado'} | Telefone do cliente: +${phone}\nMensagem: "${texto}" (telefone: ${phone}). Leia com whatsapp_messages e responda com whatsapp_reply se couber a você (até 24 h depois da última mensagem do cliente).`);
    }
  }
}

// ---------------- rotas ----------------
const oauthStates = new Map(); // state -> { companyId, type, createdAt }

export function mountIntegrations(app, { requireCompany, need, wrap, runtimeFor, getCompany }) {
  const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
  const refresh = (store) => runtimeFor(store).pushSnapshot();
  const str = (v, max = 300) => String(v ?? '').trim().slice(0, max);

  app.get('/api/integrations', requireCompany, (req, res) => {
    migrate(req.company);
    res.json({ catalog: catalogPublic(), connected: publicState(req.company), redirectUri: google.REDIRECT_URI });
  });

  // Conecta integrações por token/chave (GitHub, Resend).
  app.post('/api/integrations/:type/connect', requireCompany, need('owner'), wrap(async (req, res) => {
    const def = DEF[req.params.type];
    if (!def || def.status !== 'available' || !['token', 'apikey'].includes(def.auth)) return bad(res, 'Integração inválida');
    const token = str(req.body?.token);
    const store = req.company;
    const prev = ensure(store)[def.type];
    const secret = token || decrypt(prev?.secret);
    if (!secret) return bad(res, `Cole o ${def.tokenLabel}`);
    const config = { ...(prev?.config || {}) };
    const incoming = req.body?.config || {};
    for (const f of def.configFields || []) {
      if (incoming[f.key] === undefined) continue;
      config[f.key] = f.key === 'inboxes'
        ? String(incoming.inboxes).split(/[,;\s]+/).map((s) => s.trim().toLowerCase()).filter((s) => s.includes('@')).slice(0, 20)
        : str(incoming[f.key], 200);
    }
    let account = '';
    try {
      if (def.type === 'github') account = (await github.whoami(secret)).login;
      if (def.type === 'resend') account = (await resend.verify(secret)).domains.map((d) => d.name).join(', ');
      if (def.type === 'railway') {
        const v = await railway.verify(secret, config.workspaceId || undefined);
        config.tokenKind = v.kind;
        if (v.kind === 'project') {
          // Token de projeto só enxerga um projeto/ambiente: já libera esse projeto e ignora o workspace.
          const p = v.projects[0];
          config.workspaceId = '';
          config.projects = [{ id: p.id, name: p.name }];
          account = `projeto ${p.name} (token de projeto)`;
        } else {
          account = `${v.projects.length} projeto(s) visíveis`;
        }
      }
      if (def.type === 'crisp') {
        if (!config.websiteId) return bad(res, 'Informe o Website ID do Crisp');
        config.tier = config.tier === 'plugin' ? 'plugin' : 'website';
        const w = await crisp.verify(crisp.parseToken(secret), config.tier, config.websiteId);
        account = [w.name, w.domain].filter(Boolean).join(' · ');
      }
      if (def.type === 'whatsapp') {
        const v = await kapso.verify(secret, config.phoneNumberId || undefined);
        config.phoneNumberId = v.number.id;
        config.numbers = v.numbers.map(({ id, display, name }) => ({ id, display, name })).slice(0, 20);
        account = [v.number.display, v.number.name].filter(Boolean).join(' · ');
      }
      if (def.type === 'binance') {
        const d = desk.deskConfig(config);
        // trocar de ambiente exige a chave daquele ambiente (testnet e produção têm chaves diferentes)
        if (prev?.config?.env && prev.config.env !== d.env && !token) return bad(res, 'Para trocar entre testnet e produção, cole a chave do novo ambiente.');
        config.env = d.env;
        config.pairs = d.pairs.join(', ');
        if (config.mode !== 'auto') config.mode = 'approval';
        const v = await bn.verify(d.env, bn.parseKey(secret));
        for (const p of d.pairs) await bn.symbolInfo(d.env, p).catch(() => { throw new Error(`Par ${p} não existe na Binance ${d.env === 'prod' ? '' : 'testnet'}`); });
        config.halted = prev?.config?.halted ?? (d.env === 'prod'); // em produção a mesa começa PARADA: o dono libera depois de conferir
        account = `${d.env === 'prod' ? 'Produção' : 'Testnet'} · ${v.balances.length} ativo(s) na conta${v.ipRestrict === false ? ' · chave SEM restrição de IP' : ''}`;
        if (d.env !== prev?.config?.env) delete store.state.tradingDay;
      }
    } catch (e) { return bad(res, `Não foi possível conectar: ${e.message}`); }
    ensure(store)[def.type] = { connected: true, secret: encrypt(secret), account, config, connectedAt: prev?.connectedAt || Date.now(), seen: prev?.seen };
    store.save();
    runtimeFor(store).logEvent('system', req.member.id, `${def.name} conectado${account ? ` (${account})` : ''}.`);
    refresh(store);
    res.json({ ok: true, account });
  }));

  app.put('/api/integrations/:type/config', requireCompany, need('admin'), wrap(async (req, res) => {
    const store = req.company;
    const c = conn(store, req.params.type);
    if (!c) return bad(res, 'Integração não conectada');
    if (req.params.type === 'github') {
      const wanted = Array.isArray(req.body?.repos) ? req.body.repos.map(String) : [];
      const all = await github.listRepos(decrypt(c.secret));
      c.config = { ...c.config, repos: all.filter((r) => wanted.includes(r.fullName)).slice(0, 30) };
    } else if (req.params.type === 'resend') {
      if (req.body?.from !== undefined) c.config.from = str(req.body.from, 200);
      if (req.body?.inboxes !== undefined) c.config.inboxes = String(req.body.inboxes).split(/[,;\s]+/).map((s) => s.trim().toLowerCase()).filter((s) => s.includes('@')).slice(0, 20);
    } else if (req.params.type === 'railway') {
      const wanted = Array.isArray(req.body?.projects) ? req.body.projects.map(String) : [];
      const all = await railway.listProjects(decrypt(c.secret), c.config?.workspaceId || undefined);
      c.config = { ...c.config, projects: all.filter((p) => wanted.includes(p.id)).map(({ id, name }) => ({ id, name })).slice(0, 30) };
    } else if (req.params.type === 'crisp') {
      if (req.body?.agentName !== undefined) c.config.agentName = str(req.body.agentName, 60);
    } else if (req.params.type === 'whatsapp') {
      const want = str(req.body?.phoneNumberId, 40);
      const v = await kapso.verify(decrypt(c.secret), want || undefined);
      c.config = { ...c.config, phoneNumberId: v.number.id, numbers: v.numbers.map(({ id, display, name }) => ({ id, display, name })).slice(0, 20) };
      c.account = [v.number.display, v.number.name].filter(Boolean).join(' · ');
      delete c.seen; // novo número: recomeça a marcação do que já existia
    } else if (req.params.type === 'binance') {
      // limites e modo mudam aqui; o ambiente só muda reconectando com a chave certa
      for (const k of ['pairs', 'maxOrderUsdt', 'maxRiskUsdt', 'maxDailyLossUsdt', 'maxPositions', 'mode']) if (req.body?.[k] !== undefined) c.config[k] = str(req.body[k], 200);
      const d = desk.deskConfig(c.config);
      for (const p of d.pairs) { try { await bn.symbolInfo(d.env, p); } catch { return bad(res, `Par ${p} não existe na Binance`); } }
      c.config.pairs = d.pairs.join(', ');
      c.config.mode = d.mode;
      runtimeFor(store).logEvent('system', req.member.id, `Limites da mesa atualizados: ${d.pairs.join(', ')} · até ${d.maxOrderUsdt} USDT/ordem · risco ${d.maxRiskUsdt} USDT · perda/dia ${d.maxDailyLossUsdt} USDT · ${d.maxPositions} posições · execução ${d.mode === 'auto' ? 'automática' : 'com aprovação'}.`);
    } else if (req.params.type === 'google_ads') {
      const want = str(req.body?.customerId, 20).replace(/\D/g, '');
      const list = await gads.accounts(await googleToken(store, 'google_ads'));
      const acc = list.find((a) => a.id === want && !a.manager);
      if (!acc) return bad(res, 'Conta não encontrada (ou é uma conta de administrador: escolha uma conta de anúncios).');
      c.config = { ...c.config, customerId: acc.id, loginCustomerId: acc.loginCustomerId !== acc.id ? acc.loginCustomerId : null, name: acc.name, currency: acc.currency };
    }
    store.save();
    refresh(store);
    res.json({ ok: true, config: c.config });
  }));

  app.get('/api/integrations/github/repos', requireCompany, need('admin'), wrap(async (req, res) => {
    const c = conn(req.company, 'github');
    if (!c) return bad(res, 'Conecte o GitHub primeiro');
    res.json(await github.listRepos(decrypt(c.secret)));
  }));

  app.get('/api/integrations/google_ads/accounts', requireCompany, need('admin'), wrap(async (req, res) => {
    if (!conn(req.company, 'google_ads')) return bad(res, 'Conecte o Google Ads primeiro');
    try { res.json(await gads.accounts(await googleToken(req.company, 'google_ads'))); } catch (e) { bad(res, e.message, 502); }
  }));

  // Prévia somente leitura das campanhas (cartão do Google Ads em Integrações).
  app.get('/api/integrations/google_ads/report', requireCompany, need('admin'), wrap(async (req, res) => {
    if (!conn(req.company, 'google_ads')) return bad(res, 'Conecte o Google Ads primeiro');
    const acc = adsAccount(req.company);
    if (!acc) return bad(res, 'Escolha a conta de anúncios primeiro');
    const period = ['TODAY', 'YESTERDAY', 'LAST_7_DAYS', 'LAST_30_DAYS', 'THIS_MONTH', 'LAST_MONTH'].includes(req.query.periodo) ? req.query.periodo : 'LAST_7_DAYS';
    try { res.json({ conta: acc.name || acc.customerId, moeda: acc.currency, periodo: period, linhas: await gads.report(await googleToken(req.company, 'google_ads'), acc, { level: 'campaign', period }) }); }
    catch (e) { bad(res, e.message, 502); }
  }));

  // Mesa de trading: situação (patrimônio, resultado do dia, posições, propostas) e o botão de parar.
  app.get('/api/integrations/binance/status', requireCompany, need('admin'), wrap(async (req, res) => {
    const c = conn(req.company, 'binance');
    if (!c) return bad(res, 'Conecte a Binance primeiro');
    res.json(await desk.deskStatus(req.company, { ...c, secretPlain: decrypt(c.secret) }));
  }));
  // Painel de operações: resultado real (execuções na Binance), funil da mesa e agentes.
  app.get('/api/integrations/binance/insights', requireCompany, need('admin'), wrap(async (req, res) => {
    const c = conn(req.company, 'binance');
    if (!c) return bad(res, 'Conecte a Binance primeiro');
    const days = [7, 30, 90, 0].includes(+req.query.dias) ? +req.query.dias : 30;
    res.json(await desk.deskInsights(req.company, { ...c, secretPlain: decrypt(c.secret) }, { days }));
  }));
  // Mercado dos pares da mesa (dados públicos), para o painel do escritório.
  app.get('/api/integrations/binance/market', requireCompany, wrap(async (req, res) => {
    const c = conn(req.company, 'binance');
    if (!c) return bad(res, 'Conecte a Binance primeiro', 404);
    try { res.json(await desk.deskMarket(c)); } catch (e) { bad(res, `Não consegui ler o mercado na Binance: ${e.message}`, 502); }
  }));
  // Pares disponíveis (dados públicos), para o seletor com checkbox; funciona antes de conectar.
  app.get('/api/integrations/binance/pairs', requireCompany, need('admin'), wrap(async (req, res) => {
    const env = bn.ENVS[req.query.env] ? req.query.env : (desk.deskConfig(conn(req.company, 'binance')?.config).env);
    try { res.json({ env, pairs: await bn.usdtPairs(env) }); } catch (e) { bad(res, `Não consegui buscar os pares na Binance: ${e.message}`, 502); }
  }));
  app.post('/api/integrations/binance/halt', requireCompany, need('admin'), (req, res) => {
    const store = req.company;
    const c = conn(store, 'binance');
    if (!c) return bad(res, 'Conecte a Binance primeiro');
    c.config.halted = !!req.body?.halted;
    if (!c.config.halted) {
      const miss = desk.missingLimits(desk.deskConfig(c.config));
      if (miss.length) { c.config.halted = true; return bad(res, `Defina antes os limites: ${miss.join(', ')}.`); }
    }
    store.save();
    runtimeFor(store).logEvent('system', req.member.id, c.config.halted ? `${req.member.name || 'Dono'} PAROU a mesa de trading: nenhuma compra nova até liberar.` : `${req.member.name || 'Dono'} liberou a mesa de trading.`);
    refresh(store);
    res.json({ ok: true, halted: c.config.halted });
  });

  app.get('/api/integrations/railway/projects', requireCompany, need('admin'), wrap(async (req, res) => {
    const c = conn(req.company, 'railway');
    if (!c) return bad(res, 'Conecte o Railway primeiro');
    res.json(await railway.listProjects(decrypt(c.secret), c.config?.workspaceId || undefined));
  }));

  app.delete('/api/integrations/:type', requireCompany, need('owner'), (req, res) => {
    const store = req.company;
    const def = DEF[req.params.type];
    if (!def || !ensure(store)[def.type]) return bad(res, 'Integração não conectada', 404);
    delete ensure(store)[def.type];
    for (const a of store.state.agents) if (a.access?.[def.type]) delete a.access[def.type];
    store.save();
    runtimeFor(store).logEvent('system', req.member.id, `${def.name} desconectado. Os acessos dos agentes foram removidos.`);
    refresh(store);
    res.json({ ok: true });
  });

  // Acesso de um agente a uma integração: { perms: [...], resources: [...] }
  app.put('/api/agents/:id/access/:type', requireCompany, need('admin'), (req, res) => {
    const store = req.company;
    const a = store.getAgent(req.params.id);
    const def = DEF[req.params.type];
    if (!a || a.kind === 'human' || a.kind === 'function') return bad(res, 'Agente de IA não encontrado', 404);
    if (!def || !conn(store, def.type)) return bad(res, 'Integração não conectada');
    const perms = (req.body?.perms || []).filter((p) => def.perms.some((x) => x.id === p));
    const resources = Array.isArray(req.body?.resources) ? req.body.resources.map(String).slice(0, 30) : [];
    grant(a, def.type, perms, resources);
    store.save();
    runtimeFor(store).logEvent('system', req.member.id, perms.length
      ? `${a.name} recebeu acesso ao ${def.name}: ${perms.map((p) => def.perms.find((x) => x.id === p).label.toLowerCase()).join(', ')}.`
      : `${a.name} perdeu o acesso ao ${def.name}.`);
    refresh(store);
    res.json({ ok: true, access: a.access?.[def.type] || null });
  });

  // OAuth do Google (Gmail / Agenda)
  app.get('/integrations/google/start', requireCompany, need('owner'), (req, res) => {
    const type = req.query.type;
    if (!google.SCOPES[type]) return bad(res, 'Tipo inválido');
    if (!google.configured()) return bad(res, 'Defina GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET no .env para conectar contas Google.');
    const state = randomToken();
    oauthStates.set(state, { companyId: req.company.id, type, createdAt: Date.now() });
    res.redirect(google.authUrl(type, state));
  });

  app.get('/integrations/google/callback', wrap(async (req, res) => {
    const st = oauthStates.get(req.query.state);
    oauthStates.delete(req.query.state);
    const back = (msg) => res.redirect(`${APP_URL}/?tab=integrations${msg ? `&erro=${encodeURIComponent(msg)}` : ''}`);
    if (!st || Date.now() - st.createdAt > 600000) return back('A conexão com o Google expirou. Tente de novo.');
    if (req.query.error) return back('Conexão com o Google cancelada.');
    const store = getCompany(st.companyId);
    if (!store) return back('Empresa não encontrada.');
    try {
      const tokens = await google.exchangeCode(req.query.code);
      ensure(store)[st.type] = { connected: true, secret: encrypt(JSON.stringify(tokens)), account: tokens.email, config: {}, connectedAt: Date.now() };
      store.save();
      runtimeFor(store).logEvent('system', null, `${DEF[st.type].name} conectado (${tokens.email}).`);
      if (st.type === 'google_drive') drive.schedule(store, runtimeFor(store), 500); // primeiro espelhamento
      refresh(store);
      back('');
    } catch (e) { back(e.message); }
  }));
}
