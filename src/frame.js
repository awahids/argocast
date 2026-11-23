// Media framing on the rtp_port TCP connection.
// Mirrors androidx.constraintlayout.motion.widget.b.l(byte[], int) in Airgo
// Cast Android v2.10.1.200 (obfuscated helper), all integers big-endian:
//
//   0   u8   magic 0xE8 (low byte of 2100200)
//   1   u8   1 = key frame (frameType 5 / IDR), 2 = other
//   2   u16  sequence number (wraps)
//   4   u32  sender wall-clock milliseconds (low 32 bits)
//   8   u32  SSRC (numeric SSRC from the OPTIONS response)
//   12  u32  payload length
//   16  ...  H.264 Annex-B access unit
//
// No encryption is applied on this path in the Android client.

export const MAGIC = 0xe8;
export const HEADER_SIZE = 16;
export const FRAME_KEY = 1;
export const FRAME_DELTA = 2;

export class FrameEncoder {
  constructor(ssrc) {
    const n = Number.parseInt(ssrc, 10);
    this.ssrc = Number.isFinite(n) ? n >>> 0 : 0;
    this.seq = 0;
  }

  encode(payload, isKey, nowMs = Date.now()) {
    const out = Buffer.allocUnsafe(HEADER_SIZE + payload.length);
    out.writeUInt8(MAGIC, 0);
    out.writeUInt8(isKey ? FRAME_KEY : FRAME_DELTA, 1);
    out.writeUInt16BE(this.seq & 0xffff, 2);
    out.writeUInt32BE(nowMs % 0x100000000, 4);
    out.writeUInt32BE(this.ssrc, 8);
    out.writeUInt32BE(payload.length, 12);
    payload.copy(out, HEADER_SIZE);
    this.seq = (this.seq + 1) & 0xffff;
    return out;
  }
}

/** Incremental decoder for the receiving side (mock panel, tests). */
export class FrameDecoder {
  constructor() { this.buf = Buffer.alloc(0); }

  push(chunk) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, chunk]) : chunk;
    const frames = [];
    while (this.buf.length >= HEADER_SIZE) {
      if (this.buf[0] !== MAGIC) throw new Error(`bad magic 0x${this.buf[0].toString(16)}`);
      const len = this.buf.readUInt32BE(12);
      if (this.buf.length < HEADER_SIZE + len) break;
      frames.push({
        type: this.buf[1],
        seq: this.buf.readUInt16BE(2),
        timestamp: this.buf.readUInt32BE(4),
        ssrc: this.buf.readUInt32BE(8),
        payload: this.buf.subarray(HEADER_SIZE, HEADER_SIZE + len),
      });
      this.buf = this.buf.subarray(HEADER_SIZE + len);
    }
    return frames;
  }
}

// ---------------------------------------------------------------------------
// H.264 Annex-B access-unit splitter for an ffmpeg byte stream.
// MediaCodec on Android hands over one access unit per buffer (SPS/PPS are
// prepended to IDR frames because x264 runs with repeat-headers), so we emit
// one access unit per frame on the wire.

const NAL_SLICE = 1;
const NAL_IDR = 5;
const NAL_AUD = 9;

function findStartCode(buf, from) {
  for (let i = from; i + 3 <= buf.length; i++) {
    if (buf[i] === 0 && buf[i + 1] === 0) {
      if (buf[i + 2] === 1) return { at: i, len: 3 };
      if (buf[i + 2] === 0 && i + 3 < buf.length && buf[i + 3] === 1) return { at: i, len: 4 };
    }
  }
  return null;
}

export class AccessUnitSplitter {
  constructor() {
    this.pending = Buffer.alloc(0); // bytes not yet split into NALs
    this.au = [];                    // NAL units (with start codes) of current AU
    this.auHasSlice = false;
    this.auIsKey = false;
  }

  /** Feeds bytes; returns completed access units [{ data, isKey }]. */
  push(chunk) {
    this.pending = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk;
    const out = [];
    let first = findStartCode(this.pending, 0);
    if (!first) return out;
    for (;;) {
      const next = findStartCode(this.pending, first.at + first.len);
      if (!next) break;
      this.#onNal(this.pending.subarray(first.at, next.at), first.len, out);
      first = next;
    }
    this.pending = this.pending.subarray(first.at);
    return out;
  }

  /** Flushes the final access unit at end of stream. */
  end() {
    const out = [];
    const first = findStartCode(this.pending, 0);
    if (first) this.#onNal(this.pending.subarray(first.at), first.len, out);
    this.pending = Buffer.alloc(0);
    this.#emit(out);
    return out;
  }

  #onNal(nal, scLen, out) {
    const type = nal[scLen] & 0x1f;
    const isSlice = type === NAL_SLICE || type === NAL_IDR;
    // A new AU starts at an AUD, or at a non-slice NAL / first_mb_in_slice==0
    // slice that follows a slice of the current AU.
    let startsNew = type === NAL_AUD;
    if (!startsNew && this.auHasSlice) {
      if (!isSlice) startsNew = true;
      else startsNew = (nal[scLen + 1] & 0x80) !== 0; // first_mb_in_slice == 0 (ue(v) '1')
    }
    if (startsNew) this.#emit(out);
    if (type === NAL_AUD) return; // panel does not need AUDs
    this.au.push(nal);
    if (isSlice) this.auHasSlice = true;
    if (type === NAL_IDR) this.auIsKey = true;
  }

  #emit(out) {
    if (this.au.length && this.auHasSlice) {
      out.push({ data: Buffer.concat(this.au), isKey: this.auIsKey });
    }
    this.au = [];
    this.auHasSlice = false;
    this.auIsKey = false;
  }
}
