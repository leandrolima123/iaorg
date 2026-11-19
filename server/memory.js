// Memória de longo prazo de cada agente (o que ele aprendeu trabalhando), em Markdown.
// Fica em data/companies/<empresa>/memory/<agente>.md, com as últimas 15 versões guardadas.
import fs from 'node:fs';
import path from 'node:path';

const MAX = 40000;
const dirOf = (store) => path.join(store.dir, 'memory');
const fileOf = (store, agentId) => path.join(dirOf(store), `${String(agentId).replace(/[^\w-]/g, '')}.md`);
const histOf = (store, agentId) => path.join(dirOf(store), `${String(agentId).replace(/[^\w-]/g, '')}.history.json`);

export function readMemory(store, agentId) {
  try { return fs.readFileSync(fileOf(store, agentId), 'utf8'); } catch { return ''; }
}

export function memoryHistory(store, agentId) {
  try { return JSON.parse(fs.readFileSync(histOf(store, agentId), 'utf8')); } catch { return []; }
}

/** Salva a memória (se mudou). Devolve true quando gravou uma versão nova. */
export function writeMemory(store, agentId, text, by) {
  const next = String(text ?? '').replace(/\r\n/g, '\n').slice(0, MAX).trim();
  const prev = readMemory(store, agentId).trim();
  if (next === prev) return false;
  fs.mkdirSync(dirOf(store), { recursive: true });
  if (prev) {
    const hist = memoryHistory(store, agentId);
    hist.unshift({ ts: Date.now(), by, text: prev });
    fs.writeFileSync(histOf(store, agentId), JSON.stringify(hist.slice(0, 15)));
  }
  fs.writeFileSync(fileOf(store, agentId), next ? `${next}\n` : '');
  return true;
}

// Bloco para o prompt (vazio quando não há memória).
export function memoryBlock(store, agentId) {
  const m = readMemory(store, agentId).trim();
  return m ? `<memoria>\nO que você aprendeu em tarefas anteriores (use, e corrija se estiver desatualizado):\n${m}\n</memoria>` : '';
}

// ---------------- memória da empresa (compartilhada por todos os agentes) ----------------
// Fatos que valem para mais de uma pessoa: decisões, preferências do dono, "como a empresa faz X", resultados
// que outros vão precisar. Fica em memory/_empresa.md, com histórico como a dos agentes. Para não pesar no
// prompt, só os TÍTULOS entram no contexto; o conteúdo é lido sob demanda (ferramenta memoria_da_empresa_ler).
export const COMPANY_MEMORY_ID = '_empresa';
export const readCompanyMemory = (store) => readMemory(store, COMPANY_MEMORY_ID);

// Seções "### título" de um texto em Markdown: [{ title, body }].
export function sectionsOf(text) {
  const out = [];
  for (const part of String(text || '').split(/\n(?=### )/)) {
    const m = part.match(/^### (.+)\n?([\s\S]*)$/);
    if (m) out.push({ title: m[1].trim(), body: m[2].trim() });
  }
  return out;
}

/** Índice (títulos) para o prompt. Vazio quando não há memória da empresa. */
export function companyMemoryIndex(store, max = 40) {
  const secs = sectionsOf(readCompanyMemory(store));
  if (!secs.length) return '';
  const shown = secs.slice(-max);
  return `<memoria_da_empresa>\nMemória compartilhada da empresa (${secs.length} itens; aqui só os títulos). Antes de pesquisar, perguntar ou refazer algo, veja se já está aqui e leia com memoria_da_empresa_ler:\n${shown.map((s) => `- ${s.title}`).join('\n')}${secs.length > shown.length ? `\n- (e mais ${secs.length - shown.length} itens antigos)` : ''}\n</memoria_da_empresa>`;
}

/** Seções da memória da empresa que casam com a consulta (todas, se vazia), até maxChars. */
export function companyMemorySections(store, query = '', maxChars = 8000) {
  const secs = sectionsOf(readCompanyMemory(store));
  const words = String(query || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/\W+/).filter((w) => w.length > 2);
  const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const scored = secs.map((s) => ({ s, n: words.length ? words.filter((w) => norm(`${s.title} ${s.body}`).includes(w)).length + words.filter((w) => norm(s.title).includes(w)).length : 1 }))
    .filter((x) => x.n > 0).sort((a, b) => b.n - a.n);
  let out = ''; let used = 0;
  for (const { s } of scored) {
    const block = `### ${s.title}\n${s.body}\n\n`;
    if (used + block.length > maxChars) break;
    out += block; used += block.length;
  }
  return { total: secs.length, found: scored.length, text: out.trim() };
}

/** Acrescenta ou substitui (mesmo título) uma seção "### título" abaixo do cabeçalho H. Devolve o texto novo. */
export function upsertSection(text, header, title, block) {
  let mem = String(text || '').trim();
  if (!mem.includes(header)) mem = `${mem}\n\n${header}`.trim();
  const esc = title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`### ${esc}\\n[\\s\\S]*?(?=\\n### |\\n## |$)`);
  return re.test(mem) ? mem.replace(re, block) : mem.replace(header, `${header}\n\n${block}`);
}
