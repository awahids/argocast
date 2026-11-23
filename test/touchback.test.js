import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FeedbackParser, encodeTouch, encodeKey, frameToScreen, TouchTranslator, ACTION } from '../src/touchback.js';
import { startMockPanel } from '../mock/panel.js';
import { Caster } from '../src/caster.js';
import { findFfmpeg } from '../src/capture.js';
import { startInjector } from '../src/inject/index.js';

test('parser decodes touch, key and split packets', () => {
  const p = new FeedbackParser();
  const wire = Buffer.concat([
    encodeTouch([{ id: 1, action: ACTION.DOWN, x: 1000, y: 2000 }, { id: 2, action: ACTION.MOVE, x: 65535, y: 0 }]),
    encodeKey(0x17),
  ]);
  const evs = [...p.push(wire.subarray(0, 5)), ...p.push(wire.subarray(5))];
  assert.equal(evs.length, 2);
  assert.deepEqual(evs[0], { type: 'touch', points: [{ id: 1, action: 0, x: 1000, y: 2000 }, { id: 2, action: 2, x: 65535, y: 0 }] });
  assert.deepEqual(evs[1], { type: 'key', keycode: 0x17 });
  assert.equal(p.push(encodeTouch([{ id: 0, action: 0, x: 1, y: 1 }], 1))[0].type, 'mouse');
});

test('frame -> screen mapping removes the letterbox', () => {
  // 4:3 screen inside a 16:9 frame: content spans x 240..1680 of 1920
  const geo = { frameW: 1920, frameH: 1080, screenW: 1440, screenH: 1080 };
  assert.equal(frameToScreen(Math.round(240 / 1920 * 65535), 0, geo).x, 0);
  assert.equal(frameToScreen(32768, 32768, geo).x, 32768);
  assert.equal(frameToScreen(100, 100, geo), null); // in the black bar
  assert.deepEqual(frameToScreen(5, 6, { frameW: 1920, frameH: 1080 }), { x: 5, y: 6 });
});

function fakeInjector() {
  const calls = [];
  const rec = (name) => (...a) => calls.push([name, ...a]);
  return { calls, size: Promise.resolve({ width: 1920, height: 1080 }), down: rec('down'), move: rec('move'), up: rec('up'), rightClick: rec('rclick'), key: rec('key'), stop() {} };
}

test('translator: tap, drag, long press = right click, keys', async () => {
  const inj = fakeInjector();
  const t = new TouchTranslator(inj, { frameW: 1920, frameH: 1080, screenW: 1920, screenH: 1080 }, { longPressMs: 30 });
  t.handle({ type: 'touch', points: [{ id: 1, action: 0, x: 100, y: 100 }] });
  t.handle({ type: 'touch', points: [{ id: 1, action: 2, x: 5000, y: 100 }] });
  t.handle({ type: 'touch', points: [{ id: 1, action: 1, x: 5000, y: 100 }] });
  assert.deepEqual(inj.calls.map((c) => c[0]), ['down', 'move', 'up']);
  inj.calls.length = 0;
  t.handle({ type: 'touch', points: [{ id: 3, action: 0, x: 200, y: 200 }] });
  await new Promise((r) => setTimeout(r, 50));
  t.handle({ type: 'touch', points: [{ id: 3, action: 1, x: 200, y: 200 }] });
  assert.deepEqual(inj.calls.map((c) => c[0]), ['down', 'up', 'rclick']);
  t.handle({ type: 'key', keycode: 0x13 });
  assert.deepEqual(inj.calls.at(-1), ['key', 0x13]);
});

test('end-to-end: panel touches reach the injector', { skip: !findFfmpeg() && 'ffmpeg not installed' }, async () => {
  const panel = startMockPanel({ port: 48654, mediaPort: 48655, feedbackPort: 48657, pin: '1111', mdns: false, log: () => {} });
  await panel.ready;
  const caster = new Caster();
  const inj = fakeInjector();
  caster.makeInjector = () => inj;
  const connected = new Promise((r) => caster.once('touchback', r));
  await caster.start({ host: '127.0.0.1', port: 48654, pin: '1111', source: 'test', width: 640, height: 360, fps: 15, bitrateKbps: 500 });
  assert.deepEqual(await connected, { connected: true });
  panel.sendTouch(Buffer.concat([
    encodeTouch([{ id: 1, action: 0, x: 32768, y: 32768 }]),
    encodeTouch([{ id: 1, action: 1, x: 32768, y: 32768 }]),
    encodeKey(0x17),
  ]));
  await new Promise((r) => setTimeout(r, 200));
  await caster.stop();
  await panel.close();
  assert.deepEqual(inj.calls.map((c) => c[0]), ['down', 'up', 'key']);
  assert.equal(inj.calls[0][1], 32768);
});

test('Windows injector helper starts and reports the virtual desktop size', { skip: process.platform !== 'win32' && 'Windows only' }, async () => {
  const inj = startInjector();
  const size = await Promise.race([inj.size, new Promise((r) => setTimeout(() => r('timeout'), 20000))]);
  inj.stop();
  assert.ok(size && size.width > 0 && size.height > 0, `size: ${JSON.stringify(size)}`);
});
