// Resend: envio e leitura da caixa de entrada (inbound), via REST.
// Documentação: https://resend.com/docs/api-reference (emails/receiving).
const API = 'https://api.resend.com';

async function rs(key, method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: `Bearer ${key}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Resend ${res.status}: ${data?.message || data?.name || res.statusText}`);
  return data;
}

// Valida a chave listando domínios (não envia nada).
export async function verify(key) {
  const d = await rs(key, 'GET', '/domains');
  return { domains: (d?.data || []).map((x) => ({ name: x.name, status: x.status })) };
}

export async function listReceived(key, { limit = 30, after } = {}) {
  const q = new URLSearchParams({ limit: String(limit) });
  if (after) q.set('after', after);
  const d = await rs(key, 'GET', `/emails/receiving?${q}`);
  return (d?.data || []).map((e) => ({
    id: e.id, from: e.from, to: e.to, cc: e.cc, subject: e.subject, createdAt: e.created_at, messageId: e.message_id,
    attachments: (e.attachments || []).map((a) => a.filename),
  }));
}

export async function getReceived(key, id) {
  const e = await rs(key, 'GET', `/emails/receiving/${encodeURIComponent(id)}`);
  const h = e.headers || {};
  const headerReplyTo = Array.isArray(h) ? h.find((x) => /^reply-to$/i.test(x.name || x.key || ''))?.value : h['reply-to'] || h['Reply-To'];
  const replyTo = [].concat(e.reply_to || e.replyTo || headerReplyTo || []).filter(Boolean);
  return { id: e.id, from: e.from, to: e.to, replyTo, subject: e.subject, text: e.text, html: e.html, messageId: e.message_id, createdAt: e.created_at };
}

// inline: imagens embutidas no HTML por Content-ID (ex.: logo da marca -> <img src="cid:logo-empresa">).
export async function send(key, { from, to, subject, text, html, replyTo, inReplyTo, inline = [] }) {
  const body = { from, to: Array.isArray(to) ? to : [to], subject, text, ...(html ? { html } : {}), ...(replyTo ? { reply_to: replyTo } : {}) };
  if (html && inline.length) body.attachments = inline.map((a) => ({ filename: a.filename, content: a.b64, content_type: a.mime, content_id: a.cid }));
  if (inReplyTo) body.headers = { 'In-Reply-To': inReplyTo, References: inReplyTo };
  const d = await rs(key, 'POST', '/emails', body);
  return { id: d.id };
}

// Texto simples a partir do HTML, para o agente ler sem marcação.
export const htmlToText = (html) => String(html || '')
  .replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, '')
  .replace(/<br\s*\/?>|<\/p>|<\/div>|<\/li>/gi, '\n')
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/\n{3,}/g, '\n\n').trim();
