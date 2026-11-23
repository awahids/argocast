// Renders build/icon.png (512x512) from an inline SVG using Electron.
// Run: npx electron scripts/make-icon.js
import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

const SIZE = 512;
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${SIZE}" height="${SIZE}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#14b8a6"/><stop offset="1" stop-color="#6366f1"/>
    </linearGradient>
  </defs>
  <rect x="16" y="16" width="480" height="480" rx="112" fill="url(#g)"/>
  <rect x="112" y="140" width="288" height="190" rx="22" fill="none" stroke="#fff" stroke-width="28"/>
  <rect x="206" y="352" width="100" height="24" rx="12" fill="#fff"/>
  <path d="M196 270a60 60 0 0 1 120 0" fill="none" stroke="#fff" stroke-width="24" stroke-linecap="round"/>
  <circle cx="256" cy="272" r="18" fill="#fff"/>
</svg>`;

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: SIZE, height: SIZE, frame: false, transparent: true, show: true, useContentSize: true });
  await win.loadURL(`data:text/html,<style>html,body{margin:0;background:transparent;overflow:hidden}</style>${encodeURIComponent(svg)}`);
  await new Promise((r) => setTimeout(r, 400));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: SIZE, height: SIZE });
  const out = path.resolve('build', 'icon.png');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, img.resize({ width: SIZE, height: SIZE }).toPNG());
  console.log(`wrote ${out}`);
  app.exit(0);
});
