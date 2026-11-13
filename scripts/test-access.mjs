// Teste rápido da regra de acesso por agente (sem chamar APIs externas).
// Uso: docker compose exec -T iaorg node scripts/test-access.mjs
import { encrypt } from '../server/secrets.js';
import { toolsFor, can, accessSummary, executeIntegrationTool } from '../server/integrations.js';

const agents = [
  { id: 'backend', kind: 'ai', name: 'Lucas', role: 'Backend', access: { github: { perms: ['read', 'pr'], resources: ['acme/api'] } } },
  { id: 'cs', kind: 'ai', name: 'Carla', role: 'CS', access: { resend: { perms: ['read', 'send'], resources: [] } } },
  { id: 'marketing', kind: 'ai', name: 'Bruno', role: 'Marketing' },
  { id: 'devops', kind: 'ai', name: 'Davi', role: 'DevOps', access: { railway: { perms: ['read', 'deploy'], resources: ['api-prod'] } } },
  { id: 'cs-chat', kind: 'ai', name: 'Cris', role: 'CS', access: { crisp: { perms: ['read', 'reply'], resources: [] } } },
];
const store = {
  state: {
    agents,
    integrations: {
      github: { connected: true, secret: encrypt('x'), account: 'acme', config: { repos: [{ fullName: 'acme/api' }, { fullName: 'acme/web' }] } },
      resend: { connected: true, secret: encrypt('x'), account: 'acme.com', config: { from: 'Suporte <suporte@acme.com>', inboxes: ['suporte@acme.com'] } },
      railway: { connected: true, secret: encrypt('x'), account: '2 projetos', config: { projects: [{ id: 'p1', name: 'api-prod' }, { id: 'p2', name: 'site' }] } },
      crisp: { connected: true, secret: encrypt('id:key'), account: 'acme', config: { websiteId: 'w1', tier: 'plugin' } },
    },
  },
  save() {},
};
const rt = { store, setStatus() {}, logEvent() {} };
const names = (a) => toolsFor(store, a).map((t) => t.name).join(', ') || '(nenhuma)';
let fail = 0;
const check = (label, ok) => { console.log(`${ok ? 'OK  ' : 'FALHOU'} ${label}`); if (!ok) fail++; };

for (const a of agents) console.log(`${a.name.padEnd(6)} → ${names(a)}`);
check('Backend tem repo_open_pr', toolsFor(store, agents[0]).some((t) => t.name === 'repo_open_pr'));
check('Backend não tem e-mail', !toolsFor(store, agents[0]).some((t) => t.name.startsWith('email_')));
check('Suporte tem email_reply', toolsFor(store, agents[1]).some((t) => t.name === 'email_reply'));
check('Suporte não tem GitHub', !can(store, agents[1], 'github', 'read'));
check('Marketing sem ferramentas externas', toolsFor(store, agents[2]).length === 0);

const out1 = await executeIntegrationTool(rt, agents[0], 'repo_read_file', { repo: 'acme/web', path: 'x' });
check('Backend barrado em repositório fora do acesso', /fora do seu acesso/.test(out1?.error || ''));
const out2 = await executeIntegrationTool(rt, agents[2], 'email_inbox_list', {});
check('Marketing barrado ao chamar e-mail mesmo assim', /não tem acesso/.test(out2?.error || ''));

const [, , , devops, chat] = agents;
check('DevOps tem railway_redeploy', toolsFor(store, devops).some((t) => t.name === 'railway_redeploy'));
check('DevOps não mexe em variáveis (sem permissão vars)', !toolsFor(store, devops).some((t) => t.name.startsWith('railway_set')));
const out3 = await executeIntegrationTool(rt, devops, 'railway_restart', { project_id: 'p2', deployment_id: 'd1', reason: 'teste' });
check('DevOps barrado no projeto "site" (só tem api-prod)', /fora do seu acesso/.test(out3?.error || ''));
check('Atendimento tem chat_reply e não chat_resolve', toolsFor(store, chat).some((t) => t.name === 'chat_reply') && !toolsFor(store, chat).some((t) => t.name === 'chat_resolve'));
const out4 = await executeIntegrationTool(rt, agents[0], 'chat_reply', { session_id: 's', text: 'oi' });
check('Backend barrado ao responder chat', /não tem acesso/.test(out4?.error || ''));

console.log('\n--- resumo no prompt do Suporte ---\n' + accessSummary(store, agents[1]));
console.log('\n--- resumo no prompt do DevOps ---\n' + accessSummary(store, devops));
process.exit(fail ? 1 : 0);
