// Chamadas à Admin API do Keycloak com o service account "iaorg-admin".
const INTERNAL = process.env.KEYCLOAK_INTERNAL_URL || 'http://localhost:8081';
const REALM = process.env.KEYCLOAK_REALM || 'iaorg';
const CLIENT_ID = process.env.KEYCLOAK_ADMIN_CLIENT_ID || 'iaorg-admin';
const SECRET = process.env.KEYCLOAK_ADMIN_CLIENT_SECRET || '';

let cached = { token: null, exp: 0 };

async function adminToken() {
  if (cached.token && Date.now() < cached.exp - 15000) return cached.token;
  const res = await fetch(`${INTERNAL}/realms/${REALM}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: CLIENT_ID, client_secret: SECRET }),
  });
  if (!res.ok) throw new Error(`Keycloak admin token falhou (${res.status})`);
  const j = await res.json();
  cached = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return cached.token;
}

async function api(method, path, body) {
  const res = await fetch(`${INTERNAL}/admin/realms/${REALM}${path}`, {
    method,
    headers: { Authorization: `Bearer ${await adminToken()}`, ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok && res.status !== 409) {
    const text = await res.text().catch(() => '');
    throw new Error(`Keycloak ${method} ${path}: ${res.status} ${text.slice(0, 200)}`);
  }
  return res;
}

// Garante que o realm usa o tema de login do IAORG (a importação do realm só vale na primeira vez).
// Tenta algumas vezes porque o app pode subir antes de o Keycloak terminar de iniciar.
export async function ensureLoginTheme(theme = 'iaorg', tries = 6) {
  for (let i = 0; i < tries; i++) {
    try {
      const realm = await (await api('GET', '')).json();
      if (realm.loginTheme === theme) return { changed: false };
      await api('PUT', '', { loginTheme: theme });
      console.log(`[keycloak] tema de login do realm era "${realm.loginTheme || 'padrão'}"; voltei para "${theme}"`);
      return { changed: true };
    } catch (e) {
      if (i === tries - 1) { console.warn('[keycloak] não consegui conferir o tema de login:', e.message); return { error: e.message }; }
      await new Promise((r) => setTimeout(r, 10_000));
    }
  }
}

const slug = (s) => String(s).toLowerCase().normalize('NFD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'empresa';

// Cria a Organization (com sufixo se o nome já existir) e devolve { id, name, alias }.
export async function createOrganization(name) {
  for (let i = 0; i < 5; i++) {
    const suffix = i ? '-' + Math.random().toString(36).slice(2, 6) : '';
    const body = { name: name + (i ? ` (${suffix.slice(1)})` : ''), alias: slug(name) + suffix, enabled: true };
    const res = await api('POST', '/organizations', body);
    if (res.status === 409) continue;
    const id = res.headers.get('location')?.split('/').pop();
    return { id, name: body.name, alias: body.alias };
  }
  throw new Error('Não foi possível criar a organização (nome em uso).');
}

export async function addMember(orgId, userId) {
  await api('POST', `/organizations/${orgId}/members`, userId);
}

export async function removeMember(orgId, userId) {
  await api('DELETE', `/organizations/${orgId}/members/${userId}`);
}

// Organizações às quais o usuário pertence.
export async function userOrganizations(userId) {
  const res = await api('GET', `/organizations/members/${userId}/organizations`);
  return res.json();
}
