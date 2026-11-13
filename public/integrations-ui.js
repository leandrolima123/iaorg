// Catálogo de integrações + acesso por agente. Usado na aba "Integrações" e no onboarding.
import { $, $$, esc, api, toast, ic } from './common.js';

let reposCache = null;
// Estado da tela que sobrevive aos redesenhos: o que está aberto, o filtro e qual formulário de conexão está visível.
const ui = { open: new Set(), cat: 'all', connecting: null };

/**
 * Desenha o catálogo dentro de `root`.
 * ctx = { agents, me: { appRole }, reload: async () => void }
 */
export async function renderIntegrations(root, ctx) {
  const data = await api('GET', '/api/integrations');
  const isOwner = ctx.me?.appRole === 'owner';
  const isAdmin = ['owner', 'admin'].includes(ctx.me?.appRole);
  const connected = Object.fromEntries(data.connected.map((c) => [c.type, c]));
  const ai = ctx.agents.filter((a) => a.kind !== 'human' && a.active !== false);
  const available = data.catalog.filter((c) => c.status === 'available');
  const soon = data.catalog.filter((c) => c.status === 'soon');

  const cats = [...new Set(available.map((c) => c.category))];
  if (ui.cat !== 'all' && !cats.includes(ui.cat)) ui.cat = 'all';
  const inCat = (c) => ui.cat === 'all' || c.category === ui.cat;
  const withAccess = new Set(data.connected.flatMap((c) => (c.agents || []).filter((a) => a.perms?.length).map((a) => a.id)));
  // Conectada mas ainda falta escolher o que liberar (repositórios, projetos, conta de anúncios).
  const pending = (c, conn) => (c.type === 'github' && !(conn.config.repos || []).length) || (c.type === 'railway' && !(conn.config.projects || []).length)
    || (c.type === 'google_ads' && !conn.config?.customerId) || (c.type === 'resend' && !(conn.config.inboxes || []).length)
    || (c.type === 'binance' && ['pairs', 'maxOrderUsdt', 'maxRiskUsdt', 'maxDailyLossUsdt', 'maxPositions'].some((k) => !String(conn.config?.[k] ?? '').trim()));

  function draw() {
    const on = available.filter((c) => connected[c.type] && inCat(c));
    const off = available.filter((c) => !connected[c.type] && inCat(c));
    root.innerHTML = `
      <div class="integ-top">
        <p class="integ-stats"><b class="num">${data.connected.length}</b> de ${available.length} conectadas · <b class="num">${withAccess.size}</b> agente(s) com algum acesso</p>
        <div class="integ-chips" role="group" aria-label="Filtrar por categoria">
          ${['all', ...cats].map((k) => `<button type="button" class="chip ${ui.cat === k ? 'on' : ''}" data-cat="${esc(k)}" aria-pressed="${ui.cat === k}">${k === 'all' ? 'Todas' : esc(k)}</button>`).join('')}
        </div>
      </div>
      ${on.length ? `<section class="integ-sec"><h3>Conectadas <span class="num">(${on.length})</span></h3>
        <div class="integ-list">${on.map((c) => card(c, connected[c.type])).join('')}</div></section>` : ''}
      ${off.length ? `<section class="integ-sec"><h3>Disponíveis para conectar <span class="num">(${off.length})</span></h3>
        <div class="integ-grid">${off.map((c) => tile(c)).join('')}</div></section>` : ''}
      ${!on.length && !off.length ? '<p class="hint">Nada nesta categoria.</p>' : ''}
      ${soon.length && ui.cat === 'all' ? `<section class="integ-sec"><h3>Em breve</h3>
        <div class="integ-soon">${soon.map((c) => `<span class="soon-chip" title="${esc(c.description)}">${ic(c.icon, 'sm')}${esc(c.name)}<small>${esc(c.category)}</small></span>`).join('')}</div></section>` : ''}`;
    bind();
  }

  function tile(c) {
    const open = ui.connecting === c.type;
    const action = !isOwner ? '<p class="hint">Só o dono da empresa conecta integrações.</p>'
      : c.auth === 'google' && c.googleReady ? `<a class="btn small primary" href="/integrations/google/start?type=${c.type}">${ic('plug', 'sm')}Conectar conta Google</a>`
      : open ? '' : `<button type="button" class="btn small primary" data-open-connect>${ic('plug', 'sm')}Conectar</button>`;
    return `<article class="integ tile ${open ? 'expanded' : ''}" data-type="${c.type}">
      <header>${ic(c.icon)}<div><b>${esc(c.name)}</b><span class="label">${esc(c.category)}</span></div></header>
      <p class="hint integ-desc">${esc(c.description)}</p>
      ${open || (c.auth === 'google' && !c.googleReady) ? connectForm(c) : ''}
      <div class="tile-foot">${action}${open ? `<button type="button" class="btn small ghost" data-close-connect>Cancelar</button>` : ''}</div>
    </article>`;
  }

  function summary(c, conn, extra) {
    const names = c.companyWide ? null : (conn.agents || []).filter((a) => a.perms?.length).map((a) => ctx.agents.find((x) => x.id === a.id)?.name.split(' ')[0] || a.id);
    const who = c.companyWide ? 'Empresa toda' : names.length ? `${names.slice(0, 3).join(', ')}${names.length > 3 ? ` +${names.length - 3}` : ''}` : 'Ninguém com acesso';
    const status = conn.error ? `<span class="badge err">${ic('unplug', 'sm')}Com erro</span>`
      : pending(c, conn) ? `<span class="badge todo">${ic('settings-2', 'sm')}Configurar</span>`
      : `<span class="badge live">${ic('check', 'sm')}Conectado</span>`;
    return `<summary>
      <span class="integ-ic">${ic(c.icon)}</span>
      <span class="integ-name"><b>${esc(c.name)}</b><span class="label">${esc(c.category)}</span></span>
      <span class="integ-acct" title="${esc(conn.account || '')}">${ic('key-round', 'sm')}<span>${esc(conn.account || 'Conta conectada')}</span></span>
      <span class="integ-who ${!c.companyWide && !names.length ? 'none' : ''}">${ic(c.companyWide ? 'building' : 'users', 'sm')}<span>${esc(who)}</span></span>
      ${status}
      <span class="integ-chev">${ic('chevron-down', 'sm')}</span>
    </summary>${extra || ''}`;
  }

  function card(c, conn) {
    const open = ui.open.has(c.type) ? 'open' : '';
    if (c.companyWide) {
      return `<details class="integ on" data-type="${c.type}" ${open}>${summary(c, conn)}
        <div class="integ-body">
          <p class="hint">${esc(c.description)}</p>
          ${conn.error ? `<p class="error">${esc(conn.error)}</p>` : ''}
          <p class="hint">Vale para a empresa toda: não precisa dar acesso por agente. Veja o estado do espelho e sincronize na aba <b>Arquivos</b>.</p>
          ${isOwner ? `<div class="row integ-foot"><button type="button" class="btn small ghost" data-disconnect>${ic('unplug', 'sm')}Desconectar</button></div>` : ''}
        </div></details>`;
    }
    const grantees = ai.map((a) => {
      const acc = conn.agents.find((x) => x.id === a.id);
      return { a, perms: acc?.perms || [], resources: acc?.resources || [], suggested: c.suggest?.some((s) => String(a.catalogKey || a.id).split('-')[0] === s || String(a.role).toLowerCase().startsWith(s)) };
    });
    const resList = c.type === 'github' ? (conn.config.repos || []).map((r) => r.fullName)
      : c.type === 'resend' ? (conn.config.inboxes || [])
      : c.type === 'railway' ? (conn.config.projects || []).map((p) => p.name) : [];
    return `<details class="integ on" data-type="${c.type}" ${open}>${summary(c, conn)}
      <div class="integ-body">
      <p class="hint">${esc(c.description)}</p>
      ${conn.error ? `<p class="error">${esc(conn.error)}</p>` : ''}
      ${configBlock(c, conn)}
      <div class="access">
        <div class="access-head"><h4>Quem tem acesso</h4>
          ${isAdmin && grantees.some((g) => g.suggested && !g.perms.length) ? `<button type="button" class="btn small" data-suggest>${ic('shield-check', 'sm')}Liberar para os sugeridos</button>` : ''}</div>
        <table class="access-table">
          <thead><tr><th>Agente</th>${c.perms.map((p) => `<th>${esc(p.label)}</th>`).join('')}${resList.length ? `<th>${esc(c.resource.label)}</th>` : ''}</tr></thead>
          <tbody>${grantees.map(({ a, perms, resources, suggested }) => `
            <tr data-agent="${a.id}" class="${perms.length ? 'has' : ''}">
              <td><b>${esc(a.name)}</b><small>${esc(a.role)}${suggested ? ' · sugerido' : ''}</small></td>
              ${c.perms.map((p) => `<td><input type="checkbox" data-perm="${p.id}" ${perms.includes(p.id) ? 'checked' : ''} ${isAdmin ? '' : 'disabled'} aria-label="${esc(p.label)} — ${esc(a.name)}"></td>`).join('')}
              ${resList.length ? `<td><select data-res ${isAdmin ? '' : 'disabled'} aria-label="${esc(c.resource.label)} de ${esc(a.name)}">
                <option value="">Todos (${resList.length})</option>${resList.map((r) => `<option value="${esc(r)}" ${resources.length === 1 && resources[0] === r ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select></td>` : ''}
            </tr>`).join('') || `<tr><td colspan="9" class="hint">Contrate agentes de IA para dar acesso.</td></tr>`}</tbody>
        </table>
      </div>
      ${isOwner ? `<div class="row integ-foot"><button type="button" class="btn small ghost" data-disconnect>${ic('unplug', 'sm')}Desconectar</button></div>` : ''}
      </div></details>`;
  }

  function connectForm(c) {
    if (c.auth === 'google') {
      return c.googleReady
        ? `<a class="btn primary" href="/integrations/google/start?type=${c.type}">${ic('plug', 'sm')}Conectar conta Google</a>`
        : `<p class="hint">Para conectar, crie um cliente OAuth (Aplicativo da Web) no Google Cloud com o redirect <code>${esc(data.redirectUri)}</code> e defina <code>GOOGLE_CLIENT_ID</code> e <code>GOOGLE_CLIENT_SECRET</code> no .env.</p>`;
    }
    const tokenInputs = c.tokenParts
      // "new-password" e nomes neutros: o navegador não trata como formulário de login nem preenche e-mail/senha salvos.
      ? c.tokenParts.map((p) => `<label class="field"><span>${esc(p.label)}</span><input name="tp_${p.key}" type="${p.secret ? 'password' : 'text'}" autocomplete="${p.secret ? 'new-password' : 'off'}" data-1p-ignore data-lpignore="true" spellcheck="false" required></label>`).join('')
      : `<label class="field"><span>${esc(c.tokenLabel)}</span><input name="token" type="password" autocomplete="new-password" data-1p-ignore data-lpignore="true" placeholder="${esc(c.tokenPlaceholder)}" required></label>`;
    return `<form class="integ-form" data-connect autocomplete="off">
      ${tokenInputs}
      ${(c.configFields || []).map((f) => c.type === 'binance' && f.key === 'pairs'
        ? pairPicker('', 'testnet')
        : f.options
        ? `<label class="field"><span>${esc(f.label)}</span><select name="${f.key}">${f.options.map((o) => `<option value="${esc(o.value)}">${esc(o.label)}</option>`).join('')}</select></label>`
        : `<label class="field"><span>${esc(f.label)}</span><input name="${f.key}" autocomplete="off" data-1p-ignore data-lpignore="true" spellcheck="false" placeholder="${esc(f.placeholder || '')}"></label>`).join('')}
      ${c.tokenHelp ? `<p class="hint">${esc(c.tokenHelp)}${c.tokenUrl ? ` <a href="${esc(c.tokenUrl)}" target="_blank" rel="noopener">Abrir</a>` : ''}</p>` : ''}
      ${c.auth === 'google' ? '' : `<div><button class="btn primary">${ic('plug', 'sm')}Conectar ${esc(c.name)}</button></div>`}
    </form>`;
  }

  // Seletor de pares da Binance: checkbox com busca, lista vinda da própria Binance (pares em USDT por volume).
  function pairPicker(value, env, disabled = false) {
    return `<div class="field pair-picker" data-pair-picker data-env="${esc(env)}" ${disabled ? 'data-disabled' : ''}>
      <span>Pares permitidos</span>
      <input type="hidden" name="pairs" value="${esc(value)}">
      <div class="pair-chosen" data-chosen></div>
      ${disabled ? '' : `<input type="search" data-pair-q placeholder="Buscar par (ex.: SOL, PEPE)" aria-label="Buscar par" autocomplete="off" data-1p-ignore data-lpignore="true">
      <div class="pair-list" data-pair-list role="group" aria-label="Pares disponíveis"><p class="hint">Carregando pares da Binance…</p></div>`}
    </div>`;
  }

  const pairsByEnv = {};
  function bindPairPicker(box) {
    const hidden = $('input[name=pairs]', box);
    const chosen = () => hidden.value.split(/[\s,]+/).filter(Boolean);
    const setChosen = (list) => { hidden.value = [...new Set(list)].join(', '); paintChosen(); paintList(); };
    const fmt = (v) => (v >= 1e9 ? `${(v / 1e9).toFixed(1)} bi` : v >= 1e6 ? `${(v / 1e6).toFixed(1)} mi` : v >= 1e3 ? `${Math.round(v / 1e3)} mil` : String(v)).replace('.', ',');
    function paintChosen() {
      const list = chosen();
      $('[data-chosen]', box).innerHTML = list.length
        ? list.map((s) => `<span class="chip on">${esc(s)}${box.hasAttribute('data-disabled') ? '' : `<button type="button" data-unpick="${esc(s)}" aria-label="Remover ${esc(s)}">×</button>`}</span>`).join('')
        : '<span class="hint">Nenhum par escolhido.</span>';
      $$('[data-unpick]', box).forEach((b) => b.onclick = () => setChosen(chosen().filter((x) => x !== b.dataset.unpick)));
    }
    function paintList() {
      const listEl = $('[data-pair-list]', box);
      if (!listEl) return;
      const all = pairsByEnv[box.dataset.env];
      if (!all) return;
      if (all.error) { listEl.innerHTML = `<p class="error">${esc(all.error)}</p>`; return; }
      const q = ($('[data-pair-q]', box).value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
      const sel = new Set(chosen());
      const rows = q ? all.filter((p) => p.symbol.includes(q)).slice(0, 60) : all.slice(0, 30);
      listEl.innerHTML = rows.map((p) => `<label class="pair"><input type="checkbox" value="${esc(p.symbol)}" ${sel.has(p.symbol) ? 'checked' : ''}>
        <b>${esc(p.base)}</b><small>/USDT</small><span class="num">${fmt(p.volumeUsdt)} USDT/24h</span></label>`).join('')
        || `<p class="hint">Nenhum par em USDT com "${esc(q)}".</p>`;
      if (!q) listEl.insertAdjacentHTML('beforeend', `<p class="hint">Mostrando os 30 de maior volume. Busque para ver os outros ${all.length - 30}.</p>`);
      $$('input[type=checkbox]', listEl).forEach((i) => i.onchange = () => setChosen(i.checked ? [...chosen(), i.value] : chosen().filter((x) => x !== i.value)));
    }
    async function load() {
      const env = box.dataset.env;
      if (!pairsByEnv[env]) {
        try { pairsByEnv[env] = (await api('GET', `/api/integrations/binance/pairs?env=${encodeURIComponent(env)}`)).pairs; }
        catch (err) { pairsByEnv[env] = { error: err.message }; }
      }
      // ao trocar de ambiente, só ficam os pares que existem nele
      if (Array.isArray(pairsByEnv[env])) { const ok = new Set(pairsByEnv[env].map((p) => p.symbol)); const keep = chosen().filter((s) => ok.has(s)); if (keep.length !== chosen().length) hidden.value = keep.join(', '); }
      paintChosen(); paintList();
    }
    $('[data-pair-q]', box)?.addEventListener('input', paintList);
    // no formulário de conexão, o ambiente escolhido decide de onde vem a lista
    const envSel = box.closest('form')?.querySelector('select[name=env]');
    if (envSel && !box.closest('[data-desk-config]')) { box.dataset.env = envSel.value; envSel.addEventListener('change', () => { box.dataset.env = envSel.value; load(); }); }
    paintChosen();
    if ($('[data-pair-list]', box)) load();
  }

  function configBlock(c, conn) {
    if (c.type === 'github') {
      const repos = conn.config.repos || [];
      return `<div class="integ-config"><h4>Repositórios liberados</h4>
        <p class="hint">${repos.length ? repos.map((r) => esc(r.fullName)).join(', ') : 'Nenhum ainda. Escolha quais a equipe pode usar.'}</p>
        ${isAdmin ? '<button type="button" class="btn small" data-pick-repos>Escolher repositórios</button><div class="repo-list hidden" data-repo-list></div>' : ''}</div>`;
    }
    if (c.type === 'railway') {
      const projects = conn.config.projects || [];
      return `<div class="integ-config"><h4>Projetos liberados</h4>
        <p class="hint">${projects.length ? projects.map((p) => esc(p.name)).join(', ') : 'Nenhum ainda. Escolha quais projetos a equipe pode administrar.'}</p>
        ${conn.config.workspaceId ? `<p class="hint">Workspace: <code>${esc(conn.config.workspaceId)}</code></p>` : ''}
        ${isAdmin ? '<button type="button" class="btn small" data-pick-projects>Escolher projetos</button><div class="repo-list hidden" data-project-list></div>' : ''}</div>`;
    }
    if (c.type === 'crisp') {
      return `<form class="integ-config integ-form" data-crisp-config>
        <p class="hint">Website <code>${esc(conn.config.websiteId || '')}</code> · ${conn.config.tier === 'plugin' ? 'token de plugin' : 'token do workspace'}</p>
        <label class="field"><span>Nome mostrado ao cliente</span><input name="agentName" value="${esc(conn.config.agentName || '')}" placeholder="Ex.: Equipe RapidoJa" ${isAdmin ? '' : 'disabled'}></label>
        ${isAdmin ? '<div><button class="btn small">Salvar</button></div>' : ''}</form>`;
    }
    if (c.type === 'whatsapp') {
      const nums = conn.config.numbers || [];
      return `<form class="integ-config integ-form" data-wa-config>
        <label class="field"><span>Número que os agentes atendem</span><select name="phoneNumberId" ${isAdmin ? '' : 'disabled'}>${nums.map((n) => `<option value="${esc(n.id)}" ${n.id === conn.config.phoneNumberId ? 'selected' : ''}>${esc(n.display || n.id)}${n.name ? ` · ${esc(n.name)}` : ''}</option>`).join('')}</select></label>
        <p class="hint">O agente é avisado de cada mensagem nova de cliente (verificação a cada minuto). Texto livre só até 24 h depois da última mensagem do cliente; depois disso ele escala para você.</p>
        ${isAdmin && nums.length > 1 ? '<div><button class="btn small">Salvar número</button></div>' : ''}</form>`;
    }
    if (c.type === 'google_ads') {
      const cfg = conn.config || {};
      return `<div class="integ-config"><h4>Conta de anúncios</h4>
        <p class="hint">${cfg.customerId ? `${esc(cfg.name || '')} · <code>${esc(cfg.customerId)}</code> · ${esc(cfg.currency || '')}${cfg.loginCustomerId ? ` · via administrador <code>${esc(cfg.loginCustomerId)}</code>` : ''}` : 'Nenhuma conta escolhida ainda.'}</p>
        <p class="hint">Mudanças de campanha (pausar/ativar, orçamento, palavras negativas) sempre vão para <b>Minha mesa → Aprovações</b>.</p>
        ${isAdmin ? `<div class="row" style="gap:8px;flex-wrap:wrap">${cfg.customerId ? `<button type="button" class="btn small" data-ads-preview>${ic('chart-column', 'sm')}Ver campanhas (7 dias)</button>` : ''}<button type="button" class="btn small" data-pick-ads>${cfg.customerId ? 'Trocar conta' : 'Escolher conta'}</button></div>
          <div class="ads-preview hidden" data-ads-preview-box></div><div class="repo-list hidden" data-ads-list></div>` : ''}</div>`;
    }
    if (c.type === 'binance') {
      const cfg = conn.config || {};
      const prod = cfg.env === 'prod';
      const field = (k, label, ph) => `<label class="field"><span>${label}</span><input name="${k}" value="${esc(cfg[k] ?? '')}" placeholder="${ph}" inputmode="decimal" ${isAdmin ? '' : 'disabled'}></label>`;
      return `<div class="integ-config desk">
        <div class="desk-top">
          <span class="badge ${prod ? 'err' : 'todo'}">${ic(prod ? 'zap' : 'flask-conical', 'sm')}${prod ? 'PRODUÇÃO · dinheiro real' : 'Testnet · dinheiro de teste'}</span>
          <span class="badge ${cfg.halted ? 'err' : 'live'}">${ic(cfg.halted ? 'octagon-pause' : 'check', 'sm')}${cfg.halted ? 'Mesa PARADA' : 'Mesa liberada'}</span>
          ${isAdmin ? `<button type="button" class="btn small ${cfg.halted ? 'primary' : 'danger'}" data-desk-halt="${cfg.halted ? '0' : '1'}">${ic(cfg.halted ? 'play' : 'octagon-pause', 'sm')}${cfg.halted ? 'Liberar a mesa' : 'Parar a mesa'}</button>` : ''}
        </div>
        <p class="hint">Parar a mesa bloqueia na hora qualquer compra nova dos agentes. Fechar posições continua permitido, porque reduz o risco.${prod ? ' Em produção a mesa começa parada: confira os limites e libere.' : ''}</p>
        <div class="desk-status" data-desk-status><p class="hint">Carregando a situação da mesa…</p></div>
        <form class="integ-form" data-desk-config>
          <h4>Limites da mesa (conferidos no código, em toda ordem)</h4>
          <div class="desk-grid">
            ${pairPicker(cfg.pairs || '', cfg.env || 'testnet', !isAdmin)}
            ${field('maxOrderUsdt', 'Máximo por ordem (USDT)', 'Ex.: 50')}
            ${field('maxRiskUsdt', 'Risco máximo por operação (USDT)', 'Ex.: 2')}
            ${field('maxDailyLossUsdt', 'Perda máxima no dia (USDT)', 'Ex.: 10')}
            ${field('maxPositions', 'Máximo de posições abertas', 'Ex.: 2')}
            <label class="field"><span>Execução</span><select name="mode" ${isAdmin ? '' : 'disabled'}><option value="approval" ${cfg.mode !== 'auto' ? 'selected' : ''}>Cada ordem passa pela minha aprovação</option><option value="auto" ${cfg.mode === 'auto' ? 'selected' : ''}>Automática dentro dos limites</option></select></label>
          </div>
          <p class="hint">Risco por operação = quanto se perde se o stop for atingido (valor × distância até o stop). Perda no dia = queda do patrimônio da mesa desde a primeira leitura do dia; ao atingir, novas compras param até o dia seguinte.</p>
          ${isAdmin ? '<div><button class="btn small primary">Salvar limites</button></div>' : ''}
        </form></div>`;
    }
    if (c.type === 'resend') {
      return `<form class="integ-config integ-form" data-resend-config>
        <label class="field"><span>Remetente das respostas</span><input name="from" value="${esc(conn.config.from || '')}" placeholder="Suporte <suporte@seudominio.com>" ${isAdmin ? '' : 'disabled'}></label>
        <label class="field"><span>Caixas que recebem</span><input name="inboxes" value="${esc((conn.config.inboxes || []).join(', '))}" placeholder="suporte@seudominio.com" ${isAdmin ? '' : 'disabled'}></label>
        ${isAdmin ? '<div><button class="btn small">Salvar caixas</button></div>' : ''}</form>`;
    }
    return '';
  }

  // ---------- ações ----------
  const after = async (msg) => { if (msg) toast(msg); ui.connecting = null; await ctx.reload(); };
  draw();

  function bind() {
  $$('[data-cat]', root).forEach((b) => b.addEventListener('click', () => { ui.cat = b.dataset.cat; draw(); }));
  $$('details.integ', root).forEach((d) => d.addEventListener('toggle', () => { if (d.open) ui.open.add(d.dataset.type); else ui.open.delete(d.dataset.type); }));
  $$('[data-open-connect]', root).forEach((b) => b.addEventListener('click', () => {
    ui.connecting = b.closest('[data-type]').dataset.type;
    draw();
    $(`[data-type="${ui.connecting}"] input`, root)?.focus();
  }));
  $$('[data-close-connect]', root).forEach((b) => b.addEventListener('click', () => { ui.connecting = null; draw(); }));

  $$('[data-connect]', root).forEach((form) => form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const type = form.closest('[data-type]').dataset.type;
    const fd = Object.fromEntries(new FormData(form));
    // Tokens em duas partes (ex.: Crisp: identificador + chave) viram "identificador:chave".
    const parts = Object.keys(fd).filter((k) => k.startsWith('tp_'));
    if (parts.length) { fd.token = parts.map((k) => String(fd[k]).trim()).join(':'); parts.forEach((k) => delete fd[k]); }
    const { token, ...config } = fd;
    const btn = $('button', form); btn.disabled = true;
    try { const r = await api('POST', `/api/integrations/${type}/connect`, { token, config }); await after(`Conectado${r.account ? ` (${r.account})` : ''}`); }
    catch (err) { toast(err.message, 'err'); btn.disabled = false; }
  }));

  // ---------- mesa de trading (Binance) ----------
  $$('[data-pair-picker]', root).forEach(bindPairPicker);
  $$('[data-desk-config]', root).forEach((form) => form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!$('input[name=pairs]', form).value.trim()) { toast('Escolha pelo menos um par', 'err'); return; }
    try { await api('PUT', '/api/integrations/binance/config', Object.fromEntries(new FormData(form))); await after('Limites da mesa salvos'); } catch (err) { toast(err.message, 'err'); }
  }));
  $$('[data-desk-halt]', root).forEach((b) => b.addEventListener('click', async () => {
    const halt = b.dataset.deskHalt === '1';
    if (!halt && !confirm('Liberar a mesa? Os agentes voltam a poder comprar dentro dos limites.')) return;
    try { await api('POST', '/api/integrations/binance/halt', { halted: halt }); await after(halt ? 'Mesa parada: nenhuma compra nova' : 'Mesa liberada'); } catch (err) { toast(err.message, 'err'); }
  }));
  $$('[data-desk-status]', root).forEach(async (box) => {
    try {
      const s = await api('GET', '/api/integrations/binance/status');
      const n = (v, d = 2) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d }));
      const ST = { pendente: 'aguardando Risco', aprovada: 'aprovada', recusada: 'recusada', executada: 'executada', expirada: 'expirada', aguardando_dono: 'aguardando você', falhou: 'falhou', recusada_na_execucao: 'barrada na execução' };
      box.innerHTML = `${s.error ? `<p class="error">${esc(s.error)}</p>` : `
        <div class="desk-kpis">
          <div><span>Patrimônio da mesa</span><b class="num">${n(s.equity)} USDT</b></div>
          <div><span>Resultado do dia</span><b class="num ${s.pnlDay < 0 ? 'neg' : s.pnlDay > 0 ? 'pos' : ''}">${s.pnlDay > 0 ? '+' : ''}${n(s.pnlDay)} USDT</b></div>
          <div><span>USDT livre</span><b class="num">${n(s.usdtFree)}</b></div>
          <div><span>Posições</span><b class="num">${(s.positions || []).length}${s.config.maxPositions ? ` / ${s.config.maxPositions}` : ''}</b></div>
        </div>
        ${(s.positions || []).length ? `<p class="hint">${s.positions.map((p) => `${esc(p.par)}: ${p.quantidade_da_mesa} (${n(p.valor_usdt)} USDT)`).join(' · ')}</p>` : ''}`}
        ${s.missing?.length ? `<p class="error">Faltam limites: ${esc(s.missing.join(', '))}. Sem eles, os agentes não propõem nem executam.</p>` : ''}
        ${(s.proposals || []).length ? `<table class="access-table"><thead><tr><th>Proposta</th><th>Par</th><th>Valor</th><th>Risco</th><th>Situação</th></tr></thead><tbody>
          ${s.proposals.map((p) => `<tr><td><code>${esc(p.id)}</code><small>${new Date(p.ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</small></td><td>${esc(p.par)}</td><td class="num">${n(p.valor)}</td><td class="num">${n(p.risco)}</td><td>${esc(ST[p.status] || p.status)}</td></tr>`).join('')}</tbody></table>` : '<p class="hint">Nenhuma proposta ainda.</p>'}`;
    } catch (err) { box.innerHTML = `<p class="error">${esc(err.message)}</p>`; }
  });

  $$('[data-resend-config]', root).forEach((form) => form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('PUT', '/api/integrations/resend/config', Object.fromEntries(new FormData(form))); await after('Caixas salvas'); } catch (err) { toast(err.message, 'err'); }
  }));

  $$('[data-pick-repos]', root).forEach((b) => b.addEventListener('click', async () => {
    const box = $('[data-repo-list]', b.parentElement);
    box.classList.remove('hidden');
    box.innerHTML = '<p class="hint" style="padding:12px">Carregando repositórios…</p>';
    try {
      reposCache = reposCache || await api('GET', '/api/integrations/github/repos');
      const chosen = new Set((connected.github?.config.repos || []).map((r) => r.fullName));
      box.innerHTML = reposCache.map((r) => `<label class="repo"><input type="checkbox" value="${esc(r.fullName)}" ${chosen.has(r.fullName) ? 'checked' : ''}>
        <b>${esc(r.fullName)}${r.private ? ' <span class="label">privado</span>' : ''}</b><span class="hint">${esc(r.description)}</span></label>`).join('')
        + '<div style="padding:10px 12px"><button type="button" class="btn small primary" data-save-repos>Salvar repositórios</button></div>';
      $('[data-save-repos]', box).onclick = async () => {
        const repos = $$('input:checked', box).map((i) => i.value);
        try { await api('PUT', '/api/integrations/github/config', { repos }); await after(`${repos.length} repositório(s) liberado(s)`); } catch (err) { toast(err.message, 'err'); }
      };
    } catch (err) { box.innerHTML = `<p class="error" style="padding:12px">${esc(err.message)}</p>`; }
  }));

  $$('[data-crisp-config]', root).forEach((form) => form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('PUT', '/api/integrations/crisp/config', Object.fromEntries(new FormData(form))); await after('Crisp salvo'); } catch (err) { toast(err.message, 'err'); }
  }));

  $$('[data-wa-config]', root).forEach((form) => form.addEventListener('submit', async (e) => {
    e.preventDefault();
    try { await api('PUT', '/api/integrations/whatsapp/config', Object.fromEntries(new FormData(form))); await after('Número salvo'); } catch (err) { toast(err.message, 'err'); }
  }));

  $$('[data-ads-preview]', root).forEach((b) => b.addEventListener('click', async () => {
    const box = $('[data-ads-preview-box]', b.closest('.integ-config'));
    box.classList.remove('hidden');
    box.innerHTML = '<p class="hint">Consultando o Google Ads…</p>';
    try {
      const r = await api('GET', '/api/integrations/google_ads/report?periodo=LAST_7_DAYS');
      const money = (v) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: r.moeda || 'BRL' }));
      const st = { ENABLED: 'ativa', PAUSED: 'pausada' };
      const tot = r.linhas.reduce((t, l) => ({ c: t.c + l.custo, k: t.k + l.cliques, v: t.v + l.conversoes }), { c: 0, k: 0, v: 0 });
      box.innerHTML = r.linhas.length ? `<table class="access-table ads-table"><thead><tr><th>Campanha</th><th>Status</th><th>Orçamento/dia</th><th>Cliques</th><th>Custo</th><th>Conversões</th><th>Custo/conv.</th></tr></thead><tbody>
        ${r.linhas.map((l) => `<tr><td><b>${esc(l.campanha)}</b><small>${esc(l.tipo || '')}</small></td><td>${esc(st[l.status] || l.status)}</td><td class="num">${money(l.orcamento_diario)}</td><td class="num">${l.cliques}</td><td class="num">${money(l.custo)}</td><td class="num">${l.conversoes}</td><td class="num">${money(l.custo_por_conversao)}</td></tr>`).join('')}
        <tr class="tot"><td><b>Total</b></td><td></td><td></td><td class="num">${tot.k}</td><td class="num">${money(tot.c)}</td><td class="num">${Math.round(tot.v * 100) / 100}</td><td class="num">${tot.v ? money(tot.c / tot.v) : '—'}</td></tr></tbody></table>
        <p class="hint">Conta ${esc(r.conta)} · últimos 7 dias · só leitura.</p>`
        : `<p class="hint">Nenhuma campanha com dados nos últimos 7 dias na conta ${esc(r.conta)}.</p>`;
    } catch (err) { box.innerHTML = `<p class="error">${esc(err.message)}</p>`; }
  }));

  $$('[data-pick-ads]', root).forEach((b) => b.addEventListener('click', async () => {
    const box = $('[data-ads-list]', b.closest('.integ-config'));
    box.classList.remove('hidden');
    box.innerHTML = '<p class="hint" style="padding:12px">Carregando contas do Google Ads…</p>';
    try {
      const list = await api('GET', '/api/integrations/google_ads/accounts');
      const cur = connected.google_ads?.config.customerId;
      // Erros conhecidos do Google Ads traduzidos com o que fazer (o texto original fica no título, para suporte).
      const notApproved = list.some((a) => /CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION|only approved for use with test accounts/i.test(a.error || ''));
      const why = (e) => (/CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION|only approved for use with test accounts/i.test(e) ? 'Bloqueada: o projeto do Google Cloud ainda está no acesso de teste (veja acima).'
        : /PERMISSION_DENIED|USER_PERMISSION_DENIED/i.test(e) ? 'Sem permissão: este login não tem acesso a esta conta (ou falta escolher a conta de administrador).'
        : /CUSTOMER_NOT_ENABLED|NOT_ACTIVE/i.test(e) ? 'Conta desativada ou cancelada no Google Ads.' : e);
      const selectable = list.filter((a) => !a.manager && !a.error);
      box.innerHTML = (notApproved ? `<div class="ads-blocked">
          <b>${ic('lock', 'sm')}Falta liberar o acesso do projeto à Google Ads API</b>
          <p>O projeto do Google Cloud usado pelo IAORG ainda está no acesso de <b>teste</b>, que só funciona com contas de teste. Para usar suas contas reais, peça o acesso <b>Explorer</b> (gratuito, revisão automática na maioria dos casos):</p>
          <ol><li>No <a href="https://console.cloud.google.com/apis/api/googleads.googleapis.com/overview" target="_blank" rel="noopener">Google Cloud Console → Google Ads API → Visão geral</a> (no mesmo projeto do cliente OAuth), peça o acesso <b>Explorer</b>.</li>
          <li>O projeto precisa ter <b>faturamento ativo</b> (fora do período de teste gratuito), senão o pedido é recusado.</li>
          <li>Aprovado, volte aqui e clique em <b>Escolher conta</b> de novo. Não precisa reconectar.</li></ol></div>` : '')
        + (list.map((a) => `<label class="repo"><input type="radio" name="adsacc" value="${esc(a.id)}" ${a.id === cur ? 'checked' : ''} ${a.manager || a.error ? 'disabled' : ''}>
        <b>${esc(a.name && a.name !== a.id ? a.name : 'Conta')} <code>${esc(a.id)}</code></b><span class="hint" title="${esc(a.error || '')}">${a.error ? esc(why(a.error)) : a.manager ? 'conta de administrador (MCC): escolha uma das contas abaixo dela' : `${esc(a.currency)}${a.via ? ` · via ${esc(a.via)}` : ''}${a.test ? ' · conta de teste' : ''}`}</span></label>`).join('') || '<p class="hint" style="padding:12px">Nenhuma conta acessível com este login.</p>')
        + `<div style="padding:10px 12px" class="row">${selectable.length ? '<button type="button" class="btn small primary" data-save-ads>Usar esta conta</button>' : ''}<button type="button" class="btn small" data-retry-ads>${ic('refresh-cw', 'sm')}Verificar de novo</button></div>`;
      $('[data-retry-ads]', box).onclick = () => b.click();
      if ($('[data-save-ads]', box)) $('[data-save-ads]', box).onclick = async () => {
        const id = $('input:checked', box)?.value;
        if (!id) { toast('Escolha uma conta', 'err'); return; }
        try { await api('PUT', '/api/integrations/google_ads/config', { customerId: id }); await after('Conta do Google Ads escolhida'); } catch (err) { toast(err.message, 'err'); }
      };
    } catch (err) { box.innerHTML = `<p class="error" style="padding:12px">${esc(err.message)}</p>`; }
  }));

  $$('[data-pick-projects]', root).forEach((b) => b.addEventListener('click', async () => {
    const box = $('[data-project-list]', b.parentElement);
    box.classList.remove('hidden');
    box.innerHTML = '<p class="hint" style="padding:12px">Carregando projetos…</p>';
    try {
      const list = await api('GET', '/api/integrations/railway/projects');
      const chosen = new Set((connected.railway?.config.projects || []).map((p) => p.id));
      box.innerHTML = (list.map((p) => `<label class="repo"><input type="checkbox" value="${esc(p.id)}" ${chosen.has(p.id) ? 'checked' : ''}>
        <b>${esc(p.name)}</b><span class="hint">${esc(p.description)}</span></label>`).join('') || '<p class="hint" style="padding:12px">Nenhum projeto visível para este token.</p>')
        + '<div style="padding:10px 12px"><button type="button" class="btn small primary" data-save-projects>Salvar projetos</button></div>';
      $('[data-save-projects]', box).onclick = async () => {
        const projects = $$('input:checked', box).map((i) => i.value);
        try { await api('PUT', '/api/integrations/railway/config', { projects }); await after(`${projects.length} projeto(s) liberado(s)`); } catch (err) { toast(err.message, 'err'); }
      };
    } catch (err) { box.innerHTML = `<p class="error" style="padding:12px">${esc(err.message)}</p>`; }
  }));

  async function saveRow(type, tr) {
    const perms = $$('[data-perm]', tr).filter((i) => i.checked).map((i) => i.dataset.perm);
    const sel = $('[data-res]', tr);
    const resources = sel && sel.value ? [sel.value] : [];
    try {
      await api('PUT', `/api/agents/${tr.dataset.agent}/access/${type}`, { perms, resources });
      tr.classList.toggle('has', perms.length > 0);
      toast(perms.length ? 'Acesso atualizado' : 'Acesso removido');
    } catch (err) { toast(err.message, 'err'); }
  }
  $$('.access-table tr[data-agent]', root).forEach((tr) => {
    const type = tr.closest('[data-type]').dataset.type;
    $$('[data-perm], [data-res]', tr).forEach((el) => el.addEventListener('change', () => saveRow(type, tr)));
  });

  $$('[data-suggest]', root).forEach((b) => b.addEventListener('click', async () => {
    const art = b.closest('[data-type]');
    const c = data.catalog.find((x) => x.type === art.dataset.type);
    const all = c.perms.map((p) => p.id);
    const targets = ai.filter((a) => c.suggest?.some((s) => String(a.catalogKey || a.id).split('-')[0] === s || String(a.role).toLowerCase().startsWith(s)));
    for (const a of targets) await api('PUT', `/api/agents/${a.id}/access/${c.type}`, { perms: all, resources: [] }).catch(() => {});
    await after(`Acesso liberado para ${targets.map((a) => a.name.split(' ')[0]).join(', ')}`);
  }));

  $$('[data-disconnect]', root).forEach((b) => b.addEventListener('click', async () => {
    const type = b.closest('[data-type]').dataset.type;
    if (!confirm('Desconectar esta integração? Os agentes perdem o acesso na hora.')) return;
    try { await api('DELETE', `/api/integrations/${type}`); reposCache = null; ui.open.delete(type); await after('Integração desconectada'); } catch (err) { toast(err.message, 'err'); }
  }));
  } // bind
}

// Resumo de acessos de um agente (para o editor da equipe).
export const INTEGRATION_NAMES = { github: 'GitHub', resend: 'Resend', gmail: 'Gmail', google_calendar: 'Google Agenda', google_drive: 'Google Drive', google_ads: 'Google Ads', whatsapp: 'WhatsApp', railway: 'Railway', crisp: 'Crisp', binance: 'Binance' };
export function accessChips(agent, integrations, catalogNames = INTEGRATION_NAMES) {
  const list = Object.entries(agent.access || {}).filter(([t]) => integrations?.some((i) => i.type === t));
  return list.length ? list.map(([t, a]) => `<span class="badge">${esc(catalogNames[t] || t)} · ${a.perms.length} permiss${a.perms.length > 1 ? 'ões' : 'ão'}</span>`).join(' ') : '<span class="hint">Nenhum acesso a sistemas externos.</span>';
}
