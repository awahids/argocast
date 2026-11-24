// GUI smoke test: drives the real window against an in-process mock panel and
// saves screenshots. Run with: npm run smoke  (ARGOCAST_SMOKE=1)
import fs from 'node:fs';
import path from 'node:path';
import { BrowserWindow } from 'electron';
import { startMockPanel } from '../mock/panel.js';
import { Caster } from '../src/caster.js';

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

export async function runSmoke({ win, app, settings }) {
  const dir = process.env.ARGOCAST_SMOKE_DIR;
  fs.mkdirSync(dir, { recursive: true });
  const result = { steps: [] };
  const shot = async (name) => {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(dir, `${name}.png`), img.toPNG());
    result.steps.push(name);
  };
  const js = (code) => win.webContents.executeJavaScript(code);

  const panel = startMockPanel({ port: 38554, mediaPort: 38555, pin: '2468', name: 'Ruang Rapat 3', log: () => {} });
  try {
    await panel.ready;
    Object.assign(settings, { source: 'test', resolution: '1280x720' });
    await new Promise((r) => (win.webContents.isLoading() ? win.webContents.once('did-finish-load', r) : r()));
    await wait(3500); // discovery runs for 2.5 s
    await shot('1-home');

    result.devicesListed = await js(`document.querySelectorAll('#device-list .device').length`);
    await js(`document.querySelector('#device-list .device')?.click()`);
    await wait(300);
    await js(`document.getElementById('in-pin-dlg').value = '2468'`);
    await shot('2-pin');

    result.pinDialogOpen = await js(`document.getElementById('dlg-pin').open`);
    result.tPinOk = new Date().toISOString();
    await js(`window.argocast.mark('ok click'); document.querySelector('#form-pin button[value=ok]').click(); window.argocast.mark('ok click returned')`);
    const t0 = Date.now();
    while (Date.now() - t0 < 20000 && !(await js(`!document.getElementById('view-casting').hidden`))) await wait(250);
    result.secondsToCasting = Math.round((Date.now() - t0) / 100) / 10;
    await wait(4000); // let some frames flow
    await shot('3-casting');
    result.castingVisible = await js(`!document.getElementById('view-casting').hidden`);

    await js(`document.getElementById('btn-stop').click()`);
    await wait(1500);
    result.homeAfterStop = await js(`!document.getElementById('view-home').hidden`);

    // wrong PIN path (IP typed -> PIN field appears)
    await js(`const h = document.getElementById('in-host'); h.value = '127.0.0.1:38554'; h.dispatchEvent(new Event('input'));
              document.getElementById('in-pin').value = '0000'`);
    result.pinFieldShownForIp = await js(`!document.getElementById('pin-row').hidden`);
    await js(`document.querySelector('#form-manual button[type=submit]').click()`);
    await wait(1500);
    await shot('4-wrong-pin');
    result.toast = await js(`document.getElementById('toast').hidden ? null : document.getElementById('toast').textContent`);

    await js(`document.getElementById('btn-settings').click()`);
    await wait(300);
    await shot('5-settings');

    result.panel = { requests: panel.stats.requests, frames: panel.stats.frames, keyFrames: panel.stats.keyFrames };

    // ---- receive mode: another device casts to this computer -------------
    await js(`document.querySelector('#dlg-settings').close()`);
    await js(`document.getElementById('btn-rx-start').click()`);
    let rx = null;
    for (let i = 0; i < 40 && !rx?.code; i++) { await wait(100); rx = await js(`window.argocast.rxGet()`); }
    result.rxCode = rx?.code;
    result.rxViewVisible = await js(`!document.getElementById('view-receive').hidden`);
    await shot('6-receive');

    const sender = new Caster();
    const touches = [];
    sender.makeInjector = () => ({
      size: Promise.resolve({ width: 1280, height: 720 }),
      down: (x, y) => touches.push(['down', x, y]), move: (x, y) => touches.push(['move', x, y]),
      up: (x, y) => touches.push(['up', x, y]), rightClick: () => touches.push(['rclick']),
      key: (k) => touches.push(['key', k]), stop: () => {},
    });
    const tbConnected = new Promise((r) => sender.once('touchback', r));
    await sender.start({ host: '127.0.0.1', port: 39056, pin: rx.code, deviceName: 'Tablet Uji', source: 'test', width: 1280, height: 720, fps: 30, bitrateKbps: 2000, touchback: true });
    await tbConnected;
    let player = null;
    for (let i = 0; i < 50 && !player; i++) { await wait(100); player = BrowserWindow.getAllWindows().find((w) => w !== win); }
    const pjs = (code) => player.webContents.executeJavaScript(code);
    let shown = false;
    for (let i = 0; i < 80 && !shown; i++) { await wait(100); shown = await pjs(`document.getElementById('waiting').hidden`).catch(() => false); }
    result.playerDecoded = shown;
    result.playerVideoSize = await pjs(`[document.getElementById('video').width, document.getElementById('video').height]`);
    result.playerStats1 = await pjs('({ ...window.playerStats })');
    await wait(1500);
    result.playerStats2 = await pjs('({ ...window.playerStats })');
    // Canvas pixels (capturePage of a WebCodecs canvas can fail with UnknownVizError).
    const png = await pjs(`document.getElementById('video').toDataURL('image/png')`);
    fs.writeFileSync(path.join(dir, '7-player.png'), Buffer.from(png.split(',')[1], 'base64'));
    result.steps.push('7-player');
    result.rxPeerShown = await js(`document.getElementById('rx-title').textContent`);

    // click in the middle of the video -> touchback down/up at ~ (32768, 32768)
    await pjs(`(() => { const c = document.getElementById('video'); const r = c.getBoundingClientRect();
      const o = { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button: 0, pointerId: 1, bubbles: true };
      c.dispatchEvent(new PointerEvent('pointerdown', o)); c.dispatchEvent(new PointerEvent('pointerup', o)); })()`);
    await pjs(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown' }))`);
    await wait(500);
    result.touchback = touches;

    await js(`document.getElementById('btn-rx-disconnect').click()`);
    await wait(800);
    result.playerClosedAfterDisconnect = !BrowserWindow.getAllWindows().some((w) => w !== win);
    result.senderStateAfterDisconnect = sender.state;
    await sender.stop();
    await js(`document.getElementById('btn-rx-stop').click()`);
    await wait(500);
    result.homeAfterRxStop = await js(`!document.getElementById('view-home').hidden`);
  } catch (err) {
    result.error = String(err?.stack || err);
  } finally {
    fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2));
    await panel.close();
    app.isQuitting = true;
    app.exit(0);
  }
}
