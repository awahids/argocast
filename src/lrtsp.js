// LRTSP/2.0 message builders and parser.
// Request shapes mirror com.xbh.client.rtsp.Request in Airgo Cast Android
// v2.10.1.200 (see docs/02-lango-protocol-spec.md §3). Quirks such as the
// trailing "\r\n\r" terminator are reproduced on purpose.

export const VERSION = 'LRTSP/2.0';
const CRLF = '\r\n';
const TERMINATOR = '\r\n\r';

export const STATUS = Object.freeze({
  OK: '200',
  BAD_REQUEST: '400',
  UNAUTHORIZED: '401',
  NOT_FOUND: '404',
  CODE_UNAVAILABLE: '406', // wrong PIN
  INTERNAL_SERVER_ERROR: '500',
  BUSY: '501',
});

function requestLine(method, serverIp) {
  return `${method} lrtsp://${serverIp} ${VERSION}${CRLF}`;
}

/** Builds request strings for one session; owns the Cseq counter. */
export class RequestBuilder {
  constructor({ serverIp, deviceName, uuid, os = 'Windows', version = 'sender v20210311' }) {
    this.serverIp = serverIp;
    this.deviceName = deviceName;
    this.uuid = uuid;
    this.os = os;
    this.version = version;
    this.seq = 1;
    this.ssrc = '';
  }

  #head(method) {
    return requestLine(method, this.serverIp) + `Cseq: ${this.seq++}${CRLF}`;
  }

  options({ pin } = {}) {
    let body = `Version: ${this.version}${CRLF}`;
    body += `Os: ${this.os}${CRLF}`;
    body += `Model: ${this.deviceName}${CRLF}`;
    body += `uuid: ${this.uuid}${CRLF}`;
    body += `Code: ${pin ?? ''}${TERMINATOR}`;
    let msg = this.#head('OPTIONS');
    if (this.ssrc) msg += `SSRC: ${this.ssrc}${CRLF}`;
    msg += `Content-Length: ${body.length}${CRLF}`;
    msg += `Content-Type: application/sdp${CRLF}`;
    return msg + body;
  }

  announce({ width, height, framerate = 30, audio = false }) {
    let sdp = `m=video 0 LRTP/AVP 116${CRLF}`;
    sdp += `Width=integer:${width}${CRLF}`;
    sdp += `Height=integer:${height}${CRLF}`;
    sdp += `Mimetype=string:"video/avc"${CRLF}`;
    sdp += `Framerate=integer:${framerate}${CRLF}`;
    sdp += `AudioOn=integer:${audio ? 1 : 0}`;
    let msg = this.#head('ANNOUNCE');
    msg += `SSRC: ${this.ssrc}${CRLF}`;
    msg += `Content-Length: ${sdp.length}${CRLF}`;
    msg += `Content-Type: application/sdp${CRLF}`;
    return msg + sdp + TERMINATOR;
  }

  #simple(method) {
    return this.#head(method) + `SSRC: ${this.ssrc}${TERMINATOR}`;
  }

  setup() { return this.#simple('SETUP'); }
  play() { return this.#simple('PLAY'); }
  active() { return this.#simple('ACTIVE'); }
  bye() { return this.#simple('BYE'); }
  teardown() { return this.#simple('TEARDOWN'); }
}

/**
 * Splits a received buffer into LRTSP messages the same way the Android
 * client does: every message contains "LRTSP/2.0"; a bare "ACTIVE\r\n"
 * keep-alive may arrive between them.
 */
export function splitMessages(text) {
  const out = [];
  let rest = text;
  // Keep-alives that appear before the first LRTSP message.
  while (rest.startsWith('ACTIVE\r\n')) {
    out.push({ keepalive: true });
    rest = rest.slice('ACTIVE\r\n'.length);
  }
  let idx = rest.indexOf(VERSION);
  while (idx !== -1) {
    const next = rest.indexOf(VERSION, idx + 1);
    out.push({ raw: rest.slice(idx, next > 0 ? next : rest.length) });
    idx = next;
  }
  return out;
}

const STATUS_RE = /^LRTSP\/2\.0\s+(\d{3})\s*(.*)$/;

/** Parses one LRTSP response (starting at "LRTSP/2.0 <code> ..."). */
export function parseResponse(raw) {
  const lines = raw.split(CRLF);
  const m = STATUS_RE.exec(lines[0].trim());
  if (!m) return null;
  const res = { status: m[1], reason: m[2], headers: {} };
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const i = line.indexOf(':');
    // SDP-style lines ("a=aeskey:string:xxx") keep everything before the
    // last colon-delimited value as the key, like the Android regex does.
    let key, value;
    if (line.startsWith('a=')) {
      const j = line.lastIndexOf(':');
      key = line.slice(0, j);
      value = line.slice(j + 1);
    } else if (i > 0) {
      key = line.slice(0, i);
      value = line.slice(i + 1);
    } else {
      continue;
    }
    res.headers[key.trim().toLowerCase()] = value.trim();
  }
  const h = res.headers;
  res.ssrc = h.ssrc ?? '';
  res.session = h.session ?? '';
  res.aeskey = h['a=aeskey:string'] ?? '';
  res.public = h.public ? h.public.split(',').map((s) => s.trim()) : [];
  res.connection = h.connection ?? '';
  res.transport = parseTransport(h.transport ?? '');
  return res;
}

export function parseTransport(value) {
  const t = { raw: value };
  for (const part of value.split(';')) {
    const [k, v] = part.split('=');
    if (v === undefined) continue;
    const key = k.trim();
    if (['rtp_port', 'rtcp_port', 'control_port', 'quic_port'].includes(key)) {
      t[key] = Number.parseInt(v.trim(), 10);
    }
  }
  return t;
}

/** Parses an incoming request (used by the mock panel). */
export function parseRequest(raw) {
  const [head, ...rest] = raw.split(CRLF);
  const [method, url, version] = head.trim().split(/\s+/);
  const headers = {};
  const body = [];
  let inBody = false;
  for (const line of rest) {
    if (!inBody && /^(m=|Width=|Height=|Mimetype=|Framerate=|AudioOn=|Version:|Os:|Model:|uuid:|Code:|From:)/.test(line)) {
      inBody = true;
    }
    if (inBody) { body.push(line); continue; }
    const i = line.indexOf(':');
    if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
  }
  const fields = {};
  for (const line of body) {
    const m = /^([A-Za-z]+)[=:](?:integer:|string:)?\s*(.*)$/.exec(line.trim());
    if (m) fields[m[1].toLowerCase()] = m[2].replace(/^"|"$/g, '');
  }
  return { method, url, version, headers, fields };
}

/** Builds a response (used by the mock panel). */
export function buildResponse(status, reason, headers = {}) {
  let msg = `${VERSION} ${status} ${reason}${CRLF}`;
  for (const [k, v] of Object.entries(headers)) msg += `${k}: ${v}${CRLF}`;
  return msg + CRLF;
}
