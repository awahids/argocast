// End-to-end: real LrtspSession + ffmpeg test pattern → mock panel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startMockPanel } from '../mock/panel.js';
import { LrtspSession, LrtspError } from '../src/session.js';
import { startCapture, findFfmpeg } from '../src/capture.js';

const quiet = () => {};

test('wrong PIN is rejected with 406', async () => {
  const panel = startMockPanel({ port: 18554, mediaPort: 18555, pin: '4321', mdns: false, log: quiet });
  await panel.ready;
  const s = new LrtspSession({ host: '127.0.0.1', port: 18554, deviceName: 't', uuid: 'u' });
  await s.connect();
  await assert.rejects(s.authenticate('0000'), (e) => e instanceof LrtspError && e.status === '406');
  s.sock.destroy();
  await panel.close();
});

test('full cast session delivers H.264 frames', { skip: !findFfmpeg() && 'ffmpeg not installed' }, async () => {
  const panel = startMockPanel({ port: 28554, mediaPort: 28555, pin: '1234', mdns: false, log: quiet });
  await panel.ready;
  const s = new LrtspSession({ host: '127.0.0.1', port: 28554, deviceName: 't', uuid: 'u' });
  await s.connect();
  const opt = await s.authenticate('1234');
  assert.ok(opt.ssrc);
  const transport = await s.startCast({ width: 640, height: 360, framerate: 30 });
  assert.equal(transport.rtp_port, 28555);

  await new Promise((resolve, reject) => {
    const cap = startCapture({
      source: 'test', width: 640, height: 360, fps: 30, bitrateKbps: 800,
      onAccessUnit: (au) => s.sendAccessUnit(au),
      onExit: () => {},
    });
    setTimeout(() => { cap.stop(); resolve(); }, 2500);
    cap.process.on('error', reject);
  });
  await new Promise((r) => setTimeout(r, 300));
  await s.stop();

  assert.deepEqual(panel.stats.requests.slice(0, 4), ['OPTIONS', 'ANNOUNCE', 'SETUP', 'PLAY']);
  assert.equal(panel.stats.lastAnnounce.width, '640');
  assert.ok(panel.stats.frames >= 30, `expected ≥30 frames, got ${panel.stats.frames}`);
  assert.ok(panel.stats.keyFrames >= 1, 'expected at least one key frame');
  assert.ok(panel.stats.requests.includes('TEARDOWN'));
  await panel.close();
});
