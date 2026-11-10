// Rasterizes the logo SVGs to the PNGs app.json references. Build-time only.
//   node assets/source/render.mjs
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const assets = resolve(here, '..');
const svg = (name) => readFileSync(resolve(here, name));

const jobs = [
  ['logo-icon.svg', 'icon.png', 1024],
  ['logo-fg.svg', 'android-icon-foreground.png', 1024],
  ['logo-bg.svg', 'android-icon-background.png', 1024],
  ['logo-mono.svg', 'android-icon-monochrome.png', 1024],
  ['logo-fg.svg', 'splash-icon.png', 1024],
  ['logo-icon.svg', 'favicon.png', 48],
];

for (const [src, out, size] of jobs) {
  await sharp(svg(src), { density: 384 }).resize(size, size).png().toFile(resolve(assets, out));
  console.log(`${out} (${size}px)`);
}
