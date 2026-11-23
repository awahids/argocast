// argocast renderer. Talks to the main process only through window.argocast.
const api = window.argocast;
const $ = (id) => document.getElementById(id);

const views = { home: $('view-home'), connecting: $('view-connecting'), casting: $('view-casting') };
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
  dlg.onclose = () => { if (dlg.returnValue === 'ok') connect(d, $('in-pin-dlg').value.trim()); };
  dlg.showModal();
  $('in-pin-dlg').focus();
}

async function connect(target, pin) {
  current = target;
  $('connect-title').textContent = `Menghubungkan ke ${target.name}…`;
  for (const li of $('steps').children) li.className = '';
  show('connecting');
  const res = await api.start({ ...target, pin });
  if (!res.ok && res.message) { toast(res.message); show('home'); }
}

$('form-manual').addEventListener('submit', (e) => {
  e.preventDefault();
  const { host, port } = parseHost($('in-host').value);
  if (!host) return;
  connect({ host, port, name: host }, $('in-pin').value.trim());
});

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
    show('home');
    api.getSettings().then((st) => { settings = st; renderRecent(); });
  } else if (s.state === 'error') {
    clearInterval(timerId);
    show('home');
    toast(s.message || 'Terjadi kesalahan.');
  }
});

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
    });
  };
  dlg.showModal();
});

// ---- boot -----------------------------------------------------------------
(async () => {
  settings = await api.getSettings();
  api.checkFfmpeg().then((ok) => { $('banner-ffmpeg').hidden = ok; });
  renderRecent();
  const { state } = await api.status();
  if (state !== 'idle' && state !== 'error') show('connecting'); else show('home');
  scan();
})();
