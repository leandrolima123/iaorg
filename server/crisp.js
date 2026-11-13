// Crisp: REST API v1 (https://docs.crisp.chat/references/rest-api/v1/).
// Autenticação Basic identifier:key + cabeçalho X-Crisp-Tier (plugin ou website, conforme o tipo de token).
const API = 'https://api.crisp.chat/v1';

export function parseToken(raw) {
  const [identifier, key] = String(raw || '').split(':').map((s) => s.trim());
  if (!identifier || !key) throw new Error('Informe o token como identificador:chave');
  return { identifier, key };
}

async function cr(cred, tier, method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${cred.identifier}:${cred.key}`).toString('base64'),
      'X-Crisp-Tier': tier === 'website' ? 'website' : 'plugin',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || data?.error) throw new Error(`Crisp ${res.status}: ${data?.reason || res.statusText}`);
  return data?.data;
}

export async function verify(cred, tier, websiteId) {
  const w = await cr(cred, tier, 'GET', `/website/${encodeURIComponent(websiteId)}`);
  return { name: w?.name || websiteId, domain: w?.domain || '' };
}

export async function conversations(cred, tier, websiteId, { filter = 'unresolved', page = 1 } = {}) {
  const q = new URLSearchParams({ per_page: '20' });
  if (filter === 'unread') q.set('filter_unread', '1');
  if (filter === 'unread' || filter === 'unresolved') q.set('filter_not_resolved', '1');
  const list = await cr(cred, tier, 'GET', `/website/${encodeURIComponent(websiteId)}/conversations/${page}?${q}`);
  return (list || []).map((c) => ({
    sessionId: c.session_id, state: c.state, nickname: c.meta?.nickname || '', email: c.meta?.email || '',
    lastMessage: c.last_message || c.preview_message?.excerpt || '', lastFrom: c.preview_message?.from || '',
    unread: c.unread?.operator || 0, updatedAt: c.updated_at,
  }));
}

export async function messages(cred, tier, websiteId, sessionId) {
  const list = await cr(cred, tier, 'GET', `/website/${encodeURIComponent(websiteId)}/conversation/${encodeURIComponent(sessionId)}/messages`);
  return (list || []).slice(-30).map((m) => ({
    from: m.from, type: m.type, at: m.timestamp,
    text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content).slice(0, 500),
    who: m.user?.nickname || '',
  }));
}

export async function send(cred, tier, websiteId, sessionId, text, { note = false, nickname } = {}) {
  await cr(cred, tier, 'POST', `/website/${encodeURIComponent(websiteId)}/conversation/${encodeURIComponent(sessionId)}/message`, {
    type: note ? 'note' : 'text', from: 'operator', origin: 'chat', content: String(text),
    ...(nickname ? { user: { type: 'participant', nickname } } : {}),
  });
  return { ok: true };
}

export async function markRead(cred, tier, websiteId, sessionId) {
  await cr(cred, tier, 'PATCH', `/website/${encodeURIComponent(websiteId)}/conversation/${encodeURIComponent(sessionId)}/read`, { from: 'operator', origin: 'chat' });
}

export async function setState(cred, tier, websiteId, sessionId, state) {
  await cr(cred, tier, 'PATCH', `/website/${encodeURIComponent(websiteId)}/conversation/${encodeURIComponent(sessionId)}/state`, { state });
  return { ok: true };
}
