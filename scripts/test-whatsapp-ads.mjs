// Teste do WhatsApp (Kapso) e do Google Ads sem rede: fetch falso que imita as APIs e confere o que o IAORG envia.
// Uso (dentro do container do app): node scripts/test-whatsapp-ads.mjs
import { encrypt } from '../server/secrets.js';
import * as kapso from '../server/kapso.js';
import * as gads from '../server/gads.js';
import { executeIntegrationTool, approve, toolsFor } from '../server/integrations.js';

let fail = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? 'OK    ' : 'FALHOU'} ${label}${extra ? ` → ${extra}` : ''}`); if (!ok) fail++; };
const calls = [];
const now = Math.floor(Date.now() / 1000);
let inboundTs = now - 3600; // última mensagem do cliente há 1 h (janela aberta)

globalThis.fetch = async (url, opts = {}) => {
  const body = opts.body ? JSON.parse(opts.body) : null;
  calls.push({ url: String(url), method: opts.method, headers: opts.headers, body });
  const ok = (data) => ({ ok: true, status: 200, json: async () => data });
  const u = String(url);
  // ---- Kapso ----
  if (u.includes('/platform/v1/whatsapp/phone_numbers')) return ok({ data: [{ phone_number_id: '111', display_phone_number: '+55 11 4000-0000', verified_name: 'Cuidado Mental' }] });
  if (u.includes('/platform/v1/whatsapp/messages')) {
    return ok({ data: [
      { id: 'wamid.2', timestamp: String(inboundTs), type: 'text', from: '5511988887777', text: { body: 'Quero mudar de plano' }, kapso: { direction: 'inbound', phone_number: '5511988887777', contact_name: 'Carla' } },
      { id: 'wamid.1', timestamp: String(now - 7200), type: 'text', to: '5511988887777', text: { body: 'Olá! Como posso ajudar?' }, kapso: { direction: 'outbound', phone_number: '5511988887777' } },
    ] });
  }
  if (u.includes('/meta/whatsapp/v24.0/111/messages')) return ok(body?.status === 'read' ? { success: true } : { messages: [{ id: 'wamid.sent' }] });
  // ---- Google Ads ----
  if (u.endsWith('/customers:listAccessibleCustomers')) return ok({ resourceNames: ['customers/9990001111'] });
  if (u.includes('/googleAds:search')) {
    const q = body.query;
    if (q.includes('FROM customer_client')) return ok({ results: [{ customerClient: { id: '1234567890', descriptiveName: 'Cuidado Mental Ads', currencyCode: 'BRL', manager: false, level: 1 } }] });
    if (q.includes('FROM customer ')) return ok({ results: [{ customer: { id: '9990001111', descriptiveName: 'Agência MCC', currencyCode: 'BRL', manager: true } }] });
    if (q.includes('campaign_budget.explicitly_shared')) return ok({ results: [{ campaign: { id: '42', name: 'Busca Marca', status: 'ENABLED', resourceName: 'customers/1234567890/campaigns/42' }, campaignBudget: { resourceName: 'customers/1234567890/campaignBudgets/7', amountMicros: '30000000', explicitlyShared: false } }] });
    if (q.includes('FROM campaign')) return ok({ results: [{ campaign: { id: '42', name: 'Busca Marca', status: 'ENABLED', advertisingChannelType: 'SEARCH' }, campaignBudget: { amountMicros: '30000000' }, metrics: { impressions: '1000', clicks: '80', ctr: 0.08, averageCpc: '1500000', costMicros: '120000000', conversions: 6, conversionsValue: 0, costPerConversion: '20000000' } }] });
  }
  if (u.includes(':mutate')) return ok({ results: [{ resourceName: 'ok' }] });
  return { ok: false, status: 404, json: async () => ({ error: { message: `rota não simulada: ${u}` } }) };
};

// ---------- Kapso (módulo) ----------
const v = await kapso.verify('chave-teste');
check('Kapso: valida a chave e escolhe o número', v.number.id === '111' && v.number.display.includes('4000'));
const msgs = await kapso.messages('chave-teste', '111', { phone: '+55 (11) 98888-7777' });
check('Kapso: lista mensagens com telefone só em dígitos', calls.at(-1).url.includes('phone_number=5511988887777') && calls.at(-1).headers['X-API-Key'] === 'chave-teste');
check('Kapso: normaliza direção, nome e texto', msgs[0].direction === 'inbound' && msgs[0].name === 'Carla' && msgs[0].text === 'Quero mudar de plano');

// ---------- Google Ads (módulo) ----------
const accs = await gads.accounts('tok');
check('Ads: conta de administrador lista as contas abaixo dela', accs.some((a) => a.manager) && accs.some((a) => a.id === '1234567890' && a.loginCustomerId === '9990001111'));
const acc = { customerId: '1234567890', loginCustomerId: '9990001111', currency: 'BRL' };
const rep = await gads.report('tok', acc, { level: 'campaign', period: 'LAST_30_DAYS' });
const last = calls.findLast((c) => c.url.includes('googleAds:search'));
check('Ads: relatório usa GAQL com o período e o cabeçalho login-customer-id', last.body.query.includes('DURING LAST_30_DAYS') && last.headers['login-customer-id'] === '9990001111');
check('Ads: converte micros para a moeda (custo 120, CPC 1,5, CPA 20)', rep[0].custo === 120 && rep[0].cpc_medio === 1.5 && rep[0].custo_por_conversao === 20 && rep[0].ctr === 8);
let blocked = false;
try { await gads.query('tok', acc, 'DELETE FROM campaign'); } catch { blocked = true; }
check('Ads: consulta livre só aceita SELECT', blocked);

// ---------- Ferramentas dos agentes, permissões e aprovação ----------
const agent = { id: 'mkt', name: 'Ana', role: 'Marketing', kind: 'ai', access: { whatsapp: { perms: ['read', 'reply'], resources: [] }, google_ads: { perms: ['read', 'manage'], resources: [] } }, profile: { sendMode: { whatsapp: 'auto' } } };
const owner = { id: 'dono', name: 'Leandro', kind: 'human', appRole: 'owner' };
const store = {
  id: 't', company: { name: 'Teste' },
  state: {
    agents: [agent, owner], approvals: [],
    integrations: {
      whatsapp: { connected: true, secret: encrypt('chave-teste'), account: '+55 11 4000-0000', config: { phoneNumberId: '111' } },
      google_ads: { connected: true, secret: encrypt(JSON.stringify({ accessToken: 'tok', expiresAt: Date.now() + 3600e3 })), account: 'x@y', config: { customerId: '1234567890', loginCustomerId: '9990001111', name: 'Cuidado Mental Ads', currency: 'BRL' } },
    },
  },
  save() {}, getAgent(id) { return this.state.agents.find((a) => a.id === id); }, aiAgents() { return [agent]; }, owner() { return owner; },
};
const events = [];
const rt = { store, logEvent: (t, a, txt) => events.push(txt), emit() {}, pushSnapshot() {}, setStatus() {} };

const names = toolsFor(store, agent).map((t) => t.name);
check('Ferramentas aparecem conforme as permissões', ['whatsapp_recent', 'whatsapp_messages', 'whatsapp_reply', 'ads_report', 'ads_query', 'ads_set_budget'].every((n) => names.includes(n)));
check('Sem permissão de ajustar: não recebe ferramentas de mudança', !toolsFor(store, { ...agent, access: { google_ads: { perms: ['read'] } } }).some((t) => t.name.startsWith('ads_set')));

const sent = await executeIntegrationTool(rt, agent, 'whatsapp_reply', { telefone: '5511988887777', text: 'Claro! Vou te ajudar.' });
const send = calls.find((c) => c.url.endsWith('/111/messages') && c.body?.type === 'text');
check('WhatsApp: responde (modo automático) no formato da Cloud API', sent.ok && send?.body.to === '5511988887777' && send.body.text.body.startsWith('Claro'));
check('WhatsApp: marca a mensagem do cliente como lida', calls.some((c) => c.body?.status === 'read' && c.body.message_id === 'wamid.2'));

inboundTs = now - 25 * 3600; // janela fechada
const closed = await executeIntegrationTool(rt, agent, 'whatsapp_reply', { telefone: '5511988887777', text: 'Oi' });
check('WhatsApp: recusa texto livre com a janela de 24 h fechada', !!closed.error && /24 h/.test(closed.error));
inboundTs = now - 3600;

const agentApproval = { ...agent, profile: { sendMode: { whatsapp: 'approval' } } };
const draft = await executeIntegrationTool(rt, agentApproval, 'whatsapp_reply', { telefone: '5511988887777', text: 'Rascunho' });
check('WhatsApp: no modo rascunho vai para Aprovações com a conversa', draft.aguardando_aprovacao && store.state.approvals.at(-1).channel === 'whatsapp' && /Cliente: Quero mudar/.test(store.state.approvals.at(-1).preview.conversa));

const before = calls.filter((c) => c.url.includes(':mutate')).length;
const q = await executeIntegrationTool(rt, agent, 'ads_set_budget', { campaign_id: '42', daily_budget: 45, reason: 'CPA 20 abaixo da meta 30' });
check('Ads: mudança de orçamento NÃO é aplicada sem aprovação', q.aguardando_aprovacao && calls.filter((c) => c.url.includes(':mutate')).length === before);
const item = store.state.approvals.at(-1);
check('Ads: aprovação mostra o resumo e a campanha atual', item.channel === 'ads' && item.readOnlyText && /45/.test(item.text) && /Busca Marca/.test(item.preview.assunto));
const noReason = await executeIntegrationTool(rt, agent, 'ads_campaign_status', { campaign_id: '42', status: 'PAUSED' });
check('Ads: exige motivo para pedir mudança', !!noReason.error);
await approve(rt, item, { text: 'tentativa de editar', byName: 'Leandro' });
const mut = calls.findLast((c) => c.url.includes('campaignBudgets:mutate'));
check('Ads: depois de aprovado, aplica o orçamento certo (45 → 45000000 micros)', mut?.body.operations[0].update.amountMicros === '45000000' && mut.body.operations[0].updateMask === 'amount_micros');
check('Ads: registra no diário com antes e depois', events.some((e) => /de 30 para 45/.test(e)));

process.exit(fail ? 1 : 0);
