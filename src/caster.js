// High-level cast controller shared by the CLI and the GUI.
// Emits:
//   'state'  { state: 'idle'|'connecting'|'authenticating'|'starting'|'casting'|'stopping'|'error', message?, ... }
//   'stats'  { frames, dropped, keyFrames, bytes, seconds, fps, kbps }
//   'log'    string
import os from 'node:os';
import { EventEmitter } from 'node:events';
import { LrtspSession } from './session.js';
import { startCapture, findFfmpegAsync } from './capture.js';
import { loadIdentity } from './identity.js';

export const DEFAULT_PORT = Number(process.env.ARGOCAST_PORT || 8554);

export class Caster extends EventEmitter {
  constructor() {
    super();
    this.state = 'idle';
    this.session = null;
    this.capture = null;
  }

  #set(state, extra = {}) {
    this.state = state;
    this.emit('state', { state, ...extra });
  }

  get busy() {
    return !['idle', 'error'].includes(this.state);
  }

  async start({
    host, port = DEFAULT_PORT, pin, deviceName,
    width = 1920, height = 1080, fps = 30, bitrateKbps = 5000, source = 'desktop',
  }) {
    if (this.busy) throw new Error('already casting');
    const identity = loadIdentity();
    const log = (m) => this.emit('log', m);
    try {
      this.#set('connecting', { host, port });
      // Resolve ffmpeg before talking to the panel (non-blocking; fail early if missing).
      const ffmpeg = await findFfmpegAsync();
      if (!ffmpeg) throw new Error('FFmpeg tidak ditemukan. Pasang FFmpeg lalu coba lagi.');
      const session = new LrtspSession({
        host, port,
        deviceName: deviceName || identity.deviceName || os.hostname(),
        uuid: identity.uuid,
        log,
      });
      this.session = session;
      session.on('close', (err) => {
        // Ignore closes of sessions we already abandoned (failed start, stop()).
        if (this.session !== session || this.state === 'stopping' || this.state === 'idle') return;
        this.#teardownLocal();
        this.#set('error', { message: err ? `Koneksi terputus: ${err.message}` : 'Panel menutup koneksi.' });
      });
      await session.connect();

      this.#set('authenticating');
      const opt = await session.authenticate(pin);

      this.#set('starting', { ssrc: opt.ssrc, capabilities: session.public });
      const transport = await session.startCast({ width, height, framerate: fps });

      const stats = { frames: 0, dropped: 0, keyFrames: 0, bytes: 0, started: Date.now(), lastFrames: 0, lastBytes: 0 };
      this.capture = startCapture({
        source, width, height, fps, bitrateKbps, log, ffmpeg,
        onAccessUnit: (au) => {
          if (!au.isKey && session.media?.writableNeedDrain) { stats.dropped++; return; }
          session.sendAccessUnit(au);
          stats.frames++;
          stats.bytes += au.data.length;
          if (au.isKey) stats.keyFrames++;
        },
        onExit: (code) => {
          if (code && this.state === 'casting') {
            const hint = process.platform === 'darwin'
              ? ' Pastikan argocast diizinkan di System Settings › Privacy & Security › Screen Recording, lalu buka ulang aplikasi.'
              : '';
            this.stop().finally(() => this.#set('error', { message: `Tangkap layar gagal (FFmpeg kode ${code}).${hint}` }));
          }
        },
      });
      this.statsTimer = setInterval(() => {
        const now = Date.now();
        this.emit('stats', {
          frames: stats.frames,
          dropped: stats.dropped,
          keyFrames: stats.keyFrames,
          bytes: stats.bytes,
          seconds: Math.round((now - stats.started) / 1000),
          fps: stats.frames - stats.lastFrames,
          kbps: Math.round(((stats.bytes - stats.lastBytes) * 8) / 1000),
        });
        stats.lastFrames = stats.frames;
        stats.lastBytes = stats.bytes;
      }, 1000);

      this.#set('casting', { host, port, width, height, fps, mediaPort: transport.rtp_port, ssrc: opt.ssrc });
      return transport;
    } catch (err) {
      if (this.cancelled) { this.cancelled = false; this.#teardownLocal(); throw err; } // user pressed cancel
      this.#teardownLocal();
      const failed = this.session;
      this.session = null;
      try { failed?.sock?.destroy(); } catch { /* ignore */ }
      this.#set('error', { message: friendly(err) });
      throw err;
    }
  }

  #teardownLocal() {
    clearInterval(this.statsTimer);
    this.capture?.stop();
    this.capture = null;
  }

  async stop() {
    if (!this.session) { this.#set('idle'); return; }
    if (this.state !== 'casting') this.cancelled = true;
    this.#set('stopping');
    this.#teardownLocal();
    const s = this.session;
    this.session = null;
    try { await s.stop(); } catch { /* ignore */ }
    this.#set('idle');
  }
}

function friendly(err) {
  if (err.code === 'ECONNREFUSED') return 'Panel menolak koneksi. Periksa IP dan port.';
  if (err.code === 'ETIMEDOUT' || err.code === 'EHOSTUNREACH') return 'Panel tidak dapat dijangkau. Pastikan satu jaringan.';
  if (err.status === '406') return 'PIN salah.';
  if (err.status === '501') return 'Panel sedang sibuk atau koneksi penuh.';
  if (err.status === '401') return 'Panel menolak (tidak diizinkan).';
  return err.message;
}
