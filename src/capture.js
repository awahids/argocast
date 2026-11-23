// Screen capture + H.264 encoding via an ffmpeg child process.
// Encoder settings follow Airgo Cast Windows (x264 baseline, ultrafast,
// zerolatency, repeat headers, keyframe every few seconds).
import { spawn, spawnSync, execFile } from 'node:child_process';
import path from 'node:path';
import { AccessUnitSplitter } from './frame.js';

let cachedFfmpeg;
let pendingFfmpeg;

function ffmpegCandidates() {
  const candidates = [process.env.FFMPEG_PATH];
  // Installed app: ffmpeg.exe is shipped next to app.asar (electron-builder extraResources).
  if (process.resourcesPath) candidates.push(path.join(process.resourcesPath, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'));
  candidates.push('ffmpeg');
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    // winget installs a shim here; GUI apps may start with a stale PATH.
    candidates.push(path.join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', 'ffmpeg.exe'));
  }
  return candidates.filter(Boolean);
}

/** Synchronous lookup (CLI). Blocks while antivirus scans a fresh ffmpeg.exe. */
export function findFfmpeg() {
  if (cachedFfmpeg !== undefined) return cachedFfmpeg;
  cachedFfmpeg = null;
  for (const cmd of ffmpegCandidates()) {
    const r = spawnSync(cmd, ['-version'], { encoding: 'utf8', windowsHide: true });
    if (r.status === 0) { cachedFfmpeg = cmd; break; }
  }
  return cachedFfmpeg;
}

/** Non-blocking lookup (GUI). The first run after install can take seconds while Defender scans. */
export function findFfmpegAsync() {
  if (cachedFfmpeg !== undefined) return Promise.resolve(cachedFfmpeg);
  pendingFfmpeg ??= (async () => {
    for (const cmd of ffmpegCandidates()) {
      const ok = await new Promise((resolve) => {
        execFile(cmd, ['-version'], { windowsHide: true, timeout: 60000 }, (err) => resolve(!err));
      });
      if (ok) { cachedFfmpeg = cmd; return cmd; }
    }
    cachedFfmpeg = null;
    return null;
  })();
  return pendingFfmpeg;
}

/** ffmpeg input arguments that grab the main display on this OS. */
export function desktopInput({ ffmpeg, fps, platform = process.platform }) {
  if (platform === 'win32') {
    return ['-f', 'gdigrab', '-framerate', String(fps), '-draw_mouse', '1', '-i', 'desktop'];
  }
  if (platform === 'darwin') {
    // macOS asks for Screen Recording permission the first time (System Settings ›
    // Privacy & Security › Screen Recording › argocast).
    const index = macScreenIndex(ffmpeg);
    return ['-f', 'avfoundation', '-capture_cursor', '1', '-framerate', String(fps), '-i', `${index}:none`];
  }
  // Linux/X11 fallback
  return ['-f', 'x11grab', '-framerate', String(fps), '-draw_mouse', '1', '-i', process.env.DISPLAY || ':0.0'];
}

/**
 * avfoundation numbers cameras first and screens after them ("[2] Capture screen 0"),
 * so the screen index differs per Mac. Parse the device list once.
 */
export function macScreenIndex(ffmpeg) {
  const r = spawnSync(ffmpeg, ['-hide_banner', '-f', 'avfoundation', '-list_devices', 'true', '-i', ''], { encoding: 'utf8' });
  return parseMacScreenIndex(`${r.stdout ?? ''}${r.stderr ?? ''}`);
}

export function parseMacScreenIndex(listing) {
  const video = listing.split(/AVFoundation audio devices/i)[0];
  const m = /\[(\d+)\]\s+Capture screen 0/i.exec(video);
  return m ? Number(m[1]) : 1;
}

/**
 * Starts ffmpeg and calls onAccessUnit({ data, isKey }) for each frame.
 * source: 'desktop' (Windows gdigrab) or 'test' (synthetic test pattern).
 */
export function startCapture({
  source = 'desktop',
  width = 1920,
  height = 1080,
  fps = 30,
  bitrateKbps = 5000,
  ffmpeg = findFfmpeg(),
  onAccessUnit,
  onExit,
  log = () => {},
}) {
  if (!ffmpeg) throw new Error('ffmpeg not found. Install it (winget install Gyan.FFmpeg) or set FFMPEG_PATH.');

  const input = source === 'test'
    ? ['-re', '-f', 'lavfi', '-i', `testsrc2=size=${width}x${height}:rate=${fps}`]
    : desktopInput({ ffmpeg, fps });

  const args = [
    '-hide_banner', '-loglevel', 'error',
    ...input,
    '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`,
    '-c:v', 'libx264',
    '-profile:v', 'baseline',
    '-preset', 'ultrafast',
    '-tune', 'zerolatency',
    '-b:v', `${bitrateKbps}k`,
    '-maxrate', `${Math.round(bitrateKbps * 1.6)}k`,
    '-bufsize', `${bitrateKbps}k`,
    '-g', String(fps * 3),
    '-bf', '0',
    '-x264-params', 'repeat-headers=1',
    '-f', 'h264', 'pipe:1',
  ];
  log(`ffmpeg ${args.join(' ')}`);

  const proc = spawn(ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  const splitter = new AccessUnitSplitter();
  proc.stdout.on('data', (chunk) => {
    for (const au of splitter.push(chunk)) onAccessUnit(au);
  });
  proc.stdout.on('end', () => {
    for (const au of splitter.end()) onAccessUnit(au);
  });
  proc.stderr.on('data', (d) => log(`ffmpeg: ${d.toString().trim()}`));
  proc.on('exit', (code) => onExit?.(code));

  return { stop: () => proc.kill('SIGINT'), process: proc };
}
