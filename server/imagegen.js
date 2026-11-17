// Geração e edição de imagens com IA: OpenAI (GPT Image) e Google Gemini (Nano Banana).
// Cada empresa usa a própria chave. O modelo é escolhido entre os que a chave enxerga (ou o informado em Integrações).
const OPENAI = 'https://api.openai.com/v1';
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';

// Formatos pensados para redes sociais.
export const FORMATS = {
  quadrado: { ratio: '1:1', size: '1024x1024', exact: '1024x1024', label: 'Quadrado 1:1 (feed)' },
  retrato: { ratio: '4:5', size: '1024x1536', exact: '1024x1280', label: 'Retrato 4:5 (feed do Instagram)' },
  story: { ratio: '9:16', size: '1024x1536', exact: '864x1536', label: 'Vertical 9:16 (stories, reels)' },
  paisagem: { ratio: '16:9', size: '1536x1024', exact: '1536x864', label: 'Paisagem 16:9 (LinkedIn, Facebook, site)' },
};

const OPENAI_PREF = ['gpt-image-2.6-flare', 'gpt-image-2.6-sunburst', 'gpt-image-2.5-flare', 'gpt-image-2.5-sunburst', 'gpt-image-2', 'gpt-image-1.5', 'gpt-image-1', 'gpt-image-1-mini'];
const GEMINI_PREF = ['gemini-nano-banana-2.1', 'gemini-3.1-flash-image', 'gemini-3-pro-image', 'gemini-2.5-flash-image'];

const pick = (available, pref) => pref.find((p) => available.includes(p)) || pref.map((p) => available.find((a) => a.startsWith(p))).find(Boolean) || available[0] || null;

async function req(url, { key, provider, method = 'POST', json, form, headers = {} }) {
  const auth = provider === 'openai' ? { Authorization: `Bearer ${key}` } : { 'x-goog-api-key': key };
  const res = await fetch(url, {
    method,
    headers: { ...auth, ...(json ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: json ? JSON.stringify(json) : form,
    signal: AbortSignal.timeout(240000),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = data?.error?.message || data?.error || data?.message || res.statusText;
    const err = new Error(`${provider === 'openai' ? 'OpenAI' : 'Gemini'} ${res.status}: ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// ---------- OpenAI ----------
export async function openaiVerify(key) {
  const d = await req(`${OPENAI}/models`, { key, provider: 'openai', method: 'GET' });
  const models = (d?.data || []).map((m) => m.id).filter((id) => /^gpt-image|^dall-e/.test(id)).sort();
  if (!models.length) throw new Error('Esta chave não tem acesso a modelos de imagem (GPT Image). Confira o projeto e a verificação da organização na OpenAI.');
  return { models, model: pick(models, OPENAI_PREF) };
}

// Modelos 2.5+ aceitam tamanho livre (múltiplos de 16): usa a proporção exata da rede social.
const openaiCustomSize = (model) => /^gpt-image-2\.\d/.test(model);

async function openaiGenerate(key, { model, prompt, format, refs, quality }) {
  const f = FORMATS[format] || FORMATS.quadrado;
  const size = openaiCustomSize(model) ? f.exact : f.size;
  let d;
  if (refs.length) {
    const form = new FormData();
    form.append('model', model);
    form.append('prompt', prompt);
    form.append('size', size);
    form.append('output_format', 'jpeg');
    if (quality) form.append('quality', quality);
    for (const r of refs) form.append('image[]', new Blob([r.buf], { type: r.mime }), r.name);
    d = await req(`${OPENAI}/images/edits`, { key, provider: 'openai', form });
  } else {
    d = await req(`${OPENAI}/images/generations`, { key, provider: 'openai', json: { model, prompt, size, n: 1, output_format: 'jpeg', ...(quality ? { quality } : {}) } });
  }
  const b64 = d?.data?.[0]?.b64_json;
  if (!b64) throw new Error('A OpenAI não devolveu imagem.');
  return { buf: Buffer.from(b64, 'base64'), mime: 'image/jpeg', model, revisedPrompt: d.data[0].revised_prompt || null };
}

// ---------- Gemini ----------
export async function geminiVerify(key) {
  const d = await req(`${GEMINI}/models?pageSize=1000`, { key, provider: 'gemini', method: 'GET' });
  const models = (d?.models || []).map((m) => String(m.name).replace(/^models\//, '')).filter((id) => /image/.test(id) && /gemini|nano-banana|imagen/.test(id)).sort();
  if (!models.length) throw new Error('Esta chave não tem acesso a modelos de imagem do Gemini.');
  return { models, model: pick(models.filter((m) => !m.startsWith('imagen')), GEMINI_PREF) || models[0] };
}

// Procura a última imagem (base64) em qualquer formato de resposta do Gemini.
function findImage(node, found = []) {
  if (!node || typeof node !== 'object') return found;
  if (Array.isArray(node)) { node.forEach((n) => findImage(n, found)); return found; }
  const inline = node.inlineData || node.inline_data;
  if (inline?.data) found.push({ data: inline.data, mime: inline.mimeType || inline.mime_type || 'image/png' });
  else if (node.type === 'image' && typeof node.data === 'string') found.push({ data: node.data, mime: node.mime_type || node.mimeType || 'image/png' });
  for (const [k, v] of Object.entries(node)) if (k !== 'inlineData' && k !== 'inline_data' && typeof v === 'object') findImage(v, found);
  return found;
}

async function geminiGenerate(key, { model, prompt, format, refs }) {
  const f = FORMATS[format] || FORMATS.quadrado;
  let d;
  try {
    d = await req(`${GEMINI}/interactions`, {
      key, provider: 'gemini', headers: { 'Api-Revision': '2026-05-20' },
      json: {
        model,
        input: [{ type: 'text', text: prompt }, ...refs.map((r) => ({ type: 'image', mime_type: r.mime, data: r.buf.toString('base64') }))],
        response_format: { type: 'image', mime_type: 'image/jpeg', aspect_ratio: f.ratio },
      },
    });
  } catch (e) {
    if (![400, 404].includes(e.status)) throw e;
    // API anterior (generateContent), ainda usada por alguns modelos
    d = await req(`${GEMINI}/models/${encodeURIComponent(model)}:generateContent`, {
      key, provider: 'gemini',
      json: {
        contents: [{ parts: [{ text: prompt }, ...refs.map((r) => ({ inline_data: { mime_type: r.mime, data: r.buf.toString('base64') } }))] }],
        generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: f.ratio } },
      },
    });
  }
  const img = findImage(d).at(-1);
  if (!img) throw new Error('O Gemini não devolveu imagem (o pedido pode ter sido bloqueado pelos filtros de segurança). Reescreva a descrição.');
  return { buf: Buffer.from(img.data, 'base64'), mime: img.mime, model, revisedPrompt: null };
}

/** refs: [{ name, mime, buf }] imagens de referência (vazio = gera do zero). */
export function generate(provider, key, opts) {
  const o = { ...opts, refs: opts.refs || [] };
  return provider === 'openai' ? openaiGenerate(key, o) : geminiGenerate(key, o);
}

export const extOf = (mime) => ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[mime] || 'png');
