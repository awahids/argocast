// "Share code" -> panel IP, as done by com.xbh.client.utils.d ("CryCodeUtils")
// in Airgo Cast Android v2.10.1.200 (docs/02-lango-protocol-spec.md §2b).
//
// The code the panel shows doubles as the PIN (sent in `Code:`) and encodes
// where the panel is:
//   6 digits   -> last two octets; first two come from the sender's own IPv4
//   8 digits   -> last two octets, XOR-obfuscated; first two from the sender
//   8 letters  -> full IPv4 (base 25, letters A..Y)
// The LRTSP port is fixed: 3056 (Constant.PORT_RTSP).
import os from 'node:os';

export const LRTSP_PORT = 3056;

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
export const isIPv4 = (s) => IPV4.test(s);

/** Last two octets from a 6-digit code (CryCodeUtils.c). */
export function decodeSix(code) {
  if (!/^\d{6}$/.test(code)) return null;
  let i = Number(code);
  while (i <= 999999) i += 65536;
  const v = 999999 - (i - 65536);
  return [v >> 8, v & 255];
}

/**
 * 6-digit share code for this IPv4 (inverse of decodeSix), used in receiver
 * mode. Several codes map to the same address; `variant` picks one, so the
 * code (which is also the PIN) changes between sessions.
 */
export function encodeSix(ip, variant = Math.floor(Math.random() * 1e6)) {
  const o = String(ip).split('.').map(Number);
  const v = (o[2] << 8) | o[3];
  const top = 1065535 - v; // what decodeSix's loop ends on
  const choices = [];
  for (let c = top - 65536; c >= 100000; c -= 65536) choices.push(c);
  return String(choices[variant % choices.length]);
}

/** Last two octets from an 8-digit code (CryCodeUtils.b). */
export function decodeEightDigits(code) {
  if (!/^\d{8}$/.test(code)) return null;
  const key = Number(code.slice(0, 2)) ^ 13;
  const o3 = Number(code.slice(2, 5)) ^ key;
  const o4 = Number(code.slice(5, 8)) ^ key;
  return o3 <= 255 && o4 <= 255 ? [o3, o4] : null;
}

/** Full IPv4 from an 8-letter code (CryCodeUtils.d): base 25, first letter least significant. */
export function decodeEightLetters(code) {
  if (typeof code !== 'string' || code.length !== 8) return null;
  const letters = [...code.toUpperCase()].filter((c) => c >= 'A' && c < 'Z');
  let n = 0n;
  for (let k = letters.length - 1; k >= 0; k--) n = n * 25n + BigInt(letters[k].charCodeAt(0) - 65);
  const octets = [];
  for (let k = 0; k < 4; k++) { octets.unshift(Number(n & 255n)); n >>= 8n; }
  return octets.join('.');
}

/**
 * Turns what the user typed (code, IP, IP:port or an airgocast:// link) into
 * connection candidates. `localIPs` are the sender's IPv4 addresses, most
 * likely first; 6/8-digit codes yield one candidate per distinct /16 prefix.
 */
export function resolveTarget(input, localIPs = localIPv4s()) {
  const raw = String(input ?? '').trim();
  const link = parseLink(raw);
  if (link) return { ...resolveTarget(link.ipGroup && isIPv4(link.ipGroup) ? link.ipGroup : link.pinCode, localIPs), pin: link.pinCode, name: link.deviceName };

  const [hostPart, portPart] = raw.split(':');
  if (isIPv4(hostPart)) {
    return { candidates: [hostPart], port: Number(portPart) || LRTSP_PORT, pin: '' };
  }
  const code = raw.replace(/[\s-]/g, '');
  let tail = null;
  if (/^\d{6}$/.test(code)) tail = decodeSix(code);
  else if (/^\d{8}$/.test(code)) tail = decodeEightDigits(code);
  else if (/^[A-Za-z]{8}$/.test(code)) {
    return { candidates: [decodeEightLetters(code)], port: LRTSP_PORT, pin: code };
  }
  if (!tail) return null;
  const prefixes = [...new Set(localIPs.map((ip) => ip.split('.').slice(0, 2).join('.')))];
  return { candidates: prefixes.map((p) => `${p}.${tail[0]}.${tail[1]}`), port: LRTSP_PORT, pin: code };
}

/** airgocast://?pinCode=…&ipGroup=…&deviceName=… (NFC tag / QR on the panel). */
export function parseLink(text) {
  if (!/^(airgocast:\/\/|https?:\/\/(www\.)?airgo\.link)/i.test(text)) return null;
  try {
    const url = new URL(text.replace(/^airgocast:\/\/\/?\??/i, 'https://www.airgo.link?'));
    const q = url.searchParams;
    const pinCode = (q.get('pinCode') ?? '').replace(/\s/g, '');
    if (!pinCode && !q.get('ipGroup')) return null;
    return { pinCode, ipGroup: q.get('ipGroup') ?? '', deviceName: q.get('deviceName') ?? '', ssid: q.get('ssid') ?? '' };
  } catch {
    return null;
  }
}

const VIRTUAL = /(vethernet|virtualbox|vmware|vbox|docker|wsl|hyper-v|loopback|tailscale|zerotier|vpn|utun|bridge|br-|veth)/i;

/** Sender IPv4s, physical Wi-Fi/Ethernet adapters first, link-local excluded. */
export function localIPv4s(ifaces = os.networkInterfaces()) {
  const out = [];
  for (const [name, addrs] of Object.entries(ifaces)) {
    for (const a of addrs ?? []) {
      if (a.family !== 'IPv4' || a.internal || a.address.startsWith('169.254.')) continue;
      out.push({ name, address: a.address, score: VIRTUAL.test(name) ? 1 : /wi-?fi|wlan|wireless|en0|ethernet|eth/i.test(name) ? 3 : 2 });
    }
  }
  return out.sort((a, b) => b.score - a.score).map((x) => x.address);
}
