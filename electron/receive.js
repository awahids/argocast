// Receive mode: this computer acts as a panel. Owns the Receiver and the
// player window that shows the incoming screen.
import { BrowserWindow, screen } from 'electron';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { Receiver, RECEIVER_PORTS } from '../src/receiver.js';
import { encodeSix, localIPv4s } from '../src/sharecode.js';
import { encodeTouch, encodeKey } from '../src/touchback.js';

const MAX_BACKLOG = 120; // frames kept from the last key frame until the player is ready

export class ReceiveMode extends EventEmitter {
  constructor({ here, ports = RECEIVER_PORTS }) {
    super();
    this.here = here;
    this.ports = ports;
    this.rx = null;
    this.info = null;   // { code, name, ip, port }
    this.peer = null;   // { id, name, width, height }
    this.player = null;
    this.playerReady = false;
    this.backlog = [];
  }

  get state() {
    return { on: Boolean(this.rx), ...this.info, peer: this.peer ? { name: this.peer.name, width: this.peer.width, height: this.peer.height } : null };
  }

  #emitState() { this.emit('state', this.state); }

  async start({ name }) {
    if (this.rx) return this.state;
    const ip = localIPv4s()[0];
    if (!ip) throw new Error('Komputer ini tidak terhubung ke jaringan.');
    const code = encodeSix(ip);
    const rx = new Receiver({ ...this.ports, pin: code, name, single: true });
    rx.on('log', (m) => this.emit('log', m));
    try {
      await rx.ready;
    } catch (e) {
      await rx.close().catch(() => {});
      throw new Error(e.code === 'EADDRINUSE'
        ? `Port ${e.port ?? ''} sedang dipakai aplikasi lain (mis. Airgo Cast). Tutup aplikasi itu lalu coba lagi.`
        : e.message);
    }
    rx.on('announce', (a) => this.#onAnnounce(a));
    rx.on('frame', (f) => this.#onFrame(f));
    rx.on('end', ({ id }) => { if (this.peer?.id === id) this.#endPeer(); });
    this.rx = rx;
    this.info = { code, name, ip, port: this.ports.port };
    this.#emitState();
    return this.state;
  }

  async stop() {
    const rx = this.rx;
    if (!rx) return this.state;
    this.rx = null;
    this.#endPeer();
    await rx.close();
    this.info = null;
    this.#emitState();
    return this.state;
  }

  // ---- incoming cast --------------------------------------------------------
  #onAnnounce({ id, name, width, height }) {
    this.peer = { id, name, width, height };
    this.backlog = [];
    this.#openPlayer();
    this.#emitState();
  }

  #onFrame({ id, payload, key }) {
    if (!this.peer || this.peer.id !== id) return;
    const frame = { data: payload, key };
    if (this.playerReady) { this.player.webContents.send('rx:frame', frame); return; }
    if (key) this.backlog = [];
    if (this.backlog.length < MAX_BACKLOG) this.backlog.push(frame);
  }

  #endPeer() {
    this.peer = null;
    this.backlog = [];
    const w = this.player;
    this.player = null;
    this.playerReady = false;
    if (w && !w.isDestroyed()) w.close();
    this.#emitState();
  }

  /** Ends the incoming cast (player closed or "Putuskan"). */
  disconnect() {
    this.rx?.kick();
    this.#endPeer();
  }

  #openPlayer() {
    if (this.player && !this.player.isDestroyed()) {
      this.player.webContents.send('rx:info', this.#playerInfo());
      return;
    }
    const area = screen.getPrimaryDisplay().workAreaSize;
    const aspect = (this.peer.width || 16) / (this.peer.height || 9);
    let h = Math.round(area.height * 0.8);
    let w = Math.round(h * aspect);
    if (w > area.width * 0.9) { w = Math.round(area.width * 0.9); h = Math.round(w / aspect); }
    const win = new BrowserWindow({
      width: w, height: h, minWidth: 240, minHeight: 240,
      title: `${this.peer.name} — argocast`,
      backgroundColor: '#000000',
      autoHideMenuBar: true,
      icon: path.join(this.here, '..', 'build', 'icon.png'),
      webPreferences: { preload: path.join(this.here, 'player-preload.cjs'), contextIsolation: true, sandbox: true },
    });
    this.player = win;
    this.playerReady = false;
    win.loadFile(path.join(this.here, 'ui', 'player.html'));
    win.on('closed', () => { if (this.player === win) this.disconnect(); });
    win.focus();
  }

  #playerInfo() {
    return { name: this.peer?.name, width: this.peer?.width, height: this.peer?.height };
  }

  /** Player renderer finished loading: flush buffered frames (starting at a key frame). */
  playerLoaded(sender) {
    if (!this.player || sender !== this.player.webContents) return null;
    this.playerReady = true;
    for (const f of this.backlog) sender.send('rx:frame', f);
    this.backlog = [];
    return this.#playerInfo();
  }

  touch(sender, { action, x, y }) {
    if (!this.rx || sender !== this.player?.webContents) return;
    const clamp = (v) => Math.max(0, Math.min(65535, Math.round(v)));
    this.rx.sendTouch(encodeTouch([{ id: 0, action, x: clamp(x), y: clamp(y) }]));
  }

  key(sender, code) {
    if (!this.rx || sender !== this.player?.webContents) return;
    this.rx.sendTouch(encodeKey(code & 0xff));
  }

  toggleFullscreen(sender) {
    if (sender === this.player?.webContents) this.player.setFullScreen(!this.player.isFullScreen());
  }
}
