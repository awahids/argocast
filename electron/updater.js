// Auto-update for the desktop app.
//
// Windows: electron-updater against the GitHub Releases feed (latest.yml +
//   blockmap published by CI). Downloads in the background; installs on
//   "Mulai ulang" or silently when the app quits.
// macOS: the app is only ad-hoc signed, which Squirrel.Mac rejects, so we
//   check the GitHub releases API ourselves, download the DMG for this CPU,
//   copy the new argocast.app next to the running one and swap it in from a
//   tiny detached shell script after we quit. Falls back to opening the DMG.
//
// State pushed to the UI: { status, current, version, percent, message, manual }
//   status: idle | checking | latest | available | downloading | ready | installing | error | disabled
import { app, net, shell } from 'electron';
import { EventEmitter } from 'node:events';
import { spawn, execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import { pickMacRelease } from '../src/versions.js';

const run = promisify(execFile);
const REPO = 'awahids/argocast';
const FIRST_CHECK_MS = 15_000;
const INTERVAL_MS = 6 * 60 * 60 * 1000;

export class Updater extends EventEmitter {
  /** @param {{ isBusy: () => boolean, beforeQuit: () => void }} hooks */
  constructor(hooks) {
    super();
    this.hooks = hooks;
    this.state = { status: 'idle', current: app.getVersion() };
    this.enabled = false;
  }

  #set(patch) {
    this.state = { ...this.state, ...patch };
    this.emit('state', this.state);
  }

  async init() {
    const feed = process.env.ARGOCAST_UPDATE_FEED; // generic feed for testing
    if (!app.isPackaged && !feed) return this.#set({ status: 'disabled', message: 'Pembaruan otomatis hanya untuk aplikasi terpasang.' });
    if (process.platform === 'win32') await this.#initWindows(feed);
    else if (process.platform === 'darwin') this.enabled = true;
    else return this.#set({ status: 'disabled' });
    if (!this.enabled) return;
    setTimeout(() => this.check(false), FIRST_CHECK_MS).unref?.();
    setInterval(() => this.check(false), INTERVAL_MS).unref?.();
  }

  // ---- Windows -------------------------------------------------------------
  async #initWindows(feed) {
    const { autoUpdater } = (await import('electron-updater')).default;
    this.au = autoUpdater;
    autoUpdater.allowPrerelease = true; // every argocast release is a pre-release for now
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = null;
    if (feed) {
      autoUpdater.forceDevUpdateConfig = !app.isPackaged;
      autoUpdater.setFeedURL({ provider: 'generic', url: feed });
    }
    autoUpdater.on('checking-for-update', () => this.#set({ status: 'checking', message: null }));
    autoUpdater.on('update-not-available', () => this.#set({ status: 'latest' }));
    autoUpdater.on('update-available', (i) => this.#set({ status: 'downloading', version: i.version, percent: 0 }));
    autoUpdater.on('download-progress', (p) => this.#set({ status: 'downloading', percent: Math.round(p.percent) }));
    autoUpdater.on('update-downloaded', (i) => this.#set({ status: 'ready', version: i.version, percent: 100 }));
    autoUpdater.on('error', (e) => this.#set({ status: 'error', message: friendly(e) }));
    this.enabled = true;
  }

  // ---- common --------------------------------------------------------------
  /** @param {boolean} manual true when the user pressed "Periksa pembaruan" */
  async check(manual = true) {
    if (!this.enabled) return this.state;
    if (['checking', 'downloading', 'installing', 'ready'].includes(this.state.status)) return this.state;
    this.#set({ manual });
    try {
      if (this.au) {
        await this.au.checkForUpdates();
      } else {
        this.#set({ status: 'checking', message: null });
        const res = await net.fetch(`https://api.github.com/repos/${REPO}/releases?per_page=10`, {
          headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'argocast-updater' },
        });
        if (!res.ok) throw new Error(`GitHub ${res.status}`);
        const rel = pickMacRelease(await res.json(), app.getVersion(), process.arch);
        this.mac = rel;
        this.#set(rel ? { status: 'available', version: rel.version } : { status: 'latest' });
      }
    } catch (e) {
      this.#set({ status: 'error', message: friendly(e) });
    }
    return this.state;
  }

  /** Windows: restart into the downloaded update. macOS: download and swap the app. */
  async install() {
    if (this.hooks.isBusy()) return this.#set({ message: 'Hentikan cast dulu sebelum memasang pembaruan.' });
    if (this.au) {
      if (this.state.status !== 'ready') return;
      this.hooks.beforeQuit();
      setImmediate(() => this.au.quitAndInstall(true, true)); // silent, relaunch afterwards
      return;
    }
    if (!this.mac || !['available', 'error'].includes(this.state.status)) return;
    try {
      await this.#installMac(this.mac);
    } catch (e) {
      this.#set({ status: 'error', message: `Pembaruan otomatis gagal (${friendly(e)}). DMG dibuka — seret argocast ke Applications.` });
      if (this.dmg) shell.openPath(this.dmg);
      else shell.openExternal(this.mac.page);
    }
  }

  async #installMac(rel) {
    this.#set({ status: 'downloading', percent: 0, message: null });
    const dmg = path.join(app.getPath('downloads'), `argocast-${rel.version}-mac-${process.arch}.dmg`);
    await download(rel.url, dmg, rel.size, (percent) => this.#set({ percent }));
    this.dmg = dmg;
    this.#set({ status: 'installing' });

    // /Applications/argocast.app/Contents/MacOS/argocast -> /Applications/argocast.app
    const bundle = path.resolve(process.execPath, '..', '..', '..');
    if (!bundle.endsWith('.app')) throw new Error('lokasi aplikasi tidak dikenali');
    const staged = `${bundle}.new`;
    const mount = fs.mkdtempSync(path.join(os.tmpdir(), 'argocast-dmg-'));
    await run('hdiutil', ['attach', dmg, '-nobrowse', '-readonly', '-mountpoint', mount]);
    try {
      const src = path.join(mount, 'argocast.app');
      if (!fs.existsSync(src)) throw new Error('argocast.app tidak ada di DMG');
      fs.rmSync(staged, { recursive: true, force: true });
      await run('ditto', [src, staged]); // write access to the app's folder is checked here
    } finally {
      await run('hdiutil', ['detach', mount, '-quiet']).catch(() => {});
    }
    await run('xattr', ['-dr', 'com.apple.quarantine', staged]).catch(() => {});

    // Swap after we exit, then relaunch.
    const script = [
      `while kill -0 ${process.pid} 2>/dev/null; do sleep 0.3; done`,
      `rm -rf "${bundle}.old" && mv "${bundle}" "${bundle}.old" && mv "${staged}" "${bundle}" && rm -rf "${bundle}.old"`,
      `open "${bundle}"`,
    ].join('\n');
    spawn('/bin/sh', ['-c', script], { detached: true, stdio: 'ignore' }).unref();
    fs.rmSync(dmg, { force: true });
    this.hooks.beforeQuit();
    app.quit();
  }
}

async function download(url, file, size, onProgress) {
  const res = await net.fetch(url);
  if (!res.ok || !res.body) throw new Error(`unduhan gagal (${res.status})`);
  const total = Number(res.headers.get('content-length')) || size || 0;
  const tmp = `${file}.part`;
  const out = fs.createWriteStream(tmp);
  let got = 0, last = -1;
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      got += value.length;
      if (!out.write(value)) await new Promise((r) => out.once('drain', r));
      const pct = total ? Math.floor((got / total) * 100) : 0;
      if (pct !== last) { last = pct; onProgress(pct); }
    }
  } finally {
    await new Promise((r) => out.end(r));
  }
  if (total && got !== total) throw new Error('unduhan tidak lengkap');
  fs.renameSync(tmp, file);
}

function friendly(e) {
  const m = String(e?.message ?? e);
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|ERR_INTERNET|ERR_NAME|net::/i.test(m)) return 'Tidak ada koneksi internet.';
  if (/EACCES|EPERM|Permission denied|Operation not permitted/i.test(m)) return 'tidak ada izin menulis ke folder aplikasi';
  return m.split('\n')[0].slice(0, 160);
}
