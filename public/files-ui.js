// Gerenciador de arquivos da empresa: árvore de pastas, lista, prévia (imagem, PDF, vídeo, áudio,
// Markdown, CSV, JSON, texto), enviar (inclusive arrastando), mover/renomear, nova pasta, excluir
// e o estado do espelho no Google Drive.
import { $, $$, esc, api, toast, ic } from './common.js';

const st = { folder: '', sel: null, q: '', open: new Set(['']) };
const KIND = (mime = '', p = '') => {
  if (mime.startsWith('image/')) return 'image';
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (/markdown/.test(mime)) return 'md';
  if (/csv|tab-separated/.test(mime)) return 'csv';
  if (/json/.test(mime)) return 'json';
  if (mime.startsWith('text/')) return 'text';
  if (/\.(docx?|odt)$/i.test(p)) return 'doc';
  if (/\.(xlsx?|ods)$/i.test(p)) return 'sheet';
  if (/\.(pptx?|odp)$/i.test(p)) return 'slides';
  return 'bin';
};
const ICON = { image: 'image', pdf: 'file-text', video: 'film', audio: 'music', md: 'file-text', csv: 'table', json: 'braces', text: 'file-code', doc: 'file-text', sheet: 'table', slides: 'presentation', bin: 'file' };
const size = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1).replace('.', ',')} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);
const when = (t) => (t ? new Date(t).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
const base = (p) => p.split('/').pop();
const dir = (p) => p.split('/').slice(0, -1).join('/');
const url = (p, dl) => `/api/file?${dl ? 'download=1&' : ''}path=${encodeURIComponent(p)}`;

// ---------- Markdown e CSV (seguros: escapam tudo antes de formatar) ----------
function inline(s) {
  return esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');
}
export function renderMarkdown(md) {
  const lines = String(md).replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const l = lines[i];
    if (/^```/.test(l)) { const buf = []; i++; while (i < lines.length && !/^```/.test(lines[i])) buf.push(lines[i++]); i++; out.push(`<pre><code>${esc(buf.join('\n'))}</code></pre>`); continue; }
    const h = l.match(/^(#{1,6})\s+(.*)/);
    if (h) { out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`); i++; continue; }
    if (/^\s*\|.*\|\s*$/.test(l) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] || '')) {
      const row = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = row(l); i += 2; const body = [];
      while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) body.push(row(lines[i++]));
      out.push(`<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      continue;
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(l)) {
      const ordered = /^\s*\d/.test(l); const items = [];
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*+]|\d+[.)])\s+/, ''));
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.map((t) => `<li>${inline(t.replace(/^\[( |x)\]\s*/i, (m, x) => (x.trim() ? '☑ ' : '☐ ')))}</li>`).join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }
    if (/^>\s?/.test(l)) { const buf = []; while (i < lines.length && /^>\s?/.test(lines[i])) buf.push(lines[i++].replace(/^>\s?/, '')); out.push(`<blockquote>${inline(buf.join(' '))}</blockquote>`); continue; }
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(l)) { out.push('<hr>'); i++; continue; }
    if (!l.trim()) { i++; continue; }
    const buf = [];
    while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|\s*([-*+]|\d+[.)])\s|>|\s*\|)/.test(lines[i])) buf.push(lines[i++]);
    out.push(`<p>${inline(buf.join(' '))}</p>`);
  }
  return out.join('\n');
}
function parseCsv(text, sep) {
  const rows = []; let row = []; let cur = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"' && text[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; continue; }
    if (ch === '"') q = true;
    else if (ch === sep) { row.push(cur); cur = ''; }
    else if (ch === '\n') { row.push(cur.replace(/\r$/, '')); rows.push(row); row = []; cur = ''; if (rows.length > 500) break; }
    else cur += ch;
  }
  if (cur || row.length) { row.push(cur); rows.push(row); }
  return rows;
}

// ---------- árvore ----------
function tree(data) {
  const folders = new Set(data.folders);
  for (const f of data.files) { const parts = f.path.split('/'); for (let i = 1; i < parts.length; i++) folders.add(parts.slice(0, i).join('/')); }
  return [...folders].sort((a, b) => a.localeCompare(b, 'pt-BR'));
}
function treeHtml(all, files, parent = '', depth = 0) {
  const kids = all.filter((f) => dir(f) === parent);
  return kids.map((f) => {
    const sub = all.some((x) => dir(x) === f);
    const n = files.filter((x) => x.path.startsWith(`${f}/`)).length;
    const open = st.open.has(f);
    return `<li><div class="fm-node ${st.folder === f ? 'on' : ''}" data-folder="${esc(f)}" style="--d:${depth}" draggable="true">
      <button type="button" class="fm-twist" data-twist="${esc(f)}" ${sub ? '' : 'disabled'} aria-label="${open ? 'Recolher' : 'Expandir'}">${sub ? ic(open ? 'chevron-down' : 'chevron-right', 'sm') : ''}</button>
      ${ic(open && sub ? 'folder-open' : 'folder', 'sm')}<span>${esc(base(f))}</span><small class="num">${n || ''}</small></div>
      ${sub && open ? `<ul>${treeHtml(all, files, f, depth + 1)}</ul>` : ''}</li>`;
  }).join('');
}

/** Abre um arquivo no gerenciador (pasta + prévia) na próxima vez que ele for desenhado. */
export function focusFile(p) { st.folder = dir(p); st.sel = p; st.q = ''; }

/** Desenha o gerenciador. ctx = { isAdmin, nameOf(id), me } */
export async function renderFilesPanel(root, ctx) {
  let data;
  try { data = await api('GET', '/api/files'); } catch (e) { root.innerHTML = `<p class="error">${esc(e.message)}</p>`; return; }
  const all = tree(data);
  if (st.folder && !all.includes(st.folder)) st.folder = '';
  if (st.sel && !data.files.some((f) => f.path === st.sel)) st.sel = null;
  const q = st.q.trim().toLowerCase();
  const subfolders = q ? [] : all.filter((f) => dir(f) === st.folder);
  const list = q ? data.files.filter((f) => f.path.toLowerCase().includes(q)) : data.files.filter((f) => dir(f.path) === st.folder);
  list.sort((a, b) => b.mtime - a.mtime);
  const crumbs = st.folder ? st.folder.split('/') : [];
  const d = data.drive;

  root.innerHTML = `
    <div class="fm-bar">
      <nav class="fm-crumbs" aria-label="Caminho"><button type="button" data-go="">${ic('archive', 'sm')}Arquivos</button>${crumbs.map((c, i) => `<span>/</span><button type="button" data-go="${esc(crumbs.slice(0, i + 1).join('/'))}">${esc(c)}</button>`).join('')}</nav>
      <input class="fm-search" type="search" placeholder="Buscar em todos os arquivos" value="${esc(st.q)}" aria-label="Buscar arquivos">
      <button type="button" class="btn small" data-newfolder>${ic('folder-plus', 'sm')}Nova pasta</button>
      <label class="btn small primary">${ic('upload', 'sm')}Enviar<input type="file" multiple hidden data-upload></label>
    </div>
    ${d ? `<div class="fm-drive ${d.error ? 'err' : ''}">${ic('hard-drive', 'sm')}<span><b>Google Drive</b> · espelhando em “${esc(d.folder)}” · ${d.running ? 'sincronizando…' : d.lastSync ? `última sincronização ${when(d.lastSync)} · ${d.files} arquivo(s)` : 'ainda não sincronizado'}${d.error ? ` · <span class="error">${esc(d.error)}</span>` : ''}</span>
        ${d.url ? `<a class="btn small ghost" href="${esc(d.url)}" target="_blank" rel="noopener">${ic('external-link', 'sm')}Abrir no Drive</a>` : ''}${ctx.isAdmin ? `<button type="button" class="btn small ghost" data-drivesync>${ic('refresh-cw', 'sm')}Sincronizar agora</button>` : ''}</div>`
      : ctx.isAdmin ? `<div class="fm-drive off">${ic('hard-drive', 'sm')}<span>Conecte o <b>Google Drive</b> em Integrações para ter uma cópia organizada de tudo no seu Drive.</span><button type="button" class="btn small ghost" data-gointeg>Conectar</button></div>` : ''}
    <div class="fm ${st.sel ? 'has-sel' : ''}">
      <aside class="fm-tree" aria-label="Pastas"><div class="fm-node root ${st.folder === '' ? 'on' : ''}" data-folder="">${ic('archive', 'sm')}<span>Todos os arquivos</span><small class="num">${data.files.length}</small></div>
        <ul>${treeHtml(all, data.files)}</ul></aside>
      <section class="fm-list" data-drop>
        ${q ? `<p class="hint fm-note">${list.length} resultado(s) para “${esc(st.q)}”</p>` : ''}
        <table><thead><tr><th>Nome</th><th>Tamanho</th><th>Alterado</th><th>Por</th></tr></thead><tbody>
          ${subfolders.map((f) => `<tr class="fm-row folder" data-folder-row="${esc(f)}" data-folder="${esc(f)}" draggable="true"><td>${ic('folder', 'sm')}<span>${esc(base(f))}</span></td><td class="num">${data.files.filter((x) => x.path.startsWith(`${f}/`)).length} itens</td><td></td><td></td></tr>`).join('')}
          ${list.map((f) => { const k = KIND(f.mime, f.path); return `<tr class="fm-row ${st.sel === f.path ? 'on' : ''}" data-file="${esc(f.path)}" draggable="true">
            <td>${k === 'image' ? `<img class="fm-thumb" src="${url(f.path)}" alt="" loading="lazy">` : ic(ICON[k], 'sm')}<span>${esc(q ? f.path : base(f.path))}</span></td>
            <td class="num">${size(f.size)}</td><td class="num">${when(f.mtime)}</td><td>${f.by ? esc(ctx.nameOf(f.by)) : '<span class="hint">—</span>'}${f.task ? ` <span class="hint">· ${esc(f.task)}</span>` : ''}</td></tr>`; }).join('')}
          ${!subfolders.length && !list.length ? `<tr><td colspan="4" class="fm-empty">${q ? 'Nada encontrado.' : 'Pasta vazia. Arraste arquivos do computador para cá ou use Enviar.'}</td></tr>` : ''}
        </tbody></table>
        <div class="fm-dropzone">${ic('upload', 'sm')}Solte para enviar em <b>${esc(st.folder || 'Arquivos')}</b></div>
      </section>
      <section class="fm-preview" aria-label="Prévia">${st.sel ? '' : `<div class="fm-placeholder">${ic('eye', 'sm')}<p>Escolha um arquivo para ver a prévia.</p><p class="hint">Dica: arraste arquivos e pastas para outra pasta (na árvore) para mover.</p></div>`}</section>
    </div>`;

  const rerender = () => renderFilesPanel(root, ctx);
  // navegação
  $$('[data-go]', root).forEach((b) => b.onclick = () => { st.folder = b.dataset.go; st.sel = null; st.q = ''; rerender(); });
  $$('.fm-tree [data-folder]', root).forEach((n) => n.addEventListener('click', (e) => {
    if (e.target.closest('[data-twist]')) return;
    st.folder = n.dataset.folder; st.sel = null; st.q = '';
    if (st.folder) st.open.add(st.folder);
    rerender();
  }));
  $$('[data-twist]', root).forEach((b) => b.onclick = () => { const f = b.dataset.twist; st.open.has(f) ? st.open.delete(f) : st.open.add(f); rerender(); });
  $$('[data-folder-row]', root).forEach((r) => r.ondblclick = r.onclick = () => { st.folder = r.dataset.folderRow; st.open.add(st.folder); st.sel = null; rerender(); });
  $$('[data-file]', root).forEach((r) => r.onclick = () => { st.sel = r.dataset.file; rerender(); });
  let timer;
  $('.fm-search', root).oninput = (e) => { clearTimeout(timer); timer = setTimeout(() => { st.q = e.target.value; st.sel = null; rerender(); }, 250); };
  $('[data-gointeg]', root)?.addEventListener('click', () => ctx.goIntegrations());
  $('[data-drivesync]', root)?.addEventListener('click', async (e) => {
    e.target.disabled = true;
    try { const r = await api('POST', '/api/files/drive-sync'); toast(r.queued ? 'Sincronização na fila' : `Drive sincronizado: ${r.uploaded || 0} enviado(s)`); } catch (err) { toast(err.message, 'err'); }
    rerender();
  });

  // nova pasta / enviar
  $('[data-newfolder]', root).onclick = async () => {
    const name = prompt(`Nome da nova pasta${st.folder ? ` dentro de ${st.folder}` : ''}:`);
    if (!name?.trim()) return;
    try { const r = await api('POST', '/api/files/folder', { path: `${st.folder ? `${st.folder}/` : ''}${name.trim()}` }); st.folder = r.path; st.open.add(dir(r.path)); rerender(); } catch (e) { toast(e.message, 'err'); }
  };
  const upload = async (files) => {
    let ok = 0;
    for (const f of files) {
      if (f.size > 25 * 1024 * 1024) { toast(`${f.name}: maior que 25 MB`, 'err'); continue; }
      try { await api('POST', `/api/files/upload?folder=${encodeURIComponent(st.folder || 'Uploads')}&name=${encodeURIComponent(f.name)}`, f, true); ok++; } catch (e) { toast(`${f.name}: ${e.message}`, 'err'); }
    }
    if (ok) { toast(`${ok} arquivo(s) enviado(s)`); if (!st.folder) st.folder = 'Uploads'; rerender(); }
  };
  $('[data-upload]', root).onchange = (e) => upload([...e.target.files]);

  // arrastar: arquivos do computador → enviar; itens da lista/árvore → mover para a pasta de destino
  const listEl = $('[data-drop]', root);
  listEl.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('Files')) { e.preventDefault(); listEl.classList.add('dragging'); } });
  listEl.addEventListener('dragleave', (e) => { if (!listEl.contains(e.relatedTarget)) listEl.classList.remove('dragging'); });
  listEl.addEventListener('drop', (e) => { if (e.dataTransfer.files.length) { e.preventDefault(); listEl.classList.remove('dragging'); upload([...e.dataTransfer.files]); } });
  $$('[draggable="true"]', root).forEach((el) => el.addEventListener('dragstart', (e) => {
    const from = el.dataset.file || el.dataset.folder;
    if (!from) { e.preventDefault(); return; }
    e.dataTransfer.setData('text/x-iaorg-path', from);
    e.dataTransfer.effectAllowed = 'move';
  }));
  $$('[data-folder]', root).forEach((t) => {
    t.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('text/x-iaorg-path')) { e.preventDefault(); t.classList.add('target'); } });
    t.addEventListener('dragleave', () => t.classList.remove('target'));
    t.addEventListener('drop', async (e) => {
      const from = e.dataTransfer.getData('text/x-iaorg-path');
      t.classList.remove('target');
      if (!from) return;
      e.preventDefault(); e.stopPropagation();
      const to = `${t.dataset.folder ? `${t.dataset.folder}/` : ''}${base(from)}`;
      if (to === from || dir(from) === t.dataset.folder) return;
      try { await api('POST', '/api/files/move', { from, to }); toast(`Movido para ${t.dataset.folder || 'Arquivos'}`); if (st.sel === from) st.sel = to; rerender(); } catch (err) { toast(err.message, 'err'); }
    });
  });

  if (st.sel) preview($('.fm-preview', root), data.files.find((f) => f.path === st.sel), ctx, rerender);
}

async function preview(box, f, ctx, rerender) {
  const k = KIND(f.mime, f.path);
  box.innerHTML = `<header class="fm-ph"><div><b title="${esc(f.path)}">${esc(base(f.path))}</b><span class="hint">${esc(dir(f.path) || 'Arquivos')} · ${size(f.size)} · ${when(f.mtime)}${f.by ? ` · por ${esc(ctx.nameOf(f.by))}` : ''}</span></div>
      <div class="row"><a class="btn small" href="${url(f.path, true)}">${ic('download', 'sm')}Baixar</a><a class="btn small ghost" href="${url(f.path)}" target="_blank" rel="noopener" title="Abrir em nova aba">${ic('external-link', 'sm')}</a>
      <button type="button" class="btn small ghost" data-rename title="Renomear ou mover">${ic('pencil', 'sm')}</button>${ctx.isAdmin || f.by === ctx.me ? `<button type="button" class="btn small ghost danger" data-del title="Excluir">${ic('trash-2', 'sm')}</button>` : ''}
      <button type="button" class="btn small ghost" data-close aria-label="Fechar prévia">${ic('x', 'sm')}</button></div></header>
    <div class="fm-body kind-${k}">${{
      image: `<div class="fm-img"><img src="${url(f.path)}" alt="${esc(base(f.path))}"></div>`,
      pdf: `<iframe src="${url(f.path)}" title="${esc(base(f.path))}"></iframe>`,
      video: `<video src="${url(f.path)}" controls preload="metadata"></video>`,
      audio: `<audio src="${url(f.path)}" controls preload="metadata"></audio>`,
    }[k] || (['md', 'csv', 'json', 'text'].includes(k) ? '<p class="hint">Carregando…</p>' : `<div class="fm-placeholder">${ic(ICON[k], 'sm')}<p>Sem prévia para este tipo de arquivo.</p><a class="btn small primary" href="${url(f.path, true)}">${ic('download', 'sm')}Baixar</a></div>`)}</div>`;

  $('[data-close]', box).onclick = () => { st.sel = null; rerender(); };
  $('[data-rename]', box).onclick = async () => {
    const to = prompt('Novo nome ou caminho (use / para mover para outra pasta):', f.path);
    if (!to?.trim() || to.trim() === f.path) return;
    try { const r = await api('POST', '/api/files/move', { from: f.path, to: to.trim() }); st.sel = r.path; st.folder = dir(r.path); toast('Arquivo atualizado'); rerender(); } catch (e) { toast(e.message, 'err'); }
  };
  $('[data-del]', box)?.addEventListener('click', async () => {
    if (!confirm(`Excluir “${base(f.path)}”? Ele sai da lista${'' } e do Google Drive (fica guardado na lixeira do servidor).`)) return;
    try { await api('DELETE', `/api/files?path=${encodeURIComponent(f.path)}`); st.sel = null; toast('Arquivo excluído'); rerender(); } catch (e) { toast(e.message, 'err'); }
  });

  if (!['md', 'csv', 'json', 'text'].includes(k)) return;
  const body = $('.fm-body', box);
  if (f.size > 3 * 1024 * 1024) { body.innerHTML = '<p class="hint">Arquivo grande demais para prévia. Use Baixar.</p>'; return; }
  const text = await fetch(url(f.path)).then((r) => r.text());
  if (st.sel !== f.path) return;
  if (k === 'md') body.innerHTML = `<article class="fm-md">${renderMarkdown(text)}</article>`;
  else if (k === 'csv') {
    const rows = parseCsv(text, /\.tsv$/i.test(f.path) ? '\t' : (text.split('\n')[0].split(';').length > text.split('\n')[0].split(',').length ? ';' : ','));
    body.innerHTML = `<div class="fm-table"><table><thead><tr>${(rows[0] || []).map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.slice(1, 500).map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${rows.length > 500 ? '<p class="hint">Mostrando as primeiras 500 linhas.</p>' : ''}`;
  } else if (k === 'json') { let pretty = text; try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch { /* mostra como está */ } body.innerHTML = `<pre>${esc(pretty)}</pre>`; }
  else body.innerHTML = `<pre>${esc(text)}</pre>`;
}
