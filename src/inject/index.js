// Spawns the platform injector helper and exposes down/move/up/rightClick/key.
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url))
  // Packaged app: helpers are unpacked next to app.asar (asarUnpack).
  .replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`);

// Android keycodes sent by the panel -> Windows VK, exactly as obs-lango.dll maps them.
const ANDROID_TO_VK = { 0x13: 0x26, 0x14: 0x28, 0x15: 0x25, 0x16: 0x27, 0x17: 0x0d, 0x5c: 0x22, 0x5d: 0x21 };
// ... -> macOS virtual key codes (up, down, left, right, return, page down, page up).
const ANDROID_TO_MAC = { 0x13: 126, 0x14: 125, 0x15: 123, 0x16: 124, 0x17: 36, 0x5c: 121, 0x5d: 116 };

export function startInjector({ log = () => {}, platform = process.platform } = {}) {
  let cmd, args, keymap;
  if (platform === 'win32') {
    cmd = 'powershell.exe';
    // Bypass applies to this one helper process only; the system policy is untouched.
    args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(here, 'inject-win.ps1')];
    keymap = ANDROID_TO_VK;
  } else if (platform === 'darwin') {
    cmd = 'osascript';
    args = ['-l', 'JavaScript', path.join(here, 'inject-mac.js')];
    keymap = ANDROID_TO_MAC;
  } else {
    return null;
  }
  const proc = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let resolveSize;
  const size = new Promise((r) => { resolveSize = r; });
  proc.stdout.on('data', (d) => {
    const m = /size (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)/.exec(d.toString());
    if (m) resolveSize({ width: Number(m[1]), height: Number(m[2]) });
  });
  proc.stderr.on('data', (d) => log(`injector: ${d.toString().trim()}`));
  proc.on('exit', (code) => { log(`injector exited (${code})`); resolveSize(null); });
  const send = (line) => { if (proc.stdin.writable) proc.stdin.write(`${line}\n`); };
  return {
    size, // Promise<{width,height}|null>
    down: (x, y) => send(`down ${x} ${y}`),
    move: (x, y) => send(`move ${x} ${y}`),
    up: (x, y) => send(`up ${x} ${y}`),
    rightClick: (x, y) => send(`rclick ${x} ${y}`),
    key: (androidKeycode) => send(`key ${keymap[androidKeycode] ?? androidKeycode}`),
    stop: () => { proc.stdin.end(); proc.kill(); },
  };
}
