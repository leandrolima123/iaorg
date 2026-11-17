// Upload-Post: publica e agenda posts (Instagram, Facebook, LinkedIn, X, Threads, TikTok...), lê métricas e comentários.
// Documentação: https://docs.upload-post.com (autenticação "Authorization: Apikey <chave>").
const API = 'https://api.upload-post.com';

export const PLATFORMS = ['instagram', 'facebook', 'linkedin', 'x', 'threads', 'tiktok', 'pinterest', 'bluesky', 'youtube'];
export const LABEL = { instagram: 'Instagram', facebook: 'Facebook', linkedin: 'LinkedIn', x: 'X', threads: 'Threads', tiktok: 'TikTok', pinterest: 'Pinterest', bluesky: 'Bluesky', youtube: 'YouTube' };

async function up(key, method, path, { query, json, form } = {}) {
  const q = query ? `?${new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== ''))}` : '';
  const res = await fetch(API + path + q, {
    method,
    headers: { Authorization: `Apikey ${key}`, ...(json ? { 'Content-Type': 'application/json' } : {}) },
    body: json ? JSON.stringify(json) : form,
    signal: AbortSignal.timeout(120000),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || data?.success === false) {
    const msg = data?.message || data?.error || data?.detail || res.statusText;
    const pages = data?.available_pages ? ` Páginas disponíveis: ${JSON.stringify(data.available_pages).slice(0, 600)} (informe o ID da página em Integrações).` : '';
    const err = new Error(`Upload-Post ${res.status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}${pages}`);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

// Valida a chave e lista os perfis com as redes conectadas.
export async function verify(key) {
  const me = await up(key, 'GET', '/api/uploadposts/me').catch((e) => { if (e.status === 401 || e.status === 403) throw e; return {}; });
  const profiles = await listProfiles(key);
  return { email: me?.email || '', plan: me?.plan || '', profiles };
}

export async function listProfiles(key) {
  const d = await up(key, 'GET', '/api/uploadposts/users');
  return (d?.profiles || []).map((p) => ({
    username: p.username,
    name: p.display_name || p.username,
    accounts: Object.fromEntries(Object.entries(p.social_accounts || {})
      .filter(([, v]) => v && typeof v === 'object')
      .map(([plat, v]) => [plat, { name: v.display_name || v.handle || v.username || '', handle: v.handle || '', reauth: !!v.reauth_required }])),
  }));
}

/**
 * Publica (ou agenda) um post. images: [{ name, mime, buf }] (vazio = só texto).
 * opts: { facebookPageId, linkedinPageId, scheduledDate, timezone, firstComment }
 */
export async function publish(key, { user, platforms, text, title, images = [], scheduledDate, timezone, facebookPageId, linkedinPageId, stories = false, requestId }) {
  const f = new FormData();
  f.append('user', user);
  for (const p of platforms) f.append('platform[]', p);
  f.append('title', title || text);
  if (images.length) {
    f.append('description', text); // LinkedIn, Facebook e Pinterest usam a descrição; Instagram usa o title
    for (const img of images) f.append('photos[]', new Blob([img.buf], { type: img.mime }), img.name);
    if (stories && platforms.includes('instagram')) f.append('media_type', 'STORIES');
  }
  if (scheduledDate) { f.append('scheduled_date', scheduledDate); f.append('timezone', timezone || 'America/Sao_Paulo'); }
  if (facebookPageId) f.append('facebook_page_id', facebookPageId);
  if (linkedinPageId) f.append('target_linkedin_page_id', linkedinPageId);
  if (requestId) f.append('request_id', requestId);
  f.append('async_upload', 'false');
  const d = await up(key, 'POST', images.length ? '/api/upload_photos' : '/api/upload_text', { form: f });
  return {
    agendado: !!d.job_id, job_id: d.job_id || null, request_id: d.request_id || null, scheduled_date: d.scheduled_date || null,
    resultados: Object.fromEntries(Object.entries(d.results || {}).map(([p, r]) => [p, { ok: !!r?.success && !r?.skipped, url: r?.url || null, erro: r?.error || (r?.skipped ? 'rede não conectada neste perfil' : null) }])),
    em_andamento: !!d.request_id && !d.results,
    uso: d.usage ? { usados: d.usage.count, limite: d.usage.limit } : null,
  };
}

export const status = (key, { requestId, jobId }) => up(key, 'GET', '/api/uploadposts/status', { query: { request_id: requestId, job_id: jobId } });
export const history = (key, { page = 1, limit = 20 } = {}) => up(key, 'GET', '/api/uploadposts/history', { query: { page, limit } });

export const analytics = (key, user, { platforms, facebookPageId, linkedinPageUrn, days }) => up(key, 'GET', `/api/analytics/${encodeURIComponent(user)}`, {
  query: { platforms: platforms.join(','), page_id: facebookPageId, page_urn: linkedinPageUrn, days },
});

export const media = (key, user, { platform, limit = 12, linkedinPageUrn }) => up(key, 'GET', '/api/uploadposts/media', { query: { platform, user, limit, page_urn: platform === 'linkedin' ? linkedinPageUrn : undefined } });

export const postAnalytics = (key, user, { platform, postId, requestId }) => (requestId
  ? up(key, 'GET', `/api/uploadposts/post-analytics/${encodeURIComponent(requestId)}`, { query: { platform } })
  : up(key, 'GET', '/api/uploadposts/post-analytics', { query: { platform_post_id: postId, platform, user } }));

export const comments = (key, user, { platform, postId, postUrl, commentId, limit = 30 }) => up(key, 'GET', '/api/uploadposts/comments', {
  query: { platform, user, post_id: postId, post_url: postUrl, comment_id: commentId, limit },
});

export const reply = (key, user, { platform, commentId, postId, postUrl, message }) => up(key, 'POST', '/api/uploadposts/comments/create', {
  json: { platform, user, message, ...(commentId ? { comment_id: commentId } : {}), ...(postId ? { post_id: postId } : {}), ...(postUrl && !postId ? { post_url: postUrl } : {}) },
});
