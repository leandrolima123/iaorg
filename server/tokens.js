// Tokens pessoais de acesso (para o MCP e para a API): cada um pertence a uma pessoa da empresa,
// tem um nível (leitura < operação < administração) e nunca passa das permissões dessa pessoa.
// Só o hash fica guardado; o token aparece uma única vez, na criação.
import crypto from 'node:crypto';
import { allCompanies, uid, hasRole } from './companies.js';

export const LEVELS = { read: 1, operate: 2, admin: 3 };
export const LEVEL_LABEL = { read: 'Leitura', operate: 'Operação', admin: 'Administração' };
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const listOf = (store) => (store.state.apiTokens ||= []);

// Nível máximo que uma pessoa pode dar ao próprio token.
export const maxLevelFor = (member) => (hasRole(member, 'admin') ? 'admin' : 'operate');

export function createToken(store, member, { name, level }) {
  const lv = LEVELS[level] ? level : 'read';
  if (LEVELS[lv] > LEVELS[maxLevelFor(member)]) throw new Error('Seu papel na empresa não permite um token de administração.');
  const raw = `iaorg_${crypto.randomBytes(24).toString('base64url')}`;
  const t = { id: uid('tok'), name: String(name || 'Token').trim().slice(0, 60) || 'Token', level: lv, hash: sha(raw), prefix: raw.slice(0, 12), memberId: member.id, createdAt: Date.now(), lastUsedAt: null, revokedAt: null };
  listOf(store).push(t);
  store.save();
  return { token: raw, info: publicToken(t) };
}

export const publicToken = (t) => ({ id: t.id, name: t.name, level: t.level, prefix: t.prefix, memberId: t.memberId, createdAt: t.createdAt, lastUsedAt: t.lastUsedAt, revokedAt: t.revokedAt });
export const tokensOf = (store) => listOf(store).filter((t) => !t.revokedAt).map(publicToken);

export function revokeToken(store, id, member) {
  const t = listOf(store).find((x) => x.id === id && !x.revokedAt);
  if (!t) return false;
  if (t.memberId !== member.id && !hasRole(member, 'owner')) throw new Error('Só quem criou (ou o dono) pode revogar este token.');
  t.revokedAt = Date.now();
  store.save();
  return true;
}

// Limite de uso por token: 120 chamadas por minuto (uma ferramenta de IA em laço não faz estrago).
const hits = new Map();
function rateOk(id) {
  const now = Date.now();
  const arr = (hits.get(id) || []).filter((t) => now - t < 60_000);
  arr.push(now);
  hits.set(id, arr);
  return arr.length <= 120;
}

/** Resolve um "Authorization: Bearer iaorg_..." → { store, token, member } ou { error }. */
export function authenticate(header) {
  const m = String(header || '').match(/^Bearer\s+(iaorg_[\w-]{20,})$/);
  if (!m) return null;
  const h = sha(m[1]);
  for (const store of allCompanies()) {
    const t = (store.state.apiTokens || []).find((x) => x.hash === h);
    if (!t) continue;
    if (t.revokedAt) return { error: 'Token revogado' };
    const member = store.getAgent(t.memberId);
    if (!member || member.kind !== 'human' || member.active === false) return { error: 'A pessoa dona deste token não está mais na empresa' };
    if (!rateOk(t.id)) return { error: 'Muitas chamadas em pouco tempo (limite de 120 por minuto). Aguarde um pouco.', status: 429 };
    if (!t.lastUsedAt || Date.now() - t.lastUsedAt > 60_000) { t.lastUsedAt = Date.now(); store.save(); }
    return { store, token: t, member };
  }
  return { error: 'Token inválido' };
}

// Rotas que um token de "operação" pode chamar com escrita (o resto exige "administração").
const OPERATE_WRITES = [
  /^POST \/api\/tasks$/, /^POST \/api\/tasks\/[\w-]+\/(update|adjust|dismiss)$/, /^POST \/api\/goal$/,
  /^POST \/api\/routines\/[\w-]+\/(run|update)$/, /^POST \/api\/deliveries\/[\w-]+\/dismiss$/,
];
// Nunca por token (só pela interface, com a pessoa logada): segredos, conexões, tokens e limpar tudo.
const NEVER = [
  /^\/api\/tokens/, /^PUT \/api\/settings\/claude$/, /^POST \/api\/settings\/claude\/test$/, /^POST \/api\/integrations\/[\w-]+\/connect$/,
  /^DELETE \/api\/integrations\//, /^POST \/api\/company\/logo$/, /^POST \/api\/onboarding/,
];

/** Pode este token fazer esta chamada? (além das regras normais do papel da pessoa) */
export function allowed(token, method, path) {
  const key = `${method} ${path}`;
  if (NEVER.some((r) => r.test(key) || r.test(path))) return 'Esta ação só pode ser feita pela interface do IAORG.';
  if (path === '/api/control' && method === 'POST') return LEVELS[token.level] >= LEVELS.admin ? null : 'Pausar/retomar exige token de administração.';
  if (method === 'GET' || method === 'HEAD') return null;
  if (LEVELS[token.level] >= LEVELS.admin) return null;
  if (LEVELS[token.level] >= LEVELS.operate && OPERATE_WRITES.some((r) => r.test(key))) return null;
  return `Seu token é de ${LEVEL_LABEL[token.level].toLowerCase()}: esta ação exige ${LEVELS[token.level] >= LEVELS.operate ? 'administração' : 'operação ou administração'}.`;
}
