// Minhas empresas: escolher qual abrir (as outras seguem rodando) ou criar uma nova.
import { $, $$, esc, api, toast, ic } from '/common.js';

const ROLE = { owner: 'dono', admin: 'administrador', member: 'membro' };
const usd = (v) => `US$ ${Number(v || 0).toFixed(2).replace('.', ',')}`;
const initials = (n) => String(n || '?').trim().split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toUpperCase();

async function load() {
  let me;
  try { me = await api('GET', '/api/me'); } catch { location.replace('/login.html'); return; }
  $('#who').textContent = me.user.email || me.user.name;
  const { current, companies } = await api('GET', '/api/companies');
  if (!companies.length) { location.replace('/onboarding.html'); return; }

  $('#list').innerHTML = companies.map((c) => {
    const setup = c.onboardingStep !== 'done';
    const live = c.paused ? `<span class="badge err">${ic('octagon-pause', 'sm')}Pausada</span>`
      : c.working ? `<span class="badge live">${ic('activity', 'sm')}${c.working} trabalhando agora</span>`
      : `<span class="badge">${ic('check', 'sm')}Rodando</span>`;
    return `<article class="company-card ${c.id === current ? 'current' : ''}">
      <div class="company-top">
        <div class="company-logo">${c.logo ? `<img src="/api/companies/${encodeURIComponent(c.id)}/logo?v=${c.logoVersion}" alt="">` : `<span>${esc(initials(c.name))}</span>`}</div>
        <div class="company-name"><b>${esc(c.name)}</b><small>${esc(c.segment || '')}</small></div>
        ${c.id === current ? '<span class="label">aberta</span>' : ''}
      </div>
      <div class="company-status">${setup ? `<span class="badge todo">${ic('settings-2', 'sm')}Configuração em andamento</span>` : live}${c.simulated ? '<span class="badge">modo simulado</span>' : ''}</div>
      <dl class="company-stats">
        <div><dt>Agentes</dt><dd class="num">${c.agents}</dd></div>
        <div><dt>Pessoas</dt><dd class="num">${c.people}</dd></div>
        <div><dt>Tarefas abertas</dt><dd class="num">${c.openTasks}</dd></div>
        <div><dt>Aprovações</dt><dd class="num ${c.approvals ? 'warn' : ''}">${c.approvals}</dd></div>
      </dl>
      <p class="hint">Você é ${esc(ROLE[c.appRole] || c.appRole || 'membro')}${c.role ? ` · ${esc(c.role)}` : ''} · gasto no mês ${usd(c.monthCostUsd)}</p>
      <button type="button" class="btn primary" data-open="${esc(c.id)}">${ic('log-in', 'sm')}${setup ? 'Continuar a configuração' : 'Abrir o escritório'}</button>
    </article>`;
  }).join('') + `<article class="company-card new">
      <div class="company-new-ic">${ic('plus')}</div>
      <b>Nova empresa</b>
      <p class="hint">Monte outra equipe de agentes e pessoas. As empresas atuais continuam funcionando.</p>
      <button type="button" class="btn" data-new>${ic('plus', 'sm')}Criar nova empresa</button>
    </article>`;

  $$('[data-open]').forEach((b) => b.onclick = async () => {
    b.disabled = true;
    try {
      const r = await api('POST', '/api/companies/select', { id: b.dataset.open });
      location.href = r.onboardingStep === 'done' ? '/' : '/onboarding.html';
    } catch (err) { toast(err.message, 'err'); b.disabled = false; }
  });
  $('[data-new]').onclick = async () => {
    try { await api('POST', '/api/companies/new'); location.href = '/onboarding.html'; } catch (err) { toast(err.message, 'err'); }
  };
}
load();
