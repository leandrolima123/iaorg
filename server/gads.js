// Google Ads API (REST). Desde 9/9/2026 não existe mais developer token: o nível de acesso
// (Test, Explorer, Basic, Standard) é do projeto do Google Cloud do cliente OAuth.
// Leituras via GAQL (googleAds:search); mudanças via :mutate (sempre passam por aprovação no IAORG).
const VERSION = process.env.GOOGLE_ADS_API_VERSION || 'v26';
const BASE = `https://googleads.googleapis.com/${VERSION}`;

const cid = (id) => String(id || '').replace(/\D/g, '');

async function ga(token, method, path, body, loginCustomerId) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
      ...(loginCustomerId ? { 'login-customer-id': cid(loginCustomerId) } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(60000),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const err = data?.error || {};
    const detail = err.details?.[0]?.errors?.[0];
    const code = detail ? Object.values(detail.errorCode || {})[0] : err.status;
    let msg = detail?.message || err.message || res.statusText;
    if (/AUTHORIZATION_ERROR|PERMISSION_DENIED|NOT_ALLOWED/i.test(String(code)) && /test/i.test(msg)) {
      msg += ' (o projeto do Google Cloud ainda está no nível Test: peça o nível Explorer na página da Google Ads API no Cloud Console)';
    }
    throw new Error(`Google Ads ${res.status}${code ? ` ${code}` : ''}: ${msg}`);
  }
  return data;
}

export async function search(token, customerId, query, loginCustomerId) {
  const rows = [];
  let pageToken;
  do {
    const d = await ga(token, 'POST', `/customers/${cid(customerId)}/googleAds:search`, { query, ...(pageToken ? { pageToken } : {}) }, loginCustomerId);
    rows.push(...(d?.results || []));
    pageToken = d?.nextPageToken;
  } while (pageToken && rows.length < 2000);
  return rows;
}

/** Contas acessíveis pelo login (inclui as clientes de uma conta de administrador/MCC). */
export async function accounts(token) {
  const d = await ga(token, 'GET', '/customers:listAccessibleCustomers');
  const ids = (d?.resourceNames || []).map((r) => r.split('/')[1]);
  const out = [];
  for (const id of ids.slice(0, 20)) {
    try {
      const [r] = await search(token, id, 'SELECT customer.id, customer.descriptive_name, customer.currency_code, customer.manager, customer.test_account FROM customer LIMIT 1', id);
      const c = r?.customer || {};
      out.push({ id, name: c.descriptiveName || id, currency: c.currencyCode || '', manager: !!c.manager, test: !!c.testAccount, loginCustomerId: id });
      if (c.manager) {
        const kids = await search(token, id, 'SELECT customer_client.id, customer_client.descriptive_name, customer_client.currency_code, customer_client.manager, customer_client.level FROM customer_client WHERE customer_client.level = 1', id);
        for (const k of kids) {
          const cc = k.customerClient || {};
          if (!cc.manager) out.push({ id: String(cc.id), name: cc.descriptiveName || String(cc.id), currency: cc.currencyCode || '', manager: false, loginCustomerId: id, via: c.descriptiveName || id });
        }
      }
    } catch (e) { out.push({ id, name: id, error: e.message }); }
  }
  return out;
}

const PERIODS = ['TODAY', 'YESTERDAY', 'LAST_7_DAYS', 'LAST_14_DAYS', 'LAST_30_DAYS', 'THIS_MONTH', 'LAST_MONTH'];
const money = (micros) => Math.round((+micros || 0) / 10000) / 100;

/** Relatório pronto: campanhas, grupos de anúncio ou termos de pesquisa num período. */
export async function report(token, acc, { level = 'campaign', period = 'LAST_7_DAYS', campaignId } = {}) {
  const p = PERIODS.includes(period) ? period : 'LAST_7_DAYS';
  const metrics = 'metrics.impressions, metrics.clicks, metrics.ctr, metrics.average_cpc, metrics.cost_micros, metrics.conversions, metrics.conversions_value, metrics.cost_per_conversion';
  const where = `segments.date DURING ${p}${campaignId ? ` AND campaign.id = ${cid(campaignId)}` : ''}`;
  const q = {
    campaign: `SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, campaign_budget.amount_micros, ${metrics} FROM campaign WHERE ${where} AND campaign.status != 'REMOVED' ORDER BY metrics.cost_micros DESC LIMIT 100`,
    ad_group: `SELECT campaign.name, ad_group.id, ad_group.name, ad_group.status, ${metrics} FROM ad_group WHERE ${where} AND ad_group.status != 'REMOVED' ORDER BY metrics.cost_micros DESC LIMIT 100`,
    search_term: `SELECT campaign.name, search_term_view.search_term, search_term_view.status, ${metrics} FROM search_term_view WHERE ${where} ORDER BY metrics.cost_micros DESC LIMIT 100`,
  }[level];
  if (!q) throw new Error('Nível inválido: use campaign, ad_group ou search_term');
  const rows = await search(token, acc.customerId, q, acc.loginCustomerId);
  return rows.map((r) => {
    const m = r.metrics || {};
    return {
      ...(r.campaign ? { campanha: r.campaign.name, campaign_id: r.campaign.id, status: r.campaign.status, tipo: r.campaign.advertisingChannelType } : {}),
      ...(r.adGroup ? { grupo: r.adGroup.name, ad_group_id: r.adGroup.id, status: r.adGroup.status } : {}),
      ...(r.searchTermView ? { termo: r.searchTermView.searchTerm, status_termo: r.searchTermView.status } : {}),
      ...(r.campaignBudget ? { orcamento_diario: money(r.campaignBudget.amountMicros) } : {}),
      impressoes: +m.impressions || 0, cliques: +m.clicks || 0, ctr: Math.round((+m.ctr || 0) * 10000) / 100,
      cpc_medio: money(m.averageCpc), custo: money(m.costMicros), conversoes: Math.round((+m.conversions || 0) * 100) / 100,
      valor_conversoes: Math.round((+m.conversionsValue || 0) * 100) / 100, custo_por_conversao: money(m.costPerConversion),
    };
  });
}

/** GAQL só de leitura (para análises livres do agente). */
export async function query(token, acc, gaql) {
  const q = String(gaql || '').trim();
  if (!/^select\s/i.test(q)) throw new Error('Só consultas SELECT são permitidas.');
  const rows = await search(token, acc.customerId, /\blimit\s+\d+/i.test(q) ? q : `${q} LIMIT 200`, acc.loginCustomerId);
  return rows.slice(0, 200);
}

async function campaignInfo(token, acc, campaignId) {
  const [r] = await search(token, acc.customerId, `SELECT campaign.id, campaign.name, campaign.status, campaign.resource_name, campaign_budget.resource_name, campaign_budget.amount_micros, campaign_budget.explicitly_shared FROM campaign WHERE campaign.id = ${cid(campaignId)} LIMIT 1`, acc.loginCustomerId);
  if (!r) throw new Error(`Campanha ${campaignId} não encontrada nesta conta.`);
  return { name: r.campaign.name, status: r.campaign.status, resource: r.campaign.resourceName, budgetResource: r.campaignBudget?.resourceName, budget: money(r.campaignBudget?.amountMicros), sharedBudget: !!r.campaignBudget?.explicitlyShared };
}
export { campaignInfo };

export async function setCampaignStatus(token, acc, campaignId, status) {
  if (!['ENABLED', 'PAUSED'].includes(status)) throw new Error('Status deve ser ENABLED ou PAUSED');
  const c = await campaignInfo(token, acc, campaignId);
  await ga(token, 'POST', `/customers/${cid(acc.customerId)}/campaigns:mutate`, { operations: [{ update: { resourceName: c.resource, status }, updateMask: 'status' }] }, acc.loginCustomerId);
  return { campanha: c.name, antes: c.status, agora: status };
}

export async function setDailyBudget(token, acc, campaignId, amount) {
  const value = Number(amount);
  if (!(value > 0)) throw new Error('Orçamento diário inválido');
  const c = await campaignInfo(token, acc, campaignId);
  if (!c.budgetResource) throw new Error('A campanha não tem orçamento próprio.');
  await ga(token, 'POST', `/customers/${cid(acc.customerId)}/campaignBudgets:mutate`, { operations: [{ update: { resourceName: c.budgetResource, amountMicros: String(Math.round(value * 1e6)) }, updateMask: 'amount_micros' }] }, acc.loginCustomerId);
  return { campanha: c.name, antes: c.budget, agora: value, orcamento_compartilhado: c.sharedBudget };
}

export async function addNegativeKeyword(token, acc, campaignId, text, matchType = 'PHRASE') {
  const mt = ['EXACT', 'PHRASE', 'BROAD'].includes(matchType) ? matchType : 'PHRASE';
  const c = await campaignInfo(token, acc, campaignId);
  await ga(token, 'POST', `/customers/${cid(acc.customerId)}/campaignCriteria:mutate`, { operations: [{ create: { campaign: c.resource, negative: true, keyword: { text: String(text).slice(0, 80), matchType: mt } } }] }, acc.loginCustomerId);
  return { campanha: c.name, negativa: text, correspondencia: mt };
}
