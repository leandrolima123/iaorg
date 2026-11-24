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
  // tem várias empresas e nenhuma aberta nesta sessão: vai escolher
  if (r.status === 409 && data.choose && location.pathname !== '/empresas.html') { location.href = data.choose; throw new Error(data.error); }
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

// ---------- modais (no lugar de confirm/prompt do navegador) ----------
// <dialog> nativo: prende o foco, fecha no Esc e no clique fora, devolve o foco a quem abriu.
function openDialog(html, { onOpen, read }) {
  return new Promise((resolve) => {
    const dlg = document.createElement('dialog');
    dlg.className = 'modal';
    dlg.innerHTML = html;
    document.body.appendChild(dlg);
    const back = document.activeElement;
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      dlg.classList.add('closing');
      const end = () => { dlg.close(); dlg.remove(); back?.focus?.(); resolve(value); };
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) end(); else setTimeout(end, 140);
    };
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); });
    dlg.addEventListener('click', (e) => { if (e.target === dlg) finish(null); }); // clique no fundo
    $('[data-no]', dlg).onclick = () => finish(null);
    $('form', dlg).onsubmit = (e) => { e.preventDefault(); const v = read(dlg); if (v !== undefined) finish(v); };
    dlg.showModal();
    onOpen?.(dlg);
  });
}

/**
 * Pergunta de confirmação. Resolve true (confirmou) ou false.
 * danger: ação destrutiva (botão vermelho, foco começa em "Cancelar").
 */
export async function confirmDialog({ title, message = '', confirmLabel = 'Confirmar', cancelLabel = 'Cancelar', danger = false, icon } = {}) {
  const r = await openDialog(`<form class="modal-box" method="dialog">
      <div class="modal-head">${ic(icon || (danger ? 'triangle-exclamation-point' : 'circle-question-mark'), danger ? 'danger' : '')}<h2>${esc(title)}</h2></div>
      ${message ? `<p class="modal-msg">${esc(message)}</p>` : ''}
      <div class="modal-actions"><button type="button" class="btn" data-no>${esc(cancelLabel)}</button><button class="btn ${danger ? 'danger' : 'primary'}" data-yes>${esc(confirmLabel)}</button></div>
    </form>`, { onOpen: (d) => $(danger ? '[data-no]' : '[data-yes]', d).focus(), read: () => true });
  return r === true;
}

/** Pede um texto. Resolve o texto (sem espaços nas pontas) ou null se cancelou. */
export function promptDialog({ title, message = '', label = '', value = '', placeholder = '', confirmLabel = 'Salvar', cancelLabel = 'Cancelar', icon = 'pencil' } = {}) {
  return openDialog(`<form class="modal-box" method="dialog">
      <div class="modal-head">${ic(icon)}<h2>${esc(title)}</h2></div>
      ${message ? `<p class="modal-msg">${esc(message)}</p>` : ''}
      <label class="field"><span>${esc(label || title)}</span><input name="v" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off" spellcheck="false" required></label>
      <div class="modal-actions"><button type="button" class="btn" data-no>${esc(cancelLabel)}</button><button class="btn primary">${esc(confirmLabel)}</button></div>
    </form>`, {
    onOpen: (d) => { const i = $('input', d); i.focus(); i.select(); },
    read: (d) => { const v = $('input', d).value.trim(); return v || undefined; },
  });
}

export const initials =(name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

export const COLORS = ['#1f6b4a', '#2e5e8c', '#8a3b5c', '#b8401c', '#6b5b1f', '#3b3c39', '#5b4b8a', '#2d7f7a', '#9c5a1a', '#4f6b2a', '#7a2e2e'];
