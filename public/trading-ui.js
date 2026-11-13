// Operações: o que a mesa de trading da Binance fez — resultado real (execuções na Binance, incluindo
// saídas por stop/alvo), acerto, curva de patrimônio, funil da mesa (proposta → risco → execução) e agentes.
import { $, $$, esc, api, ic } from './common.js';

const PERIODS = [[7, '7 dias'], [30, '30 dias'], [90, '90 dias'], [0, 'Tudo']];
const STATUS = {
  pendente: 'Pendente', aprovada: 'Aprovada', recusada: 'Recusada', expirada: 'Expirada', aguardando_dono: 'Aguardando o dono',
  executada: 'Executada', falhou: 'Falhou', recusada_na_execucao: 'Recusada na execução',
};
const st = { days: 30, data: null };

const nf = (v, d = 2) => Number(v).toLocaleString('pt-BR', { minimumFractionDigits: d, maximumFractionDigits: d });
const usdt = (v, { sign = false } = {}) => (v == null ? '—' : `${sign && v > 0 ? '+' : ''}${nf(v)} USDT`);
const pct = (v, d = 0) => (v == null ? '—' : `${nf(v * 100, d)}%`);
const px = (v) => (v == null ? '—' : nf(v, v >= 1000 ? 2 : v >= 1 ? 4 : 6));
const cls = (v) => (v > 0 ? 'tr-pos' : v < 0 ? 'tr-neg' : '');
const fmtDay = (d) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const when = (ts) => new Date(ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const dur = (min) => (min == null ? '—' : min < 60 ? `${min} min` : min < 1440 ? `${nf(min / 60, 1)} h` : `${nf(min / 1440, 1)} dias`);

export async function renderTradingPanel(root) {
  root.classList.add('db-loading');
  try { st.data = await api('GET', `/api/integrations/binance/insights?dias=${st.days}`); }
  catch (e) { root.classList.remove('db-loading'); root.innerHTML = `<p class="error">${esc(e.message)}</p>`; return; }
  root.classList.remove('db-loading');
  draw(root);
}

function readings(d) {
  const out = [];
  const s = d.summary, a = d.account, L = d.limits;
  if (d.halted) out.push(['octagon-x', 'Mesa parada', 'nenhuma compra nova até alguém liberar em Integrações → Binance.']);
  if (a && L.maxDailyLossUsdt && a.pnlDay < 0) {
    const used = -a.pnlDay / L.maxDailyLossUsdt;
    if (used >= 0.5) out.push(['triangle-exclamation-point', 'Perda do dia', `${pct(used)} do limite usado (${usdt(-a.pnlDay)} de ${usdt(L.maxDailyLossUsdt)}). Ao chegar em 100%, a mesa para de comprar até amanhã.`]);
  }
  if (s.trips >= 3 && s.avgWin != null && s.avgLoss != null && s.avgLoss < 0) {
    const payoff = s.avgWin / -s.avgLoss;
    const expect = s.winRate * s.avgWin + (1 - s.winRate) * s.avgLoss;
    out.push(['scale', expect >= 0 ? 'Expectativa positiva' : 'Expectativa negativa', `acerta ${pct(s.winRate)} das operações; o ganho médio é ${nf(payoff, 2)}× a perda média. Em média, cada operação ${expect >= 0 ? 'rende' : 'perde'} ${usdt(Math.abs(expect))}.`]);
  } else if (s.trips && s.trips < 3) out.push(['info', 'Pouca amostra', `só ${s.trips} operação(ões) fechada(s) no período: ainda cedo para tirar conclusão sobre acerto e expectativa.`]);
  const ranked = d.byPair.filter((p) => p.realized).sort((x, y) => y.realized - x.realized);
  if (ranked.length > 1) out.push(['chart-column', 'Pares', `melhor resultado em ${esc(ranked[0].par)} (${usdt(ranked[0].realized, { sign: true })}); pior em ${esc(ranked.at(-1).par)} (${usdt(ranked.at(-1).realized, { sign: true })}).`]);
  if (a?.equity && a.positions?.length) {
    const big = [...a.positions].sort((x, y) => y.valor_usdt - x.valor_usdt)[0];
    const share = big.valor_usdt / a.equity;
    if (share >= 0.5) out.push(['triangle-exclamation-point', 'Concentração', `${esc(big.par || big.ativo)} é ${pct(share)} do patrimônio da mesa.`]);
  }
  const f = d.funnel;
  if (f.total >= 3) {
    const lost = (f.byStatus.expirada || 0) + (f.byStatus.recusada_na_execucao || 0);
    out.push(['list-checks', 'Funil da mesa', `${f.total} proposta(s), ${f.reviewed} avaliada(s) pelo risco${f.approvalRate != null ? ` (${pct(f.approvalRate)} aprovadas)` : ''}, ${f.executed} executada(s)${lost ? `; ${lost} perdida(s) por expirar ou por o mercado mudar` : ''}${f.avgReviewMin != null ? `. O risco leva em média ${dur(f.avgReviewMin)} para avaliar` : ''}.`]);
  }
  if (f.byStatus.falhou) out.push(['octagon-x', 'Falhas', `${f.byStatus.falhou} execução(ões) falharam no período. Veja o diário de obra.`]);
  const other = Object.entries(s.feesOther || {});
  if (other.length) out.push(['info', 'Taxas em outra moeda', `${other.map(([k, v]) => `${nf(v, 6)} ${esc(k)}`).join(', ')} pagos em taxa não entram no resultado acima.`]);
  return out;
}

function draw(root) {
  const d = st.data;
  const s = d.summary, a = d.account;
  const envTag = d.env === 'prod' ? '<span class="badge err">Produção · dinheiro real</span>' : '<span class="badge">Testnet · dinheiro de teste</span>';
  const insights = readings(d);
  const totalRealized = d.days.reduce((t, x) => t + x.realized, 0);

  root.innerHTML = `
    <div class="db-filters" role="group" aria-label="Filtros">
      <div class="seg">${PERIODS.map(([v, l]) => `<button type="button" class="${st.days === v ? 'on' : ''}" data-days="${v}">${l}</button>`).join('')}</div>
      ${envTag}
      <button type="button" class="btn small" data-reload>${ic('refresh-cw', 'sm')}Atualizar</button>
      <span class="hint db-period">${fmtDay(d.period.from)}/${d.period.from.slice(0, 4)} a ${fmtDay(d.period.to)}/${d.period.to.slice(0, 4)} · atualizado às ${new Date(d.generatedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>
    </div>
    ${d.errors?.length ? `<p class="hint tr-warn">${ic('triangle-exclamation-point', 'sm')}Parte dos dados não veio da Binance: ${d.errors.map(esc).join('; ')}</p>` : ''}

    <div class="db-kpis">
      <div class="db-kpi hero"><span>Patrimônio da mesa</span><b class="num">${a ? usdt(a.equity) : '—'}</b>${a ? `<small class="${cls(a.pnlDay)}">${usdt(a.pnlDay, { sign: true })} hoje</small>` : '<small>conta indisponível</small>'}</div>
      <div class="db-kpi"><span>Resultado realizado</span><b class="num ${cls(s.realized)}">${usdt(s.realized, { sign: true })}</b><small>no período, já com taxas em USDT</small></div>
      <div class="db-kpi"><span>Em aberto</span><b class="num ${cls(s.unrealized)}">${usdt(s.unrealized, { sign: true })}</b><small>${a?.positions?.length || 0} posição(ões) · ${usdt(a?.usdtFree)} livres</small></div>
      <div class="db-kpi"><span>Acerto</span><b class="num">${pct(s.winRate)}</b><small>${s.wins} ganho(s) · ${s.losses} perda(s) em ${s.trips} operação(ões)</small></div>
      <div class="db-kpi" title="Soma dos ganhos ÷ soma das perdas. Acima de 1, a mesa ganha mais do que perde."><span>Fator de lucro</span><b class="num">${s.profitFactor == null ? '—' : nf(s.profitFactor, 2)}</b><small>ganho médio ${usdt(s.avgWin)} · perda média ${usdt(s.avgLoss)}</small></div>
      <div class="db-kpi"><span>Volume negociado</span><b class="num">${usdt(s.volume)}</b><small>${s.buys} compra(s) · ${s.sells} venda(s) · taxas ${usdt(s.feesUsdt)}</small></div>
    </div>

    ${insights.length ? `<div class="db-insights">${insights.map(([i, t, x]) => `<p>${ic(i, 'sm')}<span><b>${t}:</b> ${x}</span></p>`).join('')}</div>` : ''}

    <div class="db-charts">
      <section class="db-card"><h3>Resultado por dia</h3><p class="hint">realizado nas vendas · ${usdt(totalRealized, { sign: true })} no período</p><div class="db-chart" data-chart="days"></div></section>
      <section class="db-card"><h3>${d.equity.length >= 2 ? 'Patrimônio' : 'Resultado acumulado'}</h3><p class="hint">${d.equity.length >= 2 ? 'leituras da conta a cada 15 min, em USDT' : 'soma do resultado realizado, em USDT (a curva de patrimônio aparece depois de algumas leituras da conta)'}</p><div class="db-chart" data-chart="equity"></div></section>
    </div>

    <div class="db-charts">
      <section class="db-card"><h3>Funil da mesa</h3><p class="hint">propostas criadas no período · risco médio ${usdt(d.funnel.avgRisk)}${d.limits.maxRiskUsdt ? ` (limite ${usdt(d.limits.maxRiskUsdt)})` : ''}</p><div class="db-chart" data-chart="funnel"></div>
        ${Object.keys(d.funnel.byStatus).length ? `<p class="tr-status">${Object.entries(d.funnel.byStatus).sort((x, y) => y[1] - x[1]).map(([k, v]) => `<span class="chip">${esc(STATUS[k] || k)} <b class="num">${v}</b></span>`).join('')}</p>` : ''}</section>
      <section class="db-card"><h3>Agentes da mesa</h3><p class="hint">quem propôs, avaliou e executou no período</p>
        <div class="db-table-wrap"><table class="db-table"><thead><tr><th class="l">Agente</th><th>Propôs</th><th>Aprovadas</th><th>Recusadas</th><th>Avaliou</th><th>Executou</th></tr></thead>
        <tbody>${d.agents.map((g) => `<tr><td class="l"><b>${esc(g.name)}</b></td><td>${g.proposed}</td><td>${g.approved}${g.proposed ? `<small>${pct(g.approved / g.proposed)}</small>` : ''}</td><td>${g.rejected}</td><td>${g.reviewed}</td><td>${g.executed}</td></tr>`).join('') || '<tr><td colspan="6" class="hint l">Nenhuma proposta no período.</td></tr>'}</tbody></table></div></section>
    </div>

    <section class="db-card db-table-card"><h3>Pares</h3><p class="hint">resultado por par no período e posição aberta agora</p>
      <div class="db-table-wrap"><table class="db-table"><thead><tr><th class="l">Par</th><th>Preço</th><th>24 h</th><th>Resultado</th><th>Operações</th><th>Acerto</th><th>Volume</th><th>Posição</th><th>Custo médio</th><th>Em aberto</th></tr></thead>
      <tbody>${d.byPair.map((p) => `<tr><td class="l"><b>${esc(p.par)}</b></td><td>${px(p.price)}</td><td class="${cls(p.change24h)}">${p.change24h == null ? '—' : `${p.change24h > 0 ? '+' : ''}${nf(p.change24h)}%`}</td>
        <td class="${cls(p.realized)}"><b>${usdt(p.realized, { sign: true })}</b></td><td>${p.trips}<small>${p.fills} execuções</small></td><td>${pct(p.winRate)}</td><td>${usdt(p.volume)}</td>
        <td>${p.openQty ? nf(p.openQty, 6) : '—'}</td><td>${px(p.avgCost)}</td><td class="${cls(p.unrealized)}">${p.openQty ? usdt(p.unrealized, { sign: true }) : '—'}</td></tr>`).join('') || '<tr><td colspan="10" class="hint l">Nenhum par configurado.</td></tr>'}</tbody></table></div>
    </section>

    <div class="db-charts">
      <section class="db-card"><h3>Operações fechadas</h3><p class="hint">da primeira compra até zerar a posição · duração média ${dur(s.avgHoldMin)}</p>
        <div class="db-table-wrap"><table class="db-table"><thead><tr><th class="l">Par</th><th>Entrada</th><th>Saída</th><th>Investido</th><th>Resultado</th></tr></thead>
        <tbody>${d.trips.map((t) => `<tr><td class="l"><b>${esc(t.par)}</b></td><td>${when(t.opened)}</td><td>${when(t.closed)}</td><td>${usdt(t.invested)}</td><td class="${cls(t.pnl)}"><b>${usdt(t.pnl, { sign: true })}</b>${t.pct != null ? `<small>${t.pct > 0 ? '+' : ''}${nf(t.pct)}%</small>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="hint l">Nenhuma operação fechada no período.</td></tr>'}</tbody></table></div></section>
      <section class="db-card"><h3>Últimas execuções</h3><p class="hint">ordens executadas na Binance, inclusive stops e alvos</p>
        <div class="db-table-wrap"><table class="db-table"><thead><tr><th class="l">Quando</th><th class="l">Par</th><th>Lado</th><th>Quantidade</th><th>Preço</th><th>Total</th></tr></thead>
        <tbody>${d.fills.map((f) => `<tr><td class="l">${when(f.ts)}</td><td class="l"><b>${esc(f.par)}</b></td><td class="${f.side === 'BUY' ? 'tr-pos' : 'tr-neg'}">${f.side === 'BUY' ? 'Compra' : 'Venda'}</td><td>${nf(f.qty, 6)}</td><td>${px(f.price)}</td><td>${usdt(f.quote)}</td></tr>`).join('') || '<tr><td colspan="6" class="hint l">Nenhuma execução ainda.</td></tr>'}</tbody></table></div></section>
    </div>`;

  pnlColumns($('[data-chart="days"]', root), d.days.map((x) => ({ label: fmtDay(x.day), full: new Date(`${x.day}T12:00:00Z`).toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' }), v: x.realized })));
  if (d.equity.length >= 2) lineChart($('[data-chart="equity"]', root), d.equity.map((p) => ({ t: p.ts, v: p.equity })));
  else { let acc = 0; lineChart($('[data-chart="equity"]', root), d.days.map((x) => ({ t: Date.parse(`${x.day}T12:00:00Z`), v: (acc += x.realized) })), { zero: true }); }
  funnelBars($('[data-chart="funnel"]', root), [['Propostas', d.funnel.total], ['Avaliadas pelo risco', d.funnel.reviewed], ['Aprovadas', d.funnel.approved], ['Executadas', d.funnel.executed]]);

  $$('[data-days]', root).forEach((b) => b.onclick = () => { st.days = +b.dataset.days; renderTradingPanel(root); });
  $('[data-reload]', root).onclick = () => renderTradingPanel(root);
}

// ---------- gráficos (SVG à mão, mesmo estilo do Painel) ----------
const NS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, parent) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); parent?.appendChild(e); return e; };
function showTip(box, x, value, label) {
  let t = box.querySelector('.db-tip');
  if (!t) { t = document.createElement('div'); t.className = 'db-tip'; t.setAttribute('role', 'tooltip'); box.appendChild(t); }
  t.replaceChildren();
  const b = document.createElement('b'); b.textContent = value;
  const s = document.createElement('span'); s.textContent = label;
  t.append(b, s);
  t.style.transform = `translate(${Math.round(x)}px, 0px)`;
  t.classList.add('on');
}
const hideTip = (box) => box.querySelector('.db-tip')?.classList.remove('on');
const axis = (v, span) => v.toLocaleString('pt-BR', { maximumFractionDigits: span < 1 ? 3 : span < 10 ? 2 : 0 });

// Colunas para cima (ganho, verde) e para baixo (perda, laranja) a partir do zero.
function pnlColumns(box, data) {
  box.replaceChildren();
  if (!data.some((x) => x.v)) { box.innerHTML = '<p class="hint db-empty">Nenhuma venda no período.</p>'; return; }
  const W = Math.max(box.clientWidth || 520, 280), H = 220, L = 56, R = 8, Tp = 12, B = 26;
  const hi = Math.max(0, ...data.map((x) => x.v)), lo = Math.min(0, ...data.map((x) => x.v));
  const span = hi - lo || 1;
  const pw = W - L - R, ph = H - Tp - B;
  const y = (v) => Tp + ((hi - v) / span) * ph;
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, role: 'img', 'aria-label': 'Resultado realizado por dia' }, box);
  for (const v of [hi, (hi + lo) / 2, lo]) {
    el('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'db-grid' }, svg);
    el('text', { x: L - 6, y: y(v) + 4, class: 'db-ax', 'text-anchor': 'end' }, svg).textContent = axis(v, span);
  }
  el('line', { x1: L, x2: W - R, y1: y(0), y2: y(0), class: 'tr-zero' }, svg);
  const band = pw / data.length, bw = Math.min(24, Math.max(3, band - 2));
  const every = Math.ceil(data.length / Math.max(1, Math.floor(pw / 46)));
  data.forEach((x, i) => {
    const cx = L + band * i + band / 2;
    if (x.v) { const top = Math.min(y(x.v), y(0)); el('rect', { x: cx - bw / 2, y: top, width: bw, height: Math.max(1, Math.abs(y(x.v) - y(0))), class: `db-mark${x.v < 0 ? ' neg' : ''}` }, svg); }
    if (i % every === 0) el('text', { x: cx, y: H - 8, class: 'db-ax', 'text-anchor': 'middle' }, svg).textContent = x.label;
    const hit = el('rect', { x: L + band * i, y: Tp, width: band, height: ph, class: 'db-hit', tabindex: 0, 'aria-label': `${x.full}: ${usdt(x.v, { sign: true })}` }, svg);
    const on = () => showTip(box, Math.min(cx - 50, W - 150) * (box.clientWidth / W), usdt(x.v, { sign: true }), x.full);
    hit.addEventListener('pointerenter', on); hit.addEventListener('focus', on);
    hit.addEventListener('pointerleave', () => hideTip(box)); hit.addEventListener('blur', () => hideTip(box));
  });
}

function lineChart(box, pts, { zero = false } = {}) {
  box.replaceChildren();
  if (pts.length < 2 || !pts.some((p) => p.v)) { box.innerHTML = '<p class="hint db-empty">Ainda sem dados suficientes.</p>'; return; }
  const W = Math.max(box.clientWidth || 520, 280), H = 220, L = 64, R = 10, Tp = 12, B = 26;
  let lo = Math.min(...pts.map((p) => p.v)), hi = Math.max(...pts.map((p) => p.v));
  if (zero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  const pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.01 || 1; lo -= pad; hi += pad;
  const t0 = pts[0].t, t1 = pts.at(-1).t || t0 + 1;
  const pw = W - L - R, ph = H - Tp - B;
  const x = (t) => L + ((t - t0) / (t1 - t0 || 1)) * pw, y = (v) => Tp + ((hi - v) / (hi - lo)) * ph;
  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, width: '100%', height: H, role: 'img', 'aria-label': 'Curva em USDT' }, box);
  for (let i = 0; i <= 3; i++) {
    const v = lo + ((hi - lo) / 3) * i;
    el('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'db-grid' }, svg);
    el('text', { x: L - 6, y: y(v) + 4, class: 'db-ax', 'text-anchor': 'end' }, svg).textContent = axis(v, hi - lo);
  }
  if (zero) el('line', { x1: L, x2: W - R, y1: y(0), y2: y(0), class: 'tr-zero' }, svg);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ');
  const base = zero ? y(0) : Tp + ph;
  const up = pts.at(-1).v >= (zero ? 0 : pts[0].v);
  el('path', { d: `${line} L${x(t1).toFixed(1)},${base} L${x(t0).toFixed(1)},${base} Z`, class: `tr-area${up ? '' : ' neg'}` }, svg);
  el('path', { d: line, class: `tr-line${up ? '' : ' neg'}` }, svg);
  const fmtT = (t) => new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  for (const t of [t0, (t0 + t1) / 2, t1]) el('text', { x: x(t), y: H - 8, class: 'db-ax', 'text-anchor': t === t0 ? 'start' : t === t1 ? 'end' : 'middle' }, svg).textContent = fmtT(t);
  const dot = el('circle', { r: 4, class: `tr-dot${up ? '' : ' neg'}`, cx: -10, cy: -10 }, svg);
  const hit = el('rect', { x: L, y: Tp, width: pw, height: ph, class: 'db-hit', tabindex: 0, 'aria-label': `Último valor: ${usdt(pts.at(-1).v)}` }, svg);
  hit.addEventListener('pointermove', (e) => {
    const r = svg.getBoundingClientRect();
    const tx = t0 + (((e.clientX - r.left) * (W / r.width) - L) / pw) * (t1 - t0);
    const p = pts.reduce((b, q) => (Math.abs(q.t - tx) < Math.abs(b.t - tx) ? q : b));
    dot.setAttribute('cx', x(p.t)); dot.setAttribute('cy', y(p.v));
    showTip(box, Math.min(x(p.t) - 50, W - 150) * (box.clientWidth / W), usdt(p.v), new Date(p.t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }));
  });
  hit.addEventListener('pointerleave', () => { hideTip(box); dot.setAttribute('cx', -10); });
}

function funnelBars(box, rows) {
  box.replaceChildren();
  if (!rows[0][1]) { box.innerHTML = '<p class="hint db-empty">Nenhuma proposta no período.</p>'; return; }
  const list = document.createElement('div');
  list.className = 'db-bars';
  for (const [label, v] of rows) {
    const row = document.createElement('div');
    row.className = 'db-bar';
    row.innerHTML = `<span class="db-bar-name">${esc(label)}</span><span class="db-bar-track"><i style="width:${Math.max(v ? 1.5 : 0, (v / rows[0][1]) * 100)}%"></i></span><b class="db-bar-val">${v}${label !== rows[0][0] ? ` · ${pct(v / rows[0][1])}` : ''}</b>`;
    list.appendChild(row);
  }
  box.appendChild(list);
}
