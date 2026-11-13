// Base de conhecimento da empresa: coleções de trechos (chunks), importação e busca.
// Estratégia (guia da Anthropic sobre Contextual Retrieval): base pequena vai INTEIRA no prompt,
// com cache; quando passa do limite, o agente usa a ferramenta de busca (BM25 sobre título,
// perguntas típicas e texto) e recebe os trechos mais relevantes.
import { uid } from './companies.js';

export const INLINE_TOKEN_LIMIT = +process.env.KB_INLINE_TOKENS || 60000;
export const estimateTokens = (text) => Math.ceil(String(text || '').length / 3.6);

const ensure = (store) => (store.state.knowledge ||= { collections: [] });
export const collections = (store) => ensure(store).collections;
export const getCollection = (store, id) => collections(store).find((c) => c.id === id);

// ---------------- importação ----------------
function parseFrontmatter(src) {
  const m = String(src).match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  if (!m) return { meta: {}, body: String(src) };
  const meta = {};
  let lastKey = null;
  for (const line of m[1].split('\n')) {
    const kv = line.match(/^([\w-]+):\s*(.*)$/);
    if (kv) {
      lastKey = kv[1].toLowerCase();
      let v = kv[2].trim();
      if (/^\[.*\]$/.test(v)) v = v.slice(1, -1).split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
      else v = v.replace(/^["']|["']$/g, '');
      meta[lastKey] = v === '' ? [] : v;
    } else if (lastKey && /^\s*-\s+/.test(line)) {
      if (!Array.isArray(meta[lastKey])) meta[lastKey] = meta[lastKey] ? [meta[lastKey]] : [];
      meta[lastKey].push(line.replace(/^\s*-\s+/, '').trim().replace(/^["']|["']$/g, ''));
    }
  }
  return { meta, body: src.slice(m[0].length) };
}

const asList = (v) => (Array.isArray(v) ? v : v ? String(v).split(/\s*[;|]\s*/) : []).map(String).filter(Boolean);

function chunk({ id, title, category, plans, questions, text, source }) {
  return {
    id: String(id || uid('k')).slice(0, 80),
    title: String(title || '').trim().slice(0, 200) || '(sem título)',
    category: String(category || '').trim().slice(0, 60),
    plans: asList(plans).slice(0, 10),
    questions: asList(questions).slice(0, 20),
    text: String(text || '').trim().slice(0, 12000),
    source: String(source || '').slice(0, 120),
  };
}

// Divide um Markdown em trechos pelos títulos "##" (cada "##" vira um trecho; "###" fica dentro).
function splitMarkdown(body, source, meta = {}) {
  const lines = String(body).split('\n');
  const out = [];
  let cur = null;
  let preface = [];
  for (const line of lines) {
    const h = line.match(/^##\s+(.+)$/);
    if (h) {
      if (cur) out.push(cur);
      cur = { title: h[1].replace(/^\d+(\.\d+)*\.?\s*/, '').trim(), lines: [] };
    } else if (cur) cur.lines.push(line);
    else preface.push(line);
  }
  if (cur) out.push(cur);
  const pre = preface.join('\n').replace(/^#\s+.*$/m, '').trim();
  const res = out.map((c, i) => chunk({
    id: `${source.replace(/\W+/g, '-')}-${i + 1}`, title: c.title, category: meta.categoria || meta.category,
    questions: meta.perguntas || meta.questions, plans: meta.planos || meta.plans, text: c.lines.join('\n'), source,
  })).filter((c) => c.text.length > 20);
  if (pre.length > 40) res.unshift(chunk({ id: `${source.replace(/\W+/g, '-')}-0`, title: meta.titulo || meta.title || 'Visão geral', text: pre, source }));
  return res;
}

// Aceita .jsonl (um trecho por linha), .md (com ou sem frontmatter) e .txt.
export function parseFile(name, content) {
  const ext = String(name).toLowerCase().split('.').pop();
  if (ext === 'jsonl' || ext === 'ndjson') {
    return String(content).split('\n').map((l) => l.trim()).filter(Boolean).map((l, i) => {
      const o = JSON.parse(l);
      return chunk({
        id: o.id || `${name}-${i + 1}`, title: o.titulo || o.title, category: o.categoria || o.category,
        plans: o.planos || o.plans, questions: o.perguntas || o.questions, text: o.texto || o.text || o.content, source: name,
      });
    });
  }
  if (ext === 'md' || ext === 'markdown') {
    const { meta, body } = parseFrontmatter(content);
    // Arquivo com frontmatter de trecho (ex.: rag/*.md): é UM trecho só.
    if (meta.id || meta.categoria || meta.category) {
      const title = meta.titulo || meta.title || (body.match(/^#{1,3}\s+(.+)$/m)?.[1]) || name;
      return [chunk({ id: meta.id || name, title, category: meta.categoria || meta.category, plans: meta.planos || meta.plans, questions: meta.perguntas || meta.questions, text: body.replace(/^#{1,3}\s+.+\n/, ''), source: name })];
    }
    return splitMarkdown(body, name, meta);
  }
  // .txt: blocos de ~1.500 caracteres separados por linha em branco
  const paras = String(content).split(/\n\s*\n/);
  const out = [];
  let buf = '';
  for (const p of paras) {
    if ((buf + '\n\n' + p).length > 1500 && buf) { out.push(buf); buf = p; } else buf = buf ? `${buf}\n\n${p}` : p;
  }
  if (buf.trim()) out.push(buf);
  return out.map((t, i) => chunk({ id: `${name}-${i + 1}`, title: `${name} (parte ${i + 1})`, text: t, source: name }));
}

export function addCollection(store, { name, files }) {
  const chunks = [];
  const errors = [];
  for (const f of files) {
    try { chunks.push(...parseFile(f.name, f.content)); } catch (e) { errors.push(`${f.name}: ${e.message}`); }
  }
  if (!chunks.length) throw new Error(errors[0] || 'Nenhum trecho encontrado nos arquivos.');
  const ids = new Set();
  for (const c of chunks) { while (ids.has(c.id)) c.id += '-b'; ids.add(c.id); }
  const col = { id: uid('kb'), name: String(name || files[0]?.name || 'Base').slice(0, 80), createdAt: Date.now(), updatedAt: Date.now(), files: files.map((f) => f.name), chunks };
  collections(store).push(col);
  store.save();
  return { collection: col, errors };
}

export function replaceCollection(store, id, { files, name }) {
  const col = getCollection(store, id);
  if (!col) throw new Error('Coleção não encontrada');
  const { collection: fresh, errors } = addCollection(store, { name: name || col.name, files });
  // mantém o id (os agentes continuam apontando para ela)
  const list = collections(store);
  list.splice(list.indexOf(fresh), 1);
  Object.assign(col, { chunks: fresh.chunks, files: fresh.files, name: fresh.name, updatedAt: Date.now() });
  store.save();
  return { collection: col, errors };
}

export const collectionSummary = (c) => ({
  id: c.id, name: c.name, files: c.files, chunks: c.chunks.length, updatedAt: c.updatedAt,
  tokens: c.chunks.reduce((n, k) => n + estimateTokens(k.title + k.text + k.questions.join(' ')), 0),
  categories: [...new Set(c.chunks.map((k) => k.category).filter(Boolean))],
});

// ---------------- conhecimento de um agente ----------------
export function agentChunks(store, agent) {
  const ids = agent.profile?.knowledge || [];
  return collections(store).filter((c) => ids.includes(c.id)).flatMap((c) => c.chunks.map((k) => ({ ...k, collection: c.name })));
}

export function knowledgeMode(store, agent) {
  const chunks = agentChunks(store, agent);
  if (!chunks.length) return { mode: 'none', chunks, tokens: 0 };
  const tokens = chunks.reduce((n, k) => n + estimateTokens(k.title + k.text + k.questions.join(' ')), 0);
  return { mode: tokens <= INLINE_TOKEN_LIMIT ? 'inline' : 'search', chunks, tokens };
}

// Bloco <documents> para o topo do prompt (formato recomendado para documentos longos).
export function documentsBlock(chunks) {
  return `<documents>\n${chunks.map((k, i) => `<document index="${i + 1}">
<source>${k.title}${k.category ? ` · categoria: ${k.category}` : ''}${k.plans.length ? ` · planos: ${k.plans.join(', ')}` : ''}</source>
${k.questions.length ? `<perguntas_tipicas>${k.questions.join(' | ')}</perguntas_tipicas>\n` : ''}<document_content>
${k.text}
</document_content>
</document>`).join('\n')}\n</documents>`;
}

// ---------------- busca BM25 ----------------
const STOP = new Set('a o e de da do das dos em no na nos nas um uma uns umas para por com sem que se como é ou ao aos à às mais meu minha seu sua eu você voce não nao sim isso esta este essa esse foi ser ter tem há já ja qual quais quando onde'.split(' '));
const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const tokenize = (s) => norm(s).split(/[^a-z0-9]+/).filter((t) => t.length > 1 && !STOP.has(t));

export function search(chunks, query, { category, k = 6 } = {}) {
  const pool = category ? chunks.filter((c) => norm(c.category) === norm(category)) : chunks;
  if (!pool.length) return [];
  // título e perguntas típicas pesam mais (é como o cliente pergunta)
  const docs = pool.map((c) => tokenize(`${c.title} ${c.title} ${c.questions.join(' ')} ${c.questions.join(' ')} ${c.category} ${c.text}`));
  const avg = docs.reduce((n, d) => n + d.length, 0) / docs.length;
  const df = new Map();
  for (const d of docs) for (const t of new Set(d)) df.set(t, (df.get(t) || 0) + 1);
  const q = [...new Set(tokenize(query))];
  const k1 = 1.4; const b = 0.75; const N = docs.length;
  const scored = docs.map((d, i) => {
    const tf = new Map();
    for (const t of d) tf.set(t, (tf.get(t) || 0) + 1);
    let s = 0;
    for (const t of q) {
      const f = tf.get(t);
      if (!f) continue;
      const idf = Math.log(1 + (N - df.get(t) + 0.5) / (df.get(t) + 0.5));
      s += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.length) / avg)));
    }
    return { c: pool[i], s };
  }).filter((x) => x.s > 0).sort((x, y) => y.s - x.s);
  return scored.slice(0, k).map(({ c, s }) => ({ id: c.id, titulo: c.title, categoria: c.category, planos: c.plans, texto: c.text, relevancia: +s.toFixed(2) }));
}
