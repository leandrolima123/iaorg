// Marca: identidade visual, tom de voz e o modelo dos e-mails enviados pelos agentes (logo, assinatura, rodapé).
import { $, $$, esc, api, toast, ic } from './common.js';

const FONT_LABEL = { arial: 'Arial', helvetica: 'Helvetica', georgia: 'Georgia (serifada)', verdana: 'Verdana', trebuchet: 'Trebuchet' };
const SOCIAL_LABEL = { site: 'Site', instagram: 'Instagram', linkedin: 'LinkedIn', whatsapp: 'WhatsApp (número)', youtube: 'YouTube', facebook: 'Facebook', tiktok: 'TikTok' };
const VARS = [['{{nome}}', 'nome do agente'], ['{{cargo}}', 'cargo'], ['{{empresa}}', 'empresa'], ['{{site}}', 'site'], ['{{telefone}}', 'telefone']];
const SAMPLE = 'Olá, Maria!\n\nObrigado pelo contato. Seguem os próximos passos:\n- Acesse sua conta\n- Escolha o plano que faz mais sentido para você\n\nQualquer dúvida, é só responder este e-mail.';

let st = null; // { brand, fonts, socials, hasLogo, dirty, agentId, sample }

export async function renderBrandPanel(root, { agents = [], isAdmin }) {
  if (!isAdmin) { root.innerHTML = '<p class="hint">A marca é configurada por administradores da empresa.</p>'; return; }
  if (!st || !st.dirty) {
    const d = await api('GET', '/api/brand');
    st = { ...d, dirty: false, agentId: st?.agentId || '', sample: st?.sample || SAMPLE, logoV: Date.now() };
  }
  draw(root, agents.filter((a) => a.kind !== 'human'));
}

function draw(root, agents) {
  const b = st.brand, e = b.email;
  const color = (name, label, val) => `<label class="field br-color"><span>${label}</span><span class="br-color-row"><input type="color" name="${name}" value="${esc(val)}"><input type="text" name="${name}" value="${esc(val)}" maxlength="7" class="num" aria-label="${label} (hex)"></span></label>`;
  root.innerHTML = `
    <div class="br-layout">
      <form class="br-form" id="brForm" autocomplete="off">
        <section class="br-card"><h3>${ic('palette', 'sm')}Identidade visual</h3>
          <div class="br-logo">
            <div class="br-logo-box">${st.hasLogo ? `<img src="/api/company/logo?v=${st.logoV}" alt="Logo da empresa">` : `<span class="hint">Sem logo</span>`}</div>
            <div><label class="btn small">${ic('upload', 'sm')}${st.hasLogo ? 'Trocar logo' : 'Enviar logo'}<input type="file" accept="image/png,image/jpeg,image/webp" id="brLogo" hidden></label>
              <p class="hint">PNG, JPG ou WEBP até 5 MB. Para e-mail, prefira PNG com fundo transparente e largo (ex.: 600 × 200).</p>
              ${st.logoSize ? `<p class="hint">Logo atual: ${st.logoSize.w} × ${st.logoSize.h} px · ${String(st.logoType || '').toUpperCase()}</p>` : ''}
              ${st.logoSize && st.logoSize.w < 2 * st.brand.email.logoWidth ? `<p class="hint" style="color:var(--wait)">${ic('info', 'sm')}O logo é pequeno para o e-mail: com ${st.logoSize.w} px de largura, ele ${st.logoSize.w < st.brand.email.logoWidth ? `vai aparecer com só ${st.logoSize.w} px (não estico para não pixelar)` : 'pode ficar sem nitidez em telas de celular'}. Envie um com pelo menos ${2 * st.brand.email.logoWidth} px de largura.</p>` : ''}
              ${st.logoType === 'webp' ? `<p class="hint" style="color:var(--wait)">${ic('info', 'sm')}O logo atual é WEBP: o Outlook não mostra esse formato. Envie a versão em PNG para os e-mails aparecerem certos em todos os programas.</p>` : ''}</div>
          </div>
          <div class="br-row">${color('color', 'Cor principal', b.color)}${color('textColor', 'Cor do texto', b.textColor)}${color('background', 'Fundo do e-mail', b.background)}</div>
          <label class="field"><span>Fonte dos e-mails</span><select name="font">${st.fonts.map((f) => `<option value="${f}" ${b.font === f ? 'selected' : ''}>${FONT_LABEL[f] || f}</option>`).join('')}</select><span class="hint">Fontes seguras: aparecem iguais no Gmail, Outlook e celular.</span></label>
        </section>

        <section class="br-card"><h3>${ic('message-square', 'sm')}Tom de voz</h3>
          <label class="field"><span>Como a marca fala</span><textarea name="voice" rows="4" placeholder="Ex.: Acolhedor e direto. Tratamos o cliente por você. Sem jargão técnico, sem promessas de cura. Frases curtas.">${esc(b.voice)}</textarea>
            <span class="hint">Vale para todos os agentes, em e-mails, chat e WhatsApp.</span></label>
        </section>

        <section class="br-card"><h3>${ic('mail', 'sm')}Modelo de e-mail</h3>
          <label class="check"><input type="checkbox" name="email.enabled" ${e.enabled ? 'checked' : ''}> Aplicar o modelo da marca nos e-mails enviados pelos agentes (Resend e Gmail)</label>
          <div class="br-sub ${e.enabled ? '' : 'off'}">
            <div class="br-row">
              <label class="check"><input type="checkbox" name="email.showLogo" ${e.showLogo ? 'checked' : ''} ${st.hasLogo ? '' : 'disabled'}> Logo no topo</label>
              <label class="field"><span>Largura do logo: <b data-lw>${e.logoWidth}px</b></span><input type="range" name="email.logoWidth" min="60" max="320" step="10" value="${e.logoWidth}"></label>
              <label class="field"><span>Alinhamento do topo</span><select name="email.headerAlign"><option value="left" ${e.headerAlign === 'left' ? 'selected' : ''}>Esquerda</option><option value="center" ${e.headerAlign === 'center' ? 'selected' : ''}>Centro</option></select></label>
            </div>
            <label class="field"><span>Abertura padrão (opcional)</span><input name="email.greeting" value="${esc(e.greeting)}" maxlength="200" placeholder="Ex.: Olá, {nome do cliente}!"><span class="hint">Orientação para os agentes. A saudação é escrita por eles.</span></label>
            <label class="field"><span>Assinatura</span><textarea name="email.signature" rows="3">${esc(e.signature)}</textarea>
              <span class="br-vars">${VARS.map(([v, l]) => `<button type="button" class="chip" data-var="${v}" title="Inserir ${l}">${v}</button>`).join('')}</span>
              <span class="hint">A primeira linha sai em destaque. Os agentes não escrevem assinatura: o IAORG coloca esta.</span></label>
            <div class="br-row">
              <label class="field"><span>Telefone</span><input name="email.phone" value="${esc(e.phone)}" maxlength="40" placeholder="(11) 99999-9999"></label>
              <label class="field" style="flex:2"><span>Nota de resposta</span><input name="email.replyNote" value="${esc(e.replyNote)}" maxlength="300" placeholder="Ex.: É só responder este e-mail que a gente te ajuda."></label>
            </div>
            <fieldset class="br-links"><legend>Links no rodapé</legend>
              ${st.socials.map((k) => `<label class="field"><span>${SOCIAL_LABEL[k] || k}</span><input name="email.links.${k}" value="${esc(e.links[k] || '')}" placeholder="${k === 'whatsapp' ? '5511999999999' : k === 'site' ? 'cuidadomental.com.br' : `${k}.com/suaempresa`}"></label>`).join('')}
            </fieldset>
            <label class="field"><span>Rodapé</span><textarea name="email.footer" rows="2" placeholder="Ex.: Cuidado Mental Ltda · CNPJ 00.000.000/0001-00 · Rua X, 123 — São Paulo/SP">${esc(e.footer)}</textarea></label>
            <label class="field"><span>Aviso legal</span><textarea name="email.legal" rows="2" placeholder="Ex.: Esta mensagem pode conter informação confidencial. Tratamos seus dados conforme a LGPD.">${esc(e.legal)}</textarea></label>
          </div>
        </section>
        <div class="br-save"><span class="hint" data-dirty>${st.dirty ? 'Alterações não salvas' : 'Tudo salvo'}</span><button type="submit" class="btn primary" ${st.dirty ? '' : 'disabled'}>${ic('check', 'sm')}Salvar marca</button></div>
      </form>

      <aside class="br-preview" aria-label="Prévia do e-mail">
        <div class="br-preview-head"><h3>Prévia do e-mail</h3>
          <select data-agent aria-label="Assinar como">${agents.map((a) => `<option value="${esc(a.id)}" ${st.agentId === a.id ? 'selected' : ''}>Assinado por ${esc(a.name)}</option>`).join('')}</select></div>
        <iframe title="Prévia do e-mail" class="br-frame" sandbox=""></iframe>
        <details class="br-sample"><summary>Mudar o texto de exemplo</summary><textarea data-sample rows="6">${esc(st.sample)}</textarea></details>
        <details class="br-plain"><summary>Versão em texto puro</summary><pre data-plain></pre></details>
      </aside>
    </div>`;

  const form = $('#brForm', root);
  if (!st.agentId && agents[0]) st.agentId = agents[0].id;
  const markDirty = () => { st.dirty = true; $('[data-dirty]', root).textContent = 'Alterações não salvas'; $('button[type=submit]', form).disabled = false; };
  const set = (path, val) => { const ks = path.split('.'); let o = st.brand; while (ks.length > 1) { const k = ks.shift(); o = (o[k] ||= {}); } o[ks[0]] = val; };

  form.addEventListener('input', (ev) => {
    const t = ev.target;
    if (!t.name) return;
    let v = t.type === 'checkbox' ? t.checked : t.type === 'range' ? Number(t.value) : t.value;
    if (t.type === 'color' || (t.type === 'text' && $$(`input[name="${t.name}"]`, form).length === 2)) {
      if (t.type === 'text' && !/^#[0-9a-f]{6}$/i.test(v)) return;
      $$(`input[name="${t.name}"]`, form).forEach((x) => { if (x !== t) x.value = v; });
    }
    if (t.name === 'email.logoWidth') $('[data-lw]', root).textContent = `${v}px`;
    if (t.name === 'email.enabled') $('.br-sub', root).classList.toggle('off', !v);
    set(t.name, v);
    markDirty();
    schedule();
  });
  $$('[data-var]', root).forEach((b) => b.onclick = () => {
    const ta = $('textarea[name="email.signature"]', form);
    const at = ta.selectionStart ?? ta.value.length;
    ta.value = ta.value.slice(0, at) + b.dataset.var + ta.value.slice(ta.selectionEnd ?? at);
    ta.focus(); ta.selectionStart = ta.selectionEnd = at + b.dataset.var.length;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
  $('[data-agent]', root).onchange = (ev) => { st.agentId = ev.target.value; schedule(0); };
  $('[data-sample]', root).oninput = (ev) => { st.sample = ev.target.value; schedule(); };
  $('#brLogo', root).onchange = async (ev) => {
    const f = ev.target.files?.[0];
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { toast('Imagem acima de 5 MB', 'error'); return; }
    const r = await fetch('/api/company/logo', { method: 'POST', body: f, headers: { 'Content-Type': f.type || 'application/octet-stream' } });
    if (!r.ok) { toast((await r.json().catch(() => ({}))).error || 'Não foi possível enviar o logo', 'error'); return; }
    const d = await api('GET', '/api/brand'); // tamanho e formato do logo novo
    Object.assign(st, { hasLogo: d.hasLogo, logoType: d.logoType, logoSize: d.logoSize, logoV: Date.now() });
    toast('Logo atualizado');
    draw(root, agents);
  };
  form.onsubmit = async (ev) => {
    ev.preventDefault();
    try {
      const r = await api('PUT', '/api/brand', st.brand);
      st.brand = r.brand; st.dirty = false;
      toast('Marca salva. Os próximos e-mails já saem com o modelo.');
      draw(root, agents);
    } catch (err) { toast(err.message || 'Erro ao salvar', 'error'); }
  };

  let timer = null;
  function schedule(ms = 250) { clearTimeout(timer); timer = setTimeout(preview, ms); }
  async function preview() {
    try {
      const r = await api('POST', '/api/brand/preview', { brand: st.brand, agentId: st.agentId, text: st.sample });
      const frame = $('.br-frame', root);
      if (!frame) return;
      frame.srcdoc = r.html || `<pre style="font:14px/1.5 sans-serif;white-space:pre-wrap;padding:16px">${esc(r.text)}</pre>`;
      $('[data-plain]', root).textContent = r.text;
    } catch { /* prévia é opcional */ }
  }
  preview();
}

export const brandDirty = () => !!st?.dirty;
