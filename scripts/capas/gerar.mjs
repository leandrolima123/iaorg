// Gera as capas (1280×720, JPG) dos vídeos de demonstração a partir de public/videos/demos.json.
// Para cada demo, abre scripts/capas/capa.html com o título, a cor, o ícone e um quadro do vídeo
// (public/videos/<id>.jpg, se existir) e salva public/videos/capas/<id>.jpg.
//
// Uso (precisa do pacote playwright com o Chromium instalado):
//   node scripts/capas/gerar.mjs [raiz-do-repositorio]
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(process.argv[2] || path.join(import.meta.dirname, '..', '..'));
const videos = path.join(root, 'public', 'videos');
const out = path.join(videos, 'capas');
const { demos } = JSON.parse(fs.readFileSync(path.join(videos, 'demos.json'), 'utf8'));
fs.mkdirSync(out, { recursive: true });

// usa o headless shell se existir; senão, o Chromium completo instalado pelo Playwright
const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chromium' }));
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
let n = 0;
for (const d of demos) {
  n++;
  const frame = path.join(videos, `${d.id}.jpg`);
  const url = new URL(pathToFileURL(path.join(root, 'scripts', 'capas', 'capa.html')));
  url.search = new URLSearchParams({
    n: String(n).padStart(2, '0'), titulo: d.titulo, desc: d.descricao || '', cor: d.cor || '', icone: d.icone || '',
    quadro: fs.existsSync(frame) ? pathToFileURL(frame).href : '',
  });
  await page.goto(url.href);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => [...document.images].every((i) => i.complete));
  const file = path.join(out, `${d.id}.jpg`);
  await page.screenshot({ path: file, type: 'jpeg', quality: 86 });
  console.log('capa', d.id, `${Math.round(fs.statSync(file).size / 1024)} KB`);
}
await browser.close();
