// Mesa de trading (Binance Spot): o fluxo Análise → Risco → Execução é obrigatório NO CÓDIGO.
//  - mesa_propor (perm "analyze"): o analista propõe uma compra com valor, stop, alvo e tese.
//  - mesa_avaliar (perm "risk"): outro agente aprova, ajusta ou recusa. Quem propôs não avalia.
//  - mesa_executar (perm "trade"): só executa proposta aprovada e válida, exatamente como aprovada,
//    sempre com stop (OCO na Binance). Se o stop não puder ser colocado, vende na hora.
//  - mesa_fechar (perm "trade"): zera uma posição (reduz risco; vale mesmo com a mesa pausada).
// Limites da empresa (valor por ordem, risco por operação, perda no dia, posições) são conferidos aqui,
// na proposta, no parecer e de novo na hora da execução. O botão "Parar a mesa" bloqueia compras na hora.
import * as bn from './binance.js';
import { uid } from './companies.js';
import { logActivity } from './activity.js';
import { deskNews, newsLine } from './news.js';

const TZ = process.env.COMPANY_TZ || 'America/Sao_Paulo';
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
const num = (v) => (v === '' || v == null || Number.isNaN(+v) ? null : +v);
const usd = (v) => `${(+v).toFixed(2)} USDT`;

export const PERMS = [
  { id: 'read', label: 'Ver mercado e conta' },
  { id: 'analyze', label: 'Propor operações' },
  { id: 'risk', label: 'Aprovar risco das operações' },
  { id: 'trade', label: 'Executar ordens (dentro dos limites)' },
];

export const CONFIG_FIELDS = [
  { key: 'env', label: 'Ambiente', options: Object.entries(bn.ENVS).map(([value, e]) => ({ value, label: e.label })) },
  { key: 'pairs', label: 'Pares permitidos (separe por vírgula)', placeholder: 'BTCUSDT, ETHUSDT' },
  { key: 'maxOrderUsdt', label: 'Valor máximo por ordem (USDT)', placeholder: 'Ex.: 50' },
  { key: 'maxRiskUsdt', label: 'Risco máximo por operação (USDT perdidos se o stop for atingido)', placeholder: 'Ex.: 2' },
  { key: 'maxDailyLossUsdt', label: 'Perda máxima no dia (USDT): ao atingir, novas compras param até amanhã', placeholder: 'Ex.: 10' },
  { key: 'maxPositions', label: 'Máximo de posições abertas', placeholder: 'Ex.: 2' },
  { key: 'mode', label: 'Execução', options: [{ value: 'approval', label: 'Cada ordem passa pela minha aprovação' }, { value: 'auto', label: 'Automática dentro dos limites' }] },
];

// Configuração normalizada (o que vem da tela é texto).
export function deskConfig(cfg = {}) {
  const pairs = String(Array.isArray(cfg.pairs) ? cfg.pairs.join(',') : cfg.pairs || '').toUpperCase().split(/[\s,;]+/).map((s) => s.replace(/[^A-Z0-9]/g, '')).filter(Boolean);
  return {
    env: bn.ENVS[cfg.env] ? cfg.env : 'testnet',
    pairs: [...new Set(pairs)].slice(0, 20),
    maxOrderUsdt: num(cfg.maxOrderUsdt), maxRiskUsdt: num(cfg.maxRiskUsdt), maxDailyLossUsdt: num(cfg.maxDailyLossUsdt), maxPositions: num(cfg.maxPositions),
    mode: cfg.mode === 'auto' ? 'auto' : 'approval',
    halted: !!cfg.halted,
  };
}
export function missingLimits(d) {
  const miss = [];
  if (!d.pairs.length) miss.push('pares permitidos');
  if (!(d.maxOrderUsdt > 0)) miss.push('valor máximo por ordem');
  if (!(d.maxRiskUsdt > 0)) miss.push('risco máximo por operação');
  if (!(d.maxDailyLossUsdt > 0)) miss.push('perda máxima no dia');
  if (!(d.maxPositions >= 1)) miss.push('máximo de posições');
  return miss;
}

export function accessLine(d) {
  return ` na Binance ${d.env === 'prod' ? 'PRODUÇÃO (dinheiro real)' : 'TESTNET (dinheiro de teste)'}; pares: ${d.pairs.join(', ') || '(nenhum)'}; limites: até ${d.maxOrderUsdt ?? '?'} USDT por ordem, risco até ${d.maxRiskUsdt ?? '?'} USDT por operação, perda máxima no dia ${d.maxDailyLossUsdt ?? '?'} USDT, até ${d.maxPositions ?? '?'} posições; execução ${d.mode === 'auto' ? 'automática dentro dos limites' : 'com aprovação de uma pessoa'}${d.halted ? '; MESA PARADA pelo dono (nenhuma compra)' : ''}. Fluxo obrigatório: mesa_propor (analista) → mesa_avaliar (risco, outro agente) → mesa_executar (executor). Só compras no spot (sem alavancagem, sem venda a descoberto), sempre com stop.`;
}

// ---------------- ferramentas ----------------
const T = (name, description, properties = {}, required = []) => ({ name, description, input_schema: { type: 'object', properties, required } });
const S = (description) => ({ type: 'string', description });
const N = (description) => ({ type: 'number', description });

export function deskTools(has) {
  const tools = [];
  if (has('read') || has('analyze') || has('risk') || has('trade')) {
    tools.push(
      T('mesa_mercado', 'Mercado de um par permitido: último preço, variação e volume de 24 h e indicadores calculados (SMA 20/50/200, RSI 14, ATR 14, máxima e mínima das últimas 20 velas) no intervalo pedido. Use velas > 0 para ver as últimas velas (OHLCV).', {
        par: S('Par, ex.: BTCUSDT'), intervalo: { type: 'string', enum: ['15m', '1h', '4h', '1d'], description: 'Padrão: 1h' }, velas: N('Quantas velas recentes mostrar (0 a 50; padrão 0)'),
      }, ['par']),
      T('mesa_varredura', 'Varredura de TODOS os pares permitidos numa chamada só: tendência no 1d e no 4h, indicadores do 1h, suporte, resistência, stop sugerido, ganho/risco até a resistência, valor máximo pelos limites e os filtros já calculados (dados, tendência, esticado, ganho/risco). Marca os pares que já têm posição ou proposta em andamento. Comece toda análise por aqui; use mesa_mercado só para ver as velas de um par específico.'),
      T('mesa_noticias', 'Contexto de notícias para a mesa: eventos econômicos de alto impacto nas próximas 24 h (juros, inflação, emprego), manchetes de alerta das últimas horas (ataques, suspensões de saque, processos, quedas fortes) e manchetes sobre os pares da mesa. Só títulos, fonte, horário e link. Consulte antes de propor: notícia pode fazer desistir de uma entrada; sozinha, nunca justifica uma compra.', {
        par: S('Opcional: um par, para ver só as manchetes dele (ex.: SOLUSDT)'), horas: N('Janela das manchetes em horas (1 a 48; padrão 12)'),
      }),
      T('mesa_livro', 'Livro de ofertas de um par (melhores compras e vendas) para avaliar liquidez e spread.', { par: S('Par, ex.: BTCUSDT') }, ['par']),
      T('mesa_conta', 'Situação da mesa: saldos (com valor em USDT), patrimônio, resultado do dia, posições, ordens abertas, limites e quanto já foi usado, se a mesa está parada.'),
      T('mesa_resultado', 'Resultado da mesa num período, calculado das execuções reais na Binance: lucro realizado e em aberto, operações encerradas, acertos, ganho e perda médios, fator de lucro, taxas, resultado por par, funil das propostas (aprovadas, recusadas, executadas) e participação de cada agente. Use para relatórios e revisões.', {
        dias: { type: 'number', enum: [1, 7, 30], description: 'Período: 1 (hoje), 7 ou 30 dias. Padrão: 1' },
      }),
      T('mesa_propostas', 'Lista as propostas recentes da mesa (pendentes, aprovadas, recusadas, executadas).', { status: { type: 'string', enum: ['pendente', 'aprovada', 'recusada', 'executada', 'todas'], description: 'Padrão: todas' } }),
    );
  }
  if (has('analyze')) {
    tools.push(T('mesa_propor', 'Propõe uma COMPRA no spot para o Risco avaliar. Obrigatório: valor em USDT, stop (abaixo do preço atual) e a tese com os dados usados. O alvo é opcional, mas recomendado. A proposta vai para o agente de risco; você é avisado da decisão.', {
      par: S('Par permitido, ex.: BTCUSDT'), valor_usdt: N('Quanto gastar, em USDT'), stop: N('Preço do stop (saída se der errado)'), alvo: N('Opcional: preço do alvo (saída com lucro)'),
      tese: S('Por que entrar: indicadores, níveis, intervalo e horário dos dados'), validade_min: N('Por quantos minutos a ideia vale (padrão 30)'),
    }, ['par', 'valor_usdt', 'stop', 'tese']));
  }
  if (has('risk')) {
    tools.push(T('mesa_avaliar', 'Dá o parecer de risco de uma proposta: aprovar, ajustar (com novos valor/stop/alvo, já aprovados) ou recusar. Você não pode avaliar proposta sua. Confira os limites da empresa com mesa_conta antes. A aprovação vale por 15 minutos.', {
      proposta_id: S('id da proposta'), decisao: { type: 'string', enum: ['aprovar', 'ajustar', 'recusar'] },
      valor_usdt: N('Só em "ajustar": novo valor'), stop: N('Só em "ajustar": novo stop'), alvo: N('Só em "ajustar": novo alvo'), parecer: S('Justificativa com os números (risco em USDT, % do capital, distância do stop)'),
    }, ['proposta_id', 'decisao', 'parecer']));
  }
  if (has('trade')) {
    tools.push(
      T('mesa_executar', 'Executa uma proposta APROVADA pelo Risco: compra a mercado no valor aprovado e coloca na mesma hora o stop (e o alvo) na Binance. Os limites são conferidos de novo com o preço atual; se algo mudou, a ordem é recusada.', { proposta_id: S('id da proposta aprovada') }, ['proposta_id']),
      T('mesa_fechar', 'Zera a posição de um par: cancela as ordens abertas do par (stop/alvo) e vende tudo a mercado. Vale mesmo com a mesa parada (reduz risco).', { par: S('Par, ex.: BTCUSDT'), motivo: S('Motivo, registrado no diário') }, ['par', 'motivo']),
    );
  }
  return tools;
}

export const DESK_TOOLS = new Set(['mesa_mercado', 'mesa_varredura', 'mesa_resultado', 'mesa_noticias', 'mesa_livro', 'mesa_conta', 'mesa_propostas', 'mesa_propor', 'mesa_avaliar', 'mesa_executar', 'mesa_fechar']);

// ---------------- estado e cálculo ----------------
const proposals = (store) => (store.state.tradeProposals ||= []);
const trades = (store) => (store.state.trades ||= []);
const findProposal = (store, id) => proposals(store).find((p) => p.id === String(id || '').trim());

// Patrimônio da mesa: USDT + moedas base dos pares permitidos, avaliadas a preço de mercado.
async function snapshot(store, d, key) {
  const acc = await bn.account(d.env, key);
  const bases = new Map(); // ativo -> par
  for (const p of d.pairs) if (p.endsWith('USDT')) bases.set(p.slice(0, -4), p);
  const px = bases.size ? await bn.prices(d.env, [...bases.values()]) : {};
  const base0 = baselineOf(store, d, acc);
  const rows = [];
  let equity = 0, others = 0;
  for (const b of acc.balances) {
    const total = b.free + b.locked;
    if (b.asset !== 'USDT' && !bases.has(b.asset)) { if (total > 0) others++; continue; } // fora da mesa: não entra na conta nem na resposta
    const outside = b.asset === 'USDT' ? 0 : Math.min(total, base0[b.asset] || 0);
    const qty = total - outside;
    const value = b.asset === 'USDT' ? qty : qty * (px[bases.get(b.asset)] || 0);
    equity += value;
    rows.push({ ativo: b.asset, quantidade_da_mesa: +qty.toFixed(8), em_ordem: b.locked, valor_usdt: +value.toFixed(2), conta_na_mesa: true, ...(outside ? { ja_estava_na_conta_fora_da_mesa: outside } : {}) });
  }
  const positions = rows.filter((r) => r.ativo !== 'USDT' && r.conta_na_mesa && r.valor_usdt >= 5).map((r) => ({ ...r, par: bases.get(r.ativo) }));
  const usdtFree = acc.balances.find((b) => b.asset === 'USDT')?.free || 0;
  // abertura do dia: primeira leitura do dia vira a referência para a perda diária
  const day = (store.state.tradingDay ||= {});
  if (day.date !== today() || day.env !== d.env) { Object.assign(day, { date: today(), env: d.env, equity, alerted: false }); store.save(); }
  // curva de patrimônio: no máximo um ponto a cada 15 min
  const hist = (store.state.equityHistory ||= []);
  if (equity > 0 && (!hist.length || hist.at(-1).env !== d.env || Date.now() - hist.at(-1).ts >= 15 * 60_000)) {
    hist.push({ ts: Date.now(), env: d.env, equity: +equity.toFixed(2) });
    if (hist.length > 3000) hist.splice(0, hist.length - 3000);
    store.save();
  }
  return { rows, positions, equity, usdtFree, dayStart: day.equity, pnlDay: equity - day.equity, px, others };
}

// Moedas que já estavam na conta antes de a mesa operar (a testnet nasce com saldo de teste em centenas de moedas).
// Não são posição da mesa: ficam fora das posições, do patrimônio, do resultado do dia e do mesa_fechar.
function baselineOf(store, d, acc) {
  const all = (store.state.deskBaseline ||= {});
  if (!all[d.env]) {
    const operated = trades(store).some((t) => t.env === d.env);
    all[d.env] = { at: Date.now(), assets: operated ? {} : Object.fromEntries(acc.balances.filter((b) => b.asset !== 'USDT' && b.free + b.locked > 0).map((b) => [b.asset, b.free + b.locked])) };
    // a referência do dia e a curva antigas contavam essas moedas: recomeçam na nova base
    if (store.state.tradingDay?.env === d.env) store.state.tradingDay = {};
    if (store.state.equityHistory) store.state.equityHistory = store.state.equityHistory.filter((p) => p.env !== d.env);
    store.save();
  }
  return all[d.env].assets;
}
export const deskBaseline = (store, env) => store.state.deskBaseline?.[env]?.assets || {};

// Confere os limites para uma compra. Devolve a lista de violações (vazia = ok).
async function checkBuy(store, d, key, { par, valor, stop, alvo }, { atExecution = false } = {}) {
  const errs = [];
  if (!d.pairs.includes(par)) errs.push(`par ${par} não está na lista de pares permitidos (${d.pairs.join(', ')})`);
  if (!(valor > 0)) errs.push('valor precisa ser maior que zero');
  if (d.maxOrderUsdt && valor > d.maxOrderUsdt) errs.push(`valor ${usd(valor)} passa do máximo por ordem (${usd(d.maxOrderUsdt)})`);
  if (errs.length) return { errs };
  const info = await bn.symbolInfo(d.env, par);
  if (info.status !== 'TRADING') errs.push(`o par ${par} não está negociando agora (${info.status})`);
  if (info.minNotional && valor < info.minNotional) errs.push(`valor abaixo do mínimo da Binance para ${par} (${usd(info.minNotional)})`);
  const price = await bn.price(d.env, par);
  if (!(stop > 0) || stop >= price) errs.push(`stop ${stop} precisa ficar abaixo do preço atual (${price})`);
  if (alvo != null && alvo <= price) errs.push(`alvo ${alvo} precisa ficar acima do preço atual (${price})`);
  const risk = stop > 0 && stop < price ? valor * ((price - stop) / price) : null;
  if (risk != null && d.maxRiskUsdt && risk > d.maxRiskUsdt) errs.push(`risco de ${usd(risk)} (de ${price} até o stop ${stop}) passa do máximo por operação (${usd(d.maxRiskUsdt)}); reduza o valor ou aproxime o stop`);
  let snap = null;
  if (key) {
    snap = await snapshot(store, d, key);
    if (d.maxDailyLossUsdt && -snap.pnlDay >= d.maxDailyLossUsdt) errs.push(`perda do dia (${usd(-snap.pnlDay)}) atingiu o limite (${usd(d.maxDailyLossUsdt)}): sem novas compras até amanhã`);
    const holding = snap.positions.some((p) => p.par === par);
    if (!holding && d.maxPositions && snap.positions.length >= d.maxPositions) errs.push(`já há ${snap.positions.length} posição(ões) aberta(s), o máximo é ${d.maxPositions}`);
    if (atExecution && snap.usdtFree < valor) errs.push(`saldo livre de ${usd(snap.usdtFree)} não cobre a compra de ${usd(valor)}`);
  }
  return { errs, price, risk, info, snap };
}

// ---------------- varredura ----------------
// Todos os pares em 1d, 4h e 1h numa chamada, com os filtros da mesa já calculados no código
// (o modelo decide com números prontos em vez de fazer 15 consultas e contas de cabeça).
const TAXAS_PCT = 0.2; // ida e volta no spot (0,1% + 0,1%)
const sig = (v, n = 6) => (v == null || !Number.isFinite(v) ? null : +v.toPrecision(n));
const trendOf = (i) => (i.sma20 == null || i.sma50 == null ? 'sem dados'
  : i.ultimo > i.sma50 && i.sma20 > i.sma50 ? 'alta' : i.ultimo < i.sma50 && i.sma20 < i.sma50 ? 'baixa' : 'lateral');
const scanCache = new Map(); // env:pares -> { at, rows }

// Estratégia RSI(2) (reversão curta no 1h), escolhida pelo dono depois do backtest de 1 ano em 11 pares:
// entra quando uma vela de 1 h FECHA com RSI(2) abaixo de 10, stop a 2 ATR do 1h, sem alvo fixo;
// sai quando uma vela de 1 h fecha com RSI(2) acima de 70 ou depois de 24 h (a saída é feita pelo Vigia).
export const RSI2 = { entry: 10, exit: 70, stopAtr: 2, maxHours: 24 };
function rsiOf(closes, n) {
  if (closes.length <= n) return null;
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const x = closes[i] - closes[i - 1]; if (x >= 0) g += x; else l -= x; }
  g /= n; l /= n;
  for (let i = n + 1; i < closes.length; i++) { const x = closes[i] - closes[i - 1]; g = (g * (n - 1) + Math.max(x, 0)) / n; l = (l * (n - 1) + Math.max(-x, 0)) / n; }
  return l === 0 ? 100 : 100 - 100 / (1 + g / l);
}

async function scanPair(d, par) {
  const [cd, c4, c1, dia] = await Promise.all([bn.klines(d.env, par, '1d', 220), bn.klines(d.env, par, '4h', 220), bn.klines(d.env, par, '1h', 220), bn.ticker24h(d.env, par)]);
  const D = bn.indicators(cd), H4 = bn.indicators(c4), H1 = bn.indicators(c1);
  const price = H1.ultimo;
  const avisos = [];
  // qualidade: velas de 1 h sem negócio nas últimas 24 h e histórico curto (comum na testnet)
  const semVolume = c1.slice(-25, -1).filter((x) => !(x.v > 0)).length;
  if (semVolume > 2) avisos.push(`${semVolume} velas de 1 h sem negócio nas últimas 24 h`);
  if (c1.length < 200 || c4.length < 200) avisos.push('histórico curto para os indicadores');
  if (H1.atr_pct > 5) avisos.push(`volatilidade anormal no 1h (ATR ${H1.atr_pct}%)`);
  const dadosOk = !avisos.length;
  // 1d com menos de 50 velas (a testnet é zerada todo mês): a tendência de fundo vem do 4h, pela SMA50 contra a SMA200
  let fundo = '1d';
  if (D.sma50 == null && H4.sma200 != null) {
    fundo = `4h (SMA50 × SMA200), porque o 1d só tem ${cd.length} velas`;
    D.tendenciaAlt = price > H4.sma200 && H4.sma50 > H4.sma200 ? 'alta' : price < H4.sma200 && H4.sma50 < H4.sma200 ? 'baixa' : 'lateral';
  }
  const vols = c1.slice(-22, -2).map((x) => x.v);
  const volMed = vols.length ? vols.reduce((t, v) => t + v, 0) / vols.length : 0;
  const rsiAntes = bn.indicators(c1.slice(0, -3)).rsi14;
  const t1d = D.tendenciaAlt || trendOf(D), t4h = trendOf(H4);
  // stop pelo suporte do 1h (mínima de 20 velas) com folga de 0,25 ATR; alternativa por ATR (2 ATR do 1h)
  const stopSup = H1.atr14 ? H1.minima_20 - 0.25 * H1.atr14 : null;
  const stopAtr = H1.atr14 ? price - 2 * H1.atr14 : null;
  const distPct = stopSup ? ((price - stopSup) / price) * 100 : null;
  const resist = H4.maxima_20;
  const ganhoPct = ((resist - price) / price) * 100 - TAXAS_PCT;
  const gr = distPct ? ganhoPct / (distPct + TAXAS_PCT) : null;
  const valorMax = distPct ? Math.min(d.maxOrderUsdt || Infinity, d.maxRiskUsdt ? d.maxRiskUsdt / (distPct / 100) : Infinity) : null;
  const esticado = H4.rsi14 > 72 || (H4.atr14 && H4.sma20 != null && price - H4.sma20 > 2 * H4.atr14);
  const tendenciaOk = ['alta', 'lateral'].includes(t1d) && t4h === 'alta';
  // RSI(2) só com velas de 1 h fechadas (a última da Binance ainda está em formação)
  const fechadas = c1.slice(0, -1);
  const r2 = rsiOf(fechadas.map((x) => x.c), 2);
  const stopR2 = H1.atr14 ? price - RSI2.stopAtr * H1.atr14 : null;
  const distR2 = stopR2 ? ((price - stopR2) / price) * 100 : null;
  const valorR2 = distR2 ? Math.min(d.maxOrderUsdt || Infinity, d.maxRiskUsdt ? d.maxRiskUsdt / (distR2 / 100) : Infinity) : null;
  return {
    par, ultimo: price, variacao_24h_pct: dia.variacao_pct, volume_24h_usdt: Math.round(dia.volume_usdt),
    d1: { tendencia: t1d, calculada_no: fundo, sma20: D.sma20, sma50: D.sma50, sma200: D.sma200, rsi14: D.rsi14, atr_pct: D.atr_pct },
    h4: { tendencia: t4h, sma20: H4.sma20, sma50: H4.sma50, rsi14: H4.rsi14, atr14: H4.atr14, maxima_20: H4.maxima_20, minima_20: H4.minima_20, distancia_da_sma20_em_atr: H4.atr14 && H4.sma20 != null ? sig((price - H4.sma20) / H4.atr14, 3) : null },
    h1: { sma20: H1.sma20, rsi14: H1.rsi14, rsi14_3_velas_atras: rsiAntes, atr14: H1.atr14, maxima_20: H1.maxima_20, minima_20: H1.minima_20, volume_ultima_vela_vs_media: volMed ? sig(c1.at(-2).v / volMed, 3) : null },
    niveis: {
      stop_pelo_suporte: sig(stopSup), distancia_do_stop_pct: sig(distPct, 3), distancia_do_stop_em_atr_1h: H1.atr14 && stopSup ? sig((price - stopSup) / H1.atr14, 3) : null,
      stop_por_atr: sig(stopAtr), resistencia_4h: resist, ganho_ate_resistencia_pct: sig(ganhoPct, 3), ganho_risco_ate_resistencia: sig(gr, 3),
      valor_max_usdt: valorMax && Number.isFinite(valorMax) ? +valorMax.toFixed(2) : null, risco_no_valor_max_usdt: valorMax && Number.isFinite(valorMax) ? +(valorMax * distPct / 100).toFixed(2) : null,
    },
    filtros: { dados_ok: dadosOk, tendencia_ok: tendenciaOk, nao_esticado: !esticado, ganho_risco_ok: gr != null && gr >= 2 },
    passou_em_todos: dadosOk && tendenciaOk && !esticado && gr != null && gr >= 2,
    rsi2: {
      rsi2_1h_fechada: sig(r2, 3), vela_fechada: fechadas.length ? new Date(fechadas.at(-1).t).toISOString() : null,
      entrada: dadosOk && r2 != null && r2 < RSI2.entry, saida: r2 != null && r2 > RSI2.exit,
      stop: sig(stopR2), distancia_do_stop_pct: sig(distR2, 3),
      valor_usdt: valorR2 && Number.isFinite(valorR2) ? +valorR2.toFixed(2) : null,
      risco_usdt: valorR2 && Number.isFinite(valorR2) ? +(valorR2 * distR2 / 100).toFixed(2) : null,
    },
    avisos,
  };
}

async function scan(store, d, key) {
  const pairs = d.pairs.slice(0, 12);
  const k = `${d.env}:${pairs.join(',')}`;
  let c = scanCache.get(k);
  if (!c || Date.now() - c.at > 60_000) {
    const rows = await Promise.all(pairs.map((par) => scanPair(d, par).catch((e) => ({ par, erro: e.message, passou_em_todos: false }))));
    c = { at: Date.now(), rows };
    scanCache.set(k, c);
    if (scanCache.size > 50) scanCache.delete(scanCache.keys().next().value);
  }
  // situação da mesa: o que já está aberto ou em andamento (para não duplicar)
  const andamento = proposals(store).filter((p) => p.env === d.env && (p.status === 'pendente' || (p.status === 'aprovada' && Date.now() < p.aprovadaAte) || p.status === 'aguardando_dono'));
  const recusadas = proposals(store).filter((p) => p.env === d.env && p.status === 'recusada' && Date.now() - p.reviewedAt < 24 * 3600_000);
  let conta = null;
  try {
    const s = await snapshot(store, d, key);
    conta = { posicoes_abertas: s.positions.map((p) => p.par), max_posicoes: d.maxPositions, resultado_do_dia_usdt: +s.pnlDay.toFixed(2), perda_max_dia_usdt: d.maxDailyLossUsdt, usdt_livre: +s.usdtFree.toFixed(2) };
  } catch (e) { conta = { erro: `não consegui ler a conta: ${e.message}` }; }
  const abertas = new Set(conta.posicoes_abertas || []);
  const rows = c.rows.map((r) => ({
    ...r,
    situacao: abertas.has(r.par) ? 'posição aberta' : andamento.some((p) => p.par === r.par) ? 'proposta em andamento' : null,
    recusada_nas_ultimas_24h: recusadas.filter((p) => p.par === r.par).map((p) => ({ id: p.id, parecer: String(p.parecer || '').slice(0, 300) })),
  }));
  const btc = rows.find((r) => r.par === 'BTCUSDT');
  return {
    ambiente: d.env === 'prod' ? 'PRODUÇÃO (dinheiro real)' : 'TESTNET (dinheiro de teste; os preços da testnet não são os do mercado real)',
    horario_dados: new Date(c.at).toISOString(), mesa_parada: d.halted, conta,
    btc_1d: btc?.d1?.tendencia || null,
    como_ler: `tendencia = posição do preço e da SMA20 em relação à SMA50. ganho_risco_ate_resistencia usa o stop pelo suporte e a máxima de 20 velas do 4h, já descontando ${TAXAS_PCT}% de taxas. filtros são o mínimo para propor, não uma recomendação: a decisão e a tese são suas. rsi2 = estratégia de reversão curta: entrada quando a última vela de 1 h fechada tem RSI(2) < ${RSI2.entry}, stop a ${RSI2.stopAtr} ATR do 1h, sem alvo; saída (feita pelo Vigia) quando o RSI(2) fecha acima de ${RSI2.exit} ou após ${RSI2.maxHours} h.`,
    candidatos: rows.filter((r) => r.passou_em_todos && !r.situacao).map((r) => r.par),
    candidatos_rsi2: rows.filter((r) => r.rsi2?.entrada && !r.situacao).map((r) => r.par),
    pares: rows,
  };
}

// ---------------- vigia da mesa (função "vigia_mesa") ----------------
// O servidor faz a varredura (dados públicos da Binance, sem custo de modelo) e só acorda o analista
// quando um par passa em todos os filtros. Quem roda é um membro do tipo função (server/functions.js);
// a configuração fica na ficha dele (member.fn.config) e o estado em state.fnState[member.id].
export const WATCH_DEFAULTS = { strategy: 'tendencia', intervalMin: 15, cooldownH: 4, minRR: 2, maxLossPct: 70, analystId: '' };
export function watchConfig(cfg = {}) {
  const n = (v, lo, hi, def) => { const x = Number(v); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : def; };
  const D = WATCH_DEFAULTS;
  return {
    strategy: cfg.strategy === 'rsi2' ? 'rsi2' : 'tendencia',
    intervalMin: [1, 2, 5, 15, 30, 60].includes(+cfg.intervalMin) ? +cfg.intervalMin : D.intervalMin,
    cooldownH: Math.round(n(cfg.cooldownH, 1, 24, D.cooldownH)),
    minRR: +n(cfg.minRR, 1, 5, D.minRR).toFixed(1),
    maxLossPct: Math.round(n(cfg.maxLossPct, 10, 100, D.maxLossPct)),
    analystId: String(cfg.analystId || ''),
  };
}
const watching = new Set(); // member.id em execução

export async function watchDesk(rt, ctx, member, { force = false } = {}) {
  const store = rt.store;
  if (watching.has(member.id) || (store.state.paused && !force)) return null;
  const cfg = watchConfig(member.fn?.config);
  const w = ((store.state.fnState ||= {})[member.id] ||= { lastRun: 0, alerts: {}, runs: 0, sent: 0, history: [] });
  if (!force && Date.now() - w.lastRun < cfg.intervalMin * 60_000) return null;
  w.lastRun = Date.now();
  const done = (result, extra = {}) => {
    w.last = { ts: Date.now(), result, ...extra };
    w.history = [w.last, ...(w.history || [])].slice(0, 40);
    store.save();
    // log da Atividade: toda execução, com o par a par nos detalhes
    const yes = (b) => (b ? 'ok' : 'não');
    logActivity(store, member.id, {
      type: 'run', name: force ? 'varredura (rodada manualmente)' : 'varredura', ok: !/^erro|não conectada|incomplet|^conta:/.test(result),
      text: `${result.charAt(0).toUpperCase()}${result.slice(1)}${extra.pares ? ` · ${extra.pares.length} pares` : ''}`,
      ...(extra.pares?.length ? { detail: extra.pares.map((p) => `${p.par}: RSI(2) 1h ${p.rsi2 ?? '—'} · ganho/risco ${p.gr ?? '—'} · dados ${yes(p.ok.dados_ok)} · tendência ${yes(p.ok.tendencia_ok)} · não esticado ${yes(p.ok.nao_esticado)}${p.situacao ? ` · ${p.situacao}` : ''}`).join('\n') } : {}),
    });
    rt.setStatus(member.id, { status: 'idle', bubble: result.slice(0, 120) });
    setTimeout(() => { if (!watching.has(member.id)) rt.setStatus(member.id, { status: 'idle', bubble: '' }); }, 90_000);
    rt.emit({ type: 'function', id: member.id });
    return w.last;
  };
  const c = ctx.conn(store, 'binance');
  if (!c) return done('Binance não conectada');
  const d = deskConfig(c.config);
  if (d.halted) return done('mesa parada pelo dono');
  if (missingLimits(d).length) return done('limites da mesa incompletos');
  const analysts = store.aiAgents().filter((a) => a.active !== false && ctx.can(store, a, 'binance', 'analyze'));
  const who = analysts.find((a) => a.id === cfg.analystId) || analysts[0];
  if (!who) return done('nenhum analista com permissão de propor');
  watching.add(member.id);
  rt.setStatus(member.id, { status: 'working', bubble: `Varrendo ${d.pairs.length} pares` });
  try {
    const key = bn.parseKey(ctx.secretOf(store, 'binance'));
    const r = await scan(store, d, key);
    w.runs++;
    const k = r.conta || {};
    const pares = r.pares.map((p) => ({ par: p.par, gr: p.niveis?.ganho_risco_ate_resistencia ?? null, rsi2: p.rsi2?.rsi2_1h_fechada ?? null, ok: p.filtros || {}, situacao: p.situacao || null }));
    if (k.erro) return done(`conta: ${k.erro}`, { pares });
    const rsi2 = cfg.strategy === 'rsi2';
    // RSI(2): a saída é do Vigia (sem alvo na Binance; o stop fica lá). Fecha quando o RSI(2) da vela de 1 h
    // fechada passa de 70 ou quando a posição completa 24 h. Vender só reduz risco.
    const saidas = [];
    if (rsi2) {
      for (const p of r.pares.filter((x) => x.situacao === 'posição aberta')) {
        const buy = trades(store).filter((t) => t.env === d.env && t.par === p.par && t.lado === 'COMPRA').at(-1);
        const horas = buy ? (Date.now() - buy.ts) / 3600_000 : null;
        const motivo = p.rsi2?.saida ? `RSI(2) do 1h fechou em ${p.rsi2.rsi2_1h_fechada} (acima de ${RSI2.exit})`
          : horas != null && horas >= RSI2.maxHours ? `posição com ${horas.toFixed(1)} h (limite de ${RSI2.maxHours} h da estratégia RSI(2))` : null;
        if (!motivo) continue;
        try {
          const x = await closePosition(rt, d, key, p.par, `saída da estratégia RSI(2): ${motivo}`, member.id);
          saidas.push(`${p.par}${x.trade ? ` (${usd(x.trade.valorUsdt)})` : ''}`);
        } catch (e) { saidas.push(`${p.par} falhou: ${e.message}`); }
      }
      if (saidas.length) scanCache.clear(); // a conta mudou
    }
    const prefix = saidas.length ? `saiu de ${saidas.join(', ')}; ` : '';
    const abertas = (k.posicoes_abertas || []).length - saidas.filter((s) => !/falhou/.test(s)).length;
    if (d.maxPositions && abertas >= d.maxPositions) return done(`${prefix}posições no máximo`, { pares });
    if (d.maxDailyLossUsdt && -k.resultado_do_dia_usdt >= (cfg.maxLossPct / 100) * d.maxDailyLossUsdt) return done(`${prefix}perda do dia acima de ${cfg.maxLossPct}% do limite`, { pares });
    if (rsi2) {
      const andamento = r.pares.filter((p) => p.situacao === 'proposta em andamento').length;
      const vagas = Math.max(0, (d.maxPositions || 1) - abertas - andamento);
      const pass = r.pares.filter((p) => !p.erro && p.rsi2?.entrada && !p.situacao && p.rsi2.valor_usdt > 0)
        .sort((a, b) => a.rsi2.distancia_do_stop_pct - b.rsi2.distancia_do_stop_pct); // stop mais curto primeiro (como no backtest)
      const fresh = pass.filter((p) => !(Date.now() - (w.alerts[p.par] || 0) < cfg.cooldownH * 3600_000)).slice(0, vagas);
      if (!fresh.length) return done(`${prefix}${pass.length ? `sinais RSI(2) em espera: ${pass.map((p) => p.par).join(', ')}${vagas ? '' : ' (sem vaga)'}` : 'nenhum sinal RSI(2)'}`, { pares });
      for (const p of fresh) w.alerts[p.par] = Date.now();
      w.sent++;
      const lista = fresh.map((p) => `${p.par}: RSI(2) ${p.rsi2.rsi2_1h_fechada} na vela de 1 h de ${p.rsi2.vela_fechada}, preço ${p.ultimo}, valor ${p.rsi2.valor_usdt} USDT, stop ${p.rsi2.stop} (${p.rsi2.distancia_do_stop_pct}%, risco ${p.rsi2.risco_usdt} USDT), sem alvo`).join('\n');
      rt.postMessage(member.id, who.id, `[${member.name} · vigia da mesa · estratégia RSI(2)] Sinal de entrada (${r.horario_dados}):\n${lista}\nProponha cada um com mesa_propor exatamente com esses valor e stop, SEM alvo, validade 20 min, seguindo o procedimento "Estratégia RSI(2)". A saída é feita pelo Vigia (RSI(2) acima de ${RSI2.exit} ou ${RSI2.maxHours} h).`);
      rt.logEvent('task', member.id, `${member.name} (vigia da mesa): sinal RSI(2) em ${fresh.map((p) => p.par).join(', ')}; ${who.name} foi chamado para propor.`);
      return done(`${prefix}chamou ${who.name}: ${fresh.map((p) => p.par).join(', ')}`, { pares, called: who.id });
    }
    // filtros com o ganho/risco mínimo desta função; fora: par com posição/proposta, avisado há pouco ou recusado nas últimas 24 h
    // (BTC em baixa no 1d: o analista não propõe nada, então o Vigia também não o acorda)
    if (r.btc_1d === 'baixa') return done('BTC em baixa no 1d: nenhuma entrada pela estratégia de tendência', { pares });
    const pass = r.pares.filter((p) => !p.erro && p.filtros.dados_ok && p.filtros.tendencia_ok && p.filtros.nao_esticado && p.niveis.ganho_risco_ate_resistencia >= cfg.minRR && !p.situacao);
    const fresh = pass.filter((p) => !(Date.now() - (w.alerts[p.par] || 0) < cfg.cooldownH * 3600_000) && !p.recusada_nas_ultimas_24h?.length);
    if (!fresh.length) return done(pass.length ? `candidatos em espera: ${pass.map((p) => p.par).join(', ')}` : 'nenhum par passou nos filtros', { pares });
    for (const p of fresh) w.alerts[p.par] = Date.now();
    w.sent++;
    const resumo = fresh.map((p) => `${p.par} (ganho/risco ${p.niveis.ganho_risco_ate_resistencia}, stop a ${p.niveis.distancia_do_stop_em_atr_1h} ATR)`).join('; ');
    rt.postMessage(member.id, who.id, `[${member.name} · vigia da mesa] Passaram em todos os filtros na varredura de ${r.horario_dados}: ${resumo}. Siga os seus procedimentos de varredura: chame mesa_varredura para os números atualizados e decida. Se não propuser, não mande mensagem a ninguém.`);
    rt.logEvent('task', member.id, `${member.name} (vigia da mesa): ${fresh.map((p) => p.par).join(', ')} passou(aram) nos filtros; ${who.name} foi chamado para analisar.`);
    return done(`chamou ${who.name}: ${fresh.map((p) => p.par).join(', ')}`, { pares, called: who.id });
  } catch (e) {
    return done(`erro: ${e.message}`);
  } finally {
    watching.delete(member.id);
  }
}

// Dados de risco de uma proposta, calculados pelo sistema na hora (o Risco confere números independentes da tese).
export async function riskContext(d, par, p, chk) {
  const [row, btc, ob, noticias] = await Promise.all([
    scanPair(d, par),
    par === 'BTCUSDT' ? null : scanPair(d, 'BTCUSDT').catch(() => null),
    bn.orderbook(d.env, par, 5),
    newsLine(d.pairs, par),
  ]);
  const price = chk.price;
  const dist = ((price - p.stop) / price) * 100;
  const atr = row.h1.atr14;
  const bid = ob.compras[0]?.[0], ask = ob.vendas[0]?.[0];
  const s = chk.snap;
  const loss = s ? Math.max(0, -s.pnlDay) : null;
  return {
    preco: price, distancia_stop_pct: sig(dist, 3), distancia_stop_atr_1h: atr ? sig((price - p.stop) / atr, 3) : null,
    ganho_risco_com_taxas: p.alvo ? sig((((p.alvo - price) / price) * 100 - TAXAS_PCT) / (dist + TAXAS_PCT), 3) : null,
    risco_usdt: +chk.risk.toFixed(2), risco_pct_patrimonio: s?.equity ? sig((chk.risk / s.equity) * 100, 3) : null,
    spread_pct: bid && ask ? sig(((ask - bid) / ask) * 100, 3) : null,
    tendencia_fundo: row.d1.tendencia, tendencia_4h: row.h4.tendencia, btc_fundo: btc ? btc.d1.tendencia : row.d1.tendencia,
    filtros_da_varredura: row.filtros, setup_rsi2: row.rsi2, avisos_de_dados: row.avisos,
    perda_do_dia_usdt: loss == null ? null : +loss.toFixed(2), perda_max_dia_usdt: d.maxDailyLossUsdt,
    uso_da_perda_do_dia_pct: loss != null && d.maxDailyLossUsdt ? Math.round((loss / d.maxDailyLossUsdt) * 100) : null,
    posicoes_abertas: s ? s.positions.map((x) => x.par) : null, max_posicoes: d.maxPositions,
    minimo_binance_usdt: chk.info?.minNotional || null, horario: new Date().toISOString(),
    noticias,
  };
}
const riskLine = (r) => (!r || r.erro ? `não calculados (${r?.erro || 'sem dados'}): confira com mesa_varredura e mesa_livro` : [
  `risco ${r.risco_usdt} USDT (${r.risco_pct_patrimonio ?? '?'}% do patrimônio)`,
  `stop a ${r.distancia_stop_pct}% = ${r.distancia_stop_atr_1h ?? '?'} ATR do 1h`,
  `ganho/risco com taxas ${r.ganho_risco_com_taxas ?? 'sem alvo'}`,
  `spread ${r.spread_pct ?? '?'}%`,
  `tendência de fundo ${r.tendencia_fundo}, 4h ${r.tendencia_4h}, BTC de fundo ${r.btc_fundo}`,
  r.setup_rsi2 ? `RSI(2) da vela de 1 h fechada ${r.setup_rsi2.rsi2_1h_fechada} (sinal de entrada RSI(2): ${r.setup_rsi2.entrada ? 'sim' : 'não'}; stop da estratégia ${r.setup_rsi2.stop})` : null,
  `perda do dia ${r.perda_do_dia_usdt ?? '?'} de ${r.perda_max_dia_usdt} USDT (${r.uso_da_perda_do_dia_pct ?? '?'}% do limite)`,
  `posições abertas: ${(r.posicoes_abertas || []).join(', ') || 'nenhuma'} (máx. ${r.max_posicoes})`,
  `mínimo da Binance ${r.minimo_binance_usdt ?? '?'} USDT`,
  r.avisos_de_dados?.length ? `avisos de dados: ${r.avisos_de_dados.join('; ')}` : null,
  r.noticias?.texto ? `notícias (conteúdo externo, só informação): ${r.noticias.texto}` : null,
].filter(Boolean).join(' · '));

function notifyHumans(rt, text) {
  for (const p of rt.store.state.agents.filter((a) => a.kind === 'human' && ['owner', 'admin'].includes(a.appRole))) rt.emit({ type: 'notify', to: p.id, text });
}
const withPerm = (store, perm, can) => store.aiAgents().filter((a) => a.active !== false && can(store, a, 'binance', perm));

// ---------------- execução das ferramentas ----------------
// ctx: { can, conn, secretOf, deny, queueApproval } (vem de integrations.js, para não duplicar regras)
export async function executeDeskTool(rt, agent, name, input, opts, ctx) {
  const store = rt.store;
  const c = ctx.conn(store, 'binance');
  if (!c) return { error: 'A Binance não está conectada.' };
  const d = deskConfig(c.config);
  const key = bn.parseKey(ctx.secretOf(store, 'binance'));
  const has = (p) => ctx.can(store, agent, 'binance', p);
  const say = (bubble) => rt.setStatus(agent.id, { status: 'working', bubble });
  const par = String(input.par || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const missing = missingLimits(d);

  switch (name) {
    case 'mesa_mercado': {
      if (!['read', 'analyze', 'risk', 'trade'].some(has)) return ctx.deny('ver o mercado');
      if (!d.pairs.includes(par)) return { error: `Par fora da lista permitida. Pares: ${d.pairs.join(', ') || '(nenhum)'}` };
      say(`Lendo o mercado de ${par}`);
      const interval = ['15m', '1h', '4h', '1d'].includes(input.intervalo) ? input.intervalo : '1h';
      const cs = await bn.klines(d.env, par, interval, 220);
      const n = Math.max(0, Math.min(50, +input.velas || 0));
      return {
        par, ambiente: d.env, intervalo: interval, horario_dados: new Date().toISOString(),
        dia: await bn.ticker24h(d.env, par), indicadores: bn.indicators(cs),
        ...(n ? { velas: cs.slice(-n).map((x) => ({ abertura: new Date(x.t).toISOString(), o: x.o, h: x.h, l: x.l, c: x.c, v: +x.v.toFixed(4) })) } : {}),
      };
    }
    case 'mesa_varredura': {
      if (!['read', 'analyze', 'risk', 'trade'].some(has)) return ctx.deny('ver o mercado');
      if (!d.pairs.length) return { error: 'A mesa não tem pares permitidos. Peça ao dono para definir em Integrações → Binance.' };
      say('Varrendo os pares da mesa');
      return scan(store, d, key);
    }
    case 'mesa_noticias': {
      if (!['read', 'analyze', 'risk', 'trade'].some(has)) return ctx.deny('ver as notícias da mesa');
      if (par && !d.pairs.includes(par)) return { error: `Par fora da lista permitida. Pares: ${d.pairs.join(', ')}` };
      say('Lendo as notícias do mercado');
      return deskNews(d.pairs, { horas: input.horas, par });
    }
    case 'mesa_resultado': {
      if (!['read', 'analyze', 'risk', 'trade'].some(has)) return ctx.deny('ver o resultado da mesa');
      say('Apurando o resultado da mesa');
      const days = [1, 7, 30].includes(+input.dias) ? +input.dias : 1;
      const x = await deskInsights(store, { config: c.config, secretPlain: ctx.secretOf(store, 'binance') }, { days });
      return {
        ambiente: x.env, periodo: x.period, conta: x.account || null, resumo: x.summary,
        por_par: x.byPair.filter((p) => p.fills || p.openQty).map((p) => ({ par: p.par, realizado: p.realized, em_aberto: p.unrealized, operacoes: p.trips, acertos: p.wins, volume: p.volume })),
        operacoes_encerradas: x.trips.slice(0, 10), funil_das_propostas: x.funnel, por_agente: x.agents,
        dias: x.days.filter((d) => d.realized || d.volume), erros: x.errors,
      };
    }
    case 'mesa_livro': {
      if (!['read', 'analyze', 'risk', 'trade'].some(has)) return ctx.deny('ver o mercado');
      if (!d.pairs.includes(par)) return { error: `Par fora da lista permitida. Pares: ${d.pairs.join(', ') || '(nenhum)'}` };
      const ob = await bn.orderbook(d.env, par, 10);
      const bid = ob.compras[0]?.[0], ask = ob.vendas[0]?.[0];
      return { par, melhor_compra: bid, melhor_venda: ask, spread_pct: bid && ask ? +(((ask - bid) / ask) * 100).toFixed(4) : null, ...ob };
    }
    case 'mesa_conta': {
      if (!['read', 'analyze', 'risk', 'trade'].some(has)) return ctx.deny('ver a conta da mesa');
      say('Conferindo a conta da mesa');
      const s = await snapshot(store, d, key);
      const orders = await bn.openOrders(d.env, key).catch(() => null);
      // posição da mesa sem ordem de venda aberta no par = sem stop na Binance (regra: nada sem stop)
      const semProtecao = orders ? s.positions.filter((p) => !orders.some((o) => o.symbol === p.par && o.side === 'SELL')).map((p) => p.par) : null;
      return {
        posicoes_sem_protecao: semProtecao ?? 'não consegui ler as ordens abertas',
        ambiente: d.env === 'prod' ? 'PRODUÇÃO (dinheiro real)' : 'TESTNET (dinheiro de teste)', mesa_parada: d.halted, modo_execucao: d.mode === 'auto' ? 'automática dentro dos limites' : 'aprovação de uma pessoa',
        patrimonio_usdt: +s.equity.toFixed(2), abertura_do_dia_usdt: +s.dayStart.toFixed(2), resultado_do_dia_usdt: +s.pnlDay.toFixed(2), usdt_livre: +s.usdtFree.toFixed(2),
        posicoes: s.positions, saldos: s.rows, ...(s.others ? { outros_ativos_fora_da_mesa: s.others } : {}),
        ordens_abertas: (orders || []).filter((o) => d.pairs.includes(o.symbol)).map((o) => ({ par: o.symbol, id: o.orderId, lista_oco: o.orderListId > -1 ? o.orderListId : null, tipo: o.type, lado: o.side, preco: +o.price, stop: +o.stopPrice || null, quantidade: +o.origQty })),
        limites: { pares: d.pairs, max_por_ordem_usdt: d.maxOrderUsdt, risco_max_por_operacao_usdt: d.maxRiskUsdt, perda_max_dia_usdt: d.maxDailyLossUsdt, max_posicoes: d.maxPositions, limites_faltando: missing },
        uso: { perda_do_dia_usdt: +Math.max(0, -s.pnlDay).toFixed(2), posicoes_abertas: s.positions.length },
      };
    }
    case 'mesa_propostas': {
      if (!['read', 'analyze', 'risk', 'trade'].some(has)) return ctx.deny('ver as propostas');
      const want = input.status && input.status !== 'todas' ? input.status : null;
      return { propostas: proposals(store).filter((p) => !want || p.status === want).slice(-20).reverse().map(publicProposal(rt)) };
    }
    case 'mesa_propor': {
      if (!has('analyze')) return ctx.deny('propor operações');
      if (missing.length) return { error: `A mesa ainda não tem os limites definidos (${missing.join(', ')}). Peça ao dono para completar em Integrações → Binance.` };
      if (d.halted) return { error: 'A mesa está PARADA pelo dono: nenhuma compra nova. Não proponha até ela ser liberada.' };
      const p = { par, valor: num(input.valor_usdt), stop: num(input.stop), alvo: num(input.alvo) };
      if (!String(input.tese || '').trim()) return { error: 'Descreva a tese (dados, indicadores, intervalo e horário).' };
      say(`Montando proposta em ${par}`);
      const chk = await checkBuy(store, d, key, p);
      if (chk.errs.length) return { error: `Proposta fora dos limites: ${chk.errs.join('; ')}.` };
      const riscoDados = await riskContext(d, par, p, chk).catch((e) => ({ erro: e.message }));
      const prop = {
        riscoDados,
        id: uid('op'), ts: Date.now(), status: 'pendente', by: agent.id, par, valor: p.valor, stop: p.stop, alvo: p.alvo,
        precoNaProposta: chk.price, riscoUsdt: +chk.risk.toFixed(2), tese: String(input.tese).slice(0, 2000),
        validoAte: Date.now() + Math.min(Math.max(+input.validade_min || 30, 5), 240) * 60_000, env: d.env,
      };
      proposals(store).push(prop);
      if (proposals(store).length > 300) proposals(store).splice(0, proposals(store).length - 300);
      store.save();
      const reviewers = withPerm(store, 'risk', ctx.can).filter((a) => a.id !== agent.id);
      const summary = `${prop.id}: comprar ${usd(prop.valor)} de ${par} (preço ${chk.price}), stop ${prop.stop}${prop.alvo ? `, alvo ${prop.alvo}` : ''}, risco ${usd(prop.riscoUsdt)}.`;
      for (const r of reviewers) rt.postMessage(agent.id, r.id, `[Mesa] Nova proposta para avaliar — ${summary}\nTese: ${prop.tese}\nDados de risco (calculados pelo sistema agora, independentes da tese): ${riskLine(riscoDados)}\nAvalie com mesa_avaliar (proposta_id ${prop.id}). A proposta vale até ${new Date(prop.validoAte).toISOString()}.`);
      rt.logEvent('task', agent.id, `${agent.name} propôs ${summary}`);
      return { ok: true, proposta_id: prop.id, risco_usdt: prop.riscoUsdt, aviso: reviewers.length ? `Enviada ao Risco (${reviewers.map((r) => r.name).join(', ')}). Aguarde o parecer.` : 'ATENÇÃO: nenhum outro agente tem a permissão de risco. Peça ao dono para liberar alguém.' };
    }
    case 'mesa_avaliar': {
      if (!has('risk')) return ctx.deny('avaliar o risco das operações');
      const prop = findProposal(store, input.proposta_id);
      if (!prop) return { error: 'Proposta não encontrada. Veja com mesa_propostas.' };
      if (prop.status !== 'pendente') return { error: `Esta proposta já está ${prop.status}.` };
      if (prop.by === agent.id) return { error: 'Você propôs esta operação: o parecer de risco tem que ser de outro agente.' };
      if (Date.now() > prop.validoAte) { prop.status = 'expirada'; store.save(); return { error: 'A proposta expirou (a validade da ideia passou). Peça uma nova ao analista se ainda fizer sentido.' }; }
      const parecer = String(input.parecer || '').trim();
      if (!parecer) return { error: 'Escreva o parecer com os números.' };
      const proposer = store.getAgent(prop.by);
      if (input.decisao === 'recusar') {
        Object.assign(prop, { status: 'recusada', reviewedBy: agent.id, reviewedAt: Date.now(), parecer });
        store.save();
        if (proposer) rt.postMessage(agent.id, proposer.id, `[Mesa] Proposta ${prop.id} (${prop.par}) RECUSADA pelo Risco. Parecer: ${parecer}`);
        rt.logEvent('task', agent.id, `${agent.name} recusou a proposta ${prop.id} (${prop.par}): ${parecer.slice(0, 160)}`);
        return { ok: true, status: 'recusada' };
      }
      const novo = input.decisao === 'ajustar'
        ? { par: prop.par, valor: num(input.valor_usdt) ?? prop.valor, stop: num(input.stop) ?? prop.stop, alvo: input.alvo === undefined ? prop.alvo : num(input.alvo) }
        : { par: prop.par, valor: prop.valor, stop: prop.stop, alvo: prop.alvo };
      say(`Avaliando o risco de ${prop.par}`);
      const chk = await checkBuy(store, d, key, novo);
      if (chk.errs.length) return { error: `Não dá para aprovar, está fora dos limites: ${chk.errs.join('; ')}. Ajuste ou recuse.` };
      Object.assign(prop, { status: 'aprovada', reviewedBy: agent.id, reviewedAt: Date.now(), parecer, valor: novo.valor, stop: novo.stop, alvo: novo.alvo, riscoUsdt: +chk.risk.toFixed(2), aprovadaAte: Date.now() + 15 * 60_000, ajustada: input.decisao === 'ajustar' });
      store.save();
      const execs = withPerm(store, 'trade', ctx.can);
      const summary = `${prop.id}: comprar ${usd(prop.valor)} de ${prop.par}, stop ${prop.stop}${prop.alvo ? `, alvo ${prop.alvo}` : ''}, risco ${usd(prop.riscoUsdt)}${prop.ajustada ? ' (ajustada pelo Risco)' : ''}.`;
      for (const e of execs) rt.postMessage(agent.id, e.id, `[Mesa] Proposta APROVADA pelo Risco — ${summary} Válida por 15 min: execute com mesa_executar (proposta_id ${prop.id}).`);
      if (proposer) rt.postMessage(agent.id, proposer.id, `[Mesa] Sua proposta ${prop.id} foi ${prop.ajustada ? 'APROVADA COM AJUSTE' : 'APROVADA'}. Parecer: ${parecer}`);
      rt.logEvent('task', agent.id, `${agent.name} aprovou ${summary}`);
      return { ok: true, status: 'aprovada', valida_ate: new Date(prop.aprovadaAte).toISOString(), executores: execs.map((e) => e.name) };
    }
    case 'mesa_executar': {
      if (!has('trade')) return ctx.deny('executar ordens');
      const prop = findProposal(store, input.proposta_id);
      if (!prop) return { error: 'Proposta não encontrada.' };
      if (prop.status !== 'aprovada' && !(opts.approved && prop.status === 'aguardando_dono')) return { error: `Só executo proposta aprovada pelo Risco. Esta está: ${prop.status}.` };
      if (d.halted) return { error: 'A mesa está PARADA pelo dono. Nenhuma compra.' };
      if (missing.length) return { error: `Limites da mesa incompletos (${missing.join(', ')}).` };
      if (prop.env !== d.env) return { error: 'A proposta foi feita em outro ambiente (testnet/produção). Peça uma nova.' };
      if (!opts.approved && Date.now() > prop.aprovadaAte) { prop.status = 'expirada'; store.save(); return { error: 'A aprovação do Risco expirou (15 min). Peça nova avaliação.' }; }
      // Modo "aprovação": a ordem vai para a mesa do dono e só roda quando ele aprovar.
      if (d.mode === 'approval' && !opts.approved) {
        prop.status = 'aguardando_dono';
        store.save();
        return ctx.queueApproval(rt, agent, name, { proposta_id: prop.id }, {
          channel: 'trade',
          text: `Comprar ${usd(prop.valor)} de ${prop.par} a mercado, com stop ${prop.stop}${prop.alvo ? ` e alvo ${prop.alvo}` : ''} (risco ${usd(prop.riscoUsdt)}).\nTese: ${prop.tese}\nParecer do Risco: ${prop.parecer}`,
          preview: { para: `Binance ${d.env === 'prod' ? 'PRODUÇÃO' : 'testnet'} · ${prop.par}`, assunto: `Proposta ${prop.id}` },
          reply: 'A ordem foi para aprovação do dono e só será enviada à Binance depois do OK. Não repita.',
        });
      }
      say(`Executando ${prop.par}`);
      const chk = await checkBuy(store, d, key, prop, { atExecution: true });
      if (chk.errs.length) { prop.status = 'recusada_na_execucao'; prop.erro = chk.errs.join('; '); store.save(); return { error: `Não executei: ${prop.erro}. O mercado mudou desde a aprovação; se ainda fizer sentido, peça uma nova proposta.` }; }
      const info = chk.info;
      let buy;
      try { buy = await bn.marketBuy(d.env, key, prop.par, prop.valor.toFixed(2)); }
      catch (e) { prop.status = 'falhou'; prop.erro = e.message; store.save(); return { error: `A Binance recusou a compra: ${e.message}` }; }
      const filled = +buy.executedQty;
      const spent = +buy.cummulativeQuoteQty;
      const feeBase = (buy.fills || []).filter((f) => f.commissionAsset === info.base).reduce((t, f) => t + +f.commission, 0);
      const qty = bn.floorTo(Math.max(0, filled - feeBase), info.stepSize);
      const avg = filled ? spent / filled : chk.price;
      const trade = { id: uid('tr'), ts: Date.now(), env: d.env, proposalId: prop.id, by: prop.by, reviewedBy: prop.reviewedBy, executedBy: agent.id, par: prop.par, lado: 'COMPRA', quantidade: +qty, precoMedio: +avg.toFixed(8), valorUsdt: +spent.toFixed(2), stop: prop.stop, alvo: prop.alvo, orderId: buy.orderId };
      let protection;
      try {
        protection = await bn.protect(d.env, key, info, { quantity: qty, stop: prop.stop, target: prop.alvo });
        trade.protecao = protection.orderListId ?? protection.orderId;
      } catch (e) {
        // Regra da mesa: posição sem stop não fica aberta. Vende na hora e avisa.
        trade.erroProtecao = e.message;
        try { const s = await bn.marketSell(d.env, key, prop.par, qty); trade.vendaEmergencia = { orderId: s.orderId, valorUsdt: +(+s.cummulativeQuoteQty).toFixed(2) }; } catch (e2) { trade.erroVenda = e2.message; }
        trades(store).push(trade); prop.status = 'falhou'; prop.erro = `stop não colocado: ${e.message}`; store.save();
        rt.logEvent('error', agent.id, `${agent.name}: a compra de ${prop.par} foi feita mas o stop falhou (${e.message}). ${trade.erroVenda ? `A venda de emergência TAMBÉM falhou (${trade.erroVenda}): confira a conta na Binance AGORA.` : 'A posição foi vendida na hora.'}`);
        notifyHumans(rt, `Mesa: problema na proteção de ${prop.par}. ${trade.erroVenda ? 'Confira a Binance agora.' : 'Posição vendida.'}`);
        return { error: `Compra feita, mas o stop falhou (${e.message}). ${trade.erroVenda ? `A venda de emergência falhou: ${trade.erroVenda}. Escale para o dono AGORA.` : 'Vendi a posição na hora (regra: nada sem stop).'}` };
      }
      trades(store).push(trade);
      if (trades(store).length > 500) trades(store).splice(0, trades(store).length - 500);
      Object.assign(prop, { status: 'executada', executedBy: agent.id, executedAt: Date.now(), tradeId: trade.id });
      store.save();
      const msg = `comprou ${qty} ${info.base} (${usd(spent)}) em ${prop.par} a ~${trade.precoMedio}, com stop ${prop.stop}${prop.alvo ? ` e alvo ${prop.alvo}` : ''} [${d.env}]`;
      rt.logEvent('task', agent.id, `${agent.name} ${msg}.`);
      notifyHumans(rt, `Mesa: ${agent.name} ${msg}`);
      const proposer = store.getAgent(prop.by);
      if (proposer && proposer.id !== agent.id) rt.postMessage(agent.id, proposer.id, `[Mesa] Proposta ${prop.id} EXECUTADA: ${msg}.`);
      // confere na Binance que a proteção está lá (lida de volta, não só a resposta da criação)
      const ords = await bn.openOrders(d.env, key, prop.par).catch(() => null);
      const sells = ords ? ords.filter((o) => o.side === 'SELL').map((o) => ({ tipo: o.type, preco: +o.price || null, stop: +o.stopPrice || null, quantidade: +o.origQty })) : null;
      return {
        ok: true, trade,
        protecao_na_binance: sells == null ? 'não consegui ler as ordens abertas: confira com mesa_conta' : sells.length ? sells : 'NENHUMA ordem de venda aberta no par: a posição está sem stop',
      };
    }
    case 'mesa_fechar': {
      if (!has('trade')) return ctx.deny('fechar posições');
      if (!d.pairs.includes(par)) return { error: `Par fora da lista permitida: ${par}` };
      const motivo = String(input.motivo || '').trim();
      if (!motivo) return { error: 'Informe o motivo.' };
      say(`Zerando ${par}`);
      return closePosition(rt, d, key, par, motivo, agent.id);
    }
  }
  return undefined;
}

// Zera a posição da mesa num par: cancela stop/alvo e vende a mercado só o que a mesa comprou.
// Usado pelo mesa_fechar (executor) e pela saída automática da estratégia RSI(2) (Vigia).
async function closePosition(rt, d, key, par, motivo, byId) {
  const store = rt.store;
  const by = rt.nameOf(byId);
  const info = await bn.symbolInfo(d.env, par);
  // cancela stop/alvo do par antes de vender (senão o saldo fica preso nas ordens)
  const orders = await bn.openOrders(d.env, key, par);
  const lists = new Set();
  for (const o of orders) {
    if (o.orderListId > -1) { if (!lists.has(o.orderListId)) { lists.add(o.orderListId); await bn.cancelOrderList(d.env, key, par, o.orderListId).catch(() => {}); } }
    else await bn.cancelOrder(d.env, key, par, o.orderId).catch(() => {});
  }
  const acc = await bn.account(d.env, key);
  // só o que a mesa comprou: o saldo que já estava na conta antes não é vendido
  const free = Math.max(0, (acc.balances.find((b) => b.asset === info.base)?.free || 0) - (deskBaseline(store, d.env)[info.base] || 0));
  const qty = bn.floorTo(free, info.stepSize);
  const px = await bn.price(d.env, par);
  if (!(+qty > 0) || +qty * px < (info.minNotional || 0)) return { ok: true, aviso: `Nada a vender em ${par} (saldo ${free} ${info.base}${orders.length ? `; ${orders.length} ordem(ns) cancelada(s)` : ''}).` };
  const s = await bn.marketSell(d.env, key, par, qty);
  const got = +s.cummulativeQuoteQty;
  const trade = { id: uid('tr'), ts: Date.now(), env: d.env, executedBy: byId, par, lado: 'VENDA', quantidade: +qty, precoMedio: +(got / +s.executedQty).toFixed(8), valorUsdt: +got.toFixed(2), orderId: s.orderId, motivo };
  trades(store).push(trade); store.save();
  rt.logEvent('task', byId, `${by} zerou ${par}: vendeu ${qty} ${info.base} por ${usd(got)}. Motivo: ${motivo}`);
  notifyHumans(rt, `Mesa: ${by} zerou ${par} (${usd(got)})`);
  return { ok: true, trade, ordens_canceladas: orders.length };
}

const publicProposal = (rt) => (p) => ({
  id: p.id, status: p.status, par: p.par, valor_usdt: p.valor, stop: p.stop, alvo: p.alvo, risco_usdt: p.riscoUsdt, preco_na_proposta: p.precoNaProposta,
  dados_de_risco: p.riscoDados || null, proposta_por: rt.nameOf(p.by), avaliada_por: p.reviewedBy ? rt.nameOf(p.reviewedBy) : null, parecer: p.parecer || null, tese: p.tese,
  criada: new Date(p.ts).toISOString(), aprovacao_vale_ate: p.aprovadaAte ? new Date(p.aprovadaAte).toISOString() : null, erro: p.erro || null,
});

// Resumo para a tela de Integrações (cartão da Binance).
export async function deskStatus(store, c) {
  const d = deskConfig(c.config);
  const out = { config: d, missing: missingLimits(d), proposals: proposals(store).slice(-8).reverse().map((p) => ({ id: p.id, status: p.status, par: p.par, valor: p.valor, risco: p.riscoUsdt, ts: p.ts })), trades: trades(store).slice(-8).reverse() };
  try {
    const key = bn.parseKey(c.secretPlain);
    const s = await snapshot(store, d, key);
    Object.assign(out, { equity: +s.equity.toFixed(2), dayStart: +s.dayStart.toFixed(2), pnlDay: +s.pnlDay.toFixed(2), usdtFree: +s.usdtFree.toFixed(2), positions: s.positions });
  } catch (e) { out.error = e.message; }
  return out;
}

// ---------------- painel de operações ----------------
const dayOf = (ts) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(ts));
const shiftDay = (d, n) => new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(new Date(Date.parse(`${d}T12:00:00Z`) + n * 864e5));
const r2 = (v) => +(+v || 0).toFixed(2);
const insightsCache = new WeakMap(); // store -> Map(dias -> { at, data })

// Resultado por par a partir das execuções reais na Binance (inclui as saídas por stop/alvo da OCO,
// que não passam pelo IAORG). Custo médio: cada venda realiza (preço de venda - custo médio) × quantidade.
// Taxas em USDT entram no resultado; taxas em outra moeda (BNB) ficam à parte, em feesOther.
function replayFills(fills, lastPrice) {
  let qty = 0, cost = 0, trip = null;
  const trips = [], sells = [], feesOther = {};
  let feesUsdt = 0;
  for (const f of fills) {
    const fee = f.fee;
    if (f.side === 'BUY') {
      let q = f.qty, spent = f.quote;
      if (f.feeAsset === f.base) q -= fee; else if (f.feeAsset === 'USDT') { spent += fee; feesUsdt += fee; } else feesOther[f.feeAsset] = (feesOther[f.feeAsset] || 0) + fee;
      if (!trip) trip = { opened: f.ts, invested: 0, pnl: 0 };
      trip.invested += spent;
      qty += q; cost += spent;
    } else {
      let got = f.quote;
      if (f.feeAsset === 'USDT') { got -= fee; feesUsdt += fee; } else if (f.feeAsset !== f.base) feesOther[f.feeAsset] = (feesOther[f.feeAsset] || 0) + fee;
      const q = Math.min(f.qty, qty);
      const avg = qty > 0 ? cost / qty : f.price;
      const pnl = q > 0 ? got * (q / f.qty) - avg * q : 0;
      qty -= q; cost -= avg * q;
      sells.push({ ts: f.ts, pnl });
      if (trip) {
        trip.pnl += pnl;
        if (qty * f.price < 1) { trips.push({ ...trip, closed: f.ts }); trip = null; }
      }
    }
  }
  const openQty = qty * (lastPrice || 0) >= 1 ? qty : 0;
  return { trips, sells, feesUsdt, feesOther, openQty, avgCost: openQty ? cost / qty : null, unrealized: openQty ? openQty * lastPrice - cost : 0 };
}

export async function deskInsights(store, c, { days = 30 } = {}) {
  const cached = insightsCache.get(store)?.get(days);
  if (cached && Date.now() - cached.at < 30_000) return cached.data;
  const d = deskConfig(c.config);
  const to = today();
  const errors = [];
  const nameOf = (id) => store.getAgent(id)?.name || null;
  const out = { env: d.env, pairs: d.pairs, halted: d.halted, mode: d.mode, generatedAt: Date.now(), limits: { maxOrderUsdt: d.maxOrderUsdt, maxRiskUsdt: d.maxRiskUsdt, maxDailyLossUsdt: d.maxDailyLossUsdt, maxPositions: d.maxPositions } };

  let key = null;
  try { key = bn.parseKey(c.secretPlain); } catch (e) { errors.push(e.message); }
  if (key) {
    try {
      const s = await snapshot(store, d, key);
      out.account = { equity: r2(s.equity), dayStart: r2(s.dayStart), pnlDay: r2(s.pnlDay), usdtFree: r2(s.usdtFree), positions: s.positions };
    } catch (e) { errors.push(`conta: ${e.message}`); }
  }

  const px = d.pairs.length ? await bn.tickers24h(d.env, d.pairs).catch((e) => { errors.push(`preços: ${e.message}`); return {}; }) : {};
  const fillsByPair = {};
  if (key) {
    await Promise.all(d.pairs.map(async (par) => {
      try {
        const info = await bn.symbolInfo(d.env, par);
        const list = await bn.myTrades(d.env, key, par, 1000);
        fillsByPair[par] = list.map((t) => ({ par, base: info.base, ts: t.time, side: t.isBuyer ? 'BUY' : 'SELL', qty: +t.qty, price: +t.price, quote: +t.quoteQty, fee: +t.commission, feeAsset: t.commissionAsset, orderId: t.orderId })).sort((a, b) => a.ts - b.ts);
      } catch (e) { errors.push(`${par}: ${e.message}`); fillsByPair[par] = []; }
    }));
  }

  const allFills = Object.values(fillsByPair).flat().sort((a, b) => a.ts - b.ts);
  const oldest = shiftDay(to, -364);
  const from = days > 0 ? shiftDay(to, -(days - 1)) : (allFills[0] && dayOf(allFills[0].ts) > oldest ? dayOf(allFills[0].ts) : allFills[0] ? oldest : to);
  const inPeriod = (ts) => { const k = dayOf(ts); return k >= from && k <= to; };
  out.period = { from, to, days: Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 864e5) + 1 };

  const dayMap = new Map();
  for (let k = from; k <= to; k = shiftDay(k, 1)) dayMap.set(k, { day: k, realized: 0, volume: 0 });
  const allTrips = [], feesOther = {};
  let feesUsdt = 0;
  out.byPair = d.pairs.map((par) => {
    const fills = fillsByPair[par] || [];
    const price = px[par]?.ultimo || fills.at(-1)?.price || 0;
    const rp = replayFills(fills, price);
    const pf = fills.filter((f) => inPeriod(f.ts));
    for (const f of pf) { const row = dayMap.get(dayOf(f.ts)); if (row) row.volume += f.quote; }
    for (const s of rp.sells) if (inPeriod(s.ts)) { const row = dayMap.get(dayOf(s.ts)); if (row) row.realized += s.pnl; }
    for (const [a, v] of Object.entries(rp.feesOther)) feesOther[a] = (feesOther[a] || 0) + v;
    feesUsdt += rp.feesUsdt;
    const trips = rp.trips.filter((t) => inPeriod(t.closed)).map((t) => ({ ...t, par }));
    allTrips.push(...trips);
    const wins = trips.filter((t) => t.pnl > 0).length;
    return {
      par, price, change24h: px[par]?.variacao_pct ?? null, fills: pf.length, volume: r2(pf.reduce((t, f) => t + f.quote, 0)),
      realized: r2(rp.sells.filter((s) => inPeriod(s.ts)).reduce((t, s) => t + s.pnl, 0)), trips: trips.length, wins, winRate: trips.length ? wins / trips.length : null,
      openQty: rp.openQty, avgCost: rp.avgCost, unrealized: r2(rp.unrealized),
    };
  });
  out.days = [...dayMap.values()].map((x) => ({ day: x.day, realized: r2(x.realized), volume: r2(x.volume) }));

  const wins = allTrips.filter((t) => t.pnl > 0), losses = allTrips.filter((t) => t.pnl <= 0);
  const sum = (xs) => xs.reduce((t, x) => t + x.pnl, 0);
  const pf = allFills.filter((f) => inPeriod(f.ts));
  out.summary = {
    realized: r2(out.byPair.reduce((t, p) => t + p.realized, 0)), unrealized: r2(out.byPair.reduce((t, p) => t + p.unrealized, 0)),
    volume: r2(pf.reduce((t, f) => t + f.quote, 0)), fills: pf.length, buys: pf.filter((f) => f.side === 'BUY').length, sells: pf.filter((f) => f.side === 'SELL').length,
    trips: allTrips.length, wins: wins.length, losses: losses.length, winRate: allTrips.length ? wins.length / allTrips.length : null,
    avgWin: wins.length ? r2(sum(wins) / wins.length) : null, avgLoss: losses.length ? r2(sum(losses) / losses.length) : null,
    profitFactor: losses.length && sum(losses) < 0 ? +(sum(wins) / -sum(losses)).toFixed(2) : null,
    avgHoldMin: allTrips.length ? Math.round(allTrips.reduce((t, x) => t + (x.closed - x.opened), 0) / allTrips.length / 60_000) : null,
    feesUsdt: r2(feesUsdt), feesOther: Object.fromEntries(Object.entries(feesOther).map(([a, v]) => [a, +v.toFixed(8)])),
  };
  out.trips = allTrips.sort((a, b) => b.closed - a.closed).slice(0, 30).map((t) => ({ par: t.par, opened: t.opened, closed: t.closed, invested: r2(t.invested), pnl: r2(t.pnl), pct: t.invested ? +((t.pnl / t.invested) * 100).toFixed(2) : null }));
  out.fills = allFills.slice(-25).reverse().map((f) => ({ par: f.par, ts: f.ts, side: f.side, qty: f.qty, price: f.price, quote: r2(f.quote) }));

  const fromTs = Date.parse(`${from}T00:00:00Z`) - 12 * 3600_000;
  out.equity = (store.state.equityHistory || []).filter((p) => p.env === d.env && p.ts >= fromTs).map((p) => ({ ts: p.ts, equity: p.equity }));

  // funil da mesa (propostas criadas no período) e participação de cada agente
  const props = proposals(store).filter((p) => p.env === d.env && inPeriod(p.ts));
  const byStatus = {};
  for (const p of props) byStatus[p.status] = (byStatus[p.status] || 0) + 1;
  const reviewed = props.filter((p) => p.reviewedAt);
  const approved = props.filter((p) => ['aprovada', 'aguardando_dono', 'executada', 'falhou', 'recusada_na_execucao'].includes(p.status) || (p.reviewedAt && p.status === 'expirada' && p.aprovadaAte));
  out.funnel = {
    total: props.length, byStatus, reviewed: reviewed.length, approved: approved.length, executed: byStatus.executada || 0,
    approvalRate: reviewed.length ? approved.filter((p) => p.reviewedAt).length / reviewed.length : null,
    avgReviewMin: reviewed.length ? Math.round(reviewed.reduce((t, p) => t + (p.reviewedAt - p.ts), 0) / reviewed.length / 60_000) : null,
    avgRisk: props.length ? r2(props.reduce((t, p) => t + (p.riscoUsdt || 0), 0) / props.length) : null,
    maxRisk: props.length ? r2(Math.max(...props.map((p) => p.riscoUsdt || 0))) : null,
  };
  const ag = new Map();
  const row = (id) => { if (!id) return null; if (!ag.has(id)) ag.set(id, { id, name: nameOf(id) || id, proposed: 0, approved: 0, rejected: 0, reviewed: 0, executed: 0 }); return ag.get(id); };
  for (const p of props) {
    const a = row(p.by); a.proposed++;
    if (approved.includes(p)) a.approved++;
    if (p.status === 'recusada') a.rejected++;
    if (p.reviewedBy) row(p.reviewedBy).reviewed++;
    if (p.executedBy) row(p.executedBy).executed++;
  }
  out.agents = [...ag.values()].sort((a, b) => b.proposed + b.reviewed + b.executed - (a.proposed + a.reviewed + a.executed));
  out.errors = errors;

  if (!insightsCache.has(store)) insightsCache.set(store, new Map());
  insightsCache.get(store).set(days, { at: Date.now(), data: out });
  return out;
}

// Mercado dos pares da mesa (dados públicos): preço, variação de 24 h, RSI e a curva das últimas 48 h.
const marketCache = new Map(); // env:pares -> { at, data }
export async function deskMarket(c) {
  const d = deskConfig(c.config);
  const pairs = d.pairs.slice(0, 12);
  const k = `${d.env}:${pairs.join(',')}`;
  const cached = marketCache.get(k);
  if (cached && Date.now() - cached.at < 20_000) return cached.data;
  const tick = await bn.tickers24h(d.env, pairs);
  const rows = await Promise.all(pairs.map(async (par) => {
    const cs = await bn.klines(d.env, par, '1h', 100).catch(() => []);
    const ind = cs.length ? bn.indicators(cs) : {};
    const t = tick[par] || {};
    return {
      par, base: par.replace(/USDT$/, ''), price: t.ultimo ?? ind.ultimo ?? null, change24h: t.variacao_pct ?? null, high24h: t.maxima ?? null, low24h: t.minima ?? null, volume24h: t.volume_usdt ?? null,
      rsi14: ind.rsi14 ?? null, sma20: ind.sma20 ?? null, sma50: ind.sma50 ?? null, atrPct: ind.atr_pct ?? null, spark: cs.slice(-48).map((x) => x.c),
    };
  }));
  const data = { env: d.env, halted: d.halted, ts: Date.now(), pairs: rows };
  marketCache.set(k, { at: Date.now(), data });
  if (marketCache.size > 50) marketCache.delete(marketCache.keys().next().value);
  return data;
}
