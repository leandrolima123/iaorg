// Painel: folha de pagamento dos agentes — quanto cada um custou, o que entregou e quanto custa cada entrega.
// Filtros (período e agente) numa linha acima de tudo; indicadores, custo por dia, custo por agente e a tabela.
import { $, $$, esc, api, ic } from './common.js';

const TZ = 'America/Sao_Paulo';
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
const shift = (d, days) => new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(new Date(Date.parse(`${d}T12:00:00Z`) + days * 864e5));
const PRESETS = [
  ['month', 'Este mês', () => { const t = today(); return [`${t.slice(0, 8)}01`, t]; }],
  ['lastmonth', 'Mês passado', () => { const t = today(); const first = `${t.slice(0, 8)}01`; const end = shift(first, -1); return [`${end.slice(0, 8)}01`, end]; }],
  ['7d', 'Últimos 7 dias', () => [shift(today(), -6), today()]],
  ['30d', 'Últimos 30 dias', () => [shift(today(), -29), today()]],
  ['year', 'Este ano', () => [`${today().slice(0, 4)}-01-01`, today()]],
];
const st = { preset: 'month', from: '', to: '', agent: '', sort: 'cost', dir: -1, data: null };

const usd = (v, { cents = true } = {}) => {
  if (v == null) return '—';
  if (v > 0 && v < 0.01) return '< US$ 0,01';
  return `US$ ${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: 2 })}`;
};
const num = (v, d = 0) => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { maximumFractionDigits: d, minimumFractionDigits: 0 }));
const fmtDay = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const delta = (cur, prev) => {
  if (!prev && !cur) return '';
  if (!prev) return '<span class="dl">sem custo no período anterior</span>';
  const p = ((cur - prev) / prev) * 100;
  if (Math.abs(p) < 0.5) return '<span class="dl">igual ao período anterior</span>';
  // custo subir é ruim → seta para cima em vermelho
  return `<span class="dl ${p > 0 ? 'bad' : 'good'}">${p > 0 ? '▲' : '▼'} ${num(Math.abs(p), 0)}% vs período anterior</span>`;
};

export async function renderDashboardPanel(root, ctx) {
  if (!st.from) [st.from, st.to] = PRESETS[0][2]();
  root.classList.add('db-loading');
  try { st.data = await api('GET', `/api/dashboard?from=${st.from}&to=${st.to}`); } catch (e) { root.innerHTML = `<p class="error">${esc(e.message)}</p>`; return; }
  root.classList.remove('db-loading');
  draw(root, ctx);
}

function draw(root, ctx) {
  const d = st.data;
  const rows = (st.agent ? d.rows.filter((r) => r.id === st.agent) : d.rows).slice();
  const k = st.sort;
  rows.sort((a, b) => {
    const va = a[k] ?? -1, vb = b[k] ?? -1;
    return (typeof va === 'string' ? va.localeCompare(vb, 'pt-BR') : va - vb) * st.dir;
  });
  const sel = st.agent ? d.rows.find((r) => r.id === st.agent) : null;
  const T = sel ? { cost: sel.cost, prevCost: sel.prevCost, tasksDone: sel.tasksDone, costPerTask: sel.costPerTask, jobHours: sel.jobHours, jobs: sel.jobs, prsMerged: sel.prsMerged, msgsToClients: sel.msgsToClients, cacheHit: sel.cacheHit, cacheKeep: sel.breakdown.cache, cacheRead: sel.cacheRead, cacheWrite: sel.cacheWrite } : d.totals;
  const kTok = (n) => (n >= 1e6 ? `${num(n / 1e6, 1)} mi` : n >= 1e3 ? `${num(n / 1e3)} mil` : num(n));
  const days = d.days.map((x) => ({ day: x.day, v: sel ? (x.by[sel.id] || 0) : x.total }));
  const pct = d.month.budget ? Math.min(100, (d.month.spent / d.month.budget) * 100) : 0;
  const periodTxt = `${fmtDay(d.period.from)}/${d.period.from.slice(0, 4)} a ${fmtDay(d.period.to)}/${d.period.to.slice(0, 4)} · ${d.period.days} dia(s)`;

  // leitura rápida (para contratar/demitir)
  const insights = [];
  const paid = d.rows.filter((r) => r.cost > 0);
  const idleCost = paid.filter((r) => !r.tasksDone && !r.msgsTotal);
  if (idleCost.length) insights.push(`${ic('octagon-x', 'sm')}<span><b>Custo sem entrega:</b> ${idleCost.map((r) => esc(r.name)).join(', ')} custaram ${usd(idleCost.reduce((t, r) => t + r.cost, 0))} sem concluir tarefas nem responder mensagens no período.</span>`);
  const perTask = d.rows.filter((r) => r.costPerTask != null).sort((a, b) => b.costPerTask - a.costPerTask);
  if (perTask.length > 1) insights.push(`${ic('scale', 'sm')}<span><b>Custo por entrega:</b> o mais caro é ${esc(perTask[0].name)} (${usd(perTask[0].costPerTask)} por tarefa); o mais barato, ${esc(perTask.at(-1).name)} (${usd(perTask.at(-1).costPerTask)}).</span>`);
  const top = paid[0];
  if (top && d.totals.cost > 0) insights.push(`${ic('chart-column', 'sm')}<span><b>Maior custo:</b> ${esc(top.name)}, ${num((top.cost / d.totals.cost) * 100)}% do total (${usd(top.cost)}), principalmente em ${esc(Object.entries(top.breakdown).sort((a, b) => b[1] - a[1])[0][0])}.</span>`);
  const noWork = d.rows.filter((r) => r.active && !r.cost && !r.tasksDone && !r.msgsTotal);
  if (noWork.length) insights.push(`${ic('moon', 'sm')}<span><b>Parados:</b> ${noWork.map((r) => esc(r.name)).join(', ')} não trabalharam no período (custo zero).</span>`);

  root.innerHTML = `
    <div class="db-filters" role="group" aria-label="Filtros do painel">
      <div class="seg db-presets">${PRESETS.map(([id, label]) => `<button type="button" class="${st.preset === id ? 'on' : ''}" data-preset="${id}">${label}</button>`).join('')}
        <button type="button" class="${st.preset === 'custom' ? 'on' : ''}" data-preset="custom">Personalizado</button></div>
      ${st.preset === 'custom' ? `<label class="db-date">De <input type="date" name="from" value="${st.from}" max="${today()}"></label><label class="db-date">até <input type="date" name="to" value="${st.to}" max="${today()}"></label>` : ''}
      <select class="db-agent" aria-label="Agente"><option value="">Todos os agentes</option>${d.rows.map((r) => `<option value="${esc(r.id)}" ${st.agent === r.id ? 'selected' : ''}>${esc(r.name)}${r.active ? '' : ' (desligado)'}</option>`).join('')}</select>
      <button type="button" class="btn small" data-csv>${ic('download', 'sm')}Exportar CSV</button>
      <span class="hint db-period">${periodTxt}</span>
    </div>

    <div class="db-kpis">
      <div class="db-kpi hero"><span>Custo ${sel ? `de ${esc(sel.name.split(' ')[0])}` : 'da equipe'} no período</span><b>${usd(T.cost)}</b>${delta(T.cost, T.prevCost)}</div>
      <div class="db-kpi"><span>Tarefas concluídas</span><b>${num(T.tasksDone)}</b><small>${num(T.prsMerged)} PR(s) mergeado(s)</small></div>
      <div class="db-kpi"><span>Custo por tarefa concluída</span><b>${usd(T.costPerTask)}</b><small>custo do período ÷ tarefas</small></div>
      <div class="db-kpi"><span>Trabalho na oficina</span><b>${num(T.jobHours, 1)} h</b><small>${num(T.jobs)} trabalho(s) · ${num(T.msgsToClients)} msg. a clientes</small></div>
      <div class="db-kpi" title="Parte dos tokens de entrada que veio do cache (paga só 5% a 10% do preço). Mantido = custo de manter o cache quente no expediente."><span>Acerto do cache</span><b>${T.cacheHit == null ? '—' : `${num(T.cacheHit * 100)}%`}</b><small>${T.cacheHit == null ? 'ainda sem medição' : `${kTok(T.cacheRead || 0)} lidos · ${kTok(T.cacheWrite || 0)} gravados`}${T.cacheKeep ? ` · mantido ${usd(T.cacheKeep)}` : ''}</small></div>
      <div class="db-kpi"><span>Gasto do mês atual</span><b>${usd(d.month.spent)}</b>${d.month.budget ? `<div class="meter-l ${pct >= 100 ? 'over' : pct >= 80 ? 'warn' : ''}" role="meter" aria-valuenow="${Math.round(pct)}" aria-valuemin="0" aria-valuemax="100" aria-label="Uso do limite do mês"><i style="width:${pct}%"></i></div><small>${num(pct)}% do limite de ${usd(d.month.budget, { cents: false })}</small>` : '<small>sem limite definido</small>'}</div>
    </div>

    ${insights.length && !sel ? `<div class="db-insights">${insights.map((x) => `<p>${x}</p>`).join('')}</div>` : ''}

    <div class="db-charts">
      <section class="db-card"><h3>Custo por dia</h3><p class="hint">${sel ? esc(sel.name) : 'Equipe toda'} · em US$</p><div class="db-chart" data-chart="days"></div></section>
      ${sel ? `<section class="db-card"><h3>Custo de ${esc(sel.name)} por tipo</h3><p class="hint">no período</p><div class="db-chart" data-chart="kinds"></div></section>`
        : `<section class="db-card"><h3>Custo por agente</h3><p class="hint">no período, do maior para o menor</p><div class="db-chart" data-chart="agents"></div></section>`}
    </div>

    <section class="db-card db-table-card"><h3>Folha de pagamento</h3>
      <p class="hint">Custo real com o Claude de cada agente no período, separado por tipo, ao lado do que ele entregou. Clique no título de uma coluna para ordenar.</p>
      <div class="db-table-wrap"><table class="db-table">
        <thead><tr>${[['name', 'Agente'], ['cost', 'Custo total'], ['b.conversas', 'Conversas'], ['b.oficina', 'Oficina'], ['b.reunioes', 'Reuniões'], ['b.simulador', 'Simulador'], ['cacheHit', 'Cache'], ['tasksDone', 'Tarefas concluídas'], ['costPerTask', 'Custo / tarefa'], ['jobHours', 'Horas na oficina'], ['prsMerged', 'PRs'], ['msgsToClients', 'Msg. a clientes'], ['leadHours', 'Tempo médio até concluir']]
          .map(([key, label]) => `<th scope="col" ${key.startsWith('b.') ? '' : `data-sort="${key}"`} class="${key === 'name' ? 'l' : ''} ${st.sort === key ? 'sorted' : ''}" ${st.sort === key ? `aria-sort="${st.dir > 0 ? 'ascending' : 'descending'}"` : ''}>${label}${st.sort === key ? (st.dir > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('')}</tr></thead>
        <tbody>${rows.map((r) => `<tr class="${r.active ? '' : 'off'}">
          <td class="l"><span class="who-dot" style="background:${esc(r.color)}"></span><b>${esc(r.name)}</b><small>${esc(r.role)}${r.active ? '' : ' · desligado'}${r.model ? ` · ${esc(r.model.replace('claude-', ''))}` : ''}</small></td>
          <td><b>${usd(r.cost)}</b>${r.prevCost ? `<small>${delta(r.cost, r.prevCost).replace(' vs período anterior', '').replace('igual ao período anterior', 'igual')}</small>` : ''}</td>
          <td>${usd(r.breakdown.conversas)}</td><td>${usd(r.breakdown.oficina)}</td><td>${usd(r.breakdown.reunioes)}</td><td>${usd(r.breakdown.simulador)}</td>
          <td>${r.cacheHit == null ? '—' : `${num(r.cacheHit * 100)}% acerto`}${r.breakdown.cache ? `<small>mantido ${usd(r.breakdown.cache)}</small>` : ''}</td>
          <td>${num(r.tasksDone)}${r.tasksBlocked ? `<small>${r.tasksBlocked} bloqueada(s)</small>` : ''}${r.inReview ? `<small>${r.inReview} em revisão</small>` : ''}</td>
          <td>${usd(r.costPerTask)}</td>
          <td>${num(r.jobHours, 1)}${r.jobs ? `<small>${r.jobsOk}/${r.jobs} ok</small>` : ''}</td>
          <td>${num(r.prsMerged)}</td><td>${num(r.msgsToClients)}</td>
          <td>${r.leadHours == null ? '—' : r.leadHours < 1 ? `${num(r.leadHours * 60)} min` : `${num(r.leadHours, 1)} h`}</td></tr>`).join('') || '<tr><td colspan="13" class="hint">Nenhum agente no período.</td></tr>'}</tbody>
        ${!sel && rows.length > 1 ? `<tfoot><tr><td class="l"><b>Total</b>${d.totals.unassigned ? `<small>inclui ${usd(d.totals.unassigned)} sem agente</small>` : ''}</td><td><b>${usd(d.totals.cost)}</b></td>
          ${['conversas', 'oficina', 'reunioes', 'simulador'].map((kk) => `<td>${usd(d.rows.reduce((t, r) => t + r.breakdown[kk], 0))}</td>`).join('')}
          <td>${d.totals.cacheHit == null ? '—' : `${num(d.totals.cacheHit * 100)}%`}${d.totals.cacheKeep ? `<small>mantido ${usd(d.totals.cacheKeep)}</small>` : ''}</td>
          <td>${num(d.totals.tasksDone)}</td><td>${usd(d.totals.costPerTask)}</td><td>${num(d.totals.jobHours, 1)}</td><td>${num(d.totals.prsMerged)}</td><td>${num(d.totals.msgsToClients)}</td><td></td></tr></tfoot>` : ''}
      </table></div>
      ${d.legacy ? `<p class="hint db-legacy">${ic('info', 'sm')}Antes de ${new Date(d.legacy.until).toLocaleDateString('pt-BR')} o IAORG só registrava por agente o custo da oficina. ${usd(d.legacy.usd)} de conversas e reuniões dessa época ficam na empresa, sem agente, e não entram nesta tabela.</p>` : ''}
    </section>`;

  // ---------- gráficos ----------
  columnChart($('[data-chart="days"]', root), days.map((x) => ({ label: fmtDay(x.day), full: new Date(`${x.day}T12:00:00Z`).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' }), v: x.v })));
  if (sel) barChart($('[data-chart="kinds"]', root), Object.entries(sel.breakdown).map(([n, v]) => ({ label: { conversas: 'Conversas', oficina: 'Oficina', reunioes: 'Reuniões', simulador: 'Simulador', cache: 'Cache mantido' }[n], v })).sort((a, b) => b.v - a.v));
  else barChart($('[data-chart="agents"]', root), d.rows.filter((r) => r.cost > 0).map((r) => ({ label: r.name, v: r.cost })));

  // ---------- filtros ----------
  $$('[data-preset]', root).forEach((b) => b.onclick = () => {
    st.preset = b.dataset.preset;
    if (st.preset !== 'custom') [st.from, st.to] = PRESETS.find((p) => p[0] === st.preset)[2]();
    renderDashboardPanel(root, ctx);
  });
  $$('.db-date input', root).forEach((i) => i.onchange = () => { st[i.name] = i.value; if (st.from && st.to && st.from <= st.to) renderDashboardPanel(root, ctx); });
  $('.db-agent', root).onchange = (e) => { st.agent = e.target.value; draw(root, ctx); };
  $$('[data-sort]', root).forEach((th) => th.onclick = () => { const key = th.dataset.sort; st.dir = st.sort === key ? -st.dir : (key === 'name' ? 1 : -1); st.sort = key; draw(root, ctx); });
  $('[data-csv]', root).onclick = () => exportCsv(d, rows);
}

function exportCsv(d, rows) {
  const n = (v) => (v == null ? '' : String(v).replace('.', ','));
  const head = ['Agente', 'Cargo', 'Ativo', 'Custo total (US$)', 'Conversas', 'Oficina', 'Reuniões', 'Simulador', 'Cache mantido', 'Acerto do cache (%)', 'Tarefas concluídas', 'Custo por tarefa', 'Horas na oficina', 'Trabalhos na oficina', 'PRs mergeados', 'Mensagens a clientes', 'Chamadas ao Claude'];
  const lines = rows.map((r) => [r.name, r.role, r.active ? 'sim' : 'não', n(r.cost), n(r.breakdown.conversas), n(r.breakdown.oficina), n(r.breakdown.reunioes), n(r.breakdown.simulador), n(r.breakdown.cache), r.cacheHit == null ? '' : n(+(r.cacheHit * 100).toFixed(1)), r.tasksDone, n(r.costPerTask), n(r.jobHours), r.jobs, r.prsMerged, r.msgsToClients, r.calls]);
  const csv = [head, ...lines].map((l) => l.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' }));
  a.download = `folha-agentes-${d.period.from}-a-${d.period.to}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---------- marcas (SVG à mão: uma cor só, sem legenda — o título diz o que é) ----------
const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, parent) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); parent?.appendChild(e); return e; };
function niceMax(v) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v)); const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}
function tip(box) {
  let t = box.querySelector('.db-tip');
  if (!t) { t = document.createElement('div'); t.className = 'db-tip'; t.setAttribute('role', 'tooltip'); box.appendChild(t); }
  return t;
}
const showTip = (box, x, y, value, label) => {
  const t = tip(box);
  t.replaceChildren();
  const b = document.createElement('b'); b.textContent = value;
  const s = document.createElement('span'); s.textContent = label;
  t.append(b, s);
  t.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
  t.classList.add('on');
};
const hideTip = (box) => box.querySelector('.db-tip')?.classList.remove('on');

function columnChart(box, data) {
  box.replaceChildren();
  if (!data.some((x) => x.v > 0)) { box.innerHTML = '<p class="hint db-empty">Sem custo no período.</p>'; return; }
  const W = Math.max(box.clientWidth || 520, 280), H = 220, L = 52, R = 8, Tp = 12, B = 26;
  const max = niceMax(Math.max(...data.map((x) => x.v)));
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, role: 'img', 'aria-label': `Custo por dia, máximo de US$ ${max}` }, box);
  const pw = W - L - R, ph = H - Tp - B;
  for (let i = 0; i <= 4; i++) {
    const v = (max / 4) * i, y = Tp + ph - (v / max) * ph;
    el('line', { x1: L, x2: W - R, y1: y, y2: y, class: 'db-grid' }, svg);
    const t = el('text', { x: L - 6, y: y + 4, class: 'db-ax', 'text-anchor': 'end' }, svg);
    t.textContent = `$${v.toLocaleString('pt-BR', { maximumFractionDigits: max < 1 ? 2 : max < 10 ? 1 : 0 })}`;
  }
  const band = pw / data.length, bw = Math.min(24, Math.max(3, band - 2));
  const every = Math.ceil(data.length / Math.max(1, Math.floor(pw / 46)));
  data.forEach((x, i) => {
    const cx = L + band * i + band / 2;
    const h = (x.v / max) * ph;
    if (x.v > 0) {
      const y = Tp + ph - h, r = Math.min(4, h / 2, bw / 2);
      el('path', { d: `M${cx - bw / 2},${Tp + ph} V${y + r} Q${cx - bw / 2},${y} ${cx - bw / 2 + r},${y} H${cx + bw / 2 - r} Q${cx + bw / 2},${y} ${cx + bw / 2},${y + r} V${Tp + ph} Z`, class: 'db-mark' }, svg);
    }
    if (i % every === 0) { const t = el('text', { x: cx, y: H - 8, class: 'db-ax', 'text-anchor': 'middle' }, svg); t.textContent = x.label; }
    const hit = el('rect', { x: L + band * i, y: Tp, width: band, height: ph, class: 'db-hit', tabindex: 0, 'aria-label': `${x.full}: ${usd(x.v)}` }, svg);
    const on = () => { svg.querySelectorAll('.db-mark.hl').forEach((m) => m.classList.remove('hl')); showTip(box, Math.min(cx - 50, W - 140) * (box.clientWidth / W), 0, usd(x.v), x.full); };
    hit.addEventListener('pointerenter', on); hit.addEventListener('focus', on);
    hit.addEventListener('pointerleave', () => hideTip(box)); hit.addEventListener('blur', () => hideTip(box));
  });
}

function barChart(box, data) {
  box.replaceChildren();
  if (!data.some((x) => x.v > 0)) { box.innerHTML = '<p class="hint db-empty">Sem custo no período.</p>'; return; }
  const max = Math.max(...data.map((x) => x.v));
  const list = document.createElement('div');
  list.className = 'db-bars';
  for (const x of data) {
    const row = document.createElement('div');
    row.className = 'db-bar'; row.tabIndex = 0;
    const name = document.createElement('span'); name.className = 'db-bar-name'; name.textContent = x.label;
    const track = document.createElement('span'); track.className = 'db-bar-track';
    const fill = document.createElement('i'); fill.style.width = `${Math.max(x.v > 0 ? 1.5 : 0, (x.v / max) * 100)}%`;
    track.appendChild(fill);
    const val = document.createElement('b'); val.className = 'db-bar-val'; val.textContent = usd(x.v);
    row.append(name, track, val);
    row.setAttribute('aria-label', `${x.label}: ${usd(x.v)}`);
    list.appendChild(row);
  }
  box.appendChild(list);
}
