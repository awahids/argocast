// Receiver side of LRTSP/2.0: lets this computer act like a Lango panel so a
// phone/tablet/laptop running argocast (or Airgo Cast) can cast to it.
// Also backs the mock panel used by the tests (mock/panel.js).
//
//   control  TCP 3056   OPTIONS (Code = PIN) -> ANNOUNCE -> SETUP -> PLAY, ACTIVE, TEARDOWN
//   media    TCP 8899   16-byte framed H.264 (src/frame.js)
//   feedback TCP 38767  touchback to the sender (src/touchback.js)
//   mDNS     _airgo._tcp.local
//
// Events: 'session' {id, remote, name}, 'announce' {id, width, height, framerate, name},
//         'frame' {id, payload, key, seq}, 'end' {id, reason}, 'log' message
import net from 'node:net';
import os from 'node:os';
import fs from 'node:fs';
import { EventEmitter } from 'node:events';
import { parseRequest, buildResponse, normalizePin } from './lrtsp.js';
import { FrameDecoder, FRAME_KEY } from './frame.js';

const PUBLIC = 'ACTIVE,MODERATOR_CONTROL,ANNOUNCE,DESCRIBE,SETUP,PLAY,BYE,TEARDOWN,FILE_ANNOUNCE,FILE_SETUP,FILE_PLAY';
export const RECEIVER_PORTS = Object.freeze({ port: 3056, mediaPort: 8899, feedbackPort: 38767 });
const IDLE_TIMEOUT_MS = 20_000; // senders send ACTIVE every 5 s

export class Receiver extends EventEmitter {
  constructor({
    port = RECEIVER_PORTS.port, mediaPort = RECEIVER_PORTS.mediaPort, feedbackPort = RECEIVER_PORTS.feedbackPort,
    pin = '', name = 'argocast', mdns = true, single = false, out = null,
  } = {}) {
    super();
    Object.assign(this, { port, mediaPort, feedbackPort, pin: normalizePin(pin), name, single });
    this.stats = { sessions: 0, frames: 0, keyFrames: 0, bytes: 0, lastAnnounce: null, requests: [] };
    this.active = null; // id of the session that is casting (single mode)
    this.feedbackSockets = new Set();
    this.controls = new Map(); // id -> control socket
    this.outFile = out ? fs.createWriteStream(out) : null;
    this.nextSsrc = 10000000 + Math.floor(Math.random() * 80000000);

    this.control = net.createServer((sock) => this.#onControl(sock));
    this.media = net.createServer((sock) => this.#onMedia(sock));
    this.feedback = net.createServer((sock) => this.#onFeedback(sock));
    for (const srv of [this.control, this.media, this.feedback]) srv.on('error', (e) => this.emit('error', e));

    this.ready = Promise.all([
      listen(this.control, port), listen(this.media, mediaPort), listen(this.feedback, feedbackPort),
    ]).then(async () => {
      if (mdns) this.mdns = await advertise({ name, port, log: (m) => this.#log(m) });
      this.#log(`listening: control ${port}, media ${mediaPort}, touchback ${feedbackPort}${this.pin ? `, PIN ${this.pin}` : ''}`);
    });
  }

  #log(m) { this.emit('log', `[receiver] ${m}`); }

  #onControl(sock) {
    const id = String(this.nextSsrc++);
    let authed = false;
    let name = '';
    let idle;
    const touch = () => { clearTimeout(idle); idle = setTimeout(() => sock.destroy(), IDLE_TIMEOUT_MS); };
    this.stats.sessions++;
    this.controls.set(id, sock);
    this.#log(`control connection from ${sock.remoteAddress}`);
    touch();

    const reply = (status, reason, headers = {}, cseq) => sock.write(buildResponse(status, reason, { Cseq: cseq, ...headers }));
    const end = (reason) => {
      clearTimeout(idle);
      if (!this.controls.has(id)) return;
      this.controls.delete(id);
      if (this.active === id) {
        this.active = null;
        for (const s of this.feedbackSockets) s.destroy();
      }
      if (authed) this.emit('end', { id, reason });
    };

    const handle = (raw) => {
      const req = parseRequest(raw);
      const cseq = req.headers.cseq;
      this.stats.requests.push(req.method);
      this.#log(`${req.method} cseq=${cseq}`);
      if (req.method !== 'OPTIONS' && req.method !== 'ACTIVE' && !authed) return reply('401', 'Unauthorized', {}, cseq);
      switch (req.method) {
        case 'OPTIONS': {
          if (this.pin && normalizePin(req.fields.code) !== this.pin) return reply('406', 'Code Unavailable', {}, cseq);
          if (this.single && this.active && this.active !== id) return reply('501', 'Busy', {}, cseq);
          if (!authed) {
            authed = true;
            name = req.fields.model || sock.remoteAddress;
            if (this.single) this.active = id;
            this.emit('session', { id, remote: sock.remoteAddress, name });
          }
          return reply('200', 'OK', { SSRC: id, Public: PUBLIC, Device: this.name, Orientation: 'landscape', ConnectCount: 1 }, cseq);
        }
        case 'ANNOUNCE': {
          const f = req.fields;
          this.stats.lastAnnounce = f;
          this.#log(`announce ${f.width}x${f.height} ${f.mimetype} @${f.framerate}`);
          this.emit('announce', { id, name, width: Number(f.width), height: Number(f.height), framerate: Number(f.framerate) || 30 });
          return reply('200', 'OK', { SSRC: id, 'a=aeskey:string': '' }, cseq);
        }
        case 'SETUP':
          return reply('200', 'OK', {
            SSRC: id, Session: id,
            Transport: `RTP/TCP/unicast;rtp_port=${this.mediaPort};rtcp_port=${this.mediaPort + 1};control_port=${this.feedbackPort}`,
          }, cseq);
        case 'PLAY':
        case 'BYE':
          return reply('200', 'OK', { SSRC: id }, cseq);
        case 'ACTIVE':
          return sock.write('ACTIVE\r\n');
        case 'TEARDOWN':
          reply('200', 'OK', { SSRC: id, Connection: 'Close' }, cseq);
          end('teardown');
          return sock.end();
        default:
          return reply('400', 'Bad Request', {}, cseq);
      }
    };

    sock.on('data', (data) => {
      touch();
      for (const req of splitRequests(data.toString('utf8'))) handle(req);
    });
    sock.on('close', () => end('closed'));
    sock.on('error', () => {});
  }

  #onMedia(sock) {
    this.#log(`media connection from ${sock.remoteAddress}`);
    const dec = new FrameDecoder();
    sock.on('data', (chunk) => {
      let frames;
      try { frames = dec.push(chunk); } catch (e) { this.#log(`media error: ${e.message}`); sock.destroy(); return; }
      for (const f of frames) {
        const id = String(f.ssrc);
        if (this.single && this.active && this.active !== id) continue; // stale/other sender
        const key = f.type === FRAME_KEY;
        this.stats.frames++;
        this.stats.bytes += f.payload.length;
        if (key) this.stats.keyFrames++;
        this.outFile?.write(f.payload);
        if (this.stats.frames === 1 || this.stats.frames % 150 === 0) {
          this.#log(`frame #${this.stats.frames} seq=${f.seq} ssrc=${f.ssrc} ${key ? 'KEY' : 'delta'} ${f.payload.length} B`);
        }
        this.emit('frame', { id, payload: f.payload, key, seq: f.seq });
      }
    });
    sock.on('error', () => {});
  }

  #onFeedback(sock) {
    this.#log(`touchback connection from ${sock.remoteAddress}`);
    this.stats.feedbackConnections = (this.stats.feedbackConnections ?? 0) + 1;
    this.feedbackSockets.add(sock);
    sock.on('close', () => this.feedbackSockets.delete(sock));
    sock.on('error', () => {});
  }

  /** Sends a touchback packet (src/touchback.js encodeTouch/encodeKey) to the sender(s). */
  sendTouch(buf) { for (const s of this.feedbackSockets) s.write(buf); }
  get feedbackClients() { return this.feedbackSockets.size; }

  /** Ends the current cast (the sender sees the connection close). */
  kick() {
    for (const [, sock] of this.controls) sock.destroy();
  }

  close() {
    for (const s of this.feedbackSockets) s.destroy();
    for (const [, s] of this.controls) s.destroy();
    return Promise.all([
      new Promise((r) => this.control.close(r)),
      new Promise((r) => this.media.close(r)),
      new Promise((r) => this.feedback.close(r)),
      new Promise((r) => (this.outFile ? this.outFile.end(r) : r())),
    ]).then(() => this.mdns?.destroy());
  }
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, () => { server.off('error', reject); resolve(); });
  });
}

/** Splits raw text into individual requests (each starts with METHOD lrtsp://). */
function splitRequests(text) {
  const starts = [];
  const re = /(^|\r\n?)([A-Z_]+) lrtsp:\/\//g;
  let m;
  while ((m = re.exec(text))) starts.push(m.index + m[1].length);
  return starts.map((s, i) => text.slice(s, starts[i + 1] ?? text.length));
}

async function advertise({ name, port, log }) {
  const { default: makeMdns } = await import('multicast-dns');
  const { localIPv4s } = await import('./sharecode.js');
  const m = makeMdns();
  const service = '_airgo._tcp.local';
  const instance = `${name}.${service}`;
  const host = `${os.hostname().replace(/\.local$/, '')}.local`;
  const ip = localIPv4s()[0] ?? '127.0.0.1';
  m.on('query', (q) => {
    if (!q.questions.some((x) => x.name === service || x.name === instance || x.name === host)) return;
    m.respond({
      answers: [{ name: service, type: 'PTR', data: instance }],
      additionals: [
        { name: instance, type: 'SRV', data: { port, target: host } },
        { name: instance, type: 'TXT', data: ['argocast=1'] },
        { name: host, type: 'A', data: ip },
      ],
    });
  });
  m.on('error', () => {});
  log(`mDNS: ${instance} -> ${ip}:${port}`);
  return m;
}
