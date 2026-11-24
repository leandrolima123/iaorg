// WhatsApp pessoal (o seu número, como "aparelho conectado"), via Baileys.
// NÃO é a API oficial: o WhatsApp não permite automação de contas pessoais e pode bloquear o número.
// Por isso a integração é conservadora:
// - só guarda e mostra mensagens dos grupos/contatos que você escolheu (e as menções a você);
// - não marca como lida, não fica "online", não baixa mídia;
// - envio só para conversas escolhidas (ou onde você foi marcado), e por padrão passa pela sua aprovação.
import fs from 'node:fs';
import path from 'node:path';
import QRCode from 'qrcode';

// Grupos movimentados passam de 100 mensagens num dia: guardamos 500 por conversa escolhida,
// o bastante para o resumo diário (aprendizado) ler tudo o que é novo.
const KEEP_PER_CHAT = 500;
let lib;
const baileys = async () => (lib ||= await import('baileys'));
const silent = { level: 'silent', child() { return this; }, trace() {}, debug() {}, info() {}, warn() {}, error() {}, fatal() {} };

/** companyId -> sessão */
const sessions = new Map();
const bare = (jid) => String(jid || '').replace(/:\d+(?=@)/, '');
const isGroup = (jid) => String(jid || '').endsWith('@g.us');

function dirOf(store) { return path.join(store.dir, 'whatsapp-web'); }

function loadMessages(store) {
  try { return { contacts: {}, ...JSON.parse(fs.readFileSync(path.join(dirOf(store), 'messages.json'), 'utf8')) }; } catch { return { chats: {}, recent: {}, contacts: {} }; }
}

function textOf(m) {
  const x = m.message || {};
  const inner = x.ephemeralMessage?.message || x.viewOnceMessage?.message || x.viewOnceMessageV2?.message || x;
  return inner.conversation || inner.extendedTextMessage?.text || inner.imageMessage?.caption || inner.videoMessage?.caption
    || inner.documentMessage?.caption || (inner.imageMessage ? '(imagem)' : inner.audioMessage ? '(áudio)' : inner.videoMessage ? '(vídeo)'
    : inner.stickerMessage ? '(figurinha)' : inner.documentMessage ? `(documento ${inner.documentMessage.fileName || ''})` : inner.reactionMessage ? null : null);
}
const ctxOf = (m) => {
  const x = m.message || {};
  const inner = x.ephemeralMessage?.message || x;
  return inner.extendedTextMessage?.contextInfo || inner.imageMessage?.contextInfo || inner.videoMessage?.contextInfo || null;
};

export function status(store) {
  const s = sessions.get(store.id);
  if (!s) return { status: 'stopped' };
  return { status: s.status, qr: s.status === 'qr' ? s.qr : null, me: s.me || null, error: s.error || '' };
}

/**
 * Liga (ou retoma) a sessão da empresa.
 * hooks.onMessage(store, msg) é chamado para cada mensagem nova recebida (não as suas).
 * hooks.onStatus(store, status) a cada mudança (conectado, QR, saiu).
 */
export async function start(store, hooks) {
  const prev = sessions.get(store.id);
  if (prev && ['connecting', 'qr', 'open'].includes(prev.status)) return status(store);
  const B = await baileys();
  const dir = dirOf(store);
  fs.mkdirSync(path.join(dir, 'auth'), { recursive: true });
  const { state, saveCreds } = await B.useMultiFileAuthState(path.join(dir, 'auth'));
  let version;
  try { version = (await B.fetchLatestBaileysVersion()).version; } catch { /* usa a padrão da biblioteca */ }
  const s = prev || { data: loadMessages(store), raw: new Map(), stopped: false, saveTimer: null };
  Object.assign(s, { status: 'connecting', qr: null, error: '', stopped: false, hooks });
  sessions.set(store.id, s);

  const sock = B.makeWASocket({
    auth: state, logger: silent, version, browser: B.Browsers.ubuntu('IAORG'),
    // Sincronização inicial só para a agenda (nomes dos contatos e das conversas); o conteúdo antigo das mensagens é descartado.
    markOnlineOnConnect: false, syncFullHistory: false, shouldSyncHistoryMessage: () => true,
    generateHighQualityLinkPreview: false, getMessage: async () => undefined,
  });
  s.sock = sock;
  sock.ev.on('creds.update', saveCreds);
  sock.ev.on('connection.update', async (u) => {
    if (u.qr) {
      s.status = 'qr';
      s.qr = await QRCode.toDataURL(u.qr, { margin: 1, width: 280 });
      hooks.onStatus?.(store, status(store));
    }
    if (u.connection === 'open') {
      const me = sock.user || {};
      s.status = 'open'; s.qr = null; s.error = '';
      s.me = { id: bare(me.id), lid: bare(me.lid), name: me.name || me.notify || '', phone: bare(me.id).split('@')[0] };
      hooks.onStatus?.(store, status(store));
    }
    if (u.connection === 'close') {
      const code = u.lastDisconnect?.error?.output?.statusCode;
      if (s.stopped) { s.status = 'stopped'; return; }
      if (code === B.DisconnectReason.loggedOut) {
        s.status = 'logged_out'; s.error = 'O aparelho foi desconectado no celular. Conecte de novo lendo o QR code.';
        fs.rmSync(path.join(dir, 'auth'), { recursive: true, force: true });
        hooks.onStatus?.(store, status(store));
        return;
      }
      if (code === B.DisconnectReason.connectionReplaced) {
        s.status = 'error'; s.error = 'Outra sessão do IAORG assumiu este número. Reconecte por aqui se quiser voltar a usar.';
        hooks.onStatus?.(store, status(store));
        return;
      }
      s.status = 'connecting';
      setTimeout(() => { if (!s.stopped) { s.status = 'reconnecting'; start(store, hooks).catch(() => {}); } }, code === B.DisconnectReason.restartRequired ? 500 : 5000);
    }
  });
  // Agenda: só nome e número, para você escolher quais contatos liberar.
  const saveContacts = (list) => { for (const ct of list || []) addContactName(s, ct); persist(store, s); };
  sock.ev.on('contacts.upsert', saveContacts);
  sock.ev.on('contacts.update', saveContacts);
  sock.ev.on('messaging-history.set', ({ contacts, chats }) => {
    saveContacts(contacts);
    for (const ch of chats || []) if (ch.id && !isGroup(ch.id) && ch.name) addContactName(s, { id: ch.id, name: ch.name });
  });
  sock.ev.on('messages.upsert', ({ messages, type }) => {
    for (const m of messages) {
      const rec = record(store, s, m);
      if (rec && type === 'notify' && !rec.fromMe) hooks.onMessage?.(store, rec);
    }
  });
  return status(store);
}

function addContactName(s, ct) {
  const id = ct?.id;
  if (!id || isGroup(id) || id === 'status@broadcast' || id.endsWith('@broadcast') || id.endsWith('@newsletter')) return;
  const book = (s.data.contacts ||= {});
  const prev = book[id] || {};
  const pn = ct.phoneNumber || (id.endsWith('@s.whatsapp.net') ? id : prev.pn);
  book[id] = { name: ct.name || prev.name || '', notify: ct.notify || ct.verifiedName || prev.notify || '', pn: pn ? bare(pn) : '', lid: ct.lid || (id.endsWith('@lid') ? id : prev.lid || '') };
}

/** Guarda a mensagem se ela importa (conversa escolhida ou menção a você). Devolve o registro. */
function record(store, s, m) {
  let chat = m.key?.remoteJid;
  if (!chat || chat === 'status@broadcast' || !m.message) return null;
  let chatAlt = m.key.remoteJidAlt || null;
  // Conversa individual chegando pelo LID: guarda pelo número (@s.whatsapp.net), o mesmo id que você escolhe e usa para enviar.
  if (chat.endsWith('@lid')) {
    const pn = chatAlt?.endsWith('@s.whatsapp.net') ? chatAlt : s.data.contacts?.[chat]?.pn;
    if (pn) { chatAlt = chat; chat = bare(pn); }
  }
  const text = textOf(m);
  if (!text) return null;
  const ctx = ctxOf(m);
  const me = s.me || {};
  const mine = (j) => j && [me.id, me.lid].filter(Boolean).includes(bare(j));
  const rec = {
    id: m.key.id, chat, chatAlt, group: isGroup(chat), fromMe: !!m.key.fromMe,
    from: m.key.participant || chat, fromAlt: m.key.participantAlt || m.key.remoteJidAlt || null, name: m.pushName || '',
    text: String(text).slice(0, 2000), ts: (+m.messageTimestamp || Date.now() / 1000) * 1000,
    mentionsMe: (ctx?.mentionedJid || []).some(mine), repliesToMe: mine(ctx?.participant),
  };
  // Lista de conversas recentes (só nome e quando; sem conteúdo) para você escolher quais liberar.
  if (!rec.fromMe || !s.data.recent[chat]) s.data.recent[chat] = { name: rec.group ? s.data.recent[chat]?.name || '' : (rec.fromMe ? s.data.recent[chat]?.name : rec.name) || '', alt: rec.chatAlt, ts: rec.ts, group: rec.group };
  const cfg = store.state.integrations?.whatsapp_web?.config || {};
  const chosen = (cfg.chats || []).some((c) => c.id === chat || (rec.chatAlt && c.id === rec.chatAlt));
  if (!chosen && !(cfg.mentions !== 'off' && (rec.mentionsMe || rec.repliesToMe))) { persist(store, s); return null; }
  const list = (s.data.chats[chat] ||= []);
  if (!list.some((x) => x.id === rec.id)) list.push(rec);
  if (list.length > KEEP_PER_CHAT) list.splice(0, list.length - KEEP_PER_CHAT);
  s.raw.set(`${chat}|${rec.id}`, { key: m.key, message: m.message });
  if (s.raw.size > 2000) s.raw.delete(s.raw.keys().next().value);
  persist(store, s);
  return rec;
}

/** Só para os testes: processa uma mensagem como se tivesse chegado, com `me` = { id, lid }. */
export function ingestForTest(store, me, m) {
  const s = sessions.get(store.id) || { data: { chats: {}, recent: {} }, raw: new Map(), status: 'test' };
  s.me = me;
  sessions.set(store.id, s);
  return record(store, s, m);
}

function persist(store, s) {
  clearTimeout(s.saveTimer);
  s.saveTimer = setTimeout(() => {
    try {
      const recent = Object.entries(s.data.recent).sort((a, b) => b[1].ts - a[1].ts).slice(0, 300);
      s.data.recent = Object.fromEntries(recent);
      fs.mkdirSync(dirOf(store), { recursive: true });
      fs.writeFileSync(path.join(dirOf(store), 'messages.json'), JSON.stringify(s.data));
    } catch { /* tenta de novo na próxima mensagem */ }
  }, 2000);
}

const live = (store) => {
  const s = sessions.get(store.id);
  if (!s || s.status !== 'open') throw new Error('O WhatsApp não está conectado agora. Peça ao dono para reconectar em Integrações.');
  return s;
};

/** Grupos de que você participa + conversas individuais recentes, para escolher quais liberar. */
export async function listChats(store) {
  const s = live(store);
  const groups = Object.values(await s.sock.groupFetchAllParticipating()).map((g) => ({ id: g.id, name: g.subject || g.id, kind: 'group', size: g.participants?.length || 0 }));
  for (const g of groups) if (s.data.recent[g.id]) s.data.recent[g.id].name = g.name;
  return { groups: groups.sort((a, b) => a.name.localeCompare(b.name)), contacts: contactList(s) };
}

/** Agenda + conversas recentes, sem repetir a mesma pessoa (número e LID). Recentes primeiro. */
function contactList(s) {
  const out = new Map();
  const phoneOf = (id, alt) => [alt, id].map((j) => String(j || '')).find((j) => j.endsWith('@s.whatsapp.net'))?.split('@')[0] || '';
  const keyOf = (id, alt, lid) => phoneOf(id, alt) || lid || id;
  for (const [id, r] of Object.entries(s.data.recent || {})) {
    if (r.group || isGroup(id)) continue;
    const book = s.data.contacts?.[id] || {};
    const k = keyOf(id, r.alt, book.lid);
    out.set(k, { id, name: book.name || r.name || book.notify || '', phone: phoneOf(id, r.alt) || (book.pn || '').split('@')[0], kind: 'contact', ts: r.ts, recent: true });
  }
  for (const [id, b] of Object.entries(s.data.contacts || {})) {
    const k = keyOf(id, b.pn, b.lid);
    if (out.has(k)) { const o = out.get(k); o.name ||= b.name || b.notify; continue; }
    if (!b.name && !b.notify) continue; // sem nome na agenda nem no perfil: aparece quando mandar mensagem
    // Prefere o número (@s.whatsapp.net) como id da conversa: é o que o WhatsApp aceita para enviar.
    out.set(k, { id: b.pn || id, name: b.name || b.notify, phone: (b.pn || '').split('@')[0], kind: 'contact', ts: 0, saved: !!b.name });
  }
  return [...out.values()].map((x) => ({ ...x, name: x.name || (x.phone ? `+${x.phone}` : 'contato') }))
    .sort((a, b) => (b.ts - a.ts) || (b.saved - a.saved) || a.name.localeCompare(b.name)).slice(0, 2000);
}

/** Confere um número no WhatsApp (para liberar um contato que ainda não apareceu na lista). */
export async function lookupPhone(store, phone) {
  const s = live(store);
  const digits = String(phone || '').replace(/\D/g, '');
  if (digits.length < 10) throw new Error('Informe o número com DDI e DDD, ex.: 5511999998888.');
  const [r] = await s.sock.onWhatsApp(digits);
  if (!r?.exists) throw new Error(`O número +${digits} não tem WhatsApp.`);
  const id = bare(r.jid);
  const book = s.data.contacts?.[id] || {};
  return { id, name: book.name || book.notify || `+${digits}`, phone: digits, kind: 'contact' };
}

/** Mensagens guardadas de uma conversa (mais antigas primeiro). */
export function messages(store, chat, limit = 30, since = 0) {
  const s = sessions.get(store.id);
  const data = s?.data || loadMessages(store);
  const n = Math.min(Math.max(+limit || 30, 1), KEEP_PER_CHAT);
  const list = data.chats[chat] || [];
  // Com `since`: as mais antigas a partir dessa hora (para ler em páginas, em ordem); sem: as últimas.
  return since ? list.filter((m) => m.ts > since).slice(0, n) : list.slice(-n);
}

/** Quantas mensagens novas cada conversa guardada tem desde `since` (para o resumo diário). */
export function newSince(store, since) {
  const s = sessions.get(store.id);
  const data = s?.data || loadMessages(store);
  return Object.fromEntries(Object.entries(data.chats).map(([id, l]) => [id, l.filter((m) => m.ts > since).length]).filter(([, n]) => n));
}

/** Conversas onde você foi marcado (ou responderam você) nas últimas `hours` horas. */
export function mentionChats(store, hours = 24) {
  const s = sessions.get(store.id);
  const data = s?.data || loadMessages(store);
  const since = Date.now() - hours * 3600e3;
  return Object.entries(data.chats).filter(([, l]) => l.some((m) => (m.mentionsMe || m.repliesToMe) && m.ts >= since)).map(([id]) => id);
}

/** Envia texto numa conversa; reply_to cita uma mensagem guardada. */
export async function send(store, chat, text, replyTo) {
  const s = live(store);
  const raw = replyTo ? s.raw.get(`${chat}|${replyTo}`) : null;
  const sent = await s.sock.sendMessage(chat, { text: String(text).slice(0, 4000) }, raw ? { quoted: raw } : {});
  const rec = record(store, s, sent);
  if (rec) { rec.byAgent = true; persist(store, s); } // na conversa: mensagem do dono escrita por um agente
  return { id: sent?.key?.id };
}

/** Para a sessão. logout=true também desconecta o aparelho no celular e apaga a sessão salva. */
export async function stop(store, { logout = false } = {}) {
  const s = sessions.get(store.id);
  if (s) {
    s.stopped = true;
    try { if (logout && s.status === 'open') await s.sock.logout(); else s.sock?.end?.(undefined); } catch { /* já caiu */ }
    sessions.delete(store.id);
  }
  if (logout) fs.rmSync(dirOf(store), { recursive: true, force: true });
}
