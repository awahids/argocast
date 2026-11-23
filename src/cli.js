#!/usr/bin/env node
// argocast CLI prototype.
//   argocast discover
//   argocast cast <code>   (panel share code, e.g. 834109)
//   argocast cast <ip>[:port] [--pin 1234] [--test] [--size 1920x1080] [--fps 30] [--verbose]
import { parseArgs } from 'node:util';
import { discover } from './discovery.js';
import { Caster, DEFAULT_PORT } from './caster.js';
import { isIPv4 } from './sharecode.js';

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    pin: { type: 'string' },
    port: { type: 'string' },
    test: { type: 'boolean', default: false },
    size: { type: 'string', default: '1920x1080' },
    fps: { type: 'string', default: '30' },
    bitrate: { type: 'string', default: '5000' },
    name: { type: 'string' },
    timeout: { type: 'string', default: '3000' },
    verbose: { type: 'boolean', short: 'v', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});

const [command, target] = positionals;

async function cmdDiscover() {
  console.log(`Searching for panels (_airgo._tcp) for ${values.timeout} ms...`);
  const panels = await discover({
    timeoutMs: Number(values.timeout),
    onFound: (p) => console.log(`  * ${p.name}  ${p.ip}:${p.port}  ${JSON.stringify(p.txt ?? {})}`),
  });
  if (!panels.length) console.log('No panels found. Same Wi-Fi? Try: argocast cast <ip> --pin <PIN>');
  return panels;
}

async function cmdCast() {
  let host, port, code;
  if (target && isIPv4(target.split(':')[0])) {
    const [h, p] = target.split(':');
    host = h;
    port = Number(values.port ?? p ?? DEFAULT_PORT);
  } else if (target) {
    code = positionals.slice(1).join(''); // allow "cast 834 109"
  } else {
    const [first] = await cmdDiscover();
    if (!first) process.exit(1);
    ({ ip: host, port } = first);
  }
  const [width, height] = values.size.split('x').map(Number);

  const caster = new Caster();
  if (values.verbose) caster.on('log', (m) => console.error('[debug]', m));
  caster.on('stats', (s) => values.verbose && console.error(`[debug] frames=${s.frames} dropped=${s.dropped} ${s.fps}fps ${s.kbps}kbps`));
  caster.on('state', (s) => {
    if (s.state === 'connecting') console.log(`Connecting to ${s.host}:${s.port}...`);
    if (s.state === 'starting') console.log(`Authenticated. SSRC=${s.ssrc || '(none)'}  capabilities=${s.capabilities.join(',') || '(none)'}`);
    if (s.state === 'casting') console.log(`Casting ${s.width}x${s.height}@${s.fps} -> media port ${s.mediaPort}. Ctrl+C to stop.`);
    if (s.state === 'error') { console.error(`Error: ${s.message}`); process.exit(1); }
  });

  await caster.start({
    host, port, code, pin: values.pin, deviceName: values.name,
    width, height, fps: Number(values.fps), bitrateKbps: Number(values.bitrate),
    source: values.test ? 'test' : 'desktop',
  });

  const shutdown = async () => { await caster.stop(); console.log('Stopped.'); process.exit(0); };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

function help() {
  console.log(`argocast - prototype sender for Lango/XBH panels (LRTSP/2.0)

Usage:
  argocast discover [--timeout 3000]
  argocast cast <code>                 (the code shown on the panel, e.g. 834109 or "834 109")
  argocast cast [<ip>[:port]] [--pin PIN] [--test] [--size WxH] [--fps N] [--bitrate KBPS] [--name NAME] [-v]

  --test     send an ffmpeg test pattern instead of the desktop
  --port     LRTSP control port (default ${DEFAULT_PORT})`);
}

try {
  if (values.help || !command) help();
  else if (command === 'discover') await cmdDiscover();
  else if (command === 'cast') await cmdCast();
  else { help(); process.exit(1); }
} catch (err) {
  if (!process.exitCode) { console.error(`Error: ${err.message}`); process.exit(1); }
}
