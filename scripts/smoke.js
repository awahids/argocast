// Launches the Electron app in smoke-test mode and prints the result.
// Screenshots land in ./smoke-output/ (git-ignored).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import electron from 'electron';

const dir = path.resolve('smoke-output');
fs.rmSync(dir, { recursive: true, force: true });
const r = spawnSync(electron, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, ARGOCAST_SMOKE: '1', ARGOCAST_SMOKE_DIR: dir },
  timeout: 120000,
});
const resultFile = path.join(dir, 'result.json');
if (!fs.existsSync(resultFile)) {
  console.error(`smoke: no result (exit ${r.status}, ${r.error ?? ''})`);
  process.exit(1);
}
const result = JSON.parse(fs.readFileSync(resultFile, 'utf8'));
console.log(JSON.stringify(result, null, 2));
const ok = !result.error && result.devicesListed > 0 && result.castingVisible && result.homeAfterStop
  && result.panel?.frames > 0 && /PIN salah/.test(result.toast ?? '')
  && result.playerDecoded && result.touchback?.some((t) => t[0] === 'down') && result.playerClosedAfterDisconnect
  && result.playerStats2?.decoded > result.playerStats1?.decoded + 20; // video keeps flowing
console.log(ok ? 'SMOKE OK' : 'SMOKE FAILED');
process.exit(ok ? 0 : 1);
