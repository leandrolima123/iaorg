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
