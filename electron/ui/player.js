// Player window (receive mode): decodes the sender's H.264 (Annex B) with
// WebCodecs, draws it on a canvas, and sends mouse/keyboard back as touchback.
const api = window.player;
const $ = (id) => document.getElementById(id);
const canvas = $('video');
const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });

// ---- decoding -------------------------------------------------------------
let decoder = null;
let configuredCodec = null;
let waitKey = true;
let ts = 0;
let shown = false;
const stats = (window.playerStats = { received: 0, decoded: 0, dropped: 0, errors: 0 }); // inspected by the smoke test

/** "avc1.PPCCLL" from the SPS in an Annex-B access unit, or null. */
function codecFromAnnexB(buf) {
  for (let i = 0; i + 4 < buf.length; i++) {
    if (buf[i] === 0 && buf[i + 1] === 0 && (buf[i + 2] === 1 || (buf[i + 2] === 0 && buf[i + 3] === 1))) {
      const n = buf[i + 2] === 1 ? i + 3 : i + 4;
      if ((buf[n] & 0x1f) === 7 && n + 3 < buf.length) {
        const hex = (b) => b.toString(16).padStart(2, '0');
        return `avc1.${hex(buf[n + 1])}${hex(buf[n + 2])}${hex(buf[n + 3])}`;
      }
    }
  }
  return null;
}

function resetDecoder() {
  try { decoder?.close(); } catch { /* already closed */ }
  decoder = null;
  configuredCodec = null;
  waitKey = true;
}

function newDecoder(codec) {
  decoder = new VideoDecoder({
    output: (frame) => {
      if (canvas.width !== frame.displayWidth || canvas.height !== frame.displayHeight) {
        canvas.width = frame.displayWidth;
        canvas.height = frame.displayHeight;
      }
      ctx.drawImage(frame, 0, 0);
      frame.close();
      stats.decoded++;
      if (!shown) { shown = true; $('waiting').hidden = true; }
    },
    error: (e) => { console.error('decoder', e); stats.errors++; resetDecoder(); },
  });
  decoder.configure({ codec, optimizeForLatency: true });
  configuredCodec = codec;
}

api.onFrame(({ data, key }) => {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  stats.received++;
  if (waitKey && !key) { stats.dropped++; return; }
  if (key) {
    const codec = codecFromAnnexB(bytes);
    if (codec && codec !== configuredCodec) { resetDecoder(); newDecoder(codec); }
  }
  if (!decoder) return; // key frame without SPS before configuration
  // Falling far behind (~2 s at 30 fps): drop deltas until the next key frame.
  if (decoder.decodeQueueSize > 60 && !key) { waitKey = true; stats.dropped++; return; }
  try {
    decoder.decode(new EncodedVideoChunk({ type: key ? 'key' : 'delta', timestamp: (ts += 33333), data: bytes }));
    waitKey = false;
  } catch (e) {
    console.error('decode', e);
    resetDecoder();
  }
});

// ---- touchback ------------------------------------------------------------
const DOWN = 0, UP = 1, MOVE = 2;
let pressed = false;
let pendingMove = null;

/** Pointer position -> 0..65535 over the video content (object-fit: contain), or null outside it. */
function toVideo(ev, clampInside = false) {
  const r = canvas.getBoundingClientRect();
  const s = Math.min(r.width / canvas.width, r.height / canvas.height);
  const w = canvas.width * s, h = canvas.height * s;
  let u = (ev.clientX - r.left - (r.width - w) / 2) / w;
  let v = (ev.clientY - r.top - (r.height - h) / 2) / h;
  if (!clampInside && (u < 0 || u > 1 || v < 0 || v > 1)) return null;
  u = Math.min(1, Math.max(0, u));
  v = Math.min(1, Math.max(0, v));
  return { x: u * 65535, y: v * 65535 };
}

canvas.addEventListener('pointerdown', (ev) => {
  if (ev.button !== 0 || !shown) return;
  const p = toVideo(ev);
  if (!p) return;
  pressed = true;
  canvas.setPointerCapture(ev.pointerId);
  api.touch(DOWN, p.x, p.y);
});
canvas.addEventListener('pointermove', (ev) => {
  if (!pressed) return;
  const first = !pendingMove;
  pendingMove = toVideo(ev, true);
  if (first) requestAnimationFrame(() => { if (pressed && pendingMove) api.touch(MOVE, pendingMove.x, pendingMove.y); pendingMove = null; });
});
const release = (ev) => {
  if (!pressed) return;
  pressed = false;
  pendingMove = null;
  const p = toVideo(ev, true);
  api.touch(UP, p.x, p.y);
};
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

// Keyboard -> Android keycodes (the sender maps them: Android = system keys, desktop = arrows/Enter).
const KEYS = { ArrowUp: 19, ArrowDown: 20, ArrowLeft: 21, ArrowRight: 22, Enter: 23, Backspace: 4, Home: 3, PageUp: 0x5d, PageDown: 0x5c };
window.addEventListener('keydown', (e) => {
  if (e.key === 'F11') { e.preventDefault(); api.fullscreen(); return; }
  if (e.key === 'Escape') {
    e.preventDefault();
    if (document.fullscreenElement || window.innerHeight === screen.height) api.fullscreen();
    else api.key(4); // back
    return;
  }
  const code = KEYS[e.key];
  if (code) { e.preventDefault(); api.key(code); }
});

// ---- toolbar ----------------------------------------------------------------
$('btn-full').addEventListener('click', () => api.fullscreen());
$('btn-end').addEventListener('click', () => api.disconnect());
let hideTimer = 0;
const bar = $('bar');
const wake = () => {
  bar.classList.remove('hide');
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => { if (shown && !bar.matches(':hover')) bar.classList.add('hide'); }, 2500);
};
window.addEventListener('mousemove', (e) => { if (e.clientY < 80 || !pressed) wake(); });
wake();

function applyInfo(info) {
  if (!info) return;
  $('peer').textContent = info.name || 'Perangkat';
  document.title = `${info.name || 'Perangkat'} — argocast`;
}
api.onInfo(applyInfo);
api.ready().then(applyInfo);
