// Funções: membros automáticos da equipe (sem IA). Telas de contratar e de configurar, usadas na
// Equipe e na aba Operações (Vigia). O formulário vem dos "fields" de cada função no servidor
// (server/functions.js), então uma função nova aparece aqui sem mudar esta tela.
import { $, $$, esc, api, ic, toast } from './common.js';

const when = (ts) => (ts ? new Date(ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const ago = (ts) => {
  if (!ts) return '';
  const m = Math.round((Date.now() - ts) / 60000);
  return m < 1 ? 'agora' : m < 60 ? `há ${m} min` : `há ${Math.round(m / 60)} h`;
};
const inMin = (ts) => { if (!ts) return '—'; const m = Math.max(0, Math.round((ts - Date.now()) / 60000)); return m < 1 ? 'em instantes' : `em ${m} min`; };

let catalogCache = null;
export async function functionCatalog(force = false) {
  if (!catalogCache || force) catalogCache = await api('GET', '/api/functions/catalog');
  return catalogCache;
}

function fieldHtml(f, value, dis) {
  const hint = f.hint ? `<small class="hint">${esc(f.hint)}</small>` : '';
  if (f.type === 'select') {
    return `<label class="field"><span>${esc(f.label)}</span><select name="${esc(f.key)}" ${dis}>${f.options.map((o) => `<option value="${esc(o.value)}" ${String(o.value) === String(value ?? '') ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>${hint}</label>`;
  }
  return `<label class="field"><span>${esc(f.label)}</span><input name="${esc(f.key)}" type="number" min="${f.min ?? ''}" max="${f.max ?? ''}" step="${f.step ?? 1}" value="${esc(value ?? '')}" ${dis}>${hint}</label>`;
}
const readForm = (form, fields) => Object.fromEntries(fields.map((f) => [f.key, f.type === 'number' ? +form[f.key].value : form[f.key].value]));

// ---------------- contratar ----------------
/** Catálogo de funções (passo 1) e formulário de contratação (passo 2). */
export async function renderFunctionHire(root, { agents, me, preset = null, onDone, onBack }) {
  let list;
  try { list = await functionCatalog(true); } catch (e) { root.innerHTML = `<p class="error">${esc(e.message)}</p>`; return; }
  const pick = preset ? list.find((d) => d.key === preset) : null;
  if (!pick) {
    root.innerHTML = `<div class="hire-grid">${list.map((d) => `
      <button type="button" class="role-card" data-fn="${d.key}" style="--c:${d.color}">
        <span class="role-ic">${ic(d.icon || 'cpu')}</span>
        <span class="role-txt"><b>${esc(d.title)}</b><small>Função automática · sem custo de IA</small></span>
        ${d.hired.length ? '<span class="role-have">na equipe</span>' : ''}
        <span class="role-sum">${esc(d.summary)}</span>
        <span class="role-tags">${d.requires.map((r) => `<i class="acc">${esc(r.label)}${r.connected ? '' : ' (não conectada)'}</i>`).join('')}</span>
      </button>`).join('')}</div>
      <p class="hint fn-note">${ic('info', 'sm')}Funções são membros automáticos: rodam sozinhas no servidor, aparecem no escritório e no organograma, mas não usam IA, não leem mensagens e não recebem tarefas. Novas funções entram neste catálogo.</p>`;
    $$('[data-fn]', root).forEach((b) => b.onclick = () => renderFunctionHire(root, { agents, me, preset: b.dataset.fn, onDone, onBack }));
    return;
  }
  const d = pick;
  const missing = d.requires.filter((r) => !r.connected);
  const owner = agents.find((a) => a.appRole === 'owner');
  root.innerHTML = `
    <div class="fn-head"><span class="fn-ic" style="--c:${d.color}">${ic(d.icon || 'cpu')}</span><div><b>${esc(d.title)}</b><p class="hint">${esc(d.summary)}</p></div></div>
    <ul class="fn-does">${d.does.map((x) => `<li>${ic('check', 'sm')}${esc(x)}</li>`).join('')}</ul>
    ${missing.length ? `<p class="error">${ic('plug', 'sm')}Precisa de ${esc(missing.map((r) => r.label).join(', '))} conectada em Integrações. Dá para contratar agora; ela começa a trabalhar quando a integração estiver conectada.</p>` : ''}
    <form class="form editor" id="fnHireForm" autocomplete="off">
      <label class="field"><span>Nome no escritório</span><input name="name" value="${esc(d.name)}" required maxlength="60"></label>
      <label class="field"><span>Reporta a</span><select name="reportsTo">${agents.filter((a) => a.active !== false).map((a) => `<option value="${a.id}" ${a.id === (owner?.id || me) ? 'selected' : ''}>${esc(a.name)} — ${esc(a.role)}</option>`).join('')}</select></label>
      <label class="field"><span>Cor</span><input type="color" name="color" value="${esc(d.color)}"></label>
      ${d.fields.map((f) => fieldHtml(f, d.defaults[f.key], '')).join('')}
      <label class="check full"><input type="checkbox" name="enabled" checked><span>Começar a trabalhar assim que contratar</span></label>
      <div class="row full"><button class="btn primary" type="submit">${ic('user-plus', 'sm')}Contratar ${esc(d.title)}</button>
        <button class="btn ghost" type="button" data-fn-back>${ic('arrow-left', 'sm')}Outras funções</button></div>
    </form>`;
  $('[data-fn-back]', root).onclick = () => (onBack ? onBack() : renderFunctionHire(root, { agents, me, onDone, onBack }));
  const form = $('#fnHireForm', root);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('button[type=submit]', form); btn.disabled = true;
    try {
      const m = await api('POST', '/api/functions', { key: d.key, name: form.name.value, reportsTo: form.reportsTo.value, color: form.color.value, enabled: form.enabled.checked, config: readForm(form, d.fields) });
      toast(`${m.name} contratado(a): já está no escritório`);
      onDone?.(m);
    } catch (err) { toast(err.message, 'err'); btn.disabled = false; }
  };
}

// ---------------- configurar e acompanhar ----------------
const RESULT_ICON = (r) => (/^chamou/.test(r) ? 'bell-ring' : /^erro|não conectada|incomplet/.test(r) ? 'octagon-x' : /parada|máximo|perda/.test(r) ? 'pause' : 'check');
const timers = new WeakMap();

/** Painel de uma função contratada: estado, configuração, histórico e ações. */
export async function renderFunctionPanel(root, { id, canEdit, onChange }) {
  clearTimeout(timers.get(root));
  let v;
  try { v = await api('GET', `/api/functions/${id}`); } catch (e) { root.innerHTML = `<p class="error">${esc(e.message)}</p>`; return; }
  const dis = canEdit ? '' : 'disabled';
  const last = v.state?.last;
  const pairs = last?.pares || [];
  const ok = (b) => (b ? `<span class="tr-pos">${ic('check', 'sm')}</span>` : `<span class="tr-neg">${ic('x', 'sm')}</span>`);
  root.innerHTML = `
    <div class="fn-panel">
      <div class="fn-status">
        <span class="badge ${v.enabled ? '' : 'err'}">${v.enabled ? 'Trabalhando' : 'Pausada'}</span>
        ${v.missing.length ? `<span class="badge err">${ic('plug', 'sm')}falta ${esc(v.missing.join(', '))}</span>` : ''}
        <span class="hint">${esc(v.summary)}</span>
        ${canEdit ? `<span class="fn-actions"><button type="button" class="btn small" data-fn-run>${ic('play', 'sm')}Rodar agora</button>
          <button type="button" class="btn small ghost" data-fn-toggle>${v.enabled ? `${ic('pause', 'sm')}Pausar` : `${ic('play', 'sm')}Ativar`}</button></span>` : ''}
      </div>
      <div class="db-kpis fn-kpis">
        <div class="db-kpi"><span>Última execução</span><b class="num">${last ? ago(last.ts) : '—'}</b><small>${last ? `${ic(RESULT_ICON(last.result), 'sm')}${esc(last.result)}` : 'ainda não rodou'}</small></div>
        <div class="db-kpi"><span>Próxima</span><b class="num">${v.enabled ? inMin(v.nextRunAt) : '—'}</b><small>${v.enabled ? `a cada ${esc(v.config.intervalMin ?? '?')} min` : 'pausada'}</small></div>
        <div class="db-kpi"><span>Execuções</span><b class="num">${v.state?.runs ?? 0}</b><small>desde a contratação</small></div>
        <div class="db-kpi"><span>Chamadas ao analista</span><b class="num">${v.state?.sent ?? 0}</b><small>só quando um par passou nos filtros</small></div>
      </div>
      ${pairs.length ? `<section class="db-card db-table-card"><h3>Última varredura</h3><p class="hint">${when(last.ts)} · o par precisa de todos os itens para virar chamada</p>
        <div class="db-table-wrap"><table class="db-table"><thead><tr><th class="l">Par</th><th>Dados</th><th>Tendência</th><th>Não esticado</th><th>Ganho/risco</th><th class="l">Situação</th></tr></thead>
        <tbody>${pairs.map((p) => `<tr><td class="l"><b>${esc(p.par)}</b></td><td>${ok(p.ok.dados_ok)}</td><td>${ok(p.ok.tendencia_ok)}</td><td>${ok(p.ok.nao_esticado)}</td>
          <td class="${p.gr >= v.config.minRR ? 'tr-pos' : ''}">${p.gr == null ? '—' : String(p.gr).replace('.', ',')}</td><td class="l hint">${esc(p.situacao || '')}</td></tr>`).join('')}</tbody></table></div></section>` : ''}
      <div class="fn-cols">
        <section class="db-card"><h3>Configuração</h3>
          <form class="form editor fn-form" autocomplete="off">${v.fields.map((f) => fieldHtml(f, v.config[f.key], dis)).join('')}
            ${canEdit ? `<div class="row full"><button class="btn primary" type="submit" disabled>${ic('check', 'sm')}Salvar configuração</button></div>` : ''}</form></section>
        <section class="db-card"><h3>Histórico</h3>
          <ul class="fn-hist">${(v.state?.history || []).map((h) => `<li>${ic(RESULT_ICON(h.result), 'sm')}<time>${when(h.ts)}</time><span>${esc(h.result)}</span></li>`).join('') || '<li class="hint">Nenhuma execução ainda.</li>'}</ul></section>
      </div>
    </div>`;
  const form = $('.fn-form', root);
  const save = $('button[type=submit]', form);
  form.oninput = () => { if (save) save.disabled = false; };
  form.onsubmit = async (e) => {
    e.preventDefault();
    try { await api('PUT', `/api/functions/${id}`, { config: readForm(form, v.fields) }); toast('Configuração salva'); onChange?.(); renderFunctionPanel(root, { id, canEdit, onChange }); } catch (err) { toast(err.message, 'err'); }
  };
  $('[data-fn-run]', root)?.addEventListener('click', async (e) => {
    e.target.closest('button').disabled = true;
    try { const r = await api('POST', `/api/functions/${id}/run`); toast(r.state?.last?.result ? `Resultado: ${r.state.last.result}` : 'Rodou'); } catch (err) { toast(err.message, 'err'); }
    renderFunctionPanel(root, { id, canEdit, onChange });
  });
  $('[data-fn-toggle]', root)?.addEventListener('click', async () => {
    try { await api('PUT', `/api/functions/${id}`, { enabled: !v.enabled }); toast(v.enabled ? 'Função pausada' : 'Função ativada'); onChange?.(); } catch (err) { toast(err.message, 'err'); }
    renderFunctionPanel(root, { id, canEdit, onChange });
  });
  // mantém a tela viva enquanto estiver aberta (sem perder o que está sendo editado)
  timers.set(root, setTimeout(() => {
    if (root.isConnected && !root.contains(document.activeElement) && save?.disabled !== false) renderFunctionPanel(root, { id, canEdit, onChange });
  }, 30_000));
}
