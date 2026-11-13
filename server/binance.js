// Binance Spot via REST (assinatura HMAC-SHA256). Só spot: sem margem, sem futuros, sem saque.
// Documentação: https://developers.binance.com/docs/binance-spot-api-docs/rest-api
import crypto from 'node:crypto';

export const ENVS = {
  testnet: { label: 'Testnet (dinheiro de teste)', base: 'https://testnet.binance.vision' },
  prod: { label: 'Produção (dinheiro real)', base: 'https://api.binance.com' },
};
const baseOf = (env) => (ENVS[env] || ENVS.testnet).base;

// Chave guardada como "apiKey:apiSecret" (mesmo formato de duas partes do Crisp).
export function parseKey(secret) {
  const i = String(secret || '').indexOf(':');
  if (i < 1) throw new Error('Informe a API Key e a Secret Key');
  return { apiKey: secret.slice(0, i).trim(), apiSecret: secret.slice(i + 1).trim() };
}

const offsets = new Map(); // diferença de relógio por ambiente (evita o erro -1021 de timestamp)
async function serverOffset(env) {
  const o = offsets.get(env);
  if (o && Date.now() - o.at < 30 * 60_000) return o.ms;
  const t0 = Date.now();
  const r = await (await fetch(`${baseOf(env)}/api/v3/time`)).json();
  const ms = r.serverTime - Math.round((t0 + Date.now()) / 2);
  offsets.set(env, { ms, at: Date.now() });
  return ms;
}

async function call(env, method, path, params = {}, key = null) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  const headers = {};
  if (key) {
    q.set('recvWindow', '10000');
    q.set('timestamp', String(Date.now() + (await serverOffset(env))));
    q.set('signature', crypto.createHmac('sha256', key.apiSecret).update(q.toString()).digest('hex'));
    headers['X-MBX-APIKEY'] = key.apiKey;
  }
  const res = await fetch(`${baseOf(env)}${path}?${q}`, { method, headers });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const e = new Error(`Binance ${res.status}${data?.code ? ` (${data.code})` : ''}: ${data?.msg || res.statusText}`);
    e.status = res.status; e.code = data?.code;
    throw e;
  }
  return data;
}

// ---------------- dados de mercado (públicos) ----------------
export const price = async (env, symbol) => +(await call(env, 'GET', '/api/v3/ticker/price', { symbol })).price;
export const prices = async (env, symbols) => {
  const list = await call(env, 'GET', '/api/v3/ticker/price', { symbols: JSON.stringify(symbols) });
  return Object.fromEntries(list.map((x) => [x.symbol, +x.price]));
};
export async function ticker24h(env, symbol) {
  const t = await call(env, 'GET', '/api/v3/ticker/24hr', { symbol });
  return { ultimo: +t.lastPrice, variacao_pct: +t.priceChangePercent, maxima: +t.highPrice, minima: +t.lowPrice, volume_base: +t.volume, volume_usdt: +t.quoteVolume };
}
export async function tickers24h(env, symbols) {
  if (!symbols.length) return {};
  const list = await call(env, 'GET', '/api/v3/ticker/24hr', { symbols: JSON.stringify(symbols) });
  return Object.fromEntries(list.map((t) => [t.symbol, { ultimo: +t.lastPrice, variacao_pct: +t.priceChangePercent, maxima: +t.highPrice, minima: +t.lowPrice, volume_usdt: +t.quoteVolume }]));
}
export async function klines(env, symbol, interval = '1h', limit = 100) {
  const k = await call(env, 'GET', '/api/v3/klines', { symbol, interval, limit: Math.min(Math.max(limit, 1), 500) });
  return k.map((c) => ({ t: c[0], o: +c[1], h: +c[2], l: +c[3], c: +c[4], v: +c[5] }));
}
export async function orderbook(env, symbol, limit = 20) {
  const d = await call(env, 'GET', '/api/v3/depth', { symbol, limit });
  return { compras: d.bids.slice(0, limit).map(([p, q]) => [+p, +q]), vendas: d.asks.slice(0, limit).map(([p, q]) => [+p, +q]) };
}

// Pares em USDT negociados no ambiente, do maior para o menor volume em 24 h (para o seletor da tela).
const pairsCache = new Map(); // env -> { at, list }
export async function usdtPairs(env) {
  const c = pairsCache.get(env);
  if (c && Date.now() - c.at < 10 * 60_000) return c.list;
  const all = await call(env, 'GET', '/api/v3/ticker/24hr', { type: 'MINI' });
  const list = all
    .filter((t) => t.symbol.endsWith('USDT') && +t.quoteVolume > 0)
    .map((t) => ({ symbol: t.symbol, base: t.symbol.slice(0, -4), volumeUsdt: Math.round(+t.quoteVolume), price: +t.lastPrice }))
    .sort((a, b) => b.volumeUsdt - a.volumeUsdt);
  pairsCache.set(env, { at: Date.now(), list });
  return list;
}

const infoCache = new Map(); // env:symbol -> { at, info }
export async function symbolInfo(env, symbol) {
  const k = `${env}:${symbol}`;
  const c = infoCache.get(k);
  if (c && Date.now() - c.at < 6 * 3600_000) return c.info;
  const r = await call(env, 'GET', '/api/v3/exchangeInfo', { symbol });
  const s = r.symbols?.[0];
  if (!s) throw new Error(`Par ${symbol} não existe na Binance`);
  const f = Object.fromEntries(s.filters.map((x) => [x.filterType, x]));
  const info = {
    symbol: s.symbol, status: s.status, base: s.baseAsset, quote: s.quoteAsset, orderTypes: s.orderTypes, ocoAllowed: !!s.ocoAllowed,
    stepSize: +(f.LOT_SIZE?.stepSize || 0), minQty: +(f.LOT_SIZE?.minQty || 0),
    tickSize: +(f.PRICE_FILTER?.tickSize || 0),
    minNotional: +(f.NOTIONAL?.minNotional || f.MIN_NOTIONAL?.minNotional || 0),
  };
  infoCache.set(k, { at: Date.now(), info });
  return info;
}

// Arredonda para baixo no passo da Binance (stepSize/tickSize) e devolve texto sem notação científica.
export function floorTo(v, step) {
  if (!step) return String(v);
  const dec = Math.max(0, Math.round(-Math.log10(step)));
  const n = Math.floor(v / step + 1e-9) * step;
  return n.toFixed(dec);
}

// ---------------- indicadores (para o analista não fazer conta de cabeça) ----------------
const sma = (xs, n) => (xs.length >= n ? xs.slice(-n).reduce((a, b) => a + b, 0) / n : null);
function rsi(closes, n = 14) {
  if (closes.length <= n) return null;
  let g = 0, l = 0;
  for (let i = 1; i <= n; i++) { const d = closes[i] - closes[i - 1]; if (d >= 0) g += d; else l -= d; }
  g /= n; l /= n;
  for (let i = n + 1; i < closes.length; i++) { const d = closes[i] - closes[i - 1]; g = (g * (n - 1) + Math.max(d, 0)) / n; l = (l * (n - 1) + Math.max(-d, 0)) / n; }
  return l === 0 ? 100 : 100 - 100 / (1 + g / l);
}
function atr(cs, n = 14) {
  if (cs.length <= n) return null;
  const tr = cs.slice(1).map((c, i) => Math.max(c.h - c.l, Math.abs(c.h - cs[i].c), Math.abs(c.l - cs[i].c)));
  let a = tr.slice(0, n).reduce((x, y) => x + y, 0) / n;
  for (let i = n; i < tr.length; i++) a = (a * (n - 1) + tr[i]) / n;
  return a;
}
const r = (v, d = 4) => (v == null ? null : +Number(v).toFixed(d));
export function indicators(cs) {
  const closes = cs.map((c) => c.c);
  const last = closes.at(-1);
  const hi = Math.max(...cs.slice(-20).map((c) => c.h));
  const lo = Math.min(...cs.slice(-20).map((c) => c.l));
  const a = atr(cs);
  return { ultimo: last, sma20: r(sma(closes, 20)), sma50: r(sma(closes, 50)), sma200: r(sma(closes, 200)), rsi14: r(rsi(closes), 1), atr14: r(a), atr_pct: a ? r((a / last) * 100, 2) : null, maxima_20: hi, minima_20: lo };
}

// ---------------- conta e ordens (assinadas) ----------------
export async function account(env, key) {
  const a = await call(env, 'GET', '/api/v3/account', { omitZeroBalances: 'true' }, key);
  return { canTrade: a.canTrade, canWithdraw: a.canWithdraw, permissions: a.permissions || [], balances: (a.balances || []).map((b) => ({ asset: b.asset, free: +b.free, locked: +b.locked })).filter((b) => b.free + b.locked > 0) };
}
// Restrições da própria chave (só existe em produção): a IAORG recusa chave com saque liberado.
export async function apiRestrictions(env, key) {
  if (env !== 'prod') return null;
  return call(env, 'GET', '/sapi/v1/account/apiRestrictions', {}, key);
}
export const openOrders = (env, key, symbol) => call(env, 'GET', '/api/v3/openOrders', symbol ? { symbol } : {}, key);
export const myTrades = (env, key, symbol, limit = 20) => call(env, 'GET', '/api/v3/myTrades', { symbol, limit: Math.min(Math.max(limit, 1), 1000) }, key);
export const cancelOrder = (env, key, symbol, orderId) => call(env, 'DELETE', '/api/v3/order', { symbol, orderId }, key);
export const cancelOrderList = (env, key, symbol, orderListId) => call(env, 'DELETE', '/api/v3/orderList', { symbol, orderListId }, key);

export const marketBuy = (env, key, symbol, quoteQty) => call(env, 'POST', '/api/v3/order', { symbol, side: 'BUY', type: 'MARKET', quoteOrderQty: quoteQty, newOrderRespType: 'FULL' }, key);
export const marketSell = (env, key, symbol, quantity) => call(env, 'POST', '/api/v3/order', { symbol, side: 'SELL', type: 'MARKET', quantity, newOrderRespType: 'FULL' }, key);

// Proteção de uma compra: stop (e alvo, se houver) numa OCO de venda; sem alvo, só o stop.
// O stop é a mercado (STOP_LOSS) quando o par aceita, para garantir a saída; senão STOP_LOSS_LIMIT com folga de 0,5%.
export async function protect(env, key, info, { quantity, stop, target }) {
  const stopP = floorTo(stop, info.tickSize);
  const marketStop = info.orderTypes.includes('STOP_LOSS');
  const limitP = floorTo(stop * 0.995, info.tickSize);
  if (target) {
    return call(env, 'POST', '/api/v3/orderList/oco', {
      symbol: info.symbol, side: 'SELL', quantity,
      aboveType: 'LIMIT_MAKER', abovePrice: floorTo(target, info.tickSize),
      belowType: marketStop ? 'STOP_LOSS' : 'STOP_LOSS_LIMIT', belowStopPrice: stopP,
      ...(marketStop ? {} : { belowPrice: limitP, belowTimeInForce: 'GTC' }),
      newOrderRespType: 'RESULT',
    }, key);
  }
  return call(env, 'POST', '/api/v3/order', {
    symbol: info.symbol, side: 'SELL', quantity, type: marketStop ? 'STOP_LOSS' : 'STOP_LOSS_LIMIT', stopPrice: stopP,
    ...(marketStop ? {} : { price: limitP, timeInForce: 'GTC' }), newOrderRespType: 'RESULT',
  }, key);
}

// Valida a chave: lê a conta, exige permissão de spot e recusa chave com saque liberado.
export async function verify(env, key) {
  const acc = await account(env, key);
  if (!acc.canTrade) throw new Error('A chave não tem permissão de negociar no spot (ative "Enable Spot & Margin Trading").');
  const rest = await apiRestrictions(env, key).catch((e) => { throw new Error(`Não consegui conferir as permissões da chave: ${e.message}`); });
  if (rest?.enableWithdrawals) throw new Error('Esta chave permite SAQUE. Por segurança o IAORG não aceita: crie outra chave sem "Enable Withdrawals".');
  if (rest?.enableMargin || rest?.enableFutures) throw new Error('Esta chave tem margem ou futuros liberados. Use uma chave só de spot.');
  return { balances: acc.balances, ipRestrict: rest?.ipRestrict ?? null };
}
