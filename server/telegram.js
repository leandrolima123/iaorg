// Telegram: a "Minha mesa" de cada pessoa no celular. Genérico (vale para qualquer empresa).
// - O dono conecta UM bot por empresa (token do @BotFather) em Integrações → Telegram.
// - Cada pessoa vincula o próprio Telegram em Minha mesa (código de uso único, 10 min) e escolhe o que recebe.
// - O servidor busca as mensagens do bot (long polling: não precisa de endereço público) e, a cada poucos
//   segundos, confere a mesa de cada pessoa vinculada: mensagens dos agentes, tarefas, pedidos para aprovar,
//   revisões, entregas, mensagens a clientes esperando aprovação e avisos.
// - Pelo Telegram a pessoa responde aos agentes (respondendo a mensagem), dá ordens (texto livre ou /para),
//   aprova/recusa e conclui com botões. Toda ação passa pelas mesmas regras de permissão das telas.
import crypto from 'node:crypto';
import { decrypt } from './secrets.js';

const API = 'https://api.telegram.org';
const SWEEP_MS = 8000;
const CODE_TTL = 10 * 60_000;

export const PREFS = [
  { key: 'messages', label: 'Mensagens e perguntas dos agentes para mim', def: true },
  { key: 'tasks', label: 'Tarefas novas para mim', def: true },
  { key: 'approvals', label: 'Pedidos esperando a minha aprovação', def: true },
  { key: 'reviews', label: 'Trabalhos para eu revisar', def: true },
  { key: 'deliveries', label: 'Entregas e relatórios para mim', def: true },
  { key: 'clientApprovals', label: 'Mensagens a clientes e ações esperando aprovação (administradores)', def: true, admin: true },
  { key: 'alerts', label: 'Avisos da empresa (os mesmos alertas que aparecem na tela)', def: true },
];

// ---------------- API do Telegram ----------------
async function tg(token, method, body = {}, { timeoutMs = 15000 } = {}) {
  const r = await fetch(`${API}/bot${token}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
  });
  const d = await r.json().catch(() => ({}));
  if (!d.ok) { const e = new Error(d.description || `Telegram ${r.status}`); e.code = d.error_code || r.status; throw e; }
  return d.result;
}
export async function verify(token) {
  if (!/^\d{5,}:[\w-]{30,}$/.test(token)) throw new Error('Token em formato inválido (esperado 123456789:ABC…)');
  const me = await tg(token, 'getMe');
  await tg(token, 'deleteWebhook', { drop_pending_updates: false }).catch(() => {}); // long polling exige sem webhook
  return { id: me.id, username: me.username, name: me.first_name };
}
const h = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const cut = (s, n) => { const t = String(s ?? '').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

// ---------------- estado por empresa ----------------
// store.state.telegram = { offset, codes: {code: {memberId, exp}}, links: {memberId: {chatId, user, linkedAt, since, prefs, target, sent: [], replies: {msgId: {...}}}} }
const tgState = (store) => (store.state.telegram ||= { offset: 0, codes: {}, links: {} });
const connOf = (store) => (store.state.integrations?.telegram?.connected ? store.state.integrations.telegram : null);
const tokenOf = (store) => decrypt(connOf(store)?.secret || '');
const prefsOf = (link) => Object.fromEntries(PREFS.map((p) => [p.key, link.prefs?.[p.key] ?? p.def]));
const isAdminM = (m) => ['owner', 'admin'].includes(m?.appRole);

let deps = null; // { allCompanies, runtimeFor, approve }
const loops = new Map(); // store.id -> { token, stop }

export function initTelegram(d) {
  deps = d;
  d.emitHooks.push(onEmit);
  for (const store of d.allCompanies()) ensurePolling(store);
  setInterval(() => { for (const store of d.allCompanies()) if (connOf(store)) sweep(store).catch((e) => console.error('[telegram] mesa', e.message)); }, SWEEP_MS);
}

/** Liga (ou religa, se o token mudou) a leitura das mensagens do bot desta empresa. */
export function ensurePolling(store) {
  const token = connOf(store) ? tokenOf(store) : '';
  const cur = loops.get(store.id);
  if (cur && cur.token === token) return;
  if (cur) cur.stop = true;
  if (!token) { loops.delete(store.id); return; }
  const loop = { token, stop: false };
  loops.set(store.id, loop);
  (async () => {
    let backoff = 2000;
    while (!loop.stop) {
      try {
        const st = tgState(store);
        const ups = await tg(token, 'getUpdates', { offset: st.offset || 0, timeout: 25, allowed_updates: ['message', 'callback_query'] }, { timeoutMs: 35000 });
        backoff = 2000;
        for (const u of ups) {
          st.offset = u.update_id + 1;
          await handleUpdate(store, token, u).catch((e) => console.error('[telegram] update', e.message));
        }
        if (ups.length) store.save();
        const c = connOf(store);
        if (c?.error) { c.error = ''; store.save(); }
      } catch (e) {
        if (loop.stop) break;
        const c = connOf(store);
        const msg = e.code === 409 ? 'Este bot está sendo lido por outro programa (ou por outra empresa do IAORG). Use um bot só para esta empresa.' : e.code === 401 ? 'Token do bot inválido ou revogado. Conecte de novo com um token novo.' : e.message;
        if (c && c.error !== msg) { c.error = msg; store.save(); }
        if (e.code === 401) { loops.delete(store.id); return; }
        await new Promise((r) => setTimeout(r, backoff));
        backoff = Math.min(backoff * 2, 60000);
      }
    }
  })();
}

// ---------------- envio ----------------
async function send(store, memberId, text, { buttons, reply } = {}) {
  const link = tgState(store).links[memberId];
  const token = tokenOf(store);
  if (!link || !token) return null;
  const m = await tg(token, 'sendMessage', {
    chat_id: link.chatId, text: cut(text, 4000), parse_mode: 'HTML', disable_web_page_preview: true,
    ...(buttons ? { reply_markup: { inline_keyboard: buttons } } : {}),
  }).catch((e) => { console.error('[telegram] envio', e.message); return null; });
  if (m && reply) {
    link.replies ||= {};
    link.replies[m.message_id] = reply;
    const ids = Object.keys(link.replies);
    if (ids.length > 400) for (const id of ids.slice(0, ids.length - 400)) delete link.replies[id];
  }
  return m;
}
const markSent = (link, key) => { link.sent ||= []; link.sent.push(key); if (link.sent.length > 800) link.sent.splice(0, link.sent.length - 800); };

// ---------------- a mesa de cada pessoa → Telegram ----------------
const running = new WeakSet();
async function sweep(store) {
  if (running.has(store)) return;
  running.add(store);
  try {
    const st = tgState(store);
    const s = store.state;
    const name = (id) => (id === 'board' ? store.owner()?.name || 'Dono' : store.getAgent(id)?.name || id);
    for (const [memberId, link] of Object.entries(st.links)) {
      const me = store.getAgent(memberId);
      if (!me || me.active === false || me.kind !== 'human') continue;
      const p = prefsOf(link);
      const sent = new Set(link.sent || []);
      const fresh = (key, ts) => !sent.has(key) && (ts || 0) >= (link.since || 0);
      const out = [];
      // mensagens dos agentes para mim (perguntas, avisos, respostas)
      if (p.messages) for (const m of s.messages.slice(-200)) {
        const toMe = m.to === memberId || (m.to === 'board' && me.appRole === 'owner');
        const from = store.getAgent(m.from);
        if (!toMe || !from || from.kind === 'human' || !fresh(`m:${m.id}`, m.ts)) continue;
        out.push({ key: `m:${m.id}`, text: `💬 <b>${h(from.name)}</b> <i>(${h(from.role)})</i>\n${h(cut(m.content, 3500))}\n\n<i>Responda esta mensagem para falar com ${h(from.name.split(' ')[0])}.</i>`, reply: { kind: 'msg', agentId: from.id } });
      }
      for (const t of s.tasks.slice(-300)) {
        const assignee = store.getAgent(t.assigneeId);
        // tarefa nova para mim
        if (p.tasks && t.assigneeId === memberId && ['todo', 'doing'].includes(t.status) && fresh(`t:${t.id}`, t.createdAt)) {
          out.push({ key: `t:${t.id}`, text: `📋 <b>Nova tarefa ${h(t.id)}</b> de ${h(name(t.creatorId))}\n<b>${h(t.title)}</b>${t.description ? `\n${h(cut(t.description, 1500))}` : ''}\n\n<i>Responda esta mensagem para anotar algo na tarefa.</i>`, buttons: [[{ text: '✅ Concluir', callback_data: `td|${t.id}` }]], reply: { kind: 'task', taskId: t.id } });
        }
        // pedido entre áreas esperando a minha aprovação
        if (p.approvals && t.status === 'approval' && t.approval?.by === memberId && fresh(`a:${t.id}:${t.approval.requestedAt}`, t.approval.requestedAt)) {
          out.push({ key: `a:${t.id}:${t.approval.requestedAt}`, text: `🟡 <b>Pedido para aprovar</b> · ${h(t.id)}\n${h(name(t.creatorId))} pede a <b>${h(assignee?.name || t.assigneeId)}</b>: ${h(t.title)}${t.approval.reason ? `\nMotivo: ${h(cut(t.approval.reason, 600))}` : ''}${t.description ? `\n${h(cut(t.description, 800))}` : ''}\n\n<i>Para recusar com orientação, responda esta mensagem.</i>`, buttons: [[{ text: '✅ Aprovar', callback_data: `ta|${t.id}|ok` }, { text: '✖ Recusar', callback_data: `ta|${t.id}|no` }]], reply: { kind: 'approval', taskId: t.id } });
        }
        // trabalho de agente esperando a minha revisão
        if (p.reviews && t.status === 'review' && t.creatorId === memberId && assignee && assignee.kind !== 'human') {
          const key = `r:${t.id}:${String(t.result || '').length}`;
          if (fresh(key, t.updatedAt)) out.push({ key, text: `🔎 <b>Para revisar</b> · ${h(t.id)} · ${h(assignee.name)}\n<b>${h(t.title)}</b>${t.result ? `\n${h(cut(t.result, 2500))}` : ''}\n\n<i>Para pedir ajuste, responda esta mensagem com o que mudar.</i>`, buttons: [[{ text: '✅ Aprovar e concluir', callback_data: `rv|${t.id}` }]], reply: { kind: 'review', taskId: t.id } });
        }
        // entrega (tarefa concluída por agente para mim)
        if (p.deliveries && t.desk?.to === memberId && !t.desk.dismissedAt && fresh(`d:${t.id}`, t.desk.at)) {
          out.push({ key: `d:${t.id}`, text: `📦 <b>Entrega</b> · ${h(t.id)} · ${h(assignee?.name || '')}\n<b>${h(t.title)}</b>${t.result ? `\n${h(cut(t.result, 2500))}` : ''}`, buttons: [[{ text: '🗂 Arquivar', callback_data: `dt|${t.id}` }]], reply: assignee && assignee.kind !== 'human' ? { kind: 'msg', agentId: assignee.id } : null });
        }
      }
      // entregas por conversa (arquivos gerados a partir de um pedido por mensagem)
      if (p.deliveries) for (const d of (s.deliveries || []).slice(-100)) {
        if (d.to !== memberId || d.dismissedAt || !fresh(`dc:${d.id}`, d.at)) continue;
        out.push({ key: `dc:${d.id}`, text: `📦 <b>Entrega</b> de ${h(name(d.agentId))}${d.request ? `\nPedido: ${h(cut(d.request, 300))}` : ''}${d.text ? `\n${h(cut(d.text, 2000))}` : ''}${d.files?.length ? `\nArquivos: ${d.files.map((f) => `<code>${h(f.path || f)}</code>`).join(', ')}` : ''}`, buttons: [[{ text: '🗂 Arquivar', callback_data: `dd|${d.id}` }]], reply: { kind: 'msg', agentId: d.agentId } });
      }
      // ações de agentes esperando aprovação (e-mail, chat, WhatsApp, anúncios, ordens…): administradores
      if (p.clientApprovals && isAdminM(me)) for (const a of (s.approvals || []).filter((x) => x.status === 'pending')) {
        if (!fresh(`c:${a.id}`, a.ts)) continue;
        const ch = { email: 'E-mail', chat: 'Chat do site', whatsapp: 'WhatsApp', ads: 'Google Ads', trade: 'Ordem na Binance', social: a.tool === 'social_responder' ? 'Resposta nas redes sociais' : 'Post nas redes sociais' }[a.channel] || 'Ação';
        out.push({ key: `c:${a.id}`, text: `✉️ <b>${h(ch)} esperando aprovação</b> · ${h(name(a.agentId))}${a.preview?.para ? `\nPara: ${h(a.preview.para)}` : ''}${a.preview?.assunto ? `\nAssunto: ${h(a.preview.assunto)}` : ''}${a.preview?.imagens?.length ? `\nImagens: ${a.preview.imagens.map((p) => `<code>${h(p)}</code>`).join(', ')} (veja em Minha mesa)` : ''}\n\n${h(cut(a.text, 2500))}\n\n<i>Para descartar com orientação ao agente, responda esta mensagem.</i>`, buttons: [[{ text: '✅ Aprovar e enviar', callback_data: `ca|${a.id}|ok` }, { text: '🗑 Descartar', callback_data: `ca|${a.id}|no` }]], reply: { kind: 'clientApproval', approvalId: a.id } });
      }
      for (const o of out.slice(0, 15)) { // no máximo 15 por rodada: o resto vai na próxima
        markSent(link, o.key);
        await send(store, memberId, o.text, { buttons: o.buttons, reply: o.reply });
      }
      if (out.length) store.save();
    }
  } finally { running.delete(store); }
}

// Avisos que já aparecem na tela (notify) também vão para o Telegram de quem quiser.
// Os que a mesa já manda com botões (tarefa nova, pedido de aprovação) não repetem.
function onEmit(rt, msg) {
  if (msg?.type !== 'notify' || !msg.to || !connOf(rt.store)) return;
  const link = tgState(rt.store).links[msg.to];
  if (!link || !prefsOf(link).alerts) return;
  if (/^Nova tarefa |pede aprovação|pediu aprovação/.test(msg.text)) return;
  send(rt.store, msg.to, `🔔 ${h(msg.text)}`).catch(() => {});
}

// ---------------- Telegram → empresa ----------------
const findLinked = (store, chatId) => Object.entries(tgState(store).links).find(([, l]) => l.chatId === chatId);

async function handleUpdate(store, token, u) {
  if (u.callback_query) return handleButton(store, token, u.callback_query);
  const msg = u.message;
  if (!msg?.chat || msg.chat.type !== 'private') return; // só conversa direta com o bot
  const text = String(msg.text || '').trim();
  const st = tgState(store);
  const start = text.match(/^\/start(?:@\w+)?\s+([A-Za-z0-9_-]{6,64})$/);
  if (start) return linkChat(store, token, msg, start[1]);
  const found = findLinked(store, msg.chat.id);
  if (!found) {
    return tg(token, 'sendMessage', { chat_id: msg.chat.id, text: 'Olá! Para usar este bot, abra o IAORG → Minha mesa → Telegram → "Vincular meu Telegram" e siga o link que aparece.' }).catch(() => {});
  }
  const [memberId, link] = found;
  const me = store.getAgent(memberId);
  if (!me || me.active === false) return;
  const rt = deps.runtimeFor(store);
  const reply = (t, extra = {}) => tg(token, 'sendMessage', { chat_id: msg.chat.id, text: cut(t, 4000), parse_mode: 'HTML', disable_web_page_preview: true, ...extra }).catch(() => {});
  if (!text) return reply('Por enquanto o bot entende só texto.');

  // resposta a uma mensagem do bot: vai para o lugar certo
  const ref = msg.reply_to_message && link.replies?.[msg.reply_to_message.message_id];
  if (ref && !text.startsWith('/')) return handleReply(store, rt, me, ref, text, reply);

  const cmd = text.match(/^\/(\w+)(?:@\w+)?\s*([\s\S]*)$/);
  if (cmd) {
    const [, c, arg] = cmd;
    if (c === 'start' || c === 'ajuda' || c === 'help') return reply(helpText(store, link));
    if (c === 'mesa') return reply(deskSummary(store, me));
    if (c === 'tarefas') return reply(myTasksText(store, me));
    if (c === 'agentes') return reply(agentsText(store));
    if (c === 'para') {
      const m = arg.match(/^(\S+)\s+([\s\S]+)$/);
      if (!m) return reply('Use: /para Nome mensagem\nEx.: /para Paula como foi o dia?');
      const target = findAgent(store, m[1]);
      if (!target) return reply(`Não achei "${h(m[1])}". Veja os nomes com /agentes.`);
      rt.postMessage(me.id, target.id, m[2].trim());
      return reply(`Enviado para <b>${h(target.name)}</b>. A resposta chega aqui.`);
    }
    return reply(`Comando desconhecido. ${helpText(store, link)}`);
  }
  // texto livre: uma ordem para o agente escolhido (ou o do topo, como a barra "Nova ordem")
  const target = store.getAgent(link.target);
  const to = target && target.active !== false && target.kind !== 'human' && target.kind !== 'function' ? target
    : store.aiAgents().find((a) => a.active !== false && (!a.reportsTo || store.getAgent(a.reportsTo)?.kind === 'human')) || store.aiAgents()[0];
  if (!to) return reply('Não há agentes de IA nesta empresa.');
  rt.postMessage(me.id, to.id, text);
  return reply(`Ordem enviada para <b>${h(to.name)}</b>. A resposta chega aqui.`);
}

async function linkChat(store, token, msg, code) {
  const st = tgState(store);
  const c = st.codes[code];
  const say = (t) => tg(token, 'sendMessage', { chat_id: msg.chat.id, text: t, parse_mode: 'HTML' }).catch(() => {});
  if (!c || c.exp < Date.now()) { delete st.codes[code]; store.save(); return say('Este código expirou ou já foi usado. Gere outro no IAORG (Minha mesa → Telegram).'); }
  delete st.codes[code];
  const me = store.getAgent(c.memberId);
  if (!me || me.active === false) { store.save(); return say('Este código não vale mais.'); }
  // um chat só fica ligado a uma pessoa nesta empresa
  for (const [id, l] of Object.entries(st.links)) if (l.chatId === msg.chat.id && id !== me.id) delete st.links[id];
  const prev = st.links[me.id];
  st.links[me.id] = {
    chatId: msg.chat.id, user: [msg.from?.first_name, msg.from?.username ? `@${msg.from.username}` : ''].filter(Boolean).join(' '),
    linkedAt: Date.now(), since: Date.now(), prefs: prev?.prefs || {}, target: prev?.target || '', sent: [], replies: {},
  };
  store.save();
  deps.runtimeFor(store).logEvent('system', me.id, `${me.name} vinculou o Telegram à Minha mesa.`);
  deps.runtimeFor(store).pushSnapshot();
  return say(`✅ Pronto, <b>${h(me.name.split(' ')[0])}</b>! Seu Telegram está ligado à sua mesa em <b>${h(store.company.name)}</b>.\n\n${helpText(store, st.links[me.id])}`);
}

async function handleReply(store, rt, me, ref, text, reply) {
  const s = store.state;
  if (ref.kind === 'msg') {
    const a = store.getAgent(ref.agentId);
    if (!a || a.active === false) return reply('Esse agente não está mais na empresa.');
    rt.postMessage(me.id, a.id, text);
    return reply(`Enviado para <b>${h(a.name)}</b>.`);
  }
  const t = ref.taskId && s.tasks.find((x) => x.id === ref.taskId);
  if (ref.kind === 'task') {
    if (!t || (t.assigneeId !== me.id && t.creatorId !== me.id && !isAdminM(me))) return reply('Tarefa não encontrada.');
    t.description = `${t.description || ''}\n\n${me.name} (${new Date().toLocaleDateString('pt-BR')}, pelo Telegram): ${text}`.trim();
    t.updatedAt = Date.now(); store.save(); rt.pushSnapshot();
    return reply(`Anotado na tarefa ${h(t.id)}.`);
  }
  if (ref.kind === 'review') {
    if (!t || t.status !== 'review' || (t.creatorId !== me.id && !isAdminM(me))) return reply('Esta revisão já foi tratada.');
    t.description = `${t.description || ''}\n\n${me.name} (${new Date().toLocaleDateString('pt-BR')}, pelo Telegram) pediu ajuste: ${text}`.trim();
    t.presented = false; delete t.retryAt;
    rt.updateTask(t, { status: 'todo' }, me.id);
    return reply(`Pedido de ajuste enviado: ${h(t.id)} voltou para o agente.`);
  }
  if (ref.kind === 'approval') {
    if (!t || t.status !== 'approval') return reply('Este pedido já foi decidido.');
    if (t.approval?.by !== me.id && !isAdminM(me)) return reply('Só quem aprova (ou um administrador) decide este pedido.');
    const r = rt.decideApproval(t, { decision: 'recusar', reason: text }, me.id);
    return reply(r.error ? h(r.error) : `Pedido ${h(t.id)} recusado com a sua orientação.`);
  }
  if (ref.kind === 'clientApproval') return rejectClient(store, rt, me, ref.approvalId, text, reply);
  return reply('Não sei para onde mandar esta resposta.');
}

async function rejectClient(store, rt, me, id, reason, reply) {
  if (!isAdminM(me)) return reply('Só administradores decidem isso.');
  const item = (store.state.approvals || []).find((x) => x.id === id && x.status === 'pending');
  if (!item) return reply('Este item já foi tratado.');
  Object.assign(item, { status: 'rejected', decidedAt: Date.now(), decidedBy: me.name, reason: String(reason || '').slice(0, 500) });
  store.save();
  rt.logEvent('task', me.id, `${me.name} descartou a ação de ${store.getAgent(item.agentId)?.name || 'agente'} pelo Telegram${reason ? `: ${reason}` : ''}.`);
  if (reason && store.getAgent(item.agentId)) rt.postMessage(me.id, item.agentId, `Descartei seu rascunho para ${item.preview?.para || 'o cliente'} (${item.tool}, ${JSON.stringify({ session_id: item.input?.session_id, email_id: item.input?.email_id })}). Orientação: ${reason}. Refaça a resposta.`);
  rt.pushSnapshot();
  return reply(reason ? 'Descartado; o agente recebeu a sua orientação.' : 'Descartado.');
}

async function handleButton(store, token, q) {
  const answer = (text) => tg(token, 'answerCallbackQuery', { callback_query_id: q.id, text: cut(text, 190) }).catch(() => {});
  const found = findLinked(store, q.message?.chat?.id);
  if (!found) return answer('Este Telegram não está vinculado.');
  const me = store.getAgent(found[0]);
  if (!me || me.active === false) return answer('Sem acesso.');
  const rt = deps.runtimeFor(store);
  const s = store.state;
  const [kind, id, opt] = String(q.data || '').split('|');
  const t = s.tasks.find((x) => x.id === id);
  let done = '';
  try {
    if (kind === 'td') {
      if (!t || (t.assigneeId !== me.id && !isAdminM(me))) return answer('Tarefa não encontrada.');
      if (t.status === 'done') done = 'Já estava concluída';
      else { rt.updateTask(t, { status: 'done', result: 'Concluída pelo Telegram.' }, me.id); done = `${t.id} concluída`; }
    } else if (kind === 'ta') {
      if (!t || t.status !== 'approval') return answer('Este pedido já foi decidido.');
      if (t.approval?.by !== me.id && !isAdminM(me)) return answer('Só quem aprova decide.');
      const r = rt.decideApproval(t, { decision: opt === 'ok' ? 'aprovar' : 'recusar', reason: opt === 'ok' ? '' : 'Recusado pelo Telegram' }, me.id);
      if (r.error) return answer(r.error);
      done = opt === 'ok' ? `${t.id} aprovado` : `${t.id} recusado`;
    } else if (kind === 'rv') {
      if (!t || t.status !== 'review') return answer('Esta revisão já foi tratada.');
      if (t.creatorId !== me.id && !isAdminM(me)) return answer('Só quem pediu revisa.');
      rt.updateTask(t, { status: 'done' }, me.id);
      done = `${t.id} aprovada e concluída`;
    } else if (kind === 'dt') {
      if (!t?.desk || (t.desk.to !== me.id && !isAdminM(me))) return answer('Entrega não encontrada.');
      t.desk.dismissedAt = Date.now(); store.save(); rt.pushSnapshot(); done = 'Arquivada';
    } else if (kind === 'dd') {
      const d = (s.deliveries || []).find((x) => x.id === id);
      if (!d || (d.to !== me.id && !isAdminM(me))) return answer('Entrega não encontrada.');
      d.dismissedAt = Date.now(); store.save(); rt.pushSnapshot(); done = 'Arquivada';
    } else if (kind === 'ca') {
      if (!isAdminM(me)) return answer('Só administradores decidem isso.');
      const item = (s.approvals || []).find((x) => x.id === id && x.status === 'pending');
      if (!item) return answer('Este item já foi tratado.');
      if (opt === 'ok') {
        await deps.approve(rt, item, { byName: me.name });
        rt.logEvent('task', me.id, `${me.name} aprovou pelo Telegram a ação de ${store.getAgent(item.agentId)?.name || 'agente'}.`);
        rt.pushSnapshot();
        done = 'Aprovado e enviado';
      } else { await rejectClient(store, rt, me, id, '', async () => {}); done = 'Descartado'; }
    } else return answer('Ação desconhecida.');
  } catch (e) { return answer(`Não deu certo: ${e.message}`); }
  answer(done);
  // marca a mensagem como resolvida e tira os botões
  tg(token, 'editMessageReplyMarkup', { chat_id: q.message.chat.id, message_id: q.message.message_id, reply_markup: { inline_keyboard: [[{ text: `✔ ${done}`, callback_data: 'x|x' }]] } }).catch(() => {});
}

// ---------------- textos ----------------
function findAgent(store, q) {
  const n = String(q).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const list = store.aiAgents().filter((a) => a.active !== false);
  return list.find((a) => a.id === q) || list.find((a) => norm(a.name.split(' ')[0]) === n) || list.find((a) => norm(a.name).includes(n) || norm(a.role).includes(n));
}
function helpText(store, link) {
  const target = store.getAgent(link?.target);
  return [
    '<b>Como usar</b>',
    `• Escreva qualquer coisa: vira uma ordem para <b>${h(target?.name || 'o agente do topo')}</b> (troque em Minha mesa → Telegram).`,
    '• Responda uma mensagem do bot para responder ao agente, anotar na tarefa ou pedir ajuste.',
    '• /para Nome mensagem: fala com um agente específico',
    '• /mesa: o que espera por você agora',
    '• /tarefas: suas tarefas abertas',
    '• /agentes: quem está na equipe',
  ].join('\n');
}
function deskSummary(store, me) {
  const s = store.state;
  const appr = s.tasks.filter((t) => t.status === 'approval' && t.approval?.by === me.id);
  const rev = s.tasks.filter((t) => t.status === 'review' && t.creatorId === me.id && store.getAgent(t.assigneeId)?.kind !== 'human');
  const del = s.tasks.filter((t) => t.desk?.to === me.id && !t.desk.dismissedAt).length + (s.deliveries || []).filter((d) => d.to === me.id && !d.dismissedAt).length;
  const mine = s.tasks.filter((t) => t.assigneeId === me.id && !['done'].includes(t.status));
  const client = isAdminM(me) ? (s.approvals || []).filter((x) => x.status === 'pending').length : 0;
  const lines = [
    appr.length && `🟡 ${appr.length} pedido(s) para aprovar`,
    client && `✉️ ${client} ação(ões) a clientes esperando aprovação`,
    rev.length && `🔎 ${rev.length} trabalho(s) para revisar`,
    del && `📦 ${del} entrega(s)`,
    mine.length && `📋 ${mine.length} tarefa(s) com você`,
  ].filter(Boolean);
  return `<b>Minha mesa · ${h(store.company.name)}</b>\n${lines.length ? lines.join('\n') : 'Nada esperando por você agora. ✅'}`;
}
function myTasksText(store, me) {
  const mine = store.state.tasks.filter((t) => t.assigneeId === me.id && t.status !== 'done').slice(-15);
  const label = { todo: 'a fazer', doing: 'fazendo', review: 'em revisão', blocked: 'bloqueada', approval: 'aguardando aprovação' };
  return mine.length ? `<b>Suas tarefas</b>\n${mine.map((t) => `• ${h(t.id)} (${label[t.status] || t.status}): ${h(t.title)}`).join('\n')}` : 'Nenhuma tarefa aberta com você.';
}
function agentsText(store) {
  const list = store.aiAgents().filter((a) => a.active !== false);
  return list.length ? `<b>Equipe</b> (use o primeiro nome no /para)\n${list.map((a) => `• ${h(a.name)} · ${h(a.role)}`).join('\n')}` : 'Não há agentes de IA nesta empresa.';
}

// ---------------- rotas (cada pessoa configura o próprio) ----------------
export function mountTelegram(app, { requireCompany, wrap, runtimeFor }) {
  const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
  const view = (store, member) => {
    const c = connOf(store);
    const link = tgState(store).links[member.id];
    return {
      connected: !!c, bot: c?.config?.botUsername || null, error: c?.error || '',
      linked: link ? { user: link.user, linkedAt: link.linkedAt } : null,
      prefs: link ? prefsOf(link) : Object.fromEntries(PREFS.map((p) => [p.key, p.def])),
      prefList: PREFS.filter((p) => !p.admin || isAdminM(member)).map(({ key, label }) => ({ key, label })),
      target: link?.target || '',
      targets: store.aiAgents().filter((a) => a.active !== false).map((a) => ({ id: a.id, label: `${a.name} — ${a.role}` })),
    };
  };
  app.get('/api/telegram/me', requireCompany, (req, res) => res.json(view(req.company, req.member)));

  app.post('/api/telegram/link', requireCompany, (req, res) => {
    const store = req.company;
    const c = connOf(store);
    if (!c) return bad(res, 'O Telegram ainda não foi conectado nesta empresa (Integrações → Telegram).');
    if (req.member.kind !== 'human' || req.tokenAuth) return bad(res, 'Só pessoas vinculam o Telegram.', 403);
    const st = tgState(store);
    for (const [k, v] of Object.entries(st.codes)) if (v.exp < Date.now() || v.memberId === req.member.id) delete st.codes[k];
    const code = crypto.randomBytes(12).toString('base64url');
    st.codes[code] = { memberId: req.member.id, exp: Date.now() + CODE_TTL };
    store.save();
    ensurePolling(store);
    res.json({ code, url: c.config?.botUsername ? `https://t.me/${c.config.botUsername}?start=${code}` : null, expiresInMin: CODE_TTL / 60000 });
  });

  app.put('/api/telegram/me', requireCompany, (req, res) => {
    const store = req.company;
    const link = tgState(store).links[req.member.id];
    if (!link) return bad(res, 'Vincule o seu Telegram primeiro.');
    const p = req.body?.prefs || {};
    link.prefs = Object.fromEntries(PREFS.map((x) => [x.key, p[x.key] === undefined ? prefsOf(link)[x.key] : !!p[x.key]]));
    if (req.body?.target !== undefined) { const t = store.getAgent(req.body.target); link.target = t && t.kind !== 'human' && t.kind !== 'function' ? t.id : ''; }
    store.save();
    res.json(view(store, req.member));
  });

  app.post('/api/telegram/test', requireCompany, wrap(async (req, res) => {
    const store = req.company;
    if (!tgState(store).links[req.member.id]) return bad(res, 'Vincule o seu Telegram primeiro.');
    const m = await send(store, req.member.id, `👋 Teste do IAORG: sua mesa em <b>${h(store.company.name)}</b> chega aqui.\n\n${deskSummary(store, req.member)}`);
    if (!m) return bad(res, 'Não consegui enviar. Confira se você não bloqueou o bot.');
    res.json({ ok: true });
  }));

  app.delete('/api/telegram/me', requireCompany, (req, res) => {
    const store = req.company;
    const st = tgState(store);
    if (st.links[req.member.id]) {
      send(store, req.member.id, 'Telegram desvinculado da sua mesa. Até mais!').catch(() => {});
      delete st.links[req.member.id];
      store.save();
      runtimeFor(store).logEvent('system', req.member.id, `${req.member.name} desvinculou o Telegram.`);
    }
    res.json(view(store, req.member));
  });
}

/** Para a tela de Integrações: quem vinculou. */
export const linkedPeople = (store) => Object.entries(store.state.telegram?.links || {}).map(([id, l]) => ({ id, name: store.getAgent(id)?.name || id, user: l.user, linkedAt: l.linkedAt }));
/** Ao desconectar o bot: para a leitura; ao trocar de bot, os vínculos antigos não valem mais. */
export function onDisconnect(store) { ensurePolling(store); }
export function onConnect(store, botId) {
  const st = tgState(store);
  if (st.botId && st.botId !== botId) { st.links = {}; st.codes = {}; st.offset = 0; }
  st.botId = botId;
  store.save();
  ensurePolling(store);
}
