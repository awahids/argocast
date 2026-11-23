// GUI smoke test: drives the real window against an in-process mock panel and
// saves screenshots. Run with: npm run smoke  (ARGOCAST_SMOKE=1)
import fs from 'node:fs';
import path from 'node:path';
import { startMockPanel } from '../mock/panel.js';

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

    await js(`document.querySelector('#form-pin button[value=ok]').click()`);
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
  } catch (err) {
    result.error = String(err?.stack || err);
  } finally {
    fs.writeFileSync(path.join(dir, 'result.json'), JSON.stringify(result, null, 2));
    await panel.close();
    app.isQuitting = true;
    app.exit(0);
  }
}
