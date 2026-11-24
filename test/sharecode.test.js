import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeSix, decodeEightDigits, decodeEightLetters, resolveTarget, parseLink, localIPv4s, LRTSP_PORT } from '../src/sharecode.js';

// Inverse of the 6-digit decoder, to build test vectors.
const encodeSix = (o3, o4) => String((999999 - (o3 * 256 + o4)) % 65536).padStart(6, '0');

test('6-digit code from the infographic ("834 109") decodes to x.y.136.2', () => {
  assert.deepEqual(decodeSix('834109'), [136, 2]);
  const r = resolveTarget('834 109', ['192.168.1.20']);
  assert.deepEqual(r.candidates, ['192.168.136.2']);
  assert.equal(r.port, LRTSP_PORT);
  assert.equal(r.pin, '834109');
});

test('6-digit decoder round-trips every octet pair it can represent', () => {
  for (const [o3, o4] of [[0, 0], [1, 50], [100, 7], [136, 2], [254, 254], [255, 255]]) {
    assert.deepEqual(decodeSix(encodeSix(o3, o4)), [o3, o4], `${o3}.${o4}`);
  }
});

test('8-digit code is XOR-obfuscated with the first two digits', () => {
  // key = 20 ^ 13 = 25; 136 ^ 25 = 145; 2 ^ 25 = 27
  assert.deepEqual(decodeEightDigits('20145027'), [136, 2]);
  assert.equal(decodeEightDigits('20999999'), null);
});

test('8-letter code carries the full IPv4 (base 25, first letter least significant)', () => {
  const encode = (ip) => {
    let n = ip.split('.').reduce((a, o) => a * 256 + Number(o), 0);
    let s = '';
    for (let k = 0; k < 8; k++) { s += String.fromCharCode(65 + (n % 25)); n = Math.floor(n / 25); }
    return s;
  };
  for (const ip of ['192.168.136.2', '10.0.0.1', '172.20.10.5']) assert.equal(decodeEightLetters(encode(ip)), ip);
  assert.deepEqual(resolveTarget(encode('10.1.2.3'), []).candidates, ['10.1.2.3']);
});

test('plain IPs and IP:port pass through', () => {
  assert.deepEqual(resolveTarget('192.168.1.50'), { candidates: ['192.168.1.50'], port: 3056, pin: '' });
  assert.equal(resolveTarget('192.168.1.50:7000').port, 7000);
  assert.equal(resolveTarget('hello'), null);
});

test('one candidate per local /16 prefix, physical adapters first', () => {
  const ips = localIPv4s({
    'vEthernet (WSL)': [{ family: 'IPv4', address: '172.28.0.1', internal: false }],
    'Wi-Fi': [{ family: 'IPv4', address: '10.1.106.19', internal: false }],
    lo: [{ family: 'IPv4', address: '127.0.0.1', internal: true }],
    eth9: [{ family: 'IPv4', address: '169.254.3.4', internal: false }],
  });
  assert.deepEqual(ips, ['10.1.106.19', '172.28.0.1']);
  assert.deepEqual(resolveTarget('834109', ips).candidates, ['10.1.136.2', '172.28.136.2']);
});

test('airgocast:// links (NFC/QR) carry pinCode and ipGroup', () => {
  const l = parseLink('airgocast://?networkType=wifi&pinCode=834109&ssid=KANTOR&deviceName=iTBoard&ipGroup=192.168.136.2');
  assert.equal(l.pinCode, '834109');
  assert.equal(l.deviceName, 'iTBoard');
  const r = resolveTarget('airgocast://?pinCode=834109&ipGroup=192.168.136.2&deviceName=iTBoard', []);
  assert.deepEqual(r.candidates, ['192.168.136.2']);
  assert.equal(r.pin, '834109');
  assert.equal(r.name, 'iTBoard');
  // without ipGroup the PIN itself locates the panel
  assert.deepEqual(resolveTarget('https://www.airgo.link?pinCode=834109', ['192.168.1.2']).candidates, ['192.168.136.2']);
});

test('encodeSix round-trips through decodeSix for every last-two-octet pair', async () => {
  const { encodeSix, decodeSix } = await import('../src/sharecode.js');
  for (let v = 0; v < 65536; v += 97) {
    const ip = `10.1.${v >> 8}.${v & 255}`;
    for (const variant of [0, 3, 999]) {
      const code = encodeSix(ip, variant);
      assert.match(code, /^[1-9]\d{5}$/);
      assert.deepEqual(decodeSix(code), [v >> 8, v & 255], `${ip} -> ${code}`);
    }
  }
  assert.deepEqual(decodeSix(encodeSix('192.168.255.255', 1)), [255, 255]);
});
