// Criptografia de segredos (chave do Claude, token do GitHub, sessões) com AES-256-GCM.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
fs.mkdirSync(DATA_DIR, { recursive: true });

function loadSecret() {
  if (process.env.APP_SECRET) return process.env.APP_SECRET;
  const file = path.join(DATA_DIR, 'secret.key');
  if (!fs.existsSync(file)) {
    fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
    console.warn('[secrets] APP_SECRET não definido: gerei um em data/secret.key. Defina APP_SECRET no .env em produção.');
  }
  return fs.readFileSync(file, 'utf8').trim();
}

export const APP_SECRET = loadSecret();
const KEY = crypto.createHash('sha256').update('iaorg-enc:' + APP_SECRET).digest();
const SIGN_KEY = crypto.createHash('sha256').update('iaorg-sign:' + APP_SECRET).digest();

export function encrypt(plain) {
  if (plain == null || plain === '') return null;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([c.update(String(plain), 'utf8'), c.final()]);
  return 'v1:' + Buffer.concat([iv, c.getAuthTag(), enc]).toString('base64');
}

export function decrypt(blob) {
  if (!blob) return null;
  try {
    const raw = Buffer.from(String(blob).replace(/^v1:/, ''), 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', KEY, raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
  } catch {
    return null;
  }
}

export const sign = (value) => value + '.' + crypto.createHmac('sha256', SIGN_KEY).update(value).digest('base64url');
export function unsign(signed) {
  const i = String(signed || '').lastIndexOf('.');
  if (i < 1) return null;
  const value = signed.slice(0, i);
  const a = Buffer.from(sign(value));
  const b = Buffer.from(String(signed));
  return a.length === b.length && crypto.timingSafeEqual(a, b) ? value : null;
}

export const randomToken = (bytes = 24) => crypto.randomBytes(bytes).toString('base64url');

// "sk-ant-…a1b2" para mostrar sem revelar.
export const mask = (s) => (s ? `${s.slice(0, 7)}…${s.slice(-4)}` : null);
