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
import * as telegram from './telegram.js';
import * as uploadpost from './uploadpost.js';
import * as imagegen from './imagegen.js';
import * as pgdb from './postgres.js';
import * as waweb from './wa-web.js';
import { mimeOf, recordWrite } from './files.js';
import fs from 'node:fs';
import path from 'node:path';

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
    type: 'postgres', name: 'PostgreSQL', category: 'Dados', icon: 'database', auth: 'token', status: 'available',
    description: 'O agente consulta o banco PostgreSQL da empresa para responder perguntas e montar relatórios: vê as tabelas e roda consultas de leitura (SELECT). O IAORG nunca grava no banco: cada consulta roda numa transação somente leitura, com até 200 linhas e 15 segundos.',
    notice: 'Importante: conecte com uma credencial SÓ DE LEITURA e acesse o banco pela VPN ou pela rede local. Nunca exponha o banco na internet para isso. O IAORG recusa superusuário e usuários com permissão de gravar em alguma tabela.',
    tokenLabel: 'URL de conexão do PostgreSQL', tokenPlaceholder: 'postgresql://iaorg_leitor:senha@10.8.0.5:5432/banco',
    tokenHelp: 'Crie um usuário só de leitura no banco: CREATE ROLE iaorg_leitor LOGIN PASSWORD \'…\'; GRANT CONNECT ON DATABASE banco TO iaorg_leitor; GRANT pg_read_all_data TO iaorg_leitor; (PostgreSQL 14 ou mais novo; nos antigos, GRANT USAGE ON SCHEMA public e GRANT SELECT ON ALL TABLES IN SCHEMA public). Com a VPN ligada na máquina que roda o IAORG, use o IP interno do banco; para um banco na própria máquina, use host.docker.internal.',
    configFields: [
      { key: 'ssl', label: 'SSL', options: [{ value: 'off', label: 'Sem SSL (rede local ou VPN)' }, { value: 'require', label: 'SSL obrigatório' }, { value: 'verify', label: 'SSL com verificação do certificado' }] },
      { key: 'schemas', label: 'Schemas que os agentes veem (opcional, separe por vírgula)', placeholder: 'Vazio = todos que o usuário enxerga' },
    ],
    perms: [{ id: 'read', label: 'Consultar (somente leitura)' }],
    suggest: ['dados', 'cto', 'backend', 'fullstack', 'ceo', 'financeiro'],
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
  {
    type: 'telegram', name: 'Telegram', category: 'Mensagens', icon: 'send', auth: 'token', status: 'available', companyWide: true,
    description: 'A Minha mesa de cada pessoa no Telegram: mensagens e perguntas dos agentes, tarefas, pedidos para aprovar, revisões, entregas e avisos. Pelo Telegram dá para responder aos agentes, dar ordens, aprovar e concluir com um toque.',
    tokenLabel: 'Token do bot do Telegram', tokenPlaceholder: '123456789:ABC…',
    tokenHelp: 'No Telegram, converse com o @BotFather, mande /newbot, escolha um nome e um usuário terminado em "bot" e copie o token. Use um bot só para esta empresa. Depois de conectar, cada pessoa vincula o próprio Telegram em Minha mesa.',
    tokenUrl: 'https://t.me/BotFather',
    perms: [],
    suggest: [],
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
    type: 'whatsapp_web', name: 'WhatsApp pessoal (QR code)', category: 'Mensagens', icon: 'smartphone', auth: 'qr', status: 'available',
    description: 'Conecta o SEU número de WhatsApp como aparelho conectado (igual ao WhatsApp Web), lendo um QR code. Você escolhe os grupos e contatos que os agentes podem ler e responder, e eles são avisados quando alguém marca você. As respostas saem do seu número e, por padrão, passam pela sua aprovação.',
    notice: 'Atenção: esta conexão não usa a API oficial do WhatsApp. O WhatsApp não permite automação em contas pessoais e pode bloquear o número. Prefira um número secundário, mantenha as respostas com aprovação e libere só os grupos e contatos necessários.',
    perms: [{ id: 'read', label: 'Ler conversas escolhidas' }, { id: 'reply', label: 'Responder' }],
    resource: { key: 'chats', label: 'Conversas' },
    suggest: ['assistente', 'ceo', 'cs', 'vendas', 'sdr'],
  },
  {
    type: 'google_ads', name: 'Google Ads', category: 'Marketing', icon: 'megaphone', auth: 'google', status: 'available',
    description: 'Relatórios de campanhas, grupos e termos de pesquisa (gasto, cliques, conversões) e ajustes: pausar/ativar, orçamento diário e palavras negativas. Toda mudança passa pela sua aprovação.',
    perms: [{ id: 'read', label: 'Ver relatórios' }, { id: 'manage', label: 'Ajustar campanhas (com aprovação)' }],
    suggest: ['marketing', 'trafego', 'ceo'],
  },
  {
    type: 'uploadpost', name: 'Redes sociais (Upload-Post)', category: 'Marketing', icon: 'share-2', auth: 'apikey', status: 'available',
    description: 'Instagram, Facebook, LinkedIn, X, Threads e TikTok numa conexão só: o agente publica e agenda posts (com imagem ou só texto), acompanha as métricas e lê e responde comentários. Por padrão, cada post e cada resposta passam pela sua aprovação em Minha mesa.',
    tokenLabel: 'API key do Upload-Post', tokenPlaceholder: 'chave da API',
    tokenHelp: 'No app.upload-post.com: crie um perfil, conecte as redes nele (Instagram precisa ser conta profissional) e gere a chave em API Keys. O plano grátis permite 10 posts por mês.',
    tokenUrl: 'https://app.upload-post.com/',
    configFields: [
      { key: 'profile', label: 'Perfil do Upload-Post (vazio = o primeiro)', placeholder: 'Nome do perfil criado no Upload-Post' },
      { key: 'facebookPageId', label: 'ID da página do Facebook (opcional)', placeholder: 'Só se houver mais de uma página conectada' },
      { key: 'linkedinPageId', label: 'ID da página da empresa no LinkedIn (opcional)', placeholder: 'Vazio = posta no perfil pessoal' },
      { key: 'mode', label: 'Publicação', options: [{ value: 'approval', label: 'Cada post e resposta passa pela minha aprovação' }, { value: 'auto', label: 'Automática: o agente publica direto' }] },
    ],
    editable: true,
    perms: [{ id: 'read', label: 'Ver posts, métricas e comentários' }, { id: 'post', label: 'Publicar e agendar posts' }, { id: 'reply', label: 'Responder comentários' }],
    suggest: ['marketing', 'social', 'conteudo', 'trafego'],
  },
  {
    type: 'openai_images', name: 'Imagens com IA (OpenAI)', category: 'Criação', icon: 'image', auth: 'apikey', status: 'available',
    description: 'O agente cria e edita imagens com o GPT Image (posts, anúncios, ilustrações, fotos de produto) a partir de uma descrição ou de imagens de referência, como o logo ou a foto do produto. As imagens vão para Arquivos; o custo é cobrado na sua conta da OpenAI.',
    tokenLabel: 'API key da OpenAI', tokenPlaceholder: 'sk-…',
    tokenHelp: 'Crie em platform.openai.com/api-keys (com créditos na conta). Os modelos GPT Image podem exigir a verificação da organização em Settings → Organization → General.',
    tokenUrl: 'https://platform.openai.com/api-keys',
    configFields: [{ key: 'model', label: 'Modelo (vazio = o mais recente disponível)', placeholder: 'Ex.: gpt-image-2.5-sunburst' }],
    editable: true,
    perms: [{ id: 'generate', label: 'Criar e editar imagens' }],
    suggest: ['marketing', 'designer', 'design', 'social', 'conteudo'],
  },
  {
    type: 'gemini_images', name: 'Imagens com IA (Gemini)', category: 'Criação', icon: 'image', auth: 'apikey', status: 'available',
    description: 'O agente cria e edita imagens com o Gemini (Nano Banana) a partir de uma descrição ou de imagens de referência, como o logo ou a foto do produto. As imagens vão para Arquivos; o custo é cobrado na sua conta do Google AI Studio.',
    tokenLabel: 'API key do Google AI Studio', tokenPlaceholder: 'AIza…',
    tokenHelp: 'Crie em aistudio.google.com/apikey. A geração de imagens exige um projeto com faturamento ativo no Google Cloud.',
    tokenUrl: 'https://aistudio.google.com/apikey',
    configFields: [{ key: 'model', label: 'Modelo (vazio = o mais recente disponível)', placeholder: 'Ex.: gemini-3.1-flash-image' }],
    editable: true,
    perms: [{ id: 'generate', label: 'Criar e editar imagens' }],
    suggest: ['marketing', 'designer', 'design', 'social', 'conteudo'],
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
// WhatsApp pessoal: conversas escolhidas pelo dono (filtradas pelo acesso do agente) + onde marcaram o dono.
function allowedWaChats(store, agent) {
  const cfg = conn(store, 'whatsapp_web')?.config || {};
  const only = access(agent, 'whatsapp_web')?.resources || [];
  const chosen = (cfg.chats || []).filter((c) => !only.length || only.includes(c.name) || only.includes(c.id));
  const mentioned = cfg.mentions === 'off' || only.length ? [] : waweb.mentionChats(store, 24).filter((id) => !chosen.some((c) => c.id === id))
    .map((id) => ({ id, name: waChatName(store, id), kind: id.endsWith('@g.us') ? 'group' : 'contact', viaMention: true }));
  return [...chosen, ...mentioned];
}
function waChatName(store, id) {
  const c = (conn(store, 'whatsapp_web')?.config?.chats || []).find((x) => x.id === id);
  if (c) return c.name;
  const last = waweb.messages(store, id, 50).filter((m) => !m.fromMe && !m.group).pop();
  return last?.name || (id.endsWith('@g.us') ? 'grupo' : `+${id.split('@')[0]}`);
}
const waOwner = (store) => (store.owner?.()?.name || 'dono').split(' ')[0];
const waWho = (store, m) => (m.fromMe ? `${waOwner(store)} (dono${m.byAgent ? ', enviada por agente' : ''})` : m.name || `+${String(m.fromAlt || m.from).split('@')[0]}`);
// Como os agentes escrevem no WhatsApp pessoal: em primeira pessoa, como o dono, ou como assistente dele.
const waAsOwner = (store) => conn(store, 'whatsapp_web')?.config?.persona === 'owner';
const crispCtx = (store) => {
  const c = conn(store, 'crisp');
  return { cred: crisp.parseToken(decrypt(c.secret)), tier: c.config?.tier || 'website', site: c.config?.websiteId, nick: c.config?.agentName || '' };
};
// ---------- redes sociais e imagens ----------
const socialProfile = (store) => {
  const cfg = conn(store, 'uploadpost')?.config || {};
  const list = cfg.profiles || [];
  return list.find((p) => p.username === cfg.profile) || list[0] || (cfg.profile ? { username: cfg.profile, accounts: {} } : null);
};
const socialNets = (p) => Object.keys(p?.accounts || {}).filter((k) => uploadpost.PLATFORMS.includes(k));
const socialLine = (p) => socialNets(p).map((k) => `${uploadpost.LABEL[k]}${p.accounts[k].name ? ` (${p.accounts[k].name})` : ''}${p.accounts[k].reauth ? ' [precisa reconectar]' : ''}`).join(', ');
const IMG_TYPES = ['openai_images', 'gemini_images'];
const imageProviders = (store, agent) => IMG_TYPES.filter((t) => can(store, agent, t, 'generate'));
const imageModel = (c) => c?.config?.model || c?.config?.autoModel || '';
const IMG_EXT = /\.(jpe?g|png|webp)$/i;
const slugify = (s, n = 50) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, n).replace(/-$/, '') || 'imagem';
const relClean = (p) => String(p || '').replace(/\\/g, '/').replace(/^\/?work\/entregas\/?/, '').replace(/^\/+/, '').trim();
const today = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });

/**
 * Resolve imagens citadas pelo agente: caminhos do arquivo da empresa. Na oficina, a imagem pode existir só no
 * container (ex.: um card feito no navegador) e chega junto em _anexos: grava no arquivo da empresa antes de usar.
 */
function resolveImages(rt, agent, list, anexos, taskHint, max) {
  const store = rt.store;
  const out = [];
  for (const raw of [].concat(list || []).slice(0, max)) {
    const rel = relClean(raw);
    if (!rel) continue;
    if (!IMG_EXT.test(rel)) return { error: `"${raw}" não é uma imagem JPG, PNG ou WEBP.` };
    let full;
    try { full = store.safePath(rel); } catch { return { error: `Caminho inválido: ${raw}` }; }
    const att = (anexos || []).find((a) => relClean(a.path) === rel);
    if (att) {
      const buf = Buffer.from(String(att.b64 || ''), 'base64');
      if (!fs.existsSync(full) || !fs.readFileSync(full).equals(buf)) {
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, buf);
        recordWrite(store, rel, { by: agent.id, task: taskHint });
        rt.emit({ type: 'files' });
        drive.schedule(store, rt);
      }
    }
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return { error: `Imagem não encontrada no arquivo da empresa: ${rel}` };
    if (fs.statSync(full).size > 15 * 1024 * 1024) return { error: `A imagem ${rel} passa de 15 MB.` };
    out.push(rel);
  }
  return { list: out };
}
const readImage = (store, rel) => ({ name: path.basename(rel), mime: mimeOf(rel), buf: fs.readFileSync(store.safePath(rel)) });

// Confere e normaliza um post ou resposta antes da aprovação (o texto fica em "text", editável na aprovação).
function prepareSocial(rt, agent, name, input, taskHint) {
  const store = rt.store;
  const prof = socialProfile(store);
  if (!prof) return { error: 'Nenhum perfil do Upload-Post encontrado. Confira a integração em Integrações.' };
  const nets = socialNets(prof);
  const text = String(input.text ?? input.texto ?? '').trim();
  if (!text) return { error: 'Escreva o texto (texto).' };
  if (name === 'social_responder') {
    const plat = String(input.plataforma || '').toLowerCase();
    if (!uploadpost.PLATFORMS.includes(plat)) return { error: `Plataforma inválida: ${input.plataforma}` };
    if (!input.comment_id && !input.post_id && !input.post_url) return { error: 'Informe comment_id (para responder um comentário) ou post_id/post_url (para comentar no post).' };
    if (plat === 'instagram' && !input.comment_id) return { error: 'No Instagram só dá para responder um comentário: informe comment_id.' };
    return { input: { plataforma: plat, comment_id: input.comment_id || undefined, post_id: input.post_id || undefined, post_url: input.post_url || undefined, comentario_original: String(input.comentario_original || '').slice(0, 1000) || undefined, text: text.slice(0, 2200) } };
  }
  const plats = [...new Set([].concat(input.plataformas || []).map((p) => String(p).toLowerCase().trim()))].filter(Boolean);
  if (!plats.length) return { error: 'Escolha as redes (plataformas).' };
  const bad = plats.filter((p) => !uploadpost.PLATFORMS.includes(p) || (nets.length && !nets.includes(p)));
  if (bad.length) return { error: `Rede não conectada no perfil ${prof.username}: ${bad.join(', ')}. Conectadas: ${nets.map((k) => uploadpost.LABEL[k]).join(', ') || 'nenhuma'}.` };
  const imgs = resolveImages(rt, agent, input.imagens, input._anexos, taskHint, 10);
  if (imgs.error) return imgs;
  if (!imgs.list.length && plats.some((p) => ['instagram', 'pinterest', 'tiktok'].includes(p))) return { error: 'Instagram, Pinterest e TikTok exigem imagem: passe pelo menos uma em imagens (gere com imagem_gerar ou use uma do arquivo da empresa).' };
  let when = null;
  if (input.agendar_para) {
    const d = new Date(input.agendar_para);
    if (Number.isNaN(+d)) return { error: 'agendar_para inválido: use o formato 2026-11-20T18:30:00 (horário de Brasília).' };
    if (+d < Date.now() + 2 * 60000) return { error: 'agendar_para precisa ser no futuro (pelo menos alguns minutos à frente). Para publicar agora, deixe vazio.' };
    if (+d > Date.now() + 360 * 86400000) return { error: 'Só dá para agendar até 1 ano à frente.' };
    when = String(input.agendar_para).trim();
  }
  return { input: { plataformas: plats, text: text.slice(0, 5000), imagens: imgs.list, agendar_para: when || undefined, story: !!input.story && plats.includes('instagram') } };
}

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
      ...(c.type === 'telegram' ? { people: telegram.linkedPeople(store) } : {}),
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
    if (c.type === 'whatsapp_web') {
      const cfg = conn(store, 'whatsapp_web').config || {};
      const chats = allowedWaChats(store, agent).filter((x) => !x.viaMention).map((x) => x.name);
      where = ` no WhatsApp pessoal do dono (${conn(store, 'whatsapp_web').account || 'número conectado'}), nas conversas: ${chats.join(', ') || '(nenhuma escolhida)'}${cfg.mentions === 'off' ? '' : ', e onde alguém marcar o dono'}. As mensagens saem do número do dono. ${waAsOwner(store)
        ? `Escreva COMO ELE, em primeira pessoa, no estilo das mensagens dele na conversa (tamanho, tom, gírias, emojis); não diga que é assistente nem IA. Antes de responder, leia o histórico (wa_mensagens) e continue a conversa de onde parou. Se a resposta depender de algo que só ele sabe (compromisso, valor, prazo, opinião), pergunte a ele antes (send_message) com sua sugestão de resposta`
        : 'Escreva como assistente dele, curto e educado; nunca fale por ele sobre compromissos, dinheiro ou opiniões sem ele ter dito'}${cfg.mode === 'auto' ? '' : '; cada resposta vai para aprovação dele antes de sair'}`;
    }
    if (c.type === 'postgres') where = ` no banco ${conn(store, 'postgres').account || ''} (somente leitura: db_schema para ver as tabelas, db_query para consultar; prefira agregações e não exponha dados pessoais sem necessidade)`;
    if (c.type === 'whatsapp') where = ` no número ${conn(store, 'whatsapp').account || ''} (texto livre só até 24 h após a última mensagem do cliente)`;
    if (c.type === 'google_ads') { const cfg = conn(store, 'google_ads').config || {}; where = cfg.customerId ? ` na conta ${cfg.name || cfg.customerId} (moeda ${cfg.currency || '?'}); mudanças vão para aprovação de uma pessoa` : ' (nenhuma conta escolhida ainda)'; }
    if (c.type === 'binance') where = desk.accessLine(desk.deskConfig(conn(store, 'binance').config));
    if (c.type === 'uploadpost') { const p = socialProfile(store); where = ` no perfil "${p?.username || '?'}": ${socialLine(p) || 'nenhuma rede conectada'}${conn(store, 'uploadpost').config?.mode === 'auto' ? '; publica direto' : '; posts e respostas vão para aprovação de uma pessoa antes de sair'}`; }
    if (IMG_TYPES.includes(c.type)) where = ` (modelo ${imageModel(conn(store, c.type)) || 'automático'}; ferramenta imagem_gerar, salva em Arquivos)`;
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
  if (can(store, agent, 'whatsapp_web', 'read')) {
    tools.push(
      T('wa_conversas', 'Lista as conversas do WhatsApp pessoal do dono que você pode ler (grupos e contatos escolhidos, e onde marcaram o dono), com a última mensagem de cada uma. Com "desde", mostra quantas mensagens novas cada uma tem depois dessa hora.', { desde: S('Opcional: data e hora ISO') }),
      T('wa_mensagens', 'Lê as mensagens de uma conversa do WhatsApp pessoal (mais antigas primeiro). Sem "desde": as últimas. Com "desde": as que chegaram depois dessa hora, em páginas (use proxima_pagina_desde para continuar). Cada mensagem tem um id para citar na resposta.', {
        conversa: S('id da conversa (de wa_conversas)'), limit: { type: 'number', description: 'Quantas (padrão 30, até 80 por página)' },
        desde: S('Opcional: data e hora ISO (ex.: 2026-11-24T18:00:00-03:00) para ler só o que chegou depois'),
      }, ['conversa']),
    );
  }
  if (can(store, agent, 'whatsapp_web', 'reply')) {
    tools.push(T('wa_responder', 'Envia uma mensagem de texto numa conversa do WhatsApp pessoal do dono (sai do número dele). Use reply_to para responder a uma mensagem específica, como quando marcaram o dono num grupo.', {
      conversa: S('id da conversa'), text: S('Mensagem: curta, natural, sem markdown'), reply_to: S('Opcional: id da mensagem a citar'),
    }, ['conversa', 'text']));
  }
  if (can(store, agent, 'postgres', 'read')) {
    tools.push(
      T('db_schema', 'Mostra a estrutura do banco PostgreSQL da empresa: sem table, lista as tabelas e views (com estimativa de linhas); com table, as colunas e os tipos. Use antes de escrever consultas.', { table: S('Opcional: tabela, ex.: public.pedidos') }),
      T('db_query', 'Roda uma consulta SOMENTE LEITURA (SELECT, WITH, EXPLAIN, SHOW) no PostgreSQL da empresa: um comando por vez, até 200 linhas e 15 s. Prefira agregações (count, sum, group by) a puxar linhas cruas.', {
        sql: S('Consulta SQL de leitura'),
        limit: { type: 'number', description: 'Máximo de linhas (padrão 100, até 200)' },
      }, ['sql']),
    );
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
  const imgs = imageProviders(store, agent);
  if (imgs.length) {
    tools.push(T('imagem_gerar', `Cria uma imagem com IA (${imgs.map((t) => DEF[t].name.replace('Imagens com IA ', '').replace(/[()]/g, '')).join(' ou ')}) e salva no arquivo da empresa. Descreva em detalhes: assunto, composição, estilo, luz, cores da marca e, se tiver texto na arte, o texto exato entre aspas (curto). Para editar uma imagem ou criar a partir de fotos reais (produto, logo, pessoa), passe-as em referencias. Devolve o caminho do arquivo; confira o resultado antes de usar.`, {
      descricao: S('Descrição detalhada da imagem (ou da edição, quando houver referências)'),
      formato: { type: 'string', enum: Object.keys(imagegen.FORMATS), description: Object.entries(imagegen.FORMATS).map(([k, f]) => `${k} = ${f.label}`).join('; ') },
      referencias: { type: 'array', items: { type: 'string' }, description: 'Opcional: até 4 imagens do arquivo da empresa usadas como base ou referência' },
      caminho: S('Opcional: onde salvar, ex.: Marketing/Posts/2026-11-20-lancamento.jpg (padrão: Marketing/Imagens/)'),
      ...(imgs.length > 1 ? { provedor: { type: 'string', enum: ['openai', 'gemini'], description: 'Qual IA usar (padrão: openai)' } } : {}),
    }, ['descricao']));
  }
  if (can(store, agent, 'uploadpost', 'read')) {
    const NET = { type: 'string', enum: uploadpost.PLATFORMS };
    tools.push(
      T('social_contas', 'Mostra as redes sociais conectadas (Instagram, Facebook, LinkedIn...) e quantos posts restam no plano.'),
      T('social_metricas', 'Métricas das contas: seguidores, alcance, impressões, visualizações, curtidas, comentários, salvamentos e a série diária de alcance.', { plataformas: { type: 'array', items: NET, description: 'Redes a consultar' }, dias: { type: 'number', description: 'Só Facebook: janela em dias (padrão 30)' } }, ['plataformas']),
      T('social_posts', 'Lista os posts recentes de uma rede (id, legenda, link e data), inclusive os que não foram feitos pelo IAORG.', { plataforma: NET, limite: { type: 'number', description: 'Padrão 12, máx. 50' } }, ['plataforma']),
      T('social_metricas_post', 'Métricas de um post: curtidas, comentários, alcance, visualizações, salvamentos. Use post_id (id do post na rede, de social_posts) ou request_id (de um post publicado pelo IAORG).', { plataforma: NET, post_id: S('id do post na rede'), request_id: S('request_id devolvido ao publicar') }, ['plataforma']),
      T('social_comentarios', 'Lê os comentários de um post (ou as respostas de um comentário, com comment_id).', { plataforma: NET, post_id: S('id do post na rede'), post_url: S('ou o link do post'), comment_id: S('Opcional: para ver as respostas deste comentário') }, ['plataforma']),
      T('social_historico', 'Histórico do que foi publicado/agendado pela integração, com o status de cada rede. Com request_id ou job_id, mostra o status de uma publicação.', { request_id: S('Opcional'), job_id: S('Opcional: id de um post agendado') }),
    );
  }
  if (can(store, agent, 'uploadpost', 'post')) {
    tools.push(T('social_publicar', 'Publica ou agenda um post nas redes sociais. Instagram exige imagem (até 10 = carrossel). Escreva o texto pronto para publicar, com hashtags no fim quando fizer sentido. Por padrão vai para aprovação de uma pessoa antes de sair.', {
      plataformas: { type: 'array', items: { type: 'string', enum: uploadpost.PLATFORMS }, description: 'Redes onde publicar' },
      texto: S('Legenda/texto do post'),
      imagens: { type: 'array', items: { type: 'string' }, description: 'Caminhos das imagens no arquivo da empresa (vazio = post só de texto, não vale para Instagram)' },
      agendar_para: S('Opcional: data e hora no horário de Brasília, ex.: 2026-11-20T18:30:00. Vazio = publicar agora'),
      story: { type: 'boolean', description: 'Instagram: publicar como story em vez de post no feed' },
    }, ['plataformas', 'texto']));
  }
  if (can(store, agent, 'uploadpost', 'reply')) {
    tools.push(T('social_responder', 'Responde um comentário (comment_id) ou comenta num post (post_id/post_url). No Instagram, só respostas a comentários. Por padrão vai para aprovação.', {
      plataforma: { type: 'string', enum: uploadpost.PLATFORMS }, comment_id: S('id do comentário a responder'), post_id: S('id do post (obrigatório no TikTok)'), post_url: S('ou o link do post'),
      texto: S('Texto da resposta'), comentario_original: S('O texto do comentário que está respondendo (aparece para quem aprova)'),
    }, ['plataforma', 'texto']));
  }
  return tools;
}

const mask = (v) => { const s = String(v ?? ''); return s.length <= 6 ? '••••' : `${s.slice(0, 2)}••••${s.slice(-2)}`; };

const deny = (what) => ({ error: `Você não tem acesso para ${what}. Peça ao dono da empresa para liberar na aba Integrações.` });

// ---------------- fila de aprovação ----------------
// Ferramentas que falam com clientes. No modo "rascunho para aprovação" elas viram um item
// na fila (Minha mesa) e só são executadas quando uma pessoa aprova.
const OUTBOUND = { email_reply: 'email', email_send: 'email', gmail_send: 'email', chat_reply: 'chat', whatsapp_reply: 'whatsapp', wa_responder: 'whatsapp' };
// Mudanças que mexem em dinheiro: SEMPRE passam por uma pessoa (não dependem do modo de envio).
const ADS_CHANGES = new Set(['ads_campaign_status', 'ads_set_budget', 'ads_add_negative']);
// Publicações em redes sociais: aprovação de uma pessoa, a não ser que a empresa escolha "automática".
const SOCIAL_OUT = { social_publicar: 'post', social_responder: 'reply' };
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
    if (name === 'wa_responder') {
      const msgs = waweb.messages(store, input.conversa, 8);
      const quoted = input.reply_to ? msgs.find((m) => m.id === input.reply_to) : null;
      return {
        para: `${waChatName(store, input.conversa)}${input.conversa.endsWith('@g.us') ? ' (grupo)' : ''} · WhatsApp pessoal`,
        assunto: quoted ? `respondendo a ${waWho(store, quoted)}: "${quoted.text.slice(0, 120)}"` : undefined,
        conversa: msgs.map((m) => `${waWho(store, m)}: ${m.text}`).join('\n').slice(0, 1500),
      };
    }
    if (name === 'social_publicar') {
      const p = socialProfile(store);
      const fmt = (s) => new Date(s).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
      return {
        para: input.plataformas.map((k) => `${uploadpost.LABEL[k]}${p?.accounts?.[k]?.name ? ` (${p.accounts[k].name})` : ''}`).join(', '),
        assunto: `${input.story ? 'Story' : input.imagens.length > 1 ? `Carrossel com ${input.imagens.length} imagens` : input.imagens.length ? 'Post com imagem' : 'Post de texto'} · ${input.agendar_para ? `agendado para ${fmt(input.agendar_para)}` : 'publicar ao aprovar'}`,
        imagens: input.imagens,
      };
    }
    if (name === 'social_responder') {
      return { para: `Comentário no ${uploadpost.LABEL[input.plataforma] || input.plataforma}`, assunto: input.comment_id ? 'resposta a um comentário' : 'comentário no post', ...(input.comentario_original ? { conversa: `Comentário: ${input.comentario_original}` } : {}) };
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
    id: uid('ap'), ts: Date.now(), status: 'pending', agentId: agent.id, tool: name, channel: OUTBOUND[name] || (ADS_CHANGES.has(name) ? 'ads' : SOCIAL_OUT[name] ? 'social' : 'outro'),
    input, text: adsText ? `${adsText()}\nMotivo: ${input.reason || '—'}` : String(input.text || ''), preview: await previewOf(store, name, input),
    readOnlyText: !!adsText,
  };
  (store.state.approvals ||= []).push(item);
  if (store.state.approvals.length > 300) store.state.approvals.splice(0, store.state.approvals.length - 300);
  store.save();
  const what = { chat: 'uma resposta no chat', email: 'um e-mail', whatsapp: 'uma resposta no WhatsApp', ads: 'uma mudança no Google Ads', social: name === 'social_publicar' ? 'um post nas redes sociais' : 'uma resposta nas redes sociais' }[item.channel] || 'uma ação';
  rt.logEvent('task', agent.id, `${agent.name} pediu aprovação de ${what}${item.preview.para ? ` — ${item.preview.para}` : ''}`);
  for (const p of store.state.agents.filter((a) => a.kind === 'human' && ['owner', 'admin'].includes(a.appRole))) {
    rt.emit({ type: 'notify', to: p.id, text: `${agent.name} pediu aprovação de ${what}` });
  }
  rt.pushSnapshot();
  if (item.channel === 'social') return { ok: true, aguardando_aprovacao: true, aprovacao_id: item.id, aviso: 'Foi para aprovação de uma pessoa (Minha mesa) e só sai depois de aprovado; quem aprova pode editar o texto. Não repita o pedido.' };
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
  if (name === 'wa_responder' && !opts.approved) {
    // Valida antes de virar rascunho: só conversas liberadas, e o WhatsApp precisa estar ligado.
    if (!can(store, agent, 'whatsapp_web', 'reply')) return deny('responder no WhatsApp pessoal');
    if (!allowedWaChats(store, agent).some((c) => c.id === input.conversa)) return { error: `Conversa fora do seu acesso: ${input.conversa}. Use wa_conversas para ver as liberadas.` };
    if (!String(input.text || '').trim()) return { error: 'Escreva a mensagem (text).' };
    if (conn(store, 'whatsapp_web').config?.mode !== 'auto') return queueApproval(rt, agent, name, input);
  }
  const channel = OUTBOUND[name];
  if (channel && !opts.approved) {
    const perm = { email_reply: ['resend', 'send'], email_send: ['resend', 'send'], gmail_send: ['gmail', 'send'], chat_reply: ['crisp', 'reply'], whatsapp_reply: ['whatsapp', 'reply'], wa_responder: ['whatsapp_web', 'reply'] }[name];
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
  if (name === 'imagem_gerar') {
    try { return await generateImage(rt, agent, input, taskHint, opts); } catch (e) { return { error: e.message }; }
  }
  if (name.startsWith('social_')) {
    try { return await socialTool(rt, agent, name, input, taskHint, opts); } catch (e) { return { error: e.message }; }
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
    case 'wa_conversas': {
      if (!can(store, agent, 'whatsapp_web', 'read')) return deny('ler o WhatsApp pessoal');
      const st = waweb.status(store);
      const list = allowedWaChats(store, agent).map((c) => {
        const last = waweb.messages(store, c.id, 30);
        const m = last[last.length - 1];
        const pend = last.filter((x) => (x.mentionsMe || x.repliesToMe) && !last.some((y) => y.fromMe && y.ts > x.ts));
        return { conversa: c.id, nome: c.name, tipo: c.kind === 'group' ? 'grupo' : 'contato', ...(c.viaMention ? { motivo: 'marcaram o dono aqui' } : {}),
          ultima: m ? `${waWho(store, m)}: ${m.text.slice(0, 160)}` : '(nada guardado ainda)', quando: m ? new Date(m.ts).toISOString() : null,
          mencoes_sem_resposta: pend.map((x) => ({ id: x.id, de: waWho(store, x), texto: x.text.slice(0, 200) })) };
      });
      const since = input.desde ? Date.parse(input.desde) : 0;
      const novas = since ? waweb.newSince(store, since) : null;
      return { conectado: st.status === 'open', conversas: since ? list.map((x) => ({ ...x, novas_desde: novas[x.conversa] || 0 })) : list };
    }
    case 'wa_mensagens': {
      if (!can(store, agent, 'whatsapp_web', 'read')) return deny('ler o WhatsApp pessoal');
      if (!allowedWaChats(store, agent).some((c) => c.id === input.conversa)) return { error: `Conversa fora do seu acesso: ${input.conversa}. Use wa_conversas.` };
      say('Lendo o WhatsApp');
      const since = input.desde ? Date.parse(input.desde) : 0;
      if (input.desde && !since) return { error: 'Data inválida em "desde": use ISO, ex.: 2026-11-24T18:00:00-03:00.' };
      const n = Math.min(Math.max(+input.limit || 30, 1), 80);
      const page = waweb.messages(store, input.conversa, since ? n + 1 : n, since);
      const more = since && page.length > n;
      const list = more ? page.slice(0, n) : page;
      return {
        conversa: waChatName(store, input.conversa),
        mensagens: list.map((m) => ({
          id: m.id, de: waWho(store, m), texto: m.text.slice(0, 600), quando: new Date(m.ts).toISOString(), ...(m.mentionsMe ? { marcou_o_dono: true } : {}), ...(m.repliesToMe ? { respondeu_o_dono: true } : {}),
        })),
        ...(more ? { proxima_pagina_desde: new Date(list[list.length - 1].ts).toISOString() } : {}),
      };
    }
    case 'wa_responder': {
      if (!can(store, agent, 'whatsapp_web', 'reply')) return deny('responder no WhatsApp pessoal');
      // Respondendo como o dono, não há prefixo (a mensagem é dele).
      const prefix = waAsOwner(store) ? '' : conn(store, 'whatsapp_web').config?.prefix ?? '';
      say('Respondendo no WhatsApp');
      try {
        const r = await waweb.send(store, input.conversa, `${prefix}${String(input.text).trim()}`, input.reply_to);
        rt.logEvent('system', agent.id, `${agent.name} respondeu no WhatsApp pessoal (${waChatName(store, input.conversa)}).`);
        return { ok: true, enviado: true, id: r.id };
      } catch (e) { return { error: `WhatsApp: ${e.message}` }; }
    }
    case 'db_schema':
    case 'db_query': {
      if (!can(store, agent, 'postgres', 'read')) return deny('consultar o banco de dados');
      const c = conn(store, 'postgres');
      const url = decrypt(c.secret);
      const schemas = String(c.config?.schemas || '').split(/[,;\s]+/).filter(Boolean);
      try {
        if (name === 'db_schema') { say('Lendo a estrutura do banco'); return await pgdb.schema(url, c.config?.ssl, { schemas, table: input.table }); }
        say('Consultando o banco de dados');
        return await pgdb.query(url, c.config?.ssl, input.sql, input.limit);
      } catch (e) { return { error: `PostgreSQL: ${e.message}` }; }
    }
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

// ---------------- imagens com IA ----------------
async function generateImage(rt, agent, input, taskHint, opts) {
  const store = rt.store;
  const provs = imageProviders(store, agent);
  if (!provs.length) return deny('criar imagens');
  const want = input.provedor === 'gemini' ? 'gemini_images' : input.provedor === 'openai' ? 'openai_images' : null;
  const type = want && provs.includes(want) ? want : provs[0];
  const provider = type === 'openai_images' ? 'openai' : 'gemini';
  const c = conn(store, type);
  const prompt = String(input.descricao || '').trim();
  if (!prompt) return { error: 'Descreva a imagem (descricao).' };
  const refs = resolveImages(rt, agent, input.referencias, input._anexos, taskHint, 4);
  if (refs.error) return refs;
  const format = imagegen.FORMATS[input.formato] ? input.formato : 'quadrado';
  rt.setStatus(agent.id, { status: 'working', bubble: `Criando imagem: ${prompt.slice(0, 70)}` });
  const img = await imagegen.generate(provider, secretOf(store, type), { model: imageModel(c), prompt, format, refs: refs.list.map((r) => readImage(store, r)) });
  const ext = imagegen.extOf(img.mime);
  let rel = relClean(input.caminho);
  rel = rel ? rel.replace(/\.[a-z0-9]+$/i, '') : `Marketing/Imagens/${today()}-${slugify(prompt)}`;
  rel = rel.split('/').map((s) => s.replace(/[\\:*?"<>|\u0000-\u001f]/g, '').trim()).filter(Boolean).join('/');
  let final = `${rel}.${ext}`;
  for (let n = 2; fs.existsSync(store.safePath(final)); n++) final = `${rel}-${n}.${ext}`;
  const full = store.safePath(final);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, img.buf);
  recordWrite(store, final, { by: agent.id, task: taskHint });
  (store.state.imageLog ||= []).push({ ts: Date.now(), agentId: agent.id, provider, model: img.model, path: final, task: taskHint || null });
  if (store.state.imageLog.length > 500) store.state.imageLog.splice(0, store.state.imageLog.length - 500);
  store.save();
  rt.emit({ type: 'files' });
  drive.schedule(store, rt);
  rt.logEvent('file', agent.id, `${agent.name} criou uma imagem com IA: ${final}`);
  return {
    ok: true, arquivo: final, provedor: provider, modelo: img.model, formato: format, bytes: img.buf.length,
    ...(img.revisedPrompt ? { descricao_usada: img.revisedPrompt } : {}),
    aviso: opts.fromJob ? `Salva em Arquivos e em /work/entregas/${final}. Confira a imagem (texto legível, sem erros, cores da marca) antes de usar; se não ficou boa, gere de novo ajustando a descrição.` : 'Salva em Arquivos. Use o caminho em social_publicar para postar.',
    ...(opts.fromJob ? { _salvar: [{ path: final, b64: img.buf.toString('base64'), mime: img.mime }] } : {}),
  };
}

// ---------------- redes sociais (Upload-Post) ----------------
async function socialTool(rt, agent, name, input, taskHint, opts) {
  const store = rt.store;
  const c = conn(store, 'uploadpost');
  const need = SOCIAL_OUT[name] || 'read';
  if (!can(store, agent, 'uploadpost', need)) return deny({ read: 'ver as redes sociais', post: 'publicar nas redes sociais', reply: 'responder comentários nas redes sociais' }[need]);
  const key = secretOf(store, 'uploadpost');
  const prof = socialProfile(store);
  const user = prof?.username;
  if (!user) return { error: 'Nenhum perfil do Upload-Post encontrado. Confira a integração em Integrações.' };
  const say = (bubble) => rt.setStatus(agent.id, { status: 'working', bubble });
  const net = (p) => String(p || '').toLowerCase();

  if (SOCIAL_OUT[name] && !opts.approved) {
    const prep = prepareSocial(rt, agent, name, input, taskHint);
    if (prep.error) return prep;
    if (opts.forceApproval || c.config?.mode !== 'auto') return queueApproval(rt, agent, name, prep.input);
    input = prep.input;
  }

  switch (name) {
    case 'social_contas': {
      say('Conferindo as redes sociais');
      const [profiles, me] = await Promise.all([uploadpost.listProfiles(key), uploadpost.verify(key).catch(() => ({}))]);
      const p = profiles.find((x) => x.username === user) || prof;
      return { perfil: user, redes: socialNets(p).map((k) => ({ rede: k, conta: p.accounts[k].name || p.accounts[k].handle || '', precisa_reconectar: p.accounts[k].reauth })), plano: me.plan || undefined, publicacao: c.config?.mode === 'auto' ? 'automática' : 'com aprovação de uma pessoa' };
    }
    case 'social_metricas': {
      const plats = [].concat(input.plataformas || []).map(net).filter((p) => uploadpost.PLATFORMS.includes(p));
      if (!plats.length) return { error: 'Informe as redes (plataformas).' };
      say(`Métricas: ${plats.map((p) => uploadpost.LABEL[p]).join(', ')}`);
      return await uploadpost.analytics(key, user, { platforms: plats, facebookPageId: c.config?.facebookPageId, linkedinPageUrn: c.config?.linkedinPageId ? `urn:li:organization:${c.config.linkedinPageId}` : undefined, days: input.dias });
    }
    case 'social_posts': {
      say(`Lendo os posts do ${uploadpost.LABEL[net(input.plataforma)] || input.plataforma}`);
      const d = await uploadpost.media(key, user, { platform: net(input.plataforma), limit: Math.min(50, +input.limite || 12), linkedinPageUrn: c.config?.linkedinPageId ? `urn:li:organization:${c.config.linkedinPageId}` : undefined });
      const items = d.media || d.data || d.items || d.posts || [];
      return { posts: items.map(({ media_url, thumbnail_url, ...m }) => m) };
    }
    case 'social_metricas_post': {
      if (!input.post_id && !input.request_id) return { error: 'Informe post_id ou request_id.' };
      say('Lendo as métricas do post');
      return await uploadpost.postAnalytics(key, user, { platform: net(input.plataforma), postId: input.post_id, requestId: input.request_id });
    }
    case 'social_comentarios': {
      if (!input.post_id && !input.post_url) return { error: 'Informe post_id ou post_url.' };
      say('Lendo comentários');
      return await uploadpost.comments(key, user, { platform: net(input.plataforma), postId: input.post_id, postUrl: input.post_url, commentId: input.comment_id });
    }
    case 'social_historico': {
      say('Conferindo as publicações');
      if (input.request_id || input.job_id) return await uploadpost.status(key, { requestId: input.request_id, jobId: input.job_id });
      const d = await uploadpost.history(key, { limit: 20 });
      return { historico: d.history || d.data || d.items || d, publicados_pelo_iaorg: (store.state.socialLog || []).slice(-15) };
    }
    case 'social_publicar': {
      say(`Publicando em ${input.plataformas.map((p) => uploadpost.LABEL[p]).join(', ')}`);
      const r = await uploadpost.publish(key, {
        user, platforms: input.plataformas, text: input.text, images: input.imagens.map((p) => readImage(store, p)), scheduledDate: input.agendar_para,
        facebookPageId: c.config?.facebookPageId || undefined, linkedinPageId: c.config?.linkedinPageId || undefined, stories: input.story,
      });
      (store.state.socialLog ||= []).push({ ts: Date.now(), agentId: agent.id, redes: input.plataformas, texto: input.text.slice(0, 200), imagens: input.imagens, agendado: input.agendar_para || null, request_id: r.request_id, job_id: r.job_id, links: Object.fromEntries(Object.entries(r.resultados).map(([k, v]) => [k, v.url])) });
      if (store.state.socialLog.length > 300) store.state.socialLog.splice(0, store.state.socialLog.length - 300);
      store.save();
      const links = Object.entries(r.resultados).filter(([, v]) => v.url).map(([k, v]) => `${uploadpost.LABEL[k] || k}: ${v.url}`);
      const fails = Object.entries(r.resultados).filter(([, v]) => !v.ok).map(([k, v]) => `${uploadpost.LABEL[k] || k} (${v.erro || 'falhou'})`);
      rt.logEvent('message', agent.id, r.agendado
        ? `${agent.name} agendou um post em ${input.plataformas.map((p) => uploadpost.LABEL[p]).join(', ')} para ${input.agendar_para}`
        : `${agent.name} publicou nas redes sociais${links.length ? `: ${links.join(' · ')}` : ''}${fails.length ? ` · falhou: ${fails.join(', ')}` : ''}`, links[0] ? { url: links[0].split(': ')[1] } : undefined);
      return { ok: !fails.length, ...r };
    }
    case 'social_responder': {
      say(`Respondendo no ${uploadpost.LABEL[input.plataforma]}`);
      const r = await uploadpost.reply(key, user, { platform: input.plataforma, commentId: input.comment_id, postId: input.post_id, postUrl: input.post_url, message: input.text });
      rt.logEvent('message', agent.id, `${agent.name} respondeu um comentário no ${uploadpost.LABEL[input.plataforma]}: ${String(input.text).slice(0, 120)}`);
      return { ok: true, id: r.id || null };
    }
    default:
      return undefined;
  }
}

// ---------------- caixas de entrada: avisa os agentes quando chega e-mail ----------------
// ---------- WhatsApp pessoal: avisos aos agentes ----------
let waRuntimeFor = null;
const waPending = new Map(); // `${companyId}|${chat}` -> { timer, msgs }
const waHooks = {
  onStatus(store, st) {
    const c = ensure(store).whatsapp_web;
    if (!c) return;
    if (st.status === 'open' && st.me) { c.account = `${st.me.name ? `${st.me.name} · ` : ''}+${st.me.phone}`; c.error = ''; }
    else if (st.error) c.error = st.error;
    store.save();
    try { waRuntimeFor?.(store).pushSnapshot(); } catch { /* sem runtime ainda */ }
  },
  onMessage(store, m) {
    if (!waRuntimeFor || store.state.paused || store.company?.onboardingStep !== 'done') return;
    const cfg = conn(store, 'whatsapp_web')?.config || {};
    const chosen = (cfg.chats || []).find((c) => c.id === m.chat || c.id === m.chatAlt);
    const marked = m.mentionsMe || m.repliesToMe;
    // Contato escolhido: toda mensagem. Grupo escolhido: só quando marcam você, a não ser que o gatilho seja "todas".
    const wake = chosen ? (!m.group || chosen.trigger === 'all' || marked) : (cfg.mentions !== 'off' && marked);
    if (!wake) return;
    const key = `${store.id}|${m.chat}`;
    const p = waPending.get(key) || { msgs: [] };
    p.msgs.push(m);
    clearTimeout(p.timer);
    // Junta mensagens seguidas (até 20 s) num aviso só, para não acordar o agente a cada linha.
    p.timer = setTimeout(() => { waPending.delete(key); notifyWa(store, m.chat, p.msgs, !!chosen); }, marked ? 5000 : 20000);
    waPending.set(key, p);
  },
};
function notifyWa(store, chat, msgs, chosen) {
  const rt = waRuntimeFor(store);
  const name = waChatName(store, chat);
  const readers = store.aiAgents().filter((a) => can(store, a, 'whatsapp_web', 'read') && allowedWaChats(store, a).some((c) => c.id === chat));
  const marked = msgs.filter((x) => x.mentionsMe || x.repliesToMe);
  const lines = msgs.slice(-6).map((x) => `${waWho(store, x)}${x.mentionsMe ? ' (marcou o dono)' : x.repliesToMe ? ' (respondeu o dono)' : ''}: "${x.text.slice(0, 300)}" [id ${x.id}]`).join('\n');
  const how = waAsOwner(store)
    ? `Leia o histórico com wa_mensagens (no mínimo as últimas 20) para entender o assunto e o jeito do ${waOwner(store)} escrever, e continue a conversa respondendo como ele, em primeira pessoa, com wa_responder (reply_to com o id quando for resposta a uma mensagem específica). Se a resposta depender de algo que só ele sabe, pergunte a ele antes com send_message, já com a resposta que você sugere. Se não houver nada a responder (ex.: "ok", figurinha, conversa entre outras pessoas), não responda.`
    : 'Leia mais com wa_mensagens se precisar. Responda com wa_responder (use reply_to com o id da mensagem) só se fizer sentido e couber a você; se for algo que só o dono pode decidir, avise o dono em vez de responder.';
  for (const a of readers) {
    rt.postMessage('caixa:whatsapp_web', a.id, `${marked.length ? 'Marcaram o dono' : 'Nova mensagem'} no WhatsApp pessoal dele, ${chat.endsWith('@g.us') ? `no grupo "${name}"` : `na conversa com ${name}`}${chosen ? '' : ' (conversa não escolhida: só responda à menção)'}.\nconversa: ${chat}\n${lines}\n${how}`);
  }
}

export function startInboxPoller({ allCompanies, runtimeFor }) {
  waRuntimeFor = runtimeFor;
  // Retoma as sessões do WhatsApp pessoal já conectadas (a sessão fica salva em disco).
  setTimeout(() => {
    for (const store of allCompanies()) if (conn(store, 'whatsapp_web')) waweb.start(store, waHooks).catch((e) => markError(store, 'whatsapp_web', e));
  }, 3000);
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

// Valida a chave e descobre o que ela enxerga (perfis e redes do Upload-Post; modelos de imagem). Ajusta config.
async function refreshDiscovery(type, secret, config) {
  if (type === 'uploadpost') {
    const v = await uploadpost.verify(secret);
    if (!v.profiles.length) throw new Error('Nenhum perfil no Upload-Post. Crie um perfil e conecte as redes em app.upload-post.com.');
    config.profiles = v.profiles.slice(0, 20);
    if (config.profile && !v.profiles.some((p) => p.username === config.profile)) throw new Error(`Perfil "${config.profile}" não existe. Perfis: ${v.profiles.map((p) => p.username).join(', ')}.`);
    config.mode = config.mode === 'auto' ? 'auto' : 'approval';
    const p = v.profiles.find((x) => x.username === config.profile) || v.profiles[0];
    return `${p.username} · ${socialLine(p) || 'nenhuma rede conectada'}`;
  }
  const v = type === 'openai_images' ? await imagegen.openaiVerify(secret) : await imagegen.geminiVerify(secret);
  if (config.model && !v.models.includes(config.model)) throw new Error(`Modelo "${config.model}" não disponível nesta chave. Disponíveis: ${v.models.join(', ')}.`);
  config.models = v.models.slice(0, 30);
  config.autoModel = v.model;
  return `modelo ${config.model || v.model}`;
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
      if (def.type === 'postgres') {
        const d = pgdb.describe(secret);
        config.ssl = ['require', 'verify'].includes(config.ssl) ? config.ssl : 'off';
        const v = await pgdb.verify(secret, config.ssl);
        if (v.superuser) return bad(res, `O usuário ${v.user} é superusuário. Crie um usuário só de leitura (veja as instruções abaixo do campo) e conecte com ele.`);
        if (v.writable.length) return bad(res, `O usuário ${v.user} pode gravar em ${v.writable.join(', ')}${v.writable.length === 5 ? ' e outras' : ''}. Use uma credencial só de leitura.`);
        config.allSchemas = v.schemas.slice(0, 50);
        account = `${d.user}@${d.host}:${d.port}/${v.database} · PostgreSQL ${v.version}`;
      }
      if (def.type === 'whatsapp') {
        const v = await kapso.verify(secret, config.phoneNumberId || undefined);
        config.phoneNumberId = v.number.id;
        config.numbers = v.numbers.map(({ id, display, name }) => ({ id, display, name })).slice(0, 20);
        account = [v.number.display, v.number.name].filter(Boolean).join(' · ');
      }
      if (['uploadpost', 'openai_images', 'gemini_images'].includes(def.type)) account = await refreshDiscovery(def.type, secret, config);
      if (def.type === 'telegram') {
        const v = await telegram.verify(secret);
        config.botUsername = v.username;
        config.botId = v.id;
        account = `@${v.username}`;
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
    if (def.type === 'telegram') telegram.onConnect(store, config.botId);
    runtimeFor(store).logEvent('system', req.member.id, `${def.name} conectado${account ? ` (${account})` : ''}.`);
    refresh(store);
    res.json({ ok: true, account });
  }));

  // WhatsApp pessoal: gera o QR code (ou retoma a sessão salva).
  app.post('/api/integrations/whatsapp_web/start', requireCompany, need('owner'), wrap(async (req, res) => {
    const store = req.company;
    waRuntimeFor ||= runtimeFor;
    const prev = ensure(store).whatsapp_web;
    ensure(store).whatsapp_web = { connected: true, account: prev?.account || '', error: '', connectedAt: prev?.connectedAt || Date.now(),
      config: { chats: [], mentions: 'on', mode: 'approval', prefix: '', persona: 'assistant', ...(prev?.config || {}) } };
    store.save();
    try { res.json(await waweb.start(store, waHooks)); } catch (e) { bad(res, `Não foi possível iniciar o WhatsApp: ${e.message}`); }
  }));
  app.get('/api/integrations/whatsapp_web/status', requireCompany, need('admin'), (req, res) => {
    res.json({ ...waweb.status(req.company), account: conn(req.company, 'whatsapp_web')?.account || '' });
  });
  app.get('/api/integrations/whatsapp_web/chats', requireCompany, need('admin'), wrap(async (req, res) => {
    try { res.json(await waweb.listChats(req.company)); } catch (e) { bad(res, e.message); }
  }));
  app.get('/api/integrations/whatsapp_web/lookup', requireCompany, need('admin'), wrap(async (req, res) => {
    try { res.json(await waweb.lookupPhone(req.company, req.query.phone)); } catch (e) { bad(res, e.message); }
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
    } else if (['uploadpost', 'openai_images', 'gemini_images'].includes(req.params.type)) {
      const def = DEF[req.params.type];
      const next = { ...c.config };
      for (const f of def.configFields) if (req.body?.[f.key] !== undefined) next[f.key] = str(req.body[f.key], 200);
      try { c.account = await refreshDiscovery(def.type, decrypt(c.secret), next); } catch (e) { return bad(res, e.message); }
      c.config = next;
      c.error = '';
    } else if (req.params.type === 'whatsapp_web') {
      if (Array.isArray(req.body?.chats)) {
        c.config.chats = req.body.chats.filter((x) => /@(g\.us|s\.whatsapp\.net|lid)$/.test(String(x?.id || ''))).slice(0, 50)
          .map((x) => ({ id: str(x.id, 80), name: str(x.name, 80) || str(x.id, 80), kind: String(x.id).endsWith('@g.us') ? 'group' : 'contact', trigger: x.trigger === 'all' ? 'all' : 'mention' }));
      }
      if (req.body?.mentions !== undefined) c.config.mentions = req.body.mentions === 'off' ? 'off' : 'on';
      if (req.body?.mode !== undefined) c.config.mode = req.body.mode === 'auto' ? 'auto' : 'approval';
      if (req.body?.prefix !== undefined) c.config.prefix = String(req.body.prefix).slice(0, 30);
      if (req.body?.persona !== undefined) c.config.persona = req.body.persona === 'owner' ? 'owner' : 'assistant';
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
    if (def.type === 'telegram') telegram.onDisconnect(store);
    // Sai do aparelho conectado no celular e apaga a sessão e as mensagens guardadas.
    if (def.type === 'whatsapp_web') waweb.stop(store, { logout: true }).catch(() => {});
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
