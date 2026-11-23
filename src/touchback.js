// Touchback: the panel sends its touches back so the laptop can be operated
// from the big screen. Reconstructed from obs-lango.dll (LGFeedBack::onRecvCommond,
// Airgo Cast Windows 2.10.1.403) and TouchReadRunnable (Android 2.10.1.200).
//
// The sender opens a TCP connection to the panel's control_port (Transport
// header, default 38767) and reads:
//
//   u8 type, u8 n
//   type 3            -> key press; n = Android keycode (0x13 up, 0x17 enter, ...)
//   type 0 (touch) / other (mouse mode), 1 <= n <= 10 -> n points of 6 bytes:
//        u8 id (low 7 bits), u8 action (0 down, 1 up, 2 move),
//        u16 x, u16 y   big-endian, normalised 0..65535 over the sender's screen
import net from 'node:net';
import { EventEmitter } from 'node:events';

export const FEEDBACK_PORT = 38767; // Constant.PORT_CONTROL
export const ACTION = Object.freeze({ DOWN: 0, UP: 1, MOVE: 2 });
export const TYPE_TOUCH = 0;
export const TYPE_KEY = 3;

/** Incremental parser; push() returns [{type:'touch'|'mouse', points}] / [{type:'key', keycode}]. */
export class FeedbackParser {
  constructor() { this.buf = Buffer.alloc(0); }

  push(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    const out = [];
    for (;;) {
      if (this.buf.length < 2) break;
      const type = this.buf[0];
      const n = this.buf[1];
      if (type === TYPE_KEY) {
        out.push({ type: 'key', keycode: n });
        this.buf = this.buf.subarray(2);
        continue;
      }
      if (n < 1 || n > 10) { this.buf = this.buf.subarray(2); continue; } // resync like the original (returns 2)
      const need = 2 + n * 6;
      if (this.buf.length < need) break;
      const points = [];
      for (let i = 0; i < n; i++) {
        const o = 2 + i * 6;
        points.push({
          id: this.buf[o] & 0x7f,
          action: this.buf[o + 1],
          x: this.buf.readUInt16BE(o + 2),
          y: this.buf.readUInt16BE(o + 4),
        });
      }
      out.push({ type: type === TYPE_TOUCH ? 'touch' : 'mouse', points });
      this.buf = this.buf.subarray(need);
    }
    return out;
  }
}

/** Builds one touchback packet (used by the mock panel and tests). */
export function encodeTouch(points, type = TYPE_TOUCH) {
  const b = Buffer.alloc(2 + points.length * 6);
  b[0] = type;
  b[1] = points.length;
  points.forEach((p, i) => {
    const o = 2 + i * 6;
    b[o] = p.id & 0x7f;
    b[o + 1] = p.action;
    b.writeUInt16BE(p.x, o + 2);
    b.writeUInt16BE(p.y, o + 4);
  });
  return b;
}
export const encodeKey = (keycode) => Buffer.from([TYPE_KEY, keycode]);

/**
 * Maps panel coordinates (0..65535 over the *encoded frame*) back onto the
 * captured screen, undoing the letterbox added when the screen aspect differs
 * from the encoded WxH. Returns 0..65535 over the screen, or null if outside.
 */
export function frameToScreen(x, y, { frameW, frameH, screenW, screenH }) {
  if (!screenW || !screenH) return { x, y };
  const s = Math.min(frameW / screenW, frameH / screenH);
  const cw = screenW * s, ch = screenH * s;
  const ox = (frameW - cw) / 2, oy = (frameH - ch) / 2;
  const fx = (x / 65535) * frameW, fy = (y / 65535) * frameH;
  const u = (fx - ox) / cw, v = (fy - oy) / ch;
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  return { x: Math.round(u * 65535), y: Math.round(v * 65535) };
}

/**
 * Turns parsed events into pointer actions for an injector:
 * single-finger mouse emulation (down/move/up), long-press (> 500 ms, < ~4 px)
 * becomes a right click — the same heuristic Lango uses.
 */
export class TouchTranslator {
  constructor(injector, geometry, { longPressMs = 500 } = {}) {
    this.inj = injector;
    this.geo = geometry;
    this.longPressMs = longPressMs;
    this.active = null; // { id, x, y, t, moved }
  }

  handle(ev) {
    if (ev.type === 'key') { this.inj.key(ev.keycode); return; }
    for (const p of ev.points) {
      const pos = frameToScreen(p.x, p.y, this.geo);
      if (!pos) continue;
      if (p.action === ACTION.DOWN && !this.active) {
        this.active = { id: p.id, x: pos.x, y: pos.y, t: Date.now(), moved: false };
        this.inj.down(pos.x, pos.y);
      } else if (this.active && p.id === this.active.id) {
        const dx = Math.abs(pos.x - this.active.x), dy = Math.abs(pos.y - this.active.y);
        if (dx > 130 || dy > 130) this.active.moved = true; // ~4 px on a 1920 screen
        if (p.action === ACTION.MOVE) this.inj.move(pos.x, pos.y);
        else if (p.action === ACTION.UP) {
          const long = !this.active.moved && Date.now() - this.active.t > this.longPressMs;
          this.inj.up(pos.x, pos.y);
          if (long) this.inj.rightClick(pos.x, pos.y);
          this.active = null;
        }
      }
    }
  }
}

/** TCP client to the panel's feedback channel. Emits 'event', 'connected', 'close'. */
export class FeedbackClient extends EventEmitter {
  constructor({ host, port = FEEDBACK_PORT, log = () => {} }) {
    super();
    this.host = host;
    this.port = port;
    this.log = log;
    this.parser = new FeedbackParser();
  }

  connect() {
    const s = net.connect({ host: this.host, port: this.port });
    s.setNoDelay(true);
    s.on('connect', () => { this.log(`touchback connected ${this.host}:${this.port}`); this.emit('connected'); });
    s.on('data', (d) => { for (const ev of this.parser.push(d)) this.emit('event', ev); });
    s.on('error', (e) => this.log(`touchback: ${e.message}`));
    s.on('close', () => this.emit('close'));
    this.sock = s;
    return this;
  }

  close() { this.sock?.destroy(); }
}
