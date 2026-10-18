// Network page: finds cameras, changes a camera's IP address, and adds an
// extra address to one of this PC's adapters so it can reach a camera in
// another IP range.

const $ = (sel, root = document) => root.querySelector(sel);
const pad = (n) => String(n).padStart(2, '0');

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const ipToInt = (ip) => ip.split('.').reduce((n, o) => n * 256 + Number(o), 0) >>> 0;
const sameSubnet = (a, b, prefix) => prefix === 0 || ipToInt(a) >>> (32 - prefix) === ipToInt(b) >>> (32 - prefix);
const base24 = (ip) => ip.split('.').slice(0, 3).join('.');
const intToIp = (n) => [24, 16, 8, 0].map((s) => (n >>> s) & 255).join('.');
const maskOf = (p) => intToIp((0xffffffff << (32 - p)) >>> 0);

// Prefix dropdown: the prefix is how many bits of the address name the network.
// Devices only reach each other directly when that part of their address matches.
const PREFIXES = [
  [24, 'home networks'],
  [23], [22], [21], [20], [16, 'large networks'], [8], [25], [26], [27], [28], [29], [30],
];

function fillPrefixSelect(sel, value = 24) {
  sel.replaceChildren(
    ...PREFIXES.map(([p, note]) => {
      const hosts = 2 ** (32 - p) - 2;
      return new Option(`/${p} · ${maskOf(p)} · ${hosts.toLocaleString('en')} addresses${note ? ` (${note})` : ''}`, p);
    }),
  );
  setPrefix(sel, value);
}

function setPrefix(sel, value) {
  if (![...sel.options].some((o) => Number(o.value) === Number(value))) {
    sel.append(new Option(`/${value} · ${maskOf(value)} · ${(2 ** (32 - value) - 2).toLocaleString('en')} addresses`, value));
  }
  sel.value = value;
}

// "Same network: 192.168.0.1 to 192.168.0.254" for an address and prefix.
function rangeText(ip, prefix) {
  if (!IPV4.test(ip)) return 'Enter an IP address to see its range.';
  const mask = (0xffffffff << (32 - prefix)) >>> 0;
  const base = (ipToInt(ip) & mask) >>> 0;
  const first = intToIp(base + 1);
  const last = intToIp(((base | ~mask) >>> 0) - 1);
  return `Same network: ${first} to ${last}. Other devices must have an address in this range (and the same mask) to reach it.`;
}

function bindRangeHint(ipInput, sel, hint) {
  const update = () => (hint.textContent = rangeText(ipInput.value.trim(), Number(sel.value)));
  ipInput.addEventListener('input', update);
  sel.addEventListener('change', update);
  return update;
}

let net = { local: false, canChangePc: false, adapters: [], ipUtility: false };
let devices = [];

async function api(url, body) {
  const res = await fetch(url, body === undefined ? {} : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function setMsg(el, text, kind = '') {
  el.textContent = text;
  el.className = `test-msg ${kind}`;
}

// --- This PC ----------------------------------------------------------------

const isWifi = (a) => /wi-?fi|wireless|wlan/i.test(`${a.name} ${a.description ?? ''}`);
const usableAddrs = (a) => a.addresses.filter((x) => !x.ip.startsWith('169.254.'));

// The adapter that leads to the router (home network).
function homeAdapter() {
  const up = net.adapters.filter((a) => a.status === 'Up');
  return up.find((a) => a.gateways?.length && usableAddrs(a).length) ?? up.find((a) => usableAddrs(a).length) ?? null;
}

function homeNetwork() {
  const a = homeAdapter();
  if (!a) return null;
  const addr = usableAddrs(a).find((x) => x.origin === 'Dhcp') ?? usableAddrs(a)[0];
  return { ...addr, gateway: a.gateways?.[0] ?? '' };
}

function pcReaches(ip) {
  return net.adapters.some((a) => a.status === 'Up' && a.addresses.some((x) => sameSubnet(ip, x.ip, x.prefix)));
}

async function loadNetwork() {
  try {
    net = await api('/api/network');
  } catch (e) {
    setMsg($('#pc-note'), `Cannot read this PC's network settings: ${e.message}`, 'bad');
    return;
  }
  renderAdapters();
  $('#ipu-panel').hidden = !net.ipUtility;
}

function renderAdapters() {
  const note = $('#pc-note');
  if (net.canChangePc) {
    note.textContent = 'Changes ask for Windows administrator permission on this PC.';
  } else if (!net.local) {
    note.textContent = 'Read-only here: change the server PC\'s addresses on that PC itself (Windows asks for permission there).';
  } else {
    note.textContent = 'Changing addresses from Monitor is only supported on Windows.';
  }
  $('#reach').hidden = !net.canChangePc;

  const list = $('#adapters');
  list.replaceChildren(...net.adapters.map(buildAdapter));
  if (!net.adapters.length) list.textContent = 'No network adapters found.';

  // Adapter choice for "reach a camera": wired first (cameras usually hang on a cable or switch).
  const sel = $('#reach-adapter');
  const prev = sel.value;
  const options = net.adapters.filter((a) => a.index);
  sel.replaceChildren(
    ...options.map((a) => new Option(`${a.name}${a.status === 'Up' ? '' : ' (not connected)'}`, a.index)),
  );
  const pick = options.find((a) => String(a.index) === prev) ??
    options.find((a) => a.status === 'Up' && !isWifi(a)) ?? options.find((a) => a.status === 'Up') ?? options[0];
  if (pick) sel.value = pick.index;
  suggestReachIp();
}

function buildAdapter(a, i) {
  const card = $('#adapter-tpl').content.firstElementChild.cloneNode(true);
  $('.cam-no', card).textContent = `NIC ${pad(i + 1)}`;
  const mode = a.dhcp === null ? '' : a.dhcp ? ' · AUTOMATIC (DHCP)' : ' · FIXED ADDRESS';
  $('.cam-title', card).textContent = `${a.name} · ${a.status === 'Up' ? 'CONNECTED' : 'NOT CONNECTED'}${mode}`;
  if (a.status !== 'Up') $('.cam-title', card).classList.add('muted');

  const dhcpBtn = $('[data-act="dhcp"]', card);
  dhcpBtn.hidden = !net.canChangePc || a.dhcp !== false;
  dhcpBtn.addEventListener('click', async () => {
    const ok = await Modal.confirm({
      title: 'BACK TO AUTOMATIC',
      text: `Set ${a.name} back to automatic (DHCP)? Its fixed addresses are removed, so cameras only reachable through them disappear.`,
      ok: 'SET TO AUTOMATIC',
      danger: true,
    });
    if (ok) pcAction({ action: 'dhcp', index: a.index }, dhcpBtn);
  });

  const rows = $('.addr-list', card);
  for (const x of a.addresses) {
    const row = document.createElement('div');
    row.className = 'addr-row';
    const label = { Dhcp: 'FROM ROUTER', Manual: 'FIXED', WellKnown: 'NO ROUTER FOUND (AUTO)' }[x.origin] ?? '';
    row.innerHTML = '<span class="addr"></span><span class="muted"></span>';
    row.firstChild.textContent = `${x.ip}/${x.prefix}`;
    row.lastChild.textContent = label;
    if (net.canChangePc && x.origin === 'Manual') {
      const rm = document.createElement('button');
      rm.className = 'btn danger small';
      rm.type = 'button';
      rm.textContent = 'REMOVE';
      rm.addEventListener('click', async () => {
        const ok = await Modal.confirm({ title: 'REMOVE ADDRESS', text: `Remove ${x.ip} from ${a.name}?`, ok: 'REMOVE', danger: true });
        if (ok) pcAction({ action: 'remove', index: a.index, ip: x.ip }, rm);
      });
      row.append(rm);
    }
    rows.append(row);
  }
  if (!a.addresses.length) rows.innerHTML = '<div class="addr-row muted">NO IPv4 ADDRESS</div>';
  if (a.gateways?.length) {
    const gw = document.createElement('div');
    gw.className = 'addr-row muted';
    gw.textContent = `ROUTER (GATEWAY) ${a.gateways.join(', ')}`;
    rows.append(gw);
  }
  return card;
}

async function pcAction(body, btn, msgEl = $('#reach-msg')) {
  btn.disabled = true;
  btn.classList.add('busy');
  setMsg(msgEl, 'WAITING FOR WINDOWS PERMISSION ON THIS PC…', 'warn');
  try {
    const data = await api('/api/network/pc', body);
    net.adapters = data.adapters;
    renderAdapters();
    renderDevices();
    setMsg(msgEl, 'DONE', 'ok');
    return true;
  } catch (e) {
    setMsg(msgEl, `FAILED: ${e.message}`, 'bad');
    return false;
  } finally {
    btn.disabled = false;
    btn.classList.remove('busy');
  }
}

// x.y.z.250 in the camera's range, avoiding the camera's own address.
function suggestReachIp() {
  const cam = $('#reach-cam').value.trim();
  if (!IPV4.test(cam)) return;
  const last = Number(cam.split('.')[3]);
  $('#reach-ip').value = `${base24(cam)}.${last === 250 ? 251 : 250}`;
  updateReachRange();
}

function prepareReach(camIp) {
  $('#reach-cam').value = camIp;
  suggestReachIp();
  $('#reach').scrollIntoView({ behavior: 'smooth', block: 'center' });
  setMsg($('#reach-msg'), `Click ADD PC ADDRESS, then SCAN again to see ${camIp} as reachable.`, 'warn');
}

async function addReachAddress() {
  const msg = $('#reach-msg');
  const ip = $('#reach-ip').value.trim();
  const prefix = Number($('#reach-prefix').value || 24);
  const cam = $('#reach-cam').value.trim();
  if (!IPV4.test(ip)) return setMsg(msg, `"${ip}" is not a valid IP address`, 'bad');
  if (IPV4.test(cam) && !sameSubnet(ip, cam, prefix)) return setMsg(msg, `${ip}/${prefix} is not in the same range as ${cam}`, 'bad');
  if (IPV4.test(cam) && ip === cam) return setMsg(msg, 'The PC address must differ from the camera\'s', 'bad');
  if (await pcAction({ action: 'add', index: Number($('#reach-adapter').value), ip, prefix }, $('#reach-add'))) {
    setMsg(msg, `ADDED ${ip}. This PC can now reach ${base24(ip)}.x cameras. Remove it again under the adapter when you're done.`, 'ok');
  }
}

// --- Cameras ------------------------------------------------------------------

async function scan(reloadNetwork = true) {
  const btn = $('#scan');
  const msg = $('#scan-msg');
  btn.disabled = true;
  btn.classList.add('busy');
  setMsg(msg, 'SCANNING… (ABOUT 5 SECONDS)', 'warn');
  if (!devices.length) $('#devices').innerHTML = '<div class="loading"><span class="spinner"></span>LOOKING FOR CAMERAS…</div>';
  try {
    const [data] = await Promise.all([api('/api/network/scan', {}), reloadNetwork && loadNetwork()]);
    devices = data.devices;
    renderDevices();
    const cams = devices.filter((d) => d.camera).length;
    setMsg(msg, `FOUND ${cams} CAMERA${cams === 1 ? '' : 'S'}${cams ? '' : '. Not listed? Add a PC address in its range below and scan again.'}`, cams ? 'ok' : 'warn');
  } catch (e) {
    setMsg(msg, `SCAN FAILED: ${e.message}`, 'bad');
  } finally {
    btn.disabled = false;
    btn.classList.remove('busy');
  }
}

function renderDevices() {
  const cams = devices.filter((d) => d.camera);
  const others = devices.filter((d) => !d.camera);
  $('#dev-count').textContent = devices.length ? `[${cams.length}]` : '';
  $('#devices').replaceChildren(...cams.map(buildDevice));
  $('#others').hidden = !others.length;
  $('#others-count').textContent = `[${others.length}]`;
  $('#other-list').replaceChildren(...others.map(buildDevice));
}

function suggestNewIp(d) {
  const home = homeNetwork();
  if (!home) return { ip: d.ip, prefix: d.network?.prefix ?? 24, gateway: d.network?.gateway ?? '' };
  const taken = new Set([...devices.map((x) => x.ip), ...net.adapters.flatMap((a) => a.addresses.map((x) => x.ip)), home.gateway]);
  const base = base24(home.ip);
  let last = Number(d.ip.split('.')[3]);
  if (taken.has(`${base}.${last}`) && `${base}.${last}` !== d.ip) {
    last = 200;
    while (last < 254 && taken.has(`${base}.${last}`)) last++;
  }
  return { ip: `${base}.${last}`, prefix: home.prefix, gateway: home.gateway };
}

function buildDevice(d, i) {
  const card = $('#dev-tpl').content.firstElementChild.cloneNode(true);
  $('.cam-no', card).textContent = d.ip;
  const model = [d.manufacturer, d.model].filter(Boolean).join(' ') || d.hardware || d.title || d.server || '';
  $('.cam-title', card).textContent = [model, d.name && d.name !== d.manufacturer ? d.name : ''].filter(Boolean).join(' · ') || (d.camera ? 'CAMERA' : 'WEB DEVICE');

  const meta = [];
  if (d.firmware) meta.push(`FW ${d.firmware}`);
  if (d.network?.mac) meta.push(`MAC ${d.network.mac.toUpperCase()}`);
  if (d.network) meta.push(`${d.network.dhcp ? 'DHCP' : 'FIXED'} /${d.network.prefix ?? '?'}${d.network.gateway ? ` · GW ${d.network.gateway}` : ''}`);
  $('.dev-meta', card).textContent = meta.join(' · ');

  const reach = pcReaches(d.ip);
  const status = $('.dev-status', card);
  if (d.monitorName) status.append(badge(`IN MONITOR: ${d.monitorName}`, 'ok'));
  if (!reach) {
    status.append(badge('OTHER IP RANGE: THIS PC CAN\'T REACH IT', 'warn'));
    if (net.canChangePc) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn small';
      b.textContent = 'PUT PC IN THIS RANGE';
      b.addEventListener('click', () => prepareReach(d.ip));
      status.append(b);
    }
  } else if (d.camera && !d.loginOk && d.loginError) {
    status.append(badge(`DETAILS: ${d.loginError}`, 'muted'));
  }

  const web = $('[data-act="web"]', card);
  web.href = `http://${d.ip}/`;
  const add = $('[data-act="add"]', card);
  add.hidden = Boolean(d.monitorName);
  add.href = `/settings#add=${encodeURIComponent(d.ip)}&name=${encodeURIComponent(d.model || d.name || '')}`;

  const changeBtn = $('[data-act="change"]', card);
  const form = $('.change-form', card);
  changeBtn.hidden = !d.camera;
  changeBtn.addEventListener('click', () => {
    if (!reach) {
      if (net.canChangePc) prepareReach(d.ip);
      else Modal.alert({ title: 'CAMERA OUT OF REACH', text: `This PC can't reach ${d.ip}. Add a PC address in its range first (on the server PC).` });
      return;
    }
    form.hidden = !form.hidden;
    if (!form.hidden) {
      const s = suggestNewIp(d);
      form.elements.newIp.value = s.ip;
      setPrefix(form.elements.prefix, s.prefix);
      form.elements.gateway.value = s.gateway;
      updateRange();
      form.elements.user.placeholder = d.monitorName ? 'stored in Monitor' : 'Admin';
      form.elements.password.placeholder = d.monitorName ? 'stored in Monitor' : '123456';
      form.elements.newIp.select();
    }
  });
  for (const input of form.querySelectorAll('[data-f]')) input.name = input.dataset.f;
  fillPrefixSelect(form.elements.prefix);
  const updateRange = bindRangeHint(form.elements.newIp, form.elements.prefix, $('.range-hint', form));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    changeIp(d, form);
  });
  return card;
}

function badge(text, kind) {
  const b = document.createElement('span');
  b.className = `badge ${kind}`;
  b.textContent = text;
  return b;
}

async function changeIp(d, form) {
  const msg = $('.test-msg', form);
  const btn = $('[type="submit"]', form);
  const f = form.elements;
  const newIp = f.newIp.value.trim();
  const ok = await Modal.confirm({
    title: 'CHANGE CAMERA ADDRESS',
    text: `Change ${d.ip} to ${newIp}/${f.prefix.value}?
The camera may restart.`,
    ok: 'CHANGE',
  });
  if (!ok) return;
  btn.disabled = true;
  btn.classList.add('busy');
  setMsg(msg, 'CHANGING…', 'warn');
  try {
    const r = await api('/api/network/camera-ip', {
      host: d.ip,
      xaddr: d.xaddr,
      newIp,
      prefix: Number(f.prefix.value || 24),
      gateway: f.gateway.value.trim(),
      user: f.user.value.trim() || (d.monitorName ? '' : 'Admin'),
      password: f.password.value || (d.monitorName ? '' : '123456'),
    });
    const parts = [`DONE: CAMERA IS NOW ${newIp}${r.rebooting ? ' (RESTARTING, GIVE IT A MINUTE)' : ''}.`];
    if (r.updated.length) parts.push(`Monitor updated: ${r.updated.join(', ')}.`);
    parts.push(...r.warnings);
    setMsg(msg, parts.join(' '), r.warnings.length ? 'warn' : 'ok');
  } catch (e) {
    setMsg(msg, `FAILED: ${e.message}`, 'bad');
  } finally {
    btn.disabled = false;
    btn.classList.remove('busy');
  }
}

// --- Events -------------------------------------------------------------------

fillPrefixSelect($('#reach-prefix'));
const updateReachRange = bindRangeHint($('#reach-ip'), $('#reach-prefix'), $('#reach-range'));

$('#scan').addEventListener('click', () => scan());
$('#reach-cam').addEventListener('input', suggestReachIp);
$('#reach-add').addEventListener('click', addReachAddress);
$('#ipu').addEventListener('click', async () => {
  try {
    await api('/api/network/ip-utility', {});
    setMsg($('#ipu-msg'), 'STARTING…', 'ok');
  } catch (e) {
    setMsg($('#ipu-msg'), `FAILED: ${e.message}`, 'bad');
  }
});

function tickClock() {
  const d = new Date();
  $('#clock').textContent = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
setInterval(tickClock, 1000);
tickClock();

loadNetwork();
scan(false);
