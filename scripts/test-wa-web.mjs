// Teste do WhatsApp pessoal sem celular: confere que a biblioteca carrega, que o QR code é gerado
// e que a sessão é encerrada e apagada. Não conecta nenhum número (ninguém lê o QR).
// Uso: node scripts/test-wa-web.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as waweb from '../server/wa-web.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iaorg-wa-'));
const store = { id: 'teste-wa', dir, state: { integrations: { whatsapp_web: { connected: true, config: { chats: [] } } } } };
let fail = 0;
const ok = (cond, msg) => { console.log(`${cond ? '✓' : '✗'} ${msg}`); if (!cond) fail++; };

const statuses = [];
await waweb.start(store, { onStatus: (_s, st) => statuses.push(st.status), onMessage: () => {} });
const t0 = Date.now();
while (Date.now() - t0 < 30000 && waweb.status(store).status !== 'qr') await new Promise((r) => setTimeout(r, 500));
const st = waweb.status(store);
ok(st.status === 'qr', `status virou "qr" (${st.status}${st.error ? `: ${st.error}` : ''})`);
ok(/^data:image\/png;base64,/.test(st.qr || ''), 'QR code gerado como imagem PNG');
ok(fs.existsSync(path.join(dir, 'whatsapp-web', 'auth')), 'pasta da sessão criada');
await waweb.stop(store, { logout: true });
ok(waweb.status(store).status === 'stopped', 'sessão encerrada');
ok(!fs.existsSync(path.join(dir, 'whatsapp-web')), 'sessão apagada do disco ao desconectar');
let threw = false;
try { await waweb.send(store, '123@s.whatsapp.net', 'oi'); } catch { threw = true; }
ok(threw, 'envio recusado com o WhatsApp desligado');
// Filtro e detecção de menção, com mensagens simuladas (sem rede).
const me = { id: '5511999990000@s.whatsapp.net', lid: '123456@lid' };
const G = '120363000000000001@g.us';
store.state.integrations.whatsapp_web.config = { chats: [{ id: G, name: 'Equipe', kind: 'group', trigger: 'mention' }], mentions: 'on' };
const msg = (chat, text, extra = {}) => ({ key: { remoteJid: chat, id: `M${Math.random()}`, participant: extra.from, fromMe: false }, pushName: 'Ana', messageTimestamp: Date.now() / 1000,
  message: extra.ctx ? { extendedTextMessage: { text, contextInfo: extra.ctx } } : { conversation: text } });
const a = waweb.ingestForTest(store, me, msg(G, 'bom dia', { from: '5511888@s.whatsapp.net' }));
ok(a && !a.mentionsMe, 'grupo escolhido: mensagem guardada, sem menção');
const b = waweb.ingestForTest(store, me, msg(G, '@Leandro pode ver?', { from: '5511888@s.whatsapp.net', ctx: { mentionedJid: ['123456@lid'] } }));
ok(b?.mentionsMe, 'menção pelo LID detectada');
const c = waweb.ingestForTest(store, me, msg('999@g.us', 'oi @você', { from: '5511777@s.whatsapp.net', ctx: { mentionedJid: ['5511999990000:7@s.whatsapp.net'] } }));
ok(c?.mentionsMe, 'menção em grupo não escolhido guardada (número com aparelho :7)');
const d = waweb.ingestForTest(store, me, msg('888@g.us', 'conversa de outro grupo', { from: '5511666@s.whatsapp.net' }));
ok(d === null, 'grupo não escolhido sem menção: ignorado e não guardado');
ok(waweb.messages(store, '888@g.us').length === 0, 'nada guardado do grupo não escolhido');
ok(waweb.mentionChats(store).includes('999@g.us'), 'conversa com menção aparece nas menções recentes');
const e = waweb.ingestForTest(store, me, msg(G, 'respondendo você', { from: '5511888@s.whatsapp.net', ctx: { participant: '5511999990000@s.whatsapp.net' } }));
ok(e?.repliesToMe, 'resposta a uma mensagem sua detectada');
await waweb.stop(store);

fs.rmSync(dir, { recursive: true, force: true });
console.log(fail ? `\n${fail} falha(s)` : '\nTudo certo.');
process.exit(fail ? 1 : 0);
