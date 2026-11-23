// LRTSP control session (spec §3.2): OPTIONS -> ANNOUNCE -> SETUP -> PLAY,
// 5 s ACTIVE heartbeat, TEARDOWN on stop. Media goes over a second TCP
// connection to the rtp_port announced by the panel.
import net from 'node:net';
import { EventEmitter } from 'node:events';
import { RequestBuilder, splitMessages, parseResponse, STATUS } from './lrtsp.js';
import { FrameEncoder } from './frame.js';

const HEARTBEAT_MS = 5000; // RtspClient.l(): Timer.schedule(…, 5000, 5000)

export class LrtspError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

const STATUS_TEXT = {
  [STATUS.UNAUTHORIZED]: 'panel rejected the connection (401 Unauthorized)',
  [STATUS.CODE_UNAVAILABLE]: 'wrong PIN (406)',
  [STATUS.BUSY]: 'panel is busy / max connections reached (501)',
  [STATUS.INTERNAL_SERVER_ERROR]: 'panel internal error (500)',
};

export class LrtspSession extends EventEmitter {
  constructor({ host, port, deviceName, uuid, os, timeoutMs = 8000, log = () => {} }) {
    super();
    this.host = host;
    this.port = port;
    this.timeoutMs = timeoutMs;
    this.log = log;
    this.req = new RequestBuilder({ serverIp: host, deviceName, uuid, os });
    this.waiters = [];
    this.public = [];
    this.transport = {};
    this.media = null;
    this.encoder = null;
  }

  connect({ timeoutMs = this.timeoutMs } = {}) {
    return new Promise((resolve, reject) => {
      const sock = net.connect({ host: this.host, port: this.port });
      sock.setNoDelay(true);
      const timer = setTimeout(() => {
        sock.destroy();
        reject(Object.assign(new Error(`connect timeout ${this.host}:${this.port}`), { code: 'ETIMEDOUT' }));
      }, timeoutMs);
      const fail = (err) => { clearTimeout(timer); reject(err); };
      sock.once('error', fail);
      sock.once('connect', () => {
        clearTimeout(timer);
        sock.off('error', fail);
        sock.on('error', (err) => this.#onClose(err));
        sock.on('close', () => this.#onClose());
        resolve();
      });
      sock.on('data', (d) => this.#onData(d));
      this.sock = sock;
    });
  }

  #onData(data) {
    const text = data.toString('utf8');
    this.log(`<< ${JSON.stringify(text)}`);
    for (const msg of splitMessages(text)) {
      if (msg.keepalive) { this.emit('keepalive'); continue; }
      const res = parseResponse(msg.raw);
      if (!res) continue;
      // Match by Cseq when the panel echoes it; otherwise first-in first-out.
      const cseq = res.headers.cseq;
      let i = cseq ? this.waiters.findIndex((w) => w.cseq === cseq) : 0;
      if (cseq && i < 0) { this.emit('unsolicited', res); continue; }
      const [w] = this.waiters.splice(i, 1);
      if (w) w.resolve(res);
      else this.emit('unsolicited', res);
    }
  }

  #onClose(err) {
    clearInterval(this.heartbeat);
    for (const w of this.waiters.splice(0)) w.reject(err ?? new Error('control connection closed'));
    this.emit('close', err);
  }

  #send(text) {
    this.log(`>> ${JSON.stringify(text)}`);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const i = this.waiters.findIndex((w) => w.resolve === done);
        if (i >= 0) this.waiters.splice(i, 1);
        reject(new Error(`timeout waiting for reply to ${text.split(' ')[0]}`));
      }, this.timeoutMs);
      const done = (res) => { clearTimeout(timer); resolve(res); };
      const cseq = /Cseq: (\d+)/.exec(text)?.[1];
      this.waiters.push({ cseq, resolve: done, reject: (e) => { clearTimeout(timer); reject(e); } });
      this.sock.write(text);
    });
  }

  async #expectOk(text, step) {
    const res = await this.#send(text);
    if (res.status !== STATUS.OK) {
      throw new LrtspError(`${step}: ${STATUS_TEXT[res.status] ?? `status ${res.status}`}`, res.status);
    }
    return res;
  }

  /** OPTIONS with PIN; stores SSRC and capabilities, starts heartbeat. */
  async authenticate(pin) {
    const res = await this.#expectOk(this.req.options({ pin }), 'OPTIONS');
    if (res.ssrc) this.req.ssrc = res.ssrc;
    this.public = res.public;
    this.heartbeat = setInterval(() => {
      // Skip while a request is in flight so an uncorrelated reply can't be misrouted.
      if (this.sock.writable && this.waiters.length === 0) this.sock.write(this.req.active());
    }, HEARTBEAT_MS);
    return res;
  }

  /** ANNOUNCE -> SETUP -> PLAY. Returns the media transport ports. */
  async startCast({ width, height, framerate = 30, audio = false }) {
    const ann = await this.#expectOk(this.req.announce({ width, height, framerate, audio }), 'ANNOUNCE');
    this.aeskey = ann.aeskey;
    const setup = await this.#expectOk(this.req.setup(), 'SETUP');
    this.sessionId = setup.session;
    this.transport = { ...ann.transport, ...setup.transport };
    await this.#expectOk(this.req.play(), 'PLAY');
    if (!this.transport.rtp_port) throw new LrtspError('panel did not announce rtp_port in Transport header');
    await this.#openMedia(this.transport.rtp_port);
    return this.transport;
  }

  #openMedia(port) {
    return new Promise((resolve, reject) => {
      const s = net.connect({ host: this.host, port });
      s.setNoDelay(true);
      s.once('error', reject);
      s.once('connect', () => {
        s.off('error', reject);
        s.on('error', (e) => this.emit('media-error', e));
        this.media = s;
        this.encoder = new FrameEncoder(this.req.ssrc);
        resolve();
      });
    });
  }

  /** Sends one H.264 access unit. Returns false when the socket is backed up. */
  sendAccessUnit({ data, isKey }) {
    if (!this.media?.writable) return false;
    return this.media.write(this.encoder.encode(data, isKey));
  }

  async stop() {
    clearInterval(this.heartbeat);
    this.media?.end();
    if (this.sock?.writable) {
      try { await this.#send(this.req.teardown()); } catch { /* panel may just close */ }
    }
    this.sock?.end();
  }
}
