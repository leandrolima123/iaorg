// Regras da lista de interesse, usadas pelo servidor do site (site/server.mjs) e pela
// função do Netlify (netlify/functions/interesse.mjs): validação, junção de reenvios,
// limite de tentativas, CSV e aviso por e-mail. Sem dependências.
import crypto from 'node:crypto';

export const CONSENT_VERSION = '2026-11-16';
export const SIZES = ['so-eu', '2-10', '11-50', '51-200', '200+'];
export const AREAS = ['atendimento', 'desenvolvimento', 'marketing', 'vendas', 'operacoes', 'financeiro', 'outro'];
const EMAIL = /^[^\s@<>()[\]\\,;:"]{1,64}@[^\s@<>()[\]\\,;:"]+\.[a-z]{2,}$/i;
const clean = (v, max) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

// Confere o corpo enviado pelo formulário. Retorna { bot } para o campo-isca,
// { errors } se algo estiver errado ou { lead } pronto para gravar.
export function validate(b) {
  if (!b || typeof b !== 'object') return { errors: { _: 'Pedido inválido.' } };
  if (b.site) return { bot: true }; // campo-isca: robôs preenchem, pessoas não veem
  const lead = {
    nome: clean(b.nome, 80), email: clean(b.email, 120).toLowerCase(), empresa: clean(b.empresa, 100),
    tamanho: SIZES.includes(b.tamanho) ? b.tamanho : '',
    areas: (Array.isArray(b.areas) ? b.areas : []).filter((a) => AREAS.includes(a)).slice(0, AREAS.length),
    mensagem: clean(b.mensagem, 600),
  };
  const errors = {};
  if (lead.nome.length < 2) errors.nome = 'Diga como podemos te chamar.';
  if (!EMAIL.test(lead.email)) errors.email = 'Confira o e-mail.';
  if (b.consentimento !== true) errors.consentimento = 'Precisamos da sua autorização para guardar o contato.';
  return Object.keys(errors).length ? { errors } : { lead };
}

// Monta o registro. Num reenvio do mesmo e-mail, o que veio vazio mantém o valor anterior.
export function mergeLead(prev, lead, now = new Date().toISOString()) {
  const merged = { ...lead };
  if (prev) {
    for (const k of ['empresa', 'tamanho', 'mensagem']) if (!merged[k] && prev[k]) merged[k] = prev[k];
    if (!merged.areas.length && prev.areas?.length) merged.areas = prev.areas;
  }
  return { id: prev?.id || crypto.randomUUID(), criadoEm: prev?.criadoEm || now, atualizadoEm: now, ...merged, consentimento: { em: now, versao: CONSENT_VERSION } };
}

// Limite simples por IP (só em memória, nada é gravado): 6 envios a cada 10 minutos.
export function rateLimiter(max = 6, windowMs = 10 * 60_000) {
  const hits = new Map();
  return (ip) => {
    const now = Date.now(), list = (hits.get(ip) || []).filter((t) => now - t < windowMs);
    list.push(now); hits.set(ip, list);
    if (hits.size > 5000) for (const [k, v] of hits) if (now - v[v.length - 1] > windowMs) hits.delete(k);
    return list.length > max;
  };
}

// CSV com ";" e BOM (abre direto no Excel em português). Neutraliza fórmulas.
const csvCell = (v) => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; return `"${s.replace(/"/g, '""')}"`; };
export function toCsv(leads) {
  const head = ['criadoEm', 'atualizadoEm', 'nome', 'email', 'empresa', 'tamanho', 'areas', 'mensagem'];
  const rows = [head.join(';'), ...leads.map((l) => head.map((k) => csvCell(Array.isArray(l[k]) ? l[k].join(', ') : l[k])).join(';'))];
  return '﻿' + rows.join('\r\n');
}

// Senha da exportação (Basic auth), comparada em tempo constante.
export function checkPassword(authorization, password) {
  if (!password) return false;
  const m = /^Basic (.+)$/.exec(authorization || '');
  if (!m) return false;
  const pass = Buffer.from(m[1], 'base64').toString('utf8').split(':').slice(1).join(':');
  const a = crypto.createHash('sha256').update(pass).digest(), b = crypto.createHash('sha256').update(password).digest();
  return crypto.timingSafeEqual(a, b);
}

// Aviso por e-mail via Resend (opcional: só com RESEND_API_KEY, LEADS_FROM e LEADS_NOTIFY_TO).
export async function notify(env, lead, isNew, total) {
  const key = env.RESEND_API_KEY, to = env.LEADS_NOTIFY_TO, from = env.LEADS_FROM;
  if (!key || !to || !from) return;
  const text = [`${isNew ? 'Novo interessado' : 'Interessado atualizou o cadastro'} na lista do IAORG`, '', `Nome: ${lead.nome}`, `E-mail: ${lead.email}`, `Empresa: ${lead.empresa || '-'}`, `Equipe: ${lead.tamanho || '-'}`, `Áreas: ${lead.areas.join(', ') || '-'}`, `Mensagem: ${lead.mensagem || '-'}`, '', `Total na lista: ${total}`].join('\n');
  try {
    const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify({ from, to: to.split(',').map((s) => s.trim()), subject: `IAORG: ${isNew ? 'novo interessado' : 'cadastro atualizado'} — ${lead.nome}`, text }), signal: AbortSignal.timeout(8000) });
    if (!r.ok) console.warn('[interesse] aviso por e-mail falhou:', r.status);
  } catch (e) { console.warn('[interesse] aviso por e-mail falhou:', e.message); }
}
