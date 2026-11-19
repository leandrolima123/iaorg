// Monta a landing estática para o Netlify em dist-netlify/ (o netlify.toml chama este script).
// Mesmo conteúdo do site/server.mjs: páginas em modo "lista de espera" e só os arquivos que o site usa.
// O formulário continua postando em /api/interesse, atendido por netlify/functions/interesse.mjs.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const pub = path.join(root, 'public');
const mods = path.join(root, 'node_modules');
const out = path.join(root, 'dist-netlify');

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const copy = (from, to) => {
  if (!fs.existsSync(from)) throw new Error(`não encontrei ${path.relative(root, from)} (rode npm install antes)`);
  fs.cpSync(from, path.join(out, to), { recursive: true });
};

// Endereço público do site. As tags de busca e de compartilhamento só entram aqui (e não no HTML
// de public/), porque o mesmo HTML também é servido por instalações próprias em outros endereços.
const SITE = (process.env.SITE_URL || 'https://iaorg.app').replace(/\/+$/, '');
const REPO = 'https://github.com/leandrolima123/iaorg';
const COURSE_URL = 'https://ltech.vendabien.com/produto/1a3ac412-6615-4fd8-8aff-149d474b26bf';
const OG_IMAGE = `${SITE}/brand/og-iaorg.png`;
const PUBLISHED = '2026-11-16';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
const meta = (html, re) => (html.match(re) || [])[1] || '';
const ldJson = (obj) => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`;

const org = { '@type': 'Organization', '@id': `${SITE}/#org`, name: 'IAORG', url: `${SITE}/`, logo: `${SITE}/brand/iaorg-512.png`, sameAs: [REPO] };
const site = { '@type': 'WebSite', '@id': `${SITE}/#site`, name: 'IAORG', url: `${SITE}/`, inLanguage: 'pt-BR', publisher: { '@id': `${SITE}/#org` } };

// vídeos de demonstração publicados (os "Em breve" ficam de fora)
const iso = (d) => { const [m, s] = String(d || '').split(':').map(Number); return Number.isFinite(m) && Number.isFinite(s) ? `PT${m}M${s}S` : undefined; };
const { demos } = JSON.parse(fs.readFileSync(path.join(pub, 'videos', 'demos.json'), 'utf8'));
const videos = demos.filter((d) => d.src).map((d) => ({
  '@type': 'VideoObject', name: `${d.titulo} — IAORG`, description: d.descricao, thumbnailUrl: `${SITE}${d.poster}`,
  contentUrl: `${SITE}${d.src}`, uploadDate: d.publicado || PUBLISHED, duration: iso(d.duracao), inLanguage: 'pt-BR',
}));

const pages = {
  'index.html': { src: 'landing.html', url: `${SITE}/`, ogType: 'website', priority: '1.0', graph: (title, desc) => [org, site,
    { '@type': 'SoftwareApplication', name: 'IAORG', url: `${SITE}/`, description: desc, image: OG_IMAGE,
      applicationCategory: 'BusinessApplication', operatingSystem: 'Linux, macOS, Windows (Docker)', inLanguage: 'pt-BR',
      license: `${REPO}/blob/main/LICENSE`, offers: { '@type': 'Offer', price: '0', priceCurrency: 'BRL' }, publisher: { '@id': `${SITE}/#org` } },
    { '@type': 'SoftwareSourceCode', name: 'IAORG', codeRepository: REPO, programmingLanguage: 'JavaScript', license: `${REPO}/blob/main/LICENSE` },
    // curso vendido na loja (seção #curso da landing)
    { '@type': 'Product', name: 'IAORG na Prática: Curso Completo de Agentes de IA para o seu Negócio', image: `${SITE}/brand/curso-iaorg-na-pratica.jpg`,
      description: 'E-book didático e ilustrado para montar e comandar uma equipe de agentes de IA no IAORG, com 5 casos completos, fichas prontas e plano de 30 dias.',
      brand: { '@id': `${SITE}/#org` }, inLanguage: 'pt-BR',
      offers: { '@type': 'Offer', price: '97.99', priceCurrency: 'BRL', availability: 'https://schema.org/InStock', url: COURSE_URL } },
    ...videos] },
  'privacidade.html': { src: 'privacidade.html', url: `${SITE}/privacidade`, ogType: 'article', priority: '0.3' },
  'termos.html': { src: 'termos.html', url: `${SITE}/termos`, ogType: 'article', priority: '0.3' },
};

// páginas: o mesmo HTML do app, trocado para o modo "lista de espera" e com as tags de busca
const today = new Date().toISOString().slice(0, 10);
for (const [dest, p] of Object.entries(pages)) {
  let html = fs.readFileSync(path.join(pub, p.src), 'utf8');
  if (!html.includes('data-mode="app"')) throw new Error(`${p.src} sem data-mode="app"`);
  const title = meta(html, /<title>([^<]*)<\/title>/);
  const desc = meta(html, /<meta name="description" content="([^"]*)"/);
  if (!title || !desc) throw new Error(`${p.src} sem <title> ou description`);
  const ogTitle = meta(html, /<meta property="og:title" content="([^"]*)"/) || title;
  const ogDesc = meta(html, /<meta property="og:description" content="([^"]*)"/) || desc;
  const graph = p.graph ? p.graph(title, desc) : [org, site, { '@type': 'WebPage', name: title, description: desc, url: p.url, inLanguage: 'pt-BR', isPartOf: { '@id': `${SITE}/#site` } }];
  const tags = [
    `<link rel="canonical" href="${p.url}" />`,
    '<meta name="robots" content="index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1" />',
    `<meta property="og:url" content="${p.url}" />`,
    '<meta property="og:site_name" content="IAORG" />',
    '<meta property="og:locale" content="pt_BR" />',
    `<meta property="og:image" content="${OG_IMAGE}" />`,
    '<meta property="og:image:width" content="1200" />',
    '<meta property="og:image:height" content="630" />',
    `<meta property="og:image:alt" content="${esc('IAORG: Dê a ordem. A equipe toca a obra. Agentes de IA e pessoas num escritório 3D.')}" />`,
    '<meta name="twitter:card" content="summary_large_image" />',
    `<meta name="twitter:title" content="${ogTitle}" />`,
    `<meta name="twitter:description" content="${ogDesc}" />`,
    `<meta name="twitter:image" content="${OG_IMAGE}" />`,
    ldJson({ '@context': 'https://schema.org', '@graph': graph }),
  ];
  // og:type, og:title e og:description: usa os do HTML ou completa com o título e a descrição
  if (!html.includes('property="og:type"')) tags.push(`<meta property="og:type" content="${p.ogType}" />`);
  if (!html.includes('property="og:title"')) tags.push(`<meta property="og:title" content="${title}" />`);
  if (!html.includes('property="og:description"')) tags.push(`<meta property="og:description" content="${desc}" />`);
  html = html.replace('data-mode="app"', 'data-mode="waitlist"').replace('</head>', `  ${tags.join('\n  ')}\n</head>`);
  fs.writeFileSync(path.join(out, dest), html);
  p.lastmod = today;
}

// sitemap e robots
fs.writeFileSync(path.join(out, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${Object.values(pages).map((p) => `  <url><loc>${p.url}</loc><lastmod>${p.lastmod}</lastmod><priority>${p.priority}</priority></url>`).join('\n')}
</urlset>
`);
fs.writeFileSync(path.join(out, 'robots.txt'), `User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /api/\n\nSitemap: ${SITE}/sitemap.xml\n`);

// arquivos do site
for (const f of ['site.css', 'avatars.js']) copy(path.join(pub, f), f);
copy(path.join(pub, 'brand'), 'brand');
copy(path.join(pub, 'videos'), 'videos');
for (const d of ['characters', 'animations']) copy(path.join(pub, 'assets/kaykit', d), `assets/kaykit/${d}`);
for (const f of ['LICENSE-KayKit.txt', 'LICENSE-KayKit-Skeletons.txt']) copy(path.join(pub, 'assets/kaykit', f), `assets/kaykit/${f}`);

// bibliotecas do navegador: só o que a landing importa
copy(path.join(mods, 'three/build/three.module.js'), 'vendor/three/build/three.module.js');
copy(path.join(mods, 'three/examples/jsm/loaders/GLTFLoader.js'), 'vendor/three/examples/jsm/loaders/GLTFLoader.js');
copy(path.join(mods, 'three/examples/jsm/utils'), 'vendor/three/examples/jsm/utils');
copy(path.join(mods, 'three/LICENSE'), 'vendor/three/LICENSE');
for (const fam of ['archivo', 'barlow-condensed']) {
  const dir = path.join(mods, '@fontsource', fam, 'files');
  for (const f of fs.readdirSync(dir).filter((x) => /-latin-\d+-normal\.woff2$/.test(x))) copy(path.join(dir, f), `vendor/fonts/${fam}/${f}`);
}


let n = 0, bytes = 0;
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else { n++; bytes += fs.statSync(p).size; } } };
walk(out);
console.log(`[netlify-build] dist-netlify pronto: ${n} arquivos, ${(bytes / 1048576).toFixed(1)} MB`);
