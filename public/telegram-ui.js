// Minha mesa no Telegram: cada pessoa vincula o próprio Telegram e escolhe o que recebe.
// O bot é da empresa (Integrações → Telegram); o vínculo e as preferências são de cada pessoa.
import { $, $$, esc, api, ic, toast, confirmDialog } from './common.js';

const st = { open: false, data: null, link: null, loading: false };
export const telegramOpen = () => st.open;
export function toggleTelegram() { st.open = !st.open; return st.open; }

/** Desenha a seção (usa o que já tem e atualiza em seguida, sem piscar). */
export async function renderMyTelegram(root, { isOwner, goIntegrations }) {
  if (!root) return;
  draw(root, { isOwner, goIntegrations });
  if (st.loading) return;
  st.loading = true;
  try { st.data = await api('GET', '/api/telegram/me'); } catch (e) { st.data = { error: e.message }; }
  st.loading = false;
  if (root.isConnected) draw(root, { isOwner, goIntegrations });
}

function draw(root, ctx) {
  const d = st.data;
  if (!d) { root.innerHTML = '<p class="hint">Carregando…</p>'; return; }
  if (d.error && !d.prefList) { root.innerHTML = `<p class="error">${esc(d.error)}</p>`; return; }
  if (!d.connected) {
    root.innerHTML = `<p class="hint">${ic('send', 'sm')}Receba a sua mesa no Telegram: mensagens dos agentes, tarefas, pedidos para aprovar, revisões e entregas, e responda de lá.</p>
      ${ctx.isOwner ? `<p class="hint">Primeiro conecte o bot da empresa em <b>Integrações → Telegram</b> (leva 1 minuto com o @BotFather).</p><button type="button" class="btn small" data-tg-integ>${ic('plug', 'sm')}Conectar o Telegram</button>`
        : '<p class="hint">Peça ao dono da empresa para conectar o Telegram em Integrações. Depois você vincula o seu aqui.</p>'}`;
    $('[data-tg-integ]', root)?.addEventListener('click', ctx.goIntegrations);
    return;
  }
  if (!d.linked) {
    root.innerHTML = `
      ${d.error ? `<p class="error">${esc(d.error)}</p>` : ''}
      <p class="hint">O bot da empresa é <b>@${esc(d.bot || '?')}</b>. Vincule o seu Telegram para receber a sua mesa lá.</p>
      ${st.link ? `<div class="tg-link">
          <ol><li>Abra o link no celular ou computador com o Telegram: ${st.link.url ? `<a href="${esc(st.link.url)}" target="_blank" rel="noopener"><b>${esc(st.link.url)}</b></a>` : ''}</li>
          <li>Toque em <b>Iniciar</b>. ${st.link.url ? 'Se preferir, mande ao bot' : 'Mande ao bot'}: <code>/start ${esc(st.link.code)}</code></li></ol>
          <p class="hint">O código vale ${st.link.expiresInMin} min e só uma vez. Depois de vincular, clique em Atualizar.</p>
          <div class="row"><button type="button" class="btn small" data-tg-refresh>${ic('refresh-cw', 'sm')}Atualizar</button><button type="button" class="btn small ghost" data-tg-new>Gerar outro código</button></div></div>`
        : `<button type="button" class="btn primary small" data-tg-new>${ic('link', 'sm')}Vincular meu Telegram</button>`}`;
    $$('[data-tg-new]', root).forEach((b) => b.onclick = async () => {
      try { st.link = await api('POST', '/api/telegram/link'); draw(root, ctx); if (st.link.url) window.open(st.link.url, '_blank', 'noopener'); } catch (e) { toast(e.message, 'err'); }
    });
    $('[data-tg-refresh]', root)?.addEventListener('click', () => renderMyTelegram(root, ctx));
    return;
  }
  st.link = null;
  root.innerHTML = `
    ${d.error ? `<p class="error">${esc(d.error)}</p>` : ''}
    <p class="tg-linked">${ic('circle-check', 'sm')}Vinculado ao Telegram <b>${esc(d.linked.user || '')}</b> · bot @${esc(d.bot || '')}</p>
    <form class="tg-form" autocomplete="off">
      <fieldset><legend>O que chega no Telegram</legend>
        ${d.prefList.map((p) => `<label class="chk"><input type="checkbox" name="${esc(p.key)}" ${d.prefs[p.key] ? 'checked' : ''}> ${esc(p.label)}</label>`).join('')}
      </fieldset>
      <label class="field"><span>Mensagem livre no Telegram vira ordem para</span>
        <select name="target"><option value="">O agente do topo (igual à barra Nova ordem)</option>${d.targets.map((t) => `<option value="${esc(t.id)}" ${t.id === d.target ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select></label>
      <p class="hint">No Telegram: responda uma mensagem do bot para responder ao agente, anotar na tarefa ou pedir ajuste. Comandos: /mesa, /tarefas, /para Nome mensagem, /agentes.</p>
      <div class="row"><button type="submit" class="btn primary small" disabled>${ic('check', 'sm')}Salvar</button>
        <button type="button" class="btn small" data-tg-test>${ic('send', 'sm')}Enviar teste</button>
        <button type="button" class="btn small ghost danger" data-tg-unlink>Desvincular</button></div>
    </form>`;
  const form = $('.tg-form', root);
  const save = $('button[type=submit]', form);
  form.oninput = () => { save.disabled = false; };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const prefs = Object.fromEntries(d.prefList.map((p) => [p.key, form[p.key].checked]));
    try { st.data = await api('PUT', '/api/telegram/me', { prefs, target: form.target.value }); toast('Preferências do Telegram salvas'); draw(root, ctx); } catch (err) { toast(err.message, 'err'); }
  };
  $('[data-tg-test]', root).onclick = async () => { try { await api('POST', '/api/telegram/test'); toast('Teste enviado: confira o Telegram'); } catch (err) { toast(err.message, 'err'); } };
  $('[data-tg-unlink]', root).onclick = async () => {
    if (!(await confirmDialog({ title: 'Desvincular o seu Telegram?', message: 'Você para de receber a Minha mesa por lá.', confirmLabel: 'Desvincular', danger: true }))) return;
    try { st.data = await api('DELETE', '/api/telegram/me'); toast('Telegram desvinculado'); draw(root, ctx); } catch (err) { toast(err.message, 'err'); }
  };
}
