// Settings page: edits cameras.json through /api/config.
// Passwords are never sent to the browser; a camera's password is only sent
// back to the server when it was typed in here.

const $ = (sel, root = document) => root.querySelector(sel);
const pad = (n) => String(n).padStart(2, '0');

let cameras = []; // working copy; each has a client-only _key and _pwChanged
let ffmpeg = null;
let savedJson = '';
let keySeq = 0;
let share = []; // this PC's addresses for other devices, best first

const SYSTEM_FIELDS = ['port', 'overviewRefreshMs', 'ffmpegPath'];
const NUMBER_FIELDS = new Set(['fps', 'httpPort', 'rtspPort', 'jitterMs', 'jpegQuality']);
const BOOL_FIELDS = new Set(['lowDelay', 'fastStart', 'dropLate']);

// Live view delay (RTSP). Same defaults as the server; default values aren't stored.
const LATENCY_DEFAULTS = { lowDelay: true, fastStart: true, jitterMs: 200, pacing: 'arrival', jpegQuality: 5, dropLate: true };
const LATENCY_PRESETS = {
  lowest: { lowDelay: true, fastStart: true, jitterMs: 0, pacing: 'arrival', jpegQuality: 5, dropLate: true },
  balanced: LATENCY_DEFAULTS,
  smooth: { lowDelay: false, fastStart: false, jitterMs: 500, pacing: 'fixed', jpegQuality: 3, dropLate: false },
};
const latencyOf = (cam) => Object.fromEntries(Object.keys(LATENCY_DEFAULTS).map((k) => [k, cam[k] ?? LATENCY_DEFAULTS[k]]));
const samePreset = (a, b) => Object.keys(LATENCY_DEFAULTS).every((k) => String(a[k]) === String(b[k]));

async function load() {
  try {
    const data = await (await fetch('/api/config')).json();
    share = data.share ?? [];
    setState(data.config, data.ffmpeg);
    $('#config-path').textContent = `SETTINGS FILE: ${data.configFile}`;
  } catch {
    setMessage('Cannot reach the Monitor server', 'bad');
  }
}

function setState(config, ffmpegPath) {
  for (const f of SYSTEM_FIELDS) $('#' + f).value = config[f] ?? '';
  cameras = config.cameras.map((c) => ({ ...c, _key: ++keySeq, _pwChanged: false }));
  ffmpeg = ffmpegPath;
  renderFfmpeg();
  renderCameras();
  savedJson = JSON.stringify(payload());
  updateDirty();
}

// What gets sent to the server: the form, minus client-only fields and untouched passwords.
function payload() {
  const out = {};
  for (const f of SYSTEM_FIELDS) out[f] = $('#' + f).value.trim();
  out.cameras = cameras.map(cameraPayload);
  return out;
}

function cameraPayload(c) {
  const { _key, _pwChanged, hasPassword, ...rest } = c;
  if (!_pwChanged) delete rest.password;
  // Inputs give strings; normalise so "10" and 10 don't count as a change.
  for (const [k, v] of Object.entries(rest)) {
    if (k === 'password') continue;
    if (v === '' || v == null) delete rest[k];
    else if (NUMBER_FIELDS.has(k) && !Number.isNaN(Number(v))) rest[k] = Number(v);
    else if (BOOL_FIELDS.has(k)) rest[k] = v === true || v === 'true';
    else if (typeof v === 'string') rest[k] = v.trim();
    if (k in LATENCY_DEFAULTS && rest[k] === LATENCY_DEFAULTS[k]) delete rest[k];
  }
  return rest;
}

// --- Rendering --------------------------------------------------------------

function renderFfmpeg() {
  const el = $('#ffmpeg-status');
  if (ffmpeg) {
    el.className = 'ok';
    el.textContent = `FOUND: ${ffmpeg}`;
  } else {
    el.className = 'bad';
    el.textContent =
      'NOT FOUND. RTSP cameras fall back to snapshot mode. Install with "winget install Gyan.FFmpeg" (or put ffmpeg.exe next to Monitor.exe), then save to check again.';
  }
}

function renderCameras() {
  const list = $('#cam-list');
  list.replaceChildren();
  cameras.forEach((cam, i) => list.append(buildCard(cam, i)));
  $('#cam-count').textContent = `[${cameras.length}]`;
  if (!cameras.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'No cameras yet. Click ADD CAMERA.';
    list.append(empty);
  }
}

function buildCard(cam, index) {
  const card = $('#cam-tpl').content.firstElementChild.cloneNode(true);
  $('.cam-no', card).textContent = `CAM ${pad(index + 1)}`;
  const title = $('.cam-title', card);
  const web = $('[data-act="web"]', card);
  const refreshHead = () => {
    title.textContent = cam.name || 'UNNAMED';
    web.href = cam.host ? `http://${cam.host}:${cam.httpPort || 80}/` : '#';
  };
  refreshHead();

  for (const input of card.querySelectorAll('[data-f]')) {
    const f = input.dataset.f;
    if (f === 'password') {
      input.placeholder = cam.hasPassword ? '•••••• (unchanged)' : 'default: 123456';
    } else if (f === 'rtspTransport') {
      input.value = cam[f] ?? 'tcp';
    } else if (f === 'mode') {
      input.value = cam[f] ?? 'snapshot';
    } else if (input.dataset.default !== undefined) {
      input.value = String(cam[f] ?? input.dataset.default);
    } else {
      input.value = cam[f] ?? '';
    }
    input.addEventListener('input', () => {
      cam[f] = input.value;
      if (f === 'password') cam._pwChanged = true;
      if (f === 'name' || f === 'host' || f === 'httpPort') refreshHead();
      if (f in LATENCY_DEFAULTS) showPreset();
      updateDirty();
    });
  }

  // The preset menu fills in the delay options; it shows CUSTOM when they match no preset.
  const presetSel = $('[data-p="latency"]', card);
  const showPreset = () => {
    const now = latencyOf(cam);
    presetSel.value = Object.keys(LATENCY_PRESETS).find((p) => samePreset(now, LATENCY_PRESETS[p])) ?? 'custom';
  };
  presetSel.addEventListener('change', () => {
    const preset = LATENCY_PRESETS[presetSel.value];
    if (!preset) return;
    for (const [k, v] of Object.entries(preset)) {
      const input = $(`[data-f="${k}"]`, card);
      input.value = String(v);
      input.dispatchEvent(new Event('input'));
    }
  });
  showPreset();

  renderShare($('.share-url', card), cam);

  // The camera's own settings are read from the camera only when this section is opened.
  const cameraBox = $('.camera-box', card);
  cameraBox.addEventListener('toggle', () => cameraBox.open && loadCamera(cam, $('.camera-body', card)));

  // Open the connection section when it holds non-default values.
  if (cam.httpPort || cam.rtspPort || cam.snapshotUrl || cam.rtspUrl || cam.rtspTransport === 'udp' || !samePreset(latencyOf(cam), LATENCY_DEFAULTS)) {
    $('.conn-box', card).open = true;
  }

  card.addEventListener('click', async (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    const i = cameras.indexOf(cam);
    if (act === 'up' && i > 0) move(i, i - 1);
    else if (act === 'down' && i < cameras.length - 1) move(i, i + 1);
    else if (act === 'delete') {
      const ok = await Modal.confirm({
        title: 'REMOVE CAMERA',
        text: `Remove ${cam.name || 'this camera'} from Monitor? Nothing changes in the camera itself. Takes effect when you SAVE.`,
        ok: 'REMOVE',
        danger: true,
      });
      if (ok) {
        cameras.splice(i, 1);
        renderCameras();
        updateDirty();
      }
    } else if (act === 'web' && !cam.host) e.preventDefault();
    else if (act === 'test-snapshot') runTest(cam, card, 'snapshot', e.target.closest('.btn'));
    else if (act === 'test-rtsp') runTest(cam, card, 'rtsp', e.target.closest('.btn'));
  });
  return card;
}

// --- In the camera: day/night and video (ACTi URL commands) ---------------------

const DAY_NIGHT = {
  AUTO: 'Colour by day, black & white in the dark',
  DAY: 'Always colour',
  NIGHT: 'Always black & white (sharper in the dark)',
};

async function loadCamera(cam, body) {
  body.innerHTML = '<div class="loading"><span class="spinner"></span>READING FROM THE CAMERA…</div>';
  try {
    const res = await fetch('/api/camera-video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ camera: cameraPayload(cam) }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    body.innerHTML = '<div class="dn-part"></div><div class="video-part adv-only"></div>';
    renderDayNight(cam, $('.dn-part', body), data.dayNight);
    renderVideo(cam, $('.video-part', body), data);
  } catch (e) {
    body.innerHTML = '<p class="test-msg bad"></p>';
    body.firstChild.textContent = `Cannot read the camera's settings: ${e.message}. (Only ACTi cameras; check the IP address and login.)`;
  }
}

function renderDayNight(cam, el, mode) {
  if (!mode) {
    el.innerHTML = '<p class="video-hint">This camera has no day/night setting.</p>';
    return;
  }
  el.innerHTML = `
    <div class="dn-row">
      <span class="dn-label">DAY/NIGHT</span>
      <span class="bar-group" role="group" aria-label="Day/night">
        ${Object.keys(DAY_NIGHT).map((m) => `<button class="btn" type="button" data-dn="${m}" title="${DAY_NIGHT[m]}">${m}</button>`).join('')}
      </span>
      <span class="test-msg"></span>
    </div>`;
  const msg = $('.test-msg', el);
  const show = (m) => {
    el.querySelectorAll('[data-dn]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.dn === m)));
    setMsgEl(msg, DAY_NIGHT[m]);
  };
  show(mode);
  el.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-dn]');
    if (!btn || btn.getAttribute('aria-pressed') === 'true') return;
    btn.classList.add('busy');
    try {
      const res = await fetch('/api/camera-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ camera: cameraPayload(cam), dayNight: btn.dataset.dn }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      show(btn.dataset.dn);
      if (!data.saved) setMsgEl(msg, 'Applied, but this camera can\'t store it: back to before after a restart', 'warn');
    } catch (err) {
      setMsgEl(msg, `FAILED: ${err.message}`, 'bad');
    } finally {
      btn.classList.remove('busy');
    }
  });
}

// Frame rates the camera allows per resolution (ACTi megapixel models, NTSC).
const FPS_BY_RES = {
  N1280x1024: [1, 2, 4, 8],
  N1280x720: [1, 2, 5, 10],
  other: [1, 2, 3, 4, 5, 6, 7, 10, 15, 30],
};
const BITRATES = ['3M', '2.5M', '2M', '1.5M', '1.2M', '1M', '750K', '500K', '384K', '256K', '128K', '56K', '28K'];

// The best setting per encoder: full resolution at the camera's top frame rate.
const PRESETS = {
  MPEG4: {
    resolution: 'N1280x1024', fps: 8, bitrate: '3M',
    text: 'MPEG4 recommended: 1280x1024 at 8 fps (this camera\'s maximum at full size), 3 Mbps. Monitor shows it over RTSP: smooth, little network traffic. ' +
      'For more fluid motion pick 640x480 at 30 fps.',
  },
  MJPEG: {
    resolution: 'N1280x1024', fps: 8, mjpegQuality: 70,
    text: 'MJPEG recommended: 1280x1024 at 8 fps, quality 70. Every frame is a full JPEG: sharpest single frames and no ffmpeg needed, ' +
      'but about 2 MB/s of network traffic. Monitor shows it as snapshots.',
  },
};

const fpsFor = (res) => FPS_BY_RES[res] ?? FPS_BY_RES.other;
const resLabel = (r) => r.replace(/^N/, '');

function renderVideo(cam, body, v) {
  body.innerHTML = `
    <h4>VIDEO</h4>
    <p class="video-now"></p>
    <div class="fields">
      <label>ENCODER
        <select data-v="encoder">
          <option value="MPEG4">MPEG4 (smooth, low traffic, via RTSP)</option>
          <option value="MJPEG">MJPEG (sharpest frames, more traffic)</option>
        </select>
      </label>
      <label>RESOLUTION <select data-v="resolution"></select></label>
      <label>FRAME RATE <select data-v="fps"></select></label>
      <label data-only="MPEG4">BITRATE <select data-v="bitrate"></select><small>Higher = sharper</small></label>
      <label data-only="MJPEG">MJPEG QUALITY <input data-v="mjpegQuality" type="number" min="1" max="100"><small>1-100, higher = sharper (more traffic)</small></label>
    </div>
    <p class="video-hint"></p>
    <div class="test-row">
      <button class="btn" type="button" data-v-act="preset">USE RECOMMENDED</button>
      <button class="btn primary" type="button" data-v-act="apply">APPLY TO CAMERA</button>
      <span class="test-msg"></span>
    </div>`;
  const el = (k) => $(`[data-v="${k}"]`, body);
  const msg = $('.test-msg', body);
  $('.video-now', body).textContent =
    `NOW: ${v.encoder ?? '?'} · ${resLabel(v.resolution ?? '?')} · ${v.fps ?? '?'} FPS · ` +
    `${v.encoder === 'MJPEG' ? `QUALITY ${v.mjpegQuality}` : v.bitrate} · STREAMING: ${v.streamingName ?? v.streaming}` +
    (v.streaming === '0' ? ' (RTSP OFF: APPLY TURNS IT ON)' : '');

  const resolutions = v.resolutions.length ? v.resolutions : ['N1280x1024', 'N1280x720', 'N640x480', 'N320x240'];
  el('resolution').replaceChildren(...resolutions.map((r) => new Option(resLabel(r), r)));
  el('bitrate').replaceChildren(...BITRATES.map((b) => new Option(b.replace('M', ' Mbps').replace('K', ' kbps'), b)));

  const fillFps = (want) => {
    const list = fpsFor(el('resolution').value);
    el('fps').replaceChildren(...list.map((f) => new Option(`${f} fps`, f)));
    el('fps').value = list.includes(Number(want)) ? want : list.at(-1);
  };
  const showEncoder = () => {
    const encoder = el('encoder').value;
    for (const l of body.querySelectorAll('[data-only]')) l.hidden = l.dataset.only !== encoder;
    $('.video-hint', body).textContent = PRESETS[encoder].text;
  };
  const set = (s) => {
    if (s.resolution && resolutions.includes(s.resolution)) el('resolution').value = s.resolution;
    fillFps(s.fps);
    if (s.bitrate) el('bitrate').value = s.bitrate;
    if (s.mjpegQuality) el('mjpegQuality').value = s.mjpegQuality;
  };

  el('encoder').value = v.encoder === 'MJPEG' ? 'MJPEG' : 'MPEG4';
  set({ resolution: v.resolution, fps: v.fps, bitrate: v.bitrate, mjpegQuality: v.mjpegQuality ?? 50 });
  showEncoder();

  el('resolution').addEventListener('change', () => fillFps(el('fps').value));
  // Switching encoder starts from that encoder's recommended settings.
  el('encoder').addEventListener('change', () => {
    set(PRESETS[el('encoder').value]);
    showEncoder();
  });
  $('[data-v-act="preset"]', body).addEventListener('click', () => set(PRESETS[el('encoder').value]));
  $('[data-v-act="apply"]', body).addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    if (isDirty()) return setMsgEl(msg, 'Save your changes first (SAVE at the bottom)', 'bad');
    const apply = {
      encoder: el('encoder').value,
      resolution: el('resolution').value,
      fps: Number(el('fps').value),
      bitrate: el('bitrate').value,
      mjpegQuality: Number(el('mjpegQuality').value),
    };
    const ok = await Modal.confirm({
      title: 'CHANGE CAMERA VIDEO',
      text: `Set ${cam.name} to ${apply.encoder} ${resLabel(apply.resolution)} at ${apply.fps} fps?
The camera may restart (about a minute).`,
      ok: 'APPLY',
    });
    if (!ok) return;
    btn.classList.add('busy');
    setMsgEl(msg, 'APPLYING…');
    try {
      const res = await fetch('/api/camera-video', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ camera: cameraPayload(cam), apply }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      await load(); // Monitor's mode/fps for this camera changed too
      setMessage(
        `${cam.name}: ${apply.encoder} applied${data.rebooting ? ', camera restarting (about a minute)' : ''}. ` +
          `Monitor now uses ${apply.encoder === 'MPEG4' ? 'RTSP (UDP)' : 'snapshots'} at ${apply.fps} fps.`,
        'ok',
      );
    } catch (err) {
      setMsgEl(msg, `FAILED: ${err.message}`, 'bad');
      btn.classList.remove('busy');
    }
  });
}

function setMsgEl(el, text, kind = '') {
  el.textContent = text;
  el.className = `test-msg ${kind}`;
}

// "LIVE FROM OTHER PCs: http://192.168.50.44:8080/#live=1&cams=1 [COPY]". On another PC
// "localhost" means that PC, so the link uses this server's network address.
function renderShare(el, cam) {
  el.replaceChildren();
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  const base = local ? share.find((s) => !s.cameraNetwork)?.url ?? share[0]?.url : location.origin;
  if (!base) return;
  if (!cam.id) {
    el.textContent = 'LIVE FROM OTHER PCs: save first to get this camera\'s link';
    return;
  }
  const url = `${base}/#live=1&cams=${encodeURIComponent(cam.id)}`;
  const code = Object.assign(document.createElement('code'), { textContent: url });
  const btn = Object.assign(document.createElement('button'), { className: 'btn', type: 'button', textContent: 'COPY' });
  btn.addEventListener('click', () => copyText(url, btn));
  el.append('LIVE FROM OTHER PCs:', code, btn);
}

function copyText(text, btn) {
  const done = () => {
    btn.textContent = 'COPIED';
    setTimeout(() => (btn.textContent = 'COPY'), 1500);
  };
  // The clipboard API only works on localhost/https; other devices use the old way.
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).then(done, () => {});
  const ta = Object.assign(document.createElement('textarea'), { value: text });
  document.body.append(ta);
  ta.select();
  document.execCommand('copy');
  ta.remove();
  done();
}

function move(from, to) {
  const [cam] = cameras.splice(from, 1);
  cameras.splice(to, 0, cam);
  renderCameras();
  updateDirty();
}

function addCamera(preset = {}) {
  // Suggest the next address after the last camera's, e.g. .100 -> .101
  const last = cameras.at(-1)?.host ?? '';
  const m = last.match(/^(\d+\.\d+\.\d+\.)(\d+)$/);
  const host = preset.host || (m && Number(m[2]) < 254 ? m[1] + (Number(m[2]) + 1) : '192.168.0.100');
  cameras.push({
    _key: ++keySeq,
    _pwChanged: false,
    name: preset.name || `Camera ${cameras.length + 1}`,
    host,
    user: 'admin',
    mode: ffmpeg ? 'rtsp' : 'snapshot',
    fps: ffmpeg ? 10 : 5,
  });
  renderCameras();
  updateDirty();
  const cards = document.querySelectorAll('.cam-card');
  cards[cards.length - 1]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  $('[data-f="host"]', cards[cards.length - 1])?.select();
}

// --- Test / save ------------------------------------------------------------

async function runTest(cam, card, type, btn) {
  const msg = $('.test-msg', card);
  const frame = $('.test-frame', card);
  const img = $('img', frame);
  btn.classList.add('busy');
  msg.className = 'test-msg';
  msg.textContent = type === 'rtsp' ? 'CONNECTING TO RTSP STREAM…' : 'REQUESTING SNAPSHOT…';
  const t0 = performance.now();
  try {
    const res = await fetch(`/api/test?type=${type}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cameraPayload(cam)),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `HTTP ${res.status}`);
    const blob = await res.blob();
    if (img.src) URL.revokeObjectURL(img.src);
    img.src = URL.createObjectURL(blob);
    await img.decode().catch(() => {});
    frame.hidden = false;
    msg.className = 'test-msg ok';
    msg.textContent = `OK · ${img.naturalWidth}×${img.naturalHeight} · ${Math.round(performance.now() - t0)} MS`;
  } catch (e) {
    frame.hidden = true;
    msg.className = 'test-msg bad';
    msg.textContent = `FAILED: ${e.message}`;
  } finally {
    btn.classList.remove('busy');
  }
}

async function save() {
  const btn = $('#save');
  btn.disabled = true;
  btn.classList.add('busy');
  setMessage('SAVING…');
  try {
    const res = await fetch('/api/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload()),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    setState(data.config, data.ffmpeg);
    if (data.portChanged) {
      const url = `${location.protocol}//${location.hostname}:${data.port}/settings`;
      setMessage(`SAVED. MOVING TO PORT ${data.port}…`, 'ok');
      setTimeout(() => (location.href = url), 1500);
    } else {
      setMessage('SAVED', 'ok');
    }
  } catch (e) {
    setMessage(e.message, 'bad');
  } finally {
    btn.disabled = false;
    btn.classList.remove('busy');
  }
}

function setMessage(text, kind = '') {
  const el = $('#save-msg');
  el.textContent = text;
  el.className = 'save-msg ' + kind;
}

function isDirty() {
  return savedJson !== '' && JSON.stringify(payload()) !== savedJson;
}

function updateDirty() {
  const dirty = isDirty();
  document.body.classList.toggle('dirty', dirty);
  if (dirty) setMessage('UNSAVED CHANGES', 'warn');
  else if ($('#save-msg').textContent === 'UNSAVED CHANGES') setMessage('');
}

// --- Basic / advanced -----------------------------------------------------------

// BASIC: what you need to add a camera and see it. ADVANCED adds the system
// settings, stream mode, connection and live delay options, and the camera's video.
const LEVEL_NOTE = {
  basic: 'Name, address and login per camera, and day/night. ADVANCED shows everything.',
  advanced: 'Everything: also system settings, stream mode, connection, live delay and the camera\'s video.',
};
function setLevel(level) {
  document.body.classList.toggle('level-basic', level === 'basic');
  document.querySelectorAll('[data-level]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.level === level)));
  $('#level-note').textContent = LEVEL_NOTE[level];
  try {
    localStorage.setItem('monitor.setupLevel', level);
  } catch {}
}
document.querySelectorAll('[data-level]').forEach((b) => b.addEventListener('click', () => setLevel(b.dataset.level)));
let savedLevel = null;
try {
  savedLevel = localStorage.getItem('monitor.setupLevel');
} catch {}
setLevel(savedLevel === 'advanced' ? 'advanced' : 'basic');

// --- Events -----------------------------------------------------------------

for (const f of SYSTEM_FIELDS) $('#' + f).addEventListener('input', updateDirty);
$('#add').addEventListener('click', () => addCamera());
$('#save').addEventListener('click', save);
$('#revert').addEventListener('click', async () => {
  const ok = !isDirty() || (await Modal.confirm({ title: 'DISCARD CHANGES', text: 'Undo everything changed since the last SAVE?', ok: 'DISCARD', danger: true }));
  if (ok) load().then(() => setMessage(''));
});
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    save();
  }
});
window.addEventListener('beforeunload', (e) => {
  if (isDirty()) e.preventDefault();
});

function tickClock() {
  const d = new Date();
  $('#clock').textContent = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
setInterval(tickClock, 1000);
tickClock();

// The network page's ADD TO MONITOR links here with #add=<ip>&name=<model>.
load().then(() => {
  const hash = new URLSearchParams(location.hash.slice(1));
  if (!hash.has('add')) return;
  history.replaceState(null, '', location.pathname);
  addCamera({ host: hash.get('add'), name: hash.get('name') });
  setMessage('CAMERA ADDED. CHECK THE LOGIN, THEN SAVE.', 'warn');
});
