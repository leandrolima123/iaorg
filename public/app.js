import { Office } from './office.js';
import { $, $$, esc, api, toast, toastUndo, ic, initials } from './common.js';
import { renderIntegrations, accessChips, INTEGRATION_NAMES } from './integrations-ui.js';
import { renderProfile, renderKnowledge, renderCompanyMemory, renderApprovals, resetProfileDraft } from './agent-profile.js';
import { renderFilesPanel, focusFile } from './files-ui.js';
import { preview as lookPreviewOf, CHARACTERS, ITEMS, partsOf, normalizeLook } from './avatars.js';
import { renderChatPanel, renderActivityPanel, openLogFor, currentLogAgent, openChatWith, openChatKey } from './chat-ui.js';
import { renderRoutinesPanel, routinesEditing } from './routines-ui.js';
import { renderDashboardPanel } from './dashboard-ui.js';
import { renderTradingPanel } from './trading-ui.js';
import { renderFunctionPanel, renderFunctionHire } from './functions-ui.js';
import { renderMyTelegram, telegramOpen, toggleTelegram } from './telegram-ui.js';
import { renderBrandPanel } from './brand-ui.js';

const hhmm = (ts) => new Date(ts).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
const STATUS = { idle: 'livre', thinking: 'pensando', working: 'trabalhando', meeting: 'em reunião', presenting: 'reportando', online: 'online', away: 'ausente' };
const TASK = { todo: 'A fazer', doing: 'Fazendo', review: 'Em revisão', blocked: 'Bloqueada', done: 'Concluída' };
const ROLE = { owner: 'dono', admin: 'administrador', member: 'membro' };

let S = { company: {}, agents: [], tasks: [], events: [], messages: [], usage: {}, paused: false, me: null };
let tab = 'office';
let cardAgent = null;
let teamSel = null;
let prevFilled = -1;
let prevStatus = new Map();
const freshDone = new Set();

// ---------------- início ----------------
const meInfo = await api('GET', '/api/me');
if (!meInfo.company) location.replace(meInfo.needsChoice ? '/empresas.html' : '/onboarding.html');
else if (meInfo.company.onboardingStep !== 'done' && ['owner', 'admin'].includes(meInfo.member.appRole)) location.replace('/onboarding.html');

const office = new Office($('#scene'));
office.onAgentClick((id) => openCard(id));

// ---------------- conversa por proximidade (andando pelo escritório) ----------------
// Chegou perto de alguém: abre um balão de chat acima da cabeça, com as últimas mensagens entre vocês.
const prox = { id: null, dismissed: null, el: null };
office.onProximity((id) => {
  if (!id) { prox.dismissed = null; closeProx(); return; }
  if (prox.dismissed === id) return;
  prox.id = id;
  renderProx();
});
office.onWalkChange((on) => { if (on) closeCard(); else closeProx(); });
office.onFrame(() => placeProx());
function closeProx() { prox.id = null; prox.el?.classList.add('hidden'); }
function proxMessages(id) {
  const me = S.me?.id;
  return (S.messages || []).filter((m) => (m.from === me && m.to === id) || (m.from === id && m.to === me)).slice(-4);
}
// Texto curto para o balão: sem marcação de Markdown e com no máximo ~220 caracteres.
const proxText = (s) => { const t = String(s).replace(/[*_`#>]+/g, '').replace(/\s+/g, ' ').trim(); return t.length > 220 ? `${t.slice(0, 220).replace(/\s+\S*$/, '')}…` : t; };
function renderProx() {
  const a = byId(prox.id);
  if (!a) return closeProx();
  if (!prox.el) {
    prox.el = document.createElement('div');
    prox.el.className = 'prox-chat hidden';
    prox.el.setAttribute('role', 'dialog');
    $('#scene').appendChild(prox.el);
  }
  const el = prox.el;
  if (a.kind === 'function') { // função automática: não conversa; mostra o que está fazendo e o atalho para configurar
    el.innerHTML = `
      <header><span class="who-dot" style="background:${esc(a.color)}"></span><div><b>${esc(a.name)}</b><small>${esc(a.title)} · função automática</small></div>
        <button type="button" class="pc-x" aria-label="Fechar">${ic('x', 'sm')}</button></header>
      <div class="pc-msgs"><p class="hint">${a.fn?.enabled === false ? 'Pausada.' : esc(a.runtime?.bubble || 'Trabalhando sozinha no servidor.')}</p>
        <p class="hint">Funções não leem mensagens: ajuste a configuração para mudar o que ela faz.</p></div>
      <footer><button type="button" class="pc-link" data-fn-open>${ic('settings', 'sm')}Configurar</button><span class="hint">Esc volta a andar</span></footer>`;
    el.classList.remove('hidden');
    $('.pc-x', el).onclick = () => { prox.dismissed = prox.id; closeProx(); };
    $('[data-fn-open]', el).onclick = () => openFunction(a);
    placeProx();
    return;
  }
  const typed = $('textarea', el)?.value || '';
  const hadFocus = el.contains(document.activeElement);
  const st = statusOf(a);
  const msgs = proxMessages(a.id);
  el.innerHTML = `
    <header><span class="who-dot" style="background:${esc(a.color)}"></span><div><b>${esc(a.name)}</b><small>${esc(a.role)} · ${esc(a.kind === 'human' ? (a.online ? 'online' : 'ausente') : (STATUS[st] || st))}</small></div>
      <button type="button" class="pc-x" aria-label="Fechar conversa">${ic('x', 'sm')}</button></header>
    <div class="pc-msgs">${msgs.map((m) => `<div class="pc-m ${m.from === S.me?.id ? 'mine' : ''}">${esc(proxText(m.content))}<time>${hhmm(m.ts)}</time></div>`).join('') || `<p class="hint">Diga oi para ${esc(a.name.split(' ')[0])}. ${a.kind === 'human' ? 'A mensagem chega para essa pessoa.' : 'O agente responde aqui mesmo.'}</p>`}</div>
    <form class="pc-form"><textarea rows="1" placeholder="Mensagem para ${esc(a.name.split(' ')[0])}…" aria-label="Mensagem"></textarea><button class="btn small primary" aria-label="Enviar">${ic('send', 'sm')}</button></form>
    <footer><button type="button" class="pc-link" data-card>${ic('id-card', 'sm')}Ver cartão</button><span class="hint">Enter escreve · Esc volta a andar</span></footer>`;
  el.classList.remove('hidden');
  const ta = $('textarea', el);
  ta.value = typed;
  if (hadFocus) ta.focus();
  const list = $('.pc-msgs', el); list.scrollTop = list.scrollHeight;
  $('.pc-x', el).onclick = () => { prox.dismissed = prox.id; closeProx(); };
  $('[data-card]', el).onclick = () => { const id = prox.id; office.stopWalking(); openCard(id); };
  const send = async () => {
    const text = ta.value.trim();
    if (!text) return;
    ta.disabled = true;
    try { await api('POST', '/api/goal', { text, to: a.id }); ta.value = ''; } catch (e) { toast(e.message, 'err'); }
    ta.disabled = false; ta.focus();
  };
  $('form', el).onsubmit = (e) => { e.preventDefault(); send(); };
  ta.onkeydown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    if (e.key === 'Escape') { e.preventDefault(); ta.blur(); }
    e.stopPropagation();
  };
  placeProx();
}
function placeProx() {
  if (!prox.id || !prox.el || prox.el.classList.contains('hidden')) return;
  const p = office.screenOf(prox.id);
  if (!p) return;
  const el = prox.el, w = el.offsetWidth || 300, h = el.offsetHeight || 220;
  const x = Math.max(8, Math.min(p.w - w - 8, p.x - w / 2));
  const y = Math.max(8, Math.min(p.h - h - 8, p.y - h - 14));
  el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}
// Enter (fora de um campo) leva ao balão aberto para escrever.
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || !prox.id || tab !== 'office' || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
  e.preventDefault();
  $('textarea', prox.el)?.focus();
});

const isAdmin = () => ['owner', 'admin'].includes(S.me?.appRole);
const byId = (id) => S.agents.find((a) => a.id === id);
const isHuman = (id) => byId(id)?.kind === 'human';
const nameOf = (id) => {
  if (id === S.me?.id) return 'Você';
  if (id === 'board') return S.agents.find((a) => a.appRole === 'owner')?.name || 'Dono';
  return byId(id)?.name || id;
};
const first = (id) => (id === S.me?.id ? 'Você' : nameOf(id).split(' ')[0]);
const statusOf = (a) => (a.kind === 'human' ? (a.online ? 'online' : 'away') : a.runtime?.status || 'idle');

// ---------------- tempo real ----------------
let refreshTimer = null;
let logTimer = null;
const scheduleRefresh = () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 120); };
async function refresh() {
  try { applySnapshot(await api('GET', '/api/state')); } catch (e) { if (e.status === 403) location.replace('/onboarding.html'); }
}

function connect() {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws.onopen = () => $('#connBanner').classList.add('hidden');
  ws.onclose = () => { $('#connBanner').classList.remove('hidden'); setTimeout(connect, 2000); };
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    switch (msg.type) {
      case 'refresh': scheduleRefresh(); break;
      case 'agent': {
        const a = byId(msg.id);
        if (a) a.runtime = { ...a.runtime, status: msg.status, bubble: msg.bubble, with: msg.with };
        office.setAgentState(msg.id, msg);
        renderCrew();
        if (cardAgent === msg.id) renderCard();
        break;
      }
      case 'event':
        S.events.push(msg.event); addFeed(msg.event);
        if (tab === 'activity' && msg.event.agentId === currentLogAgent() && !isEditing($('#panel-activity'))) {
          clearTimeout(logTimer); logTimer = setTimeout(renderActivity, 1500);
        }
        break;
      case 'message':
        S.messages.push(msg.message);
        if (prox.id && [msg.message.from, msg.message.to].includes(prox.id)) renderProx();
        notifyReply(msg.message);
        if (tab === 'chat' && !isEditing($('#panel-chat'))) renderChat();
        if (tab === 'desk' && !isEditing($('#panel-desk'))) renderDesk();
        if (cardAgent) renderCard();
        break;
      case 'notify': if (msg.to === S.me?.id) toast(msg.text); break;
      case 'function': // uma função rodou: atualiza o log dela se estiver aberto
        if (tab === 'activity' && msg.id === currentLogAgent() && !isEditing($('#panel-activity'))) { clearTimeout(logTimer); logTimer = setTimeout(renderActivity, 800); }
        break;
      case 'usage': S.usage = msg.usage; if (tab === 'settings' && !isEditing($('#panel-settings'))) renderSettings(); break;
      case 'files': if (tab === 'files' && !isEditing($('#panel-files'))) renderFiles(); break;
      case 'routines':
        if (tab === 'routines' && !routinesEditing() && !isEditing($('#panel-routines'))) { clearTimeout(logTimer); logTimer = setTimeout(renderRoutines, 600); }
        break;
      case 'job': {
        const list = (S.jobs ||= []);
        const i = list.findIndex((j) => j.id === msg.job.id);
        if (i >= 0) list[i] = msg.job; else list.push(msg.job);
        syncWork();
        if (tab === 'tasks' && !isEditing($('#panel-tasks'))) renderTasks();
        if (tab === 'desk' && !isEditing($('#panel-desk'))) renderDesk();
        break;
      }
    }
  };
}

// Quem está trabalhando na oficina fica sentado na mesa, com o passo atual e o progresso na tela.
function syncWork() {
  for (const a of S.agents) {
    if (a.kind === 'human') continue;
    const j = (S.jobs || []).filter((x) => x.agentId === a.id && ['starting', 'running', 'finishing'].includes(x.status)).at(-1);
    const plan = j?.plan || [];
    const cur = plan.find((p) => p.status === 'in_progress');
    office.setWork(a.id, j ? {
      active: true,
      label: cur?.text || j.phaseText || 'Trabalhando',
      progress: plan.length ? plan.filter((p) => p.status === 'completed').length / plan.length : null,
    } : null);
  }
}

function applySnapshot(data) {
  const prev = S;
  for (const t of data.tasks) {
    const before = prevStatus.get(t.id);
    if (before && before !== 'done' && t.status === 'done') freshDone.add(t.id);
  }
  prevStatus = new Map(data.tasks.map((t) => [t.id, t.status]));
  S = data;

  const logoUrl = S.company.logo ? `/api/company/logo?v=${S.company.logoVersion || 0}` : null;
  if (prev.company?.name !== S.company.name || prev.company?.logoVersion !== S.company.logoVersion) {
    document.title = `${S.company.name} — Escritório`;
    $('#brandMark').innerHTML = logoUrl ? `<img src="${logoUrl}" alt="${esc(S.company.name)}">` : esc(initials(S.company.name));
    $('#brandMark').title = `${S.company.name} · trocar de empresa`;
    office.setCompany(S.company.name, logoUrl);
  }
  const key = (list) => list.map((a) => [a.id, a.name, a.role, a.color, a.kind, a.online, JSON.stringify(a.look || '')].join('|')).join();
  if (key(prev.agents || []) !== key(S.agents)) { office.syncAgents(S.agents, S.me?.id); renderGoalTo(); }
  office.updateBoard(S.tasks);
  syncWork();
  syncTrading();
  if (S.me) { $('#meChip').textContent = initials(S.me.name); $('#meChip').title = `${S.me.name} · ${ROLE[S.me.appRole]}`; }
  const badge = $('#providerBadge');
  badge.className = 'badge ' + (S.provider === 'mock' ? 'mock' : 'live');
  badge.textContent = S.provider === 'mock' ? 'Simulado' : S.model.replace('claude-', '');
  badge.title = S.provider === 'mock' ? 'Sem chave do Claude: os agentes estão simulados, sem custo.' : `Agentes no Claude (${S.model})`;
  renderSign();
  renderCrew();
  renderFeed();
  updateDeskCount();
  updateChatCount();
  renderTab();
  if (cardAgent) renderCard();
}

// ---------------- placa de obra ----------------
function currentObra() {
  const goal = [...S.messages].reverse().find((m) => isHuman(m.from) && byId(m.to) && !isHuman(m.to) && m.content.length > 12);
  if (!goal) return null;
  const tasks = S.tasks.filter((t) => t.createdAt >= goal.ts - 1000);
  return { goal, tasks, done: tasks.filter((t) => t.status === 'done').length, blocked: tasks.filter((t) => t.status === 'blocked').length };
}

function since(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return 'agora';
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  return h < 24 ? `há ${h} h` : new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
}

function renderSign() {
  const el = $('#sign');
  const obra = currentObra();
  const pauseBtn = isAdmin()
    ? `<button class="btn small ${S.paused ? 'on' : ''}" id="pauseBtn">${ic(S.paused ? 'play' : 'pause', 'sm')}${S.paused ? 'Retomar' : 'Pausar'}</button>` : '';
  if (!obra) {
    el.className = 'sign idle' + (S.paused ? ' paused' : '');
    el.innerHTML = `
      <div class="obra"><small>Obra</small><b>Nenhuma obra em andamento</b></div>
      <div class="s-team"><small>Equipe</small><b class="num">${S.agents.length}</b></div>
      <div><small>Executado</small><b class="num">—</b></div>
      <div class="s-start"><small>Iniciada</small><b>—</b></div>
      <div class="s-meter"><small>Próximo passo</small><b style="font-size:18px;white-space:normal">Dê a primeira ordem na barra abaixo</b></div>
      <div>${pauseBtn}</div>`;
    prevFilled = -1;
  } else {
    const total = Math.max(obra.tasks.length, 1);
    const segs = Math.min(Math.max(obra.tasks.length, 10), 24);
    const filled = obra.tasks.length ? Math.round((obra.done / total) * segs) : 0;
    const pct = obra.tasks.length ? Math.round((obra.done / total) * 100) : 0;
    const crew = new Set(obra.tasks.map((t) => t.assigneeId)).size;
    const start = prevFilled < 0 ? filled : prevFilled; // só os segmentos novos animam
    el.className = 'sign' + (S.paused ? ' paused' : '');
    el.innerHTML = `
      <div class="obra"><small>Obra</small><b title="${esc(obra.goal.content)}">${esc(obra.goal.content)}</b></div>
      <div><small>Responsável</small><b>${esc(first(obra.goal.from))}</b></div>
      <div class="s-team"><small>Equipe na obra</small><b class="num">${crew || '—'}</b></div>
      <div class="s-start"><small>Iniciada</small><b>${since(obra.goal.ts)}</b></div>
      <div class="s-meter"><small>Executado · ${obra.done} de ${obra.tasks.length} tarefas${obra.blocked ? ` · ${obra.blocked} bloqueada${obra.blocked > 1 ? 's' : ''}` : ''}</small>
        <b class="num">${pct}%</b>
        <div class="meter" role="img" aria-label="${pct}% executado">${Array.from({ length: segs }, (_, i) => `<i class="${i < filled ? 'on' : ''}${i < filled && i >= start ? ' fresh' : ''}" style="animation-delay:${Math.max(0, i - start) * 45}ms"></i>`).join('')}</div></div>
      <div>${pauseBtn}</div>`;
    prevFilled = filled;
  }
  $('#pauseBtn')?.addEventListener('click', () => api('POST', '/api/control', { action: S.paused ? 'resume' : 'pause' }).catch((e) => toast(e.message, 'err')));
}

// ---------------- equipe no canteiro ----------------
function renderCrew() {
  const box = $('#crew');
  box.innerHTML = S.agents.map((a) => {
    const st = statusOf(a);
    const task = S.tasks.find((t) => t.assigneeId === a.id && t.status === 'doing');
    const color = st === 'away' || st === 'idle' ? 'var(--hair)' : a.kind === 'human' ? 'var(--done)' : 'var(--sign)';
    return `<button type="button" data-id="${a.id}" class="${a.id === cardAgent ? 'sel' : ''} ${st === 'away' ? 'away' : ''}" title="${esc(a.name)} — ${esc(a.title)}">
      <span class="dot" style="background:${color}"></span><b>${esc(a.name.split(' ')[0])}</b>
      <span>${esc(a.role)} · ${task ? esc(task.id) : STATUS[st]}</span></button>`;
  }).join('');
  $$('button', box).forEach((b) => b.onclick = () => openCard(b.dataset.id, true));
}

// ---------------- diário de obra ----------------
function stampFor(ev) {
  if (ev.type !== 'task') return '';
  if (/como concluída/.test(ev.text)) return '<span class="stamp">Concluída</span>';
  if (/como bloqueada/.test(ev.text)) return '<span class="stamp block">Bloqueada</span>';
  return '';
}
function feedItem(ev, isNew) {
  const li = document.createElement('li');
  li.className = `${ev.type}${ev.agentId ? ' click' : ''}${isNew ? ' new' : ''}`;
  li.innerHTML = `<time>${hhmm(ev.ts)}</time><span>${esc(ev.text)}${stampFor(ev)}${ev.url ? ` <a href="${esc(ev.url)}" target="_blank" rel="noopener">Abrir PR</a>` : ''}</span>`;
  if (ev.agentId) li.onclick = (e) => { if (e.target.tagName !== 'A') openCard(ev.agentId, true); };
  return li;
}
function renderFeed() {
  const ul = $('#feed');
  ul.innerHTML = '';
  const list = S.events.slice(-120).reverse();
  if (!list.length) { ul.innerHTML = '<li class="feed-empty">O diário começa quando a equipe receber a primeira ordem.</li>'; return; }
  for (const ev of list) ul.appendChild(feedItem(ev, false));
}
function addFeed(ev) {
  const ul = $('#feed');
  ul.querySelector('.feed-empty')?.remove();
  ul.prepend(feedItem(ev, true));
  while (ul.children.length > 150) ul.lastChild.remove();
}

// ---------------- nova ordem ----------------
function renderGoalTo() {
  const sel = $('#goalTo');
  const cur = sel.value;
  const others = S.agents.filter((a) => a.id !== S.me?.id && a.kind !== 'function'); // funções não recebem pedidos
  const root = others.find((a) => a.kind !== 'human' && (!a.reportsTo || isHuman(a.reportsTo)));
  sel.innerHTML = others.map((a) => `<option value="${a.id}">Para ${esc(a.name.split(' ')[0])} — ${esc(a.role)}${a.kind === 'human' ? ' (pessoa)' : ''}</option>`).join('');
  sel.value = others.some((a) => a.id === cur) ? cur : root?.id || '';
}
$('#goalForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = $('#goalText').value.trim();
  if (!text) { $('#goalText').focus(); return; }
  const btn = $('#goalBtn');
  btn.disabled = true;
  try {
    await api('POST', '/api/goal', { text, to: $('#goalTo').value });
    $('#goalText').value = '';
    toast(`Ordem enviada para ${first($('#goalTo').value)}`);
  } catch (err) { toast(err.message, 'err'); } finally { btn.disabled = false; }
});
$('#goalText').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#goalForm').requestSubmit(); } });

// ---------------- abas ----------------
function setTab(next) {
  tab = next;
  $$('.rail .tab[data-tab]').forEach((x) => x.classList.toggle('active', x.dataset.tab === tab));
  $$('.panel').forEach((p) => {
    const on = p.id === 'panel-' + tab;
    p.classList.toggle('hidden', !on);
    if (on) { p.classList.remove('enter'); void p.offsetWidth; p.classList.add('enter'); }
  });
  $('#crew').classList.toggle('hidden', tab !== 'office');
  office.setInputEnabled(tab === 'office');
  if (tab !== 'team') disposeLookPreview();
  if (tab !== 'office') { closeCard(); office.stopWalking(); }
  renderTab(true);
}
$$('.rail .tab[data-tab]').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));

const isEditing = (el) => el && el.contains(document.activeElement) && /INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName);
function renderTab(force) {
  if (!force && isEditing($('#panel-' + tab))) return;
  if (tab === 'integrations' && !force) return; // só redesenha por ação do usuário (não perde formulários abertos)
  if (tab === 'files' && !force) return;
  if (tab === 'brand' && !force) return; // formulário longo: só redesenha ao abrir a aba
  if (tab === 'trading' && !force) return; // recarrega pelo botão Atualizar, pelo período ou ao abrir a aba
  if (tab === 'dashboard' && !force) return; // o painel só recarrega por filtro ou ao abrir a aba // arquivos têm o próprio aviso de mudança (não recarrega a prévia à toa)
  if ((tab === 'chat' || tab === 'activity' || tab === 'routines') && !force) return; // atualizam pelos avisos de mensagem/evento
  if (tab === 'team' && !force && (teamSel === 'kb' || teamSel === 'new' || teamSel === 'newfn' || byId(teamSel))) return; // ficha/aparência abertas: não redesenha // ficha aberta: não perde a edição
  ({ desk: renderDesk, tasks: renderTasks, chat: renderChat, activity: renderActivity, routines: renderRoutines, files: renderFiles, team: renderTeam, settings: renderSettings, integrations: renderIntegrationsPanel, dashboard: renderDashboard, trading: renderTrading, brand: renderBrand })[tab]?.();
}

function renderBrand() {
  const panel = $('#panel-brand');
  if (!$('#brRoot', panel)) panel.innerHTML = head('Marca', 'Identidade visual, tom de voz e o modelo dos e-mails que os agentes enviam: logo, assinatura e rodapé.') + '<div id="brRoot"></div>';
  renderBrandPanel($('#brRoot', panel), { agents: S.agents.filter((a) => a.active !== false), isAdmin: isAdmin() }).catch((e) => toast(e.message || 'Erro ao carregar a marca', 'error'));
}

// ---------------- integrações ----------------
async function renderIntegrationsPanel() {
  const panel = $('#panel-integrations');
  panel.innerHTML = head('Integrações', 'Conecte os sistemas da empresa uma vez e escolha quais agentes podem usar cada um. Cada agente só enxerga as ferramentas que recebeu.') + '<div id="integRoot"><p class="hint">Carregando…</p></div>';
  try {
    await renderIntegrations($('#integRoot'), {
      agents: S.agents, me: S.me,
      reload: async () => { await refresh(); await renderIntegrationsPanel(); },
    });
  } catch (e) { $('#integRoot').innerHTML = `<p class="error">${esc(e.message)}</p>`; }
}
const head = (title, sub, extra = '') => `<div class="panel-head"><div><h2>${title}</h2>${sub ? `<p class="hint">${sub}</p>` : ''}</div>${extra}</div>`;

// ---------------- tarefas ----------------
function stamp(t) {
  if (t.status === 'done') return `<span class="stamp${freshDone.has(t.id) ? ' land' : ''}">Concluída</span>`;
  if (t.status === 'blocked') return '<span class="stamp block">Bloqueada</span>';
  if (t.status === 'approval') return '<span class="stamp doing">Aprovação</span>';
  if (t.status === 'doing' || t.status === 'review') return `<span class="stamp doing">${TASK[t.status]}</span>`;
  return '<span class="stamp todo">A fazer</span>';
}
function taskCard(t, extra = '', { live = false } = {}) {
  const who = byId(t.assigneeId);
  const job = live ? (S.jobs || []).filter((j) => j.taskId === t.id).at(-1) : null;
  return `<article class="task" data-id="${t.id}">
    <div class="task-top"><span class="task-id">${esc(t.id)}</span>${stamp(t)}</div>
    <div class="task-title">${esc(t.title)}</div>
    <div class="task-meta"><span class="who-dot" style="background:${who?.color || 'var(--hair)'}"></span>${esc(first(t.assigneeId))}${who?.kind === 'human' ? ' (pessoa)' : ''} · pedida por ${esc(first(t.creatorId))}${t.parentId ? ` · parte de ${esc(t.parentId)}` : ''}</div>
    ${job ? jobBlock(job, t) : ''}
    ${t.result && !(job && ['starting', 'running'].includes(job.status)) ? `<div class="task-res">${esc(t.result)}</div>` : ''}${extra}</article>`;
}

// Bloco "oficina" no cartão: plano, últimos passos, PR, custo e ações.
const JOB_STATUS = { starting: 'Começando', running: 'Na oficina', finishing: 'Fechando a entrega', done: 'Entregue', failed: 'Parou', cancelled: 'Cancelado', queued: 'Na fila' };
const STEP_ICON = { tool: 'terminal', text: 'message-square', tests: 'flask-conical', error: 'triangle-alert' };
function jobBlock(j, t) {
  const live = ['starting', 'running', 'finishing'].includes(j.status);
  const plan = j.plan || [];
  const done = plan.filter((p) => p.status === 'completed').length;
  const steps = (j.steps || []).filter((s) => s.type !== 'text').slice(live ? -4 : -3);
  const canAdjust = !live && byId(t.assigneeId)?.kind !== 'human' && (isAdmin() || t.creatorId === S.me?.id);
  return `<div class="job ${live ? 'live' : ''} ${j.status}">
    <div class="job-head">${ic('hammer', 'sm')}<b>${JOB_STATUS[j.status] || j.status}</b>${live ? `<span class="hint">· ${esc(j.phaseText || '')}</span>` : ''}${j.test ? '<span class="tag">teste</span>' : ''}
      <span class="num job-cost">US$ ${(j.costUsd || 0).toFixed(3).replace('.', ',')}</span></div>
    ${plan.length ? `<div class="job-plan"><div class="meter" style="--p:${Math.round((done / plan.length) * 100)}%"><i></i></div>
      <ul>${plan.map((p) => `<li class="${p.status}">${ic(p.status === 'completed' ? 'square-check' : p.status === 'in_progress' ? 'loader' : 'square', 'sm')}<span>${esc(p.text)}</span></li>`).join('')}</ul></div>` : ''}
    ${steps.length ? `<ol class="job-steps">${steps.map((s) => `<li class="${s.type}${s.ok === false ? ' bad' : ''}">${ic(STEP_ICON[s.type] || 'dot', 'sm')}<span>${s.name && s.type === 'tool' ? `<b>${esc(s.name.replace('mcp__iaorg__', '').replace('mcp__playwright__', 'navegador '))}</b> ` : ''}${esc(s.text)}</span></li>`).join('')}</ol>` : ''}
    ${j.pr ? `<a class="job-pr" href="${esc(j.pr.url)}" target="_blank" rel="noopener">${ic('git-pull-request', 'sm')}PR #${j.pr.number} · ${{ open: 'aberto', review: 'aguardando revisão', merged: 'mergeado' }[j.pr.state] || j.pr.state}${j.ci ? ` · CI ${{ success: 'verde', failure: 'vermelho', pending: 'rodando', none: 'ausente' }[j.ci]}` : ''}</a>` : ''}
    ${j.mergeNote ? `<p class="hint">${esc(j.mergeNote)}</p>` : ''}${j.error ? `<p class="error">${esc(j.error)}</p>` : ''}
    <div class="row job-actions">${live && isAdmin() && j.status !== 'finishing' ? `<button class="btn small danger" data-cancel-job="${j.id}">Cancelar</button>` : ''}
      ${canAdjust && ['failed', 'cancelled'].includes(j.status) && t.status === 'blocked' ? `<button class="btn small primary" data-retry="${t.id}">${ic('refresh-cw', 'sm')}Tentar de novo</button>` : ''}
      ${canAdjust ? `<button class="btn small" data-adjust="${t.id}">${ic('rotate-ccw', 'sm')}Pedir ajuste</button>` : ''}</div>
  </div>`;
}
// Revisão: quem pediu a tarefa (ou um admin) aprova ou pede ajuste.
const canReview = (t) => t.creatorId === S.me?.id || isAdmin();
const reviewActions = (t) => `<div class="row review-actions"><button class="btn small primary" data-approve="${t.id}">${ic('check', 'sm')}Aprovar e concluir</button></div>`;
const myReviews = () => S.tasks.filter((t) => t.status === 'review' && canReview(t) && byId(t.assigneeId)?.kind !== 'human').slice().reverse();
function bindReview(root) {
  $$('[data-approve]', root).forEach((b) => b.onclick = async () => {
    const t = S.tasks.find((x) => x.id === b.dataset.approve);
    const job = (S.jobs || []).filter((j) => j.taskId === t?.id).at(-1);
    if (job?.pr && job.pr.state !== 'merged' && !confirm(`O PR #${job.pr.number} ainda não foi mergeado no GitHub. Concluir a tarefa mesmo assim?`)) return;
    try { await api('POST', `/api/tasks/${b.dataset.approve}/update`, { status: 'done' }); toast('Tarefa concluída'); } catch (e) { toast(e.message, 'err'); }
  });
}
// Quadro de tarefas: cartões compactos + painel de detalhe; filtros e modo lista. O estado sobrevive aos redesenhos.
const tasksUi = { q: '', who: 'all', mine: false, tests: false, view: 'board', open: null, doneLimit: 12 };
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && tab === 'tasks' && tasksUi.open && !isEditing($('#panel-tasks'))) { tasksUi.open = null; renderTasks(); } });
const TASK_COLS = [['approval', 'Aguardando aprovação'], ['todo', 'A fazer'], ['doing', 'Fazendo'], ['review', 'Aguardando você'], ['blocked', 'Bloqueadas'], ['done', 'Concluídas']];
const isTest = (t) => t.test || /^\[Teste\]/.test(t.title);
const lastJob = (t) => (S.jobs || []).filter((j) => j.taskId === t.id).at(-1);
function ago(ts) {
  if (!ts) return '';
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return 'agora';
  if (m < 60) return `há ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `há ${h} h`;
  return new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}
function taskLine(t, j) {
  if (j && ['starting', 'running', 'finishing'].includes(j.status)) return `<span class="tl live">${ic('hammer', 'sm')}${esc(j.phaseText || JOB_STATUS[j.status])}</span>`;
  if (t.status === 'approval') return `<span class="tl wait">${ic('user-check', 'sm')}${esc(first(t.creatorId))} pediu · aprova ${esc(first(t.approval?.by))}</span>`;
  if (t.status === 'blocked') return `<span class="tl bad">${ic('octagon-x', 'sm')}${esc(j?.error || String(t.result || 'Bloqueada').replace(/^Parou:\s*/, '').slice(0, 90))}</span>`;
  if (t.status === 'review') return `<span class="tl wait">${ic(j?.pr ? 'git-pull-request' : 'eye', 'sm')}${j?.pr ? `PR #${j.pr.number} para revisar` : 'Para você revisar'}</span>`;
  if (j?.pr?.state === 'merged') return `<span class="tl ok">${ic('git-merge', 'sm')}Mergeado</span>`;
  return '';
}
function miniCard(t) {
  const who = byId(t.assigneeId);
  const j = lastJob(t);
  const plan = j?.plan || [];
  const live = j && ['starting', 'running', 'finishing'].includes(j.status);
  const pct = plan.length ? Math.round((plan.filter((p) => p.status === 'completed').length / plan.length) * 100) : 0;
  return `<article class="tcard ${tasksUi.open === t.id ? 'sel' : ''} ${live ? 'live' : ''}" data-open-task="${t.id}" tabindex="0" role="button" aria-label="Abrir ${esc(t.id)}: ${esc(t.title)}">
    <div class="tcard-top"><span class="task-id">${esc(t.id)}</span>${isTest(t) ? '<span class="tag">teste</span>' : ''}<span class="tcard-when">${ago(t.updatedAt || t.createdAt)}</span></div>
    <div class="tcard-title" title="${esc(t.title)}">${esc(t.title.replace(/^\[Teste\]\s*/, ''))}</div>
    <div class="tcard-foot"><span class="who-dot" style="background:${who?.color || 'var(--hair)'}"></span><span>${esc(first(t.assigneeId))}</span>${j?.costUsd ? `<span class="num tcard-cost">US$ ${j.costUsd.toFixed(2).replace('.', ',')}</span>` : ''}</div>
    ${taskLine(t, j)}
    ${live && plan.length ? `<div class="meter" style="--p:${pct}%"><i></i></div>` : ''}
  </article>`;
}
function filteredTasks() {
  const q = tasksUi.q.trim().toLowerCase();
  return S.tasks.filter((t) => (tasksUi.tests || !isTest(t))
    && (tasksUi.who === 'all' || t.assigneeId === tasksUi.who)
    && (!tasksUi.mine || t.creatorId === S.me?.id)
    && (!q || `${t.id} ${t.title} ${t.description || ''} ${t.result || ''}`.toLowerCase().includes(q)));
}
function renderTasks() {
  const panel = $('#panel-tasks');
  const all = filteredTasks();
  const open = all.filter((t) => t.status !== 'done').length;
  const people = S.agents.filter((a) => a.active !== false && S.tasks.some((t) => t.assigneeId === a.id));
  const sel = tasksUi.open && S.tasks.find((t) => t.id === tasksUi.open);
  const toolbar = `<div class="tasks-bar">
      <input type="search" class="tasks-search" placeholder="Buscar por título, ID ou resultado" value="${esc(tasksUi.q)}" aria-label="Buscar tarefas">
      <select class="tasks-who" aria-label="Filtrar por responsável"><option value="all">Todos</option>${people.map((a) => `<option value="${esc(a.id)}" ${tasksUi.who === a.id ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select>
      <button type="button" class="chip ${tasksUi.mine ? 'on' : ''}" data-tf="mine" aria-pressed="${tasksUi.mine}">Pedidas por mim</button>
      <button type="button" class="chip ${tasksUi.tests ? 'on' : ''}" data-tf="tests" aria-pressed="${tasksUi.tests}">Mostrar testes</button>
      <div class="seg" role="group" aria-label="Visualização"><button type="button" class="${tasksUi.view === 'board' ? 'on' : ''}" data-view="board">${ic('columns-3', 'sm')}Quadro</button><button type="button" class="${tasksUi.view === 'list' ? 'on' : ''}" data-view="list">${ic('list', 'sm')}Lista</button></div>
    </div>`;
  const board = `<div class="board2">${TASK_COLS.map(([st, label]) => {
    let list = all.filter((t) => t.status === st).sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
    const total = list.length;
    if (st === 'done') list = list.slice(0, tasksUi.doneLimit);
    return `<section class="col2 st-${st}"><h3>${label}<span class="num">${total}</span></h3><div class="list">${list.map(miniCard).join('') || `<p class="empty">${st === 'review' ? 'Nada esperando sua revisão.' : 'Nada aqui.'}</p>`}
      ${total > list.length ? `<button type="button" class="btn small ghost more" data-more>Ver mais ${Math.min(12, total - list.length)} de ${total - list.length}</button>` : ''}</div></section>`;
  }).join('')}</div>`;
  const rows = all.slice().sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));
  const listView = `<div class="tlist" role="table">${rows.map((t) => { const j = lastJob(t); return `<div class="trow ${tasksUi.open === t.id ? 'sel' : ''}" role="row" data-open-task="${t.id}" tabindex="0">
      <span class="task-id">${esc(t.id)}</span><span class="trow-title">${esc(t.title.replace(/^\[Teste\]\s*/, ''))}${isTest(t) ? ' <span class="tag">teste</span>' : ''}</span>
      <span class="trow-who"><span class="who-dot" style="background:${byId(t.assigneeId)?.color || 'var(--hair)'}"></span>${esc(first(t.assigneeId))}</span>
      <span>${stamp(t)}</span><span class="trow-line">${taskLine(t, j)}</span><span class="num hint">${ago(t.updatedAt || t.createdAt)}</span></div>`; }).join('') || '<p class="empty">Nenhuma tarefa com esses filtros.</p>'}</div>`;
  const extra = (t) => [t.status === 'review' && canReview(t) ? reviewActions(t) : ''].join('');
  panel.innerHTML = head('Tarefas', `${open} abertas · ${all.length - open} concluídas${S.workshop ? ' · os agentes executam na oficina' : ''}`) + toolbar
    + `<div class="tasks-wrap ${sel ? 'has-sel' : ''}">${tasksUi.view === 'board' ? board : listView}
      ${sel ? `<aside class="tdrawer" aria-label="Detalhe da tarefa"><div class="tdrawer-head"><b>${esc(sel.id)}</b><button type="button" class="btn small ghost" data-close-task aria-label="Fechar">${ic('x', 'sm')}</button></div>
        ${sel.description ? `<details class="tdesc" ${sel.status === 'todo' ? 'open' : ''}><summary>Descrição</summary><p>${esc(sel.description)}</p></details>` : ''}
        ${taskCard(sel, extra(sel), { live: true })}</aside>` : ''}</div>`;
  freshDone.clear();
  // filtros
  const search = $('.tasks-search', panel);
  search.oninput = () => { tasksUi.q = search.value; clearTimeout(renderTasks.t); renderTasks.t = setTimeout(() => { renderTasks(); const s = $('.tasks-search', panel); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }, 200); };
  $('.tasks-who', panel).onchange = (e) => { tasksUi.who = e.target.value; renderTasks(); };
  $$('[data-tf]', panel).forEach((b) => b.onclick = () => { tasksUi[b.dataset.tf] = !tasksUi[b.dataset.tf]; renderTasks(); });
  $$('[data-view]', panel).forEach((b) => b.onclick = () => { tasksUi.view = b.dataset.view; renderTasks(); });
  $('[data-more]', panel)?.addEventListener('click', () => { tasksUi.doneLimit += 12; renderTasks(); });
  // abrir / fechar detalhe
  $$('[data-open-task]', panel).forEach((el) => {
    const go = () => { tasksUi.open = tasksUi.open === el.dataset.openTask ? null : el.dataset.openTask; renderTasks(); };
    el.onclick = go;
    el.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
  });
  $('[data-close-task]', panel)?.addEventListener('click', () => { tasksUi.open = null; renderTasks(); });
  $$('.tdrawer .task-res', panel).forEach((el) => { el.classList.add('open'); });
  bindReview(panel);
  bindJobActions(panel);
}
function bindJobActions(panel) {
  $$('[data-cancel-job]', panel).forEach((b) => b.onclick = async () => {
    if (!confirm('Cancelar este trabalho? O que já foi feito no ambiente é descartado.')) return;
    try { await api('POST', `/api/jobs/${b.dataset.cancelJob}/cancel`); toast('Cancelando…'); } catch (e) { toast(e.message, 'err'); }
  });
  $$('[data-retry]', panel).forEach((b) => b.onclick = async () => {
    b.disabled = true;
    try { await api('POST', `/api/tasks/${b.dataset.retry}/update`, { status: 'todo' }); toast('Tarefa de volta à fila da oficina'); } catch (e) { toast(e.message, 'err'); b.disabled = false; }
  });
  $$('[data-adjust]', panel).forEach((b) => b.onclick = () => {
    const box = b.closest('.job-actions');
    box.innerHTML = `<input placeholder="O que ajustar? Ex.: use o domínio cuidadomental.co" aria-label="Ajuste" style="flex:1;min-width:160px"><button class="btn small primary">Enviar</button>`;
    const inp = $('input', box);
    inp.focus();
    const go = async () => {
      if (!inp.value.trim()) return;
      try { await api('POST', `/api/tasks/${b.dataset.adjust}/adjust`, { text: inp.value.trim() }); toast('Ajuste enviado: a tarefa volta para a oficina'); } catch (e) { toast(e.message, 'err'); }
    };
    $('button', box).onclick = go;
    inp.onkeydown = (e) => { if (e.key === 'Enter') go(); };
  });
}

// ---------------- minha mesa ----------------
const myTasks = () => S.tasks.filter((t) => t.assigneeId === S.me?.id && t.status !== 'done');
// Entregas dos agentes para mim: ficam na mesa até eu arquivar.
// Pedidos entre áreas aguardando a minha aprovação (admin vê também os que não têm aprovador presente).
const myApprovals = () => S.tasks.filter((t) => t.status === 'approval' && (t.approval?.by === S.me?.id || (isAdmin() && !byId(t.approval?.by)))).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
function approvalCard(t) {
  const from = byId(t.creatorId), to = byId(t.assigneeId);
  const others = S.agents.filter((a) => a.active !== false && a.id !== t.creatorId && a.kind !== 'function');
  return `<article class="task appr" data-appr="${esc(t.id)}">
    <div class="task-top"><span class="task-id">${esc(t.id)}</span><span class="stamp doing">Aguardando você</span></div>
    <div class="task-title">${esc(t.title)}</div>
    <div class="appr-route"><span class="who-dot" style="background:${esc(from?.color || '#8f8d86')}"></span><b>${esc(first(t.creatorId))}</b> pede a <span class="who-dot" style="background:${esc(to?.color || '#8f8d86')}"></span><b>${esc(first(t.assigneeId))}</b><small>${esc(to?.role || '')}</small></div>
    ${t.description ? `<div class="task-res">${esc(t.description)}</div>` : ''}
    ${t.approval?.reason ? `<p class="hint"><b>Motivo:</b> ${esc(t.approval.reason)}</p>` : ''}
    <div class="row appr-actions">
      <button class="btn small primary" data-appr-ok>${ic('check', 'sm')}Aprovar</button>
      <label class="appr-to">ou passar para <select data-appr-to aria-label="Passar para outro responsável"><option value="">${esc(to?.name || 'responsável')}</option>${others.filter((a) => a.id !== t.assigneeId).map((a) => `<option value="${esc(a.id)}">${esc(a.name)} — ${esc(a.role)}</option>`).join('')}</select></label>
      <button class="btn small ghost danger" data-appr-no>Recusar</button>
    </div>
    <div class="row appr-note hidden"><input placeholder="Motivo (obrigatório ao recusar) ou orientação ao aprovar" aria-label="Motivo ou orientação" style="flex:1;min-width:180px"><button class="btn small primary" data-appr-send>Confirmar</button></div>
  </article>`;
}
function bindApprovals(panel) {
  $$('[data-appr]', panel).forEach((card) => {
    const id = card.dataset.appr;
    const note = $('.appr-note', card), inp = $('input', note);
    let mode = null;
    const send = async () => {
      if (mode === 'recusar' && !inp.value.trim()) { inp.focus(); toast('Escreva o motivo da recusa', 'err'); return; }
      try {
        await api('POST', `/api/tasks/${id}/approval`, { decision: mode, reason: inp.value.trim(), assigneeId: $('[data-appr-to]', card).value || undefined });
        toast(mode === 'aprovar' ? 'Aprovado: a tarefa foi para a fila do responsável' : 'Recusado: quem pediu foi avisado com o motivo');
        refresh();
      } catch (e) { toast(e.message, 'err'); }
    };
    $('[data-appr-ok]', card).onclick = () => { mode = 'aprovar'; note.classList.remove('hidden'); inp.placeholder = 'Orientação para quem vai fazer (opcional)'; $('[data-appr-send]', card).textContent = 'Confirmar aprovação'; inp.focus(); };
    $('[data-appr-no]', card).onclick = () => { mode = 'recusar'; note.classList.remove('hidden'); inp.placeholder = 'Por que recusar? (vai para quem pediu)'; $('[data-appr-send]', card).textContent = 'Confirmar recusa'; inp.focus(); };
    $('[data-appr-send]', card).onclick = send;
    inp.onkeydown = (e) => { if (e.key === 'Enter') send(); };
  });
}

// Duas origens: tarefa concluída por um agente (t.desk) e pedido feito por mensagem que gerou arquivos (S.deliveries).
const myDeliveries = () => [
  ...S.tasks.filter((t) => t.status === 'done' && t.desk?.to === S.me?.id && !t.desk.dismissedAt).map((t) => ({ kind: 'task', at: t.desk.at, t })),
  ...(S.deliveries || []).filter((d) => d.to === S.me?.id && !d.dismissedAt).map((d) => ({ kind: 'chat', at: d.at, d })),
].sort((a, b) => b.at - a.at);
const whenDelivered = (at) => `Entregue ${hhmm(at)}${new Date(at).toDateString() !== new Date().toDateString() ? ` de ${new Date(at).toLocaleDateString('pt-BR')}` : ''}`;
const fileChips = (paths) => (paths.length ? `<div class="deliv-files">${paths.map((p) => `<button type="button" class="file-chip" data-open-file="${esc(p)}" title="${esc(p)}">${ic(fileIcon(p), 'sm')}<span>${esc(p.split('/').pop())}</span></button>`).join('')}</div>` : '');
function chatDeliveryCard(d, files) {
  const who = byId(d.agentId);
  const paths = d.files.filter((p) => files.some((f) => f.path === p)); // só o que ainda existe
  return `<article class="task" data-delivery="${esc(d.id)}">
    <div class="task-top"><span class="task-id">${ic('message-square', 'sm')}Pedido por mensagem</span><span class="stamp done">Entregue</span></div>
    <div class="task-title">${esc(d.request.length > 140 ? `${d.request.slice(0, 140)}…` : d.request)}</div>
    <div class="task-meta"><span class="who-dot" style="background:${who?.color || 'var(--hair)'}"></span>${esc(first(d.agentId))} · pedido por você</div>
    ${d.text ? `<div class="task-res">${esc(d.text)}</div>` : ''}
    ${fileChips(paths)}${paths.length < d.files.length ? `<p class="hint">${d.files.length - paths.length} arquivo(s) foram movidos ou apagados depois.</p>` : ''}
    <div class="row review-actions"><span class="hint">${ic('inbox', 'sm')}${whenDelivered(d.at)}</span>
      <button class="btn small" data-chat-adjust="${esc(d.id)}" style="margin-left:auto">${ic('rotate-ccw', 'sm')}Pedir ajuste</button>
      <button class="btn small primary" data-dismiss-chat="${esc(d.id)}">${ic('archive', 'sm')}Arquivar</button></div></article>`;
}
let deskFiles = { at: 0, list: [] };
async function deliveryFiles() {
  if (Date.now() - deskFiles.at > 15000) {
    try { deskFiles = { at: Date.now(), list: (await api('GET', '/api/files')).files }; } catch { /* sem arquivos */ }
  }
  return deskFiles.list;
}
const fileIcon = (p) => (/\.(png|jpe?g|gif|webp|svg)$/i.test(p) ? 'image' : /\.(csv|xlsx?)$/i.test(p) ? 'sheet' : /\.pdf$/i.test(p) ? 'file-text' : 'file');
function deliveryCard(t, files) {
  const mine = files.filter((f) => f.task === t.id).slice(0, 8);
  return taskCard(t, `
    ${fileChips(mine.map((f) => f.path))}
    <div class="row review-actions"><span class="hint">${ic('inbox', 'sm')}${whenDelivered(t.desk.at)}</span>
      <button class="btn small primary" data-dismiss="${t.id}" style="margin-left:auto">${ic('archive', 'sm')}Arquivar</button></div>`, { live: true });
}
const myInbox = () => S.messages.filter((m) => m.to === S.me?.id).slice(-80);
// Mensagens para mim agrupadas por quem mandou: não lidas primeiro, depois a mais recente.
function deskConversations(inbox) {
  const by = new Map();
  for (const m of inbox) {
    if (m.from === S.me?.id) continue;
    const c = by.get(m.from) || { from: m.from, msgs: [], unread: 0, last: 0 };
    c.msgs.push(m); c.last = m.ts;
    if (!m.readByHuman) c.unread++;
    by.set(m.from, c);
  }
  return [...by.values()].sort((a, b) => (!!b.unread - !!a.unread) || b.last - a.last).slice(0, 8);
}
function convCard(c) {
  const a = byId(c.from);
  const recent = c.msgs.slice(-3);
  return `<article class="mesa-conv${c.unread ? ' unread' : ''}" data-conv="${esc(c.from)}">
    <header><span class="who-dot" style="background:${esc(a?.color || '#8f8d86')}"></span><b>${esc(nameOf(c.from))}</b><span class="role">${esc(a?.role || '')}</span>
      ${c.unread ? `<span class="mesa-new">${c.unread} nova${c.unread > 1 ? 's' : ''}</span>` : ''}<time>${since(c.last)}</time></header>
    ${c.msgs.length > recent.length ? `<p class="mesa-more">${c.msgs.length - recent.length} mensagem(ns) anterior(es) na conversa</p>` : ''}
    ${recent.map((m) => `<div class="mesa-msg${m.readByHuman ? '' : ' new'}"><p>${esc(m.content)}</p><time>${hhmm(m.ts)}</time></div>`).join('')}
    <div class="mesa-conv-foot">${a ? `<form class="reply" data-to="${esc(c.from)}"><input placeholder="Responder a ${esc(first(c.from))}" aria-label="Resposta para ${esc(nameOf(c.from))}"><button class="btn small primary">Responder</button></form>` : ''}
      <button type="button" class="btn small ghost" data-open-conv="${esc(c.from)}">${ic('message-square', 'sm')}Abrir conversa</button></div>
  </article>`;
}
// Abrir a conversa no servidor marca como lidas as mensagens dela.
function markConvRead(from) {
  const key = [S.me?.id, from].sort().join('|');
  for (const m of S.messages) if (m.to === S.me?.id && m.from === from) m.readByHuman = true;
  updateChatCount();
  api('GET', `/api/threads/messages?key=${encodeURIComponent(key)}`).catch(() => {});
}
function updateDeskCount() {
  const n = myTasks().filter((t) => t.status === 'todo').length + (S.approvals?.length || 0) + myReviews().length + myDeliveries().length + myApprovals().length;
  const el = $('#deskCount');
  el.textContent = n;
  el.classList.toggle('hidden', !n);
}
async function renderDesk() {
  const panel = $('#panel-desk');
  const tasks = myTasks();
  const inbox = myInbox();
  const deliveries = myDeliveries();
  const files = deliveries.length ? await deliveryFiles() : [];
  if (tab !== 'desk') return; // trocou de aba enquanto buscava os arquivos
  const approvalsReq = myApprovals();
  const reviews = myReviews();
  const clientAppr = isAdmin() ? S.approvals?.length || 0 : 0;
  const convs = deskConversations(inbox);
  const unread = convs.reduce((n, c) => n + c.unread, 0);
  // na ordem de urgência: o que trava alguém vem primeiro
  const queue = [
    ['m-pedidos', 'Para aprovar', approvalsReq.length],
    ['m-clientes', 'Mensagens a clientes', clientAppr],
    ['m-revisao', 'Para revisar', reviews.length],
    ['m-entregas', 'Entregas', deliveries.length],
    ['m-tarefas', 'Tarefas a começar', tasks.filter((t) => t.status === 'todo').length],
    ['m-mensagens', 'Não lidas', unread],
  ].filter((q) => q[2]);
  const waiting = queue.reduce((n, q) => n + q[2], 0);
  const sec = (id, title, count, hint, body, cls = '') => `<section class="mesa-sec ${cls}" id="${id}">
    <header class="mesa-sec-head"><h3>${title}</h3>${count != null ? `<span class="mesa-count num">${count}</span>` : ''}${hint ? `<p class="hint">${hint}</p>` : ''}</header>${body}</section>`;
  panel.innerHTML = head('Minha mesa', waiting ? `${waiting} ${waiting === 1 ? 'item espera' : 'itens esperam'} por você.` : 'Nada esperando por você agora.',
    `<div class="row"><button type="button" class="btn small ${telegramOpen() ? 'on' : ''}" id="tgToggle" aria-expanded="${telegramOpen()}">${ic('send', 'sm')}Telegram</button><label class="btn small mesa-upload">${ic('upload', 'sm')}Enviar arquivo<input type="file" id="upFile" class="sr-only"></label></div>`) + `
    ${telegramOpen() ? sec('m-telegram', 'Minha mesa no Telegram', null, 'Receba e responda pelo celular. O que chega é escolha sua.', '<div id="tgRoot"></div>', 'tg-sec') : ''}
    ${queue.length
      ? `<nav class="mesa-queue" aria-label="O que espera por você">${queue.map(([id, label, n], i) => `<button type="button" data-jump="${id}" class="${i === 0 ? 'first' : ''}"><b class="num">${n}</b><span>${label}</span></button>`).join('')}</nav>`
      : `<div class="mesa-clear">${ic('check', 'sm')}<span><b>Mesa limpa.</b> Quando um agente pedir algo, entregar um trabalho ou mandar mensagem, aparece aqui. Para começar algo novo, dê uma ordem na barra abaixo.</span></div>`}
    ${approvalsReq.length ? sec('m-pedidos', 'Pedidos para aprovar', approvalsReq.length, 'Um agente precisa de alguém de outra área. Aprove, passe para outra pessoa ou recuse com o motivo.', `<div class="review-list">${approvalsReq.map(approvalCard).join('')}</div>`) : ''}
    ${clientAppr ? sec('m-clientes', 'Mensagens a clientes', clientAppr, 'Respostas que os agentes querem enviar. Nada sai sem o seu ok.', '<div id="approvalList"></div>') : ''}
    ${reviews.length ? sec('m-revisao', 'Para revisar', reviews.length, 'Confira o PR ou os arquivos e aprove. O merge no GitHub conclui a tarefa sozinho.', `<div class="review-list">${reviews.map((t) => taskCard(t, reviewActions(t), { live: true })).join('')}</div>`) : ''}
    ${deliveries.length ? sec('m-entregas', 'Entregas para você', deliveries.length, 'Ficam aqui até você arquivar. Não ficou bom? Peça ajuste.', `<div class="review-list">${deliveries.map((x) => (x.kind === 'task' ? deliveryCard(x.t, files) : chatDeliveryCard(x.d, files))).join('')}</div>`, 'deliveries') : ''}
    <div class="desk">
      ${sec('m-tarefas', 'Suas tarefas', tasks.length, '', tasks.map((t) => taskCard(t, `
          <textarea rows="2" placeholder="O que você entregou, links, observações" aria-label="Resultado">${esc(t.result)}</textarea>
          <div class="row">${t.status === 'todo' ? '<button class="btn small" data-st="doing">Começar</button>' : ''}
            <button class="btn small primary" data-st="done">${ic('check', 'sm')}Concluir</button>
            <button class="btn small" data-st="blocked">Estou bloqueado</button></div>`)).join('') || '<p class="empty">Nenhuma tarefa com você. Quando um agente delegar algo, aparece aqui.</p>')}
      ${sec('m-mensagens', 'Mensagens', unread ? `${unread} não lida${unread > 1 ? 's' : ''}` : null, '', convs.map(convCard).join('') || '<p class="empty">Nenhuma mensagem ainda.</p>')}
    </div>`;
  bindReview(panel);
  bindJobActions(panel);
  bindApprovals(panel);
  $('#tgToggle', panel).onclick = () => { toggleTelegram(); renderDesk(); };
  if ($('#tgRoot', panel)) renderMyTelegram($('#tgRoot', panel), { isOwner: S.me?.appRole === 'owner', goIntegrations: () => setTab('integrations') });
  $$('.review-list .task-res', panel).forEach((el) => { el.onclick = () => el.classList.toggle('open'); });
  $$('[data-open-file]', panel).forEach((b) => b.onclick = () => { focusFile(b.dataset.openFile); setTab('files'); });
  $$('[data-dismiss]', panel).forEach((b) => b.onclick = async () => {
    const id = b.dataset.dismiss;
    try {
      await api('POST', `/api/tasks/${id}/dismiss`);
      toastUndo('Entrega arquivada', async () => { await api('POST', `/api/tasks/${id}/dismiss`, { undo: true }); });
    } catch (e) { toast(e.message, 'err'); }
  });
  $$('[data-dismiss-chat]', panel).forEach((b) => b.onclick = async () => {
    const id = b.dataset.dismissChat;
    try {
      await api('POST', `/api/deliveries/${id}/dismiss`);
      toastUndo('Entrega arquivada', async () => { await api('POST', `/api/deliveries/${id}/dismiss`, { undo: true }); });
    } catch (e) { toast(e.message, 'err'); }
  });
  $$('[data-chat-adjust]', panel).forEach((b) => b.onclick = () => {
    const d = (S.deliveries || []).find((x) => x.id === b.dataset.chatAdjust);
    const box = b.closest('.review-actions');
    box.innerHTML = `<input placeholder="O que ajustar? Ex.: inclua o comparativo com outubro" aria-label="Ajuste" style="flex:1;min-width:160px"><button class="btn small primary">Enviar para ${esc(first(d.agentId))}</button>`;
    const inp = $('input', box);
    inp.focus();
    const go = async () => {
      if (!inp.value.trim()) return;
      const text = `Ajuste na entrega "${d.request.slice(0, 80)}" (${d.files.join(', ')}): ${inp.value.trim()}`;
      try { await api('POST', '/api/goal', { text, to: d.agentId }); await api('POST', `/api/deliveries/${d.id}/dismiss`); toast(`Ajuste enviado para ${first(d.agentId)}. A nova versão volta para cá.`); } catch (e) { toast(e.message, 'err'); }
    };
    $('button', box).onclick = go;
    inp.onkeydown = (e) => { if (e.key === 'Enter') go(); };
  });
  if ($('#approvalList')) renderApprovals($('#approvalList'), { approvals: S.approvals || [], agentName: nameOf, reload: refresh });
  $$('.desk .task', panel).forEach((card) => $$('[data-st]', card).forEach((b) => b.onclick = async () => {
    try { await api('POST', `/api/tasks/${card.dataset.id}/update`, { status: b.dataset.st, result: $('textarea', card).value }); toast(b.dataset.st === 'done' ? 'Tarefa concluída' : 'Tarefa atualizada'); } catch (e) { toast(e.message, 'err'); }
  }));
  $$('.reply', panel).forEach((f) => f.onsubmit = async (e) => {
    e.preventDefault();
    const input = $('input', f);
    if (!input.value.trim()) return;
    try { await api('POST', '/api/goal', { text: input.value.trim(), to: f.dataset.to }); input.value = ''; markConvRead(f.dataset.to); toast('Resposta enviada'); } catch (err) { toast(err.message, 'err'); }
  });
  $$('[data-open-conv]', panel).forEach((b) => b.onclick = () => openReply(b.dataset.openConv));
  $$('.mesa-msg p', panel).forEach((p) => { if (p.scrollHeight > p.clientHeight + 2) { p.classList.add('clamped'); p.onclick = () => p.classList.toggle('open'); } });
  $$('[data-jump]', panel).forEach((b) => b.onclick = () => {
    const el = $(`#${b.dataset.jump}`, panel);
    el?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    if (el) { el.tabIndex = -1; el.focus({ preventScroll: true }); }
  });
  $('#upFile').onchange = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try { const r = await api('POST', '/api/files/upload?name=' + encodeURIComponent(f.name), f, true); toast('Enviado: ' + r.path); } catch (err) { toast(err.message, 'err'); } finally { e.target.value = ''; }
  };
}

// ---------------- conversas ----------------
const uiCtx = () => ({
  me: S.me?.id, byId, ownerId: () => S.agents.find((a) => a.appRole === 'owner')?.id || 'board',
  agents: () => S.agents.filter((a) => a.kind !== 'function').sort((a, b) => (a.kind === 'human') - (b.kind === 'human') || a.name.localeCompare(b.name, 'pt-BR')),
  openLog: (id) => { openLogFor(id); setTab('activity'); },
  rerender: () => renderChat(),
  onRead: (key) => {
    const ids = key.split('|');
    for (const m of S.messages) if (m.to === S.me?.id && ids.includes(m.from)) m.readByHuman = true;
    updateChatCount();
  },
});

// ---------------- aviso de resposta (alguém me respondeu) ----------------
const baseTitle = () => `${S.company?.name || 'IAORG'} — Escritório`;
const unreadForMe = () => (S.messages || []).filter((m) => m.to === S.me?.id && m.from !== S.me?.id && !m.readByHuman);
function updateChatCount() {
  const n = unreadForMe().length;
  let el = $('#chatCount');
  if (!el) {
    el = document.createElement('span'); el.id = 'chatCount'; el.className = 'count hidden';
    $('.rail .tab[data-tab="chat"]')?.appendChild(el);
  }
  el.textContent = n > 99 ? '99+' : n;
  el.classList.toggle('hidden', !n);
  document.title = n && document.hidden ? `(${n}) ${baseTitle()}` : baseTitle();
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) updateChatCount(); });
let audioCtx = null;
function chime() {
  try {
    audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
    const t = audioCtx.currentTime;
    for (const [f, d] of [[880, 0], [1320, 0.12]]) {
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      o.type = 'sine'; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + d); g.gain.exponentialRampToValueAtTime(0.12, t + d + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.28);
      o.connect(g).connect(audioCtx.destination); o.start(t + d); o.stop(t + d + 0.3);
    }
  } catch { /* sem áudio */ }
}
function notifyReply(m) {
  const me = S.me?.id;
  if (!me || m.to !== me || m.from === me) return;
  updateChatCount();
  // já está vendo essa conversa (balão do escritório ou aba Conversas aberta nela): só atualiza
  const pairOpen = (tab === 'chat' && openChatKey() === [me, m.from].sort().join('|')) || prox.id === m.from;
  if (pairOpen && !document.hidden) return;
  const a = byId(m.from);
  const who = a?.name || nameOf(m.from);
  const text = String(m.content).replace(/[*_`#>]+/g, '').replace(/\s+/g, ' ').trim();
  const snippet = text.length > 160 ? `${text.slice(0, 160)}…` : text;
  chime();
  if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
    try { const n = new Notification(`${who} respondeu`, { body: snippet, tag: `msg-${m.from}` }); n.onclick = () => { window.focus(); openReply(m.from); n.close(); }; } catch { /* ok */ }
  }
  let box = $('#replyToasts');
  if (!box) { box = document.createElement('div'); box.id = 'replyToasts'; box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
  box.querySelector(`[data-from="${CSS.escape(m.from)}"]`)?.remove(); // um aviso por pessoa (o mais recente)
  const el = document.createElement('div');
  el.className = 'reply-toast'; el.dataset.from = m.from; el.setAttribute('role', 'status');
  const askNotif = 'Notification' in window && Notification.permission === 'default';
  el.innerHTML = `<span class="who-dot" style="background:${esc(a?.color || '#8f8d86')}"></span>
    <div class="rt-body"><b>${esc(who)} respondeu</b><p>${esc(snippet)}</p>
      <div class="row"><button type="button" class="btn small primary" data-open>${ic('message-square', 'sm')}Abrir conversa</button>${askNotif ? '<button type="button" class="btn small ghost" data-notif>Avisar fora da aba</button>' : ''}</div></div>
    <button type="button" class="rt-x" aria-label="Fechar">${ic('x', 'sm')}</button>`;
  box.appendChild(el);
  let timer = setTimeout(() => el.remove(), 12000);
  el.onmouseenter = () => clearTimeout(timer);
  el.onmouseleave = () => { timer = setTimeout(() => el.remove(), 5000); };
  $('.rt-x', el).onclick = () => el.remove();
  $('[data-open]', el).onclick = () => { el.remove(); openReply(m.from); };
  $('[data-notif]', el)?.addEventListener('click', async (e) => { e.target.remove(); try { await Notification.requestPermission(); } catch { /* ok */ } });
}
function openReply(from) {
  openChatWith(S.me?.id, from);
  setTab('chat');
}
function renderDashboard() {
  const panel = $('#panel-dashboard');
  if (!isAdmin()) { panel.innerHTML = head('Painel', '') + '<p class="hint">O painel de custos é visível para administradores da empresa.</p>'; return; }
  if (!$('#dbRoot', panel)) panel.innerHTML = head('Painel', 'A folha de pagamento dos agentes: quanto cada um custou, o que entregou e quanto custa cada entrega.') + '<div id="dbRoot"></div>';
  renderDashboardPanel($('#dbRoot', panel), {});
}
function renderTrading() {
  const panel = $('#panel-trading');
  if (!binanceConn()) { panel.innerHTML = head('Operações', '') + '<p class="hint">Conecte a Binance em Integrações para ver as operações da mesa.</p>'; return; }
  if (!isAdmin()) { panel.innerHTML = head('Operações', '') + '<p class="hint">As operações da mesa são visíveis para administradores da empresa.</p>'; return; }
  const vigia = S.agents.find((a) => a.kind === 'function' && a.fnKey === 'vigia_mesa');
  const sub = trSub === 'vigia' ? 'vigia' : 'resultados';
  panel.innerHTML = head('Operações', sub === 'vigia'
    ? 'O vigia é uma função automática: varre os pares no servidor, sem custo de IA, e só chama o analista quando um par passa em todos os filtros.'
    : 'O que a mesa de trading fez na Binance: resultado real, acerto, patrimônio, funil da mesa e quem fez o quê.') + `
    <div class="seg tr-subtabs" role="tablist">
      <button type="button" role="tab" class="${sub === 'resultados' ? 'on' : ''}" data-trsub="resultados" aria-selected="${sub === 'resultados'}">${ic('chart-candlestick', 'sm')}Resultados</button>
      <button type="button" role="tab" class="${sub === 'vigia' ? 'on' : ''}" data-trsub="vigia" aria-selected="${sub === 'vigia'}">${ic('radar', 'sm')}Vigia${vigia ? ` · ${esc(vigia.name)}` : ''}</button>
    </div><div id="trRoot"></div>`;
  $$('[data-trsub]', panel).forEach((b) => b.onclick = () => { trSub = b.dataset.trsub; renderTrading(); });
  const root = $('#trRoot', panel);
  if (sub === 'resultados') { renderTradingPanel(root); return; }
  if (vigia) { renderFunctionPanel(root, { id: vigia.id, canEdit: isAdmin(), onChange: refresh }); return; }
  root.innerHTML = `<div class="rt-empty">${ic('radar')}<p>Nenhum vigia na equipe.</p><p class="hint">Contrate o Vigia da mesa: ele vira um personagem do escritório e passa a varrer os pares sozinho.</p><div id="fnHireRoot"></div></div>`;
  renderFunctionHire($('#fnHireRoot', root), { agents: S.agents, me: S.me?.id, preset: 'vigia_mesa', onBack: () => { teamSel = 'newfn'; setTab('team'); }, onDone: async () => { await refresh(); renderTrading(); } });
}
let trSub = 'resultados';
// Abre a configuração de uma função: o vigia da mesa em Operações → Vigia; as outras na Equipe.
function openFunction(a) {
  closeProx(); closeCard();
  if (a.fnKey === 'vigia_mesa' && binanceConn() && isAdmin()) { trSub = 'vigia'; setTab('trading'); return; }
  teamSel = a.id; setTab('team');
}

// ---------------- mesa de trading: aba Operações e painel de mercado no escritório ----------------
const binanceConn = () => (S.integrations || []).find((i) => i.type === 'binance');
const market = { timer: null, key: '' };
async function loadMarket() {
  if (document.hidden) return;
  try { office.setMarket(await api('GET', '/api/integrations/binance/market')); }
  catch (e) { if (e.status === 404) office.setMarket(null); }
}
function syncTrading() {
  const c = binanceConn();
  $('#tradingTab').classList.toggle('hidden', !c || !isAdmin());
  if (!c && tab === 'trading') setTab('office');
  const pairs = [].concat(c?.config?.pairs || []).join(',').trim();
  const key = c ? `${c.config?.env}:${pairs}:${c.config?.halted}` : '';
  if (key === market.key) return;
  market.key = key;
  clearInterval(market.timer); market.timer = null;
  if (!c || !pairs) { office.setMarket(null); return; }
  loadMarket();
  market.timer = setInterval(loadMarket, 30_000);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && market.timer) loadMarket(); });

function renderChat() {
  const panel = $('#panel-chat');
  if (!$('#cvRoot', panel)) panel.innerHTML = head('Conversas', 'Mensagens entre agentes, pessoas e as caixas de entrada, em forma de chat.') + '<div id="cvRoot"></div>';
  renderChatPanel($('#cvRoot', panel), uiCtx());
}
function renderRoutines() {
  const panel = $('#panel-routines');
  if (!$('#rtRoot', panel)) panel.innerHTML = head('Rotinas', 'Tarefas e reuniões que se repetem: você define quem, o quê e quando; cada execução fica no histórico.') + '<div id="rtRoot"></div>';
  renderRoutinesPanel($('#rtRoot', panel), { ...uiCtx(), isAdmin: isAdmin() });
}
function renderActivity() {
  const panel = $('#panel-activity');
  if (!$('#lgRoot', panel)) panel.innerHTML = head('Atividade', 'O log completo de cada agente: mensagens, tarefas, ferramentas usadas, passos na oficina, arquivos e erros.') + '<div id="lgRoot"></div>';
  // na Atividade as funções aparecem também (o log das execuções delas), depois das pessoas e agentes
  const kindOrder = (a) => (a.kind === 'human' ? 2 : a.kind === 'function' ? 1 : 0);
  renderActivityPanel($('#lgRoot', panel), { ...uiCtx(), agents: () => S.agents.slice().sort((a, b) => kindOrder(a) - kindOrder(b) || a.name.localeCompare(b.name, 'pt-BR')) });
}

// ---------------- arquivos ----------------
async function renderFiles() {
  const panel = $('#panel-files');
  if (!$('#fmRoot', panel)) panel.innerHTML = head('Arquivos', 'O arquivo da empresa: entregas dos agentes e o que a equipe envia, organizado em pastas.') + '<div id="fmRoot"></div>';
  await renderFilesPanel($('#fmRoot', panel), { isAdmin: isAdmin(), me: S.me?.id, nameOf: (id) => nameOf(id), goIntegrations: () => setTab('integrations') });
}

// ---------------- contratar agente (modelos de cargo) ----------------
const hire = { step: 'pick', key: null, area: 'all', q: '' };
let catalogCache = null;
const HIRE_NAMES = ['Paula Costa', 'Rafael Lima', 'Fernanda Alves', 'Diego Nunes', 'Carla Mendes', 'Pedro Henrique', 'Juliana Prado', 'Thiago Reis', 'Leo Santos', 'Beatriz Lopes', 'Camila Duarte', 'Gabriel Teixeira', 'Larissa Moura', 'Mateus Farias', 'Renata Campos', 'Vitor Andrade'];
const KIT_LABEL = { research: 'Pesquisa web', browser: 'Navegador' };
async function renderHire() {
  const panel = $('#panel-team');
  const back = `<button class="btn" id="hireBack">${ic('arrow-left', 'sm')}${hire.step === 'form' ? 'Trocar modelo' : 'Voltar à equipe'}</button>`;
  if (!catalogCache) {
    panel.innerHTML = head('Contratar agente', 'Carregando os modelos de cargo…', back);
    try { catalogCache = await api('GET', '/api/catalog'); } catch (e) { toast(e.message, 'err'); return; }
  }
  const { roles, areas, models } = catalogCache;
  const integ = Object.fromEntries((S.integrations || []).map((i) => [i.type, i]));
  const accessText = (r) => Object.keys(r.access || {}).map((t) => INTEGRATION_NAMES[t] || t);
  if (hire.step === 'pick') {
    const q = hire.q.trim().toLowerCase();
    const shown = roles.filter((r) => (hire.area === 'all' || r.area === hire.area) && (!q || `${r.role} ${r.title} ${r.summary}`.toLowerCase().includes(q)));
    const have = new Set(S.agents.filter((a) => a.kind !== 'human').map((a) => a.catalogKey || a.id.split('-')[0]));
    panel.innerHTML = head('Contratar agente', 'Escolha um modelo de cargo: ele já vem com instruções, regra de verificação, kits da oficina e acessos sugeridos. Tudo é editável antes e depois de contratar.', back) + `
      <div class="hire-bar">
        <input type="search" class="hire-search" placeholder="Buscar cargo (ex.: tráfego, suporte, dev)" value="${esc(hire.q)}" aria-label="Buscar cargo">
        <div class="integ-chips">${[{ id: 'all', label: 'Todos' }, ...areas].map((a) => `<button type="button" class="chip ${hire.area === a.id ? 'on' : ''}" data-area="${a.id}" aria-pressed="${hire.area === a.id}">${esc(a.label)}</button>`).join('')}</div>
      </div>
      ${(hire.area === 'all' ? areas : areas.filter((a) => a.id === hire.area)).map((ar) => {
        const list = shown.filter((r) => r.area === ar.id);
        return list.length ? `<section class="hire-sec"><h3>${esc(ar.label)}</h3><div class="hire-grid">${list.map((r) => `
          <button type="button" class="role-card" data-role="${r.key}" style="--c:${r.color}">
            <span class="role-ic">${ic(r.icon || 'bot')}</span>
            <span class="role-txt"><b>${esc(r.role)}</b><small>${esc(r.title)}</small></span>
            ${have.has(r.key) ? '<span class="role-have">na equipe</span>' : ''}
            <span class="role-sum">${esc(r.summary || '')}</span>
            <span class="role-tags">${Object.entries(r.workshop || {}).filter(([, v]) => v).map(([k]) => `<i>${KIT_LABEL[k]}</i>`).join('')}${accessText(r).map((n) => `<i class="acc">${esc(n)}</i>`).join('')}</span>
          </button>`).join('')}</div></section>` : '';
      }).join('') || '<p class="empty">Nenhum cargo com esse nome. Use "Em branco".</p>'}
      <section class="hire-sec"><h3>Outro cargo</h3><div class="hire-grid"><button type="button" class="role-card blank" data-role=""><span class="role-ic">${ic('plus')}</span><span class="role-txt"><b>Em branco</b><small>Defina tudo do zero</small></span><span class="role-sum">Para um cargo que não está na lista. Você escreve as instruções.</span></button></div></section>`;
    $('#hireBack').onclick = () => { teamSel = null; renderTeam(); };
    const s = $('.hire-search', panel);
    s.oninput = () => { hire.q = s.value; clearTimeout(renderHire.t); renderHire.t = setTimeout(async () => { await renderHire(); const x = $('.hire-search', panel); x.focus(); x.setSelectionRange(x.value.length, x.value.length); }, 180); };
    $$('[data-area]', panel).forEach((b) => b.onclick = () => { hire.area = b.dataset.area; renderHire(); });
    $$('[data-role]', panel).forEach((b) => b.onclick = () => { hire.key = b.dataset.role || null; hire.step = 'form'; renderHire(); });
    return;
  }

  // ---------- formulário pré-preenchido ----------
  const r = roles.find((x) => x.key === hire.key) || { key: '', role: '', title: '', color: '#2e5e8c', prompt: '', verify: '', workshop: {}, access: {} };
  const taken = S.agents.map((a) => a.name);
  const name = HIRE_NAMES.find((n) => !taken.includes(n)) || '';
  // chefe sugerido: alguém da equipe com o cargo-pai do modelo; senão, o dono
  const parent = r.reportsTo && S.agents.find((a) => a.active !== false && (a.catalogKey === r.reportsTo || a.id === r.reportsTo || a.role.toLowerCase() === roles.find((x) => x.key === r.reportsTo)?.role.toLowerCase()));
  const boss = parent?.id || S.me?.id || '';
  const accessBlock = (S.integrations || []).filter((i) => i.type !== 'google_drive').map((i) => {
    const perms = r.access?.[i.type] || [];
    return `<label class="acc-row"><input type="checkbox" name="acc_${i.type}" value="${esc(perms.join(','))}" ${perms.length ? 'checked' : ''} ${perms.length ? '' : 'data-none'}>
      <span><b>${esc(INTEGRATION_NAMES[i.type] || i.type)}</b><small>${perms.length ? `sugerido: ${esc(perms.join(', '))}` : 'não sugerido para este cargo (você ajusta depois em Integrações)'}</small></span></label>`;
  }).join('');
  const missing = Object.keys(r.access || {}).filter((t) => !integ[t]).map((t) => INTEGRATION_NAMES[t] || t);
  panel.innerHTML = head('Contratar agente', r.key ? `Modelo: <b>${esc(r.role)}</b> · ${esc(r.title)}. Revise e ajuste o que quiser.` : 'Cargo em branco: defina nome, cargo e instruções.', back) + `
    <form class="form editor hire-form" id="hireForm" autocomplete="off">
      <label class="field"><span>Nome</span><input name="name" value="${esc(name)}" required></label>
      <label class="field"><span>Cargo</span><input name="role" value="${esc(r.role)}" required placeholder="Ex.: Tráfego"></label>
      <label class="field"><span>Título</span><input name="title" value="${esc(r.title)}" placeholder="Ex.: Gestor(a) de Tráfego Pago"></label>
      <label class="field"><span>Reporta a</span><select name="reportsTo"><option value="">Ninguém (topo)</option>${S.agents.filter((x) => x.active !== false).map((x) => `<option value="${x.id}" ${x.id === boss ? 'selected' : ''}>${esc(x.name)} — ${esc(x.role)}</option>`).join('')}</select></label>
      <label class="field"><span>Modelo de IA</span><select name="model"><option value="">Padrão da empresa</option>${models.map((m) => `<option value="${esc(m.id)}">${esc(m.label)}${m.note ? ` · ${esc(m.note)}` : ''}</option>`).join('')}</select></label>
      <label class="field"><span>Cor</span><input type="color" name="color" value="${esc(r.color)}"></label>
      <label class="field full"><span>Instruções e responsabilidades</span><textarea name="prompt" rows="14" required placeholder="Quem é, o que faz, como trabalha, o que entrega e os limites">${esc(r.prompt)}</textarea></label>
      <label class="field full"><span>Antes de entregar, o agente confere…</span><textarea name="verify" rows="2">${esc(r.verify || '')}</textarea></label>
      <div class="field full"><span>Kits da oficina</span><div class="row">${Object.entries(KIT_LABEL).map(([k, l]) => `<label class="chk"><input type="checkbox" name="kit_${k}" ${r.workshop?.[k] ? 'checked' : ''}> ${l}</label>`).join('')}<span class="hint">Código, atendimento e infra vêm dos acessos abaixo.</span></div></div>
      <div class="field full"><span>Acessos às integrações conectadas</span>
        ${accessBlock ? `<div class="acc-list">${accessBlock}</div>` : '<p class="hint">Nenhuma integração conectada ainda.</p>'}
        ${missing.length ? `<p class="hint">${ic('plug', 'sm')}Este cargo também usaria ${esc(missing.join(', '))}: conecte em Integrações para liberar depois.</p>` : ''}</div>
      <div class="row full"><button class="btn primary" type="submit">${ic('user-plus', 'sm')}Contratar ${r.key ? esc(r.role) : 'agente'}</button><span class="hint">Depois você completa a ficha: base de conhecimento, procedimentos, exemplos e memória.</span></div>
    </form>`;
  $('#hireBack').onclick = () => { hire.step = 'pick'; renderHire(); };
  const form = $('#hireForm');
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('button[type=submit]', form); btn.disabled = true;
    const f = Object.fromEntries(new FormData(form));
    try {
      const ag = await api('POST', '/api/agents', { name: f.name, role: f.role, title: f.title, color: f.color, reportsTo: f.reportsTo || null, prompt: f.prompt, catalogKey: r.key || undefined });
      const p = (await api('GET', `/api/agents/${ag.id}/profile`)).profile;
      await api('PUT', `/api/agents/${ag.id}/profile`, { ...p, instructions: f.prompt, model: f.model || '', workshop: { ...p.workshop, research: !!f.kit_research, browser: !!f.kit_browser, verify: f.verify || '' } });
      const granted = [];
      for (const i of S.integrations || []) {
        const box = form.querySelector(`[name="acc_${i.type}"]`);
        if (!box?.checked) continue;
        const cat = (await api('GET', '/api/integrations')).catalog.find((c) => c.type === i.type);
        const perms = box.value ? box.value.split(',') : (cat?.perms || []).slice(0, 1).map((x) => x.id);
        if (!perms.length) continue;
        await api('PUT', `/api/agents/${ag.id}/access/${i.type}`, { perms, resources: [] });
        granted.push(INTEGRATION_NAMES[i.type] || i.type);
      }
      hire.step = 'pick'; hire.key = null;
      teamSel = ag.id;
      toast(`${ag.name} contratado(a)${granted.length ? ` · acesso a ${granted.join(', ')}` : ''}`);
      await refresh(); renderTeam();
    } catch (err) { toast(err.message, 'err'); btn.disabled = false; }
  };
}

// ---------------- aparência no escritório (personagem 3D) ----------------
let lookPreview = null;
function disposeLookPreview() { lookPreview?.dispose(); lookPreview = null; }
async function renderLook(root, a, canEdit) {
  const st = normalizeLook(a.look, a.id);
  const saved = JSON.stringify(st);
  const dis = canEdit ? '' : 'disabled';
  root.innerHTML = `<div class="look">
    <div class="look-prev"><canvas aria-label="Prévia do personagem de ${esc(a.name)}"></canvas><small class="hint">Assim ${a.id === S.me?.id ? 'você aparece' : `${esc(a.name.split(' ')[0])} aparece`} no escritório</small></div>
    <div class="look-form">
      <div class="field"><span>Personagem</span><div class="look-chars">${CHARACTERS.map((c) => `<button type="button" class="chip ${st.char === c.key ? 'on' : ''}" data-char="${c.key}" aria-pressed="${st.char === c.key}" ${dis}>${esc(c.label)}</button>`).join('')}</div></div>
      <div class="field"><span>Acessórios</span><div class="look-parts"><span class="hint">Carregando…</span></div></div>
      <div class="field"><span>Cor da roupa</span><div class="row look-outfit">
        <label class="chk"><input type="radio" name="outfit" value="agent" ${st.outfit === 'agent' ? 'checked' : ''} ${dis}> Cor ${a.id === S.me?.id ? 'do seu personagem' : 'do agente'} <i class="swatch-i" style="background:${esc(a.color)}"></i></label>
        <label class="chk"><input type="radio" name="outfit" value="" ${!st.outfit ? 'checked' : ''} ${dis}> Original</label>
        <label class="chk"><input type="radio" name="outfit" value="custom" ${/^#/.test(st.outfit) ? 'checked' : ''} ${dis}> Outra: <input type="color" name="outfitColor" value="${/^#/.test(st.outfit) ? st.outfit : '#2e5e8c'}" ${dis}></label></div></div>
      <label class="field"><span>Objeto na mão</span><select name="item" ${dis}>${ITEMS.map((i) => `<option value="${i.key}" ${st.item === i.key ? 'selected' : ''}>${esc(i.label)}</option>`).join('')}</select></label>
      <label class="field"><span>Tamanho <b class="num look-scale">${Math.round(st.scale * 100)}%</b></span><input type="range" name="scale" min="0.85" max="1.15" step="0.05" value="${st.scale}" ${dis}></label>
      ${canEdit ? `<div class="row"><button type="button" class="btn primary" data-look-save disabled>${ic('check', 'sm')}Salvar aparência</button><button type="button" class="btn ghost" data-look-reset>Restaurar padrão</button></div>` : ''}
    </div></div>`;
  disposeLookPreview();
  lookPreview = lookPreviewOf($('canvas', root));
  const saveBtn = $('[data-look-save]', root);
  const changed = () => { if (saveBtn) saveBtn.disabled = JSON.stringify(st) === saved; lookPreview?.set(st, a.id, a.color); };
  const drawParts = async () => {
    const box = $('.look-parts', root);
    const parts = await partsOf(st.char);
    box.innerHTML = parts.length ? parts.map((p) => `<label class="chk"><input type="checkbox" data-part="${p.suffix}" ${(st.parts[p.suffix] ?? p.on) ? 'checked' : ''} ${dis}> ${esc(p.label)}</label>`).join('') : '<span class="hint">Este personagem não tem acessórios.</span>';
    $$('[data-part]', box).forEach((c) => c.onchange = () => { st.parts[c.dataset.part] = c.checked; changed(); });
  };
  $$('[data-char]', root).forEach((b) => b.onclick = () => {
    st.char = b.dataset.char; st.parts = {};
    $$('[data-char]', root).forEach((x) => { x.classList.toggle('on', x === b); x.setAttribute('aria-pressed', x === b); });
    drawParts(); changed();
  });
  const outfit = () => { const v = root.querySelector('[name=outfit]:checked')?.value; st.outfit = v === 'custom' ? $('[name=outfitColor]', root).value : v; changed(); };
  $$('[name=outfit]', root).forEach((r) => r.onchange = outfit);
  $('[name=outfitColor]', root).oninput = () => { root.querySelector('[name=outfit][value=custom]').checked = true; outfit(); };
  $('[name=item]', root).onchange = (e) => { st.item = e.target.value; changed(); };
  $('[name=scale]', root).oninput = (e) => { st.scale = +e.target.value; $('.look-scale', root).textContent = `${Math.round(st.scale * 100)}%`; changed(); };
  saveBtn && (saveBtn.onclick = async () => {
    try { await api('PUT', `/api/agents/${a.id}`, { look: st }); toast('Aparência salva: já está no escritório'); a.look = { ...st }; renderLook(root, a, canEdit); } catch (e) { toast(e.message, 'err'); }
  });
  $('[data-look-reset]', root) && ($('[data-look-reset]', root).onclick = () => { a = { ...a, look: null }; renderLook(root, a, canEdit).then(() => { const b = $('[data-look-save]', root); if (b) b.disabled = false; }); });
  drawParts();
  lookPreview.set(st, a.id, a.color);
}

// ---------------- equipe ----------------
function renderTeam() {
  const panel = $('#panel-team');
  disposeLookPreview();
  if (teamSel === 'new') { renderHire(); return; }
  if (teamSel === 'newfn') {
    panel.innerHTML = head('Contratar função', 'Funções são membros automáticos: rodam sozinhas no servidor, sem custo de IA, com uma configuração própria. Aparecem no escritório e no organograma.', `<button class="btn" id="backTeam">${ic('arrow-left', 'sm')}Voltar à equipe</button>`) + '<div id="fnHireRoot"></div>';
    $('#backTeam').onclick = () => { teamSel = null; renderTeam(); };
    renderFunctionHire($('#fnHireRoot'), { agents: S.agents, me: S.me?.id, onBack: () => renderTeam(), onDone: async (m) => { teamSel = m.id; await refresh(); renderTeam(); } });
    return;
  }
  const a = byId(teamSel) || (teamSel === 'new' ? { id: '', kind: 'ai', name: '', role: '', title: '', color: '#2e5e8c', reportsTo: S.me?.id || null, prompt: '' } : null);
  const canEdit = a && (isAdmin() || a.id === S.me?.id);
  const dis = canEdit ? '' : 'disabled';
  if (teamSel === 'kb') {
    panel.innerHTML = head('Base de conhecimento', 'Conteúdo que os agentes consultam para responder.', `<button class="btn" id="backTeam">${ic('arrow-left', 'sm')}Voltar à equipe</button>`) + '<div id="kbRoot"></div>';
    $('#backTeam').onclick = () => { teamSel = null; renderTeam(); };
    renderKnowledge($('#kbRoot'), { canEdit: isAdmin() }).catch((e) => toast(e.message, 'err'));
    return;
  }
  if (teamSel === 'mem') {
    panel.innerHTML = head('Memória da empresa', 'O que vale para toda a equipe: decisões, preferências e resultados que os agentes guardam para os colegas.', `<button class="btn" id="backTeam">${ic('arrow-left', 'sm')}Voltar à equipe</button>`) + '<div id="memRoot"></div>';
    $('#backTeam').onclick = () => { teamSel = null; renderTeam(); };
    renderCompanyMemory($('#memRoot'), { canEdit: isAdmin() }).catch((e) => toast(e.message, 'err'));
    return;
  }
  panel.innerHTML = head('Equipe', 'Agentes de IA e pessoas no mesmo organograma.', isAdmin() ? `<div class="row"><button class="btn" id="kbOpen">${ic('book-open', 'sm')}Base de conhecimento</button><button class="btn" id="memOpen">${ic('brain', 'sm')}Memória da empresa</button><button class="btn" id="newAgent">${ic('plus', 'sm')}Contratar agente</button><button class="btn" id="newFunction">${ic('cpu', 'sm')}Contratar função</button><a class="btn" href="/onboarding.html?step=team&edit=1">${ic('mail', 'sm')}Convidar pessoa</a></div>` : '') + `
    <div class="team">
      <div class="roster">
        ${S.agents.map((x) => `<button type="button" class="person ${x.id === teamSel ? 'active' : ''}" data-id="${x.id}">
          <span class="swatch" style="background:${x.color}"></span>
          <span><b>${esc(x.name)}${x.id === S.me?.id ? ' (você)' : ''}</b><small>${esc(x.role)} · ${esc(x.title)}</small></span>
          <span class="kind" title="${x.kind === 'human' ? 'Pessoa' : x.kind === 'function' ? 'Função automática' : 'Agente de IA'}">${x.kind === 'human' ? `<span class="presence ${x.online ? 'on' : ''}"></span>${ic('user', 'sm')}` : x.kind === 'function' ? ic('cpu', 'sm') : ic('bot', 'sm')}</span></button>`).join('')}
        ${isAdmin() && S.invites?.length ? `<div class="roster-sub"><h4>Convites pendentes</h4></div>${S.invites.map((i) => `<div style="padding:10px 12px;border-bottom:1px solid var(--hair)"><b style="font:700 15px var(--font-sign)">${esc(i.name)}</b><p class="hint">${esc(i.role)} · ${esc(i.email)}</p>
          <div class="row" style="margin-top:6px"><button class="btn small" data-copy="${location.origin}/invite/${i.token}">${ic('copy', 'sm')}Copiar link</button><button class="btn small danger" data-revoke="${i.id}">Revogar</button></div></div>`).join('')}` : ''}
      </div>
      <div>${a ? `
        <form class="form editor" id="agentForm">
          <p class="hint full">${a.kind === 'human' ? `${ic('user', 'sm')} Pessoa · ${esc(a.email || '')} · ${a.online ? 'online agora' : 'ausente'}` : a.kind === 'function' ? `${ic('cpu', 'sm')} Função automática · roda no servidor, sem IA; não lê mensagens nem recebe tarefas` : `${ic('bot', 'sm')} Agente de IA`}</p>
          <label class="field"><span>Nome</span><input name="name" value="${esc(a.name)}" required ${dis}></label>
          <label class="field"><span>Cargo</span><input name="role" value="${esc(a.role)}" required ${dis}></label>
          <label class="field"><span>Título</span><input name="title" value="${esc(a.title)}" ${dis}></label>
          <label class="field"><span>Reporta a</span><select name="reportsTo" ${dis}><option value="">Ninguém (topo)</option>${S.agents.filter((x) => x.id !== a.id).map((x) => `<option value="${x.id}" ${x.id === a.reportsTo ? 'selected' : ''}>${esc(x.name)} — ${esc(x.role)}</option>`).join('')}</select></label>
          <label class="field"><span>Cor</span><input type="color" name="color" value="${esc(a.color)}" ${dis}></label>
          ${a.kind === 'human' && S.me?.appRole === 'owner' && a.appRole !== 'owner' ? `<label class="field"><span>Acesso</span><select name="appRole"><option value="member" ${a.appRole === 'member' ? 'selected' : ''}>Membro</option><option value="admin" ${a.appRole === 'admin' ? 'selected' : ''}>Administrador</option></select></label>` : ''}
          ${a.kind === 'ai' && !a.id ? `<label class="field full"><span>Instruções e responsabilidades</span><textarea name="prompt" ${dis}>${esc(a.prompt)}</textarea></label>` : ''}
          ${a.kind === 'ai' && a.id ? `<div class="field full"><span>Acessos a sistemas</span><div class="row">${accessChips(a, S.integrations)}${isAdmin() ? `<button type="button" class="btn small" data-goto-integrations>${ic('plug', 'sm')}Gerenciar acessos</button>` : ''}</div></div>` : ''}
          ${canEdit ? `<div class="row full"><button class="btn primary" type="submit">${a.id ? 'Salvar alterações' : 'Contratar agente'}</button>
            ${a.id && isAdmin() && a.appRole !== 'owner' && a.id !== S.me?.id ? `<button class="btn danger" type="button" id="fireAgent">${a.kind === 'human' ? 'Remover da empresa' : a.kind === 'function' ? 'Demitir função' : 'Demitir agente'}</button>` : ''}</div>` : ''}
        </form>
        ${a.id ? `<h3 class="profile-title">Aparência no escritório</h3><div id="lookRoot"></div>` : ''}
        ${a.kind === 'function' && a.id ? `<h3 class="profile-title">Configuração da função</h3><div id="fnRoot"><p class="hint">Carregando…</p></div>` : ''}
        ${a.kind === 'ai' && a.id ? `<h3 class="profile-title">Ficha do agente</h3><div id="profileRoot"><p class="hint">Carregando a ficha…</p></div>` : ''}` : '<p class="hint">Escolha alguém na lista para ver e editar. Os agentes delegam tarefas para as pessoas e as pessoas para os agentes.</p>'}
      </div>
    </div>`;
  $$('.person[data-id]', panel).forEach((el) => el.onclick = () => {
    if (el.dataset.id !== teamSel) resetProfileDraft();
    teamSel = el.dataset.id; renderTeam();
  });
  $('#newAgent')?.addEventListener('click', () => { teamSel = 'new'; hire.step = 'pick'; hire.key = null; renderTeam(); });
  $('#kbOpen')?.addEventListener('click', () => { teamSel = 'kb'; renderTeam(); });
  $('#memOpen')?.addEventListener('click', () => { teamSel = 'mem'; renderTeam(); });
  $('#newFunction')?.addEventListener('click', () => { teamSel = 'newfn'; renderTeam(); });
  if ($('#fnRoot')) renderFunctionPanel($('#fnRoot'), { id: a.id, canEdit: isAdmin(), onChange: refresh });
  if ($('#lookRoot')) renderLook($('#lookRoot'), { ...a }, canEdit).catch((e) => { $('#lookRoot').innerHTML = `<p class="error">${esc(e.message)}</p>`; });
  if ($('#profileRoot')) renderProfile($('#profileRoot'), { agentId: a.id, agent: a, canEdit: isAdmin() }).catch((e) => { $('#profileRoot').innerHTML = `<p class="error">${esc(e.message)}</p>`; });
  $('[data-goto-integrations]', panel)?.addEventListener('click', () => setTab('integrations'));
  $$('[data-copy]', panel).forEach((b) => b.onclick = () => { navigator.clipboard?.writeText(b.dataset.copy); toast('Link do convite copiado'); });
  $$('[data-revoke]', panel).forEach((b) => b.onclick = async () => { await api('DELETE', '/api/invites/' + b.dataset.revoke); toast('Convite revogado'); });
  const form = $('#agentForm');
  if (form && canEdit) form.onsubmit = async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(form));
    body.reportsTo = body.reportsTo || null;
    try {
      const saved = a.id ? await api('PUT', '/api/agents/' + a.id, body) : await api('POST', '/api/agents', body);
      teamSel = saved.id;
      toast(a.id ? 'Alterações salvas' : `${saved.name} contratado`);
    } catch (err) { toast(err.message, 'err'); }
  };
  $('#fireAgent')?.addEventListener('click', async () => {
    if (!confirm(`Remover ${a.name} da empresa?`)) return;
    try { await api('DELETE', '/api/agents/' + a.id); teamSel = null; toast(`${a.name} saiu da empresa`); } catch (err) { toast(err.message, 'err'); }
  });
}

// ---------------- ajustes ----------------
const fmt = (n) => (n >= 1e6 ? (n / 1e6).toFixed(1).replace('.', ',') + ' mi' : n >= 1e3 ? (n / 1e3).toFixed(1).replace('.', ',') + ' mil' : String(n));
function renderSettings() {
  const u = S.usage || {};
  const c = S.company;
  const tokens = (u.input || 0) + (u.output || 0) + (u.cacheRead || 0) + (u.cacheWrite || 0);
  const link = (step, label) => `<a class="btn small" href="/onboarding.html?step=${step}&edit=1">${label}</a>`;
  $('#panel-settings').innerHTML = head('Ajustes', esc(c.name)) + `
    <div class="settings">
      <div class="wide"><h3>${esc(c.name)}</h3><p class="hint">${[c.segment, c.website].filter(Boolean).map(esc).join(' · ')}</p><p class="hint">${esc(c.description)}</p>
        <div class="row">${isAdmin() ? link('company', 'Empresa e contexto') : ''}${link('you', 'Meu personagem')}${S.me?.appRole === 'owner' ? link('claude', 'Claude') : ''}${isAdmin() ? link('repos', 'Repositórios') + link('team', 'Equipe e convites') : ''}<a class="btn small" href="/auth/logout">${ic('log-out', 'sm')}Sair</a></div></div>
      <div><h3>Claude</h3><p class="hint">${S.provider === 'mock' ? 'Modo simulado: o dono ainda não cadastrou a chave.' : `Modelo ${esc(S.model)}${S.secrets?.claudeKey ? ` · chave ${esc(S.secrets.claudeKey)}` : ''}`}</p>
        ${(() => {
          const spent = u.monthCostUsd || 0, lim = u.budgetUsd || 0, pct = lim ? Math.min(100, (spent / lim) * 100) : 0;
          const usd = (v, d = 2) => `US$ ${Number(v || 0).toFixed(d).replace('.', ',')}`;
          return `<div class="spend"><div class="spend-top"><b class="num">${usd(spent)}</b><span class="hint">gasto neste mês${lim ? ` de ${usd(lim)}` : ' · sem limite'}</span></div>
            ${lim ? `<div class="spend-bar ${pct >= 100 ? 'over' : pct >= 80 ? 'warn' : ''}"><i style="width:${pct}%"></i></div>` : ''}
            ${S.paused && u.pausedReason === 'budget' ? '<p class="error">Limite do mês atingido: a obra está pausada. Aumente o limite para retomar.</p>' : ''}
            <p class="hint num">Total desde o início: ${usd(u.costUsd, 4)} · ${u.calls || 0} chamadas · ${fmt(tokens)} tokens</p>
            ${S.me?.appRole === 'owner' ? `<form class="row spend-form" id="budgetForm"><label class="field" style="flex:1"><span>Limite por mês (US$)</span><input name="budgetUsd" type="number" min="0" step="1" value="${lim}" class="num"></label><button class="btn small primary">Salvar limite</button></form>
              <p class="hint">Gasto real com o Claude: agentes, oficina, reuniões e simulador. Ao atingir, a obra pausa até o próximo mês (ou até você aumentar). 0 = sem limite.</p>` : ''}</div>`;
        })()}</div>
      <div><h3>Integrações</h3><p class="hint">${S.integrations?.length ? S.integrations.map((i) => `${esc(INTEGRATION_NAMES[i.type] || i.type)} · ${i.agents.length} agente(s) com acesso`).join('<br>') : 'Nenhuma conectada. As entregas ficam no workspace.'}</p>
        <div><button type="button" class="btn small" id="gotoInteg">${ic('plug', 'sm')}Abrir integrações</button></div></div>
      <div class="wide"><h3>Acesso por IA (MCP)</h3>
        <p class="hint">Use o Claude Code, o Claude Desktop, o Cursor ou outra ferramenta de IA para configurar e operar a empresa: contratar agentes, mexer no organograma, criar rotinas e passar tarefas. Ex.: <i>"Contrate um CTO que responde ao fundador e passa demanda para os devs"</i>. Cada token age em seu nome, nunca passa do seu papel e tudo fica no diário.</p>
        <div id="mcpRoot"><p class="hint">Carregando…</p></div></div>
      ${isAdmin() ? `<div class="wide"><h3>Recomeçar</h3><p class="hint">Apaga tarefas, conversas e arquivos. Empresa, equipe e chaves continuam.</p><div><button class="btn danger" id="resetWork">Limpar trabalho</button></div></div>` : ''}
    </div>`;
  $('#gotoInteg')?.addEventListener('click', () => setTab('integrations'));
  renderMcpAccess();
  $('#budgetForm')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('PUT', '/api/settings/claude', { budgetUsd: +e.target.budgetUsd.value });
      toast('Limite de gasto salvo');
      await refresh();
      renderSettings();
    } catch (err) { toast(err.message, 'err'); }
  });
  $('#resetWork')?.addEventListener('click', async () => {
    if (!confirm('Apagar todas as tarefas, conversas e arquivos? Isso não pode ser desfeito.')) return;
    await api('POST', '/api/control', { action: 'reset' });
    toast('Trabalho apagado');
  });
}

// Tokens pessoais para o servidor MCP (/mcp). O token aparece uma única vez.
const LEVEL_HINT = { read: 'só consulta', operate: 'consulta, cria tarefas e manda mensagens', admin: 'tudo: contratar, organograma, fichas, rotinas, aprovações' };
let mcpFreshToken = null; // segura o token recém-criado mesmo se o painel redesenhar
async function renderMcpAccess(created) {
  const root = $('#mcpRoot');
  if (!root) return;
  if (created) mcpFreshToken = created;
  const fresh = mcpFreshToken;
  let d;
  try { d = await api('GET', '/api/tokens'); } catch (e) { root.innerHTML = `<p class="error">${esc(e.message)}</p>`; return; }
  const levels = Object.keys(d.levels).filter((k) => ['read', 'operate', 'admin'].indexOf(k) <= ['read', 'operate', 'admin'].indexOf(d.maxLevel));
  const member = (id) => S.agents.find((a) => a.id === id)?.name || id;
  const when = (t) => (t ? new Date(t).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : 'nunca');
  const cmd = (tok) => `claude mcp add --transport http iaorg ${d.mcpUrl} --header "Authorization: Bearer ${tok}"`;
  // plugin do Claude Code (MCP + skills): o token vai para o cofre de credenciais do sistema
  const plugin = (tok) => `claude plugin marketplace add leandrolima123/iaorg && claude plugin install iaorg@iaorg --config iaorg_url=${d.mcpUrl.replace(/\/mcp$/, '')} --config iaorg_token=${tok}`;
  root.innerHTML = `
    ${fresh ? `<div class="mcp-fresh"><p><b>Token criado. Copie agora: ele não aparece de novo.</b></p>
      <label class="field"><span>Plugin do Claude Code (recomendado: traz as skills e guarda o token no cofre do sistema)</span><div class="row"><input readonly class="mono" value="${esc(plugin(fresh))}" id="mcpPlugin"><button type="button" class="btn small" data-copy="mcpPlugin">${ic('copy', 'sm')}Copiar</button></div></label>
      <label class="field"><span>Claude Code, só a conexão MCP (sem o plugin)</span><div class="row"><input readonly class="mono" value="${esc(cmd(fresh))}" id="mcpCmd"><button type="button" class="btn small" data-copy="mcpCmd">${ic('copy', 'sm')}Copiar</button></div></label>
      <label class="field"><span>Outras ferramentas: URL <code>${esc(d.mcpUrl)}</code> e cabeçalho Authorization</span><div class="row"><input readonly class="mono" value="Bearer ${esc(fresh)}" id="mcpTok"><button type="button" class="btn small" data-copy="mcpTok">${ic('copy', 'sm')}Copiar</button></div></label>
      <div><button type="button" class="btn small" id="mcpDone">${ic('check', 'sm')}Já copiei</button></div></div>` : ''}
    <form class="row mcp-form" id="mcpForm">
      <label class="field" style="flex:2"><span>Nome (onde vai usar)</span><input name="name" maxlength="60" placeholder="Claude Code do notebook" required></label>
      <label class="field" style="flex:1"><span>Nível</span><select name="level">${levels.map((k) => `<option value="${k}" ${k === 'operate' ? 'selected' : ''}>${esc(d.levels[k])}</option>`).join('')}</select></label>
      <button class="btn small primary">${ic('key-round', 'sm')}Criar token</button>
    </form>
    <p class="hint">${levels.map((k) => `<b>${esc(d.levels[k])}</b>: ${LEVEL_HINT[k]}`).join(' · ')}. Chaves, conexões de integrações e tokens nunca podem ser mexidos por token.</p>
    ${d.tokens.length ? `<table class="mcp-tokens"><thead><tr><th>Nome</th><th>Nível</th><th>De</th><th>Criado</th><th>Último uso</th><th></th></tr></thead><tbody>
      ${d.tokens.map((t) => `<tr><td>${esc(t.name)} <span class="hint mono">${esc(t.prefix)}…</span></td><td>${esc(d.levels[t.level])}</td><td>${esc(member(t.memberId))}</td><td class="num">${when(t.createdAt)}</td><td class="num">${when(t.lastUsedAt)}</td><td><button type="button" class="btn small danger" data-revoke="${esc(t.id)}">Revogar</button></td></tr>`).join('')}
    </tbody></table>` : '<p class="hint">Nenhum token ativo.</p>'}`;
  root.querySelectorAll('[data-copy]').forEach((b) => b.addEventListener('click', async () => {
    const inp = $(`#${b.dataset.copy}`);
    try { await navigator.clipboard.writeText(inp.value); toast('Copiado'); } catch { inp.select(); document.execCommand('copy'); toast('Copiado'); }
  }));
  root.querySelector('#mcpDone')?.addEventListener('click', () => { mcpFreshToken = null; renderMcpAccess(); });
  root.querySelector('#mcpForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const r = await api('POST', '/api/tokens', { name: e.target.name.value, level: e.target.level.value });
      renderMcpAccess(r.token);
    } catch (err) { toast(err.message, 'err'); }
  });
  root.querySelectorAll('[data-revoke]').forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Revogar este token? A ferramenta que usa ele perde o acesso na hora.')) return;
    try { await api('DELETE', `/api/tokens/${b.dataset.revoke}`); toast('Token revogado'); renderMcpAccess(); } catch (err) { toast(err.message, 'err'); }
  }));
}

// ---------------- cartão do agente ----------------
function openCard(id, focus) {
  if (tab !== 'office') setTab('office');
  cardAgent = id;
  office.select(id);
  if (focus) office.focus(id);
  renderCard();
  renderCrew();
}
function closeCard() {
  cardAgent = null;
  office.select(null);
  $('#agentCard').classList.add('hidden');
  renderCrew();
}
function renderCard() {
  const a = byId(cardAgent);
  const el = $('#agentCard');
  if (!a) { el.classList.add('hidden'); return; }
  if (isEditing(el) && el.dataset.agent === a.id) return;
  el.dataset.agent = a.id;
  if (a.kind === 'function') {
    el.classList.remove('hidden');
    el.innerHTML = `<button class="btn small ghost close" title="Fechar" aria-label="Fechar">${ic('x', 'sm')}</button>
      <h3>${esc(a.name)}</h3>
      <div class="sub">${ic('cpu', 'sm')} ${esc(a.title)} · função automática · <span class="stamp ${a.fn?.enabled === false ? 'todo' : 'doing'}">${a.fn?.enabled === false ? 'pausada' : 'trabalhando'}</span></div>
      <p class="hint">${esc(a.runtime?.bubble || 'Roda sozinha no servidor, sem IA. Não lê mensagens nem recebe tarefas.')}</p>
      <button class="btn small primary" data-fn-open>${ic('settings', 'sm')}Configurar</button>`;
    el.querySelector('.close').onclick = closeCard;
    el.querySelector('[data-fn-open]').onclick = () => openFunction(a);
    return;
  }
  const st = statusOf(a);
  const tasks = S.tasks.filter((t) => t.assigneeId === a.id && t.status !== 'done');
  const msgs = S.messages.filter((m) => m.from === a.id || m.to === a.id).slice(-4).reverse();
  const boss = byId(a.reportsTo);
  el.classList.remove('hidden');
  el.innerHTML = `<button class="btn small ghost close" title="Fechar" aria-label="Fechar">${ic('x', 'sm')}</button>
    <h3>${esc(a.name)}${a.id === S.me?.id ? ' (você)' : ''}</h3>
    <div class="sub">${a.kind === 'human' ? ic('user', 'sm') : ic('bot', 'sm')} ${esc(a.title)}${boss ? ` · reporta a ${esc(first(boss.id))}` : ''} · <span class="stamp ${st === 'away' || st === 'idle' ? 'todo' : 'doing'}">${STATUS[st] || st}</span></div>
    <h4>Tarefas abertas</h4>
    <ul>${tasks.map((t) => `<li><b>${esc(t.id)}</b> ${esc(t.title)} <span class="hint">(${TASK[t.status]})</span></li>`).join('') || '<li class="hint">Nenhuma.</li>'}</ul>
    <h4>Últimas mensagens</h4>
    <ul>${msgs.map((m) => `<li>${esc(first(m.from))} → ${esc(first(m.to))}: ${esc(m.content.slice(0, 120))}</li>`).join('') || '<li class="hint">Nenhuma.</li>'}</ul>
    ${a.id !== S.me?.id ? `<form id="dmForm"><input placeholder="Mensagem para ${esc(a.name.split(' ')[0])}" aria-label="Mensagem"><button class="btn small primary">Enviar</button></form>` : ''}`;
  el.querySelector('.close').onclick = closeCard;
  const form = el.querySelector('#dmForm');
  if (form) form.onsubmit = async (e) => {
    e.preventDefault();
    const input = form.querySelector('input');
    if (!input.value.trim()) return;
    try { await api('POST', '/api/goal', { text: input.value.trim(), to: a.id }); input.value = ''; toast('Mensagem enviada'); } catch (err) { toast(err.message, 'err'); }
  };
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && cardAgent) closeCard(); });

await refresh();
connect();

// Volta do OAuth do Google (ou link direto): /?tab=integrations[&erro=...]
const qs = new URLSearchParams(location.search);
if (qs.get('tab') && document.querySelector(`.rail .tab[data-tab="${qs.get('tab')}"]`)) setTab(qs.get('tab'));
if (qs.get('erro')) toast(qs.get('erro'), 'err');
if (qs.has('tab') || qs.has('erro')) history.replaceState(null, '', '/');
