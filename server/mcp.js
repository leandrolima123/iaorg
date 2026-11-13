// Servidor MCP do IAORG (Streamable HTTP em /mcp, sem sessão): deixa o Claude Code, o Claude Desktop,
// o Cursor ou qualquer cliente MCP configurar e operar a empresa. Cada ferramenta chama a própria API do
// IAORG com o token da pessoa: as mesmas validações, permissões, aprovações e o mesmo diário da interface.
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { authenticate, LEVELS } from './tokens.js';
import { hasRole } from './companies.js';

const PORT = +process.env.PORT || 3000;
const S = (description, extra = {}) => ({ type: 'string', description, ...extra });
const N = (description) => ({ type: 'number', description });
const B = (description) => ({ type: 'boolean', description });
const obj = (properties, required = []) => ({ type: 'object', properties, required });
const iso = (t) => (t ? new Date(t).toISOString() : null);
const short = (s, n = 600) => { const t = String(s ?? ''); return t.length > n ? `${t.slice(0, n)}…` : t; };

// ---------------- ferramentas ----------------
// level: nível mínimo do token; admin: exige papel de administrador na empresa.
const TOOLS = [
  // ===== leitura =====
  { name: 'empresa_resumo', level: 'read', description: 'Visão geral da empresa: dados e contexto, equipe (com ids), tarefas por status, gasto do mês e se a obra está pausada. Comece por aqui.', input: obj({}),
    run: async ({ state }) => {
      const s = await state();
      const by = (st) => s.tasks.filter((t) => t.status === st).length;
      return {
        empresa: { nome: s.company.name, segmento: s.company.segment, site: s.company.website, descricao: s.company.description, contexto: short(s.company.context, 1500) },
        obra: { pausada: s.paused, motivo: s.usage.pausedReason || null },
        gasto: { mes_usd: +(s.usage.monthCostUsd || 0).toFixed(4), limite_mes_usd: s.usage.budgetUsd, total_usd: +(s.usage.costUsd || 0).toFixed(4) },
        equipe: s.agents.map((a) => ({ id: a.id, nome: a.name, cargo: a.role, titulo: a.title, tipo: a.kind === 'human' ? 'pessoa' : 'agente_ia', reporta_a: a.reportsTo, status: a.kind === 'human' ? (a.online ? 'online' : 'ausente') : a.runtime?.status })),
        tarefas: { a_fazer: by('todo'), fazendo: by('doing'), aguardando_voce: by('review'), bloqueadas: by('blocked'), concluidas: by('done') },
        aprovacoes_pendentes: (s.approvals || []).length,
      };
    } },
  { name: 'catalogo', level: 'read', description: 'Catálogo de cargos (com instruções padrão), modelos de organograma e modelos de IA disponíveis. Use antes de contratar.', input: obj({}),
    run: async ({ api }) => { const c = await api('GET', '/api/catalog'); return { cargos: c.roles.map((r) => ({ chave: r.key, cargo: r.role, titulo: r.title, reporta_a_padrao: r.reportsTo, instrucoes_padrao: short(r.prompt, 300) })), organogramas: c.templates.map((t) => ({ id: t.id, nome: t.name, descricao: t.description })), modelos_ia: c.models.map((m) => ({ id: m.id, nome: m.label, nota: m.note, preco_usd_por_milhao: { entrada: m.price[0], saida: m.price[1] } })) }; } },
  { name: 'agente_ficha', level: 'read', description: 'Lê a ficha completa de um agente: instruções, procedimentos, exemplos, conhecimento, oficina (kits, verificação, limites), modo de envio, modelo e acessos.', input: obj({ agente_id: S('id do agente') }, ['agente_id']),
    run: async ({ api, state }, a) => {
      const p = await api('GET', `/api/agents/${enc(a.agente_id)}/profile`);
      const s = await state();
      const ag = s.agents.find((x) => x.id === a.agente_id);
      return { agente: { id: ag?.id, nome: ag?.name, cargo: ag?.role, reporta_a: ag?.reportsTo, acessos: ag?.access || {} }, ficha: p.profile, oficina: p.workshop, conhecimento: p.knowledge, prompt_tokens: p.promptTokens };
    } },
  { name: 'tarefas_listar', level: 'read', description: 'Lista tarefas, com filtros opcionais por status (todo, doing, review, blocked, done) e responsável.', input: obj({ status: S('Opcional'), responsavel_id: S('Opcional'), limite: N('Padrão 30') }),
    run: async ({ state }, a) => {
      const s = await state();
      return s.tasks.filter((t) => (!a.status || t.status === a.status) && (!a.responsavel_id || t.assigneeId === a.responsavel_id)).slice(-(a.limite || 30)).reverse()
        .map((t) => ({ id: t.id, titulo: t.title, status: t.status, responsavel_id: t.assigneeId, criada_por: t.creatorId, resultado: short(t.result, 300) }));
    } },
  { name: 'tarefa_ver', level: 'read', description: 'Detalhe de uma tarefa: descrição, resultado e o trabalho na oficina (plano, passos, PR, custo).', input: obj({ tarefa_id: S('id da tarefa, ex.: T12') }, ['tarefa_id']),
    run: async ({ state }, a) => {
      const s = await state();
      const t = s.tasks.find((x) => x.id === a.tarefa_id);
      if (!t) throw new Error('Tarefa não encontrada');
      const j = (s.jobs || []).filter((x) => x.taskId === t.id).at(-1);
      return { ...t, oficina: j ? { status: j.status, fase: j.phaseText, plano: j.plan, ultimos_passos: (j.steps || []).slice(-10), pr: j.pr, custo_usd: j.costUsd, erro: j.error } : null };
    } },
  { name: 'aprovacoes_listar', level: 'read', description: 'Rascunhos e mudanças aguardando aprovação (respostas a clientes, mudanças no Google Ads).', input: obj({}),
    run: async ({ state }) => (await state()).approvals.map((x) => ({ id: x.id, canal: x.channel, agente_id: x.agentId, para: x.preview?.para, assunto: x.preview?.assunto, texto: short(x.text, 1200), quando: iso(x.ts) })) },
  { name: 'conversas_listar', level: 'read', description: 'Lista as conversas (pares de participantes) com a última mensagem. Filtre por tipo: comigo, equipe, pessoas, clientes.', input: obj({ tipo: S('Opcional') }),
    run: async ({ api }, a) => (await api('GET', '/api/threads')).filter((t) => !a.tipo || t.kind === a.tipo).slice(0, 50).map((t) => ({ chave: t.key, participantes: t.ids, tipo: t.kind, mensagens: t.count, ultima: { de: t.last.from, texto: t.last.content, quando: iso(t.last.ts) } })) },
  { name: 'conversa_ler', level: 'read', description: 'Lê as mensagens de uma conversa (use a chave de conversas_listar).', input: obj({ chave: S('chave da conversa, ex.: backend|dono') }, ['chave']),
    run: async ({ api }, a) => (await api('GET', `/api/threads/messages?key=${enc(a.chave)}`)).messages.map((m) => ({ de: m.from, para: m.to, texto: m.content, quando: iso(m.ts) })) },
  { name: 'agente_log', level: 'read', description: 'Log completo do que um agente fez (mensagens, tarefas, ferramentas, oficina, arquivos, erros), mais recente primeiro.', input: obj({ agente_id: S('id'), tipos: S('Opcional, separados por vírgula: message,task,tool,job,text,file,error,system'), busca: S('Opcional'), limite: N('Padrão 60') }, ['agente_id']),
    run: async ({ api }, a) => (await api('GET', `/api/agents/${enc(a.agente_id)}/activity?limit=${Math.min(a.limite || 60, 200)}&types=${enc(a.tipos || '')}&q=${enc(a.busca || '')}`)).items.map((e) => ({ quando: iso(e.ts), tipo: e.type, nome: e.name, texto: short(e.text, 500), tarefa: e.task, ok: e.ok })) },
  { name: 'rotinas_listar', level: 'read', description: 'Rotinas configuradas (tarefas e reuniões recorrentes) com agenda, próxima e última execução.', input: obj({}),
    run: async ({ api }) => (await api('GET', '/api/routines')).routines.map((r) => ({ id: r.id, nome: r.name, tipo: r.kind === 'meeting' ? 'reuniao' : 'tarefa', agenda: r.scheduleText, ativa: r.enabled, responsavel_id: r.assigneeId, participantes: r.participants, proxima: iso(r.nextRunAt), ultima: r.lastRun ? { status: r.lastRun.status, quando: iso(r.lastRun.startedAt), execucao_id: r.lastRun.id } : null })) },
  { name: 'rotina_execucao', level: 'read', description: 'O que aconteceu numa execução de rotina: conversa e ata (reunião) ou tarefa e resultado. Sem execucao_id, traz a última da rotina.', input: obj({ rotina_id: S('id da rotina'), execucao_id: S('Opcional') }, ['rotina_id']),
    run: async ({ api }, a) => {
      const runId = a.execucao_id || (await api('GET', `/api/routines/${enc(a.rotina_id)}/runs`))[0]?.id;
      if (!runId) return { aviso: 'Esta rotina ainda não rodou.' };
      const r = await api('GET', `/api/routine-runs/${enc(runId)}`);
      return { execucao: r.run, ata: r.detail?.ata, conversa: (r.detail?.transcript || []).map((t) => ({ de: t.from, texto: t.text })), tarefa: r.task ? { id: r.task.id, status: r.task.status, resultado: r.task.result } : null };
    } },
  { name: 'arquivos_listar', level: 'read', description: 'Lista os arquivos da empresa (caminho, tamanho, quem fez).', input: obj({ pasta: S('Opcional: filtra por pasta') }),
    run: async ({ api }, a) => (await api('GET', '/api/files')).files.filter((f) => !a.pasta || f.path.startsWith(a.pasta)).slice(0, 300).map((f) => ({ caminho: f.path, tamanho: f.size, por: f.by, tarefa: f.task })) },
  { name: 'arquivo_ler', level: 'read', description: 'Lê um arquivo de texto da empresa (Markdown, CSV, JSON, TXT; até 200 KB).', input: obj({ caminho: S('caminho do arquivo') }, ['caminho']),
    run: async ({ apiRaw }, a) => { const r = await apiRaw('GET', `/api/file?path=${enc(a.caminho)}`); const type = r.headers.get('content-type') || ''; if (!/text|json|markdown|csv/.test(type)) return { aviso: `Arquivo binário (${type}): abra pela aba Arquivos.` }; return (await r.text()).slice(0, 200_000); } },
  { name: 'integracoes_listar', level: 'read', description: 'Integrações conectadas e quem tem acesso a cada uma, com as permissões possíveis (para usar em acesso_definir).', input: obj({}),
    run: async ({ api }) => { const d = await api('GET', '/api/integrations'); return { conectadas: d.connected.map((c) => ({ tipo: c.type, conta: c.account, agentes: c.agents })), catalogo: d.catalog.filter((c) => c.status === 'available').map((c) => ({ tipo: c.type, nome: c.name, permissoes: (c.perms || []).map((p) => ({ id: p.id, nome: p.label })) })) }; } },

  // ===== operação =====
  { name: 'tarefa_criar', level: 'operate', description: 'Cria uma tarefa para um agente (vai para a oficina dele) ou para uma pessoa. Descreva o que fazer e o critério de pronto.', input: obj({ titulo: S('Título curto'), descricao: S('O que fazer e critério de pronto'), responsavel_id: S('id do agente ou pessoa') }, ['titulo', 'responsavel_id']),
    run: async ({ api }, a) => { const t = await api('POST', '/api/tasks', { title: a.titulo, description: a.descricao || '', assigneeId: a.responsavel_id }); return { ok: true, tarefa_id: t.id }; } },
  { name: 'tarefa_atualizar', level: 'operate', description: 'Muda o status de uma tarefa (todo, doing, review, done, blocked) e/ou registra um resultado.', input: obj({ tarefa_id: S('id'), status: S('Opcional'), resultado: S('Opcional') }, ['tarefa_id']),
    run: async ({ api }, a) => { await api('POST', `/api/tasks/${enc(a.tarefa_id)}/update`, { status: a.status, result: a.resultado }); return { ok: true }; } },
  { name: 'tarefa_ajuste', level: 'operate', description: 'Pede ajuste numa tarefa já entregue por um agente: ela volta para a oficina continuando de onde parou (mesma branch/PR).', input: obj({ tarefa_id: S('id'), texto: S('O que ajustar') }, ['tarefa_id', 'texto']),
    run: async ({ api }, a) => { await api('POST', `/api/tasks/${enc(a.tarefa_id)}/adjust`, { text: a.texto }); return { ok: true }; } },
  { name: 'mensagem_enviar', level: 'operate', description: 'Manda uma mensagem (ou uma ordem/objetivo) para um agente ou pessoa. Sem para_id, vai para o líder de topo.', input: obj({ texto: S('Mensagem'), para_id: S('Opcional: id do destinatário') }, ['texto']),
    run: async ({ api }, a) => { await api('POST', '/api/goal', { text: a.texto, to: a.para_id }); return { ok: true }; } },
  { name: 'rotina_rodar', level: 'operate', description: 'Roda uma rotina agora (fora do horário).', input: obj({ rotina_id: S('id') }, ['rotina_id']),
    run: async ({ api }, a) => { await api('POST', `/api/routines/${enc(a.rotina_id)}/run`); return { ok: true, aviso: 'Rodando. Veja o resultado com rotina_execucao em instantes.' }; } },

  // ===== administração =====
  { name: 'agente_contratar', level: 'admin', admin: true, description: 'Contrata um agente de IA. Pode partir de um cargo do catálogo (catalogo_cargo) e personalizar. Define a quem reporta (chefe_id; use o id do dono para responder ao fundador).', input: obj({
    nome: S('Nome do agente, ex.: "Rafael Costa"'), cargo: S('Cargo curto, ex.: CTO'), titulo: S('Opcional, ex.: Diretor de Tecnologia'), catalogo_cargo: S('Opcional: chave do catálogo (ex.: cto) para herdar instruções padrão'),
    chefe_id: S('Opcional: id de quem ele responde'), instrucoes: S('Opcional: instruções (persona, responsabilidades, regras); somam-se às do catálogo'), modelo: S('Opcional: id do modelo de IA'), cor: S('Opcional: #rrggbb'),
  }, ['nome', 'cargo']),
    run: async ({ api }, a) => {
      let base = null;
      if (a.catalogo_cargo) base = (await api('GET', '/api/catalog')).roles.find((r) => r.key === a.catalogo_cargo);
      const ag = await api('POST', '/api/agents', { name: a.nome, role: a.cargo, title: a.titulo || base?.title || a.cargo, reportsTo: a.chefe_id || null, color: a.cor || base?.color, prompt: [base?.prompt, a.instrucoes].filter(Boolean).join('\n\n') });
      if (a.modelo) { const p = (await api('GET', `/api/agents/${enc(ag.id)}/profile`)).profile; await api('PUT', `/api/agents/${enc(ag.id)}/profile`, { ...p, model: a.modelo }); }
      return { ok: true, agente_id: ag.id, nome: ag.name, reporta_a: ag.reportsTo };
    } },
  { name: 'agente_editar', level: 'admin', admin: true, description: 'Edita nome, cargo, título, cor ou chefe (organograma) de um agente ou pessoa.', input: obj({ agente_id: S('id'), nome: S('Opcional'), cargo: S('Opcional'), titulo: S('Opcional'), chefe_id: S('Opcional (vazio = topo)'), cor: S('Opcional') }, ['agente_id']),
    run: async ({ api }, a) => {
      const body = {};
      if (a.nome) body.name = a.nome; if (a.cargo) body.role = a.cargo; if (a.titulo) body.title = a.titulo; if (a.cor) body.color = a.cor;
      if (a.chefe_id !== undefined) body.reportsTo = a.chefe_id || null;
      const r = await api('PUT', `/api/agents/${enc(a.agente_id)}`, body);
      return { ok: true, agente: { id: r.id, nome: r.name, cargo: r.role, reporta_a: r.reportsTo } };
    } },
  { name: 'agente_demitir', level: 'admin', admin: true, description: 'Demite um agente de IA (ou remove uma pessoa). Quem respondia a ele passa a responder ao chefe dele. Exige confirmar=true.', input: obj({ agente_id: S('id'), confirmar: B('Precisa ser true') }, ['agente_id', 'confirmar']),
    run: async ({ api }, a) => { if (a.confirmar !== true) throw new Error('Confirme com confirmar=true (ação irreversível).'); await api('DELETE', `/api/agents/${enc(a.agente_id)}`); return { ok: true }; } },
  { name: 'agente_ficha_editar', level: 'admin', admin: true, description: 'Edita a ficha de um agente. Só os campos enviados mudam; a versão anterior fica no histórico.', input: obj({
    agente_id: S('id'), instrucoes: S('Opcional (substitui)'), procedimentos: S('Opcional (substitui)'), exemplos: S('Opcional (substitui)'),
    modelo: S('Opcional: id do modelo ("" = padrão da empresa)'), escalar_para_id: S('Opcional: pessoa que recebe escalonamentos'),
    envio_email: S('Opcional: approval ou auto'), envio_chat: S('Opcional: approval ou auto'), envio_whatsapp: S('Opcional: approval ou auto'),
    oficina_pesquisa_web: B('Opcional'), oficina_navegador: B('Opcional'), oficina_verificacao: S('Opcional'), oficina_custo_max_usd: N('Opcional'),
    codigo_repositorio: S('Opcional'), codigo_setup: S('Opcional'), codigo_testes: S('Opcional'), codigo_merge_automatico: B('Opcional'),
  }, ['agente_id']),
    run: async ({ api }, a) => {
      const p = (await api('GET', `/api/agents/${enc(a.agente_id)}/profile`)).profile;
      if (a.instrucoes !== undefined) p.instructions = a.instrucoes;
      if (a.procedimentos !== undefined) p.procedures = a.procedimentos;
      if (a.exemplos !== undefined) p.examples = a.exemplos;
      if (a.modelo !== undefined) p.model = a.modelo;
      if (a.escalar_para_id !== undefined) p.escalation = { ...p.escalation, to: a.escalar_para_id };
      for (const ch of ['email', 'chat', 'whatsapp']) if (a[`envio_${ch}`]) p.sendMode = { ...p.sendMode, [ch]: a[`envio_${ch}`] };
      const w = p.workshop;
      if (a.oficina_pesquisa_web !== undefined) w.research = a.oficina_pesquisa_web;
      if (a.oficina_navegador !== undefined) w.browser = a.oficina_navegador;
      if (a.oficina_verificacao !== undefined) w.verify = a.oficina_verificacao;
      if (a.oficina_custo_max_usd !== undefined) w.maxBudgetUsd = a.oficina_custo_max_usd;
      if (a.codigo_repositorio !== undefined) w.code.repo = a.codigo_repositorio;
      if (a.codigo_setup !== undefined) w.code.setup = a.codigo_setup;
      if (a.codigo_testes !== undefined) w.code.test = a.codigo_testes;
      if (a.codigo_merge_automatico !== undefined) w.code.autoMerge = a.codigo_merge_automatico;
      await api('PUT', `/api/agents/${enc(a.agente_id)}/profile`, p);
      return { ok: true };
    } },
  { name: 'acesso_definir', level: 'admin', admin: true, description: 'Dá ou tira acesso de um agente a uma integração conectada (lista vazia = sem acesso). Veja tipos e permissões em integracoes_listar.', input: obj({ agente_id: S('id'), integracao: S('tipo, ex.: github, whatsapp, google_ads'), permissoes: { type: 'array', items: { type: 'string' }, description: 'ids das permissões, ex.: ["read","pr","code"]' }, recursos: { type: 'array', items: { type: 'string' }, description: 'Opcional: limitar a repositórios/caixas/projetos' } }, ['agente_id', 'integracao', 'permissoes']),
    run: async ({ api }, a) => { const r = await api('PUT', `/api/agents/${enc(a.agente_id)}/access/${enc(a.integracao)}`, { perms: a.permissoes, resources: a.recursos || [] }); return { ok: true, acesso: r.access }; } },
  { name: 'empresa_editar', level: 'admin', admin: true, description: 'Atualiza dados e contexto da empresa (o que todos os agentes sabem sobre o negócio).', input: obj({ nome: S('Opcional'), segmento: S('Opcional'), site: S('Opcional'), descricao: S('Opcional'), missao: S('Opcional'), contexto: S('Opcional: produto, clientes, tom de voz, regras') }),
    run: async ({ api }, a) => {
      const map = { nome: 'name', segmento: 'segment', site: 'website', descricao: 'description', missao: 'mission', contexto: 'context' };
      const body = Object.fromEntries(Object.entries(a).filter(([k, v]) => map[k] && v !== undefined).map(([k, v]) => [map[k], v]));
      await api('PUT', '/api/company', body);
      return { ok: true };
    } },
  { name: 'rotina_salvar', level: 'admin', admin: true, description: 'Cria (sem rotina_id) ou edita uma rotina. Tipo "task": um agente executa (responsavel_id). Tipo "meeting": reunião com participantes e facilitador; encaminhamentos podem virar tarefas.', input: obj({
    rotina_id: S('Opcional: para editar'), nome: S('Nome'), tipo: S('task ou meeting'), instrucoes: S('O que fazer em cada execução'),
    frequencia: S('daily, weekdays, weekly ou monthly'), dias_semana: { type: 'array', items: { type: 'number' }, description: 'Para weekly: 0=dom … 6=sáb' }, dia_do_mes: N('Para monthly'), horario: S('HH:MM (fuso da empresa)'),
    responsavel_id: S('Para task'), participantes: { type: 'array', items: { type: 'string' }, description: 'Para meeting: ids' }, facilitador_id: S('Para meeting'),
    criar_tarefas: B('Para meeting: encaminhamentos viram tarefas'), pasta: S('Opcional: pasta das entregas'), ativa: B('Padrão true'),
  }, ['nome', 'tipo', 'frequencia', 'horario']),
    run: async ({ api }, a) => {
      const body = { name: a.nome, kind: a.tipo, instructions: a.instrucoes, folder: a.pasta, enabled: a.ativa !== false, assigneeId: a.responsavel_id, participants: a.participantes, facilitatorId: a.facilitador_id, createTasks: a.criar_tarefas,
        schedule: { freq: a.frequencia, days: a.dias_semana || [], dayOfMonth: a.dia_do_mes, time: a.horario } };
      const r = a.rotina_id ? await api('PUT', `/api/routines/${enc(a.rotina_id)}`, body) : await api('POST', '/api/routines', body);
      return { ok: true, rotina_id: r.id, agenda: r.scheduleText, proxima: iso(r.nextRunAt) };
    } },
  { name: 'rotina_remover', level: 'admin', admin: true, description: 'Remove uma rotina (o histórico fica). Exige confirmar=true.', input: obj({ rotina_id: S('id'), confirmar: B('Precisa ser true') }, ['rotina_id', 'confirmar']),
    run: async ({ api }, a) => { if (a.confirmar !== true) throw new Error('Confirme com confirmar=true.'); await api('DELETE', `/api/routines/${enc(a.rotina_id)}`); return { ok: true }; } },
  { name: 'aprovacao_decidir', level: 'admin', admin: true, description: 'Aprova (envia/aplica) ou descarta um item de aprovacoes_listar. Ao aprovar resposta a cliente, pode corrigir o texto. Ao descartar, a orientação volta para o agente refazer.', input: obj({ aprovacao_id: S('id'), decisao: S('aprovar ou descartar'), texto: S('Opcional: texto final (respostas a clientes)'), orientacao: S('Opcional: ao descartar, o que o agente deve mudar') }, ['aprovacao_id', 'decisao']),
    run: async ({ api }, a) => {
      if (a.decisao === 'aprovar') { await api('POST', `/api/approvals/${enc(a.aprovacao_id)}/approve`, a.texto ? { text: a.texto } : {}); return { ok: true, feito: 'aprovado' }; }
      if (a.decisao === 'descartar') { await api('POST', `/api/approvals/${enc(a.aprovacao_id)}/reject`, { reason: a.orientacao || '' }); return { ok: true, feito: 'descartado' }; }
      throw new Error('decisao deve ser "aprovar" ou "descartar"');
    } },
  { name: 'obra_controle', level: 'admin', admin: true, description: 'Pausa ou retoma o trabalho de todos os agentes.', input: obj({ acao: S('pausar ou retomar') }, ['acao']),
    run: async ({ api }, a) => { const action = { pausar: 'pause', retomar: 'resume' }[a.acao]; if (!action) throw new Error('acao: pausar ou retomar'); await api('POST', '/api/control', { action }); return { ok: true }; } },
];
const enc = encodeURIComponent;

function toolsFor(token, member) {
  return TOOLS.filter((t) => LEVELS[token.level] >= LEVELS[t.level] && (!t.admin || hasRole(member, 'admin')));
}

function buildServer(auth, rawHeader) {
  const server = new Server({ name: 'iaorg', version: '1.0.0' }, {
    capabilities: { tools: {} },
    instructions: `IAORG: empresa "${auth.store.company.name}" com agentes de IA e pessoas. Você age como ${auth.member.name} (${auth.member.role}), com token de nível ${auth.token.level}. Comece com empresa_resumo para ver ids e organograma. Ações ficam registradas no diário da empresa.`,
  });
  const apiRaw = (method, path, body) => fetch(`http://127.0.0.1:${PORT}${path}`, {
    method, headers: { Authorization: rawHeader, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined,
  });
  const api = async (method, path, body) => {
    const r = await apiRaw(method, path, body);
    const data = await r.json().catch(() => null);
    if (!r.ok) throw new Error(data?.error || `Erro ${r.status}`);
    return data;
  };
  const ctx = { api, apiRaw, state: () => api('GET', '/api/state') };
  const allowedTools = toolsFor(auth.token, auth.member);
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: allowedTools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.input })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const t = allowedTools.find((x) => x.name === req.params.name);
    if (!t) return { content: [{ type: 'text', text: `Ferramenta indisponível para este token: ${req.params.name}` }], isError: true };
    try {
      const out = await t.run(ctx, req.params.arguments || {});
      return { content: [{ type: 'text', text: typeof out === 'string' ? out : JSON.stringify(out, null, 2) }] };
    } catch (e) {
      return { content: [{ type: 'text', text: `Erro: ${e.message}` }], isError: true };
    }
  });
  return server;
}

export function mountMcp(app) {
  app.post('/mcp', async (req, res) => {
    const auth = authenticate(req.headers.authorization);
    if (!auth || auth.error) {
      return res.status(auth?.status || 401).json({ jsonrpc: '2.0', error: { code: -32001, message: auth?.error || 'Envie o cabeçalho Authorization: Bearer iaorg_… (crie o token em Ajustes → Acesso por IA)' }, id: null });
    }
    const server = buildServer(auth, req.headers.authorization);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { transport.close(); server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      console.error('[mcp]', e);
      if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Erro interno' }, id: null });
    }
  });
  const notAllowed = (req, res) => res.status(405).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Use POST (servidor sem sessão).' }, id: null });
  app.get('/mcp', notAllowed);
  app.delete('/mcp', notAllowed);
}

export const MCP_TOOL_COUNT = TOOLS.length;
