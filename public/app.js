// Overview: each tile refreshes a JPEG snapshot on a timer. Snapshots are short
// requests, so the browser's ~6-connections-per-host limit is never an issue,
// however many cameras there are.
// Live (#live=4&cams=1,4,8,9): 1, 4, 6, 8 or 9 spots, each showing the camera
// picked for it. All of them come in over one connection (/api/multistream),
// so the connection limit doesn't apply there either.

const $ = (sel) => document.querySelector(sel);
const overviewEl = $('#overview');
const liveEl = $('#live');
const liveGrid = $('#live-grid');

let cameras = [];
let refreshMs = 1000;
let share = []; // [{ url, ip, iface, cameraNetwork }] from the server, best first
const tiles = new Map(); // id -> { el, img, msg, dot, state, time, timer, loading, online }

const api = (id, what = '') => `/api/cameras/${encodeURIComponent(id)}${what ? '/' + what : ''}`;
const pad = (n) => String(n).padStart(2, '0');
// DVR-style timestamp: 2026-10-05 14:32:07
const fmtStamp = (t = Date.now()) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};
const camById = (id) => cameras.find((c) => c.id === id);
const camIndex = (id) => cameras.findIndex((c) => c.id === id) + 1;
const camNo = (id) => `CAM ${pad(camIndex(id))}`;
// The name next to "CAM 01", left out when it is just the default "Camera 1".
const osdName = (cam) => {
  const m = cam.name.trim().match(/^camera\s*(\d+)$/i);
  return m && Number(m[1]) === camIndex(cam.id) ? '' : cam.name;
};
const store = {
  get(k) {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, v);
    } catch {}
  },
};

// Fills a centred overlay with a boxed title and an optional detail line.
function setMessage(el, title, detail = '', spinner = false) {
  el.replaceChildren();
  if (!title) return;
  if (spinner) el.append(Object.assign(document.createElement('span'), { className: 'spinner big' }));
  const strong = document.createElement('strong');
  strong.textContent = title;
  el.append(strong);
  if (detail) {
    const small = document.createElement('small');
    small.textContent = detail;
    el.append(small);
  }
}

async function init() {
  try {
    const data = await (await fetch('/api/cameras')).json();
    cameras = data.cameras;
    refreshMs = data.overviewRefreshMs ?? 1000;
    share = data.share ?? [];
    overviewEl.replaceChildren();
    renderTopbarShare();
  } catch {
    overviewEl.innerHTML = '<div class="empty">Cannot reach the viewer server</div>';
    return;
  }

  if (!cameras.length) {
    overviewEl.innerHTML = '<div class="empty">No cameras yet. Add them under SETUP</div>';
    return;
  }

  for (const cam of cameras) buildTile(cam);
  $('#cam-pick').replaceChildren(
    new Option('— NO CAMERA —', ''),
    ...cameras.map((c) => new Option([camNo(c.id), osdName(c)].filter(Boolean).join(' · '), c.id)),
  );
  updateSummary();
  route();
}

// --- Overview -------------------------------------------------------------

const overviewVisible = () => !liveOpen && !document.hidden;

function buildTile(cam) {
  const el = $('#tile-tpl').content.firstElementChild.cloneNode(true);
  const tile = {
    el,
    img: el.querySelector('img'),
    msg: el.querySelector('.tile-msg'),
    dot: el.querySelector('.dot'),
    state: el.querySelector('.tile-state'),
    time: el.querySelector('.tile-time'),
    timer: null,
    loading: false,
    online: null,
  };
  el.querySelector('.cam-no').textContent = camNo(cam.id);
  el.querySelector('.tile-name').textContent = osdName(cam);
  setMessage(tile.msg, 'CONNECTING', '', true); // until the first image arrives
  el.title = `${cam.name}: open live`;
  el.addEventListener('click', () => (location.hash = liveHash(1, [cam.id])));
  overviewEl.append(el);
  tiles.set(cam.id, tile);
}

function setTileState(tile, online, reason = '') {
  tile.online = online;
  tile.el.classList.toggle('offline', !online);
  tile.dot.className = 'dot ' + (online ? 'ok' : 'bad');
  tile.state.textContent = online ? 'LIVE' : 'NO SIGNAL';
  setMessage(tile.msg, online ? '' : 'NO SIGNAL', reason);
  updateSummary();
}

function refreshTile(id) {
  const tile = tiles.get(id);
  clearTimeout(tile.timer);
  if (!overviewVisible() || tile.loading) return;
  tile.loading = true;

  // Load into an off-screen image first so the tile never flashes blank.
  const next = new Image();
  next.onload = () => {
    tile.loading = false;
    tile.img.src = next.src;
    tile.time.textContent = fmtStamp();
    setTileState(tile, true);
    tile.timer = setTimeout(() => refreshTile(id), refreshMs);
  };
  next.onerror = async () => {
    tile.loading = false;
    let reason = '';
    try {
      const s = await (await fetch(api(id))).json();
      if (s.lastError) reason = s.lastError;
    } catch {}
    setTileState(tile, false, reason);
    tile.timer = setTimeout(() => refreshTile(id), Math.max(refreshMs, 5000)); // back off
  };
  next.src = `${api(id, 'snapshot')}?t=${Date.now()}`;
}

function startOverview() {
  for (const id of tiles.keys()) refreshTile(id);
}

function stopOverview() {
  for (const t of tiles.values()) clearTimeout(t.timer);
}

function updateSummary() {
  const vals = [...tiles.values()];
  const online = vals.filter((t) => t.online).length;
  $('#summary').textContent = `CH ONLINE ${online}/${vals.length}`;
}

// --- Live: layout and which camera goes where -------------------------------

const LIVE_SIZES = [1, 4, 6, 8, 9];
let liveOpen = false;
let liveSize = 1;
let slots = []; // camera id per spot, null = empty
let selected = 0; // the spot that PREV/NEXT, the camera menu and SNAPSHOT act on
let lastMultiSize = null; // the multi-camera layout to go back to from 1 camera

// #live=4&cams=1,4,8,9 (an empty spot is an empty entry: cams=1,,8,9)
const liveHash = (size, ids) => `live=${size}&cams=${ids.map((id) => (id === null ? '' : encodeURIComponent(id))).join(',')}`;

function parseLiveHash(hash) {
  // #cam=1 is the old address of a single camera; it still works.
  const old = hash.match(/^#cam=(.+)$/);
  if (old) return { size: 1, ids: [decodeURIComponent(old[1])] };
  const m = hash.match(/^#live(?:=(\d+))?(?:&cams=([^&]*))?/);
  if (!m) return null;
  const size = LIVE_SIZES.includes(Number(m[1])) ? Number(m[1]) : Number(store.get('monitor.liveSize')) || 4;
  const ids = m[2] === undefined ? null : m[2].split(',').map((s) => (s ? decodeURIComponent(s) : null));
  return { size: LIVE_SIZES.includes(size) ? size : 4, ids };
}

// The cameras for a layout: as given, else as last used for that layout, else in order.
function slotsFor(size, ids) {
  let list = ids;
  if (!list) {
    try {
      list = JSON.parse(store.get(`monitor.live.${size}`) || 'null');
    } catch {}
  }
  if (!Array.isArray(list)) list = cameras.slice(0, size).map((c) => c.id);
  return Array.from({ length: size }, (_, i) => (list[i] != null && camById(String(list[i])) ? String(list[i]) : null));
}

function openLive({ size, ids }) {
  if (!cameras.length) return (location.hash = '');
  const wasOpen = liveOpen;
  const next = slotsFor(size, ids);
  if (!wasOpen) lastMultiSize = null; // one camera opened from the overview: Esc goes back there
  if (size > 1) lastMultiSize = size;
  // Keep the selected spot on the same camera where possible (e.g. 1 -> 4).
  const keepId = slots[selected] ?? null;
  liveSize = size;
  slots = next;
  selected = Math.max(0, Math.min(size - 1, keepId !== null && slots.includes(keepId) ? slots.indexOf(keepId) : wasOpen ? selected : 0));
  if (size > 1) store.set('monitor.liveSize', String(size)); // LIVE in the menu reopens the last multi-camera layout
  store.set(`monitor.live.${size}`, JSON.stringify(slots));
  // The address always says exactly what is shown, so LINK and bookmarks reproduce it.
  const canonical = '#' + liveHash(size, slots);
  if (location.hash !== canonical) history.replaceState(null, '', canonical);

  if (!wasOpen) {
    liveOpen = true;
    stopOverview();
    liveEl.hidden = false;
    document.body.style.overflow = 'hidden';
    setControls(false); // controls start hidden, with a hint how to show them
  }
  renderLive();
}

function closeLive() {
  if (!liveOpen) return;
  liveOpen = false;
  stopStream();
  for (const c of cells) c.url && URL.revokeObjectURL(c.url);
  cells = [];
  streamKey = '';
  liveGrid.replaceChildren();
  toggleShare(false);
  liveEl.hidden = true;
  document.body.style.overflow = '';
  document.title = 'Monitor';
  if (document.fullscreenElement) document.exitFullscreen();
}

// Changes what's shown without a new history entry for every camera switch.
// ids null: the cameras last used in that layout.
function setLive(size, ids, push = false) {
  const hash = ids ? '#' + liveHash(size, ids) : `#live=${size}`;
  if (push) location.hash = hash;
  else {
    history.replaceState(null, '', hash);
    route();
  }
}

function setSlot(i, id) {
  const ids = [...slots];
  ids[i] = id;
  selected = i;
  setLive(liveSize, ids);
}

function stepCamera(delta) {
  if (!cameras.length) return;
  const cur = cameras.findIndex((c) => c.id === slots[selected]);
  const i = cur === -1 ? (delta > 0 ? 0 : cameras.length - 1) : (cur + delta + cameras.length) % cameras.length;
  setSlot(selected, cameras[i].id);
}

function select(i) {
  selected = i;
  cells.forEach((c, j) => c.el.classList.toggle('selected', j === i));
  updateBar();
}

// One camera big, or back to the multi-camera layout it came from.
function zoom(i) {
  if (liveSize > 1) {
    if (slots[i] !== null) setLive(1, [slots[i]], true);
  } else if (lastMultiSize) setLive(lastMultiSize, null, true);
  else toggleFullscreen();
}

// --- Live: the spots ----------------------------------------------------------

let cells = []; // per spot: { id, el, img, msg, dot, state, mode, url, busy, next, lastAt, online }

function renderLive() {
  // Reuse spots that keep their camera, so switching one spot doesn't blank the others.
  const old = new Map(cells.map((c) => [c.id, c]));
  cells = slots.map((id) => {
    const reuse = id !== null && old.get(id);
    if (reuse) old.delete(id);
    return reuse || buildCell(id);
  });
  for (const c of old.values()) if (c.url) URL.revokeObjectURL(c.url);
  liveGrid.replaceChildren(...cells.map((c) => c.el));
  liveGrid.classList.toggle('single', liveSize === 1);
  cells.forEach((c, i) => {
    c.el.dataset.slot = String(i);
    c.el.classList.toggle('selected', i === selected);
  });
  layoutLive();

  liveEl.querySelectorAll('[data-size]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.size) === liveSize)));
  $('#bar-keys').textContent =
    liveSize > 1
      ? '[1][4][6][8][9] LAYOUT · [↑][↓] SPOT · [←][→] CAMERA · DOUBLE-CLICK: ONE CAMERA · [Z] FILL · [F] FULL · [C] HIDE · [ESC] EXIT'
      : '[1][4][6][8][9] LAYOUT · [←][→] CAMERA · [Z] FILL · [F] FULL · [L] LINK · [C] HIDE · [ESC] BACK';
  const named = slots.filter(Boolean).map((id) => [camNo(id), osdName(camById(id))].filter(Boolean).join(' '));
  document.title = `${liveSize === 1 ? named[0] ?? 'Live' : `Live ${liveSize}`} · Monitor`;
  updateBar();
  if (!$('#share-pop').hidden) renderSharePop();
  startStream();
}

function buildCell(id) {
  const el = $('#live-cell-tpl').content.firstElementChild.cloneNode(true);
  const cell = {
    id,
    el,
    img: el.querySelector('img'),
    msg: el.querySelector('.tile-msg'),
    dot: el.querySelector('.dot'),
    state: el.querySelector('.tile-state'),
    mode: el.querySelector('.mode-tag'),
    url: null,
    busy: false,
    next: null,
    lastAt: 0,
    online: null,
  };
  const slotOf = () => Number(el.dataset.slot);
  // Click/tap: select this spot (and show the controls); on the selected spot a tap
  // shows/hides the controls. Double-click/double tap: this camera alone, or back.
  let pointer = 'mouse';
  el.addEventListener('pointerdown', (e) => (pointer = e.pointerType));
  el.addEventListener('click', () => {
    if (slotOf() !== selected) {
      select(slotOf());
      setControls(true);
    } else if (pointer !== 'mouse') setControls(controlsHidden());
  });
  el.addEventListener('dblclick', () => zoom(slotOf()));

  if (id === null) {
    el.classList.add('empty-cell');
    el.querySelector('.osd-bl').hidden = true;
    setMessage(cell.msg, 'NO CAMERA', 'Pick one in the menu below');
    return cell;
  }
  const cam = camById(id);
  el.querySelector('.cam-no').textContent = camNo(id);
  el.querySelector('.tile-name').textContent = osdName(cam);
  el.querySelector('.live-time').textContent = fmtStamp();
  setCellState(cell, null);
  return cell;
}

// online: true = receiving video, false = no signal, null = connecting
function setCellState(cell, online, reason = '') {
  cell.online = online;
  cell.el.classList.toggle('offline', online === false);
  cell.dot.className = 'dot' + (online === true ? ' ok' : online === false ? ' bad' : '');
  cell.state.textContent = online === true ? 'LIVE' : online === false ? 'NO SIGNAL' : 'CONNECTING';
  if (online === true) setMessage(cell.msg, '');
  else if (online === false) setMessage(cell.msg, 'NO SIGNAL', reason);
  else setMessage(cell.msg, 'CONNECTING', '', true);
}

// Columns x rows that divide the screen into equal spots and give each picture
// the most room: 8 is 4x2 on a monitor, 2x4 on a phone held upright.
let liveAspect = 4 / 3; // of the camera pictures, updated from the first frame
function layoutLive() {
  if (!liveOpen) return;
  const w = liveGrid.clientWidth;
  const h = liveGrid.clientHeight;
  const n = liveSize;
  let best = null;
  for (let cols = 1; cols <= n; cols++) {
    if (n % cols) continue; // no gaps (so 8 is never 3x3)
    const rows = n / cols;
    const pw = Math.min(w / cols, (h / rows) * liveAspect); // picture width without cropping
    if (!best || pw > best.pw) best = { cols, rows, pw };
  }
  liveGrid.style.gridTemplateColumns = `repeat(${best.cols}, minmax(0, 1fr))`;
  liveGrid.style.gridTemplateRows = `repeat(${best.rows}, minmax(0, 1fr))`;
}

// The bar's camera menu, arrows and SNAPSHOT follow the selected spot.
function updateBar() {
  const id = slots[selected] ?? null;
  const pick = $('#cam-pick');
  pick.value = id ?? '';
  pick.options[0].hidden = liveSize === 1; // one camera: always a camera
  const save = $('#save');
  save.classList.toggle('disabled', id === null);
  if (id === null) save.removeAttribute('href');
  else {
    save.href = api(id, 'snapshot');
    save.download = `${camById(id).name.replace(/[^\w-]+/g, '_')}_${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`;
  }
}

// --- Live: video ----------------------------------------------------------------

let streamKey = ''; // the cameras the open stream carries
let streamToken = 0;
let streamAbort = null;
let statusTimer = null;
let lastAnyFrameAt = 0;

function showFrame(cell, bytes) {
  // Still decoding the previous frame (slow phone): keep only the newest one.
  if (cell.busy) return (cell.next = bytes);
  cell.busy = true;
  const url = URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' }));
  cell.img.onload = cell.img.onerror = () => {
    if (cell.url) URL.revokeObjectURL(cell.url);
    cell.url = url;
    cell.busy = false;
    if (cell.img.naturalWidth) {
      cell.lastAt = Date.now();
      if (cell.online !== true) setCellState(cell, true);
      const aspect = cell.img.naturalWidth / cell.img.naturalHeight;
      if (Math.abs(aspect - liveAspect) > 0.05) {
        liveAspect = aspect;
        layoutLive();
      }
    }
    if (cell.next) {
      const next = cell.next;
      cell.next = null;
      showFrame(cell, next);
    }
  };
  cell.img.src = url;
}

// Reads /api/multistream: multipart parts, each with X-Camera and Content-Length.
async function readMultiStream(url, signal, onFrame) {
  const res = await fetch(url, { signal, cache: 'no-store' });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const reader = res.body.getReader();
  const text = new TextDecoder();
  let buf = new Uint8Array(0);
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    const joined = new Uint8Array(buf.length + value.length);
    joined.set(buf);
    joined.set(value, buf.length);
    buf = joined;
    for (;;) {
      const headEnd = indexOfCrlf2(buf);
      if (headEnd === -1) break;
      const head = text.decode(buf.subarray(0, headEnd));
      const start = headEnd + 4;
      const len = Number(head.match(/content-length:\s*(\d+)/i)?.[1]);
      if (!Number.isFinite(len)) {
        buf = buf.slice(start); // not a frame header; skip it
        continue;
      }
      if (buf.length < start + len) break;
      const id = decodeURIComponent(head.match(/x-camera:\s*(\S+)/i)?.[1] ?? '');
      onFrame(id, buf.slice(start, start + len));
      buf = buf.slice(start + len);
    }
  }
}

function indexOfCrlf2(b) {
  for (let i = 0; i + 3 < b.length; i++) {
    if (b[i] === 13 && b[i + 1] === 10 && b[i + 2] === 13 && b[i + 3] === 10) return i;
  }
  return -1;
}

// One stream for all cameras on screen; only reopened when that set changes.
async function startStream(force = false) {
  const ids = [...new Set(slots.filter((id) => id !== null))];
  const key = ids.join('\n');
  clearInterval(statusTimer);
  statusTimer = setInterval(checkStatus, 3000);
  if (!force && key === streamKey && streamAbort) return;
  stopStream();
  streamKey = key;
  if (!ids.length) return;
  const token = ++streamToken;
  const url = `/api/multistream?${ids.map((id) => `id=${encodeURIComponent(id)}`).join('&')}`;
  lastAnyFrameAt = Date.now();
  // The server ends the stream when settings are saved; then (or on any error) reconnect.
  while (token === streamToken) {
    streamAbort = new AbortController();
    try {
      await readMultiStream(url, streamAbort.signal, (id, bytes) => {
        if (token !== streamToken) return;
        lastAnyFrameAt = Date.now();
        for (const cell of cells) if (cell.id === id) showFrame(cell, bytes);
      });
    } catch {}
    if (token !== streamToken) return;
    await new Promise((r) => setTimeout(r, 2000));
  }
}

function stopStream() {
  streamToken++;
  streamAbort?.abort();
  streamAbort = null;
  streamKey = '';
  clearInterval(statusTimer);
}

async function checkStatus() {
  let data = null;
  try {
    data = await (await fetch('/api/cameras')).json();
  } catch {}
  if (!liveOpen) return;
  for (const cell of cells) {
    if (cell.id === null) continue;
    const s = data?.cameras.find((c) => c.id === cell.id);
    if (s) cell.mode.textContent = s.activeMode === 'rtsp' ? 'RTSP' : s.fallback ? `SNAPSHOT (${s.fallbackReason})` : 'SNAPSHOT';
    if (cell.lastAt && Date.now() - cell.lastAt < 6000) setCellState(cell, true);
    else if (!data) setCellState(cell, false, 'Lost connection to the viewer server');
    else if (cell.lastAt || s?.lastError) setCellState(cell, false, s?.lastError || 'Waiting for video');
  }
  // Our own connection can also die silently (server restarted): open a fresh one.
  if (streamAbort && Date.now() - lastAnyFrameAt > 10_000) {
    lastAnyFrameAt = Date.now();
    streamAbort.abort();
  }
}

// --- Links for other devices -------------------------------------------------

// On another PC "localhost" means that PC, so links always use this server's network address.
function baseUrl() {
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  return local ? share[0]?.url ?? null : location.origin;
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

function shareRow(el, label, url) {
  el.replaceChildren();
  if (!url) return;
  const code = Object.assign(document.createElement('code'), { textContent: url });
  const btn = Object.assign(document.createElement('button'), { className: 'btn', type: 'button', textContent: 'COPY' });
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    copyText(url, btn);
  });
  if (label) el.append(label);
  el.append(code, btn);
}

function renderTopbarShare() {
  shareRow($('#topbar-share'), 'OTHER PCs:', baseUrl());
}

function renderSharePop() {
  const url = baseUrl();
  shareRow($('#share-main'), '', url ? `${url}/#${liveHash(liveSize, slots)}` : null);
  const others = share.filter((s) => s.url !== url && !s.cameraNetwork).map((s) => s.url);
  $('#share-note').textContent = url
    ? 'Works on any PC or phone connected to the same router/Wi-Fi, while Monitor runs on this PC. ' +
      (others.length ? `Other addresses of this PC: ${others.join(', ')}. ` : '') +
      'Doesn\'t load? Allow Monitor through Windows Firewall on this PC (Private networks).'
    : 'This PC has no network address, so other devices cannot reach it.';
}

function toggleShare(force) {
  const pop = $('#share-pop');
  pop.hidden = force === undefined ? !pop.hidden : !force;
  if (!pop.hidden) renderSharePop();
}

// --- Controls, fullscreen, fill -------------------------------------------------

let hintTimer = null;
function setControls(visible) {
  liveEl.classList.toggle('controls-hidden', !visible);
  if (!visible) toggleShare(false);
  const hint = $('#controls-hint');
  clearTimeout(hintTimer);
  hint.classList.toggle('show', !visible);
  if (!visible) hintTimer = setTimeout(() => hint.classList.remove('show'), 2500);
}
const controlsHidden = () => liveEl.classList.contains('controls-hidden');

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else liveEl.requestFullscreen?.(); // the whole view, so the controls still work in fullscreen
}

// FILL: the video covers its whole spot (edges cropped) instead of showing black
// bars. Handy on phones, where the picture's shape rarely matches the screen.
function setFill(on) {
  document.body.classList.toggle('fill', on);
  $('#fill').setAttribute('aria-pressed', String(on));
  store.set('monitor.fill', on ? '1' : '0');
}
const toggleFill = () => setFill(!document.body.classList.contains('fill'));

// --- Routing & events -----------------------------------------------------

function route() {
  const live = parseLiveHash(location.hash);
  if (live) return openLive(live);
  closeLive();
  startOverview();
}

// Esc: from one camera back to the layout it came from, otherwise to the overview.
function back() {
  if (liveSize === 1 && lastMultiSize) setLive(lastMultiSize, null, true);
  else location.hash = '';
}

window.addEventListener('hashchange', route);
window.addEventListener('resize', layoutLive);
liveEl.querySelectorAll('[data-size]').forEach((b) =>
  b.addEventListener('click', () => setLive(Number(b.dataset.size), null, true)),
);
$('#cam-prev').addEventListener('click', () => stepCamera(-1));
$('#cam-next').addEventListener('click', () => stepCamera(1));
$('#cam-pick').addEventListener('change', (e) => setSlot(selected, e.target.value || null));
$('#save').addEventListener('click', (e) => slots[selected] == null && e.preventDefault());
$('#share').addEventListener('click', () => toggleShare());
$('#fill').addEventListener('click', toggleFill);
$('#fullscreen').addEventListener('click', toggleFullscreen);
setFill(store.get('monitor.fill') === '1');
if (matchMedia('(hover: none)').matches) $('#controls-hint').textContent = 'TAP FOR CONTROLS';

document.addEventListener('keydown', (e) => {
  if (!liveOpen || e.ctrlKey || e.altKey || e.metaKey || e.target.tagName === 'SELECT') return;
  const key = e.key.toLowerCase();
  if (e.key === 'Escape' && !document.fullscreenElement) back();
  else if (LIVE_SIZES.includes(Number(e.key))) setLive(Number(e.key), null, true);
  else if (e.key === 'ArrowLeft') stepCamera(-1);
  else if (e.key === 'ArrowRight') stepCamera(1);
  else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault();
    select((selected + (e.key === 'ArrowDown' ? 1 : liveSize - 1)) % liveSize);
    setControls(true);
  } else if (key === 'f') toggleFullscreen();
  else if (key === 'z') toggleFill();
  else if (key === 'l') {
    setControls(true);
    toggleShare();
  } else if (key === 'c') setControls(controlsHidden());
});

// A hidden tab (phone locked, other tab) gets no video, to save data and battery.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopOverview();
    if (liveOpen) stopStream();
  } else if (liveOpen) startStream(true);
  else startOverview();
});

function tickClock() {
  const now = fmtStamp();
  $('#clock').textContent = now;
  if (liveOpen) liveGrid.querySelectorAll('.live-time').forEach((el) => (el.textContent = now));
}
setInterval(tickClock, 1000);
tickClock();

init();
