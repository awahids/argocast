// argocast renderer. Talks to the main process only through window.argocast.
const api = window.argocast;
const $ = (id) => document.getElementById(id);

const views = { home: $('view-home'), connecting: $('view-connecting'), casting: $('view-casting'), receive: $('view-receive') };
let settings = {};
let current = null;       // { host, port, name }
let castStart = 0;
let timerId = 0;
const devices = new Map(); // key -> device

function show(name) {
  for (const [k, el] of Object.entries(views)) el.hidden = k !== name;
}

function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast.id);
  toast.id = setTimeout(() => { t.hidden = true; }, 5000);
}

function parseHost(text) {
  const [host, port] = text.trim().split(':');
  return { host, port: port ? Number(port) : settings.defaultPort };
}

// ---- devices --------------------------------------------------------------
function deviceItem(d, onClick) {
  const li = document.createElement('li');
  const b = document.createElement('button');
  b.className = 'device';
  b.type = 'button';
  b.innerHTML = '<span class="tv"></span><span class="meta"><span class="name"></span><span class="addr"></span></span>';
  b.querySelector('.name').textContent = d.name;
  b.querySelector('.addr').textContent = `${d.host}:${d.port}`;
  b.addEventListener('click', () => onClick(d));
  li.append(b);
  return li;
}

function renderDevices() {
  const list = $('device-list');
  list.replaceChildren(...[...devices.values()].map((d) => deviceItem(d, askPin)));
  $('device-empty').hidden = devices.size > 0;
}

function renderRecent() {
  const recent = settings.recent ?? [];
  $('recent-card').hidden = recent.length === 0;
  $('recent-list').replaceChildren(...recent.map((d) => deviceItem(d, askPin)));
}

async function scan() {
  const btn = $('btn-refresh');
  btn.disabled = true;
  btn.querySelector('.spinner').hidden = false;
  btn.querySelector('.label').textContent = 'Mencari…';
  $('device-empty').textContent = 'Mencari panel…';
  devices.clear();
  renderDevices();
  try {
    await api.discover();
  } finally {
    btn.disabled = false;
    btn.querySelector('.spinner').hidden = true;
    btn.querySelector('.label').textContent = 'Cari ulang';
    $('device-empty').textContent = 'Tidak ada panel ditemukan. Gunakan sambung manual di bawah.';
    $('device-empty').hidden = devices.size > 0;
  }
}

api.onFound((p) => {
  const name = p.name.replace(/\._airgo\._tcp\.local\.?$/, '');
  devices.set(`${p.ip}:${p.port}`, { host: p.ip, port: p.port, name });
  renderDevices();
});

// ---- connect --------------------------------------------------------------
function askPin(d) {
  const dlg = $('dlg-pin');
  $('pin-target').textContent = `${d.name} — ${d.host}:${d.port}`;
  $('in-pin-dlg').value = '';
  dlg.returnValue = '';
  dlg.onclose = () => { api.mark(`pin dialog closed: ${dlg.returnValue}`); if (dlg.returnValue === 'ok') connect(d, $('in-pin-dlg').value.trim()); };
  dlg.showModal();
  $('in-pin-dlg').focus();
}

async function connect(target, pin) {
  current = target;
  $('connect-title').textContent = `Menghubungkan ke ${target.name}…`;
  for (const li of $('steps').children) li.className = '';
  show('connecting');
  api.mark('connect -> api.start');
  const res = await api.start({ ...target, pin });
  if (!res.ok && res.message) { toast(res.message); show('home'); }
}

const looksLikeIp = (s) => /^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(s.trim());

// The PIN field is only needed when an IP is typed; a panel code is its own PIN.
$('in-host').addEventListener('input', () => { $('pin-row').hidden = !looksLikeIp($('in-host').value); });

$('form-manual').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('in-host').value.trim();
  if (!text) return;
  if (looksLikeIp(text)) {
    const { host, port } = parseHost(text);
    connect({ host, port, name: host }, $('in-pin').value.trim());
  } else {
    connectCode(text);
  }
});

async function connectCode(code) {
  current = { name: `Panel ${code}`, code };
  $('connect-title').textContent = `Menghubungkan dengan kode ${code}…`;
  for (const li of $('steps').children) li.className = '';
  show('connecting');
  const res = await api.start({ code });
  if (!res.ok && res.message) { toast(res.message); show('home'); }
}

$('btn-refresh').addEventListener('click', scan);
$('btn-cancel').addEventListener('click', () => api.stop());
$('btn-stop').addEventListener('click', () => api.stop());

// ---- state from main --------------------------------------------------------
const ORDER = ['connecting', 'authenticating', 'starting'];

api.onState((s) => {
  if (ORDER.includes(s.state)) {
    show('connecting');
    const idx = ORDER.indexOf(s.state);
    [...$('steps').children].forEach((li, i) => { li.className = i < idx ? 'done' : i === idx ? 'active' : ''; });
  } else if (s.state === 'casting') {
    $('cast-target').textContent = current?.name ?? s.host;
    $('st-res').textContent = `${s.width}×${s.height}`;
    castStart = Date.now();
    clearInterval(timerId);
    timerId = setInterval(tick, 500);
    tick();
    show('casting');
  } else if (s.state === 'idle') {
    clearInterval(timerId);
    $('badge-touch').hidden = true;
    show('home');
    api.getSettings().then((st) => { settings = st; renderRecent(); });
  } else if (s.state === 'error') {
    clearInterval(timerId);
    show('home');
    toast(s.message || 'Terjadi kesalahan.');
  }
});

api.onTouchback((s) => { $('badge-touch').hidden = !s.connected; });

api.onStats((s) => {
  $('st-fps').textContent = s.fps;
  $('st-kbps').textContent = `${s.kbps.toLocaleString('id-ID')} kbps`;
});

function tick() {
  const sec = Math.floor((Date.now() - castStart) / 1000);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const pad = (n) => String(n).padStart(2, '0');
  $('cast-timer').textContent = h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

// ---- settings -------------------------------------------------------------
function fillSettings() {
  $('set-name').value = settings.deviceName ?? '';
  $('set-res').value = settings.resolution;
  $('set-fps').value = String(settings.fps);
  document.querySelector(`#set-quality input[value="${settings.quality}"]`).checked = true;
  document.querySelector(`#set-source input[value="${settings.source}"]`).checked = true;
  $('set-touch').checked = settings.touchback !== false;
}

$('btn-settings').addEventListener('click', () => {
  fillSettings();
  const dlg = $('dlg-settings');
  dlg.returnValue = '';
  dlg.onclose = async () => {
    if (dlg.returnValue !== 'ok') return;
    settings = await api.setSettings({
      deviceName: $('set-name').value.trim() || settings.deviceName,
      resolution: $('set-res').value,
      fps: Number($('set-fps').value),
      quality: document.querySelector('#set-quality input:checked').value,
      source: document.querySelector('#set-source input:checked').value,
      touchback: $('set-touch').checked,
    });
  };
  dlg.showModal();
});

// ---- receive mode -------------------------------------------------------------
let rxOn = false;
function renderRx(s) {
  const wasOn = rxOn;
  rxOn = Boolean(s?.on);
  if (!rxOn) { if (wasOn) show('home'); return; }
  $('rx-code').textContent = s.code.replace(/^(\d{3})(\d{3})$/, '$1 $2');
  $('rx-name').textContent = s.name;
  $('rx-name-2').textContent = s.name;
  $('rx-ip').textContent = s.ip;
  const peer = s.peer;
  $('rx-badge').textContent = peer ? 'MENERIMA' : 'SIAP MENERIMA';
  $('rx-badge').classList.toggle('live-badge', Boolean(peer));
  $('rx-title').textContent = peer ? `Menampilkan layar ${peer.name}` : 'Cast ke komputer ini';
  $('btn-rx-disconnect').hidden = !peer;
  show('receive');
}
$('btn-rx-start').addEventListener('click', async () => {
  $('btn-rx-start').disabled = true;
  const s = await api.rxStart();
  $('btn-rx-start').disabled = false;
  if (s.error) toast(s.error); else renderRx(s);
});
$('btn-rx-stop').addEventListener('click', () => api.rxStop());
$('btn-rx-disconnect').addEventListener('click', () => api.rxDisconnect());
api.onRx(renderRx);

// ---- updates ----------------------------------------------------------------
const isMac = navigator.userAgent.includes('Mac');

function renderUpdate(u) {
  $('app-version').textContent = `v${u.current}`;
  const v = u.version ? `v${u.version}` : '';
  const status = {
    idle: '', disabled: u.message || 'pembaruan otomatis nonaktif',
    checking: 'memeriksa…', latest: 'sudah versi terbaru',
    available: `${v} tersedia`, downloading: `mengunduh ${v}… ${u.percent ?? 0}%`,
    ready: `${v} siap dipasang`, installing: `memasang ${v}…`, error: u.message || 'gagal memeriksa',
  }[u.status] ?? '';
  $('update-status').textContent = status;
  $('btn-check-update').disabled = ['checking', 'downloading', 'installing'].includes(u.status);

  // Banner: only for something actionable (or a manual check's result).
  const banner = $('banner-update'), btn = $('btn-update');
  let text = '', action = '';
  if (u.status === 'available') { text = `argocast ${v} tersedia.`; action = 'Perbarui sekarang'; }
  else if (u.status === 'downloading') text = `Mengunduh pembaruan ${v}… ${u.percent ?? 0}%`;
  else if (u.status === 'ready') {
    text = `Pembaruan ${v} siap. Dipasang otomatis saat aplikasi ditutup.`;
    action = 'Mulai ulang sekarang';
  } else if (u.status === 'installing') text = `Memasang ${v}… argocast akan terbuka kembali.`;
  else if (u.status === 'error' && (u.manual || isMac && u.version)) text = `Pembaruan gagal: ${u.message}`;
  else if (u.status === 'latest' && u.manual) text = `Anda sudah memakai versi terbaru (v${u.current}).`;
  if (u.message && ['available', 'ready'].includes(u.status)) text += ` ${u.message}`;
  banner.hidden = !text;
  $('update-text').textContent = text;
  btn.hidden = !action;
  btn.textContent = action;
}

$('btn-update').addEventListener('click', () => api.installUpdate());
$('btn-check-update').addEventListener('click', () => api.checkUpdate());
api.onUpdate(renderUpdate);

// ---- boot -----------------------------------------------------------------
(async () => {
  settings = await api.getSettings();
  api.checkFfmpeg().then((ok) => { $('banner-ffmpeg').hidden = ok; });
  renderRecent();
  api.getUpdate().then(renderUpdate);
  const { state } = await api.status();
  if (state !== 'idle' && state !== 'error') show('connecting'); else show('home');
  renderRx(await api.rxGet());
  scan();
})();
