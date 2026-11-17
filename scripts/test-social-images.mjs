// Teste das redes sociais (Upload-Post) e das imagens com IA (OpenAI e Gemini) sem rede:
// fetch falso que imita as APIs e confere o que o IAORG envia, as permissões e a aprovação.
// Uso (dentro do container do app): node scripts/test-social-images.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { encrypt } from '../server/secrets.js';
import * as imagegen from '../server/imagegen.js';
import { executeIntegrationTool, approve, toolsFor, accessSummary } from '../server/integrations.js';

let fail = 0;
const check = (label, ok, extra = '') => { console.log(`${ok ? 'OK    ' : 'FALHOU'} ${label}${extra ? ` → ${extra}` : ''}`); if (!ok) fail++; };
const calls = [];
// JPEG mínimo (cabeçalho) só para ter bytes reconhecíveis
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 74, 70, 73, 70, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]);
let geminiInteractions = true;

const formOf = async (body) => {
  if (!(body instanceof FormData)) return null;
  const out = {};
  for (const [k, v] of body.entries()) {
    const val = typeof v === 'string' ? v : { name: v.name, type: v.type, size: v.size };
    (out[k] ||= []).push(val);
  }
  return out;
};

globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  const form = await formOf(opts.body);
  const json = typeof opts.body === 'string' ? JSON.parse(opts.body) : null;
  calls.push({ url: u, method: opts.method, headers: opts.headers || {}, json, form });
  const ok = (data, status = 200) => ({ ok: true, status, json: async () => data });
  const no = (status, data) => ({ ok: false, status, statusText: 'erro', json: async () => data });
  // ---- Upload-Post ----
  if (u.startsWith('https://api.upload-post.com')) {
    if (opts.headers?.Authorization !== 'Apikey up-key') return no(401, { success: false, message: 'Invalid API key' });
    if (u.endsWith('/api/uploadposts/me')) return ok({ success: true, email: 'x@y', plan: 'free' });
    if (u.endsWith('/api/uploadposts/users')) return ok({ success: true, profiles: [{ username: 'iaorg', display_name: 'IAORG', social_accounts: { instagram: { username: '1789', handle: 'iaorg.app', display_name: 'IAORG' }, facebook: '', linkedin: { display_name: 'Leandro' } } }] });
    if (u.endsWith('/api/upload_photos')) return ok({ success: true, results: { instagram: { success: true, url: 'https://instagram.com/p/abc' } }, usage: { count: 3, limit: 10 } });
    if (u.endsWith('/api/upload_text')) return form.scheduled_date ? ok({ success: true, job_id: 'job_1', scheduled_date: form.scheduled_date[0] }, 202) : ok({ success: true, results: { linkedin: { success: true, url: 'https://linkedin.com/feed/1' } } });
    if (u.includes('/api/analytics/iaorg')) return ok({ instagram: { followers: 120, reach: 900 } });
    if (u.includes('/api/uploadposts/comments/create')) return ok({ success: true, id: 'c99', message: 'Comment created successfully' });
    if (u.includes('/api/uploadposts/comments')) return ok({ success: true, comments: [{ id: 'c1', text: 'Quanto custa?' }] });
  }
  // ---- OpenAI ----
  if (u === 'https://api.openai.com/v1/models') return ok({ data: [{ id: 'gpt-4o' }, { id: 'gpt-image-1' }, { id: 'gpt-image-2.5-sunburst' }] });
  if (u === 'https://api.openai.com/v1/images/generations' || u === 'https://api.openai.com/v1/images/edits') return ok({ data: [{ b64_json: JPG.toString('base64') }] });
  // ---- Gemini ----
  if (u.includes('generativelanguage.googleapis.com/v1beta/models?')) return ok({ models: [{ name: 'models/gemini-2.5-flash' }, { name: 'models/gemini-3.1-flash-image' }, { name: 'models/gemini-2.5-flash-image' }] });
  if (u.endsWith('/v1beta/interactions')) return geminiInteractions ? ok({ id: 'int1', steps: [{ type: 'model_output', content: [{ type: 'text', text: 'pronto' }, { type: 'image', mime_type: 'image/jpeg', data: JPG.toString('base64') }] }] }) : no(404, { error: { message: 'not found' } });
  if (u.includes(':generateContent')) return ok({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: JPG.toString('base64') } }] } }] });
  return no(404, { error: { message: `rota não simulada: ${u}` } });
};

// ---------- módulos ----------
const ov = await imagegen.openaiVerify('sk-test');
check('OpenAI: lista só modelos de imagem e escolhe o mais novo', ov.models.join() === 'gpt-image-1,gpt-image-2.5-sunburst' && ov.model === 'gpt-image-2.5-sunburst');
const gv = await imagegen.geminiVerify('AIza-test');
check('Gemini: lista só modelos de imagem e escolhe o recomendado', gv.models.includes('gemini-3.1-flash-image') && !gv.models.includes('gemini-2.5-flash') && gv.model === 'gemini-3.1-flash-image');

// ---------- empresa de teste ----------
const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'iaorg-test-'));
fs.mkdirSync(path.join(ws, 'Marca'), { recursive: true });
fs.writeFileSync(path.join(ws, 'Marca/logo.png'), JPG);
const agent = { id: 'mkt', name: 'Ana', role: 'Marketing', kind: 'ai', access: { uploadpost: { perms: ['read', 'post', 'reply'], resources: [] }, openai_images: { perms: ['generate'] }, gemini_images: { perms: ['generate'] } } };
const leitor = { id: 'cs', name: 'Bia', role: 'Atendimento', kind: 'ai', access: { uploadpost: { perms: ['read'] } } };
const owner = { id: 'dono', name: 'Leandro', kind: 'human', appRole: 'owner' };
const store = {
  id: 't', company: { name: 'Teste' }, workspace: ws,
  state: {
    agents: [agent, leitor, owner], approvals: [],
    integrations: {
      uploadpost: { connected: true, secret: encrypt('up-key'), account: 'iaorg', config: { mode: 'approval', profiles: [{ username: 'iaorg', name: 'IAORG', accounts: { instagram: { name: 'IAORG' }, linkedin: { name: 'Leandro' } } }] } },
      openai_images: { connected: true, secret: encrypt('sk-test'), account: '', config: { autoModel: 'gpt-image-2.5-sunburst' } },
      gemini_images: { connected: true, secret: encrypt('AIza-test'), account: '', config: { autoModel: 'gemini-3.1-flash-image' } },
    },
  },
  save() {}, getAgent(id) { return this.state.agents.find((a) => a.id === id); }, aiAgents() { return [agent, leitor]; }, owner() { return owner; },
  safePath(rel) { const full = path.resolve(ws, String(rel || '').replace(/^[/\\]+/, '')); if (full !== ws && !full.startsWith(ws + path.sep)) throw new Error('Caminho fora do workspace'); return full; },
  listFiles() { return []; },
};
const events = [];
const rt = { store, logEvent: (t, a, txt) => events.push(txt), emit() {}, pushSnapshot() {}, setStatus() {} };

// ---------- ferramentas e permissões ----------
const names = toolsFor(store, agent).map((t) => t.name);
check('Ferramentas aparecem conforme as permissões', ['imagem_gerar', 'social_contas', 'social_metricas', 'social_publicar', 'social_responder', 'social_comentarios'].every((n) => names.includes(n)));
const so = toolsFor(store, leitor).map((t) => t.name);
check('Só leitura: não recebe publicar, responder nem criar imagem', so.includes('social_metricas') && !so.includes('social_publicar') && !so.includes('social_responder') && !so.includes('imagem_gerar'));
check('Com OpenAI e Gemini, o agente escolhe o provedor', toolsFor(store, agent).find((t) => t.name === 'imagem_gerar').input_schema.properties.provedor?.enum.join() === 'openai,gemini');
check('Prompt do agente cita as redes e a aprovação', /Instagram \(IAORG\)/.test(accessSummary(store, agent)) && /aprovação/.test(accessSummary(store, agent)));
const negado = await executeIntegrationTool(rt, leitor, 'social_publicar', { plataformas: ['linkedin'], texto: 'Oi' });
check('Sem permissão de publicar: recusa', !!negado.error);

// ---------- imagens ----------
const img = await executeIntegrationTool(rt, agent, 'imagem_gerar', { descricao: 'Escritório 3D com agentes de IA, estilo ilustração', formato: 'retrato' }, 'T5');
const gen = calls.findLast((c) => c.url.endsWith('/images/generations'));
check('OpenAI: gera com o modelo, tamanho 4:5 exato e JPEG', gen?.json.model === 'gpt-image-2.5-sunburst' && gen.json.size === '1024x1280' && gen.json.output_format === 'jpeg' && gen.headers.Authorization === 'Bearer sk-test');
check('Imagem salva em Marketing/Imagens com data e nome', img.ok && /^Marketing\/Imagens\/\d{4}-\d{2}-\d{2}-escritorio-3d-com-agentes/.test(img.arquivo) && fs.existsSync(path.join(ws, img.arquivo)));
check('Fora da oficina, não devolve o arquivo em base64', !img._salvar);
const edit = await executeIntegrationTool(rt, agent, 'imagem_gerar', { descricao: 'Coloque o logo num post de lançamento', referencias: ['Marca/logo.png'], caminho: 'Marketing/Posts/lancamento.png' }, 'T5', { fromJob: true });
const ed = calls.findLast((c) => c.url.endsWith('/images/edits'));
check('OpenAI: com referência usa o endpoint de edição com image[]', ed?.form['image[]']?.[0]?.name === 'logo.png' && ed.form.model[0] === 'gpt-image-2.5-sunburst');
check('Caminho pedido respeitado com a extensão real (jpg)', edit.arquivo === 'Marketing/Posts/lancamento.jpg');
check('Na oficina, devolve o arquivo para o container (_salvar)', edit._salvar?.[0]?.path === 'Marketing/Posts/lancamento.jpg' && edit._salvar[0].mime === 'image/jpeg');
const gem = await executeIntegrationTool(rt, agent, 'imagem_gerar', { descricao: 'Banner', formato: 'paisagem', provedor: 'gemini' });
const gi = calls.findLast((c) => c.url.endsWith('/interactions'));
check('Gemini: Interactions API com proporção 16:9 e a chave no cabeçalho', gem.ok && gi?.json.response_format.aspect_ratio === '16:9' && gi.headers['x-goog-api-key'] === 'AIza-test' && gi.json.model === 'gemini-3.1-flash-image');
geminiInteractions = false;
const gem2 = await executeIntegrationTool(rt, agent, 'imagem_gerar', { descricao: 'Banner 2', provedor: 'gemini' });
check('Gemini: cai para generateContent se a Interactions API não existir', gem2.ok && /\.png$/.test(gem2.arquivo) && calls.at(-1).url.includes(':generateContent'));
const fora = await executeIntegrationTool(rt, agent, 'imagem_gerar', { descricao: 'x', referencias: ['../../etc/passwd.png'] });
check('Referência fora do arquivo da empresa é recusada', !!fora.error);

// ---------- publicar ----------
const semImg = await executeIntegrationTool(rt, agent, 'social_publicar', { plataformas: ['instagram'], texto: 'Novidade!' });
check('Instagram sem imagem é recusado antes da aprovação', /exigem imagem/.test(semImg.error || ''));
const fb = await executeIntegrationTool(rt, agent, 'social_publicar', { plataformas: ['facebook'], texto: 'Oi', imagens: [img.arquivo] });
check('Rede não conectada no perfil é recusada', /não conectada/.test(fb.error || ''));
const antes = calls.filter((c) => c.url.endsWith('/api/upload_photos')).length;
// na oficina, um card feito no navegador existe só no container: chega em _anexos e vai para Arquivos
const card = { path: 'Marketing/Posts/card.jpg', b64: JPG.toString('base64') };
const q = await executeIntegrationTool(rt, agent, 'social_publicar', { plataformas: ['instagram'], texto: 'Lançamos o IAORG! #ia', imagens: [img.arquivo, '/work/entregas/Marketing/Posts/card.jpg'], _anexos: [card] }, 'T6', { fromJob: true });
check('Post NÃO sai sem aprovação', q.aguardando_aprovacao && calls.filter((c) => c.url.endsWith('/api/upload_photos')).length === antes);
check('Imagem vinda do container foi gravada em Arquivos', fs.existsSync(path.join(ws, 'Marketing/Posts/card.jpg')));
const item = store.state.approvals.at(-1);
check('Aprovação mostra redes, tipo e as imagens', item.channel === 'social' && /Instagram \(IAORG\)/.test(item.preview.para) && /Carrossel com 2/.test(item.preview.assunto) && item.preview.imagens.length === 2 && item.text.startsWith('Lançamos'));
check('Aprovação guarda caminhos limpos (sem _anexos)', !item.input._anexos && item.input.imagens[1] === 'Marketing/Posts/card.jpg');
await approve(rt, item, { text: 'Lançamos o IAORG! (editado) #ia', byName: 'Leandro' });
const pub = calls.findLast((c) => c.url.endsWith('/api/upload_photos'));
check('Depois de aprovado: publica com o texto editado, perfil e 2 fotos', pub?.form.user[0] === 'iaorg' && pub.form['platform[]'].join() === 'instagram' && pub.form.title[0].includes('(editado)') && pub.form['photos[]'].length === 2 && pub.headers.Authorization === 'Apikey up-key');
check('Registra o link no diário', events.some((e) => /instagram\.com\/p\/abc/.test(e)));

// agendado, só texto, modo automático
store.state.integrations.uploadpost.config.mode = 'auto';
const quando = new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 19);
const ag = await executeIntegrationTool(rt, agent, 'social_publicar', { plataformas: ['linkedin'], texto: 'Artigo novo no blog', agendar_para: quando });
const txt = calls.findLast((c) => c.url.endsWith('/api/upload_text'));
check('Modo automático: agenda direto no LinkedIn com fuso de Brasília', ag.ok && ag.agendado && ag.job_id === 'job_1' && txt.form.scheduled_date[0] === quando && txt.form.timezone[0] === 'America/Sao_Paulo');
const passado = await executeIntegrationTool(rt, agent, 'social_publicar', { plataformas: ['linkedin'], texto: 'x', agendar_para: '2020-01-01T10:00:00' });
check('Agendamento no passado é recusado', !!passado.error);

// tarefa de teste: mesmo no automático vai para aprovação
const t = await executeIntegrationTool(rt, agent, 'social_publicar', { plataformas: ['linkedin'], texto: 'teste' }, null, { forceApproval: true });
check('Tarefa de teste sempre vai para aprovação', t.aguardando_aprovacao);
store.state.integrations.uploadpost.config.mode = 'approval';

// ---------- métricas e comentários ----------
const m = await executeIntegrationTool(rt, leitor, 'social_metricas', { plataformas: ['instagram'] });
check('Métricas da conta pelo perfil configurado', m.instagram?.followers === 120 && calls.at(-1).url.includes('/api/analytics/iaorg?platforms=instagram'));
const cm = await executeIntegrationTool(rt, leitor, 'social_comentarios', { plataforma: 'instagram', post_id: '1789_1' });
check('Lê comentários de um post', cm.comments?.[0]?.text === 'Quanto custa?' && calls.at(-1).url.includes('post_id=1789_1'));
const rIg = await executeIntegrationTool(rt, agent, 'social_responder', { plataforma: 'instagram', post_id: '1789_1', texto: 'Oi' });
check('Instagram: só responde comentário (exige comment_id)', /comment_id/.test(rIg.error || ''));
const r = await executeIntegrationTool(rt, agent, 'social_responder', { plataforma: 'instagram', comment_id: 'c1', texto: 'É grátis e de código aberto!', comentario_original: 'Quanto custa?' });
check('Resposta a comentário vai para aprovação com o comentário original', r.aguardando_aprovacao && store.state.approvals.at(-1).preview.conversa === 'Comentário: Quanto custa?');
await approve(rt, store.state.approvals.at(-1), { byName: 'Leandro' });
const cr = calls.findLast((c) => c.url.endsWith('/comments/create'));
check('Depois de aprovada, responde o comentário certo', cr?.json.comment_id === 'c1' && cr.json.user === 'iaorg' && cr.json.message.startsWith('É grátis'));

fs.rmSync(ws, { recursive: true, force: true });
process.exit(fail ? 1 : 0);
