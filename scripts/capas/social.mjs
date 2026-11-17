// Gera as imagens do site para buscadores e redes sociais:
//   public/brand/og-iaorg.png       1200×630, prévia de link (Open Graph / X / WhatsApp)
//   public/brand/iaorg-512.png      512×512, logo para o Google (dados estruturados)
//   public/brand/apple-touch-icon.png 180×180, ícone no iPhone
//
// Uso (precisa do pacote playwright com o Chromium instalado):
//   node scripts/capas/social.mjs [raiz-do-repositorio]
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(process.argv[2] || path.join(import.meta.dirname, '..', '..'));
const brand = path.join(root, 'public', 'brand');
const browser = await chromium.launch().catch(() => chromium.launch({ channel: 'chromium' }));

const shot = async (src, w, h, file) => {
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  if (src.startsWith('<')) await page.setContent(src); else await page.goto(src);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => [...document.images].every((i) => i.complete));
  await page.screenshot({ path: file, type: 'png' });
  await page.close();
  console.log(path.relative(root, file), `${Math.round(fs.statSync(file).size / 1024)} KB`);
};

await shot(pathToFileURL(path.join(root, 'scripts', 'capas', 'social.html')).href, 1200, 630, path.join(brand, 'og-iaorg.png'));

// ícones: a marca ocupando o quadrado inteiro (ela já tem fundo amarelo)
const mark = `data:image/svg+xml;base64,${fs.readFileSync(path.join(brand, 'iaorg-mark.svg')).toString('base64')}`;
const icon = (s) => `<style>*{margin:0}body{width:${s}px;height:${s}px}img{width:100%;height:100%;display:block}</style><img src="${mark}">`;
await shot(icon(512), 512, 512, path.join(brand, 'iaorg-512.png'));
await shot(icon(180), 180, 180, path.join(brand, 'apple-touch-icon.png'));
await browser.close();
