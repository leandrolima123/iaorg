// Teste da oficina (sem gastar tokens): kits por designação, prompts e proteções.
// Uso (dentro do container do app): node scripts/test-workbench.mjs
import { allCompanies } from '../server/companies.js';
import { runtimeFor } from '../server/engine.js';
import { kitsFor, enabled } from '../server/workbench.js';
import { profileOf, workshopOf, verifyHint } from '../server/profile.js';
import { readMemory } from '../server/memory.js';

let fail = 0;
const check = (label, ok) => { console.log(`${ok ? 'OK    ' : 'FALHOU'} ${label}`); if (!ok) fail++; };

check('oficina configurada (RUNNER_URL e RUNNER_TOKEN)', enabled());
const w = workshopOf({ code: { repo: 'x/y' } });
check('ficha da oficina com padrões', w.maxTurns === 60 && w.code.autoMerge === true && w.code.repo === 'x/y');
check('verificação sugerida por cargo', /testes/.test(verifyHint({ role: 'Backend', title: '' })) && /fontes/.test(verifyHint({ role: 'Marketing', title: '' })));

for (const store of allCompanies()) {
  const rt = runtimeFor(store);
  for (const a of store.aiAgents()) {
    const kits = kitsFor(store, a);
    const job = rt.systemPrompt(a, { mode: 'job' });
    const chat = rt.systemPrompt(a);
    console.log(`  ${store.company.name} · ${a.name} (${a.role}) → código: ${kits.code?.repo || '—'} · pesquisa: ${kits.research} · navegador: ${kits.browser}`);
    check(`${a.name}: prompt da oficina com plano, verificação e memória`, job.includes('OFICINA') && job.includes('Verificação exigida') && job.includes('/work/MEMORY.md'));
    check(`${a.name}: prompt da oficina proíbe push`, !kits.code || job.includes('NÃO faça push'));
    check(`${a.name}: conversa rápida usa a memória`, !readMemory(store, a.id).trim() || chat.includes('<memoria>'));
    check(`${a.name}: verificação da ficha ou sugestão do cargo`, job.includes(profileOf(a).workshop.verify || verifyHint(a)));
  }
}
process.exit(fail ? 1 : 0);
