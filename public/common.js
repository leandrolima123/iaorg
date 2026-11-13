// Utilitários compartilhados pelas páginas.
export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Ícones Lucide (sprite servido localmente).
export const ic = (name, cls = '') => `<svg class="i ${cls}" aria-hidden="true"><use href="/vendor/lucide/sprite.svg#${name}"/></svg>`;

export async function api(method, url, body, raw) {
  const r = await fetch(url, {
    method,
    headers: raw ? { 'Content-Type': 'application/octet-stream' } : body ? { 'Content-Type': 'application/json' } : {},
    body: raw ? body : body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (r.status === 401) { location.href = '/auth/login?next=' + encodeURIComponent(location.pathname + location.search); throw new Error('Não autenticado'); }
  if (!r.ok) throw Object.assign(new Error(data.error || r.statusText), { status: r.status, data });
  return data;
}

export function toast(text, kind = '') {
  let box = $('#toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; box.setAttribute('role', 'status'); document.body.appendChild(box); }
  const el = document.createElement('div');
  el.className = 'toast ' + kind;
  el.innerHTML = `${ic(kind === 'err' ? 'construction' : 'check')}<span>${esc(text)}</span>`;
  box.appendChild(el);
  setTimeout(() => el.classList.add('out'), 4200);
  setTimeout(() => el.remove(), 4500);
  return el;
}

/** Aviso com botão "Desfazer" (fica um pouco mais na tela). */
export function toastUndo(text, undo) {
  const el = toast(text);
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'toast-undo'; b.textContent = 'Desfazer';
  b.onclick = async () => { b.disabled = true; try { await undo(); el.remove(); } catch (e) { toast(e.message, 'err'); } };
  el.appendChild(b);
}

export const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

export const COLORS = ['#1f6b4a', '#2e5e8c', '#8a3b5c', '#b8401c', '#6b5b1f', '#3b3c39', '#5b4b8a', '#2d7f7a', '#9c5a1a', '#4f6b2a', '#7a2e2e'];
