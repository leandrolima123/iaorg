// WhatsApp via Kapso (https://docs.kapso.ai): lista números e mensagens pela Platform API e envia
// pelo proxy compatível com a Cloud API da Meta. Autenticação: X-API-Key (chave do projeto Kapso).
const PLATFORM = 'https://api.kapso.ai/platform/v1';
const META = 'https://api.kapso.ai/meta/whatsapp/v24.0';
export const WINDOW_MS = 24 * 3600 * 1000; // texto livre só até 24 h depois da última mensagem do cliente

async function kp(key, method, url, body) {
  const res = await fetch(url, {
    method,
    headers: { 'X-API-Key': key, Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = data?.error?.message || data?.error || data?.message || res.statusText;
    throw new Error(`Kapso ${res.status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
  }
  return data;
}

export async function phoneNumbers(key) {
  const d = await kp(key, 'GET', `${PLATFORM}/whatsapp/phone_numbers?per_page=50`);
  return (d?.data || []).map((p) => ({
    id: String(p.phone_number_id || p.id), display: p.display_phone_number || p.display_phone_number_normalized || '',
    name: p.verified_name || p.display_name || p.name || '', status: p.status || '', quality: p.quality_rating || '',
  }));
}

/** Valida a chave e escolhe o número (o informado ou o primeiro do projeto). */
export async function verify(key, phoneNumberId) {
  const list = await phoneNumbers(key);
  if (!list.length) throw new Error('Nenhum número de WhatsApp conectado a este projeto do Kapso.');
  const pick = phoneNumberId ? list.find((p) => p.id === String(phoneNumberId)) : list[0];
  if (!pick) throw new Error(`O número ${phoneNumberId} não está neste projeto do Kapso.`);
  return { number: pick, numbers: list };
}

const norm = (m) => ({
  id: m.id,
  ts: (+m.timestamp || 0) * 1000,
  direction: m.kapso?.direction || (m.from ? 'inbound' : 'outbound'),
  phone: m.kapso?.phone_number || (m.kapso?.direction === 'outbound' ? m.to : m.from) || m.from || m.to || '',
  name: m.kapso?.contact_name || m.username || '',
  type: m.type,
  text: m.text?.body || m.kapso?.content || (m.type ? `[${m.type}]` : ''),
  conversationId: m.kapso?.whatsapp_conversation_id || null,
  status: m.kapso?.status || '',
});

/** Mensagens mais recentes (mais nova primeiro). */
export async function messages(key, phoneNumberId, { direction, phone, limit = 30 } = {}) {
  const q = new URLSearchParams({ phone_number_id: phoneNumberId, limit: String(Math.min(limit, 100)) });
  if (direction) q.set('direction', direction);
  if (phone) q.set('phone_number', String(phone).replace(/\D/g, ''));
  const d = await kp(key, 'GET', `${PLATFORM}/whatsapp/messages?${q}`);
  return (d?.data || []).map(norm);
}

export async function sendText(key, phoneNumberId, to, body) {
  const d = await kp(key, 'POST', `${META}/${phoneNumberId}/messages`, {
    messaging_product: 'whatsapp', to: String(to).replace(/\D/g, ''), type: 'text', text: { body: String(body).slice(0, 4096) },
  });
  return { id: d?.messages?.[0]?.id || null };
}

export async function markRead(key, phoneNumberId, messageId) {
  await kp(key, 'POST', `${META}/${phoneNumberId}/messages`, { messaging_product: 'whatsapp', status: 'read', message_id: messageId });
}
