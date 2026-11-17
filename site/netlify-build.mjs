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

// páginas: o mesmo HTML do app, trocado para o modo "lista de espera"
const pages = { 'index.html': 'landing.html', 'privacidade.html': 'privacidade.html', 'termos.html': 'termos.html' };
for (const [dest, src] of Object.entries(pages)) {
  const html = fs.readFileSync(path.join(pub, src), 'utf8');
  if (!html.includes('data-mode="app"')) throw new Error(`${src} sem data-mode="app"`);
  fs.writeFileSync(path.join(out, dest), html.replace('data-mode="app"', 'data-mode="waitlist"'));
}

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

fs.writeFileSync(path.join(out, 'robots.txt'), 'User-agent: *\nDisallow: /admin/\nDisallow: /api/\n');

let n = 0, bytes = 0;
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else { n++; bytes += fs.statSync(p).size; } } };
walk(out);
console.log(`[netlify-build] dist-netlify pronto: ${n} arquivos, ${(bytes / 1048576).toFixed(1)} MB`);
