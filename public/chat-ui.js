// Conversas em formato de chat (com filtros e busca) e o log completo de cada agente.
import { $, $$, esc, api, toast, ic, initials } from './common.js';
import { renderMarkdown } from './files-ui.js';

const day = (ts) => new Date(ts).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' });
const hhmm = (ts) => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const ago = (ts) => {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return 'agora';
  if (s < 3600) return `${Math.floor(s / 60)} min`;
  if (new Date(ts).toDateString() === new Date().toDateString()) return hhmm(ts);
  return new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
};
const CAIXA = { 'caixa:crisp': ['Chat do site', 'message-circle'], 'caixa:resend': ['E-mail (Resend)', 'mail'], 'caixa:gmail': ['Gmail', 'inbox'], 'caixa:whatsapp': ['WhatsApp', 'phone'] };

// ---------------- conversas ----------------
const cs = { filter: 'todas', q: '', who: '', key: null, threads: [] };

function person(ctx, id) {
  if (CAIXA[id]) return { name: CAIXA[id][0], role: 'clientes', color: '#3b3c39', icon: CAIXA[id][1], caixa: true };
  const a = ctx.byId(id === 'board' ? ctx.ownerId() : id);
  return a ? { name: a.id === ctx.me ? 'Você' : a.name, role: a.role, color: a.color, human: a.kind === 'human', id: a.id } : { name: id, role: '', color: '#8f8d86' };
}
const avatar = (p, size = '') => `<span class="cv-av ${size}" style="background:${p.color}">${p.icon ? ic(p.icon, 'sm') : esc(initials(p.name === 'Você' ? 'Eu' : p.name))}</span>`;

export async function renderChatPanel(root, ctx) {
  try { cs.threads = await api('GET', '/api/threads'); } catch (e) { root.innerHTML = `<p class="error">${esc(e.message)}</p>`; return; }
  const meKey = (id) => [ctx.me, id].sort().join('|');
  const q = cs.q.trim().toLowerCase();
  const list = cs.threads.filter((t) => {
    if (cs.filter !== 'todas' && t.kind !== cs.filter) return false;
    if (cs.who && !t.ids.includes(cs.who)) return false;
    if (q) {
      const names = t.ids.map((id) => person(ctx, id).name).join(' ').toLowerCase();
      if (!names.includes(q) && !t.last.content.toLowerCase().includes(q)) return false;
    }
    return true;
  });
  if (cs.key && !cs.threads.some((t) => t.key === cs.key) && !cs.key.includes(ctx.me)) cs.key = null;
  const counts = cs.threads.reduce((m, t) => ({ ...m, [t.kind]: (m[t.kind] || 0) + 1 }), {});
  const agents = ctx.agents();

  root.innerHTML = `
    <div class="cv">
      <aside class="cv-side">
        <div class="cv-tools">
          <input type="search" class="cv-search" placeholder="Buscar nome ou mensagem" value="${esc(cs.q)}" aria-label="Buscar conversas">
          <div class="cv-chips" role="group" aria-label="Filtro">${[['todas', 'Todas', cs.threads.length], ['comigo', 'Comigo', counts.comigo], ['equipe', 'Entre agentes', counts.equipe], ['pessoas', 'Com pessoas', counts.pessoas], ['clientes', 'Clientes', counts.clientes]]
            .map(([v, l, n]) => `<button type="button" class="chip ${cs.filter === v ? 'on' : ''}" data-f="${v}">${l}<span class="num">${n || 0}</span></button>`).join('')}</div>
          <div class="row"><select class="cv-who" aria-label="Participante"><option value="">Qualquer participante</option>${agents.map((a) => `<option value="${a.id}" ${cs.who === a.id ? 'selected' : ''}>${esc(a.name)} — ${esc(a.role)}</option>`).join('')}</select>
            <select class="cv-new" aria-label="Nova conversa"><option value="">+ Nova conversa…</option>${agents.filter((a) => a.id !== ctx.me).map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}</select></div>
        </div>
        <ul class="cv-list">${list.map((t) => {
          const others = t.ids.filter((id) => id !== ctx.me);
          const ps = (others.length ? others : t.ids).map((id) => person(ctx, id));
          const title = t.ids.includes(ctx.me) ? ps.map((p) => p.name).join(', ') : t.ids.map((id) => person(ctx, id).name).join(' ↔ ');
          return `<li><button type="button" class="cv-item ${cs.key === t.key ? 'on' : ''} ${t.unread ? 'unread' : ''}" data-key="${esc(t.key)}" ${t.unread ? `aria-label="${esc(title)}: ${t.unread} não lida(s)"` : ''}>
            <span class="cv-avs">${t.ids.filter((id) => id !== ctx.me || t.ids.length === 1).slice(0, 2).map((id) => avatar(person(ctx, id))).join('')}</span>
            <span class="cv-meta"><b>${esc(title)}</b><span class="cv-prev">${esc(person(ctx, t.last.from).name)}: ${esc(t.last.content)}</span></span>
            <span class="cv-side-info"><time>${ago(t.last.ts)}</time>${t.unread ? `<span class="count" title="${t.unread} não lida(s)">${t.unread}</span>` : `<small class="num" title="${t.count} mensagens">${t.count}</small>`}</span></button></li>`;
        }).join('') || '<li class="cv-empty">Nenhuma conversa com esses filtros.</li>'}</ul>
      </aside>
      <section class="cv-main" aria-live="polite">${cs.key ? '<p class="hint" style="padding:16px">Carregando…</p>' : `<div class="cv-placeholder">${ic('messages-square')}<p>Escolha uma conversa à esquerda</p><p class="hint">Ou comece uma nova com qualquer agente ou pessoa da equipe.</p></div>`}</section>
    </div>`;

  const rerender = () => renderChatPanel(root, ctx);
  let timer;
  $('.cv-search', root).oninput = (e) => { clearTimeout(timer); timer = setTimeout(() => { cs.q = e.target.value; rerender(); }, 250); };
  $$('[data-f]', root).forEach((b) => b.onclick = () => { cs.filter = b.dataset.f; rerender(); });
  $('.cv-who', root).onchange = (e) => { cs.who = e.target.value; rerender(); };
  $('.cv-new', root).onchange = (e) => { if (e.target.value) { cs.key = meKey(e.target.value); rerender(); } };
  $$('[data-key]', root).forEach((b) => b.onclick = () => { cs.key = b.dataset.key; rerender(); });
  if (cs.key) await openThread($('.cv-main', root), ctx, cs.key);
}

async function openThread(box, ctx, key) {
  const ids = key.split('|');
  const { messages } = await api('GET', `/api/threads/messages?key=${encodeURIComponent(key)}`);
  ctx.onRead?.(key); // o servidor marcou como lidas as mensagens para mim
  // tira o destaque de "não lida" desta conversa na lista
  const item = document.querySelector(`.cv-item[data-key="${CSS.escape(key)}"]`);
  const th = cs.threads.find((t) => t.key === key);
  if (item && th?.unread) { th.unread = 0; item.classList.remove('unread'); const c = item.querySelector('.count'); if (c) c.outerHTML = `<small class="num">${th.count}</small>`; }
  if (cs.key !== key) return;
  const withMe = ids.includes(ctx.me);
  const other = ids.find((id) => id !== ctx.me) || ids[0];
  const canReply = withMe && !String(other).startsWith('caixa:');
  const ps = ids.map((id) => person(ctx, id));
  let lastDay = '';
  box.innerHTML = `
    <header class="cv-head">
      <div class="cv-avs">${ps.filter((p) => p.name !== 'Você' || ps.length === 1).map((p) => avatar(p, 'big')).join('')}</div>
      <div><b>${esc(withMe ? person(ctx, other).name : ps.map((p) => p.name).join(' ↔ '))}</b><span class="hint">${esc(withMe ? person(ctx, other).role : 'conversa entre membros da equipe')} · ${messages.length} mensagem(ns)</span></div>
      <div class="row">${ids.filter((id) => ctx.byId(id) && ctx.byId(id).kind !== 'human').map((id) => `<button type="button" class="btn small ghost" data-log="${id}">${ic('activity', 'sm')}Log de ${esc(ctx.byId(id).name.split(' ')[0])}</button>`).join('')}</div>
    </header>
    <div class="cv-msgs">${messages.map((m) => {
      const d = day(m.ts);
      const sep = d !== lastDay ? `<div class="cv-day"><span>${esc(d)}</span></div>` : '';
      lastDay = d;
      const mine = m.from === ctx.me || (m.from === 'board' && ctx.ownerId() === ctx.me);
      const p = person(ctx, m.from);
      return `${sep}<div class="cv-msg ${mine ? 'mine' : ''} ${p.caixa ? 'caixa' : ''}">
        ${mine ? '' : avatar(p)}
        <div class="cv-bubble">${mine ? '' : `<div class="cv-from" style="color:${p.color}">${esc(p.name)}<span>${esc(p.role || '')}</span></div>`}
          <div class="cv-text">${renderMarkdown(m.content)}</div><time>${hhmm(m.ts)}</time></div></div>`;
    }).join('') || '<p class="cv-empty">Nenhuma mensagem ainda. Escreva abaixo para começar.</p>'}</div>
    ${canReply ? `<form class="cv-compose"><textarea rows="1" placeholder="Mensagem para ${esc(person(ctx, other).name)} (Enter envia, Shift+Enter quebra linha)" aria-label="Mensagem"></textarea><button class="btn primary">${ic('send', 'sm')}Enviar</button></form>`
      : `<div class="cv-readonly">${ic('eye', 'sm')}${withMe ? 'Avisos das caixas de entrada: o agente responde ao cliente pela integração.' : 'Você está lendo a conversa entre eles.'} ${ids.filter((id) => id !== ctx.me && ctx.byId(id)).map((id) => `<button type="button" class="btn small" data-dm="${id}">Falar com ${esc(ctx.byId(id).name.split(' ')[0])}</button>`).join('')}</div>`}`;

  const msgs = $('.cv-msgs', box);
  msgs.scrollTop = msgs.scrollHeight;
  $$('[data-log]', box).forEach((b) => b.onclick = () => ctx.openLog(b.dataset.log));
  $$('[data-dm]', box).forEach((b) => b.onclick = () => { cs.key = [ctx.me, b.dataset.dm].sort().join('|'); ctx.rerender(); });
  const form = $('.cv-compose', box);
  if (form) {
    const ta = $('textarea', form);
    ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = `${Math.min(ta.scrollHeight, 160)}px`; });
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
    form.onsubmit = async (e) => {
      e.preventDefault();
      const text = ta.value.trim();
      if (!text) return;
      try { await api('POST', '/api/goal', { text, to: other }); ta.value = ''; ctx.rerender(); } catch (err) { toast(err.message, 'err'); }
    };
    ta.focus();
  }
}

/** Chamado quando chega mensagem nova pelo WebSocket. */
/** Abre a conversa entre mim e outra pessoa/agente (na próxima vez que o painel desenhar). */
export function openChatWith(me, other) { cs.key = [me, other].sort().join('|'); cs.filter = 'todas'; cs.q = ''; cs.who = ''; }
export const openChatKey = () => cs.key;

export function chatNeedsRefresh(msg, ctx) {
  const key = [msg.from === 'board' ? ctx.ownerId() : msg.from, msg.to === 'board' ? ctx.ownerId() : msg.to].sort().join('|');
  return { key, open: key === cs.key };
}

// ---------------- log do agente ----------------
const ls = { id: null, types: [], q: '', items: [], stats: null, more: true };
const TYPES = [['message', 'Mensagens', 'message-square'], ['task', 'Tarefas', 'list-checks'], ['tool', 'Ferramentas', 'wrench'], ['job', 'Oficina', 'hammer'], ['text', 'Pensamentos', 'brain'], ['file', 'Arquivos', 'file-text'], ['error', 'Erros', 'triangle-alert'], ['system', 'Sistema', 'settings']];
const TYPE_INFO = Object.fromEntries(TYPES.map(([t, l, i]) => [t, { l, i }]));

export function openLogFor(id) { ls.id = id; ls.items = []; ls.more = true; }

export async function renderActivityPanel(root, ctx) {
  const agents = ctx.agents();
  if (!ls.id || !agents.some((a) => a.id === ls.id)) ls.id = agents.find((a) => a.kind !== 'human')?.id || agents[0]?.id;
  const a = ctx.byId(ls.id);
  root.innerHTML = `
    <div class="lg">
      <aside class="lg-side"><h4>Escolha quem</h4><ul>${agents.map((x) => `<li><button type="button" class="lg-agent ${x.id === ls.id ? 'on' : ''}" data-agent="${x.id}">
        ${avatar({ name: x.name, color: x.color })}<span><b>${esc(x.name)}</b><small>${esc(x.role)}${x.kind === 'human' ? ' · pessoa' : ''}</small></span>
        <span class="lg-dot ${x.runtime?.status || ''}" title="${esc(x.runtime?.status || '')}"></span></button></li>`).join('')}</ul></aside>
      <section class="lg-main">${a ? `
        <header class="lg-head">${avatar({ name: a.name, color: a.color }, 'big')}<div><b>${esc(a.name)}</b><span class="hint">${esc(a.title || a.role)} · tudo o que fez, do mais recente ao mais antigo</span></div>
          <div class="lg-stats" data-stats></div></header>
        <div class="lg-tools">
          <div class="cv-chips">${TYPES.map(([t, l, i]) => `<button type="button" class="chip ${ls.types.includes(t) ? 'on' : ''}" data-t="${t}">${ic(i, 'sm')}${l}</button>`).join('')}</div>
          <input type="search" class="lg-search" placeholder="Buscar no log" value="${esc(ls.q)}" aria-label="Buscar no log">
        </div>
        <ol class="lg-list" data-list><li class="hint" style="padding:16px">Carregando…</li></ol>
        <div class="lg-more"><button type="button" class="btn small" data-more hidden>Carregar mais antigos</button></div>` : '<p class="hint">Ninguém na equipe ainda.</p>'}</section>
    </div>`;

  $$('[data-agent]', root).forEach((b) => b.onclick = () => { openLogFor(b.dataset.agent); renderActivityPanel(root, ctx); });
  if (!a) return;
  $$('[data-t]', root).forEach((b) => b.onclick = () => {
    const t = b.dataset.t;
    ls.types = ls.types.includes(t) ? ls.types.filter((x) => x !== t) : [...ls.types, t];
    ls.items = []; ls.more = true;
    renderActivityPanel(root, ctx);
  });
  let timer;
  $('.lg-search', root).oninput = (e) => { clearTimeout(timer); timer = setTimeout(() => { ls.q = e.target.value; ls.items = []; ls.more = true; loadLog(root, ctx); }, 300); };
  $('[data-more]', root).onclick = () => loadLog(root, ctx, true);
  await loadLog(root, ctx);
}

async function loadLog(root, ctx, more = false) {
  const before = more && ls.items.length ? ls.items.at(-1).ts : '';
  const r = await api('GET', `/api/agents/${ls.id}/activity?limit=150&types=${ls.types.join(',')}&q=${encodeURIComponent(ls.q)}${before ? `&before=${before}` : ''}`);
  ls.items = more ? [...ls.items, ...r.items] : r.items;
  ls.more = r.items.length === 150;
  if (r.stats) ls.stats = r.stats;
  const list = $('[data-list]', root);
  if (!list) return;
  let lastDay = '';
  list.innerHTML = ls.items.map((e) => {
    const d = day(e.ts);
    const sep = d !== lastDay ? `<li class="lg-day">${esc(d)}</li>` : '';
    lastDay = d;
    const info = TYPE_INFO[e.type] || { l: e.type, i: 'dot' };
    const label = e.type === 'message' ? (e.dir === 'in' ? 'recebeu' : 'enviou') : e.name ? e.name.replace(/^mcp__iaorg__/, '').replace(/^mcp__playwright__/, 'navegador ') : info.l.toLowerCase();
    const long = String(e.text || '').length > 280 || e.detail;
    return `${sep}<li class="lg-item t-${e.type} ${e.ok === false ? 'bad' : ''}">
      <time>${hhmm(e.ts)}</time><span class="lg-ic" title="${esc(info.l)}">${ic(info.i, 'sm')}</span>
      <div class="lg-body"><div class="lg-top"><b>${esc(label)}</b>${e.task ? `<span class="tag">${esc(e.task)}</span>` : ''}${e.ok === false ? '<span class="tag bad">erro</span>' : ''}${e.link ? `<a href="${esc(e.link)}" target="_blank" rel="noopener">${ic('external-link', 'sm')}abrir</a>` : ''}</div>
        <div class="lg-text ${long ? 'clamp' : ''}">${esc(e.text || '')}</div>
        ${e.detail ? `<details><summary>Detalhes</summary><pre>${esc(e.detail)}</pre></details>` : ''}</div></li>`;
  }).join('') || '<li class="cv-empty">Nada registrado com esses filtros.</li>';
  $$('.lg-text.clamp', list).forEach((el) => { el.title = 'Clique para ver tudo'; el.onclick = () => el.classList.toggle('open'); });
  const moreBtn = $('[data-more]', root);
  if (moreBtn) moreBtn.hidden = !ls.more;
  const st = $('[data-stats]', root);
  if (st && ls.stats) st.innerHTML = `<span class="num">${ls.stats.total}</span> nas últimas 24 h${ls.stats.tool ? ` · ${ls.stats.tool} ferramentas` : ''}${ls.stats.job ? ` · ${ls.stats.job} passos na oficina` : ''}${ls.stats.error ? ` · <span class="error">${ls.stats.error} erro(s)</span>` : ''}`;
}

export const currentLogAgent = () => ls.id;
