// Google (Gmail e Calendar) via OAuth 2.0 com acesso offline (refresh token).
// Requer GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET (cliente OAuth "Aplicativo da Web" no Google Cloud)
// com o redirect URI ${APP_URL}/integrations/google/callback.
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const APP_URL = (process.env.APP_URL || 'http://localhost:3000').replace(/\/$/, '');
export const REDIRECT_URI = `${APP_URL}/integrations/google/callback`;
export const configured = () => !!(CLIENT_ID && CLIENT_SECRET);

export const SCOPES = {
  // mínimo necessário: ler (readonly) + criar rascunhos e enviar (compose). Nada de apagar ou mexer em marcadores.
  gmail: ['https://www.googleapis.com/auth/gmail.readonly', 'https://www.googleapis.com/auth/gmail.compose', 'openid', 'email'],
  google_calendar: ['https://www.googleapis.com/auth/calendar.events', 'openid', 'email'],
  // drive.file: o IAORG só vê e mexe nos arquivos que ele mesmo criou no Drive.
  google_drive: ['https://www.googleapis.com/auth/drive.file', 'openid', 'email'],
  google_ads: ['https://www.googleapis.com/auth/adwords', 'openid', 'email'],
};

export function authUrl(type, state) {
  const q = new URLSearchParams({
    client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: 'code', access_type: 'offline', prompt: 'consent',
    include_granted_scopes: 'true', scope: SCOPES[type].join(' '), state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${q}`;
}

async function tokenRequest(params) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, ...params }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Google OAuth: ${data.error_description || data.error || res.status}`);
  return data;
}

export async function exchangeCode(code) {
  const t = await tokenRequest({ code, grant_type: 'authorization_code', redirect_uri: REDIRECT_URI });
  const email = t.id_token ? JSON.parse(Buffer.from(t.id_token.split('.')[1], 'base64url').toString()).email : '';
  return { accessToken: t.access_token, refreshToken: t.refresh_token, expiresAt: Date.now() + (t.expires_in - 60) * 1000, email };
}

// Devolve um access token válido, renovando com o refresh token quando preciso.
export async function accessToken(tokens, onRefresh) {
  if (tokens.accessToken && tokens.expiresAt > Date.now()) return tokens.accessToken;
  if (!tokens.refreshToken) throw new Error('Conexão com o Google expirou; reconecte a integração.');
  const t = await tokenRequest({ refresh_token: tokens.refreshToken, grant_type: 'refresh_token' });
  const next = { ...tokens, accessToken: t.access_token, expiresAt: Date.now() + (t.expires_in - 60) * 1000 };
  onRefresh?.(next);
  return next.accessToken;
}

async function g(token, method, url, body) {
  const res = await fetch(url, {
    method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new Error(`Google ${res.status}: ${data?.error?.message || res.statusText}`);
  return data;
}

// ---------------- Gmail ----------------
const GM = 'https://gmail.googleapis.com/gmail/v1/users/me';
const header = (msg, name) => msg.payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value || '';

function bodyText(part) {
  if (!part) return '';
  if (part.mimeType === 'text/plain' && part.body?.data) return Buffer.from(part.body.data, 'base64url').toString('utf8');
  for (const p of part.parts || []) { const t = bodyText(p); if (t) return t; }
  if (part.mimeType === 'text/html' && part.body?.data) return Buffer.from(part.body.data, 'base64url').toString('utf8').replace(/<[^>]+>/g, '');
  return '';
}

export async function gmailSearch(token, query = 'in:inbox', max = 15) {
  const list = await g(token, 'GET', `${GM}/messages?${new URLSearchParams({ q: query, maxResults: String(max) })}`);
  const out = [];
  for (const m of list.messages || []) {
    const msg = await g(token, 'GET', `${GM}/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`);
    out.push({ id: msg.id, threadId: msg.threadId, from: header(msg, 'From'), subject: header(msg, 'Subject'), date: header(msg, 'Date'), snippet: msg.snippet, unread: (msg.labelIds || []).includes('UNREAD') });
  }
  return out;
}

export async function gmailRead(token, id) {
  const msg = await g(token, 'GET', `${GM}/messages/${encodeURIComponent(id)}?format=full`);
  return {
    id: msg.id, threadId: msg.threadId, from: header(msg, 'From'), to: header(msg, 'To'), subject: header(msg, 'Subject'),
    date: header(msg, 'Date'), messageId: header(msg, 'Message-ID'), text: bodyText(msg.payload).slice(0, 20000),
  };
}

// Texto puro, ou HTML com versão em texto (multipart/alternative) e imagens embutidas por Content-ID (multipart/related).
function rawMessage({ to, subject, text, html, inline = [], inReplyTo }) {
  const enc = (s) => `=?UTF-8?B?${Buffer.from(s).toString('base64')}?=`;
  const b64 = (s) => Buffer.from(s).toString('base64').replace(/.{76}/g, '$&\r\n');
  const lines = [`To: ${to}`, `Subject: ${enc(subject)}`, 'MIME-Version: 1.0'];
  if (inReplyTo) lines.push(`In-Reply-To: ${inReplyTo}`, `References: ${inReplyTo}`);
  let body;
  if (!html) {
    lines.push('Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64');
    body = b64(text);
  } else {
    const alt = `alt_${Math.random().toString(36).slice(2)}`;
    const rel = `rel_${Math.random().toString(36).slice(2)}`;
    const altPart = [`--${alt}`, 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', b64(text),
      `--${alt}`, 'Content-Type: text/html; charset=UTF-8', 'Content-Transfer-Encoding: base64', '', b64(html), `--${alt}--`].join('\r\n');
    if (!inline.length) {
      lines.push(`Content-Type: multipart/alternative; boundary="${alt}"`);
      body = altPart;
    } else {
      lines.push(`Content-Type: multipart/related; boundary="${rel}"`);
      body = [`--${rel}`, `Content-Type: multipart/alternative; boundary="${alt}"`, '', altPart,
        ...inline.flatMap((a) => [`--${rel}`, `Content-Type: ${a.mime}; name="${a.filename}"`, 'Content-Transfer-Encoding: base64', `Content-ID: <${a.cid}>`, `Content-Disposition: inline; filename="${a.filename}"`, '', a.b64.replace(/.{76}/g, '$&\r\n')]),
        `--${rel}--`].join('\r\n');
    }
  }
  return Buffer.from(`${lines.join('\r\n')}\r\n\r\n${body}`).toString('base64url');
}

export async function gmailDraft(token, { to, subject, text, html, inline, threadId, inReplyTo }) {
  const d = await g(token, 'POST', `${GM}/drafts`, { message: { raw: rawMessage({ to, subject, text, html, inline, inReplyTo }), ...(threadId ? { threadId } : {}) } });
  return { draftId: d.id };
}

export async function gmailSend(token, { to, subject, text, html, inline, threadId, inReplyTo }) {
  const d = await g(token, 'POST', `${GM}/messages/send`, { raw: rawMessage({ to, subject, text, html, inline, inReplyTo }), ...(threadId ? { threadId } : {}) });
  return { id: d.id, threadId: d.threadId };
}

// ---------------- Calendar ----------------
const CAL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

export async function calendarList(token, { from, to, max = 25 } = {}) {
  const q = new URLSearchParams({ singleEvents: 'true', orderBy: 'startTime', maxResults: String(max), timeMin: from || new Date().toISOString() });
  if (to) q.set('timeMax', to);
  const d = await g(token, 'GET', `${CAL}?${q}`);
  return (d.items || []).map((e) => ({ id: e.id, title: e.summary || '(sem título)', start: e.start?.dateTime || e.start?.date, end: e.end?.dateTime || e.end?.date, attendees: (e.attendees || []).map((a) => a.email), link: e.htmlLink }));
}

export async function calendarCreate(token, { title, description, start, end, attendees = [], timeZone = 'America/Sao_Paulo' }) {
  const e = await g(token, 'POST', `${CAL}?sendUpdates=all`, {
    summary: title, description, start: { dateTime: start, timeZone }, end: { dateTime: end, timeZone },
    attendees: attendees.map((email) => ({ email })),
  });
  return { id: e.id, link: e.htmlLink };
}
