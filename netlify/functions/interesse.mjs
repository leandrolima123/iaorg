// Lista de interesse no Netlify: as mesmas regras do site/server.mjs, gravadas no Netlify Blobs
// (um registro por e-mail). Não guarda IP. Rotas:
//   POST /api/interesse                 formulário da landing
//   GET  /admin/interessados.csv|json   exportação (Basic auth com ADMIN_PASSWORD; sem a variável, 404)
// Variáveis opcionais no painel do Netlify: ADMIN_PASSWORD, RESEND_API_KEY, LEADS_FROM, LEADS_NOTIFY_TO.
import crypto from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { validate, mergeLead, rateLimiter, toCsv, checkPassword, notify } from '../../site/interesse.mjs';

export const config = { path: ['/api/interesse', '/admin/interessados.csv', '/admin/interessados.json'] };

const limited = rateLimiter();
const BASE = { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin' };
const json = (status, obj) => new Response(JSON.stringify(obj), { status, headers: { ...BASE, 'content-type': 'application/json; charset=utf-8' } });
const text = (status, body, extra = {}) => new Response(body, { status, headers: { ...BASE, 'content-type': 'text/plain; charset=utf-8', ...extra } });
const env = (k) => globalThis.Netlify?.env.get(k) ?? process.env[k] ?? '';
const keyOf = (email) => crypto.createHash('sha256').update(email).digest('hex');

async function allLeads(store) {
  const { blobs } = await store.list();
  const items = await Promise.all(blobs.map((b) => store.get(b.key, { type: 'json' })));
  return items.filter(Boolean).sort((a, b) => String(a.criadoEm).localeCompare(String(b.criadoEm)));
}

export default async (req, context) => {
  const store = getStore({ name: 'interessados', consistency: 'strong' });
  const path = new URL(req.url).pathname;

  if (path === '/api/interesse') {
    if (req.method !== 'POST') return json(405, { error: 'Use POST.' });
    if (!/application\/json/.test(req.headers.get('content-type') || '')) return json(415, { error: 'Envie em JSON.' });
    if (limited(context.ip || 'sem-ip')) return json(429, { error: 'Muitas tentativas. Espere alguns minutos e tente de novo.' });
    const raw = await req.text();
    if (raw.length > 12_000) return json(413, { error: 'Pedido inválido.' });
    let b;
    try { b = JSON.parse(raw); } catch { return json(400, { error: 'Pedido inválido.' }); }
    const v = validate(b);
    if (v.bot) return json(200, { ok: true });
    if (v.errors) return json(422, { error: 'Confira os campos destacados.', campos: v.errors });
    const key = keyOf(v.lead.email);
    try {
      const prev = await store.get(key, { type: 'json' });
      const rec = mergeLead(prev, v.lead);
      await store.setJSON(key, rec);
      const total = (await store.list()).blobs.length;
      console.log(`[interesse] ${prev ? 'atualizado' : 'novo'} (${total} na lista)`);
      await notify({ RESEND_API_KEY: env('RESEND_API_KEY'), LEADS_FROM: env('LEADS_FROM'), LEADS_NOTIFY_TO: env('LEADS_NOTIFY_TO') }, rec, !prev, total);
      return json(200, { ok: true, novo: !prev });
    } catch (e) {
      console.error('[interesse] não consegui gravar:', e.message);
      return json(500, { error: 'Não conseguimos salvar agora. Tente de novo em instantes.' });
    }
  }

  // exportação
  if (req.method !== 'GET') return json(405, { error: 'Use GET.' });
  const password = env('ADMIN_PASSWORD');
  if (!password) return text(404, 'Página não encontrada.');
  if (!checkPassword(req.headers.get('authorization'), password)) return text(401, 'Senha necessária.', { 'www-authenticate': 'Basic realm="IAORG interessados", charset="UTF-8"' });
  const leads = await allLeads(store);
  if (path.endsWith('.json')) return json(200, leads);
  return new Response(toCsv(leads), { status: 200, headers: { ...BASE, 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="interessados-${new Date().toISOString().slice(0, 10)}.csv"` } });
};
