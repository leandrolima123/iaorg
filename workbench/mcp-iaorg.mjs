// Servidor MCP (stdio) com as ferramentas do IAORG: equipe, tarefas, base de conhecimento e integrações.
// Não executa nada aqui: repassa cada chamada ao IAORG (via runner), que checa permissões,
// aprovação de envio e guarda as credenciais. Nenhum segredo de integração entra no container.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';

import fs from 'node:fs';
import path from 'node:path';

const remote = JSON.parse(Buffer.from(process.env.IAORG_TOOLS_B64 || 'W10=', 'base64').toString('utf8'));
const url = process.env.IAORG_CB_URL;
const token = process.env.IAORG_JOB_TOKEN;

// Ferramentas locais de organização do arquivo da empresa (/work/entregas), para qualquer cargo.
// O IAORG reflete no arquivo real ao fim da tarefa (o que sair daqui vai para a lixeira, nunca some).
const ROOT = '/work/entregas';
const inside = (p) => {
  const full = path.resolve(ROOT, String(p || '').replace(/^\/work\/entregas\/?/, '').replace(/^\/+/, ''));
  if (full !== ROOT && !full.startsWith(`${ROOT}/`)) throw new Error('Caminho fora do arquivo da empresa (/work/entregas).');
  return full;
};
const rel = (full) => path.relative(ROOT, full) || '.';
const pruneEmpty = (dir) => { while (dir.startsWith(`${ROOT}/`) && fs.existsSync(dir) && fs.readdirSync(dir).length === 0) { fs.rmdirSync(dir); dir = path.dirname(dir); } };
const S = (description) => ({ type: 'string', description });
const LOCAL = {
  criar_pasta: {
    description: 'Cria uma pasta (e as intermediárias) no arquivo da empresa. Ex.: "Marketing/Pesquisas".',
    input_schema: { type: 'object', properties: { caminho: S('Pasta relativa ao arquivo da empresa') }, required: ['caminho'] },
    run: ({ caminho }) => { const d = inside(caminho); fs.mkdirSync(d, { recursive: true }); return { ok: true, pasta: rel(d) }; },
  },
  mover_arquivo: {
    description: 'Move ou renomeia um arquivo ou pasta do arquivo da empresa (cria as pastas de destino). Use para organizar.',
    input_schema: { type: 'object', properties: { de: S('Caminho atual'), para: S('Novo caminho (inclua o nome do arquivo)') }, required: ['de', 'para'] },
    run: ({ de, para }) => {
      const a = inside(de); const b = inside(para);
      if (!fs.existsSync(a)) throw new Error(`Não existe: ${rel(a)}`);
      if (fs.existsSync(b)) throw new Error(`Já existe algo em ${rel(b)}`);
      if (b.startsWith(`${a}/`)) throw new Error('Não dá para mover uma pasta para dentro dela mesma.');
      fs.mkdirSync(path.dirname(b), { recursive: true });
      fs.renameSync(a, b);
      pruneEmpty(path.dirname(a));
      return { ok: true, de: rel(a), para: rel(b) };
    },
  },
  apagar_arquivo: {
    description: 'Apaga um arquivo (ou pasta vazia) do arquivo da empresa. Ele vai para a lixeira do IAORG. Só apague o que é seu ou o que pediram.',
    input_schema: { type: 'object', properties: { caminho: S('Arquivo ou pasta vazia') }, required: ['caminho'] },
    run: ({ caminho }) => {
      const p = inside(caminho);
      if (p === ROOT) throw new Error('Não dá para apagar a raiz.');
      if (!fs.existsSync(p)) throw new Error(`Não existe: ${rel(p)}`);
      if (fs.statSync(p).isDirectory()) { if (fs.readdirSync(p).length) throw new Error('A pasta não está vazia: mova ou apague o conteúdo antes.'); fs.rmdirSync(p); }
      else fs.unlinkSync(p);
      pruneEmpty(path.dirname(p));
      return { ok: true, apagado: rel(p) };
    },
  },
};
const tools = [...Object.entries(LOCAL).map(([name, t]) => ({ name, description: t.description, input_schema: t.input_schema })), ...remote.filter((t) => !LOCAL[t.name])];

const server = new Server({ name: 'iaorg', version: '1.0.0' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.input_schema || { type: 'object', properties: {} } })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: input } = req.params;
  if (LOCAL[name]) {
    try { return { content: [{ type: 'text', text: JSON.stringify(LOCAL[name].run(input || {})) }] }; }
    catch (e) { return { content: [{ type: 'text', text: JSON.stringify({ error: e.message }) }], isError: true }; }
  }
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Job-Token': token },
      body: JSON.stringify({ name, input: input || {} }),
      signal: AbortSignal.timeout(120000),
    });
    const out = await res.json().catch(() => ({ error: `Resposta inválida (${res.status})` }));
    return { content: [{ type: 'text', text: JSON.stringify(out).slice(0, 60000) }], isError: !!out?.error };
  } catch (e) {
    return { content: [{ type: 'text', text: JSON.stringify({ error: `Falha ao falar com o IAORG: ${e.message}` }) }], isError: true };
  }
});

await server.connect(new StdioServerTransport());
