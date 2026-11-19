// Teste da economia de tokens (sem rede e sem custo): modelo da conversa x oficina, base enxuta,
// cache por perfil de uso, limite de trabalho pesado na conversa, corte de resultados e memória da empresa.
// Uso: node scripts/test-economy.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.DATA_DIR ||= fs.mkdtempSync(path.join(os.tmpdir(), 'iaorg-econ-'));
const { chatModelOf, jobModelOf, CHAT_DEFAULT_MODEL, sanitizeProfile } = await import('../server/profile.js');
const { INLINE_TOKEN_LIMIT } = await import('../server/knowledge.js');
const { cacheMark } = await import('../server/llm.js');
const mem = await import('../server/memory.js');
const { isLightTool, clipToolResult } = await import('../server/engine.js');

let fail = 0;
const check = (label, ok) => { console.log(`${ok ? 'OK    ' : 'FALHOU'} ${label}`); if (!ok) fail++; };

// --- modelos ---
const store = { company: { settings: { model: 'claude-sonnet-5-5' } } };
const carl = { profile: { model: 'claude-sonnet-5-5' } };
check('conversa usa o modelo barato por padrão', chatModelOf(carl, store) === CHAT_DEFAULT_MODEL && CHAT_DEFAULT_MODEL === 'claude-haiku-5-5');
check('oficina usa o modelo da ficha', jobModelOf(carl, store) === 'claude-sonnet-5-5');
check('oficina sem modelo na ficha usa o da empresa', jobModelOf({}, store) === 'claude-sonnet-5-5');
check('modelo da conversa escolhido na ficha vale', chatModelOf({ profile: { chatModel: 'claude-opus-5-5' } }, store) === 'claude-opus-5-5');
check('padrão da conversa por empresa (settings.chatModel)', chatModelOf({}, { company: { settings: { chatModel: 'claude-sonnet-5-5' } } }) === 'claude-sonnet-5-5');
const p = sanitizeProfile({ chatModel: 'claude-sonnet-5-5' }, {}, { validPeople: [], validCollections: [] });
check('ficha salva o modelo da conversa (só modelos válidos)', p.chatModel === 'claude-sonnet-5-5' && sanitizeProfile({ chatModel: 'x' }, {}, { validPeople: [], validCollections: [] }).chatModel === '');

// --- base de conhecimento e cache ---
check('base inteira no prompt só até ~6 mil tokens', INLINE_TOKEN_LIMIT === (+process.env.KB_INLINE_TOKENS || 6000));
check('cache curto (5 min) quando pedido', !cacheMark(false).ttl);
check('cache longo (1 h) por padrão', process.env.IAORG_CACHE_TTL === '5m' || cacheMark().ttl === '1h');

// --- ferramentas leves x de trabalho ---
check('falar, delegar e responder cliente são leves', ['send_message', 'create_task', 'email_reply', 'whatsapp_reply', 'chat_reply', 'gmail_send', 'memoria_da_empresa_ler'].every(isLightTool));
check('gerar imagem, publicar, relatórios e código são trabalho', ['imagem_gerar', 'social_publicar', 'social_metricas', 'ads_report', 'repo_read_file', 'railway_logs'].every((n) => !isLightTool(n)));
const big = JSON.stringify({ itens: 'x'.repeat(20000) });
const clipped = clipToolResult(big, 8000);
check('resultado longo de ferramenta é cortado com aviso', clipped.length < 8300 && /resultado cortado/.test(clipped));
check('resultado curto fica igual', clipToolResult('{"ok":true}') === '{"ok":true}');

// --- memória da empresa ---
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'iaorg-mem-'));
const fake = { dir };
check('memória da empresa começa vazia (sem índice no prompt)', mem.companyMemoryIndex(fake) === '');
let text = mem.upsertSection('# Memória da empresa', '## Fatos e decisões', 'Variáveis do Google Ads', '### Variáveis do Google Ads\n_Gustavo, 17/11_\nTodas preenchidas no Railway (api, produção).');
text = mem.upsertSection(text, '## Fatos e decisões', 'Depoimentos nas redes', '### Depoimentos nas redes\n_Leandro, 17/11_\nSem nome de paciente ou profissional sem autorização por escrito.');
mem.writeMemory(fake, mem.COMPANY_MEMORY_ID, text, 'teste');
const idx = mem.companyMemoryIndex(fake);
check('índice tem só os títulos', idx.includes('- Variáveis do Google Ads') && idx.includes('- Depoimentos nas redes') && !idx.includes('Railway (api'));
const r = mem.companyMemorySections(fake, 'google ads railway');
check('leitura por assunto devolve o item certo primeiro', r.found >= 1 && r.text.startsWith('### Variáveis do Google Ads'));
check('leitura sem assunto devolve tudo', mem.companyMemorySections(fake, '').found === 2);
const replaced = mem.upsertSection(text, '## Fatos e decisões', 'Depoimentos nas redes', '### Depoimentos nas redes\n_Leandro, 18/11_\nProibido.');
check('mesmo título substitui a versão anterior', (replaced.match(/### Depoimentos nas redes/g) || []).length === 1 && replaced.includes('Proibido.') && replaced.includes('Variáveis do Google Ads'));
check('memória da empresa guarda histórico de versões', mem.writeMemory(fake, mem.COMPANY_MEMORY_ID, replaced, 'teste') && mem.memoryHistory(fake, mem.COMPANY_MEMORY_ID).length === 1);

fs.rmSync(dir, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
