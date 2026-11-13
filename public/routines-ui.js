// Rotinas: tarefas e reuniões recorrentes que você configura (quem, o quê, quando) e o histórico de cada execução.
import { $, $$, esc, api, toast, ic, initials } from './common.js';
import { renderMarkdown } from './files-ui.js';

const DOW = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const st = { view: 'list', edit: null, routineId: null, runId: null };
const fmtWhen = (ts, tz) => (ts ? new Date(ts).toLocaleString('pt-BR', { timeZone: tz, weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const RUN = { running: ['Rodando', 'doing'], done: ['Concluída', ''], failed: ['Falhou', 'block'], skipped: ['Pulada', 'todo'] };

// Modelos para começar (tudo é editável; "Em branco" para qualquer outra coisa).
function templates(agents) {
  const ai = agents.filter((a) => a.kind !== 'human');
  const find = (re) => ai.find((a) => re.test(`${a.role} ${a.title}`))?.id || ai[0]?.id || null;
  return [
    { id: 'blank', icon: 'plus', title: 'Em branco', note: 'Qualquer rotina: você escolhe quem, o quê e quando.', data: { kind: 'task', name: '', schedule: { freq: 'weekly', days: [1], time: '09:00' }, instructions: '' } },
    { id: 'daily', icon: 'users', title: 'Daily (reunião)', note: 'Dias úteis às 10h: cada um conta o que fez, o que vai fazer e bloqueios; sai ata e tarefas.', data: {
      kind: 'meeting', name: 'Daily', schedule: { freq: 'weekdays', time: '10:00' }, folder: 'Reunioes/Daily',
      participants: agents.map((a) => a.id), facilitatorId: find(/pm|produto|product|ceo/i), createTasks: true,
      instructions: 'Daily rápida. Cada um, em até 3 tópicos: o que fez desde a última daily, o que vai fazer hoje e se tem algum bloqueio. O facilitador cobra o que ficou vago e fecha com os encaminhamentos.' } },
    { id: 'cs-report', icon: 'headset', title: 'Relatório de atendimento', note: 'Toda segunda às 9h, o agente de atendimento entrega o relatório da semana.', data: {
      kind: 'task', name: 'Relatório semanal de atendimento', schedule: { freq: 'weekly', days: [1], time: '09:00' }, folder: 'Atendimento/Relatorios', assigneeId: find(/cs|atend|suporte|customer/i),
      instructions: 'Relatório da semana passada (seg a dom) de todos os canais que você atende (chat do site, e-mail, WhatsApp):\n- volume de conversas por canal;\n- quantas resolveu sozinho e quantas escalou (e por quê);\n- principais temas e dúvidas repetidas;\n- casos ainda pendentes;\n- 3 recomendações (ex.: perguntas que deveriam entrar na base de conhecimento).\nUse só dados reais das ferramentas e do seu histórico; compare com o relatório anterior da pasta.' } },
    { id: 'infra', icon: 'server', title: 'Monitoramento de infra', note: 'Toda terça às 10h, o backend revisa deploys, logs e erros e abre tarefas para problemas.', data: {
      kind: 'task', name: 'Monitoramento de infraestrutura', schedule: { freq: 'weekly', days: [2], time: '10:00' }, folder: 'Tecnologia/Monitoramento', assigneeId: find(/devops|infra|backend|cto/i),
      instructions: 'Revise a saúde da infraestrutura nos últimos 7 dias: deploys (falhas, rollbacks), logs de erro recorrentes, lentidão e alertas. Entregue um relatório curto com: o que está saudável, o que está instável, e riscos. Para cada problema real, crie uma tarefa com prioridade e passo a passo. Não faça redeploy nem mude variáveis sem pedido.' } },
    { id: 'ads', icon: 'megaphone', title: 'Relatório de marketing', note: 'Toda segunda às 9h: desempenho das campanhas e sugestões (mudanças vão para aprovação).', data: {
      kind: 'task', name: 'Relatório semanal de marketing', schedule: { freq: 'weekly', days: [1], time: '09:00' }, folder: 'Marketing/Relatorios', assigneeId: find(/market|growth/i),
      instructions: 'Analise a semana passada nas campanhas (Google Ads, se conectado): gasto, cliques, conversões e custo por conversão por campanha, termos de pesquisa ruins e oportunidades. Entregue o relatório e proponha ajustes concretos (orçamento, pausas, palavras negativas) — as mudanças passam por aprovação.' } },
  ];
}

const who = (ctx, id) => ctx.byId(id);
const chip = (ctx, id) => { const a = who(ctx, id); return a ? `<span class="rt-who"><span class="cv-av" style="background:${a.color}">${esc(initials(a.name))}</span>${esc(a.name.split(' ')[0])}</span>` : ''; };

export async function renderRoutinesPanel(root, ctx) {
  if (st.view === 'form') return renderForm(root, ctx);
  if (st.view === 'history') return renderHistory(root, ctx);
  let data;
  try { data = await api('GET', '/api/routines'); } catch (e) { root.innerHTML = `<p class="error">${esc(e.message)}</p>`; return; }
  const tz = data.tz;
  root.innerHTML = `
    <div class="rt-bar"><p class="hint">Rotinas são o que se repete na empresa: <b>tarefas</b> que um agente executa na oficina (relatórios, monitoramentos, revisões) e <b>reuniões</b> com conversa e ata. Horários no fuso ${esc(tz)}.</p>
      ${ctx.isAdmin ? `<button class="btn primary" data-new>${ic('plus', 'sm')}Nova rotina</button>` : ''}</div>
    <div class="rt-list">${data.routines.map((r) => {
      const last = r.lastRun;
      const mine = r.kind === 'meeting' && r.participants.includes(ctx.me);
      return `<article class="rt-card ${r.enabled ? '' : 'off'}" data-id="${r.id}">
        <header><span class="tag">${{ meeting: 'Reunião', message: 'Aviso' }[r.kind] || 'Tarefa'}</span>${r.enabled ? '' : '<span class="tag">pausada</span>'}${r.skipNext ? '<span class="tag">pula a próxima</span>' : ''}${r.running ? '<span class="tag live">rodando agora</span>' : ''}</header>
        <h3>${esc(r.name)}</h3>
        <p class="rt-when">${ic('calendar-clock', 'sm')}${esc(r.scheduleText)}</p>
        <p class="rt-people">${r.kind === 'meeting' ? `${r.participants.map((id) => chip(ctx, id)).join('')}` : chip(ctx, r.assigneeId)}</p>
        <dl><dt>Próxima</dt><dd>${r.enabled ? fmtWhen(r.nextRunAt, tz) : '—'}</dd>
          <dt>Última</dt><dd>${last ? `${fmtWhen(last.startedAt, tz)} · <span class="rt-st ${RUN[last.status]?.[1] || ''}">${RUN[last.status]?.[0] || last.status}</span>` : 'nunca rodou'}</dd></dl>
        ${mine ? `<details class="rt-upd"><summary>${ic('pencil', 'sm')}Minha atualização para a próxima${r.myUpdate ? ' (enviada)' : ''}</summary>
          <textarea rows="3" placeholder="O que você fez, o que vai fazer e bloqueios">${esc(r.myUpdate?.text || '')}</textarea><button class="btn small" data-upd>Enviar</button></details>` : ''}
        <div class="row rt-actions"><button class="btn small" data-hist>${ic('history', 'sm')}Histórico</button>
          ${ctx.isAdmin ? `<button class="btn small" data-run ${r.running ? 'disabled' : ''}>${ic('play', 'sm')}Rodar agora</button>
          <button class="btn small ghost" data-toggle>${r.enabled ? 'Pausar' : 'Ativar'}</button>
          <button class="btn small ghost" data-skip>${r.skipNext ? 'Não pular' : 'Pular a próxima'}</button>
          <button class="btn small ghost" data-edit>${ic('pencil', 'sm')}</button><button class="btn small ghost danger" data-del>${ic('trash-2', 'sm')}</button>` : ''}</div>
      </article>`;
    }).join('') || `<div class="rt-empty">${ic('calendar-clock')}<p>Nenhuma rotina ainda.</p><p class="hint">Crie a primeira a partir de um modelo (daily, relatório de atendimento, monitoramento de infra…) ou em branco.</p></div>`}</div>`;

  $('[data-new]', root)?.addEventListener('click', () => { st.view = 'form'; st.edit = null; renderRoutinesPanel(root, ctx); });
  $$('.rt-card', root).forEach((card) => {
    const id = card.dataset.id;
    const r = data.routines.find((x) => x.id === id);
    const act = async (fn, msg) => { try { await fn(); if (msg) toast(msg); renderRoutinesPanel(root, ctx); } catch (e) { toast(e.message, 'err'); } };
    $('[data-hist]', card).onclick = () => { st.view = 'history'; st.routineId = id; st.runId = null; renderRoutinesPanel(root, ctx); };
    $('[data-run]', card)?.addEventListener('click', () => act(() => api('POST', `/api/routines/${id}/run`), `"${r.name}" começou agora`));
    $('[data-toggle]', card)?.addEventListener('click', () => act(() => api('PUT', `/api/routines/${id}`, { ...r, enabled: !r.enabled }), r.enabled ? 'Rotina pausada' : 'Rotina ativada'));
    $('[data-skip]', card)?.addEventListener('click', () => act(() => api('POST', `/api/routines/${id}/skip`)));
    $('[data-edit]', card)?.addEventListener('click', () => { st.view = 'form'; st.edit = r; renderRoutinesPanel(root, ctx); });
    $('[data-del]', card)?.addEventListener('click', () => { if (confirm(`Remover a rotina "${r.name}"? O histórico das execuções continua guardado.`)) act(() => api('DELETE', `/api/routines/${id}`), 'Rotina removida'); });
    $('[data-upd]', card)?.addEventListener('click', () => act(() => api('POST', `/api/routines/${id}/update`, { text: $('.rt-upd textarea', card).value }), 'Atualização enviada para a próxima reunião'));
  });
}

function renderForm(root, ctx) {
  const agents = ctx.agents();
  const tpls = templates(agents);
  const r = st.edit || null;
  const draft = r ? JSON.parse(JSON.stringify(r)) : null;
  root.innerHTML = `
    <div class="rt-bar"><button class="btn small ghost" data-back>${ic('arrow-left', 'sm')}Voltar</button><h3>${r ? `Editar “${esc(r.name)}”` : 'Nova rotina'}</h3></div>
    ${r ? '' : `<div class="rt-tpls">${tpls.map((t) => `<button type="button" class="option rt-tpl" data-tpl="${t.id}">${ic(t.icon, 'sm')}<b>${esc(t.title)}</b><span class="hint">${esc(t.note)}</span></button>`).join('')}</div>`}
    <form class="form editor rt-form" ${r ? '' : 'hidden'}>
      <label class="field"><span>Nome</span><input name="name" required placeholder="Ex.: Monitoramento de infraestrutura"></label>
      <div class="field"><span>Tipo</span><div class="seg"><label><input type="radio" name="kind" value="task"><span>Tarefa (um agente executa)</span></label><label><input type="radio" name="kind" value="meeting"><span>Reunião (vários conversam)</span></label><label><input type="radio" name="kind" value="message"><span>Aviso (mensagem rápida, sem oficina)</span></label></div>
        <p class="hint rt-msg">O agente recebe a mensagem e responde no ciclo rápido, com as ferramentas dele: bem mais barato que uma tarefa. Use para o que é frequente e curto (ex.: varredura da mesa a cada 4 h).</p></div>
      <div class="field full rt-sched"><span>Quando</span>
        <div class="row"><select name="freq"><option value="daily">Todos os dias</option><option value="weekdays">Dias úteis (seg a sex)</option><option value="weekly">Dias da semana…</option><option value="monthly">Todo mês, no dia…</option><option value="interval">A cada N horas…</option></select>
          <span class="rt-every"><input name="everyHours" type="number" min="1" max="12" style="width:70px" title="Intervalo em horas"> h, a partir das</span>
          <span class="rt-days">${DOW.map((d, i) => `<label class="chip"><input type="checkbox" name="days" value="${i}" hidden><span>${d}</span></label>`).join('')}</span>
          <input name="dayOfMonth" type="number" min="1" max="31" class="rt-dom" style="width:80px" title="Dia do mês">
          <span class="rt-at">às</span><input name="time" type="time" required style="width:120px"></div></div>
      <label class="field rt-task"><span>Quem executa</span><select name="assigneeId">${agents.filter((a) => a.kind !== 'human').map((a) => `<option value="${a.id}">${esc(a.name)} — ${esc(a.role)}</option>`).join('')}</select></label>
      <label class="field rt-folder"><span>Pasta das entregas</span><input name="folder" placeholder="Ex.: Tecnologia/Monitoramento"></label>
      <div class="field full rt-meet"><span>Participantes</span><div class="rt-parts">${agents.map((a) => `<label class="chip"><input type="checkbox" name="participants" value="${a.id}" hidden><span>${esc(a.name)}${a.kind === 'human' ? ' (pessoa)' : ''}</span></label>`).join('')}</div>
        <p class="hint">Pessoas participam enviando a atualização antes (no card da rotina); agentes falam com base no que fizeram de verdade.</p></div>
      <label class="field rt-meet"><span>Facilitador</span><select name="facilitatorId">${agents.filter((a) => a.kind !== 'human').map((a) => `<option value="${a.id}">${esc(a.name)} — ${esc(a.role)}</option>`).join('')}</select></label>
      <label class="check rt-meet"><input type="checkbox" name="createTasks"><span>Encaminhamentos viram tarefas automaticamente</span></label>
      <label class="field full"><span>Instruções (o que fazer em cada execução)</span><textarea name="instructions" rows="7" placeholder="Descreva o que deve ser feito, o formato da entrega e o critério de pronto."></textarea></label>
      <label class="check full"><input type="checkbox" name="enabled"><span>Ativa</span></label>
      <div class="row full"><button class="btn primary">${ic('check', 'sm')}${r ? 'Salvar' : 'Criar rotina'}</button></div>
    </form>`;

  const form = $('.rt-form', root);
  const fill = (d) => {
    form.hidden = false;
    form.name.value = d.name || '';
    $$('input[name=kind]', form).forEach((i) => { i.checked = i.value === (d.kind || 'task'); });
    form.freq.value = d.schedule?.freq || 'daily';
    $$('input[name=days]', form).forEach((i) => { i.checked = (d.schedule?.days || []).includes(+i.value); i.closest('.chip').classList.toggle('on', i.checked); });
    form.dayOfMonth.value = d.schedule?.dayOfMonth || 1;
    form.everyHours.value = d.schedule?.everyHours || 4;
    form.time.value = d.schedule?.time || '09:00';
    if (d.assigneeId) form.assigneeId.value = d.assigneeId;
    form.folder.value = d.folder || '';
    $$('input[name=participants]', form).forEach((i) => { i.checked = (d.participants || []).includes(i.value); i.closest('.chip').classList.toggle('on', i.checked); });
    if (d.facilitatorId) form.facilitatorId.value = d.facilitatorId;
    form.createTasks.checked = d.createTasks !== false;
    form.instructions.value = d.instructions || '';
    form.enabled.checked = d.enabled !== false;
    sync();
  };
  const sync = () => {
    const kind = $('input[name=kind]:checked', form)?.value || 'task';
    $$('.rt-task', form).forEach((e) => { e.hidden = kind === 'meeting'; });
    $$('.rt-meet', form).forEach((e) => { e.hidden = kind !== 'meeting'; });
    $$('.rt-msg', form).forEach((e) => { e.hidden = kind !== 'message'; });
    $('.rt-folder', form).hidden = kind === 'message';
    $('.rt-days', form).hidden = form.freq.value !== 'weekly';
    $('.rt-dom', form).hidden = form.freq.value !== 'monthly';
    $('.rt-every', form).hidden = form.freq.value !== 'interval';
    $('.rt-at', form).hidden = form.freq.value === 'interval';
    form.instructions.previousElementSibling.textContent = kind === 'message' ? 'Mensagem (o que o agente recebe em cada execução)' : 'Instruções (o que fazer em cada execução)';
  };
  $$('input[name=kind]', form).forEach((i) => i.addEventListener('change', sync));
  form.freq.addEventListener('change', sync);
  $$('.chip input', form).forEach((i) => i.addEventListener('change', () => i.closest('.chip').classList.toggle('on', i.checked)));
  $$('[data-tpl]', root).forEach((b) => b.onclick = () => {
    $$('[data-tpl]', root).forEach((x) => x.classList.toggle('active', x === b));
    fill({ enabled: true, ...tpls.find((t) => t.id === b.dataset.tpl).data });
    form.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  if (draft) fill(draft);
  $('[data-back]', root).onclick = () => { st.view = 'list'; renderRoutinesPanel(root, ctx); };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const kind = $('input[name=kind]:checked', form)?.value || 'task';
    const body = {
      name: form.name.value, kind, enabled: form.enabled.checked, instructions: form.instructions.value, folder: form.folder.value,
      schedule: { freq: form.freq.value, days: $$('input[name=days]:checked', form).map((i) => +i.value), dayOfMonth: +form.dayOfMonth.value || 1, everyHours: +form.everyHours.value || 4, time: form.time.value },
      assigneeId: form.assigneeId.value, participants: $$('input[name=participants]:checked', form).map((i) => i.value),
      facilitatorId: form.facilitatorId.value, createTasks: form.createTasks.checked,
      template: $('[data-tpl].active', root)?.dataset.tpl || r?.template || '',
    };
    if (body.schedule.freq === 'weekly' && !body.schedule.days.length) { toast('Escolha pelo menos um dia da semana', 'err'); return; }
    try {
      await api(r ? 'PUT' : 'POST', r ? `/api/routines/${r.id}` : '/api/routines', body);
      toast(r ? 'Rotina salva' : 'Rotina criada');
      st.view = 'list'; renderRoutinesPanel(root, ctx);
    } catch (err) { toast(err.message, 'err'); }
  };
}

async function renderHistory(root, ctx) {
  const [{ routines, tz }, runs] = await Promise.all([api('GET', '/api/routines'), api('GET', `/api/routines/${st.routineId}/runs`)]);
  const r = routines.find((x) => x.id === st.routineId);
  if (!st.runId && runs[0]) st.runId = runs[0].id;
  root.innerHTML = `
    <div class="rt-bar"><button class="btn small ghost" data-back>${ic('arrow-left', 'sm')}Rotinas</button><h3>${esc(r?.name || 'Rotina removida')}</h3><span class="hint">${esc(r?.scheduleText || '')}</span></div>
    <div class="rt-hist">
      <ul class="rt-runs">${runs.map((x) => `<li><button type="button" class="${x.id === st.runId ? 'on' : ''}" data-run="${x.id}"><b>${fmtWhen(x.startedAt, tz)}</b>
        <span class="rt-st ${RUN[x.status]?.[1] || ''}">${RUN[x.status]?.[0] || x.status}</span>${x.manual ? '<small>manual</small>' : ''}</button></li>`).join('') || '<li class="cv-empty">Ainda não rodou.</li>'}</ul>
      <section class="rt-run" data-detail>${runs.length ? '<p class="hint" style="padding:16px">Carregando…</p>' : ''}</section>
    </div>`;
  $('[data-back]', root).onclick = () => { st.view = 'list'; renderRoutinesPanel(root, ctx); };
  $$('[data-run]', root).forEach((b) => b.onclick = () => { st.runId = b.dataset.run; renderHistory(root, ctx); });
  if (st.runId) await renderRun($('[data-detail]', root), ctx, st.runId, tz);
}

async function renderRun(box, ctx, runId, tz) {
  const { run, detail, task, job } = await api('GET', `/api/routine-runs/${runId}`);
  const name = (id) => who(ctx, id)?.name || id;
  if (run.status === 'skipped') { box.innerHTML = `<div class="rt-empty"><p>Execução pulada.</p><p class="hint">${esc(run.note || '')}</p></div>`; return; }
  if (run.kind === 'message') {
    box.innerHTML = `<div class="rt-ata"><h4>Aviso enviado</h4><p class="hint">Para ${esc(name(run.agentId))}. A resposta e o que ele fez aparecem na conversa e no diário do agente.</p>
      <div class="fm-md">${renderMarkdown(String(run.summary || ''))}</div>${run.error ? `<p class="error">${esc(run.error)}</p>` : ''}</div>`;
    return;
  }
  if (run.kind === 'meeting') {
    const ata = detail?.ata || {};
    box.innerHTML = `
      <div class="rt-ata">
        <h4>Ata</h4>${run.status === 'running' ? '<p class="hint">A reunião está acontecendo agora…</p>' : ''}
        ${ata.resumo ? `<div class="fm-md">${renderMarkdown(String(ata.resumo))}</div>` : ''}
        ${ata.decisoes?.length ? `<h5>Decisões</h5><ul>${ata.decisoes.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : ''}
        ${ata.bloqueios?.length ? `<h5>Bloqueios</h5><ul>${ata.bloqueios.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>` : ''}
        ${detail?.created?.length ? `<h5>Encaminhamentos (viraram tarefas)</h5><ul>${detail.created.map((t) => `<li><b>${esc(t.id)}</b> ${esc(t.title)} — ${esc(name(t.assigneeId))}</li>`).join('')}</ul>` : ''}
        ${run.file ? `<p class="hint">${ic('file-text', 'sm')}Ata salva em Arquivos: <code>${esc(run.file)}</code></p>` : ''}
        ${run.error ? `<p class="error">${esc(run.error)}</p>` : ''}
      </div>
      <h4 class="rt-h">Conversa</h4>
      <div class="cv-msgs rt-talk">${(detail?.transcript || []).map((m) => { const a = who(ctx, m.from); return `<div class="cv-msg"><span class="cv-av" style="background:${a?.color || '#888'}">${esc(initials(a?.name || '?'))}</span>
        <div class="cv-bubble"><div class="cv-from" style="color:${a?.color || '#888'}">${esc(a?.name || m.from)}<span>${esc(a?.role || '')}</span></div><div class="cv-text">${renderMarkdown(m.text)}</div><time>${new Date(m.ts).toLocaleTimeString('pt-BR', { timeZone: tz, hour: '2-digit', minute: '2-digit' })}</time></div></div>`; }).join('') || '<p class="cv-empty">Sem falas registradas.</p>'}</div>`;
    return;
  }
  box.innerHTML = `
    <div class="rt-ata">
      <h4>${task ? `${esc(task.id)} · ${esc(task.title)}` : 'Tarefa'}</h4>
      <p class="hint">Responsável: ${esc(name(run.agentId || task?.assigneeId))} · ${task ? `tarefa ${esc({ todo: 'a fazer', doing: 'em andamento', review: 'aguardando você', done: 'concluída', blocked: 'bloqueada' }[task.status] || task.status)}` : ''}${job ? ` · oficina: ${esc(job.phaseText || job.status)} · US$ ${(job.costUsd || 0).toFixed(3).replace('.', ',')}` : ''}</p>
      ${job?.plan?.length ? `<h5>Plano</h5><ul>${job.plan.map((p) => `<li>${p.status === 'completed' ? '☑' : p.status === 'in_progress' ? '▶' : '☐'} ${esc(p.text)}</li>`).join('')}</ul>` : ''}
      ${task?.result ? `<h5>Resultado</h5><div class="fm-md">${renderMarkdown(task.result)}</div>` : run.status === 'running' ? '<p class="hint">Em execução: o resultado aparece aqui quando o agente terminar.</p>' : ''}
      ${job?.pr ? `<p><a href="${esc(job.pr.url)}" target="_blank" rel="noopener">${ic('git-pull-request', 'sm')}PR #${job.pr.number}</a></p>` : ''}
      ${run.error ? `<p class="error">${esc(run.error)}</p>` : ''}
      <p class="hint">As entregas em arquivo ficam em Arquivos${(routineFolder(ctx, run))}.</p>
    </div>`;
}
const routineFolder = () => '';
export const routinesEditing = () => st.view === 'form';
