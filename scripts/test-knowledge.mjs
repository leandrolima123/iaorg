// Teste da base de conhecimento e da ficha (sem chamar APIs).
// Uso: node scripts/test-knowledge.mjs <arquivo.md>
import fs from 'node:fs';
import { parseFile, search, documentsBlock, estimateTokens, INLINE_TOKEN_LIMIT } from '../server/knowledge.js';
import { fillVariables, profileOf, placeholdersIn } from '../server/profile.js';

const file = process.argv[2];
const chunks = parseFile(file.split('/').pop(), fs.readFileSync(file, 'utf8'));
const tokens = chunks.reduce((n, k) => n + estimateTokens(k.title + k.text), 0);
console.log(`Trechos: ${chunks.length} | ~${tokens} tokens | modo: ${tokens <= INLINE_TOKEN_LIMIT ? 'inteira no prompt' : 'busca'}`);
console.log('Primeiros títulos:', chunks.slice(0, 8).map((c) => c.title).join(' | '));

let fail = 0;
const check = (label, ok) => { console.log(`${ok ? 'OK    ' : 'FALHOU'} ${label}`); if (!ok) fail++; };
for (const [q, expect] of [
  ['esqueci minha senha', /senha|login/i],
  ['como cancelo minha assinatura', /cancel|plano/i],
  ['a transcrição da sessão não funcionou', /sess|transcri|problema/i],
  ['meus dados estão seguros? LGPD', /seguran|lgpd|privacidade/i],
]) {
  const hits = search(chunks, q, { k: 3 });
  console.log(`  "${q}" → ${hits.map((h) => h.titulo).join(' | ')}`);
  check(`busca encontra assunto certo para "${q}"`, hits.length && expect.test(hits.map((h) => h.titulo + h.texto.slice(0, 300)).join(' ')));
}

const block = documentsBlock(chunks);
check('bloco <documents> bem formado', block.startsWith('<documents>') && block.includes('<document_content>') && block.endsWith('</documents>'));

const agent = { name: 'João', role: 'CS', profile: { instructions: 'Atenda pelo {{canal}} da {{empresa}}. Escale: {{instrucao_de_escalonamento}}. {{inexistente}}', variables: { instrucao_de_escalonamento: 'use escalar_para_humano' } } };
const company = { name: 'CuidadoMental' };
const p = profileOf(agent);
const filled = fillVariables(p.instructions, { agent, company, profile: p });
console.log('  variáveis →', filled);
check('variável fixa preenchida', filled.includes('use escalar_para_humano') && filled.includes('CuidadoMental'));
check('variável dinâmica indicada', filled.includes('[canal: informado em cada mensagem recebida]'));
check('variável desconhecida removida', !filled.includes('inexistente'));
check('placeholders listados', placeholdersIn(p).join(',') === 'canal,empresa,instrucao_de_escalonamento,inexistente');
check('envio padrão em aprovação', p.sendMode.email === 'approval' && p.sendMode.chat === 'approval');
process.exit(fail ? 1 : 0);
