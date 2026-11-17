// Motor por empresa: decide qual agente de IA "acorda", monta o contexto, roda o ciclo
// de ferramentas com o Claude e publica tudo em tempo real para o escritório 3D.
import fs from 'node:fs';
import path from 'node:path';
import { uid, allCompanies } from './companies.js';
import { providerFor, callClaude, callMock, describeError, estimateCost, usageOf, cacheMark, warmCache, CACHE_TTL, isTransient } from './llm.js';
import { tickFunctions, FUNCTION_CATALOG } from './functions.js';
import { toolsFor, executeIntegrationTool, accessSummary, accessNames, publicState, migrate, escalateNote, customerChannels, can } from './integrations.js';
import { ROLE_CATALOG } from './templates.js';
import { brandPromptBlock } from './brand.js';
import { profileOf, fillVariables, CHANNELS, verifyHint } from './profile.js';
import { memoryBlock, readMemory, writeMemory } from './memory.js';
import { recordWrite } from './files.js';
import * as drive from './drive.js';

const driveMirror = (store) => !!store.state.integrations?.google_drive?.connected;
import { logActivity, readActivity } from './activity.js';

// Resumo legível do que foi pedido a uma ferramenta (para o log do agente).
function summarizeInput(i = {}) {
  const main = i.title || i.subject || i.path || i.to || i.repo || i.consulta || i.email_id || i.session_id || i.query || '';
  const body = i.content || i.text || i.description || i.motivo || '';
  return `${main}${main && body ? ' — ' : ''}${String(body).slice(0, 600)}` || JSON.stringify(i).slice(0, 400);
}
import * as workbench from './workbench.js';
import { tickRoutines, syncTaskRuns } from './routines.js';
import { knowledgeMode, documentsBlock, search as kbSearch } from './knowledge.js';

const MAX_CONCURRENCY = +process.env.MAX_CONCURRENT_AGENTS || 3;
const GLOBAL_MAX = +process.env.GLOBAL_MAX_CONCURRENT_AGENTS || 12;
const MAX_STEPS = +process.env.AGENT_MAX_STEPS || 10;
// Quem mais quer ouvir os avisos do escritório (ex.: Telegram). Cada função recebe (runtime, msg).
export const emitHooks = [];
const TICK_MS = 1500;
// Corta no fim de uma palavra (nunca "sessão de a") e marca com "…" quando cortou.
const cutWords = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); if (t.length <= n) return t; const c = t.slice(0, n); const i = c.lastIndexOf(' '); return `${(i > n * 0.6 ? c.slice(0, i) : c).replace(/[\s,;:.–-]+$/, '')}…`; };
const TASK_LABEL = { approval: 'aguardando aprovação', todo: 'a fazer', doing: 'em andamento', review: 'em revisão', done: 'concluída', blocked: 'bloqueada' };

// ---------------- hub de tempo real (sockets por empresa) ----------------
export const hub = {
  sockets: new Map(), // companyId -> Set<ws>
  add(companyId, ws) {
    if (!this.sockets.has(companyId)) this.sockets.set(companyId, new Set());
    this.sockets.get(companyId).add(ws);
  },
  remove(companyId, ws) { this.sockets.get(companyId)?.delete(ws); },
  broadcast(companyId, msg) {
    const data = JSON.stringify(msg);
    for (const ws of this.sockets.get(companyId) || []) if (ws.readyState === 1) ws.send(data);
  },
  onlineSubs(companyId) {
    const subs = new Set();
    for (const ws of this.sockets.get(companyId) || []) if (ws.readyState === 1) subs.add(ws.userSub);
    return subs;
  },
};

const runtimes = new Map(); // companyId -> CompanyRuntime
export function runtimeFor(store) {
  if (!runtimes.has(store.id)) { migrate(store); runtimes.set(store.id, new CompanyRuntime(store)); }
  return runtimes.get(store.id);
}

// ---------------- ferramentas ----------------
const BASE_TOOLS = [
  {
    name: 'send_message',
    description: 'Envia uma mensagem para um colega (pelo id, IA ou humano) ou para o dono da empresa (to="board"). Use para alinhar, pedir informação ou reportar resultados.',
    input_schema: {
      type: 'object',
      properties: {
        to: { type: 'string', description: 'id do colega ou "board"' },
        content: { type: 'string', description: 'Texto da mensagem, objetivo e curto' },
      },
      required: ['to', 'content'],
    },
  },
  {
    name: 'create_task',
    description: 'Cria uma tarefa e atribui a um colega (IA ou humano). Use para delegar. Prefira tarefas pequenas, com critério de pronto claro.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string' },
        description: { type: 'string', description: 'O que fazer e qual o critério de pronto' },
        assignee_id: { type: 'string', description: 'id do responsável' },
        parent_task_id: { type: 'string', description: 'Opcional: id da sua tarefa da qual esta é parte' },
        motivo: { type: 'string', description: 'Por que precisa disso e para quando (vai para quem aprova, se o colega não for da sua equipe)' },
      },
      required: ['title', 'description', 'assignee_id'],
    },
  },
  {
    name: 'aprovar_tarefa',
    description: 'Decide um pedido de tarefa entre áreas que está aguardando a SUA aprovação: aprovar (vai para a fila do responsável), recusar (volta para quem pediu com o motivo) ou aprovar trocando o responsável.',
    input_schema: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
        decisao: { type: 'string', enum: ['aprovar', 'recusar'] },
        motivo: { type: 'string', description: 'Obrigatório ao recusar; opcional ao aprovar (orientação para quem vai fazer)' },
        novo_responsavel_id: { type: 'string', description: 'Opcional: aprovar passando para outro colega' },
      },
      required: ['task_id', 'decisao'],
    },
  },
  {
    name: 'update_task',
    description: 'Atualiza o status de uma tarefa sua ou que você criou (todo, doing, review, done, blocked). Ao concluir, informe em result o que foi entregue e onde.',
    input_schema: {
      type: 'object',
      properties: {
        task_id: { type: 'string' },
        status: { type: 'string', enum: ['todo', 'doing', 'review', 'done', 'blocked'] },
        result: { type: 'string', description: 'Resumo do resultado ou do bloqueio' },
      },
      required: ['task_id', 'status'],
    },
  },
  {
    name: 'write_file',
    description: 'Cria ou sobrescreve um arquivo no arquivo da empresa (aba Arquivos). Organize por área e assunto, reaproveitando as pastas existentes (ex.: Marketing/Campanhas/, Financeiro/Relatorios/).',
    input_schema: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Caminho com pasta por área, ex.: Produto/PRDs/2026-11-onboarding.md' }, content: { type: 'string' } },
      required: ['path', 'content'],
    },
  },
  {
    name: 'read_file',
    description: 'Lê um arquivo do workspace interno da empresa.',
    input_schema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  },
  {
    name: 'list_files',
    description: 'Lista os arquivos do workspace interno da empresa.',
    input_schema: { type: 'object', properties: {} },
  },
];

// ---------------- runtime de uma empresa ----------------
export class CompanyRuntime {
  constructor(store) {
    this.store = store;
    this.rt = new Map(); // agentId -> { status, busy, bubble, with }
    this.snapTimer = null;
  }

  get s() { return this.store.state; }
  emit(msg) {
    hub.broadcast(this.store.id, msg);
    for (const fn of emitHooks) { try { fn(this, msg); } catch (e) { console.error('[emit]', e.message); } }
  }
  isHuman(id) { return this.store.getAgent(id)?.kind === 'human'; }
  nameOf(id) {
    if (id === 'board') return this.store.owner()?.name || 'Dono';
    if (String(id).startsWith('caixa:')) return { 'caixa:gmail': 'Caixa do Gmail', 'caixa:crisp': 'Chat do site', 'caixa:whatsapp': 'WhatsApp' }[id] || 'Caixa de entrada';
    return this.store.getAgent(id)?.name || id;
  }
  ownerId() { return this.store.owner()?.id || 'board'; }

  agentRuntime(id) {
    if (!this.rt.has(id)) this.rt.set(id, { status: 'idle', busy: false, bubble: '', with: null });
    return this.rt.get(id);
  }

  setStatus(id, patch) {
    const r = Object.assign(this.agentRuntime(id), patch);
    this.emit({ type: 'agent', id, status: r.status, bubble: r.bubble, with: r.with });
  }

  logEvent(type, agentId, text, extra = {}) {
    const { noActivity, ...rest } = extra;
    if (!noActivity) logActivity(this.store, agentId, { type, text, ...(rest.link ? { link: rest.link } : {}) });
    extra = rest;
    const ev = { id: uid('e'), ts: Date.now(), type, agentId, text, ...extra };
    this.s.events.push(ev);
    if (this.s.events.length > 500) this.s.events.splice(0, this.s.events.length - 500);
    this.store.save();
    this.emit({ type: 'event', event: ev });
    return ev;
  }

  pushSnapshot() {
    clearTimeout(this.snapTimer);
    this.snapTimer = setTimeout(() => this.emit({ type: 'refresh' }), 150);
  }

  usagePayload() {
    const u = this.spend();
    return { ...u, budgetUsd: this.budgetUsd(), pausedReason: this.s.pausedReason || null };
  }

  // Estado visível para um membro (segredos só aparecem mascarados e para o dono).
  snapshot(member) {
    const online = hub.onlineSubs(this.store.id);
    const c = this.store.company;
    return {
      company: { ...c },
      me: member ? { id: member.id, appRole: member.appRole, name: member.name } : null,
      agents: this.s.agents.filter((a) => a.active !== false).map((a) => ({
        ...a,
        online: a.kind === 'human' ? [a.userSub, ...(a.altSubs || [])].some((s) => online.has(s)) : undefined,
        runtime: this.agentRuntime(a.id),
      })),
      tasks: this.s.tasks,
      deliveries: member ? (this.s.deliveries || []).filter((d) => d.to === member.id && !d.dismissedAt).slice(-50) : [],
      jobs: (this.s.jobs || []).slice(-40).map(workbench.publicJob),
      workshop: this.usesWorkshop(),
      events: this.s.events.slice(-150),
      messages: this.s.messages.slice(-300),
      usage: this.usagePayload(),
      paused: this.s.paused,
      provider: providerFor(this.store),
      model: providerFor(this.store) === 'mock' ? 'simulado' : c.settings.model,
      integrations: publicState(this.store),
      approvals: member && ['owner', 'admin'].includes(member.appRole) ? (this.s.approvals || []).filter((x) => x.status === 'pending') : [],
      secrets: member?.appRole === 'owner' ? this.store.secretInfo() : undefined,
      invites: member && ['owner', 'admin'].includes(member.appRole) ? this.s.invites.filter((i) => !i.usedAt && !i.revokedAt && i.expiresAt > Date.now()) : undefined,
    };
  }

  // ---------- ações (usuário e ferramentas) ----------
  postMessage(from, to, content) {
    const msg = { id: uid('m'), ts: Date.now(), from, to, content: String(content).slice(0, 8000), read: false };
    this.s.messages.push(msg);
    if (this.s.messages.length > 3000) this.s.messages.splice(0, this.s.messages.length - 3000);
    if (this.isHuman(from)) this.s.goalReported = false;
    if (this.isHuman(to) && !this.isHuman(from)) this.s.goalReported = true;
    this.store.save();
    this.emit({ type: 'message', message: msg });
    logActivity(this.store, from, { type: 'message', dir: 'out', peer: to, text: `Para ${this.nameOf(to)}: ${msg.content}` });
    logActivity(this.store, to, { type: 'message', dir: 'in', peer: from, text: `De ${this.nameOf(from)}: ${msg.content}` });
    this.logEvent('message', from, `${this.nameOf(from)} → ${this.nameOf(to)}: ${msg.content.slice(0, 160)}`, { noActivity: true });
    return msg;
  }

  createTask({ title, description = '', assigneeId, creatorId, parentId = null, status = 'todo' }) {
    const t = {
      id: this.store.nextTaskId(), title: cutWords(title, 140), description: String(description).slice(0, 4000),
      assigneeId, creatorId, parentId, status, result: '', presented: false,
      createdAt: Date.now(), updatedAt: Date.now(),
    };
    this.s.tasks.push(t);
    this.store.save();
    this.logEvent('task', creatorId, `${this.nameOf(creatorId)} criou ${t.id} para ${this.nameOf(assigneeId)}: ${t.title}`);
    if (this.isHuman(assigneeId)) this.emit({ type: 'notify', to: assigneeId, text: `Nova tarefa ${t.id}: ${t.title}` });
    this.pushSnapshot();
    return t;
  }

  updateTask(task, { status, result }, byId) {
    if (status) task.status = status;
    if (result) task.result = String(result).slice(0, 4000);
    task.updatedAt = Date.now();
    // Entrega para quem pediu: tarefa de agente concluída para uma pessoa fica na "Minha mesa" dela
    // até ela arquivar. Se a própria pessoa conclui (aprovou a revisão), sai da mesa.
    if (task.status === 'done') {
      const creator = this.store.getAgent(task.creatorId);
      const assignee = this.store.getAgent(task.assigneeId);
      if (byId === task.creatorId) { if (task.desk && !task.desk.dismissedAt) task.desk.dismissedAt = Date.now(); }
      else if (byId === task.assigneeId && creator?.kind === 'human' && assignee && assignee.kind !== 'human' && !task.test) task.desk = { to: creator.id, at: Date.now(), dismissedAt: null };
    }
    this.store.save();
    const label = TASK_LABEL[task.status];
    this.logEvent('task', byId, `${this.nameOf(byId)} marcou ${task.id} como ${label}${result ? ': ' + String(result).slice(0, 120) : ''}`);
    if ((task.status === 'done' || task.status === 'blocked') && task.creatorId !== byId && this.store.getAgent(task.creatorId)) {
      this.postMessage(byId, task.creatorId, `[${task.id}] "${task.title}" ${label}. ${task.result || ''}`.trim());
    }
    this.pushSnapshot();
  }

  // ---------- ferramentas do agente ----------
  // Ferramentas base + as das integrações que ESTE agente recebeu acesso.
  tools(agent) {
    const extra = [];
    if (knowledgeMode(this.store, agent).mode === 'search') {
      extra.push({
        name: 'buscar_conhecimento',
        description: 'Busca na base de conhecimento da empresa os trechos mais relevantes para uma pergunta (use as palavras do cliente).',
        input_schema: { type: 'object', properties: { consulta: { type: 'string' }, categoria: { type: 'string', description: 'Opcional: filtrar por categoria' } }, required: ['consulta'] },
      });
    }
    if (this.s.agents.some((a) => a.kind === 'human' && a.active !== false)) {
      extra.push({
        name: 'escalar_para_humano',
        description: 'Passa o caso para uma pessoa da empresa: cria uma tarefa para ela com o resumo e, se for conversa do chat, deixa uma nota interna. Use quando suas instruções mandarem escalar ou quando o caso exigir uma pessoa.',
        input_schema: {
          type: 'object',
          properties: {
            motivo: { type: 'string', description: 'Por que precisa de uma pessoa' },
            resumo: { type: 'string', description: 'Resumo do caso: quem é o cliente, o que pediu, o que já foi dito' },
            session_id: { type: 'string', description: 'Opcional: session_id da conversa no chat (Crisp)' },
            email_id: { type: 'string', description: 'Opcional: id do e-mail recebido (Resend)' },
          },
          required: ['motivo', 'resumo'],
        },
      });
    }
    extra.push({
      name: 'guardar_na_memoria',
      description: 'Guarda na sua memória permanente algo que você aprendeu e vai precisar de novo: uma orientação que uma pessoa te deu (resposta a um caso escalado, correção, "como fazer"), uma preferência do dono ou um fato do produto que não estava na base. Escreva completo e autossuficiente (com os passos), como se fosse ler daqui a meses sem contexto. Nada de dados pessoais de clientes.',
      input_schema: {
        type: 'object',
        properties: {
          assunto: { type: 'string', description: 'Título curto, ex.: "Cadastrar atendimento familiar"' },
          conteudo: { type: 'string', description: 'A orientação completa, em tópicos ou passos' },
          fonte: { type: 'string', description: 'Quem ensinou ou de onde veio, ex.: "Leandro, 12/11/2026"' },
        },
        required: ['assunto', 'conteudo'],
      },
    });
    return [...BASE_TOOLS, ...extra, ...toolsFor(this.store, agent)];
  }

  // Acrescenta um aprendizado na memória do agente (seção "Aprendido com a equipe"); substitui se o assunto já existir.
  rememberLesson(agent, { assunto, conteudo, fonte }) {
    const title = String(assunto || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    const body = String(conteudo || '').trim().slice(0, 4000);
    if (!title || !body) return { error: 'Informe assunto e conteudo.' };
    const date = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const block = `### ${title}\n_${fonte ? String(fonte).slice(0, 120) : `aprendido em ${date}`}_\n${body}`;
    let mem = readMemory(this.store, agent.id).trim() || '# Memória';
    const H = '## Aprendido com a equipe';
    if (!mem.includes(H)) mem = `${mem}\n\n${H}`;
    const esc = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`### ${esc}\\n[\\s\\S]*?(?=\\n### |\\n## |$)`);
    mem = re.test(mem) ? mem.replace(re, block) : mem.replace(H, `${H}\n\n${block}`);
    if (mem.length > 38000) return { error: 'Memória cheia: resuma ou remova itens antigos na aba Memória da ficha.' };
    writeMemory(this.store, agent.id, mem, agent.name);
    this.logEvent('system', agent.id, `${agent.name} guardou na memória: "${title}"`);
    return { ok: true, aviso: 'Guardado. Vai estar no seu contexto nas próximas conversas e tarefas.' };
  }

  // Cria a tarefa de escalonamento para a pessoa definida na ficha (ou o dono).
  async escalate(agent, { motivo, resumo, session_id, email_id }) {
    const profile = profileOf(agent);
    const target = this.store.getAgent(profile.escalation.to) || this.store.owner();
    if (!target) return { error: 'Não há pessoa para receber o caso.' };
    const t = this.createTask({
      title: `Escalado por ${agent.name}: ${cutWords(motivo, 90)}`,
      description: `Motivo: ${String(motivo).trim()}\n\n${resumo}${session_id ? `\n\nConversa no chat (Crisp): session_id ${session_id}` : ''}${email_id ? `\n\nE-mail recebido (Resend): ${email_id}` : ''}`,
      assigneeId: target.id, creatorId: agent.id,
    });
    if (session_id) await escalateNote(this, agent, session_id, `Escalado para ${target.name}: ${motivo}`).catch(() => {});
    this.logEvent('task', agent.id, `${agent.name} escalou um caso para ${target.name}: ${String(motivo).slice(0, 120)}`);
    return { ok: true, task_id: t.id, escalado_para: target.name };
  }

  async executeTool(agent, name, input, taskHint, opts = {}) {
    const store = this.store;
    switch (name) {
      case 'send_message': {
        const to = input.to === 'board' ? this.ownerId() : store.getAgent(input.to)?.id;
        if (!to || to === 'board') {
          if (input.to === 'board') { this.postMessage(agent.id, 'board', input.content); return { ok: true }; }
          return { error: `Destinatário desconhecido: ${input.to}` };
        }
        if (to === agent.id) return { error: 'Não envie mensagens para si mesmo.' };
        if (store.getAgent(to)?.kind === 'function') return { error: `${store.getAgent(to).name} é uma função automática: não lê mensagens. Fale com quem a supervisiona.` };
        this.postMessage(agent.id, to, input.content);
        if (this.isHuman(to)) {
          // Responder uma pessoa é trabalho de mesa: continua sentado, com o balão da resposta
          // (e depois fica os 5 min na mesa). O aviso para a pessoa sai pelo evento da própria mensagem.
          this.setStatus(agent.id, { status: 'working', with: null, bubble: String(input.content).slice(0, 140) });
        } else {
          this.setStatus(agent.id, { status: 'meeting', with: to, bubble: String(input.content).slice(0, 140) });
          if (!this.agentRuntime(to).busy) this.setStatus(to, { status: 'meeting', with: agent.id, bubble: '' });
          setTimeout(() => { if (!this.agentRuntime(to).busy) this.setStatus(to, { status: 'idle', with: null, bubble: '' }); }, 9000);
        }
        return { ok: true };
      }
      case 'create_task': {
        const assignee = store.getAgent(input.assignee_id);
        if (!assignee || assignee.active === false) return { error: `Colega desconhecido: ${input.assignee_id}. Use um id do organograma.` };
        if (assignee.kind === 'function') return { error: `${assignee.name} é uma função automática: não recebe tarefas.` };
        const parent = input.parent_task_id ? this.s.tasks.find((t) => t.id === input.parent_task_id) : null;
        const approver = this.approverFor(agent, assignee);
        const t = this.createTask({ title: input.title, description: input.description, assigneeId: assignee.id, creatorId: agent.id, parentId: parent?.id || null, ...(approver ? { status: 'approval' } : {}) });
        if (approver) {
          t.approval = { by: approver.id, requestedAt: Date.now(), reason: String(input.motivo || '').slice(0, 600) };
          this.store.save();
          this.logEvent('task', agent.id, `${agent.name} pediu a ${assignee.name} (${t.id}: ${t.title}). Aguardando aprovação de ${approver.name}.`);
          if (approver.kind === 'human') this.emit({ type: 'notify', to: approver.id, text: `${agent.name} pede aprovação: ${t.title} → ${assignee.name} (Minha mesa)` });
          else this.postMessage(agent.id, approver.id, `[Aprovação ${t.id}] Peço aprovação para passar a ${assignee.name} (${assignee.role}): "${t.title}". ${t.description || ''}${t.approval.reason ? `\nMotivo: ${t.approval.reason}` : ''}\nDecida com aprovar_tarefa.`);
          this.setStatus(agent.id, { status: 'working', bubble: `${t.id} → ${assignee.name} (aguardando ${approver.name.split(' ')[0]})` });
          this.pushSnapshot();
          return { ok: true, task_id: t.id, aguardando_aprovacao_de: `${approver.name} (${approver.id})`, aviso: `${assignee.name} não é da sua equipe: o pedido foi para ${approver.name} aprovar. Você será avisado quando for aprovado (e quando ${assignee.name.split(' ')[0]} concluir) ou recusado.` };
        }
        this.setStatus(agent.id, { status: 'working', bubble: `Nova tarefa ${t.id} → ${assignee.name}` });
        return { ok: true, task_id: t.id };
      }
      case 'aprovar_tarefa': {
        const t = this.s.tasks.find((x) => x.id === input.task_id);
        if (!t || t.status !== 'approval') return { error: `Não há pedido aguardando aprovação com o id ${input.task_id}.` };
        if (t.approval?.by !== agent.id) return { error: 'Este pedido não está aguardando a sua aprovação.' };
        return this.decideApproval(t, { decision: input.decisao, reason: input.motivo, assigneeId: input.novo_responsavel_id }, agent.id);
      }
      case 'update_task': {
        const t = this.s.tasks.find((x) => x.id === input.task_id);
        if (!t) return { error: `Tarefa não encontrada: ${input.task_id}` };
        if (t.assigneeId !== agent.id && t.creatorId !== agent.id) return { error: 'Você só pode atualizar tarefas suas ou que você criou.' };
        this.updateTask(t, { status: input.status, result: input.result }, agent.id);
        this.setStatus(agent.id, { status: 'working', bubble: `${t.id}: ${input.status}` });
        return { ok: true };
      }
      case 'guardar_na_memoria': return this.rememberLesson(agent, input);
      case 'write_file': {
        const full = store.safePath(input.path);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, String(input.content ?? ''));
        recordWrite(store, String(input.path).replace(/^[/\\]+/, ''), { by: agent.id, task: taskHint });
        drive.schedule(store, this);
        this.logEvent('file', agent.id, `${agent.name} escreveu ${input.path}`);
        this.setStatus(agent.id, { status: 'working', bubble: `Escrevendo ${input.path}` });
        this.emit({ type: 'files' });
        return { ok: true, bytes: Buffer.byteLength(String(input.content ?? '')) };
      }
      case 'read_file': {
        const full = store.safePath(input.path);
        if (!fs.existsSync(full)) return { error: 'Arquivo não existe' };
        return { content: fs.readFileSync(full, 'utf8').slice(0, 60000) };
      }
      case 'list_files':
        return { files: store.listFiles() };
      case 'buscar_conhecimento': {
        const kb = knowledgeMode(store, agent);
        this.setStatus(agent.id, { status: 'working', bubble: `Consultando a base: ${String(input.consulta).slice(0, 60)}` });
        const hits = kbSearch(kb.chunks, input.consulta, { category: input.categoria, k: 6 });
        return hits.length ? { trechos: hits } : { trechos: [], aviso: 'Nada encontrado. Não invente: diga que vai verificar e escale.' };
      }
      case 'escalar_para_humano':
        return this.escalate(agent, input);
      default: {
        // GitHub, Resend, Gmail, Agenda: checam o acesso do agente na execução também.
        const out = await executeIntegrationTool(this, agent, name, input, taskHint, opts);
        return out ?? { error: `Ferramenta desconhecida: ${name}` };
      }
    }
  }

  // ---------- contexto ----------
  // Prompt na ordem recomendada pela Anthropic: documentos longos no topo (<documents>),
  // depois identidade, instruções e procedimentos, e os exemplos no fim (<examples>).
  // É estável entre chamadas (sem dados variáveis), então aproveita o cache.
  // mode 'chat' = ciclo rápido (mensagens); mode 'job' = oficina (tarefa completa no container).
  // Aprova (vai para a fila do responsável, opcionalmente outro) ou recusa (volta para quem pediu com o motivo).
  decideApproval(t, { decision, reason, assigneeId }, byId) {
    const by = this.store.getAgent(byId);
    const creator = this.store.getAgent(t.creatorId);
    const why = String(reason || '').trim().slice(0, 600);
    if (decision === 'aprovar') {
      const next = assigneeId ? this.store.getAgent(assigneeId) : this.store.getAgent(t.assigneeId);
      if (!next || next.active === false) return { error: 'Responsável inválido.' };
      t.assigneeId = next.id;
      t.approval = { ...t.approval, decidedBy: byId, decidedAt: Date.now(), decision: 'aprovada', note: why };
      if (why) t.description = `${t.description || ''}\n\nOrientação de ${by?.name || 'quem aprovou'}: ${why}`.trim();
      t.presented = false;
      this.updateTask(t, { status: 'todo' }, byId);
      this.logEvent('task', byId, `${by?.name} aprovou ${t.id} ("${t.title}") para ${next.name}.`);
      if (creator && creator.id !== byId) this.postMessage(byId, creator.id, `[${t.id}] Aprovado: "${t.title}" foi para ${next.name}.${why ? ` Orientação: ${why}` : ''} Você será avisado quando for concluído.`);
      return { ok: true, status: 'aprovada', responsavel: next.id };
    }
    if (decision === 'recusar') {
      if (!why) return { error: 'Explique o motivo da recusa.' };
      t.approval = { ...t.approval, decidedBy: byId, decidedAt: Date.now(), decision: 'recusada', note: why };
      this.updateTask(t, { status: 'blocked', result: `Recusada por ${by?.name || 'quem aprova'}: ${why}` }, byId);
      return { ok: true, status: 'recusada' };
    }
    return { error: 'decisao deve ser "aprovar" ou "recusar".' };
  }

  // Resumo do que um colega faz: o resumo do cargo de origem ou o começo das instruções da ficha.
  whatTheyDo(a) {
    const cat = ROLE_CATALOG[a.catalogKey]?.summary;
    const instr = String(profileOf(a).instructions || a.prompt || '').replace(/\{\{[^}]+\}\}/g, '').replace(/[#*`>|]+/g, ' ').replace(/\s+/g, ' ').trim();
    const t = cat || instr || a.title || a.role;
    return t.length > 280 ? `${t.slice(0, 280).replace(/\s+\S*$/, '')}…` : t;
  }

  // Equipe de alguém: ele mesmo e todos abaixo dele no organograma.
  inTeamOf(managerId, id) {
    for (let cur = this.store.getAgent(id), guard = 0; cur && guard < 20; cur = this.store.getAgent(cur.reportsTo), guard++) {
      if (cur.id === managerId) return true;
    }
    return false;
  }

  // Pedido de um agente para alguém fora da equipe dele precisa da aprovação de quem ele reporta.
  approverFor(creator, assignee) {
    if (!creator || creator.kind === 'human' || !assignee || assignee.kind === 'human') return null;
    if (this.inTeamOf(creator.id, assignee.id)) return null; // para si ou para alguém da própria equipe
    const boss = this.store.getAgent(creator.reportsTo);
    if (!boss || boss.active === false || boss.id === assignee.id) return null; // topo, ou o pedido é ao próprio chefe
    return boss;
  }

  // Sistema da conversa em dois blocos com ponto de cache longo: [fixo] base, identidade, instruções, regras e
  // exemplos; [muda às vezes] memória e organograma. Assim aprender algo novo só regrava o segundo bloco.
  systemBlocks(agent) {
    const { stable, dynamic } = this.systemPrompt(agent, { split: true });
    const mark = cacheMark();
    return [
      { type: 'text', text: stable, cache_control: mark },
      ...(dynamic ? [{ type: 'text', text: dynamic, cache_control: mark }] : []),
    ];
  }

  // split: devolve { stable, dynamic } (conversa); mode 'job': texto para a oficina, sem a base embutida
  // (na oficina ela vai como arquivos em /work/conhecimento, lidos sob demanda).
  systemPrompt(agent, { mode = 'chat', split = false } = {}) {
    const c = this.store.company;
    const owner = this.store.owner();
    const profile = profileOf(agent);
    const fill = (t) => fillVariables(t, { agent, company: c, profile });
    const kb = knowledgeMode(this.store, agent);
    // Organograma com responsabilidades: o que cada colega faz e a que sistemas tem acesso (para pedir à pessoa certa).
    const org = this.s.agents.filter((a) => a.active !== false)
      .map((a) => {
        const head = `- id: ${a.id} | ${a.name} — ${a.title} (${a.role})${a.kind === 'human' ? ' (humano)' : a.kind === 'function' ? ' (função automática do servidor: não lê mensagens nem recebe tarefas)' : ''}${a.id === agent.id ? ' ← você' : ''}${a.reportsTo ? ` | reporta a: ${a.reportsTo}` : ' | topo da hierarquia'}`;
        if (a.id === agent.id || a.kind === 'human') return head;
        if (a.kind === 'function') return `${head}\n  faz: ${FUNCTION_CATALOG[a.fnKey]?.summary || 'automação do servidor'}`;
        const acc = accessNames(this.store, a);
        return `${head}\n  faz: ${this.whatTheyDo(a)}${acc.length ? `\n  acessos: ${acc.join('; ')}` : '\n  acessos: nenhum sistema externo'}`;
      })
      .join('\n');
    const about = [
      c.segment && `Segmento: ${c.segment}`,
      c.website && `Site: ${c.website}`,
      c.description && `Descrição: ${c.description}`,
      c.mission && `Missão: ${c.mission}`,
      c.context && `Contexto e regras do negócio:\n${c.context}`,
    ].filter(Boolean).join('\n');
    const integ = accessSummary(this.store, agent);
    const escalateTo = this.store.getAgent(profile.escalation.to) || owner;
    const chans = customerChannels(this.store, agent);
    const sendRules = chans.map((ch) => `${CHANNELS[ch]}: ${profile.sendMode[ch] === 'auto' ? 'envio direto' : 'suas respostas viram rascunho e só saem depois da aprovação de uma pessoa (escreva-as prontas para enviar)'}`).join('; ');

    const parts = [];
    const dyn = [];
    const kbFiles = mode === 'job' && kb.mode !== 'none';
    if (kb.mode === 'inline' && !kbFiles) {
      parts.push(`Base de conhecimento da empresa (fonte de verdade para responder; ${kb.chunks.length} trechos):\n${documentsBlock(kb.chunks)}`);
    }
    parts.push(`Você é ${agent.name}, ${agent.title} (${agent.role}) na empresa "${c.name}".

Sobre a empresa:
${about || '(sem descrição)'}
${integ ? `\n${integ}\n` : ''}
<instrucoes>
${fill(profile.instructions) || '(sem instruções específicas)'}
</instrucoes>`);
    if (profile.procedures.trim()) parts.push(`<procedimentos>\n${fill(profile.procedures)}\n</procedimentos>`);
    const mem = memoryBlock(this.store, agent.id);
    if (mem) dyn.push(mem);
    if (kbFiles) parts.push(`Você tem uma base de conhecimento com ${kb.chunks.length} trechos sobre a empresa e o produto, em arquivos na pasta /work/conhecimento (comece por /work/conhecimento/INDICE.md). Ela NÃO está neste prompt: busque com Grep e leia só os arquivos que importam para a tarefa antes de afirmar algo. Se a informação não estiver nela, não invente.`);
    else if (kb.mode === 'inline') parts.push('A base de conhecimento acima é a fonte de verdade sobre a empresa e o produto: use-a. Se a informação não estiver nela, não invente: diga que vai verificar e, se precisar, escale para uma pessoa.');
    else if (kb.mode === 'search') parts.push(`Você tem uma base de conhecimento com ${kb.chunks.length} trechos sobre a empresa e o produto. Consulte-a com buscar_conhecimento (pode filtrar por categoria) antes de afirmar algo. Se a informação não estiver nela, não invente.`);
    const rules = [];
    if (chans.length) rules.push(`Envio para clientes: ${sendRules}.`);
    if (escalateTo) rules.push(`Escalonamento: quando precisar de uma pessoa (decisão, aprovação, acesso, risco ou algo fora do seu alcance — ou quando suas instruções mandarem), use escalar_para_humano — vai para ${escalateTo.name}.${profile.escalation.note ? ` ${fill(profile.escalation.note)}` : ''}`);
    if (chans.length) rules.push(`Mensagens de clientes chegam com Canal, Caixa de destino, Nome e E-mail (ou Telefone) do cliente: use esses dados no lugar das variáveis indicadas nas suas instruções.${chans.includes('whatsapp') ? ' No WhatsApp: respostas curtas, sem títulos nem tabelas (o WhatsApp só formata *negrito* e _itálico_); texto livre só até 24 h depois da última mensagem do cliente.' : ''}`);
    if (rules.length) parts.push(rules.join('\n'));
    const brandRules = brandPromptBlock(this.store, { email: chans.includes('email') || can(this.store, agent, 'gmail', 'send') || can(this.store, agent, 'gmail', 'draft') });
    if (brandRules) parts.push(brandRules);
    dyn.push(`Organograma (use estes ids nas ferramentas):
${org}
- "board" = o dono da empresa${owner ? ` (${owner.name}, id ${owner.id})` : ''}`);
    if (mode === 'job') {
      const w = profile.workshop;
      const jobTail = `- Você está na sua OFICINA: um ambiente isolado só para esta tarefa, com as ferramentas do Claude Code (ler, buscar, editar arquivos${w.research ? ', pesquisar na web' : ''}${w.browser ? ', navegador' : ''}${can(this.store, agent, 'github', 'code') ? ', terminal, testes e git' : ''}).
- Trabalhe como um profissional sênior do seu cargo: entenda o pedido, planeje com a lista de tarefas (TaskCreate/TaskUpdate; passos pequenos e verificáveis, atualizando o status de cada um), execute, VERIFIQUE o resultado e só então finalize.
- Verificação exigida no seu cargo: ${w.verify || verifyHint(agent)}
- Entregas em arquivo (documentos, relatórios, planilhas, imagens e prints que importam) vão em /work/entregas: é o arquivo da empresa (aba Arquivos${driveMirror(this.store) ? ', espelhado no Google Drive' : ''}). Rascunhos e arquivos técnicos vão em /work/tmp.
- Mantenha esse arquivo ORGANIZADO como uma boa pasta de empresa: uma pasta por área (ex.: Financeiro/, Marketing/, Estrategia/, Produto/, Comercial/, Juridico/, Operacoes/, Atendimento/, Tecnologia/, RH/) e subpastas por assunto (ex.: Marketing/Campanhas/2026-11-lancamento/). Antes de criar, veja as pastas que já existem e reutilize; siga o padrão de nomes que já está lá.
- Nomes de arquivo claros e descritivos, com data AAAA-MM-DD quando for documento datado (ex.: Financeiro/Relatorios/2026-11-fluxo-de-caixa.md). Quando uma pasta tiver vários arquivos relacionados, mantenha um LEIAME.md curto explicando o que é cada um.
- Para organizar, use as ferramentas criar_pasta, mover_arquivo e apagar_arquivo (servidor iaorg): mova e renomeie arquivos para deixar tudo organizado (ex.: algo solto na raiz). O que for movido ou apagado vai para a lixeira do IAORG, nada se perde. Não apague nem mova arquivos enviados por pessoas (pasta Uploads/ e outros) sem que isso tenha sido pedido.${can(this.store, agent, 'github', 'code') ? `
- Código: trabalhe no repositório clonado (diretório atual), em commits pequenos e com mensagens claras. NÃO faça push: o IAORG envia a branch, abre o Pull Request e cuida do CI e do merge ao fim. Nunca altere a branch principal.` : ''}
- Para falar com a equipe, criar ou atualizar tarefas, escalar e usar as integrações da empresa, use as ferramentas do servidor "iaorg" (mcp__iaorg__…). Delegue com create_task só o que é de outro cargo, escolhendo quem faz pelo organograma (linhas "faz" e "acessos"). Pedidos para fora da sua equipe passam pela aprovação de quem você reporta (preencha o motivo); siga com o que não depende disso.
- Se ficar bloqueado por algo que só uma pessoa resolve, escale (escalar_para_humano) e termine explicando o bloqueio.
- Antes de terminar, atualize /work/MEMORY.md com o que vale lembrar nas próximas tarefas (comandos, armadilhas, decisões, preferências do dono e o que uma pessoa te ensinou nesta tarefa). Curto, em tópicos, sem dados sensíveis. Mantenha a seção "Aprendido com a equipe" se ela existir.
- Termine com um resumo objetivo: o que foi feito, onde está a entrega, como foi verificado e o que ficou pendente.
- Escreva em português do Brasil.`;
      const ex = profile.examples.trim() ? `\n\nExemplos de como agir (siga o critério e o formato):\n<examples>\n${fill(profile.examples)}\n</examples>` : '';
      return `${[...parts, ...dyn].join('\n\n')}\n\nComo trabalhar:\n${jobTail}${ex}`;
    }
    const tail = `- Você só se comunica pelas ferramentas. Texto fora delas não é lido por ninguém.
- A equipe mistura agentes de IA e pessoas reais (marcadas como humano). Humanos respondem mais devagar: delegue a eles só o que exige uma pessoa (decisões, acessos, aprovações, trabalho manual) e não fique esperando resposta imediata.
- Para delegar, use create_task com o id de alguém da equipe (de preferência quem reporta a você). Tarefas pequenas, com critério de pronto.
- Ao receber uma tarefa: update_task -> "doing", faça o trabalho, depois update_task -> "done" com um resumo do que foi entregue e onde.
- Se você dividiu uma tarefa sua em partes, passe parent_task_id e conclua a sua quando as partes estiverem prontas (você será avisado por mensagem).
- Não mande mensagens só para agradecer ou confirmar. Evite conversas em loop. Se estiver bloqueado, use update_task -> "blocked" explicando o motivo.
- PEDIR A UM COLEGA: escolha quem faz pelo organograma (linhas "faz" e "acessos"); não peça a quem não tem a responsabilidade ou o acesso. Use create_task com descrição clara, critério de pronto e o campo motivo. Se o colega não for da sua equipe, o pedido vai primeiro para quem você reporta aprovar: avise quem te pediu que está aguardando aprovação e siga com o que não depende disso. Quando o pedido estiver aguardando a SUA aprovação, decida com aprovar_tarefa (aprovar, recusar com motivo ou passar para outra pessoa), pensando nas prioridades da sua área.
- CONTEXTO: você recebe a conversa recente com quem está falando, o seu diário recente e as suas tarefas entregues. Perguntas curtas ("e quando foi isso?", "pode verificar?") se referem ao assunto da conversa: retome de onde parou, sem pedir para repetir. Se precisar confirmar um fato (data de commit, PR, número), use as ferramentas (ex.: repo_history) em vez de supor.
- APRENDA COM A EQUIPE: quando uma pessoa te ensinar algo (resposta a um caso que você escalou, "como fazer", correção, preferência), use guardar_na_memoria NA MESMA HORA, com a orientação completa e os passos, antes de responder ao cliente. Assim você não precisa perguntar de novo. Se a orientação contradiz algo da sua memória, guarde a versão nova com o mesmo assunto (ela substitui a antiga).
- Escreva em português do Brasil.`;
    const examples = profile.examples.trim() ? `\n\nExemplos de como responder (siga o tom e o formato):\n<examples>\n${fill(profile.examples)}\n</examples>` : '';
    const stable = `${parts.join('\n\n')}\n\nComo trabalhar (o organograma e a sua memória vêm logo abaixo):\n${tail}${examples}`;
    const dynamic = dyn.join('\n\n');
    if (split) return { stable, dynamic };
    return `${stable}\n\n${dynamic}`;
  }
  buildContext(agent) {
    const newMessages = this.s.messages.filter((m) => m.to === agent.id && !m.read);
    const myTasks = this.s.tasks.filter((t) => t.assigneeId === agent.id && t.status !== 'done');
    const delegated = this.s.tasks.filter((t) => t.creatorId === agent.id && t.assigneeId !== agent.id).slice(-15);
    const files = this.store.listFiles().slice(0, 80);
    const who = (id) => `${id} (${this.nameOf(id)}${this.isHuman(id) ? ', humano' : ''})`;

    const when = (ts) => new Date(ts).toLocaleString('pt-BR', { timeZone: process.env.COMPANY_TZ || 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    const cut = (s, n) => { const t = String(s ?? ''); return t.length > n ? `${t.slice(0, n)}…` : t; };
    const lines = [];
    lines.push(`Agora: ${when(Date.now())}.`);
    // Contexto de conversa (como no Claude Code): o que já foi dito com quem está falando com você.
    const firstNew = Math.min(...newMessages.map((m) => m.ts), Infinity);
    for (const other of [...new Set(newMessages.map((m) => m.from))]) {
      const past = this.s.messages.filter((m) => m.ts < firstNew && ((m.from === other && m.to === agent.id) || (m.from === agent.id && m.to === other))).slice(-16);
      if (!past.length) continue;
      lines.push(`## Conversa recente com ${who(other)} (mais antigas primeiro)`);
      for (const m of past) lines.push(`- [${when(m.ts)}] ${m.from === agent.id ? 'você' : this.nameOf(m.from)}: ${cut(m.content, 900)}`);
      lines.push('');
    }
    lines.push(newMessages.length ? '## Novas mensagens (responda a estas, usando o contexto acima)' : '## Novas mensagens\n(nenhuma)');
    for (const m of newMessages) lines.push(`- [${when(m.ts)}] de ${who(m.from)}: ${m.content}`);
    // O que você mesmo fez nos últimos dias (ferramentas, buscas, resultados): para lembrar como chegou a uma resposta.
    const recent = readActivity(this.store, agent.id, { limit: 40 })
      .filter((e) => e.ts >= Date.now() - 3 * 864e5 && ['tool', 'text', 'task', 'job', 'file'].includes(e.type) && e.name !== 'send_message')
      .slice(0, 18).reverse();
    if (recent.length) {
      lines.push('\n## Seu diário recente (o que você fez e encontrou, mais antigo primeiro)');
      for (const e of recent) lines.push(`- [${when(e.ts)}] ${e.type === 'tool' ? `ferramenta ${e.name}${e.ok === false ? ' (erro)' : ''}: ` : e.type === 'job' ? `oficina${e.task ? ` ${e.task}` : ''}: ` : e.type === 'text' ? 'você concluiu: ' : ''}${cut(e.text, 300)}`);
    }
    // Tarefas que você concluiu (com resultado e PR): para responder "quando foi feito", "o que mudou".
    const doneRecently = this.s.tasks.filter((t) => t.assigneeId === agent.id && ['done', 'review'].includes(t.status) && (t.updatedAt || 0) >= Date.now() - 21 * 864e5).slice(-6);
    if (doneRecently.length) {
      lines.push('\n## Suas tarefas entregues recentemente');
      for (const t of doneRecently) {
        const j = (this.s.jobs || []).filter((x) => x.taskId === t.id).at(-1);
        const pr = j?.pr ? ` · PR #${j.pr.number} (${j.pr.state === 'merged' ? 'mergeado' : j.pr.state}) ${j.pr.url}${j.code?.branch ? ` · branch ${j.code.branch}` : ''}` : '';
        lines.push(`- [${t.id}] ${t.status === 'done' ? 'concluída' : 'em revisão'} em ${when(t.updatedAt)}: ${t.title}${pr}\n  resultado: ${cut(t.result, 500)}`);
      }
    }
    lines.push('\n## Suas tarefas abertas');
    if (this.usesWorkshop()) lines.push('(As tarefas são executadas na sua oficina, separadamente. Aqui, apenas responda as mensagens. Se um pedido exigir trabalho de verdade — pesquisa, código, documento, análise — crie uma tarefa para você mesmo com create_task usando o seu próprio id, com critério de pronto, e avise quem pediu.)');
    if (!myTasks.length) lines.push('(nenhuma)');
    for (const t of myTasks) lines.push(`- [${t.id}] (${t.status}) ${t.title}${t.parentId ? ` (parte de ${t.parentId})` : ''}\n  ${t.description}`);
    if (delegated.length) {
      lines.push('\n## Tarefas que você delegou');
      for (const t of delegated) lines.push(`- [${t.id}] (${t.status}) ${t.title} → ${who(t.assigneeId)}${t.result ? ` | resultado: ${t.result.slice(0, 200)}` : ''}`);
    }
    lines.push('\n## Arquivos no workspace');
    lines.push(files.length ? files.map((f) => `- ${f.path}`).join('\n') : '(vazio)');
    lines.push('\nDecida e aja agora usando as ferramentas. Quando terminar este ciclo, responda com uma frase curta de resumo.');

    return { text: lines.join('\n'), newMessages, myTasks, taskHint: myTasks[0]?.id };
  }

  // Oficina ligada (runner configurado e chave do Claude): tarefas viram jobs; o ciclo rápido só trata mensagens.
  usesWorkshop() { return workbench.enabled() && providerFor(this.store) !== 'mock'; }

  hasWork(agent) {
    if (agent.kind === 'human' || agent.active === false) return false;
    if (this.s.messages.some((m) => m.to === agent.id && !m.read)) return true;
    if (this.usesWorkshop()) return false;
    return this.s.tasks.some((t) => t.assigneeId === agent.id && t.status === 'todo' && !t.presented);
  }

  // Próxima tarefa a mandar para a oficina (uma por agente por vez).
  nextJobTask(agent) {
    if (!this.usesWorkshop() || agent.kind === 'human' || agent.active === false) return null;
    if (this.overBudget()) { this.pauseForBudget(); return null; }
    if ((this.s.jobs || []).some((j) => j.agentId === agent.id && ['starting', 'running'].includes(j.status))) return null;
    return this.s.tasks.find((t) => t.assigneeId === agent.id && t.status === 'todo' && !t.presented && !(t.retryAt > Date.now())) || null;
  }

  // ---------- gasto em dólar ----------
  // Cada chamada soma o custo real: pelo preço do modelo usado (ciclo rápido, reuniões, simulador)
  // ou o valor exato informado pela oficina. O limite é em US$ por mês (fuso da empresa).
  monthKey() { return new Intl.DateTimeFormat('en-CA', { timeZone: process.env.COMPANY_TZ || 'America/Sao_Paulo', year: 'numeric', month: '2-digit' }).format(new Date()); }
  spend() {
    const u = this.s.usage;
    if (u.costUsd === undefined) u.costUsd = estimateCost(u, this.store.company.settings.model); // migração (antes só havia tokens)
    if (!u.reconciled) {
      // a oficina sempre informou o custo exato: o histórico nunca pode ficar abaixo dele
      const jobs = (this.s.jobs || []).reduce((s, j) => s + (j.costUsd || 0), 0);
      if (jobs > u.costUsd) { u.monthCostUsd = (u.monthCostUsd || 0) + (jobs - u.costUsd); u.costUsd = jobs; }
      u.reconciled = true;
    }
    const m = this.monthKey();
    if (u.month !== m) {
      const wasBudgetPause = this.s.paused && this.s.pausedReason === 'budget';
      Object.assign(u, { month: m, monthCostUsd: u.month ? 0 : u.costUsd });
      if (wasBudgetPause) { this.s.paused = false; this.s.pausedReason = null; this.logEvent('system', null, 'Novo mês: o limite de gasto renovou e a empresa voltou a trabalhar.'); }
    }
    return u;
  }
  budgetUsd() {
    const s = this.store.company.settings;
    if (s.budgetUsd === undefined) s.budgetUsd = 20; // padrão para empresas que tinham orçamento em tokens
    return s.budgetUsd;
  }
  overBudget() { const b = this.budgetUsd(); return b > 0 && this.spend().monthCostUsd >= b; }
  pauseForBudget(extra = '') {
    if (this.s.paused) return;
    this.s.paused = true;
    this.s.pausedReason = 'budget';
    this.logEvent('system', null, `Limite de gasto do mês atingido (US$ ${this.budgetUsd().toFixed(2).replace('.', ',')}). Empresa pausada${extra}. Aumente o limite em Ajustes → Claude ou espere o próximo mês.`);
    this.pushSnapshot();
  }

  // Livro de custos: por dia (fuso da empresa) e por agente, separado por tipo — base do Painel (folha de pagamento).
  // kind: chat (conversas e e-mails), job (oficina), meeting (rotinas/reuniões), sim (simulador da ficha).
  ledger(agentId, kind, cost, u) {
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: process.env.COMPANY_TZ || 'America/Sao_Paulo' }).format(new Date());
    const book = (this.s.costDaily ||= {});
    const d = (book[day] ||= {});
    const id = agentId || '_';
    const e = (d[id] ||= { chat: 0, job: 0, meeting: 0, sim: 0, calls: 0, tin: 0, tout: 0 });
    e[kind] = (e[kind] || 0) + cost;
    e.calls += 1;
    e.tin += (u?.input_tokens || 0) + (u?.cache_read_input_tokens || 0) + (u?.cache_creation_input_tokens || 0);
    e.tout += u?.output_tokens || 0;
    // Cache: tokens lidos (baratos) e gravados (caros) — base da "taxa de acerto do cache" no Painel.
    e.cr = (e.cr || 0) + (u?.cache_read_input_tokens || 0);
    e.cw = (e.cw || 0) + (u?.cache_creation_input_tokens || 0);
    e.ci = (e.ci || 0) + (u?.input_tokens || 0) + (u?.cache_read_input_tokens || 0) + (u?.cache_creation_input_tokens || 0);
    const a = agentId && this.store.getAgent(agentId);
    if (a) (this.s.agentNames ||= {})[a.id] = { name: a.name, role: a.role };
  }

  trackUsage(u, { model, costUsd, agentId, kind = 'chat' } = {}) {
    if (!u && !costUsd) return;
    const us = this.spend();
    us.input += u?.input_tokens || 0;
    us.output += u?.output_tokens || 0;
    us.cacheRead += u?.cache_read_input_tokens || 0;
    us.cacheWrite += u?.cache_creation_input_tokens || 0;
    us.calls += 1;
    const cost = costUsd ?? estimateCost(usageOf(u), model || this.store.company.settings.model);
    us.costUsd += cost;
    us.monthCostUsd += cost;
    this.ledger(agentId, kind, cost, u);
    this.store.save();
    this.emit({ type: 'usage', usage: this.usagePayload() });
  }

  // ---------- mantenedor do cache ----------
  // Cada chamada renova o cache do prompt fixo do agente (TTL de 1 h). chat=true marca uso real.
  cacheTouched(agentId, chat = false) {
    const k = ((this.s.cacheKeep ||= {})[agentId] ||= {});
    k.hotAt = Date.now();
    if (chat) k.chatAt = Date.now();
  }

  // Expediente da empresa (seg–sex, 8h–18h no fuso da empresa, ajustável em settings.cacheHours = [8, 18]).
  inBusinessHours(now = new Date()) {
    const tz = process.env.COMPANY_TZ || 'America/Sao_Paulo';
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric', hourCycle: 'h23' }).formatToParts(now).map((x) => [x.type, x.value]));
    const [from, to] = this.store.company.settings.cacheHours || [8, 18];
    const h = Number(p.hour);
    return !['Sat', 'Sun'].includes(p.weekday) && h >= from && h < to;
  }

  // No expediente, antes de o cache vencer, relê o prompt fixo dos agentes que conversaram nos últimos 3 dias
  // (requisição sem resposta, max_tokens 0). Custa só a leitura do cache; a próxima conversa não paga a gravação.
  // Se a leitura mudar o prompt (memória nova), a regravação é só do bloco que mudou.
  async keepCacheWarm() {
    if (this.warming || CACHE_TTL !== '1h' || this.s.paused || providerFor(this.store) !== 'claude') return;
    if (this.store.company.settings.cacheKeepAlive === false || !this.inBusinessHours() || this.overBudget()) return;
    const now = Date.now();
    const due = this.store.aiAgents().filter((a) => {
      const k = this.s.cacheKeep?.[a.id];
      // só renova cache ainda vivo (52–59 min): regravar um cache vencido custa ~40 leituras, então isso fica
      // para a próxima conversa real. Na prática: a 1ª conversa do dia grava e o mantenedor segura até o fim do expediente.
      const age = now - (k?.hotAt || 0);
      return a.active !== false && k?.chatAt && now - k.chatAt < 3 * 864e5 && age > 52 * 60_000 && age < 59 * 60_000 && !this.agentRuntime(a.id).busy;
    });
    if (!due.length) return;
    this.warming = true;
    try {
      for (const agent of due) {
        const p = profileOf(agent);
        try {
          const res = await warmCache(this.store, { system: this.systemBlocks(agent), tools: this.tools(agent), model: p.model, effort: p.effort });
          if (!res) continue;
          this.trackUsage(res.usage, { model: p.model, agentId: agent.id, kind: 'cache' });
          this.cacheTouched(agent.id);
        } catch (e) {
          console.warn('[cache] mantenedor', agent.id, describeError(e));
          ((this.s.cacheKeep ||= {})[agent.id] ||= {}).hotAt = now; // não insiste a cada minuto
        }
      }
    } finally { this.warming = false; }
  }

  // ---------- ciclo de um agente ----------
  // Pedido feito por mensagem (sem tarefa) que gerou arquivos: entrega na "Minha mesa" de cada pessoa que pediu.
  deliverFromChat(agent, newMessages, files, text) {
    const asks = (newMessages || []).filter((m) => this.isHuman(m.from));
    const people = [...new Set(asks.map((m) => m.from))];
    if (!people.length) return;
    const list = (this.s.deliveries ||= []);
    for (const to of people) {
      const req = asks.filter((m) => m.from === to).map((m) => m.content).join(' / ');
      list.push({ id: `E${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, agentId: agent.id, to, request: String(req).slice(0, 600), text: String(text || '').slice(0, 4000), files: files.slice(0, 20), at: Date.now(), dismissedAt: null });
    }
    if (list.length > 300) this.s.deliveries = list.filter((d) => !d.dismissedAt || Date.now() - d.dismissedAt < 30 * 864e5).slice(-300);
    this.store.save();
  }

  async runAgent(agent) {
    const r = this.agentRuntime(agent.id);
    r.busy = true;
    this.setStatus(agent.id, { status: 'thinking', with: null, bubble: '…' });

    const ctx = this.buildContext(agent);
    for (const m of ctx.newMessages) m.read = true;
    for (const t of ctx.myTasks) t.presented = true;
    this.store.save();

    const provider = providerFor(this.store);
    const system = this.systemBlocks(agent);
    const tools = this.tools(agent);
    const messages = [{ role: 'user', content: ctx.text }];
    const agentModel = profileOf(agent).model;
    // Arquivos produzidos nesta conversa e a última fala do agente: viram "entrega" na mesa de quem pediu.
    const written = new Set();
    let finalText = '';
    let acted = false; // já executou alguma ferramenta (não repetir em caso de erro)

    try {
      for (let step = 0; step < MAX_STEPS; step++) {
        if (this.s.paused) break;
        if (this.overBudget()) { this.pauseForBudget(); break; }

        const res = provider === 'mock'
          ? await callMock({
            agent,
            ctx: {
              ...ctx,
              agents: this.s.agents,
              myTasks: this.s.tasks.filter((t) => t.assigneeId === agent.id && t.status !== 'done'),
              allTasks: this.s.tasks,
              reportedAll: !!this.s.goalReported,
              isHuman: (id) => this.isHuman(id) || id === 'board',
            },
            iteration: step,
          })
          : await callClaude(this.store, { system, messages, tools, model: profileOf(agent).model, effort: profileOf(agent).effort });

        if (provider !== 'mock') { this.trackUsage(res.usage, { model: agentModel, agentId: agent.id, kind: 'chat' }); this.cacheTouched(agent.id, true); r.retries = 0; }
        if (res.stop_reason === 'refusal') {
          this.logEvent('system', agent.id, `${agent.name} não pôde responder (recusa de segurança).`);
          break;
        }
        messages.push({ role: 'assistant', content: res.content });
        if (res.stop_reason === 'pause_turn') continue;

        const toolUses = res.content.filter((b) => b.type === 'tool_use');
        if (res.stop_reason !== 'tool_use' || !toolUses.length) {
          const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ').trim();
          if (text) { finalText = text; this.setStatus(agent.id, { bubble: text.slice(0, 140) }); logActivity(this.store, agent.id, { type: 'text', text }); }
          // Convenção do pacote de CS: uma linha "[ESCALAR] ..." também passa o caso para uma pessoa.
          const esc = text.match(/\[ESCALAR\]\s*([^\n]+)/i);
          if (esc) await this.escalate(agent, { motivo: esc[1].slice(0, 200), resumo: text.slice(0, 3000) });
          break;
        }

        const results = [];
        for (const tool of toolUses) {
          acted = true;
          let out;
          try { out = await this.executeTool(agent, tool.name, tool.input || {}, ctx.taskHint); } catch (e) { out = { error: e.message }; }
          if (tool.name === 'write_file' && !out?.error && tool.input?.path) written.add(String(tool.input.path).replace(/^[/\\]+/, ''));
          if (!['send_message'].includes(tool.name)) {
            logActivity(this.store, agent.id, { type: 'tool', name: tool.name, ok: !out?.error, text: summarizeInput(tool.input), detail: out?.error || out });
          }
          results.push({ type: 'tool_result', tool_use_id: tool.id, content: JSON.stringify(out), is_error: !!out?.error });
          await new Promise((rs) => setTimeout(rs, provider === 'mock' ? 900 : 300));
        }
        messages.push({ role: 'user', content: results });
      }
    } catch (err) {
      const msg = describeError(err);
      console.error('[engine]', this.store.id, agent.id, err);
      // Falha temporária da API (5xx, sobrecarga, limite, rede) antes de o agente agir: devolve as mensagens
      // para a fila e tenta de novo daqui a pouco (1, 3 e 10 min). Se ele já agiu, não repete (evita envio duplicado).
      const tries = (r.retries || 0) + 1;
      if (isTransient(err) && !acted && tries <= 3) {
        for (const m of ctx.newMessages) m.read = false;
        for (const t of ctx.myTasks) t.presented = false;
        r.retries = tries;
        r.retryAt = Date.now() + [60, 180, 600][tries - 1] * 1000;
        this.store.save();
        this.logEvent('system', agent.id, `${agent.name}: a API do Claude ficou instável (${err.status || 'rede'}). Tento de novo em ${[1, 3, 10][tries - 1]} min.`);
      } else {
        r.retries = 0;
        this.logEvent('error', agent.id, `Erro com ${agent.name}: ${msg}${isTransient(err) ? (acted ? ' (não repeti para não duplicar o que já tinha feito)' : ' (desisti depois de 3 tentativas)') : ''}`);
      }
      if (/inválida|permissão|não encontrado/.test(msg)) { this.s.paused = true; this.pushSnapshot(); }
    } finally {
      r.busy = false;
      if (written.size && !ctx.taskHint) this.deliverFromChat(agent, ctx.newMessages, [...written], finalText);
      setTimeout(() => { if (!r.busy) this.setStatus(agent.id, { status: 'idle', with: null, bubble: '' }); }, 2500);
      this.pushSnapshot();
    }
  }
}

// ---------------- agendador global ----------------
export function startScheduler() {
  setInterval(() => {
    let globalActive = 0;
    for (const store of allCompanies()) {
      const run = runtimeFor(store);
      globalActive += store.aiAgents().filter((a) => run.agentRuntime(a.id).busy).length;
    }
    for (const store of allCompanies()) {
      if (store.state.paused || store.company.onboardingStep !== 'done') continue;
      const run = runtimeFor(store);
      let active = store.aiAgents().filter((a) => run.agentRuntime(a.id).busy).length;
      // Oficina: tarefas viram jobs (o runner limita quantos rodam ao mesmo tempo).
      if (Math.random() < 0.01) workbench.sweepStale(run);
      if (Date.now() - (run.lastRoutineTick || 0) > 20_000) {
        run.lastRoutineTick = Date.now();
        syncTaskRuns(store);
        tickRoutines(run).catch((e) => console.error('[rotinas]', e.message));
        tickFunctions(run).catch((e) => console.error('[funções]', e.message));
      }
      if (Date.now() - (run.lastPrWatch || 0) > 60_000) {
        run.lastPrWatch = Date.now();
        workbench.watchPullRequests(run).catch((e) => console.error('[oficina] PRs', e.message));
        workbench.reconcileJobs(run).catch((e) => console.error('[oficina] órfãos', e.message));
        run.keepCacheWarm().catch((e) => console.error('[cache] mantenedor', e.message));
      }
      for (const agent of store.aiAgents()) {
        const task = run.nextJobTask(agent);
        if (task) workbench.startJob(run, agent, task).catch((e) => console.error('[oficina]', e));
      }
      for (const agent of store.aiAgents()) {
        if (active >= MAX_CONCURRENCY || globalActive >= GLOBAL_MAX) break;
        const ar = run.agentRuntime(agent.id);
        if (ar.busy || Date.now() < (ar.retryAt || 0) || !run.hasWork(agent)) continue;
        active++; globalActive++;
        run.runAgent(agent);
      }
    }
  }, TICK_MS);
  console.log(`[engine] agendador ativo (por empresa=${MAX_CONCURRENCY}, global=${GLOBAL_MAX})`);
}
