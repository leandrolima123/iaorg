// Marca da empresa: identidade visual, tom de voz e o modelo dos e-mails que os agentes enviam
// (cabeçalho com logo, corpo, assinatura e rodapé). Aplicado no envio (Resend e Gmail), não pelo agente:
// o agente escreve só o corpo e o IAORG monta o e-mail com a marca.
import fs from 'node:fs';
import express from 'express';

const FONTS = {
  arial: 'Arial, Helvetica, sans-serif',
  helvetica: "'Helvetica Neue', Helvetica, Arial, sans-serif",
  georgia: 'Georgia, \'Times New Roman\', serif',
  verdana: 'Verdana, Geneva, sans-serif',
  trebuchet: "'Trebuchet MS', Tahoma, sans-serif",
};
const SOCIALS = ['site', 'instagram', 'linkedin', 'whatsapp', 'youtube', 'facebook', 'tiktok'];
const SOCIAL_LABEL = { site: 'Site', instagram: 'Instagram', linkedin: 'LinkedIn', whatsapp: 'WhatsApp', youtube: 'YouTube', facebook: 'Facebook', tiktok: 'TikTok' };

const DEFAULTS = {
  color: '#1f6b4a', // cor principal (botões, linha do cabeçalho, links)
  textColor: '#24231f',
  background: '#f4f3ef',
  font: 'arial',
  voice: '', // tom de voz: entra no prompt de todos os agentes
  email: {
    enabled: true,
    showLogo: true,
    logoWidth: 140,
    headerAlign: 'left',
    greeting: '', // opcional: abertura padrão (ex.: "Olá, {{cliente}}!") — só como orientação ao agente
    signature: '{{nome}}\n{{cargo}} · {{empresa}}',
    phone: '',
    replyNote: '', // ex.: "Responda este e-mail que a gente te ajuda."
    footer: '', // endereço, CNPJ, horário de atendimento
    legal: '', // aviso legal / LGPD / confidencialidade
    links: {}, // site, instagram, linkedin, whatsapp...
  },
};

const hex = (v, d) => (/^#[0-9a-f]{6}$/i.test(String(v || '')) ? String(v).toLowerCase() : d);
const str = (v, n) => String(v ?? '').slice(0, n);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const url = (v) => { const s = String(v || '').trim(); if (!s) return ''; const u = /^https?:\/\//i.test(s) ? s : `https://${s}`; try { return new URL(u).href; } catch { return ''; } };

export function brandOf(store) {
  const b = store.company.brand || {};
  const e = b.email || {};
  return {
    ...DEFAULTS, ...b,
    email: { ...DEFAULTS.email, ...e, links: { ...(e.links || {}) } },
  };
}

// Normaliza o que vem da tela.
export function cleanBrand(body, prev) {
  const e = body?.email || {};
  const links = {};
  for (const k of SOCIALS) { const v = k === 'whatsapp' ? str(e.links?.[k], 40).replace(/[^\d+]/g, '') : url(e.links?.[k]); if (v) links[k] = v; }
  return {
    color: hex(body?.color, prev.color),
    textColor: hex(body?.textColor, prev.textColor),
    background: hex(body?.background, prev.background),
    font: FONTS[body?.font] ? body.font : prev.font,
    voice: str(body?.voice ?? prev.voice, 3000),
    email: {
      enabled: e.enabled !== undefined ? !!e.enabled : prev.email.enabled,
      showLogo: e.showLogo !== undefined ? !!e.showLogo : prev.email.showLogo,
      logoWidth: Math.max(60, Math.min(320, Number(e.logoWidth) || prev.email.logoWidth)),
      headerAlign: ['left', 'center'].includes(e.headerAlign) ? e.headerAlign : prev.email.headerAlign,
      greeting: str(e.greeting ?? prev.email.greeting, 200),
      signature: str(e.signature ?? prev.email.signature, 1000),
      phone: str(e.phone ?? prev.email.phone, 40),
      replyNote: str(e.replyNote ?? prev.email.replyNote, 300),
      footer: str(e.footer ?? prev.email.footer, 1000),
      legal: str(e.legal ?? prev.email.legal, 1500),
      links,
    },
  };
}

function fillSig(t, { agent, store, brand }) {
  const c = store.company;
  const vars = {
    nome: agent?.name || 'Equipe', cargo: agent?.title || agent?.role || '', empresa: c.name || '',
    site: brand.email.links.site ? brand.email.links.site.replace(/^https?:\/\//, '').replace(/\/$/, '') : (c.website || ''),
    telefone: brand.email.phone || '', email: agent?.email || '',
  };
  return String(t || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => vars[k] ?? '')
    .split('\n').map((l) => l.replace(/\s*·\s*$/, '').replace(/^\s*·\s*/, '').trim()).filter(Boolean).join('\n');
}

// Corpo: texto do agente -> HTML (parágrafos, listas com "-", **negrito**, links).
function bodyHtml(text, color) {
  const inline = (s) => esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, `<a href="$1" style="color:${color};text-decoration:underline">$1</a>`);
  return String(text || '').trim().split(/\n{2,}/).map((block) => {
    const lines = block.split('\n');
    if (lines.every((l) => /^\s*[-*•]\s+/.test(l))) {
      return `<ul style="margin:0 0 16px;padding-left:20px">${lines.map((l) => `<li style="margin:0 0 6px">${inline(l.replace(/^\s*[-*•]\s+/, ''))}</li>`).join('')}</ul>`;
    }
    return `<p style="margin:0 0 16px">${lines.map(inline).join('<br>')}</p>`;
  }).join('\n');
}

const LOGO_TYPES = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };

// Largura e altura da imagem (PNG, JPEG, WebP) lidas do cabeçalho, sem biblioteca.
export function imageSize(buf) {
  try {
    if (buf.readUInt32BE(0) === 0x89504e47) return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
      const kind = buf.toString('ascii', 12, 16);
      if (kind === 'VP8X') return { w: buf.readUIntLE(24, 3) + 1, h: buf.readUIntLE(27, 3) + 1 };
      if (kind === 'VP8 ') return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
      if (kind === 'VP8L') { const b = buf.readUInt32LE(21); return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 }; }
    }
    if (buf[0] === 0xff && buf[1] === 0xd8) {
      for (let i = 2; i < buf.length - 9;) {
        if (buf[i] !== 0xff) { i++; continue; }
        const m = buf[i + 1];
        if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5) };
        i += 2 + buf.readUInt16BE(i + 2);
      }
    }
  } catch { /* formato inesperado */ }
  return null;
}

function logoOf(store) {
  const f = store.logoFile?.();
  if (!f || !fs.existsSync(f)) return null;
  const ext = f.split('.').pop();
  const buf = fs.readFileSync(f);
  return { filename: `logo.${ext}`, mime: LOGO_TYPES[ext] || 'image/png', b64: buf.toString('base64'), cid: 'logo-empresa', size: imageSize(buf) };
}

// Logo pequeno demais para o e-mail (fica pixelado se esticado) ou em formato que o Outlook não mostra.
export function logoInfo(store) {
  const l = logoOf(store);
  if (!l) return null;
  return { type: l.filename.split('.').pop(), width: l.size?.w || null, height: l.size?.h || null };
}

/**
 * Monta o e-mail com a marca. Devolve { text, html, inline } — inline = imagens embutidas (logo, por Content-ID).
 * preview=true usa o logo como data: URI (para mostrar na tela).
 */
export function renderEmail(store, agent, { text, brand: draft, preview = false } = {}) {
  const brand = draft || brandOf(store);
  const e = brand.email;
  const sig = fillSig(e.signature, { agent, store, brand });
  const linkList = SOCIALS.filter((k) => e.links[k]).map((k) => ({ k, href: k === 'whatsapp' ? `https://wa.me/${e.links[k].replace(/\D/g, '')}` : e.links[k] }));
  const plain = [String(text || '').trim().replace(/\*\*(.+?)\*\*/g, '$1'), sig && `--\n${sig}`, e.phone && !/\{\{\s*telefone/.test(e.signature) ? e.phone : '', e.replyNote, e.footer, e.legal].filter(Boolean).join('\n\n');
  if (!e.enabled) return { text: plain, html: null, inline: [] };

  const logo = e.showLogo ? logoOf(store) : null;
  const src = logo ? (preview ? `data:${logo.mime};base64,${logo.b64}` : `cid:${logo.cid}`) : null;
  const font = FONTS[brand.font] || FONTS.arial;
  const c = brand.color;
  const name = esc(store.company.name || '');
  // Nunca estica o logo além do tamanho real (esticado, fica pixelado). Telas de alta densidade pedem
  // o dobro de pixels: por isso o aviso na página Marca quando o logo é pequeno.
  const lw = logo?.size?.w ? Math.min(e.logoWidth, logo.size.w) : e.logoWidth;
  const head = src
    ? `<img src="${src}" alt="${name}" width="${lw}" style="display:inline-block;width:${lw}px;max-width:100%;height:auto;border:0">`
    : `<span style="font-size:20px;font-weight:bold;color:${c}">${name}</span>`;
  const sigHtml = sig ? sig.split('\n').map((l, i) => (i === 0 ? `<strong style="color:${brand.textColor}">${esc(l)}</strong>` : esc(l))).join('<br>') : '';
  const linksHtml = linkList.map(({ k, href }) => `<a href="${esc(href)}" style="color:${c};text-decoration:none;margin-right:14px">${SOCIAL_LABEL[k]}</a>`).join('');
  const muted = '#77756e';

  const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${name}</title></head>
<body style="margin:0;padding:0;background:${brand.background}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${brand.background}">
<tr><td align="center" style="padding:24px 12px">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;background:#ffffff;border-radius:8px;border-top:4px solid ${c}">
    <tr><td align="${e.headerAlign}" style="padding:24px 32px 8px">${head}</td></tr>
    <tr><td style="padding:16px 32px 8px;font-family:${font};font-size:15px;line-height:1.6;color:${brand.textColor}">
${bodyHtml(text, c)}
    </td></tr>
    ${sigHtml ? `<tr><td style="padding:0 32px 24px;font-family:${font};font-size:14px;line-height:1.5;color:${muted}">
      <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td style="border-left:3px solid ${c};padding-left:12px;font-family:${font};font-size:14px;line-height:1.5;color:${muted}">${sigHtml}${e.phone && !/\{\{\s*telefone/.test(e.signature) ? `<br>${esc(e.phone)}` : ''}</td></tr></table>
    </td></tr>` : ''}
    ${e.replyNote ? `<tr><td style="padding:0 32px 20px;font-family:${font};font-size:13px;color:${muted}">${esc(e.replyNote)}</td></tr>` : ''}
  </table>
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%">
    <tr><td align="center" style="padding:16px 32px;font-family:${font};font-size:12px;line-height:1.5;color:${muted}">
      ${linksHtml ? `<div style="margin-bottom:8px">${linksHtml}</div>` : ''}
      ${e.footer ? `<div>${esc(e.footer).replace(/\n/g, '<br>')}</div>` : ''}
      ${e.legal ? `<div style="margin-top:8px;font-size:11px">${esc(e.legal).replace(/\n/g, '<br>')}</div>` : ''}
    </td></tr>
  </table>
</td></tr>
</table>
</body></html>`;
  return { text: plain, html, inline: logo && !preview ? [logo] : [] };
}

// Regra para o prompt dos agentes: tom de voz e "não assine" quando o modelo de e-mail está ligado.
// email: o agente envia e-mails (só então entra a regra de não assinar).
export function brandPromptBlock(store, { email = false } = {}) {
  const b = brandOf(store);
  const out = [];
  if (b.voice.trim()) out.push(`<tom_de_voz_da_marca>\n${b.voice.trim()}\n</tom_de_voz_da_marca>`);
  if (email && b.email.enabled) out.push(`E-mails: escreva só o corpo da mensagem (saudação e conteúdo${b.email.greeting ? `; abertura padrão: "${b.email.greeting}"` : ''}). NÃO escreva assinatura, nome, cargo, telefone ou rodapé no fim: o IAORG aplica automaticamente o modelo de e-mail da marca (logo, assinatura e rodapé). Pode usar parágrafos, listas com "-" e **negrito**.`);
  return out.join('\n');
}

export function mountBrand(app, { requireCompany, need, refresh }) {
  app.get('/api/brand', requireCompany, need('admin'), (req, res) => {
    const logo = logoInfo(req.company);
    res.json({ brand: brandOf(req.company), fonts: Object.keys(FONTS), socials: SOCIALS, hasLogo: !!logo, logoType: logo?.type || null, logoSize: logo?.width ? { w: logo.width, h: logo.height } : null });
  });
  app.put('/api/brand', requireCompany, need('admin'), express.json({ limit: '200kb' }), (req, res) => {
    req.company.company.brand = cleanBrand(req.body || {}, brandOf(req.company));
    req.company.save();
    refresh?.(req.company);
    res.json({ ok: true, brand: brandOf(req.company) });
  });
  // Prévia com o rascunho da tela (sem salvar).
  app.post('/api/brand/preview', requireCompany, need('admin'), express.json({ limit: '200kb' }), (req, res) => {
    const store = req.company;
    const brand = cleanBrand(req.body?.brand || {}, brandOf(store));
    const agent = store.getAgent(String(req.body?.agentId || '')) || store.aiAgents()[0] || null;
    const text = str(req.body?.text, 5000) || 'Olá, Maria!\n\nObrigado pelo contato. Seguem os próximos passos:\n- Acesse sua conta\n- Escolha o plano\n\nQualquer dúvida, é só responder este e-mail.';
    const out = renderEmail(store, agent, { text, brand, preview: true });
    res.json({ html: out.html, text: out.text });
  });
}
