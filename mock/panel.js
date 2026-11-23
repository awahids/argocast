#!/usr/bin/env node
// Mock Lango panel for local testing. Implements the receiver side as far as
// docs/02-lango-protocol-spec.md describes it: mDNS advertisement, LRTSP
// state machine, PIN check, media port that decodes 16-byte framed H.264.
// Responses are our best reconstruction; a real panel may differ in details.
//
//   node mock/panel.js [--port 3056] [--media-port 8899] [--pin 1234] [--out received.h264] [--no-mdns]
import net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { parseRequest, buildResponse } from '../src/lrtsp.js';
import { FrameDecoder, FRAME_KEY } from '../src/frame.js';

const PUBLIC = 'ACTIVE,MODERATOR_CONTROL,ANNOUNCE,DESCRIBE,SETUP,PLAY,BYE,TEARDOWN,FILE_ANNOUNCE,FILE_SETUP,FILE_PLAY';

export function startMockPanel({
  port = 3056, mediaPort = 8899, feedbackPort = mediaPort + 2, pin = '', out = null, mdns = true, name = 'Argocast Mock Panel', log = console.log,
} = {}) {
  const stats = { sessions: 0, frames: 0, keyFrames: 0, bytes: 0, lastAnnounce: null, requests: [] };
  const outFile = out ? fs.createWriteStream(out) : null;
  let nextSsrc = 10000000 + Math.floor(Math.random() * 80000000);

  const control = net.createServer((sock) => {
    const ssrc = String(nextSsrc++);
    let authed = false;
    stats.sessions++;
    log(`[panel] control connection from ${sock.remoteAddress}`);
    sock.on('data', (data) => {
      for (const req of splitRequests(data.toString('utf8'))) handle(req);
    });
    sock.on('error', () => {});

    function reply(status, reason, headers = {}, cseq) {
      sock.write(buildResponse(status, reason, { Cseq: cseq, ...headers }));
    }

    function handle(raw) {
      const req = parseRequest(raw);
      const cseq = req.headers.cseq;
      stats.requests.push(req.method);
      log(`[panel] ${req.method} cseq=${cseq}`);
      if (req.method !== 'OPTIONS' && !authed) return reply('401', 'Unauthorized', {}, cseq);
      switch (req.method) {
        case 'OPTIONS':
          if (pin && req.fields.code !== pin) return reply('406', 'Code Unavailable', {}, cseq);
          authed = true;
          return reply('200', 'OK', { SSRC: ssrc, Public: PUBLIC, Device: name, Orientation: 'landscape', ConnectCount: 1 }, cseq);
        case 'ANNOUNCE':
          stats.lastAnnounce = req.fields;
          log(`[panel] announce ${req.fields.width}x${req.fields.height} ${req.fields.mimetype} @${req.fields.framerate}`);
          return reply('200', 'OK', { SSRC: ssrc, 'a=aeskey:string': '' }, cseq);
        case 'SETUP':
          return reply('200', 'OK', {
            SSRC: ssrc, Session: ssrc,
            Transport: `RTP/TCP/unicast;rtp_port=${mediaPort};rtcp_port=${mediaPort + 1};control_port=${feedbackPort}`,
          }, cseq);
        case 'PLAY':
        case 'BYE':
          return reply('200', 'OK', { SSRC: ssrc }, cseq);
        case 'ACTIVE':
          return sock.write('ACTIVE\r\n');
        case 'TEARDOWN':
          reply('200', 'OK', { SSRC: ssrc, Connection: 'Close' }, cseq);
          return sock.end();
        default:
          return reply('400', 'Bad Request', {}, cseq);
      }
    }
  });

  const media = net.createServer((sock) => {
    log(`[panel] media connection from ${sock.remoteAddress}`);
    const dec = new FrameDecoder();
    sock.on('data', (chunk) => {
      let frames;
      try { frames = dec.push(chunk); } catch (e) { log(`[panel] media error: ${e.message}`); sock.destroy(); return; }
      for (const f of frames) {
        stats.frames++;
        stats.bytes += f.payload.length;
        if (f.type === FRAME_KEY) stats.keyFrames++;
        outFile?.write(f.payload);
        if (stats.frames === 1 || stats.frames % 150 === 0) {
          log(`[panel] frame #${stats.frames} seq=${f.seq} ssrc=${f.ssrc} ${f.type === FRAME_KEY ? 'KEY' : 'delta'} ${f.payload.length} B`);
        }
      }
    });
    sock.on('error', () => {});
  });

  // Touchback channel: the sender connects here; tests push touches with sendTouch()/sendKey().
  const feedbackSockets = new Set();
  const feedback = net.createServer((sock) => {
    log(`[panel] touchback connection from ${sock.remoteAddress}`);
    stats.feedbackConnections = (stats.feedbackConnections ?? 0) + 1;
    feedbackSockets.add(sock);
    sock.on('close', () => feedbackSockets.delete(sock));
    sock.on('error', () => {});
  });
  const broadcast = (buf) => { for (const s of feedbackSockets) s.write(buf); };

  let mdnsServer = null;
  const ready = Promise.all([
    new Promise((r) => control.listen(port, r)),
    new Promise((r) => media.listen(mediaPort, r)),
    new Promise((r) => feedback.listen(feedbackPort, r)),
  ]).then(async () => {
    if (mdns) mdnsServer = await advertise({ name, port, log });
    log(`[panel] listening: control ${port}, media ${mediaPort}${pin ? `, PIN ${pin}` : ''}`);
  });

  return {
    ready,
    stats,
    sendTouch: (buf) => broadcast(buf),
    get feedbackClients() { return feedbackSockets.size; },
    close: () => Promise.all([
      new Promise((r) => control.close(r)),
      new Promise((r) => media.close(r)),
      new Promise((r) => { for (const s of feedbackSockets) s.destroy(); feedback.close(r); }),
      new Promise((r) => (outFile ? outFile.end(r) : r())),
    ]).then(() => mdnsServer?.destroy()),
  };
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
  const m = makeMdns();
  const service = '_airgo._tcp.local';
  const instance = `${name}.${service}`;
  const host = `${os.hostname()}.local`;
  const ip = Object.values(os.networkInterfaces()).flat()
    .find((i) => i && i.family === 'IPv4' && !i.internal)?.address ?? '127.0.0.1';
  m.on('query', (q) => {
    if (!q.questions.some((x) => x.name === service || x.name === instance)) return;
    m.respond({
      answers: [{ name: service, type: 'PTR', data: instance }],
      additionals: [
        { name: instance, type: 'SRV', data: { port, target: host } },
        { name: instance, type: 'TXT', data: ['mock=1'] },
        { name: host, type: 'A', data: ip },
      ],
    });
  });
  log(`[panel] mDNS: ${instance} -> ${ip}:${port}`);
  return m;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values } = parseArgs({
    options: {
      port: { type: 'string', default: '3056' },
      'media-port': { type: 'string', default: '8899' },
      pin: { type: 'string', default: '' },
      out: { type: 'string' },
      'no-mdns': { type: 'boolean', default: false },
    },
  });
  const panel = startMockPanel({
    port: Number(values.port),
    mediaPort: Number(values['media-port']),
    pin: values.pin,
    out: values.out,
    mdns: !values['no-mdns'],
  });
  await panel.ready;
  process.on('SIGINT', async () => {
    console.log(`[panel] ${panel.stats.frames} frames (${panel.stats.keyFrames} key), ${(panel.stats.bytes / 1e6).toFixed(1)} MB`);
    await panel.close();
    process.exit(0);
  });
}
