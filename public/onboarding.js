import { $, $$, esc, api, toast, ic, COLORS } from '/common.js';
import { renderIntegrations, INTEGRATION_NAMES } from '/integrations-ui.js';

const STEPS = [
  { id: 'company', label: 'Empresa' },
  { id: 'you', label: 'Você' },
  { id: 'claude', label: 'Claude' },
  { id: 'team', label: 'Equipe' },
  { id: 'repos', label: 'Integrações' },
  { id: 'review', label: 'Revisão' },
];
const params = new URLSearchParams(location.search);
const editMode = params.has('edit');

let me = null;
let S = null;
let catalog = null;
let current = 'company';

async function load() {
  me = await api('GET', '/api/me');
  catalog = catalog || await api('GET', '/api/catalog');
  $('#who').textContent = me.user.email || me.user.name;
  if (me.company) {
    S = await api('GET', '/api/state');
    if (!['owner', 'admin'].includes(me.member.appRole) && !(editMode && params.get('step') === 'you')) { location.href = '/'; return false; }
  }
  return true;
}

const myself = () => S?.agents.find((a) => a.id === S.me?.id);
const isOwner = () => S?.me?.appRole === 'owner';

function renderStepper() {
  const idx = STEPS.findIndex((s) => s.id === current);
  $('#stepper').innerHTML = STEPS.map((s, i) => `<li class="${i < idx ? 'done' : i === idx ? 'current' : ''}">
    <button type="button" data-step="${s.id}" ${me.company ? '' : 'disabled'} ${i === idx ? 'aria-current="step"' : ''}>${i + 1}. ${s.label}</button></li>`).join('');
  $$('#stepper button').forEach((b) => b.onclick = () => go(b.dataset.step));
}

async function go(step, save = true) {
  current = step;
  if (save && me.company && !editMode) await api('PUT', '/api/onboarding/step', { step }).catch(() => {});
  if (me.company) S = await api('GET', '/api/state');
  renderStepper();
  history.replaceState(null, '', `?step=${step}${editMode ? '&edit=1' : ''}`);
  const card = $('#step');
  card.style.animation = 'none'; void card.offsetWidth; card.style.animation = '';
  await ({ company, you, claude, repos, team, review })[step]();
  window.scrollTo(0, 0);
}
const next = () => go(STEPS[STEPS.findIndex((s) => s.id === current) + 1].id);
const back = () => go(STEPS[Math.max(0, STEPS.findIndex((s) => s.id === current) - 1)].id);

const nav = (nextLabel = 'Continuar', opts = {}) => `
  <div class="wizard-nav">
    ${current !== 'company' && !editMode ? '<button type="button" class="btn" data-back>Voltar</button>' : '<span></span>'}
    <div class="row">
      ${opts.skip ? `<button type="button" class="btn ghost" data-skip>${opts.skip}</button>` : ''}
      ${editMode ? '<a class="btn" href="/">Voltar ao escritório</a>' : ''}
      <button class="btn primary" type="submit">${nextLabel}</button>
    </div>
  </div>`;

function bindNav(root, onSubmit) {
  $('[data-back]', root)?.addEventListener('click', back);
  $('[data-skip]', root)?.addEventListener('click', next);
  $('form', root).addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('button[type=submit]', root);
    btn.disabled = true;
    try { await onSubmit(new FormData(e.target)); } catch (err) { toast(err.message, 'err'); } finally { btn.disabled = false; }
  });
}
const after = async () => (editMode ? (toast('Salvo'), (location.href = '/')) : next());

// ---------------- 1. Empresa ----------------
function company() {
  const c = S?.company || {};
  const root = $('#step');
  root.innerHTML = `
    <h1>Sobre a empresa</h1>
    <p class="hint">Tudo aqui vira contexto que cada agente lê antes de trabalhar. Quanto mais concreto, melhor o resultado.</p>
    <form class="form">
      <label class="field"><span>Nome da empresa</span><input name="name" required maxlength="60" value="${esc(c.name)}" placeholder="Ex.: RapidoJa Delivery"></label>
      <label class="field"><span>Segmento</span><input name="segment" placeholder="Ex.: delivery de comida, SaaS B2B, loja de roupas" value="${esc(c.segment)}"></label>
      <label class="field"><span>Site</span><input name="website" placeholder="https://" value="${esc(c.website)}"></label>
      <div class="field logo-field"><span>Logo · PNG, JPG ou WEBP até 5 MB</span>
        <div class="row"><img id="logoPreview" class="logo-preview ${c.logo ? '' : 'hidden'}" src="${c.logo ? '/api/company/logo?v=' + (c.logoVersion || 0) : ''}" alt="Logo atual">
        <input type="file" id="logoFile" accept="image/png,image/jpeg,image/webp" style="flex:1"></div>
      </div>
      <label class="field full"><span>O que a empresa faz</span><textarea name="description" rows="3" placeholder="Produto ou serviço, para quem e qual o diferencial.">${esc(c.description)}</textarea></label>
      <label class="field full"><span>Objetivo atual</span><textarea name="mission" rows="2" placeholder="Ex.: lançar o MVP do app em 30 dias.">${esc(c.mission)}</textarea></label>
      <label class="field full"><span>Contexto para os agentes</span><textarea name="context" rows="7" placeholder="Público, tom de voz, tecnologia que vocês usam, regras do negócio, o que não fazer, links importantes.">${esc(c.context)}</textarea></label>
      ${nav(me.company ? 'Salvar e continuar' : 'Criar a empresa')}
    </form>`;
  $('#logoFile').addEventListener('change', (e) => {
    const f = e.target.files[0];
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { toast('A imagem passa de 5 MB', 'err'); e.target.value = ''; return; }
    $('#logoPreview').src = URL.createObjectURL(f);
    $('#logoPreview').classList.remove('hidden');
  });
  bindNav(root, async (fd) => {
    await api('POST', '/api/onboarding/company', Object.fromEntries(fd));
    me = await api('GET', '/api/me');
    const file = $('#logoFile').files[0];
    if (file) await api('POST', '/api/company/logo', file, true);
    toast('Empresa salva');
    if (editMode) location.href = '/'; else await go('you');
  });
}

// ---------------- 2. Você ----------------
function you() {
  const p = myself() || {};
  const root = $('#step');
  root.innerHTML = `
    <h1>Seu personagem</h1>
    <p class="hint">Você também trabalha no escritório: tem mesa, cargo e recebe tarefas e mensagens dos agentes.</p>
    <form class="form">
      <label class="field"><span>Seu nome</span><input name="name" required value="${esc(p.name)}"></label>
      <label class="field"><span>Cargo</span><input name="role" required list="roles" value="${esc(p.role)}" placeholder="CEO, Fundadora, PM"></label>
      <datalist id="roles">${catalog.roles.map((r) => `<option value="${esc(r.role)}">`).join('')}<option value="Fundador(a)"></datalist>
      <label class="field"><span>Título</span><input name="title" value="${esc(p.title)}" placeholder="Ex.: Fundadora e CEO"></label>
      <div class="field"><span>Cor do personagem</span><div class="swatches" role="radiogroup">${COLORS.map((c) => `<label title="${c}"><input type="radio" name="color" value="${c}" ${c === p.color ? 'checked' : ''}><span style="background:${c}"></span></label>`).join('')}</div></div>
      <p class="hint full">Se o seu cargo for <b>CEO</b>, os agentes passam a se reportar direto a você e a equipe sugerida não inclui um CEO de IA.</p>
      ${nav()}
    </form>`;
  bindNav(root, async (fd) => {
    await api('PUT', '/api/agents/' + p.id, Object.fromEntries(fd));
    await after();
  });
}

// ---------------- 3. Claude ----------------
function claude() {
  const root = $('#step');
  if (!isOwner()) {
    root.innerHTML = `<h1>Claude</h1><p class="hint">Só o dono da empresa cadastra a chave da API.</p><form>${nav()}</form>`;
    return bindNav(root, next);
  }
  const s = S.company.settings;
  root.innerHTML = `
    <h1>Conectar o Claude</h1>
    <p class="hint">Os agentes usam a API do Claude com a chave da sua empresa, cobrada direto na sua conta da Anthropic. Crie a chave em <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noopener">console.anthropic.com</a>. Ela fica guardada criptografada e não aparece de novo.</p>
    <form class="form">
      <div class="field full"><span>Chave da API ${S.secrets?.claudeKey ? `<b class="ok">· configurada (${esc(S.secrets.claudeKey)})</b>` : ''}</span>
        <div class="row"><input name="key" type="password" autocomplete="off" placeholder="${S.secrets?.claudeKey ? 'Deixe em branco para manter a atual' : 'sk-ant-…'}" style="flex:1" aria-label="Chave da API">
        <button type="button" class="btn" id="testKey">Testar chave</button></div>
        <span id="keyResult" class="hint" role="status"></span>
      </div>
      <div class="field full"><span>Modelo dos agentes</span>
        ${(() => {
          const opt = (m) => `
          <label class="option"><input type="radio" name="model" value="${m.id}" ${m.id === s.model ? 'checked' : ''}>
            <b>${esc(m.label)}</b><span class="hint">${esc(m.note)}</span><span class="hint num">US$ ${String(m.price[0]).replace('.', ',')} entrada · US$ ${String(m.price[1]).replace('.', ',')} saída / 1 mi tokens</span></label>`;
          const old = catalog.models.filter((m) => m.legacy);
          return `<div class="options">${catalog.models.filter((m) => !m.legacy).map(opt).join('')}</div>
          ${old.length ? `<details class="legacy-models" ${old.some((m) => m.id === s.model) ? 'open' : ''}><summary>Modelos da geração anterior (${old.length})</summary><div class="options">${old.map(opt).join('')}</div></details>` : ''}`;
        })()}
      </div>
      <label class="field"><span>Profundidade de raciocínio</span><select name="effort">${['low', 'medium', 'high'].map((e) => `<option value="${e}" ${e === s.effort ? 'selected' : ''}>${{ low: 'Baixa — mais barato', medium: 'Média', high: 'Alta — mais caro' }[e]}</option>`).join('')}</select></label>
      <label class="field"><span>Limite de gasto por mês (US$)</span><input name="budgetUsd" type="number" min="0" step="1" value="${s.budgetUsd ?? 20}" class="num"><span class="hint">Gasto real com o Claude (todos os agentes, oficina, reuniões). Ao atingir, a obra pausa até o próximo mês ou até você aumentar. 0 = sem limite.</span></label>
      ${nav('Salvar e continuar', { skip: S.secrets?.claudeKey || editMode ? '' : 'Pular — usar modo simulado' })}
    </form>`;
  $('#testKey').onclick = async () => {
    const out = $('#keyResult');
    out.textContent = 'Testando…';
    out.className = 'hint';
    try {
      const r = await api('POST', '/api/settings/claude/test', { key: $('[name=key]').value });
      out.textContent = r.ok ? 'Chave válida.' : r.error;
      out.className = r.ok ? 'ok' : 'error';
    } catch (e) { out.textContent = e.message; out.className = 'error'; }
  };
  bindNav(root, async (fd) => {
    const body = Object.fromEntries(fd);
    if (!body.key) delete body.key;
    await api('PUT', '/api/settings/claude', body);
    toast('Configuração do Claude salva');
    await after();
  });
}

// ---------------- Integrações (depois da equipe, para já dar acesso aos agentes) ----------------
async function repos() {
  const root = $('#step');
  root.innerHTML = `
    <h1>Integrações</h1>
    <p class="hint">Conecte os sistemas da empresa e escolha quais agentes podem usar cada um. Ex.: o Backend recebe o repositório no GitHub; o Suporte lê e responde a caixa de entrada do Resend. Dá para fazer isso depois na aba Integrações.</p>
    <div id="integRoot" style="margin-top:18px"><p class="hint">Carregando…</p></div>
    <form>${nav('Continuar', { skip: editMode ? '' : 'Pular por agora' })}</form>`;
  const draw = async () => renderIntegrations($('#integRoot'), {
    agents: S.agents, me: S.me,
    reload: async () => { S = await api('GET', '/api/state'); await draw(); },
  }).catch((e) => { $('#integRoot').innerHTML = `<p class="error">${esc(e.message)}</p>`; });
  await draw();
  bindNav(root, after);
}

// ---------------- Equipe ----------------
let candidates = null;
let templateId = 'software-house';

function buildCandidates() {
  const ai = S.agents.filter((a) => a.kind !== 'human');
  if (ai.length) return ai.map((a) => ({ ...a, hire: true }));
  const t = catalog.templates.find((x) => x.id === templateId);
  const owner = myself();
  const ownerIsCeo = /^ceo$/i.test(owner?.role || '');
  return t.candidates
    .filter((c) => !(ownerIsCeo && c.catalogKey === 'ceo'))
    .map((c) => ({ ...c, hire: true, reportsTo: ownerIsCeo && c.reportsTo === 'ceo' ? owner.id : c.reportsTo }));
}

function team() {
  if (!candidates) candidates = buildCandidates();
  const root = $('#step');
  const people = S.agents.filter((a) => a.kind === 'human');
  const hasTeam = S.agents.some((a) => a.kind !== 'human');
  const bossOptions = (sel, selfId) => [
    ...people.map((p) => `<option value="${p.id}" ${p.id === sel ? 'selected' : ''}>${esc(p.name)} (${esc(p.role)}, pessoa)</option>`),
    ...candidates.filter((c) => c.id !== selfId).map((c) => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.name)} (${esc(c.role)})</option>`),
  ].join('');
  root.innerHTML = `
    <h1>Monte a equipe</h1>
    <p class="hint">Escolha um modelo de organograma, contrate os agentes que fazem sentido e convide as pessoas que vão trabalhar com eles.</p>
    ${hasTeam ? '' : `<div class="options" role="radiogroup" aria-label="Modelo de organograma">${catalog.templates.map((t) => `
      <button type="button" class="option ${t.id === templateId ? 'active' : ''}" data-tpl="${t.id}" aria-pressed="${t.id === templateId}"><b>${esc(t.label)}</b><span class="hint">${esc(t.description)}</span><span class="hint num">${t.candidates.length} cargos</span></button>`).join('')}</div>`}
    <form class="form" style="margin-top:18px">
      <div class="field full"><h3>Agentes de IA</h3>
        <div class="hire-list">${candidates.map((c, i) => `
          <div class="hire ${c.hire ? '' : 'off'}" data-i="${i}">
            <label title="Contratar"><input type="checkbox" data-k="hire" ${c.hire ? 'checked' : ''} aria-label="Contratar ${esc(c.role)}"></label>
            <input data-k="name" value="${esc(c.name)}" aria-label="Nome">
            <input data-k="role" value="${esc(c.role)}" aria-label="Cargo">
            <select data-k="reportsTo" aria-label="Reporta a"><option value="">Ninguém (topo)</option>${bossOptions(c.reportsTo, c.id)}</select>
            <details><summary>Instruções de ${esc(c.role)}</summary><textarea data-k="prompt" rows="4">${esc(c.prompt)}</textarea></details>
          </div>`).join('')}</div>
        <div class="row" style="margin-top:8px"><select id="addRole" style="max-width:340px" aria-label="Contratar outro cargo"><option value="">Contratar outro cargo…</option>${catalog.roles.map((r) => `<option value="${r.key}">${esc(r.role)} — ${esc(r.title)}</option>`).join('')}</select></div>
      </div>
      <div class="field full"><h3>Pessoas</h3>
        <p class="hint">Cada pessoa entra com a própria conta, ganha um personagem com cargo e recebe tarefas dos agentes.</p>
        <div class="invite-form">
          <label class="field"><span>E-mail</span><input id="invEmail" type="email" placeholder="nome@empresa.com"></label>
          <label class="field"><span>Nome</span><input id="invName"></label>
          <label class="field"><span>Cargo</span><input id="invRole" placeholder="Designer" list="roles2"></label><datalist id="roles2">${catalog.roles.map((r) => `<option value="${esc(r.role)}">`).join('')}</datalist>
          <label class="field"><span>Reporta a</span><select id="invBoss"><option value="">Ninguém</option>${people.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label>
          <label class="field"><span>Acesso</span><select id="invAccess"><option value="member">Membro</option><option value="admin">Administrador</option></select></label>
          <button type="button" class="btn" id="invite">${ic('mail', 'sm')}Convidar</button>
        </div>
        <ul class="people">
          ${people.map((p) => `<li>${ic('user', 'sm')}<b>${esc(p.name)}</b> ${esc(p.role)} <span class="hint">${esc(p.email || '')} · ${p.appRole === 'owner' ? 'dono' : p.appRole === 'admin' ? 'administrador' : 'membro'}</span></li>`).join('')}
          ${(S.invites || []).map((i) => `<li>${ic('mail', 'sm')}<b>${esc(i.name)}</b> ${esc(i.role)} <span class="hint">${esc(i.email)} · convite pendente</span>
             <button type="button" class="btn small" data-copy="${location.origin}/invite/${i.token}">${ic('copy', 'sm')}Copiar link</button></li>`).join('')}
        </ul>
      </div>
      ${nav(editMode ? 'Salvar equipe' : 'Contratar e continuar')}
    </form>`;

  $$('[data-tpl]', root).forEach((b) => b.onclick = () => { templateId = b.dataset.tpl; candidates = buildCandidates(); team(); });
  $$('.hire', root).forEach((row) => {
    const c = candidates[+row.dataset.i];
    $$('[data-k]', row).forEach((el) => el.addEventListener('input', () => {
      c[el.dataset.k] = el.type === 'checkbox' ? el.checked : el.value;
      row.classList.toggle('off', !c.hire);
    }));
  });
  $('#addRole').onchange = (e) => {
    const r = catalog.roles.find((x) => x.key === e.target.value);
    if (!r) return;
    candidates.push({ id: r.key + '-' + Date.now().toString(36), catalogKey: r.key, kind: 'ai', name: 'Novo ' + r.role, role: r.role, title: r.title, color: r.color, prompt: r.prompt, reportsTo: candidates.some((c) => c.id === r.reportsTo) ? r.reportsTo : (myself()?.id || ''), hire: true });
    team();
  };
  $('#invite').onclick = async () => {
    try {
      const inv = await api('POST', '/api/invites', {
        email: $('#invEmail').value, name: $('#invName').value, role: $('#invRole').value, title: $('#invRole').value,
        reportsTo: $('#invBoss').value, appRole: $('#invAccess').value,
      });
      await navigator.clipboard?.writeText(inv.link).catch(() => {});
      toast('Convite criado e link copiado');
      S = await api('GET', '/api/state');
      team();
    } catch (e) { toast(e.message, 'err'); }
  };
  $$('[data-copy]', root).forEach((b) => b.onclick = () => { navigator.clipboard?.writeText(b.dataset.copy); toast('Link copiado'); });

  bindNav(root, async () => {
    const hires = candidates.filter((c) => c.hire).map(({ id, catalogKey, name, role, title, color, prompt, reportsTo }) => ({ id, catalogKey, name, role, title, color, prompt, reportsTo }));
    if (!hires.length) throw new Error('Contrate pelo menos um agente de IA');
    await api('POST', '/api/team/apply', { hires });
    candidates = null;
    toast(`${hires.length} agentes contratados`);
    await after();
  });
}

// ---------------- 6. Revisão ----------------
function review() {
  const c = S.company;
  const root = $('#step');
  const ai = S.agents.filter((a) => a.kind !== 'human');
  const people = S.agents.filter((a) => a.kind === 'human');
  root.innerHTML = `
    <h1>Tudo pronto para abrir a obra?</h1>
    <div class="review">
      <div><h3>${esc(c.name)}</h3><p class="hint">${[c.segment, c.website].filter(Boolean).map(esc).join(' · ')}</p><p>${esc(c.description)}</p>
        ${c.logo ? `<img class="logo-preview" src="/api/company/logo?v=${c.logoVersion || 0}" alt="Logo">` : ''}</div>
      <div><h3>Claude</h3><p>${S.provider === 'mock' ? 'Sem chave: os agentes vão rodar em modo simulado.' : `${esc(S.model)} · limite de US$ ${Number(c.settings.budgetUsd ?? 20).toFixed(2).replace('.', ',')} por mês`}</p></div>
      <div><h3>Integrações</h3><p>${S.integrations?.length ? S.integrations.map((i) => `${esc(INTEGRATION_NAMES[i.type] || i.type)} · ${i.agents.map((g) => esc(S.agents.find((a) => a.id === g.id)?.name.split(' ')[0] || g.id)).join(', ') || 'ninguém com acesso'}`).join('<br>') : 'Nenhuma. As entregas ficam no workspace interno.'}</p></div>
      <div><h3>Equipe</h3><ul>${people.map((p) => `<li>${ic('user', 'sm')}${esc(p.name)} · ${esc(p.role)}</li>`).join('')}${ai.map((a) => `<li>${ic('bot', 'sm')}${esc(a.name)} · ${esc(a.role)}</li>`).join('')}</ul>
        ${(S.invites || []).length ? `<p class="hint">${S.invites.length} convite(s) pendente(s)</p>` : ''}</div>
    </div>
    <form>${nav('Abrir o escritório')}</form>`;
  bindNav(root, async () => {
    await api('PUT', '/api/onboarding/step', { step: 'done' });
    location.href = '/';
  });
}

// ---------------- início ----------------
if (await load()) {
  const wanted = params.get('step');
  const saved = me.company?.onboardingStep;
  if (!editMode && saved === 'done' && !wanted) location.href = '/';
  else go(STEPS.some((s) => s.id === wanted) ? wanted : !me.company ? 'company' : STEPS.some((s) => s.id === saved) ? saved : 'company', false);
}
