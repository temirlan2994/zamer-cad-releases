// Rasterise SVGs to PNG (transparent background) at exact pixel sizes.
const { chromium } = require('playwright'); const fs = require('fs'); const path = require('path');
const [dir, out] = process.argv.slice(2);
const jobs = [
  ['zamer-cad-icon-square.svg', 'play-store-icon-512.png', 512, 512],
  ['zamer-cad-icon.svg', 'zamer-cad-icon-1024.png', 1024, 1024],
  ['zamer-cad-icon.svg', 'zamer-cad-icon-512.png', 512, 512],
  ['zamer-cad-icon-square.svg', 'icon-192.png', 192, 192],
  ['zamer-cad-icon-square.svg', 'apple-touch-icon-180.png', 180, 180],
  ['zamer-cad-icon-small.svg', 'favicon-48.png', 48, 48],
  ['zamer-cad-icon-small.svg', 'favicon-32.png', 32, 32],
  ['zamer-cad-icon-small.svg', 'favicon-16.png', 16, 16],
  ['android-foreground.svg', 'android/ic_launcher_foreground.png', 432, 432],
  ['android-background.svg', 'android/ic_launcher_background.png', 432, 432],
  ['android-monochrome.svg', 'android/ic_launcher_monochrome.png', 432, 432],
  ['zamer-cad-logo.svg', 'zamer-cad-logo.png', null, 240],
  ['zamer-cad-logo-dark.svg', 'zamer-cad-logo-dark.png', null, 240],
  ['zamer-cad-mark-navy.svg', 'zamer-cad-mark-navy.png', 824, 764],
  ['zamer-cad-mark-white.svg', 'zamer-cad-mark-white.png', 824, 764],
];
(async () => {
  const b = await chromium.launch(); const p = await b.newPage();
  for (const [src, dst, w0, h] of jobs) {
    const svg = fs.readFileSync(path.join(dir, src), 'utf8');
    const vb = svg.match(/viewBox="([\d.\s-]+)"/)[1].split(/\s+/).map(Number);
    const w = w0 || Math.round(h * vb[2] / vb[3]);
    await p.setViewportSize({ width: w, height: h });
    await p.setContent(`<html><body style="margin:0;background:transparent"><img src="data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}" style="display:block;width:${w}px;height:${h}px"></body></html>`);
    await p.waitForTimeout(80);
    fs.mkdirSync(path.dirname(path.join(out, dst)), { recursive: true });
    await p.screenshot({ path: path.join(out, dst), omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } });
  }
  await b.close(); console.log('rendered', jobs.length);
})();
