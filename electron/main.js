// Electron main process: owns discovery, the Caster and settings.
import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Caster, DEFAULT_PORT } from '../src/caster.js';
import { discover } from '../src/discovery.js';
import { findFfmpegAsync } from '../src/capture.js';
import { Updater } from './updater.js';
import { ReceiveMode } from './receive.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const SMOKE = process.env.ARGOCAST_SMOKE === '1';
if (SMOKE) app.setPath('userData', path.join(process.env.ARGOCAST_SMOKE_DIR, 'userData')); // never touch real settings

const DEFAULT_SETTINGS = {
  deviceName: os.hostname(),
  resolution: '1920x1080',
  fps: 30,
  quality: 'standard', // standard | weak | enhanced
  source: 'desktop',   // desktop | test
  touchback: true,     // panel touches control this computer
  recent: [],          // [{ host, port, name }]
};
const QUALITY_KBPS = { weak: 2500, standard: 5000, enhanced: 8000 };

let settingsFile;
let settings = { ...DEFAULT_SETTINGS };
let win;
let tray;
const caster = new Caster();
// Smoke test: receiver on private ports so it never clashes with a real panel app.
const receive = new ReceiveMode({ here, ...(SMOKE && { ports: { port: 39056, mediaPort: 39057, feedbackPort: 39058 } }) });
receive.on('state', (s) => { send('rx:state', s); updateTray(caster.state); });
const updater = new Updater({
  isBusy: () => caster.busy,
  beforeQuit: () => { app.isQuitting = true; },
});
updater.on('state', (s) => send('update:state', s));
if (process.env.ARGOCAST_UPDATE_LOG) {
  updater.on('state', (s) => fs.appendFileSync(process.env.ARGOCAST_UPDATE_LOG, `${new Date().toISOString()} ${JSON.stringify(s)}\n`));
}

function loadSettings() {
  settingsFile = path.join(app.getPath('userData'), 'settings.json');
  try { settings = { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(settingsFile, 'utf8')) }; } catch { /* defaults */ }
}

function saveSettings() {
  try { fs.mkdirSync(path.dirname(settingsFile), { recursive: true }); fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2)); } catch { /* ignore */ }
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

caster.on('state', (s) => {
  send('cast:state', s);
  updateTray(s.state);
});
caster.on('stats', (s) => send('cast:stats', s));
caster.on('touchback', (s) => send('cast:touchback', s));
if (SMOKE) {
  const logFile = path.join(process.env.ARGOCAST_SMOKE_DIR, 'caster.log');
  const w = (m) => fs.appendFileSync(logFile, `${new Date().toISOString()} ${m}\n`);
  caster.on('log', (m) => w(String(m).slice(0, 300)));
  caster.on('state', (s) => w(`[state] ${s.state} ${s.message ?? ''}`));
  ipcMain.on('smoke:mark', (_e, m) => w(`[ui] ${m}`));
  let last = Date.now(); // main-process event-loop stalls
  setInterval(() => { const now = Date.now(); if (now - last > 1500) w(`[lag] main blocked ${now - last} ms`); last = now; }, 250);
}

function createWindow() {
  win = new BrowserWindow({
    width: 440,
    height: 680,
    minWidth: 380,
    minHeight: 560,
    title: 'argocast',
    icon: path.join(here, '..', 'build', 'icon.png'),
    backgroundColor: '#0f1115',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(here, 'ui', 'index.html'));
  win.on('close', (e) => {
    // Keep casting in the background when the window is closed mid-cast.
    if ((caster.busy || receive.rx) && !app.isQuitting) { e.preventDefault(); win.hide(); }
  });
}

function trayIcon() {
  // 32x32 BGRA bitmap: teal rounded square with a white dot (Windows tray can't load SVG).
  const size = 32;
  const buf = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const cx = Math.max(6 - x, 0, x - 25), cy = Math.max(6 - y, 0, y - 25);
      const inside = cx * cx + cy * cy <= 36;
      const dot = (x - 15.5) ** 2 + (y - 15.5) ** 2 <= 30;
      if (!inside) continue;
      const [r, g, b] = dot ? [255, 255, 255] : [0x14, 0xb8, 0xa6];
      buf[i] = b; buf[i + 1] = g; buf[i + 2] = r; buf[i + 3] = 255;
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

function updateTray(state) {
  if (!tray) return;
  const casting = state === 'casting';
  tray.setToolTip(casting ? 'argocast — sedang cast' : receive.rx ? 'argocast — menerima cast' : 'argocast');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Buka argocast', click: () => { win.show(); win.focus(); } },
    { label: 'Hentikan cast', enabled: casting, click: () => caster.stop() },
    { label: 'Berhenti menerima', enabled: Boolean(receive.rx), click: () => receive.stop() },
    { type: 'separator' },
    { label: 'Keluar', click: () => { app.isQuitting = true; app.quit(); } },
  ]));
}

// ---- IPC -----------------------------------------------------------------
ipcMain.handle('settings:get', () => ({ ...settings, defaultPort: DEFAULT_PORT }));
ipcMain.handle('ffmpeg:check', async () => Boolean(await findFfmpegAsync()));
ipcMain.handle('settings:set', (_e, patch) => {
  settings = { ...settings, ...patch };
  saveSettings();
  return settings;
});
ipcMain.handle('discover', async () => {
  const found = await discover({ timeoutMs: 2500, onFound: (p) => send('discover:found', p) });
  return found;
});
ipcMain.handle('cast:start', async (_e, { host, port, pin, name, code }) => {
  if (SMOKE) caster.emit('log', `[ipc] cast:start ${host ?? code}`);
  const [width, height] = settings.resolution.split('x').map(Number);
  try {
    await caster.start({
      host,
      code,
      port: Number(port) || DEFAULT_PORT,
      pin,
      deviceName: settings.deviceName,
      width, height,
      fps: Number(settings.fps),
      bitrateKbps: QUALITY_KBPS[settings.quality] ?? QUALITY_KBPS.standard,
      source: settings.source,
      touchback: settings.touchback !== false && settings.source === 'desktop',
    });
    const t = caster.target; // resolved host when a share code was used
    const entry = { host: t.host, port: t.port, name: code ? `Panel ${t.host}` : (name || t.host) };
    settings.recent = [entry, ...settings.recent.filter((r) => !(r.host === entry.host && r.port === entry.port))].slice(0, 5);
    saveSettings();
    return { ok: true };
  } catch (err) {
    return { ok: false, message: caster.state === 'error' ? undefined : err.message };
  }
});
ipcMain.handle('cast:stop', () => caster.stop());
ipcMain.handle('cast:status', () => ({ state: caster.state }));
// receive mode (this computer as a panel)
ipcMain.handle('rx:get', () => receive.state);
ipcMain.handle('rx:start', async () => {
  try { return await receive.start({ name: settings.deviceName }); } catch (e) { return { on: false, error: e.message }; }
});
ipcMain.handle('rx:stop', () => receive.stop());
ipcMain.handle('rx:player-ready', (e) => receive.playerLoaded(e.sender));
ipcMain.on('rx:touch', (e, t) => receive.touch(e.sender, t));
ipcMain.on('rx:key', (e, code) => receive.key(e.sender, code));
ipcMain.on('rx:fullscreen', (e) => receive.toggleFullscreen(e.sender));
ipcMain.on('rx:disconnect', () => receive.disconnect());
ipcMain.handle('update:get', () => updater.state);
ipcMain.handle('update:check', () => updater.check(true));
ipcMain.handle('update:install', () => updater.install());

// ---- lifecycle --------------------------------------------------------------
// One instance only: launching again (e.g. from the Start menu) focuses the existing window.
if (!SMOKE && !app.requestSingleInstanceLock()) {
  app.exit(0);
}
app.on('second-instance', () => { if (win) { win.show(); win.focus(); } });
app.setAppUserModelId('app.argocast.sender');

app.whenReady().then(async () => {
  loadSettings();
  findFfmpegAsync(); // warm up early: first run after install may wait on an antivirus scan
  createWindow();
  if (!SMOKE) {
    updater.init();
    tray = new Tray(trayIcon());
    tray.on('click', () => { win.show(); win.focus(); });
    updateTray('idle');
  } else {
    const { runSmoke } = await import('./smoke.js');
    runSmoke({ win, app, settings });
  }
});

app.on('before-quit', async (e) => {
  if (receive.rx) {
    e.preventDefault();
    await receive.stop();
    app.quit();
    return;
  }
  if (caster.busy) {
    e.preventDefault();
    await caster.stop();
    app.isQuitting = true;
    app.quit();
  }
});
app.on('window-all-closed', () => { if (!caster.busy && !receive.rx) app.quit(); });
// macOS: clicking the Dock icon reopens the (hidden) window.
app.on('activate', () => { if (win) { win.show(); win.focus(); } });
