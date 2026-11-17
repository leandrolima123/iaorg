// Ficha do agente (abas), base de conhecimento da empresa e fila de aprovações.
import { $, $$, esc, api, toast, ic } from './common.js';

const TABS = [
  ['instructions', 'Instruções'], ['procedures', 'Procedimentos'], ['examples', 'Exemplos'], ['knowledge', 'Conhecimento'],
  ['variables', 'Variáveis'], ['behavior', 'Escalonamento e envio'], ['workshop', 'Oficina'], ['memory', 'Memória'], ['model', 'Modelo'], ['test', 'Testar'], ['history', 'Histórico'],
];
const fmtK = (n) => (n >= 1000 ? `${(n / 1000).toFixed(1).replace('.', ',')} mil` : String(n));
const when = (ts) => new Date(ts).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const readFiles = (files) => Promise.all([...files].map((f) => f.text().then((content) => ({ name: f.name, content }))));

// Exemplos de preenchimento conforme o cargo (só como placeholder; a ficha serve para qualquer função).
const ROLE_HINTS = [
  [/back|front|dev|engenh|cto|mobile|qa|devops|dados|data/i, {
    instructions: 'Você é {{nome_agente}}, responsável pelo backend da {{empresa}}.\n\n## Stack e padrões\n- Node 22, Postgres… testes antes de abrir PR\n\n## Regras\n- Nunca commitar direto na main; sempre branch + PR\n- Nunca expor segredos em código ou logs',
    procedures: '## Ao receber uma tarefa\n1. Ler o código relacionado no repositório\n2. Propor a mudança em passos pequenos\n3. Abrir PR com descrição e como testar\n\n## Incidente em produção\n1. Ver logs e últimos deploys no Railway\n2. …',
    examples: '<example>\nPedido: "Crie o endpoint de exportar pacientes em CSV"\nComo agir: lê o módulo de pacientes, cria a tarefa de testes para QA, abre PR com…\n</example>',
    test: 'Ex.: Analise os últimos commits do repositório e me diga o que mudou',
  }],
  [/market|vendas|growth|conte|social|comercial/i, {
    instructions: 'Você é {{nome_agente}}, de marketing da {{empresa}}.\n\n## Público e posicionamento\n…\n\n## Tom de voz\n…\n\n## Regras\n- Nada de promessas que o produto não cumpre',
    procedures: '## Post para redes\n1. Definir objetivo e público\n2. …\n\n## Campanha de e-mail\n1. …',
    examples: '<example>\nPedido: "Escreva 3 posts sobre o lançamento"\nResposta esperada: …\n</example>',
    test: 'Ex.: Escreva 3 ideias de post para o Instagram desta semana',
  }],
  [/cs|suporte|atend|customer|success|sac/i, {
    instructions: 'Você é {{nome_agente}}, do atendimento da {{empresa}}. Canal: {{canal}}. Cliente: {{nome_cliente}}…',
    procedures: '## Cancelamento\n1. Confirme o e-mail da conta…',
    examples: '<example>\nCliente: Esqueci minha senha\nResposta: …\n</example>',
    test: 'Ex.: Oi, fui cobrada duas vezes este mês, podem verificar?',
  }],
];
const DEFAULT_HINT = {
  instructions: 'Você é {{nome_agente}}, {{cargo_agente}} da {{empresa}}.\n\n## Responsabilidades\n…\n\n## Como trabalha\n…\n\n## Regras\n…',
  procedures: '## Situação recorrente 1\n1. …\n2. …',
  examples: '<example>\nPedido: …\nComo agir / resposta esperada: …\n</example>',
  test: 'Ex.: Qual a sua prioridade esta semana?',
};
const hintFor = (agent) => ROLE_HINTS.find(([re]) => re.test(`${agent?.role} ${agent?.title}`))?.[1] || DEFAULT_HINT;

let tab = 'instructions';
const testState = {}; // modo e texto do simulador sobrevivem a trocas de aba
let draft = null; // edição não salva da ficha atual
let draftFor = null;

/** Editor da ficha de um agente de IA. ctx = { agentId, canEdit } */
export async function renderProfile(root, ctx) {
  const data = await api('GET', `/api/agents/${ctx.agentId}/profile`);
  if (draftFor !== ctx.agentId) { draft = JSON.parse(JSON.stringify(data.profile)); draftFor = ctx.agentId; }
  const dis = ctx.canEdit ? '' : 'disabled';
  const dirty = JSON.stringify(draft) !== JSON.stringify(data.profile);
  const hint = hintFor(ctx.agent);
  const facing = Object.keys(data.channels).length > 0; // fala com clientes externos?
  const tabLabel = (id, label) => (id === 'behavior' ? (facing ? 'Escalonamento e envio' : 'Escalonamento') : label);

  root.innerHTML = `
    <div class="profile">
      <div class="profile-head">
        <div class="profile-tabs" role="tablist">${TABS.map(([id, label]) => `<button type="button" role="tab" class="ptab ${tab === id ? 'on' : ''}" data-ptab="${id}" aria-selected="${tab === id}">${tabLabel(id, label)}</button>`).join('')}</div>
        <div class="profile-meta">
          <span class="hint num">Prompt ~${fmtK(data.promptTokens)} tokens · conhecimento: ${data.knowledge.mode === 'none' ? 'nenhum' : data.knowledge.mode === 'inline' ? `inteiro no prompt (${data.knowledge.chunks} trechos)` : `por busca (${data.knowledge.chunks} trechos)`}</span>
          ${ctx.canEdit ? `<button type="button" class="btn small primary" data-save ${dirty ? '' : 'disabled'}>${ic('check', 'sm')}Salvar ficha</button>` : ''}
        </div>
      </div>
      <div class="profile-body" data-body></div>
    </div>`;

  const body = $('[data-body]', root);
  const mdTab = (key, help, placeholder) => {
    body.innerHTML = `<p class="hint">${help}</p>
      <textarea class="md" data-field="${key}" ${dis} placeholder="${esc(placeholder)}" spellcheck="false">${esc(draft[key])}</textarea>
      <div class="row md-foot"><span class="hint num" data-count></span>${ctx.canEdit ? `<label class="btn small">${ic('upload', 'sm')}Importar .md<input type="file" accept=".md,.txt,.markdown" hidden data-import></label>` : ''}</div>`;
    const ta = $('textarea', body);
    const count = () => { $('[data-count]', body).textContent = `${ta.value.length.toLocaleString('pt-BR')} caracteres · ~${fmtK(Math.ceil(ta.value.length / 3.6))} tokens`; };
    count();
    ta.addEventListener('input', () => { draft[key] = ta.value; count(); markDirty(); });
    $('[data-import]', body)?.addEventListener('change', async (e) => {
      const [f] = await readFiles(e.target.files);
      if (!f) return;
      draft[key] = f.content; ta.value = f.content; count(); markDirty();
      toast(`${f.name} importado — confira e salve`);
    });
  };
  const markDirty = () => { const b = $('[data-save]', root); if (b) b.disabled = JSON.stringify(draft) === JSON.stringify(data.profile); };

  const views = {
    instructions: () => mdTab('instructions', 'Papel e responsabilidades, como o agente trabalha, padrões de qualidade, tom de comunicação e regras que nunca pode quebrar. Use {{variáveis}} onde precisar (aba Variáveis).', hint.instructions),
    procedures: () => mdTab('procedures', 'Passo a passo para as situações recorrentes do cargo (playbooks). Entram no prompt logo depois das instruções.', hint.procedures),
    examples: () => mdTab('examples', 'Pedidos-modelo com a resposta ou a forma de agir esperada (3 a 5 é o ideal, variados, incluindo casos difíceis). Entram no fim do prompt, dentro de <examples>, e são o jeito mais confiável de acertar formato e critério.', hint.examples),
    knowledge: () => {
      body.innerHTML = `<p class="hint">Escolha quais coleções da base de conhecimento da empresa este agente usa. Até ~${fmtK(data.knowledge.inlineLimit)} tokens a base vai inteira no prompt (com cache, mais barato e mais preciso); acima disso o agente ganha a ferramenta de busca.</p>
        <div class="kb-pick">${data.collections.map((c) => `<label class="repo"><input type="checkbox" value="${c.id}" ${draft.knowledge.includes(c.id) ? 'checked' : ''} ${dis}>
          <b>${esc(c.name)}</b><span class="hint">${c.chunks} trechos · ~${fmtK(c.tokens)} tokens${c.categories.length ? ` · ${c.categories.slice(0, 6).map(esc).join(', ')}` : ''}</span></label>`).join('') || '<p class="hint" style="padding:12px">Nenhuma coleção ainda. Use "Base de conhecimento" no topo da aba Equipe para importar.</p>'}</div>`;
      $$('.kb-pick input', body).forEach((i) => i.addEventListener('change', () => {
        draft.knowledge = $$('.kb-pick input:checked', body).map((x) => x.value); markDirty();
      }));
    },
    variables: () => {
      const keys = [...new Set([...data.placeholders.filter((k) => !data.dynamicVars.includes(k) && !['empresa', 'site', 'segmento', 'nome_agente', 'cargo_agente'].includes(k)), ...Object.keys(draft.variables)])];
      body.innerHTML = `<p class="hint">Valores que substituem as <code>{{variáveis}}</code> nos textos da ficha. Automáticas: <code>{{empresa}}</code>, <code>{{site}}</code>, <code>{{segmento}}</code>, <code>{{nome_agente}}</code>, <code>{{cargo_agente}}</code>.${data.dynamicVars.length ? ` Preenchidas a cada conversa com cliente: ${data.dynamicVars.map((v) => `<code>{{${v}}}</code>`).join(' ')}.` : ''} Variáveis sem valor são removidas do texto.</p>
        <div class="vars">${keys.map((k) => `<label class="field"><span>{{${esc(k)}}}${data.placeholders.includes(k) ? '' : ' · não usada nos textos'}</span><textarea rows="2" data-var="${esc(k)}" ${dis}>${esc(draft.variables[k] || '')}</textarea></label>`).join('') || '<p class="hint">Nenhuma variável usada nos textos ainda.</p>'}</div>
        ${ctx.canEdit ? '<div class="row"><input data-newvar placeholder="nova_variavel" style="max-width:240px"><button type="button" class="btn small" data-addvar>Adicionar variável</button></div>' : ''}`;
      $$('[data-var]', body).forEach((t) => t.addEventListener('input', () => { draft.variables[t.dataset.var] = t.value; markDirty(); }));
      $('[data-addvar]', body)?.addEventListener('click', () => {
        const k = $('[data-newvar]', body).value.trim().replace(/[^\w.-]/g, '');
        if (!k) return;
        draft.variables[k] = draft.variables[k] || ''; markDirty(); views.variables();
      });
    },
    behavior: () => {
      body.innerHTML = `<div class="form">
        <label class="field"><span>Escalar casos para</span><select data-esc ${dis}><option value="">Dono da empresa</option>${data.people.map((p) => `<option value="${p.id}" ${draft.escalation.to === p.id ? 'selected' : ''}>${esc(p.name)} — ${esc(p.role)}</option>`).join('')}</select></label>
        <div></div>
        <label class="field full"><span>Quando escalar (opcional)</span><textarea rows="3" data-escnote ${dis} placeholder="${facing ? 'Ex.: reembolso, nota fiscal, exclusão de conta e remoção de 2FA sempre vão para uma pessoa.' : 'Ex.: mudança de arquitetura, migração de banco, custo novo de infraestrutura ou qualquer coisa em produção fora do horário.'}">${esc(draft.escalation.note)}</textarea></label>
        <p class="hint full">O agente escala com a ferramenta <code>escalar_para_humano</code> (vira uma tarefa para a pessoa acima) ou com uma linha <code>[ESCALAR] motivo</code>.</p>
        ${facing ? `${Object.entries(data.channels).map(([ch, label]) => `<div class="field"><span>${label}: envio ao cliente</span>
          <div class="seg">${[['approval', 'Rascunho para aprovação'], ['auto', 'Automático']].map(([v, l]) => `<label><input type="radio" name="send_${ch}" value="${v}" ${draft.sendMode[ch] === v ? 'checked' : ''} ${dis}><span>${l}</span></label>`).join('')}</div></div>`).join('')}
        <p class="hint full">No modo rascunho, as respostas ao cliente vão para <b>Minha mesa → Aprovações</b>, onde você aprova, edita ou descarta. Recomendado até você confiar no tom.</p>`
        : '<p class="hint full">Este agente não fala com clientes externos. Se ele receber acesso a Resend, Gmail ou Crisp em Integrações, o modo de envio aparece aqui.</p>'}</div>`;
      $('[data-esc]', body)?.addEventListener('change', (e) => { draft.escalation.to = e.target.value; markDirty(); });
      $('[data-escnote]', body)?.addEventListener('input', (e) => { draft.escalation.note = e.target.value; markDirty(); });
      $$('.seg input', body).forEach((r) => r.addEventListener('change', () => { draft.sendMode[r.name.replace('send_', '')] = r.value; markDirty(); }));
    },
    model: () => {
      body.innerHTML = `<p class="hint">Modelo e profundidade só deste agente. Vazio = usa o padrão da empresa (${esc(data.companyModel)}).</p>
        ${(() => {
          const opt = (m) => `
          <label class="option"><input type="radio" name="model" value="${m.id}" ${draft.model === m.id ? 'checked' : ''} ${dis}><b>${esc(m.label)}</b><span class="hint">${esc(m.note)}</span>${m.price ? `<span class="hint num">US$ ${String(m.price[0]).replace('.', ',')} / ${String(m.price[1]).replace('.', ',')} por 1 mi tokens</span>` : ''}</label>`;
          const old = data.models.filter((m) => m.legacy);
          return `<div class="options">${[{ id: '', label: 'Padrão da empresa', note: data.companyModel, price: null }, ...data.models.filter((m) => !m.legacy)].map(opt).join('')}</div>
          ${old.length ? `<details class="legacy-models" ${old.some((m) => m.id === draft.model) ? 'open' : ''}><summary>Modelos da geração anterior (${old.length})</summary><div class="options">${old.map(opt).join('')}</div></details>` : ''}`;
        })()}
        <label class="field" style="max-width:320px;margin-top:14px"><span>Profundidade de raciocínio</span><select data-effort ${dis}>
          ${[['', 'Padrão da empresa'], ['low', 'Baixa — mais rápido e barato'], ['medium', 'Média'], ['high', 'Alta — mais cuidadoso']].map(([v, l]) => `<option value="${v}" ${draft.effort === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
      $$('input[name=model]', body).forEach((r) => r.addEventListener('change', () => { draft.model = r.value; markDirty(); }));
      $('[data-effort]', body)?.addEventListener('change', (e) => { draft.effort = e.target.value; markDirty(); });
    },
    test: () => {
      const testMode = facing ? (testState.mode || 'cliente') : 'ordem';
      const cust = testMode === 'cliente';
      body.innerHTML = `<p class="hint">Mande um pedido e veja o que o agente faria com a ficha <b>salva</b>. Leituras (arquivos, código, logs) rodam de verdade; ações que mudam algo (mensagens, tarefas, PRs, deploys, envios) só são mostradas, nada é executado. Usa o Claude de verdade (custa alguns centavos).</p>
        <div class="form">
          ${facing ? `<div class="field full"><span>Quem escreve</span><div class="seg">${[['ordem', 'Alguém da equipe'], ['cliente', 'Cliente']].map(([v, l]) => `<label><input type="radio" name="tmode" value="${v}" ${testMode === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div></div>` : ''}
          ${cust ? `<label class="field"><span>Canal</span><select data-canal>${Object.entries(data.channels).map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select></label>
          <label class="field"><span>Nome do cliente</span><input data-nome value="Dra. Carla Mendes"></label>` : ''}
          <label class="field full"><span>${cust ? 'Mensagem do cliente' : 'Seu pedido ou mensagem para o agente'}</span><textarea rows="3" data-msg placeholder="${esc(cust ? 'Ex.: Oi, fui cobrada duas vezes este mês, podem verificar?' : hint.test)}">${esc(testState.msg?.[testMode] || '')}</textarea></label>
          <div class="row full"><button type="button" class="btn primary" data-run>${ic('send', 'sm')}Simular</button>${dirty ? '<span class="hint">Você tem alterações não salvas: o teste usa a última versão salva.</span>' : ''}</div>
        </div>
        <div data-out></div>`;
      $$('input[name=tmode]', body).forEach((r) => r.addEventListener('change', () => { testState.mode = r.value; views.test(); }));
      $('[data-msg]', body).addEventListener('input', (e) => { (testState.msg ||= {})[testMode] = e.target.value; });
      const LABEL = { leitura: ['file-text', 'Leu'], busca: ['book-open', 'Consultou a base'], escalou: ['construction', '<b>Escalaria</b>'], acao: ['zap', '<b>Faria</b>'], ferramenta: ['zap', 'Usou'] };
      $('[data-run]', body).addEventListener('click', async (e) => {
        const msg = $('[data-msg]', body).value.trim();
        if (!msg) { toast('Escreva a mensagem', 'err'); return; }
        e.target.disabled = true;
        $('[data-out]', body).innerHTML = '<p class="hint">O agente está trabalhando…</p>';
        try {
          const r = await api('POST', `/api/agents/${ctx.agentId}/test`, cust ? { modo: 'cliente', message: msg, canal: $('[data-canal]', body).value, nome: $('[data-nome]', body).value } : { modo: 'ordem', message: msg });
          const steps = r.actions.filter((a) => a.tipo !== 'resposta');
          const title = r.tipo === 'cliente' ? `Resposta ao cliente ${r.modo === 'auto' ? '(sairia direto)' : '(viraria rascunho para aprovação)'}` : 'Resposta para você';
          $('[data-out]', body).innerHTML = `<div class="sim">
            <h4>${title}</h4>
            <div class="sim-reply">${r.reply ? esc(r.reply) : r.final ? esc(r.final) : '<span class="hint">O agente não respondeu.</span>'}</div>
            ${steps.length ? `<h4 style="margin-top:6px">O que ele fez</h4><ol class="sim-steps">${steps.map((a) => { const [icn, lab] = LABEL[a.tipo] || LABEL.ferramenta; return `<li>${ic(icn, 'sm')}<span>${lab}: ${esc(a.texto)}</span></li>`; }).join('')}</ol>` : ''}
            <p class="hint num">~${fmtK(r.usage.input)} tokens de entrada · ${fmtK(r.usage.output)} de saída</p></div>`;
        } catch (err) { $('[data-out]', body).innerHTML = `<p class="error">${esc(err.message)}</p>`; }
        e.target.disabled = false;
      });
    },
    workshop: () => {
      const W = draft.workshop;
      const ws = data.workshop;
      const k = ws.kits;
      const chip = (on, label) => `<span class="kit ${on ? 'on' : ''}">${ic(on ? 'square-check' : 'square', 'sm')}${label}</span>`;
      body.innerHTML = `<p class="hint">Quando recebe uma tarefa, o agente trabalha numa <b>oficina</b>: um ambiente isolado com o motor do Claude Code, onde ele planeja, executa, verifica e entrega. O que muda de um cargo para outro é o <b>kit</b>, que vem dos acessos dele e das opções abaixo.${ws.enabled ? '' : ' <b>A oficina não está ligada neste servidor</b> (falta o runner): as tarefas seguem no modo conversa.'}</p>
        <div class="kits">${chip(true, 'Base: arquivos, plano, equipe e tarefas')}${chip(!!k.code, k.code ? `Código: ${esc(k.code.repo)}` : 'Código')}${chip(W.research, 'Pesquisa na web')}${chip(W.browser, 'Navegador')}${chip(Object.keys(data.channels).length > 0, 'Atendimento')}${chip(data.tools.some((t) => t.startsWith('railway_')), 'Infra (Railway)')}${chip(data.tools.some((t) => t.startsWith('calendar_')), 'Agenda')}</div>
        <div class="form">
          <label class="check full"><input type="checkbox" data-w="research" ${W.research ? 'checked' : ''} ${dis}><span><b>Pesquisa na web</b>: buscar e ler páginas (concorrentes, referências, documentação).</span></label>
          <label class="check full"><input type="checkbox" data-w="browser" ${W.browser ? 'checked' : ''} ${dis}><span><b>Navegador</b>: abrir sites e o app, clicar, tirar prints e validar telas (os prints vão para Arquivos).</span></label>
          <label class="field full"><span>Verificação antes de entregar</span><textarea rows="3" data-w="verify" ${dis} placeholder="${esc(ws.verifyHint)}">${esc(W.verify)}</textarea></label>
          <p class="hint full" style="margin-top:-8px">Vazio = usa a sugestão para o cargo (texto acima, em cinza).</p>
          <label class="field"><span>Passos máximos por tarefa</span><input type="number" min="5" max="300" data-w="maxTurns" value="${W.maxTurns}" ${dis}></label>
          <label class="field"><span>Custo máximo por tarefa (US$)</span><input type="number" min="0.1" max="50" step="0.1" data-w="maxBudgetUsd" value="${W.maxBudgetUsd}" ${dis}></label>
          <label class="field"><span>Tempo máximo (minutos)</span><input type="number" min="5" max="180" data-w="timeoutMin" value="${W.timeoutMin}" ${dis}></label>
        </div>
        <h4 class="sub">Código</h4>
        ${ws.canCode ? `<div class="form">
          <label class="field"><span>Repositório</span><select data-c="repo" ${dis}>${ws.repos.map((r) => `<option ${W.code.repo === r || (!W.code.repo && r === ws.repos[0]) ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select></label>
          <label class="field"><span>Branch base</span><input data-c="baseBranch" value="${esc(W.code.baseBranch)}" placeholder="${esc(k.code?.base || 'main')} (padrão do repositório)" ${dis}></label>
          <label class="field full"><span>Instalar dependências (setup)</span><input data-c="setup" value="${esc(W.code.setup)}" placeholder="Ex.: cd backend && uv sync   ·   pnpm i   ·   ou .iaorg/setup.sh no repositório" ${dis}></label>
          <label class="field"><span>Comando de testes</span><input data-c="test" value="${esc(W.code.test)}" placeholder="Ex.: cd backend && uv run pytest -q" ${dis}></label>
          <label class="field"><span>Comando de lint (opcional)</span><input data-c="lint" value="${esc(W.code.lint)}" placeholder="Ex.: uv run ruff check ." ${dis}></label>
          <label class="check"><input type="checkbox" data-c="postgres" ${W.code.postgres ? 'checked' : ''} ${dis}><span>Postgres para os testes (DATABASE_URL)</span></label>
          <label class="check"><input type="checkbox" data-c="redis" ${W.code.redis ? 'checked' : ''} ${dis}><span>Redis para os testes (REDIS_URL)</span></label>
          <label class="check full"><input type="checkbox" data-c="autoMerge" ${W.code.autoMerge ? 'checked' : ''} ${dis}><span><b>Merge automático</b> quando os testes da oficina e o CI do GitHub passarem e não houver conflito. Sem CI, exige o comando de testes. Se a branch exigir revisão, o PR fica para você.</span></label>
          <label class="field"><span>Esperar o CI por até (minutos)</span><input type="number" min="0" max="120" data-c="ciWaitMin" value="${W.code.ciWaitMin}" ${dis}></label>
        </div>
        <p class="hint">O agente trabalha na branch <code>iaorg/&lt;tarefa&gt;</code>, faz commits e roda os testes; o IAORG envia a branch, abre o PR e cuida do CI e do merge. Push na branch principal é bloqueado.</p>`
        : '<p class="hint">Para este agente desenvolver (clonar, testar, commit, push e merge), dê a ele a permissão <b>Desenvolver na oficina</b> do GitHub em Integrações.</p>'}
        ${ws.enabled && ctx.canEdit ? `<h4 class="sub">Rodar uma tarefa de teste</h4>
        <p class="hint">Uma tarefa real na oficina, com a ficha <b>salva</b>. Nada irreversível sai: envios ficam em rascunho, não há merge, deploy nem evento de agenda. Acompanhe em Tarefas.</p>
        <div class="form"><label class="field full"><span>Tarefa</span><input data-tt placeholder="${esc(hint.test.replace(/^Ex\.: /, ''))}"></label>
          <label class="field full"><span>Detalhes e critério de pronto</span><textarea rows="2" data-td placeholder="O que entregar e como saber que ficou pronto"></textarea></label>
          <div class="row full"><button type="button" class="btn primary" data-wtest>${ic('hammer', 'sm')}Mandar para a oficina</button></div></div>` : ''}`;
      $$('[data-w]', body).forEach((el) => el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', () => {
        const key = el.dataset.w;
        W[key] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value;
        markDirty();
      }));
      $$('[data-c]', body).forEach((el) => el.addEventListener(el.type === 'checkbox' ? 'change' : 'input', () => {
        const key = el.dataset.c;
        W.code[key] = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value;
        markDirty();
      }));
      $('[data-wtest]', body)?.addEventListener('click', async (e) => {
        const title = $('[data-tt]', body).value.trim();
        if (!title) { toast('Escreva a tarefa', 'err'); return; }
        e.target.disabled = true;
        try {
          const r = await api('POST', `/api/agents/${ctx.agentId}/workshop-test`, { title, description: $('[data-td]', body).value });
          toast(`Tarefa ${r.taskId} na oficina — acompanhe em Tarefas`);
          $('[data-tt]', body).value = ''; $('[data-td]', body).value = '';
        } catch (err) { toast(err.message, 'err'); }
        e.target.disabled = false;
      });
    },
    memory: async () => {
      body.innerHTML = '<p class="hint">Carregando a memória…</p>';
      const m = await api('GET', `/api/agents/${ctx.agentId}/memory`);
      body.innerHTML = `<p class="hint">O que o agente aprendeu trabalhando: comandos, armadilhas, decisões e preferências. Ele lê no começo de cada tarefa e atualiza no fim. Você pode corrigir ou apagar o que estiver errado.</p>
        <textarea class="md" data-mem ${dis} placeholder="(vazia: o agente vai preenchendo conforme trabalha)">${esc(m.text)}</textarea>
        <div class="row md-foot"><span class="hint num">${m.text.length.toLocaleString('pt-BR')} caracteres</span>${ctx.canEdit ? `<button type="button" class="btn small primary" data-memsave>${ic('check', 'sm')}Salvar memória</button>` : ''}</div>
        ${m.history.length ? `<h4 class="sub">Versões anteriores</h4><ul class="people">${m.history.map((h) => `<li>${ic('clock', 'sm')}<span>${when(h.ts)} · ${esc(h.by || '—')} · ${h.size.toLocaleString('pt-BR')} caracteres</span>${ctx.canEdit ? `<button type="button" class="btn small" data-memrestore="${h.index}">Restaurar</button>` : ''}</li>`).join('')}</ul>` : ''}`;
      $('[data-memsave]', body)?.addEventListener('click', async () => {
        try { await api('PUT', `/api/agents/${ctx.agentId}/memory`, { text: $('[data-mem]', body).value }); toast('Memória salva'); views.memory(); } catch (e) { toast(e.message, 'err'); }
      });
      $$('[data-memrestore]', body).forEach((b) => b.addEventListener('click', async () => {
        if (!confirm('Restaurar esta versão da memória? A atual fica guardada.')) return;
        await api('PUT', `/api/agents/${ctx.agentId}/memory`, { restore: +b.dataset.memrestore }); toast('Memória restaurada'); views.memory();
      }));
    },
    history: () => {
      body.innerHTML = `<p class="hint">Cada vez que a ficha é salva, a versão anterior fica guardada (até 15).</p>
        <ul class="people" style="margin-top:8px">${data.history.map((h) => `<li>${ic('clock', 'sm')}<span>${when(h.ts)} · por ${esc(h.by || '—')}</span>${ctx.canEdit ? `<button type="button" class="btn small" data-restore="${h.index}">Restaurar esta versão</button>` : ''}</li>`).join('') || '<li class="hint">Nenhuma versão anterior ainda.</li>'}</ul>`;
      $$('[data-restore]', body).forEach((b) => b.addEventListener('click', async () => {
        if (!confirm('Restaurar esta versão? A atual também fica guardada no histórico.')) return;
        await api('POST', `/api/agents/${ctx.agentId}/profile/restore`, { index: +b.dataset.restore });
        draftFor = null; toast('Versão restaurada'); renderProfile(root, ctx);
      }));
    },
  };
  Promise.resolve(views[tab]()).catch((e) => { body.innerHTML = `<p class="error">${esc(e.message)}</p>`; });

  $$('[data-ptab]', root).forEach((b) => b.addEventListener('click', () => { tab = b.dataset.ptab; renderProfile(root, ctx); }));
  $('[data-save]', root)?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try { await api('PUT', `/api/agents/${ctx.agentId}/profile`, draft); draftFor = null; toast('Ficha salva'); renderProfile(root, ctx); }
    catch (err) { toast(err.message, 'err'); e.target.disabled = false; }
  });
}

export const hasUnsavedProfile = () => draftFor !== null && draft !== null;
export const resetProfileDraft = () => { draftFor = null; draft = null; };

/** Base de conhecimento da empresa. ctx = { canEdit } */
export async function renderKnowledge(root, ctx) {
  const list = await api('GET', '/api/knowledge');
  root.innerHTML = `<div class="editor">
    <p class="hint">Coleções de conteúdo que os agentes usam para responder (FAQ, manual do produto, políticas). Importe <code>.md</code> (cada <code>##</code> vira um trecho, ou um arquivo por trecho com frontmatter), <code>.jsonl</code> (um trecho por linha: id, titulo, categoria, planos, perguntas, texto) ou <code>.txt</code>. Use um formato só por coleção, para não repetir trechos.</p>
    ${ctx.canEdit ? `<form class="form" data-new style="margin:14px 0">
      <label class="field"><span>Nome da coleção</span><input name="name" placeholder="Ex.: Atendimento — Cuidado Mental" required></label>
      <label class="field"><span>Arquivos</span><input type="file" name="files" multiple accept=".md,.markdown,.jsonl,.ndjson,.txt" required></label>
      <div class="row full"><button class="btn primary">${ic('upload', 'sm')}Importar coleção</button></div></form>` : ''}
    <ul class="people">${list.map((c) => `<li>${ic('file-text', 'sm')}<b>${esc(c.name)}</b><span class="hint">${c.chunks} trechos · ~${fmtK(c.tokens)} tokens · ${esc(c.files.slice(0, 4).join(', '))}${c.files.length > 4 ? '…' : ''}</span>
      <span class="row kb-actions"><button type="button" class="btn small" data-see="${c.id}">Ver trechos</button>${ctx.canEdit ? `<label class="btn small">Atualizar<input type="file" multiple hidden accept=".md,.markdown,.jsonl,.ndjson,.txt" data-update="${c.id}"></label><button type="button" class="btn small danger" data-del="${c.id}">Remover</button>` : ''}</span></li>`).join('') || '<li class="hint">Nenhuma coleção ainda.</li>'}</ul>
    <div data-detail></div></div>`;

  $('[data-new]', root)?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const files = await readFiles(e.target.files.files);
    try {
      const r = await api('POST', '/api/knowledge', { name: e.target.name.value, files });
      toast(`${r.chunks} trechos importados${r.errors?.length ? ` (${r.errors.length} arquivo(s) com erro)` : ''}`);
      renderKnowledge(root, ctx);
    } catch (err) { toast(err.message, 'err'); }
  });
  $$('[data-update]', root).forEach((inp) => inp.addEventListener('change', async () => {
    const files = await readFiles(inp.files);
    try { const r = await api('PUT', `/api/knowledge/${inp.dataset.update}`, { files }); toast(`Coleção atualizada: ${r.chunks} trechos`); renderKnowledge(root, ctx); }
    catch (err) { toast(err.message, 'err'); }
  }));
  $$('[data-del]', root).forEach((b) => b.addEventListener('click', async () => {
    if (!confirm('Remover esta coleção? Os agentes deixam de usá-la.')) return;
    await api('DELETE', `/api/knowledge/${b.dataset.del}`); toast('Coleção removida'); renderKnowledge(root, ctx);
  }));
  $$('[data-see]', root).forEach((b) => b.addEventListener('click', async () => {
    const c = await api('GET', `/api/knowledge/${b.dataset.see}`);
    $('[data-detail]', root).innerHTML = `<h4 style="margin:16px 0 8px">${esc(c.name)} — ${c.items.length} trechos</h4>
      <table class="access-table"><thead><tr><th>Título</th><th>Categoria</th><th>Perguntas típicas</th><th>Tamanho</th></tr></thead>
      <tbody>${c.items.map((k) => `<tr><td style="text-align:left">${esc(k.title)}</td><td>${esc(k.category || '—')}</td><td style="text-align:left">${esc(k.questions.slice(0, 3).join(' · ') || '—')}</td><td class="num">${k.size.toLocaleString('pt-BR')}</td></tr>`).join('')}</tbody></table>`;
  }));
}

/** Fila de aprovações (Minha mesa). ctx = { approvals, agentName, reload } */
export function renderApprovals(root, ctx) {
  root.innerHTML = ctx.approvals.length ? ctx.approvals.slice().reverse().map((a) => `
    <article class="task approval" data-id="${a.id}" data-channel="${esc(a.channel || '')}">
      <div class="task-top"><span class="task-id">${{ chat: 'Chat do site', email: 'E-mail', whatsapp: 'WhatsApp', ads: 'Google Ads · mudança de campanha', trade: 'Binance · ordem de compra', social: a.tool === 'social_responder' ? 'Redes sociais · resposta' : 'Redes sociais · post' }[a.channel] || 'Ação'}</span><span class="stamp doing">Aguardando</span></div>
      <div class="task-meta">${esc(ctx.agentName(a.agentId))} → <b>${esc(a.preview?.para || 'cliente')}</b>${a.preview?.origem ? ` <span class="hint">(${esc(a.preview.origem)})</span>` : ''}${a.preview?.assunto ? ` · ${esc(a.preview.assunto)}` : ''} · ${when(a.ts)}</div>
      ${a.preview?.conversa || a.preview?.original ? `<details><summary class="hint">Ver ${a.preview.conversa ? 'a conversa' : 'o e-mail original'}</summary><pre class="quote">${esc(a.preview.conversa || a.preview.original)}</pre></details>` : ''}
      ${(a.preview?.imagens || []).length ? `<div class="approval-imgs">${a.preview.imagens.map((p) => `<a href="/api/file?path=${encodeURIComponent(p)}" target="_blank" rel="noopener" title="${esc(p)}"><img src="/api/file?path=${encodeURIComponent(p)}" alt="Imagem do post: ${esc(p)}" loading="lazy"></a>`).join('')}</div>` : ''}
      ${a.readOnlyText ? `<div class="approval-what">${esc(a.text)}</div>` : `<textarea rows="${a.channel === 'social' ? 7 : 5}" aria-label="${a.channel === 'social' ? 'Texto do post' : 'Texto da resposta'}">${esc(a.text)}</textarea>`}
      <div class="row"><button class="btn small primary" data-ok>${ic(['ads', 'trade'].includes(a.channel) ? 'check' : 'send', 'sm')}${a.channel === 'trade' ? 'Aprovar e enviar a ordem' : a.channel === 'ads' ? 'Aprovar e aplicar' : a.channel === 'social' && a.tool === 'social_publicar' ? (a.input?.agendar_para ? 'Aprovar e agendar' : 'Aprovar e publicar') : 'Aprovar e enviar'}</button>
        <input data-why placeholder="Orientação para o agente refazer (opcional)" style="flex:1;min-width:180px">
        <button class="btn small" data-no>Descartar</button></div>
    </article>`).join('') : '<p class="empty">Nada aguardando aprovação.</p>';
  $$('.approval', root).forEach((card) => {
    $('[data-ok]', card).addEventListener('click', async (e) => {
      e.target.disabled = true;
      const ta = $('textarea', card);
      try { await api('POST', `/api/approvals/${card.dataset.id}/approve`, ta ? { text: ta.value } : {}); toast(card.dataset.channel === 'social' ? 'Aprovado: publicado nas redes' : ta ? 'Resposta enviada ao cliente' : 'Mudança aplicada'); ctx.reload(); }
      catch (err) { toast(err.message, 'err'); e.target.disabled = false; }
    });
    $('[data-no]', card).addEventListener('click', async () => {
      try { await api('POST', `/api/approvals/${card.dataset.id}/reject`, { reason: $('[data-why]', card).value }); toast('Rascunho descartado'); ctx.reload(); }
      catch (err) { toast(err.message, 'err'); }
    });
  });
}
