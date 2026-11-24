#!/usr/bin/env node
// Mock Lango panel for local testing: a headless src/receiver.js (mDNS, LRTSP
// state machine, PIN check, 16-byte framed H.264 media, touchback channel).
// Responses are our best reconstruction; a real panel may differ in details.
//
//   node mock/panel.js [--port 3056] [--media-port 8899] [--pin 1234] [--out received.h264] [--no-mdns]
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { Receiver } from '../src/receiver.js';

export function startMockPanel({
  port = 3056, mediaPort = 8899, feedbackPort = mediaPort + 2, pin = '', out = null, mdns = true, name = 'Argocast Mock Panel', log = console.log,
} = {}) {
  const rx = new Receiver({ port, mediaPort, feedbackPort, pin, out, mdns, name });
  rx.on('log', (m) => log(m.replace('[receiver]', '[panel]')));
  rx.on('error', (e) => log(`[panel] ${e.message}`));
  return {
    ready: rx.ready,
    stats: rx.stats,
    receiver: rx,
    sendTouch: (buf) => rx.sendTouch(buf),
    get feedbackClients() { return rx.feedbackClients; },
    close: () => rx.close(),
  };
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
