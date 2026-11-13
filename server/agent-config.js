// Rotas da ficha do agente, da base de conhecimento, da fila de aprovação e do simulador.
import { MODELS, providerFor, callClaude, describeError } from './llm.js';
import { profileOf, placeholdersIn, sanitizeProfile, pushHistory, applyProfile, DYNAMIC_VARS, CHANNELS } from './profile.js';
import * as kb from './knowledge.js';
import { approve, customerChannels, can, allowedRepos } from './integrations.js';
import { verifyHint } from './profile.js';
import { readMemory, writeMemory, memoryHistory } from './memory.js';
import { readActivity, activityStats } from './activity.js';
import * as workbench from './workbench.js';

// No simulador, só estas ferramentas rodam de verdade (apenas leitura). O resto é interceptado e só mostrado.
const READ_ONLY = new Set(['read_file', 'list_files', 'repo_list_files', 'repo_read_file', 'railway_projects', 'railway_deployments', 'railway_logs', 'railway_variables', 'calendar_list', 'email_inbox_list', 'gmail_search', 'gmail_read', 'chat_conversations']);
const ACTION_LABEL = {
  send_message: 'Mandaria mensagem', create_task: 'Criaria tarefa', update_task: 'Atualizaria tarefa', write_file: 'Escreveria arquivo',
  repo_open_pr: 'Abriria pull request', railway_redeploy: 'Faria redeploy', railway_restart: 'Reiniciaria serviço', railway_set_variable: 'Alteraria variável',
  email_send: 'Enviaria e-mail', gmail_send: 'Enviaria e-mail', gmail_draft: 'Criaria rascunho no Gmail', calendar_create: 'Criaria evento', chat_note: 'Anotaria na conversa', chat_resolve: 'Resolveria a conversa',
};
const summarize = (name, input) => {
  const i = input || {};
  const main = i.title || i.subject || i.path || i.service || i.name || i.repo || i.to || '';
  const body = i.content || i.text || i.description || i.body || '';
  return `${main ? `${main}` : ''}${body ? `${main ? ' — ' : ''}${String(body).slice(0, 400)}` : main ? '' : JSON.stringify(i).slice(0, 300)}`;
};

const SIM_TOOLS = {
  chat_reply: { name: 'chat_reply', description: 'Responde o cliente no chat do site.', input_schema: { type: 'object', properties: { session_id: { type: 'string' }, text: { type: 'string' } }, required: ['session_id', 'text'] } },
  email_reply: { name: 'email_reply', description: 'Responde o e-mail do cliente.', input_schema: { type: 'object', properties: { email_id: { type: 'string' }, text: { type: 'string' } }, required: ['email_id', 'text'] } },
  whatsapp_reply: { name: 'whatsapp_reply', description: 'Responde o cliente no WhatsApp.', input_schema: { type: 'object', properties: { telefone: { type: 'string' }, text: { type: 'string' } }, required: ['telefone', 'text'] } },
};

export function mountAgentConfig(app, { requireCompany, need, wrap, runtimeFor }) {
  const bad = (res, msg, code = 400) => res.status(code).json({ error: msg });
  const str = (v, max = 300) => String(v ?? '').trim().slice(0, max);
  const aiAgent = (req) => { const a = req.company.getAgent(req.params.id); return a && a.kind !== 'human' && a.kind !== 'function' ? a : null; };
  const people = (store) => store.state.agents.filter((a) => a.kind === 'human' && a.active !== false);
  const rt = (store) => runtimeFor(store);

  function profilePayload(store, a) {
    const profile = profileOf(a);
    const mode = kb.knowledgeMode(store, a);
    return {
      profile,
      placeholders: placeholdersIn(profile),
      dynamicVars: customerChannels(store, a).length ? DYNAMIC_VARS : [],
      channels: Object.fromEntries(customerChannels(store, a).map((ch) => [ch, CHANNELS[ch]])),
      tools: rt(store).tools(a).map((t) => t.name),
      models: MODELS,
      companyModel: store.company.settings.model,
      knowledge: { mode: mode.mode, tokens: mode.tokens, chunks: mode.chunks.length, inlineLimit: kb.INLINE_TOKEN_LIMIT },
      collections: kb.collections(store).map(kb.collectionSummary),
      people: people(store).map((p) => ({ id: p.id, name: p.name, role: p.role })),
      history: (a.profileHistory || []).map((h, i) => ({ index: i, ts: h.ts, by: h.by, size: JSON.stringify(h.profile).length })),
      promptTokens: kb.estimateTokens(runtimeFor(store).systemPrompt(a)),
      workshop: {
        enabled: workbench.enabled(), kits: workbench.kitsFor(store, a), canCode: can(store, a, 'github', 'code'),
        repos: allowedRepos(store, a), verifyHint: verifyHint(a), memoryChars: readMemory(store, a.id).length,
      },
    };
  }

  // ---------------- conversas (em forma de chat) ----------------
  // Cada conversa = um par de participantes. "board" conta como o dono.
  const normId = (store, id) => (id === 'board' ? store.owner()?.id || 'board' : id);
  const pairKey = (store, a, b) => [normId(store, a), normId(store, b)].sort().join('|');
  const kindOf = (store, ids, meId) => {
    if (ids.some((id) => String(id).startsWith('caixa:'))) return 'clientes';
    if (ids.includes(meId)) return 'comigo';
    if (ids.some((id) => store.getAgent(id)?.kind === 'human')) return 'pessoas';
    return 'equipe';
  };
  app.get('/api/threads', requireCompany, (req, res) => {
    const store = req.company;
    const map = new Map();
    for (const m of store.state.messages || []) {
      const key = pairKey(store, m.from, m.to);
      const t = map.get(key) || { key, ids: key.split('|'), count: 0, last: null, unread: 0 };
      t.count++;
      t.last = m;
      if (m.to === req.member.id && !m.readByHuman) t.unread++;
      map.set(key, t);
    }
    const list = [...map.values()].map((t) => ({ ...t, kind: kindOf(store, t.ids, req.member.id), last: { ts: t.last.ts, from: t.last.from, content: String(t.last.content).slice(0, 160) } }));
    list.sort((a, b) => b.last.ts - a.last.ts);
    res.json(list);
  });
  app.get('/api/threads/messages', requireCompany, (req, res) => {
    const store = req.company;
    const key = String(req.query.key || '');
    const before = +req.query.before || Infinity;
    const all = (store.state.messages || []).filter((m) => pairKey(store, m.from, m.to) === key && m.ts < before);
    // marcar como lidas as que são para mim
    let changed = false;
    for (const m of all) if (m.to === req.member.id && !m.readByHuman) { m.readByHuman = true; changed = true; }
    if (changed) store.save();
    res.json({ messages: all.slice(-200), more: all.length > 200 });
  });

  // ---------------- log completo de um agente (ou pessoa) ----------------
  app.get('/api/agents/:id/activity', requireCompany, (req, res) => {
    const store = req.company;
    const a = store.getAgent(req.params.id);
    if (!a) return bad(res, 'Não encontrado', 404);
    const types = String(req.query.types || '').split(',').filter(Boolean);
    const items = readActivity(store, a.id, { before: +req.query.before || undefined, limit: Math.min(+req.query.limit || 150, 500), types, q: req.query.q });
    res.json({ items, stats: req.query.before ? undefined : activityStats(store, a.id) });
  });

  // ---------------- memória do agente ----------------
  app.get('/api/agents/:id/memory', requireCompany, (req, res) => {
    const a = aiAgent(req);
    if (!a) return bad(res, 'Agente de IA não encontrado', 404);
    res.json({ text: readMemory(req.company, a.id), history: memoryHistory(req.company, a.id).map((h, i) => ({ index: i, ts: h.ts, by: h.by, size: h.text.length })) });
  });
  app.put('/api/agents/:id/memory', requireCompany, need('admin'), (req, res) => {
    const a = aiAgent(req);
    if (!a) return bad(res, 'Agente de IA não encontrado', 404);
    let text = req.body?.text;
    if (req.body?.restore !== undefined) text = memoryHistory(req.company, a.id)[+req.body.restore]?.text;
    if (typeof text !== 'string') return bad(res, 'Texto inválido');
    if (writeMemory(req.company, a.id, text, req.member.name)) runtimeFor(req.company).logEvent('system', req.member.id, `${req.member.name} editou a memória de ${a.name}.`);
    res.json({ ok: true, text: readMemory(req.company, a.id) });
  });

  // ---------------- ficha ----------------
  app.get('/api/agents/:id/profile', requireCompany, (req, res) => {
    const a = aiAgent(req);
    if (!a) return bad(res, 'Agente de IA não encontrado', 404);
    res.json(profilePayload(req.company, a));
  });

  app.put('/api/agents/:id/profile', requireCompany, need('admin'), (req, res) => {
    const store = req.company;
    const a = aiAgent(req);
    if (!a) return bad(res, 'Agente de IA não encontrado', 404);
    pushHistory(a, req.member.name);
    applyProfile(a, sanitizeProfile(req.body || {}, profileOf(a), {
      validPeople: people(store).map((p) => p.id), validCollections: kb.collections(store).map((c) => c.id),
    }));
    store.save();
    runtimeFor(store).logEvent('system', req.member.id, `${req.member.name} atualizou a ficha de ${a.name}.`);
    runtimeFor(store).pushSnapshot();
    res.json(profilePayload(store, a));
  });

  app.post('/api/agents/:id/profile/restore', requireCompany, need('admin'), (req, res) => {
    const store = req.company;
    const a = aiAgent(req);
    const h = a?.profileHistory?.[+req.body?.index];
    if (!h) return bad(res, 'Versão não encontrada', 404);
    const old = JSON.parse(JSON.stringify(h.profile));
    pushHistory(a, req.member.name);
    applyProfile(a, old);
    store.save();
    runtimeFor(store).logEvent('system', req.member.id, `${req.member.name} restaurou uma versão anterior da ficha de ${a.name}.`);
    res.json(profilePayload(store, a));
  });

  // ---------------- simulador: mostra o que o agente faria, sem enviar nada ----------------
  app.post('/api/agents/:id/test', requireCompany, need('admin'), wrap(async (req, res) => {
    const store = req.company;
    const a = aiAgent(req);
    if (!a) return bad(res, 'Agente de IA não encontrado', 404);
    if (providerFor(store) === 'mock') return bad(res, 'Cadastre a chave do Claude (Ajustes → Claude) para usar o simulador.');
    const message = str(req.body?.message, 4000);
    if (!message) return bad(res, 'Escreva a mensagem');
    const chans = customerChannels(store, a);
    if (req.body?.modo !== 'cliente' || !chans.length) return simulateOrder(req, res, store, a, message);
    const canal = ['email', 'chat', 'whatsapp'].includes(req.body?.canal) ? req.body.canal : chans[0];
    const chat = canal === 'chat';
    const nome = str(req.body?.nome, 60) || 'Cliente de teste';
    const email = str(req.body?.email, 120) || 'cliente@exemplo.com';
    const rt = runtimeFor(store);
    const profile = profileOf(a);
    const replyTool = { chat: 'chat_reply', email: 'email_reply', whatsapp: 'whatsapp_reply' }[canal];
    const tools = rt.tools(a).filter((t) => !['create_task', 'update_task', 'write_file'].includes(t.name));
    if (!tools.some((t) => t.name === replyTool)) tools.push(SIM_TOOLS[replyTool]);
    const intro = {
      chat: `- de Chat do site: Nova mensagem de cliente.\nCanal: chat | Caixa de destino: chat do site | Nome do cliente: ${nome} | E-mail do cliente: ${email}\nMensagem: "${message}" (session_id: simulacao-1)`,
      email: `- de Caixa de entrada: Novo e-mail de cliente.\nCanal: e-mail | Caixa de destino: suporte | Nome do cliente: ${nome} | E-mail do cliente: ${email}\nTexto do e-mail: "${message}" (email_id: simulacao-1)`,
      whatsapp: `- de WhatsApp: Nova mensagem de cliente no WhatsApp.\nCanal: whatsapp | Caixa de destino: WhatsApp | Nome do cliente: ${nome} | Telefone do cliente: +5511999990000\nMensagem: "${message}" (telefone: 5511999990000)`,
    }[canal];
    const messages = [{
      role: 'user',
      content: `## Novas mensagens\n${intro}\n\nResponda ao cliente com ${replyTool} (ou escale, se for o caso). Quando terminar, responda com uma frase curta de resumo.`,
    }];
    const actions = [];
    let reply = '';
    let usage = { input: 0, output: 0 };
    try {
      for (let step = 0; step < 5; step++) {
        const r = await callClaude(store, { system: rt.systemBlocks(a), messages, tools, model: profile.model, effort: profile.effort });
        rt.trackUsage(r.usage, { model: profile.model, agentId: a.id, kind: 'sim' });
        usage = { input: usage.input + (r.usage?.input_tokens || 0) + (r.usage?.cache_read_input_tokens || 0) + (r.usage?.cache_creation_input_tokens || 0), output: usage.output + (r.usage?.output_tokens || 0) };
        if (r.stop_reason === 'refusal') { reply = reply || '(o modelo recusou responder)'; break; }
        messages.push({ role: 'assistant', content: r.content });
        const uses = r.content.filter((b) => b.type === 'tool_use');
        if (r.stop_reason !== 'tool_use' || !uses.length) break;
        const results = [];
        for (const u of uses) {
          let out = { ok: true, simulado: true };
          if (u.name === replyTool) { reply = String(u.input?.text || ''); actions.push({ tipo: 'resposta', texto: reply }); }
          else if (u.name === 'buscar_conhecimento') { out = { trechos: kb.search(kb.knowledgeMode(store, a).chunks, u.input?.consulta || '', { category: u.input?.categoria }) }; actions.push({ tipo: 'busca', texto: `${u.input?.consulta} → ${out.trechos.map((t) => t.titulo).join('; ') || 'nada'}` }); }
          else if (u.name === 'escalar_para_humano') { out = { ok: true, simulado: true, escalado_para: 'pessoa definida na ficha' }; actions.push({ tipo: 'escalou', texto: `${u.input?.motivo || ''} — ${u.input?.resumo || ''}` }); }
          else if (u.name === 'chat_messages' || u.name === 'email_read') out = { from: nome, text: message, messages: [{ from: 'user', text: message, who: nome }] };
          else if (u.name === 'whatsapp_messages') out = { cliente: { telefone: '5511999990000', nome }, janela_24h_aberta: true, mensagens: [{ de: 'cliente', texto: message, quando: new Date().toISOString() }] };
          else actions.push({ tipo: 'ferramenta', texto: `${u.name} ${JSON.stringify(u.input).slice(0, 200)}` });
          results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out) });
        }
        messages.push({ role: 'user', content: results });
      }
    } catch (e) { return bad(res, describeError(e), 502); }
    void chat;
    res.json({ tipo: 'cliente', reply, actions, usage, modo: profile.sendMode[canal] });
  }));

  // Simula uma ordem/mensagem de alguém da equipe: leituras rodam de verdade, ações só são mostradas.
  async function simulateOrder(req, res, store, a, message) {
    const runtime = rt(store);
    const profile = profileOf(a);
    const me = store.getAgent(req.member.id);
    const fromId = me?.id || 'board';
    const tools = runtime.tools(a);
    const messages = [{
      role: 'user',
      content: `## Novas mensagens\n- de ${me ? `${me.name} (id ${me.id}, ${me.title || me.role})` : 'o dono da empresa (board)'}: ${message}\n\nTrate o pedido com suas ferramentas, como faria no dia a dia. Responda a quem pediu com send_message (to="${fromId}"). Quando terminar, escreva uma frase curta resumindo o que fez.`,
    }];
    const actions = [];
    let reply = '';
    let final = '';
    let usage = { input: 0, output: 0 };
    try {
      for (let step = 0; step < 8; step++) {
        const r = await callClaude(store, { system: runtime.systemBlocks(a), messages, tools, model: profile.model, effort: profile.effort });
        runtime.trackUsage(r.usage, { model: profile.model, agentId: a.id, kind: 'sim' });
        usage = { input: usage.input + (r.usage?.input_tokens || 0) + (r.usage?.cache_read_input_tokens || 0) + (r.usage?.cache_creation_input_tokens || 0), output: usage.output + (r.usage?.output_tokens || 0) };
        if (r.stop_reason === 'refusal') { final = '(o modelo recusou responder)'; break; }
        messages.push({ role: 'assistant', content: r.content });
        final = r.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim() || final;
        const uses = r.content.filter((b) => b.type === 'tool_use');
        if (r.stop_reason !== 'tool_use' || !uses.length) break;
        const results = [];
        for (const u of uses) {
          // Resposta neutra (como se tivesse dado certo), para o agente seguir o fluxo normal sem comentar o simulador.
          let out = { ok: true, id: `T-sim${step}${results.length}` };
          const i = u.input || {};
          if (u.name === 'send_message' && (i.to === fromId || i.to === 'board')) { reply = reply ? `${reply}\n\n${i.content}` : String(i.content || ''); actions.push({ tipo: 'resposta', texto: i.content }); }
          else if (READ_ONLY.has(u.name)) {
            try { out = await runtime.executeTool(a, u.name, i); } catch (e) { out = { error: e.message }; }
            actions.push({ tipo: 'leitura', texto: `${u.name} ${summarize(u.name, i)}`.trim() });
          } else if (u.name === 'buscar_conhecimento') {
            out = { trechos: kb.search(kb.knowledgeMode(store, a).chunks, i.consulta || '', { category: i.categoria }) };
            actions.push({ tipo: 'busca', texto: `${i.consulta} → ${out.trechos.map((t) => t.titulo).join('; ') || 'nada'}` });
          } else if (u.name === 'escalar_para_humano') {
            actions.push({ tipo: 'escalou', texto: `${i.motivo || ''} — ${i.resumo || ''}` });
          } else {
            const who = i.to || i.assignee_id || i.assigneeId;
            actions.push({ tipo: 'acao', texto: `${ACTION_LABEL[u.name] || u.name}${who ? ` (para ${store.getAgent(who)?.name || who})` : ''}: ${summarize(u.name, i)}` });
          }
          results.push({ type: 'tool_result', tool_use_id: u.id, content: JSON.stringify(out).slice(0, 30000) });
        }
        messages.push({ role: 'user', content: results });
      }
    } catch (e) { return bad(res, describeError(e), 502); }
    res.json({ tipo: 'ordem', reply, final, actions, usage });
  }

  // ---------------- base de conhecimento ----------------
  const cleanFiles = (files) => (Array.isArray(files) ? files : []).slice(0, 60)
    .map((f) => ({ name: str(f?.name, 120) || 'arquivo.md', content: String(f?.content ?? '').slice(0, 1_500_000) }))
    .filter((f) => f.content.trim());

  app.get('/api/knowledge', requireCompany, (req, res) => res.json(kb.collections(req.company).map(kb.collectionSummary)));

  app.get('/api/knowledge/:id', requireCompany, (req, res) => {
    const c = kb.getCollection(req.company, req.params.id);
    if (!c) return bad(res, 'Coleção não encontrada', 404);
    res.json({ ...kb.collectionSummary(c), items: c.chunks.map((k) => ({ id: k.id, title: k.title, category: k.category, questions: k.questions, size: k.text.length })) });
  });

  app.post('/api/knowledge', requireCompany, need('admin'), (req, res) => {
    const files = cleanFiles(req.body?.files);
    if (!files.length) return bad(res, 'Envie ao menos um arquivo .md, .jsonl ou .txt');
    try {
      const { collection, errors } = kb.addCollection(req.company, { name: str(req.body?.name, 80), files });
      runtimeFor(req.company).logEvent('system', req.member.id, `${req.member.name} adicionou a base "${collection.name}" (${collection.chunks.length} trechos).`);
      runtimeFor(req.company).pushSnapshot();
      res.json({ ...kb.collectionSummary(collection), errors });
    } catch (e) { bad(res, e.message); }
  });

  app.put('/api/knowledge/:id', requireCompany, need('admin'), (req, res) => {
    const files = cleanFiles(req.body?.files);
    if (!files.length) return bad(res, 'Envie os arquivos atualizados');
    try {
      const { collection, errors } = kb.replaceCollection(req.company, req.params.id, { files, name: str(req.body?.name, 80) });
      runtimeFor(req.company).logEvent('system', req.member.id, `${req.member.name} atualizou a base "${collection.name}" (${collection.chunks.length} trechos).`);
      res.json({ ...kb.collectionSummary(collection), errors });
    } catch (e) { bad(res, e.message); }
  });

  app.delete('/api/knowledge/:id', requireCompany, need('admin'), (req, res) => {
    const store = req.company;
    const list = kb.collections(store);
    const i = list.findIndex((c) => c.id === req.params.id);
    if (i < 0) return bad(res, 'Coleção não encontrada', 404);
    const [gone] = list.splice(i, 1);
    for (const a of store.state.agents) if (a.profile?.knowledge) a.profile.knowledge = a.profile.knowledge.filter((id) => id !== gone.id);
    store.save();
    runtimeFor(store).logEvent('system', req.member.id, `${req.member.name} removeu a base "${gone.name}".`);
    res.json({ ok: true });
  });

  // ---------------- aprovações ----------------
  const pending = (store) => (store.state.approvals || []).filter((x) => x.status === 'pending');

  app.post('/api/approvals/:id/approve', requireCompany, need('admin'), wrap(async (req, res) => {
    const store = req.company;
    const item = pending(store).find((x) => x.id === req.params.id);
    if (!item) return bad(res, 'Este rascunho já foi tratado', 404);
    const text = req.body?.text !== undefined ? String(req.body.text).slice(0, 20000) : undefined;
    if (text !== undefined && !text.trim()) return bad(res, 'O texto não pode ficar vazio');
    try { await approve(runtimeFor(store), item, { text, byName: req.member.name }); } catch (e) { return bad(res, `Não foi possível enviar: ${e.message}`, 502); }
    runtimeFor(store).logEvent('task', req.member.id, `${req.member.name} aprovou e enviou a resposta de ${store.getAgent(item.agentId)?.name || 'agente'}${text !== undefined && text !== item.text ? ' (com edição)' : ''}.`);
    runtimeFor(store).pushSnapshot();
    res.json({ ok: true });
  }));

  app.post('/api/approvals/:id/reject', requireCompany, need('admin'), (req, res) => {
    const store = req.company;
    const item = pending(store).find((x) => x.id === req.params.id);
    if (!item) return bad(res, 'Este rascunho já foi tratado', 404);
    const reason = str(req.body?.reason, 500);
    Object.assign(item, { status: 'rejected', decidedAt: Date.now(), decidedBy: req.member.name, reason });
    store.save();
    const rt = runtimeFor(store);
    rt.logEvent('task', req.member.id, `${req.member.name} descartou a resposta de ${store.getAgent(item.agentId)?.name || 'agente'}${reason ? `: ${reason}` : ''}.`);
    // Com orientação, o agente é avisado e pode refazer; sem orientação, só descarta.
    if (reason && store.getAgent(item.agentId)) rt.postMessage(req.member.id, item.agentId, `Descartei seu rascunho para ${item.preview?.para || 'o cliente'} (${item.tool}, ${JSON.stringify({ session_id: item.input.session_id, email_id: item.input.email_id })}). Orientação: ${reason}. Refaça a resposta.`);
    rt.pushSnapshot();
    res.json({ ok: true });
  });
}
