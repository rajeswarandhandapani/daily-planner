// Draws the app icons with a headless browser. Usage: npm run icons
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const art = ({ scale, detail = true }) => `
  <g transform="translate(256 256) scale(${scale}) translate(-256 -256)">
    <!-- Calendar body -->
    <rect x="96" y="120" width="320" height="292" rx="44" fill="#ffffff"/>
    <!-- Calendar header band -->
    <path d="M96 164C96 139.7 115.7 120 140 120H372C396.3 120 416 139.7 416 164V204H96V164Z" fill="#dce8f8"/>
    <!-- Binding rings -->
    <rect x="164" y="88" width="28" height="62" rx="14" fill="#ffffff"/>
    <rect x="320" y="88" width="28" height="62" rx="14" fill="#ffffff"/>
    <!-- Checkmark -->
    <path d="M180 306L232 356L340 248" fill="none" stroke="#2563eb" stroke-width="${detail ? 34 : 42}" stroke-linecap="round" stroke-linejoin="round"/>
  </g>`;

const svg = (size, { rounded, scale, detail }) => `<!doctype html><html><body style="margin:0;background:transparent">
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512" style="display:block">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#3b82f6"/>
      <stop offset="1" stop-color="#1d4ed8"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="${rounded ? 112 : 0}" fill="url(#bg)"/>
  ${art({ scale, detail })}
</svg></body></html>`;

const ICONS = [
  { name: 'icon-192', size: 192, rounded: true, scale: 1.0 },
  { name: 'icon-512', size: 512, rounded: true, scale: 1.0 },
  { name: 'icon-maskable-192', size: 192, rounded: false, scale: 0.78 },
  { name: 'icon-maskable-512', size: 512, rounded: false, scale: 0.78 },
  { name: 'apple-touch-icon', size: 180, rounded: false, scale: 0.92 },
  { name: 'favicon-32', size: 32, rounded: true, scale: 1.1, detail: false },
];

(async () => {
  const outDir = path.join(__dirname, '..', 'public', 'icons');
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch()
    .catch(() => chromium.launch({ channel: 'chrome' }))
    .catch(() => chromium.launch({ channel: 'msedge' }));
  for (const icon of ICONS) {
    const p = await browser.newPage({ viewport: { width: icon.size, height: icon.size } });
    await p.setContent(svg(icon.size, icon));
    await p.screenshot({ path: path.join(outDir, `${icon.name}.png`), omitBackground: icon.rounded });
    await p.close();
  }
  await browser.close();
  console.log(`Generated ${ICONS.length} icons in public/icons/`);
})();
