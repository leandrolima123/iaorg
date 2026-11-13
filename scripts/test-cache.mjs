// Teste do cache do prompt fixo: grava, lê e mantém quente (gasta tokens reais — poucos centavos).
// Uso (dentro do contêiner): node scripts/test-cache.mjs <empresa> <agenteId> [--keep]
// Não grava nada no estado da empresa (save desligado).
import { allCompanies } from '../server/companies.js';
import { runtimeFor } from '../server/engine.js';
import { callClaude, warmCache, usageOf, estimateCost } from '../server/llm.js';
import { profileOf } from '../server/profile.js';

const [companyId, agentId] = process.argv.slice(2);
const store = allCompanies().find((s) => s.id === companyId || s.company.name === companyId);
if (!store) { console.error('empresa não encontrada', allCompanies().map((s) => `${s.id} (${s.company.name})`)); process.exit(1); }
store.save = () => {};
const rt = runtimeFor(store);
const agent = store.getAgent(agentId);
if (!agent) { console.error('agente não encontrado'); process.exit(1); }
const p = profileOf(agent);
const model = p.model || store.company.settings.model;
const system = rt.systemBlocks(agent);
const tools = rt.tools(agent);
console.log(`agente ${agent.name} · ${model} · blocos de sistema: ${system.map((b) => `${b.text.length} chars${b.cache_control ? ` [cache ${b.cache_control.ttl || '5m'}]` : ''}`).join(' + ')} · ${tools.length} ferramentas`);

const show = (label, u) => {
  const x = usageOf(u);
  console.log(`${label.padEnd(26)} entrada ${String(x.input).padStart(6)} | gravou ${String(x.cacheWrite).padStart(6)} (1h ${x.cacheWrite1h}) | leu ${String(x.cacheRead).padStart(6)} | saída ${x.output} | US$ ${estimateCost(x, model).toFixed(5)}`);
  return x;
};

const msg = (t) => [{ role: 'user', content: `Agora: teste de cache.\n## Novas mensagens\n- de dono: ${t}` }];
const a = await warmCache(store, { system, tools, model: p.model, effort: p.effort });
show('1. mantenedor (frio)', a.usage);
const b = await warmCache(store, { system, tools, model: p.model, effort: p.effort });
show('2. mantenedor (quente)', b.usage);
const c = await callClaude(store, { system, tools, messages: msg('teste interno de cache, não responda a ninguém e não use ferramentas; apenas diga "ok".'), model: p.model, effort: p.effort });
const x = show('3. conversa real', c.usage);
console.log(x.cacheRead > 0 ? 'OK: a conversa leu o prompt fixo do cache.' : 'FALHA: a conversa não leu do cache.');
process.exit(0);
