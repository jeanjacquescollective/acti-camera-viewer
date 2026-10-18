// Camera monitor: proxies IP-camera images to the browser as JPEG snapshots
// (for the overview grid) and MJPEG streams (for the live view), serves a
// settings page that edits cameras.json, and a network page that finds cameras,
// changes their IP address (ONVIF) and adds addresses to this PC's adapters.
//
// Two ways to get frames from a camera:
//   "snapshot" - poll the camera's snapshot CGI. No extra software needed.
//   "rtsp"     - decode the camera's RTSP stream with ffmpeg. Smoother, needs ffmpeg.
//                Snapshots fill in while RTSP connects, fails or is retried
//                in the background, so the picture never stops.
//
// CommonJS on purpose: Node's single-executable builder (see build-exe.js)
// only accepts a CommonJS entry point.

'use strict';

const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const dgram = require('node:dgram');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

let sea = null;
try {
  sea = require('node:sea');
} catch {}
const IS_EXE = Boolean(sea && sea.isSea());

// As an exe, cameras.json lives next to the exe (see findConfig) and the web files are embedded in it.
const APP_DIR = IS_EXE ? path.dirname(process.execPath) : __dirname;
const PUBLIC_DIR = path.join(__dirname, 'public');
const CONFIG_FILE = process.env.CAMERAS_CONFIG || findConfig();

// Next to the exe; for an exe in the project's dist/ folder, the project's own
// cameras.json, so the exe and "npm run dev" share one set of settings.
function findConfig() {
  const own = path.join(APP_DIR, 'cameras.json');
  const project = path.join(APP_DIR, '..', 'cameras.json');
  if (IS_EXE && !fs.existsSync(own) && fs.existsSync(path.join(APP_DIR, '..', 'server.js')) && fs.existsSync(project)) return project;
  return own;
}
// --sidecar: started hidden by the desktop app (src-tauri), which shows the pages in its own window.
const SIDECAR = process.argv.includes('--sidecar');
const OPEN_BROWSER = (IS_EXE || process.argv.includes('--open')) && !process.argv.includes('--no-browser') && !SIDECAR;

const SOI = Buffer.from([0xff, 0xd8]); // JPEG start-of-image
const EOI = Buffer.from([0xff, 0xd9]); // JPEG end-of-image
const BOUNDARY = 'frame';

const RTSP_CONNECT_TIMEOUT_MS = 8_000; // ffmpeg must deliver a first frame within this time
const RTSP_STALL_MS = 3_000; // no frame for this long = stream is dead (longer at very low fps)
const RTSP_RETRY_DELAYS_MS = [1_000, 3_000, 10_000, 30_000, 60_000]; // background retries, last one repeats
const RTSP_HEALTHY_MS = 30_000; // a run that delivered video this long resets the failure count
const RTSP_NO_TCP = /400 Bad Request|461 Unsupported transport|Nonmatching transport/i;
// Live view latency per camera (SETUP > ADVANCED). The defaults measured on an
// ACM-5601: first frame after ~1 s instead of ~3.6 s, frames evenly instead of in bursts.
const LATENCY_DEFAULTS = {
  lowDelay: true, // ffmpeg doesn't buffer input (-fflags nobuffer -flags low_delay)
  fastStart: true, // short stream probe before the first frame
  jitterMs: 200, // how long to wait for late/out-of-order UDP packets
  pacing: 'arrival', // 'arrival': pass frames on as they come; 'fixed': exactly fps per second (-r), adds delay
  jpegQuality: 5, // ffmpeg -q:v for the MJPEG sent to viewers: 2 = best, 15 = smallest
  dropLate: true, // skip frames for a viewer still receiving the previous one, instead of queueing
};

function rtspInputArgs(cam) {
  const args = [];
  if (cam.lowDelay) args.push('-fflags', 'nobuffer', '-flags', 'low_delay');
  if (cam.fastStart) args.push('-probesize', '200000', '-analyzeduration', '500000');
  args.push('-max_delay', String(cam.jitterMs * 1000), '-reorder_queue_size', cam.jitterMs === 0 ? '0' : '32');
  return [...args, '-rtsp_transport', cam.rtspTransport, '-i', cam.rtspUrl];
}

const DEFAULT_CONFIG = {
  port: 8080,
  overviewRefreshMs: 1000,
  ffmpegPath: 'ffmpeg',
  cameras: [{ id: '1', name: 'Camera 1', host: '192.168.0.100', user: 'admin', password: '123456', mode: 'snapshot', fps: 5 }],
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const enc = encodeURIComponent;
const lastLine = (s) => s.trim().split(/\r?\n/).pop() || '';

let config = null;
let ffmpegPath = null; // resolved path, or null when ffmpeg is not installed
let feeds = new Map();
let currentPort = null;

// --- Config ---------------------------------------------------------------

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8').replace(/^﻿/, '')); // Notepad may add a BOM
  } catch (e) {
    if (e.code !== 'ENOENT') throw e;
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG, null, 2) + '\n');
    console.log(`Created ${CONFIG_FILE} with a default camera.`);
    return structuredClone(DEFAULT_CONFIG);
  }
}

function findFfmpeg(configured) {
  const candidates = [configured, path.join(APP_DIR, 'ffmpeg.exe'), path.join(APP_DIR, 'ffmpeg'), 'ffmpeg'];
  for (const c of candidates) {
    if (c && spawnSync(c, ['-version'], { stdio: 'ignore', windowsHide: true }).status === 0) return c;
  }
  return null;
}

// Validates settings sent by the settings page. Cameras whose password field
// was left untouched keep their stored password.
function cleanConfig(input, old) {
  const fail = (msg) => {
    throw Object.assign(new Error(msg), { status: 400 });
  };
  const str = (v) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());
  const int = (v, min, max, label, def) => {
    if (v === undefined || v === null || v === '') return def;
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) fail(`${label} must be a whole number from ${min} to ${max}`);
    return n;
  };

  if (!input || !Array.isArray(input.cameras)) fail('Invalid settings');
  const out = {
    port: int(input.port, 1, 65535, 'Port', 8080),
    overviewRefreshMs: int(input.overviewRefreshMs, 200, 60000, 'Overview refresh', 1000),
    ffmpegPath: str(input.ffmpegPath) || 'ffmpeg',
    cameras: [],
  };

  const oldById = new Map((old.cameras ?? []).map((c, i) => [String(c.id ?? i + 1), c]));
  const used = new Set();
  let nextId = Math.max(0, ...input.cameras.map((c) => Number(c.id)).filter(Number.isInteger)) + 1;

  input.cameras.forEach((c, i) => {
    const name = str(c.name) || `Camera ${i + 1}`;
    let id = str(c.id);
    if (!id || used.has(id)) id = String(nextId++);
    used.add(id);

    const host = str(c.host);
    const snapshotUrl = str(c.snapshotUrl);
    const rtspUrl = str(c.rtspUrl);
    if (!host && !snapshotUrl) fail(`${name}: IP address is required`);
    if (host && !/^[\w.-]+$/.test(host)) fail(`${name}: "${host}" is not a valid IP address or hostname`);
    for (const [label, u] of [['Snapshot URL', snapshotUrl], ['RTSP URL', rtspUrl]]) {
      if (u && !/^(https?|rtsp):\/\//i.test(u)) fail(`${name}: ${label} must start with http://, https:// or rtsp://`);
    }

    const prev = oldById.get(id);
    const cam = {
      id,
      name,
      host,
      user: str(c.user) || 'admin',
      password: typeof c.password === 'string' ? c.password : prev?.password ?? '123456',
      mode: c.mode === 'rtsp' ? 'rtsp' : 'snapshot',
      fps: int(c.fps, 1, 30, `${name}: FPS`, 5),
    };
    const httpPort = int(c.httpPort, 1, 65535, `${name}: HTTP port`, 80);
    const rtspPort = int(c.rtspPort, 1, 65535, `${name}: RTSP port`, 7070);
    if (httpPort !== 80) cam.httpPort = httpPort;
    if (rtspPort !== 7070) cam.rtspPort = rtspPort;
    if (c.rtspTransport === 'udp') cam.rtspTransport = 'udp';
    if (snapshotUrl) cam.snapshotUrl = snapshotUrl;
    if (rtspUrl) cam.rtspUrl = rtspUrl;

    // Live view latency (RTSP); only values that differ from LATENCY_DEFAULTS are stored.
    const bool = (v) => (v === undefined || v === null || v === '' ? undefined : v === true || v === 'true');
    const lat = {
      lowDelay: bool(c.lowDelay),
      fastStart: bool(c.fastStart),
      dropLate: bool(c.dropLate),
      jitterMs: c.jitterMs === undefined || c.jitterMs === '' ? undefined : int(c.jitterMs, 0, 2000, `${name}: Wait for late packets`, 200),
      jpegQuality: c.jpegQuality === undefined || c.jpegQuality === '' ? undefined : int(c.jpegQuality, 2, 15, `${name}: Picture quality`, 5),
      pacing: c.pacing === 'fixed' || c.pacing === 'arrival' ? c.pacing : undefined,
    };
    for (const [k, v] of Object.entries(lat)) if (v !== undefined && v !== LATENCY_DEFAULTS[k]) cam[k] = v;
    out.cameras.push(cam);
  });
  return out;
}

// Config as sent to the browser: passwords never leave the server.
function publicConfig() {
  return {
    ...config,
    cameras: (config.cameras ?? []).map(({ password, ...c }) => ({ ...c, hasPassword: password != null })),
  };
}

function normalizeCamera(c, i) {
  const user = c.user ?? 'admin';
  const password = c.password ?? '123456';
  return {
    id: String(c.id ?? i + 1),
    name: c.name ?? `Camera ${i + 1}`,
    host: c.host,
    httpPort: c.httpPort ?? 80,
    mode: c.mode === 'rtsp' ? 'rtsp' : 'snapshot',
    fps: c.fps ?? 5,
    user,
    password,
    rtspTransport: c.rtspTransport ?? 'tcp',
    ...Object.fromEntries(Object.entries(LATENCY_DEFAULTS).map(([k, d]) => [k, c[k] ?? d])),
    // Defaults match ACTi firmware; override per camera for other brands.
    snapshotUrl:
      c.snapshotUrl ||
      `http://${c.host}:${c.httpPort ?? 80}/cgi-bin/encoder?USER=${enc(user)}&PWD=${enc(password)}&SNAPSHOT`,
    rtspUrl: c.rtspUrl || `rtsp://${enc(user)}:${enc(password)}@${c.host}:${c.rtspPort ?? 7070}/`,
  };
}

function applyConfig(next) {
  config = next;
  ffmpegPath = findFfmpeg(config.ffmpegPath);
  for (const f of feeds.values()) f.destroy();
  feeds = new Map(
    (config.cameras ?? []).map((c, i) => {
      const cam = normalizeCamera(c, i);
      return [cam.id, new CameraFeed(cam)];
    }),
  );
  for (const f of feeds.values()) {
    if (f.cam.mode === 'rtsp' && !ffmpegPath) {
      console.warn(`[${f.cam.name}] RTSP mode needs ffmpeg, which was not found. Using snapshot mode.`);
    }
  }
}

// --- Camera access ----------------------------------------------------------

// Fetches one JPEG from the camera. Uses the raw http module with the lenient
// parser because old camera firmware often sends slightly malformed responses.
function fetchJpeg(cam, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const lib = cam.snapshotUrl.startsWith('https:') ? https : http;
    const req = lib.get(
      cam.snapshotUrl,
      {
        insecureHTTPParser: true,
        timeout: timeoutMs,
        rejectUnauthorized: false,
        headers: { Authorization: 'Basic ' + Buffer.from(`${cam.user}:${cam.password}`).toString('base64') },
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return reject(new Error(`camera answered HTTP ${res.statusCode}`));
        }
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('error', reject);
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          const start = buf.indexOf(SOI);
          if (start === -1) return reject(new Error('camera response is not a JPEG image'));
          resolve(start === 0 ? buf : buf.subarray(start));
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('camera did not respond (timeout)')));
    req.on('error', reject);
  });
}

// Grabs a single frame from the RTSP stream (used by the settings page's test button).
// Retries over UDP when the camera refuses TCP.
async function grabRtspFrame(cam) {
  try {
    return await grabRtspFrameOnce(cam);
  } catch (e) {
    if (cam.rtspTransport !== 'tcp' || !RTSP_NO_TCP.test(e.message)) throw e;
    try {
      return await grabRtspFrameOnce({ ...cam, rtspTransport: 'udp' });
    } catch {
      throw e;
    }
  }
}

function grabRtspFrameOnce(cam, timeoutMs = 12000) {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error('ffmpeg is not installed'));
    const proc = spawn(
      ffmpegPath,
      ['-hide_banner', '-loglevel', 'error', ...rtspInputArgs(cam),
        '-frames:v', '1', '-f', 'mjpeg', 'pipe:1'],
      { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
    );
    const chunks = [];
    let stderr = '';
    const timer = setTimeout(() => {
      proc.kill();
      reject(new Error('no video from the RTSP stream (timeout)'));
    }, timeoutMs);
    proc.stdout.on('data', (c) => chunks.push(c));
    proc.stderr.on('data', (d) => (stderr = (stderr + d).slice(-500)));
    proc.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      const buf = Buffer.concat(chunks);
      if (buf.length > 2 && buf[0] === 0xff && buf[1] === 0xd8) resolve(buf);
      else reject(new Error(lastLine(stderr) || `ffmpeg exited with code ${code}`));
    });
  });
}

// Snapshot polling is the base layer: it runs whenever RTSP isn't delivering
// video. RTSP is (re)tried in the background and takes over only once ffmpeg
// actually produces frames, so connecting, failing or retrying RTSP never
// interrupts the picture.
class CameraFeed {
  constructor(cam) {
    this.cam = cam;
    this.clients = new Set(); // { onFrame, onClose }
    this.running = false;
    this.generation = 0; // bumps on every start/stop so stale loops exit
    this.pollerGen = null; // generation of the running snapshot poller, if any
    this.rtspLive = false; // ffmpeg is currently delivering frames
    this.rtspFailures = 0;
    this.rtspError = null;
    this.rtspRetryAt = 0;
    this.lastFrame = null;
    this.lastFrameAt = 0;
    this.lastError = null;
    this.snapshotInFlight = null;
    this.proc = null;
    this.stopTimer = null;
    this.retryTimer = null;
  }

  status() {
    let fallbackReason = null;
    if (this.cam.mode === 'rtsp' && !this.rtspLive) {
      if (!ffmpegPath) fallbackReason = 'ffmpeg not installed';
      else if (!this.running) fallbackReason = 'RTSP starts when viewed';
      else if (this.rtspFailures === 0) fallbackReason = 'connecting RTSP';
      else fallbackReason = `RTSP failed, retry in ${Math.max(1, Math.ceil((this.rtspRetryAt - Date.now()) / 1000))}s`;
    }
    return {
      id: this.cam.id,
      name: this.cam.name,
      mode: this.cam.mode,
      activeMode: this.rtspLive ? 'rtsp' : 'snapshot',
      fallback: fallbackReason !== null,
      fallbackReason,
      rtspError: this.rtspError,
      online: this.lastError === null && this.lastFrameAt > 0,
      lastError: this.lastError,
      lastFrameAt: this.lastFrameAt || null,
      viewers: this.clients.size,
    };
  }

  setFrame(frame) {
    this.lastFrame = frame;
    this.lastFrameAt = Date.now();
    this.lastError = null;
  }

  setError(err) {
    this.lastError = err.message || String(err);
  }

  // A single still image for the overview. Reuses a recent frame from a running
  // stream and merges concurrent requests into one camera request.
  async snapshot() {
    if (this.lastFrame && Date.now() - this.lastFrameAt < 500) return this.lastFrame;
    if (!this.snapshotInFlight) {
      this.snapshotInFlight = fetchJpeg(this.cam)
        .then((f) => (this.setFrame(f), f))
        .catch((e) => {
          this.setError(e);
          throw e;
        })
        .finally(() => (this.snapshotInFlight = null));
    }
    return this.snapshotInFlight;
  }

  subscribe(client) {
    this.clients.add(client);
    if (this.lastFrame && Date.now() - this.lastFrameAt < 2000) client.onFrame(this.lastFrame);
    this.start();
    return () => {
      this.clients.delete(client);
      if (this.clients.size === 0) {
        clearTimeout(this.stopTimer);
        // Short grace period so switching between cameras doesn't restart ffmpeg.
        this.stopTimer = setTimeout(() => this.stop(), 5000);
      }
    };
  }

  emit(frame) {
    this.setFrame(frame);
    for (const c of this.clients) c.onFrame(frame);
  }

  start() {
    clearTimeout(this.stopTimer);
    if (this.running) return;
    this.running = true;
    const gen = ++this.generation;
    this.rtspFailures = 0;
    this.ensurePoller(gen); // picture right away, while RTSP connects
    if (this.cam.mode === 'rtsp' && ffmpegPath) this.runFfmpeg(gen);
  }

  stop() {
    this.running = false;
    this.generation++;
    this.rtspLive = false;
    clearTimeout(this.retryTimer);
    if (this.proc) {
      this.proc.kill();
      this.proc = null;
    }
  }

  // Called when settings are saved: stops everything and closes open streams
  // (the browser reconnects to the new feed by itself).
  destroy() {
    clearTimeout(this.stopTimer);
    this.stop();
    for (const c of this.clients) c.onClose();
    this.clients.clear();
  }

  isCurrent(gen) {
    return this.running && gen === this.generation;
  }

  ensurePoller(gen) {
    if (this.pollerGen === gen || !this.isCurrent(gen)) return;
    this.pollerGen = gen;
    this.runPoller(gen).finally(() => {
      if (this.pollerGen === gen) this.pollerGen = null;
    });
  }

  async runPoller(gen) {
    const interval = 1000 / this.cam.fps;
    while (this.isCurrent(gen) && !this.rtspLive) {
      const t0 = Date.now();
      try {
        const frame = await fetchJpeg(this.cam);
        if (!this.isCurrent(gen) || this.rtspLive) break; // RTSP took over meanwhile
        this.emit(frame);
      } catch (e) {
        if (this.rtspLive) break;
        this.setError(e);
        await sleep(2000);
      }
      await sleep(Math.max(0, interval - (Date.now() - t0)));
    }
  }

  runFfmpeg(gen) {
    // 'arrival' pacing passes frames on as they come (capped at fps below); "-r" pads
    // and queues frames to hit an exact rate, which shows as delay.
    const pacing = this.cam.pacing === 'fixed' ? ['-r', String(this.cam.fps)] : ['-fps_mode', 'vfr'];
    const args = [
      '-hide_banner', '-loglevel', 'error',
      ...rtspInputArgs(this.cam),
      '-an',
      ...pacing,
      '-f', 'mjpeg', '-q:v', String(this.cam.jpegQuality),
      'pipe:1',
    ];
    const minGapMs = this.cam.pacing === 'fixed' ? 0 : (1000 / this.cam.fps) * 0.8;
    let lastEmitAt = 0;
    const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    this.proc = proc;

    const startedAt = Date.now();
    let firstFrameAt = 0;
    let lastFrameAt = 0;
    let killedFor = null;
    let buf = Buffer.alloc(0);
    proc.stdout.on('data', (chunk) => {
      if (!this.isCurrent(gen)) return;
      buf = buf.length ? Buffer.concat([buf, chunk]) : chunk;
      let s, e;
      while ((s = buf.indexOf(SOI)) !== -1 && (e = buf.indexOf(EOI, s + 2)) !== -1) {
        lastFrameAt = Date.now();
        if (!firstFrameAt) {
          firstFrameAt = lastFrameAt;
          this.rtspError = null;
          console.log(`[${this.cam.name}] RTSP connected.`);
        }
        this.rtspLive = true; // the snapshot poller sees this and stops
        if (lastFrameAt - lastEmitAt >= minGapMs) {
          lastEmitAt = lastFrameAt;
          this.emit(Buffer.from(buf.subarray(s, e + 2)));
        }
        buf = buf.subarray(e + 2);
      }
      if (buf.length > 5_000_000) buf = Buffer.alloc(0); // never found an end marker; resync
    });

    // When frames are late, snapshots fill in straight away while ffmpeg gets a
    // few seconds to recover. Give up quickly when ffmpeg can't connect, or hangs
    // without exiting because the camera stopped sending.
    const lateMs = Math.max(1000, 2500 / this.cam.fps);
    const stallMs = Math.max(RTSP_STALL_MS, 4000 / this.cam.fps);
    const watchdog = setInterval(() => {
      const now = Date.now();
      if (firstFrameAt && this.rtspLive && now - lastFrameAt > lateMs) {
        this.rtspLive = false;
        this.ensurePoller(gen);
      }
      if (!firstFrameAt && now - startedAt > RTSP_CONNECT_TIMEOUT_MS) killedFor = 'RTSP stream did not start (timeout)';
      else if (firstFrameAt && now - lastFrameAt > stallMs) killedFor = 'RTSP stream stopped sending video';
      if (killedFor) proc.kill();
    }, 250);

    let stderrTail = '';
    proc.stderr.on('data', (d) => (stderrTail = (stderrTail + d).slice(-500)));

    let ended = false;
    const onEnd = (err) => {
      if (ended) return;
      ended = true;
      clearInterval(watchdog);
      if (this.proc === proc) this.proc = null;
      if (!this.isCurrent(gen)) return;

      this.rtspLive = false;
      this.ensurePoller(gen); // snapshot mode takes over immediately

      // A stream that worked for a while starts the retry schedule afresh.
      if (firstFrameAt && lastFrameAt - firstFrameAt >= RTSP_HEALTHY_MS) this.rtspFailures = 0;
      this.rtspFailures++;
      const delay = RTSP_RETRY_DELAYS_MS[Math.min(this.rtspFailures, RTSP_RETRY_DELAYS_MS.length) - 1];
      this.rtspError = killedFor || err?.message || lastLine(stderrTail) || 'RTSP stream closed';
      // Older ACTi firmware only streams RTSP over UDP and answers "400 Bad Request" to TCP.
      if (this.cam.rtspTransport === 'tcp' && RTSP_NO_TCP.test(this.rtspError)) {
        this.cam.rtspTransport = 'udp';
        console.warn(`[${this.cam.name}] Camera refuses RTSP over TCP; switching to UDP.`);
        this.rtspFailures = 0;
      }
      this.rtspRetryAt = Date.now() + delay;
      console.warn(`[${this.cam.name}] RTSP failed: ${this.rtspError}. Using snapshots, retrying RTSP in ${delay / 1000}s.`);

      this.retryTimer = setTimeout(() => this.isCurrent(gen) && this.runFfmpeg(gen), delay);
    };
    proc.on('error', onEnd);
    proc.on('close', () => onEnd());
  }
}

// --- Network: find cameras, change camera IPs, PC addresses ----------------

const IPV4 = /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/;
const ipToInt = (ip) => ip.split('.').reduce((n, o) => n * 256 + Number(o), 0) >>> 0;
const sameSubnet = (a, b, prefix) => prefix === 0 || ipToInt(a) >>> (32 - prefix) === ipToInt(b) >>> (32 - prefix);

const xmlEsc = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);
const xmlDecode = (s) =>
  s.replace(/&(lt|gt|amp|apos|quot);/g, (_, e) => ({ lt: '<', gt: '>', amp: '&', apos: "'", quot: '"' })[e]);
// First <prefix:tag>text</prefix:tag> in the XML, ignoring namespaces. Good enough for ONVIF replies.
function xmlText(xml, tag) {
  const m = xml.match(new RegExp(`<(?:[\\w-]+:)?${tag}\\b[^>]*>([^<]*)</(?:[\\w-]+:)?${tag}>`));
  return m ? xmlDecode(m[1].trim()) : null;
}
function xmlSection(xml, tag) {
  const m = xml.match(new RegExp(`<(?:[\\w-]+:)?${tag}\\b[^>]*>([\\s\\S]*?)</(?:[\\w-]+:)?${tag}>`));
  return m ? m[1] : '';
}

// IPv4 addresses of this PC with their subnet, e.g. { address, prefix, iface }.
function localSubnets() {
  return Object.entries(os.networkInterfaces()).flatMap(([iface, addrs]) =>
    (addrs ?? [])
      .filter((a) => a.family === 'IPv4' && !a.internal)
      .map((a) => ({ iface, address: a.address, prefix: Number(a.cidr?.split('/')[1] ?? 24) })),
  );
}
const reachable = (ip) => localSubnets().some((s) => sameSubnet(ip, s.address, s.prefix));

// Requests from this PC itself (localhost or one of its own addresses).
function isLocalRequest(req) {
  const ip = String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
  return ip === '127.0.0.1' || ip === '::1' || localSubnets().some((s) => s.address === ip);
}

function ping(ip, timeoutMs = 800) {
  const args = process.platform === 'win32' ? ['-n', '1', '-w', String(timeoutMs), ip] : ['-c', '1', '-W', '1', ip];
  return new Promise((resolve) => {
    const p = spawn('ping', args, { windowsHide: true });
    let out = '';
    p.stdout.on('data', (d) => (out += d));
    p.on('error', () => resolve(false));
    // Windows' ping also exits with 0 for "destination host unreachable"; only a TTL means a reply.
    p.on('close', () => resolve(/ttl=/i.test(out)));
  });
}

function tcpOpen(ip, port, timeoutMs = 600) {
  return new Promise((resolve) => {
    const s = net.connect({ host: ip, port, timeout: timeoutMs });
    const done = (ok) => {
      s.destroy();
      resolve(ok);
    };
    s.once('connect', () => done(true));
    s.once('timeout', () => done(false));
    s.once('error', () => done(false));
  });
}

const addressInUse = async (ip) => (await ping(ip)) || (await tcpOpen(ip, 80));

// Minimal HTTP request with a text body, lenient like fetchJpeg (old camera firmware).
function httpText(url, { method = 'GET', body, headers = {}, timeoutMs = 5000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      url,
      { method, insecureHTTPParser: true, timeout: timeoutMs, headers: body ? { ...headers, 'Content-Length': Buffer.byteLength(body) } : headers },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (c) => (text.length < 2_000_000 ? (text += c) : null));
        res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(Object.assign(new Error('camera did not respond (timeout)'), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
    req.end(body);
  });
}

// --- ONVIF (the standard protocol most IP cameras, including ACTi, speak) ---

const WSD_ADDR = '239.255.255.250';
const WSD_PORT = 3702;

function wsdProbe(types) {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope" xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing"' +
    ' xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery" xmlns:dn="http://www.onvif.org/ver10/network/wsdl">' +
    `<e:Header><w:MessageID>uuid:${crypto.randomUUID()}</w:MessageID>` +
    '<w:To e:mustUnderstand="true">urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To>' +
    '<w:Action e:mustUnderstand="true">http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action></e:Header>' +
    `<e:Body><d:Probe>${types ? `<d:Types>${types}</d:Types>` : ''}</d:Probe></e:Body></e:Envelope>`
  );
}

// WS-Discovery: multicasts a probe from every network adapter and collects the answers.
function discoverOnvif(timeoutMs = 3000) {
  return new Promise((resolve) => {
    const found = new Map(); // ip -> device
    const sockets = [];
    for (const { address } of localSubnets()) {
      const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      sockets.push(sock);
      sock.on('error', () => sock.close());
      sock.on('message', (msg, rinfo) => {
        const xml = msg.toString('utf8');
        if (!/ProbeMatch/.test(xml)) return;
        const xaddrs = (xmlText(xml, 'XAddrs') || '').split(/\s+/).filter(Boolean);
        const xaddr = xaddrs.find((u) => /^http:\/\/\d+\.\d+\.\d+\.\d+[:/]/.test(u)) || xaddrs[0] || null;
        let ip = rinfo.address;
        try {
          if (xaddr && IPV4.test(new URL(xaddr).hostname)) ip = new URL(xaddr).hostname;
        } catch {}
        const scopes = (xmlText(xml, 'Scopes') || '').split(/\s+/);
        const scope = (k) => {
          const s = scopes.find((x) => x.startsWith(`onvif://www.onvif.org/${k}/`));
          return s ? decodeURIComponent(s.slice(`onvif://www.onvif.org/${k}/`.length)) : null;
        };
        found.set(ip, { ip, xaddr, onvif: true, name: scope('name'), hardware: scope('hardware'), via: address });
      });
      sock.bind(0, address, () => {
        try {
          sock.setMulticastInterface(address);
          for (const types of ['dn:NetworkVideoTransmitter', '']) {
            const probe = Buffer.from(wsdProbe(types));
            sock.send(probe, WSD_PORT, WSD_ADDR);
          }
        } catch {}
      });
    }
    setTimeout(() => {
      for (const s of sockets) {
        try {
          s.close();
        } catch {}
      }
      resolve([...found.values()]);
    }, timeoutMs);
  });
}

// Checks every address in this PC's own /24 networks for a web server (port 80).
// Finds cameras that have ONVIF turned off.
async function sweepHttp() {
  const targets = new Set();
  for (const { address, prefix } of localSubnets()) {
    if (address.startsWith('169.254.') || prefix < 24) continue; // too large to sweep
    const base = address.split('.').slice(0, 3).join('.');
    for (let i = 1; i < 255; i++) if (`${base}.${i}` !== address) targets.add(`${base}.${i}`);
  }
  const queue = [...targets];
  const found = [];
  await Promise.all(
    Array.from({ length: 64 }, async () => {
      while (queue.length) {
        const ip = queue.shift();
        if (!(await tcpOpen(ip, 80, 500))) continue;
        let server = null;
        let title = null;
        try {
          const r = await httpText(`http://${ip}/`, { timeoutMs: 2000 });
          server = r.headers.server || null;
          title = (r.text.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || '').trim() || null;
        } catch {}
        found.push({ ip, server, title });
      }
    }),
  );
  return found;
}

function soapEnvelope(body, header = '') {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope" xmlns:tds="http://www.onvif.org/ver10/device/wsdl"' +
    ' xmlns:tt="http://www.onvif.org/ver10/schema">' +
    `<s:Header>${header}</s:Header><s:Body>${body}</s:Body></s:Envelope>`
  );
}

// WS-Security UsernameToken with a password digest, as ONVIF requires.
function wsSecurity(user, password, timeOffsetMs) {
  const nonce = crypto.randomBytes(16);
  const created = new Date(Date.now() + timeOffsetMs).toISOString().replace(/\.\d+Z$/, 'Z');
  const digest = crypto.createHash('sha1').update(Buffer.concat([nonce, Buffer.from(created), Buffer.from(password)])).digest('base64');
  return (
    '<Security s:mustUnderstand="1" xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">' +
    `<UsernameToken><Username>${xmlEsc(user)}</Username>` +
    `<Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordDigest">${digest}</Password>` +
    `<Nonce EncodingType="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-soap-message-security-1.0#Base64Binary">${nonce.toString('base64')}</Nonce>` +
    `<Created xmlns="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">${created}</Created>` +
    '</UsernameToken></Security>'
  );
}

// Some cameras want HTTP digest authentication instead of (or on top of) WS-Security.
function digestAuth(challenge, method, uri, user, password) {
  const p = {};
  challenge.replace(/(\w+)=(?:"([^"]*)"|([^,\s]+))/g, (_, k, a, b) => (p[k] = a ?? b));
  const md5 = (s) => crypto.createHash('md5').update(s).digest('hex');
  const ha1 = md5(`${user}:${p.realm}:${password}`);
  const ha2 = md5(`${method}:${uri}`);
  const qop = (p.qop || '').split(',').map((s) => s.trim()).includes('auth') ? 'auth' : null;
  const cnonce = crypto.randomBytes(8).toString('hex');
  const response = qop ? md5(`${ha1}:${p.nonce}:00000001:${cnonce}:auth:${ha2}`) : md5(`${ha1}:${p.nonce}:${ha2}`);
  return (
    `Digest username="${user}", realm="${p.realm}", nonce="${p.nonce}", uri="${uri}", response="${response}"` +
    (p.opaque ? `, opaque="${p.opaque}"` : '') +
    (qop ? `, qop=auth, nc=00000001, cnonce="${cnonce}"` : '') +
    (p.algorithm ? `, algorithm=${p.algorithm}` : '')
  );
}

function soapError(res) {
  const reason = xmlText(res.text, 'Text') || xmlText(res.text, 'faultstring') || '';
  const code = xmlSection(res.text, 'Subcode');
  if (res.status === 401 || /NotAuthorized|not authorized|unauthori[sz]ed|authority failure/i.test(reason + code)) {
    return 'wrong user name or password (ONVIF login)';
  }
  if (res.status === 404) return 'camera has no ONVIF service at this address (is ONVIF turned on in the camera?)';
  return reason || `camera answered HTTP ${res.status}`;
}

class OnvifDevice {
  constructor(xaddr, user, password) {
    this.xaddr = xaddr;
    this.user = user;
    this.password = password;
    this.timeOffsetMs = null; // camera clock minus our clock; WS-Security tokens use camera time
  }

  async call(body, { auth = true, timeoutMs = 5000 } = {}) {
    if (auth && this.timeOffsetMs === null) await this.syncClock();
    const envelope = soapEnvelope(body, auth ? wsSecurity(this.user, this.password, this.timeOffsetMs) : '');
    const opts = { method: 'POST', body: envelope, timeoutMs, headers: { 'Content-Type': 'application/soap+xml; charset=utf-8' } };
    let res = await httpText(this.xaddr, opts);
    const challenge = res.headers['www-authenticate'];
    if (auth && res.status === 401 && /digest/i.test(challenge || '')) {
      const uri = new URL(this.xaddr).pathname;
      res = await httpText(this.xaddr, { ...opts, headers: { ...opts.headers, Authorization: digestAuth(challenge, 'POST', uri, this.user, this.password) } });
    }
    if (res.status !== 200) throw new Error(soapError(res));
    return res.text;
  }

  async syncClock() {
    this.timeOffsetMs = 0;
    try {
      const xml = await this.call('<tds:GetSystemDateAndTime/>', { auth: false });
      const utc = xmlSection(xml, 'UTCDateTime');
      const n = (t) => Number(xmlText(utc, t));
      if (utc) this.timeOffsetMs = Date.UTC(n('Year'), n('Month') - 1, n('Day'), n('Hour'), n('Minute'), n('Second')) - Date.now();
    } catch {}
  }

  async info() {
    const xml = await this.call('<tds:GetDeviceInformation/>');
    return {
      manufacturer: xmlText(xml, 'Manufacturer'),
      model: xmlText(xml, 'Model'),
      firmware: xmlText(xml, 'FirmwareVersion'),
      serial: xmlText(xml, 'SerialNumber'),
    };
  }

  async network() {
    const xml = await this.call('<tds:GetNetworkInterfaces/>');
    const token = xml.match(/<(?:[\w-]+:)?NetworkInterfaces\b[^>]*\btoken="([^"]+)"/)?.[1];
    if (!token) throw new Error('camera did not report a network interface');
    const ipv4 = xmlSection(xml, 'IPv4');
    const dhcp = xmlText(ipv4, 'DHCP') === 'true';
    const cfg = xmlSection(ipv4, dhcp ? 'FromDHCP' : 'Manual') || xmlSection(ipv4, 'Manual') || xmlSection(ipv4, 'FromDHCP');
    let gateway = null;
    try {
      gateway = xmlText(await this.call('<tds:GetNetworkDefaultGateway/>'), 'IPv4Address');
    } catch {}
    return {
      token,
      mac: xmlText(xml, 'HwAddress'),
      dhcp,
      address: xmlText(cfg, 'Address'),
      prefix: Number(xmlText(cfg, 'PrefixLength')) || null,
      gateway,
    };
  }
}

const onvifUrl = (ip, xaddr) => {
  try {
    if (xaddr && new URL(xaddr).hostname === ip) return xaddr;
  } catch {}
  return `http://${ip}/onvif/device_service`;
};

// Logins to try for a camera: the one stored in Monitor, otherwise the ACTi defaults.
function loginsFor(ip) {
  const cam = (config.cameras ?? []).find((c) => c.host === ip);
  if (cam) return [{ user: cam.user ?? 'admin', password: cam.password ?? '123456' }];
  return [{ user: 'Admin', password: '123456' }, { user: 'admin', password: '123456' }];
}

// --- ACTi URL commands (ACTi cameras without ONVIF, e.g. older ACM models) ---

const prefixToMask = (p) => [24, 16, 8, 0].map((s) => ((((0xffffffff << (32 - p)) >>> 0) >>> s) & 255)).join('.');
const maskToPrefix = (m) => (IPV4.test(m) ? m.split('.').reduce((n, o) => n + Number(o).toString(2).replace(/0/g, '').length, 0) : null);

// GET /cgi-bin/system?USER=..&PWD=..&CMD1&CMD2=value. The camera answers one
// line per command: "CMD='value'", "OK: CMD='value'" or "ERROR: ...".
async function actiCommand(ip, user, password, cmds, timeoutMs = 4000) {
  const r = await httpText(`http://${ip}/cgi-bin/system?USER=${enc(user)}&PWD=${enc(password)}&${cmds.join('&')}`, { timeoutMs });
  if (/bad account|password/i.test(r.text) && /ERROR/.test(r.text)) throw new Error('wrong user name or password');
  if (r.status !== 200) throw new Error(`camera answered HTTP ${r.status}`);
  return r.text;
}

const actiValues = (text) =>
  Object.fromEntries([...text.matchAll(/^(?:OK:\s*)?([A-Z0-9_]+)='([^']*)'/gm)].map((m) => [m[1], m[2]]));

async function actiDescribe(ip, user, password) {
  const text = await actiCommand(ip, user, password, ['SYSTEM_INFO']);
  const info = Object.fromEntries([...text.matchAll(/^([^=\r\n]+?)\s*=\s*(.*?)\s*$/gm)].map((m) => [m[1], m[2]]));
  if (!info['Firmware Version']) throw new Error('not an ACTi camera');
  const n = actiValues(await actiCommand(ip, user, password, ['WAN_TYPE', 'WAN_IP', 'WAN_NETMASK', 'WAN_GATEWAY']));
  return {
    manufacturer: 'ACTi',
    model: (info['Production ID'] || '').split('-')[0] || info['Unit Type'] || null,
    firmware: info['Firmware Version'],
    serial: info['Production ID'] || null,
    network: {
      mac: info['MAC Address'] || null,
      dhcp: n.WAN_TYPE === '1', // 1 = dynamic (DHCP), 2 = static, 3 = PPPoE
      address: n.WAN_IP || ip,
      prefix: maskToPrefix(n.WAN_NETMASK || ''),
      gateway: n.WAN_GATEWAY || null,
    },
  };
}

function multipart(fields) {
  const boundary = `----monitor${crypto.randomBytes(8).toString('hex')}`;
  const body =
    Object.entries(fields).map(([k, v]) => `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`).join('') +
    `--${boundary}--\r\n`;
  return { body, headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` } };
}

// "Save Reboot" the way the camera's own web page (videoconfiguration.cgi) does
// it, for firmware whose URL commands have no SAVE_REBOOT.
async function actiWebSaveReboot(ip, user, password) {
  const url = `http://${ip}/cgi-bin/videoconfiguration.cgi`;
  const login = await httpText(url, { method: 'POST', timeoutMs: 8000, ...multipart({ LOGIN_ACCOUNT: user, LOGIN_PASSWORD: password, LANGUAGE: 0, btnSubmit: 'Login' }) });
  const hix = login.text.match(/name="HIDDEN_HIX" value="(\d+)"/)?.[1];
  if (!hix) throw new Error("could not log in to the camera's web page");
  await httpText(url, { method: 'POST', timeoutMs: 8000, ...multipart({ HIDDEN_STATE: 4118, HIDDEN_HIX: hix, HIDDEN_LANG: 0, btnSubmit: 'Apply' }) });
}

async function actiSaveReboot(ip, user, password) {
  let text;
  try {
    text = await actiCommand(ip, user, password, ['SAVE_REBOOT'], 8000);
  } catch (e) {
    if (['ECONNRESET', 'ETIMEDOUT', 'EPIPE'].includes(e.code)) return; // hung up while rebooting
    throw e;
  }
  if (/not found/i.test(text)) await actiWebSaveReboot(ip, user, password);
  else if (/ERROR/.test(text)) throw new Error(lastLine(text));
}

async function actiSetIp(host, user, password, newIp, prefix, gateway) {
  const current = actiValues(await actiCommand(host, user, password, ['WAN_TYPE', 'WAN_IP', 'WAN_NETMASK', 'WAN_GATEWAY']));
  if (!current.WAN_IP) throw Object.assign(new Error('camera did not report its network settings'), { status: 502 });
  const cmds = ['WAN_TYPE=2', `WAN_IP=${newIp}`, `WAN_NETMASK=${prefixToMask(prefix)}`];
  // Keep the old gateway only when it still fits the new range; the camera insists on having one.
  const gw = gateway || (current.WAN_GATEWAY && sameSubnet(current.WAN_GATEWAY, newIp, prefix) ? current.WAN_GATEWAY : null);
  const warnings = [];
  if (gw) cmds.push(`WAN_GATEWAY=${gw}`);
  else warnings.push('Gateway not changed, so the camera may not reach the internet (it doesn\'t need to for Monitor).');

  const reply = await actiCommand(host, user, password, cmds, 8000);
  const failed = reply.split(/\r?\n/).filter((l) => /ERROR/.test(l));
  if (failed.length) throw Object.assign(new Error(`Camera refused the new settings: ${failed.join('; ')}`), { status: 502 });

  // Settings only stick after Save & Reboot. Some firmware switches address
  // straight away, so save on whichever address still answers.
  const saveOn = (await tcpOpen(host, 80, 1500)) ? host : (await tcpOpen(newIp, 80, 1500)) ? newIp : null;
  if (!saveOn) {
    warnings.push('The camera stopped answering before the settings could be saved; restart it and check its address.');
    return { rebooting: false, warnings };
  }
  await actiSaveReboot(saveOn, user, password);
  return { rebooting: true, warnings };
}

// --- ACTi video settings (encoder, resolution, frame rate) ------------------
//
// system CGI:  V2_STREAMING_METHOD  0 = TCP only (ACTi's own protocol, no RTSP),
//              1 = multicast only, 3 = RTP over UDP, 4 = RTP over multicast, 5 = both
// encoder CGI: VIDEO_ENCODER (MPEG4|MJPEG), VIDEO_RESOLUTION (N1280x1024),
//              VIDEO_FPS_NUM, VIDEO_BITRATE (3M, 750K), VIDEO_MJPEG_QUALITY

const ACTI_STREAM_METHODS = { 0: 'TCP only (no RTSP)', 1: 'Multicast only', 3: 'RTP over UDP', 4: 'RTP over multicast', 5: 'RTP over UDP & multicast' };

async function actiEncoder(ip, user, password, cmds, timeoutMs = 5000) {
  const r = await httpText(`http://${ip}/cgi-bin/encoder?USER=${enc(user)}&PWD=${enc(password)}&${cmds.join('&')}`, { timeoutMs });
  if (/bad account|password/i.test(r.text) && /ERROR/.test(r.text)) throw new Error('wrong user name or password');
  if (r.status !== 200) throw new Error(`camera answered HTTP ${r.status}`);
  return r.text;
}

async function actiReadVideo(ip, user, password) {
  const sysInfo = await actiCommand(ip, user, password, ['SYSTEM_INFO']);
  if (!/Firmware Version/.test(sysInfo)) throw Object.assign(new Error('Not an ACTi camera (no ACTi URL commands)'), { status: 400 });
  const caps = sysInfo.match(/VIDEO_RESOLUTION_CAP\s*=\s*(.*)/)?.[1]?.split(',').map((s) => s.trim()).filter(Boolean) ?? [];
  const sys = actiValues(await actiCommand(ip, user, password, ['V2_STREAMING_METHOD']));
  const v = actiValues(
    await actiEncoder(ip, user, password, ['VIDEO_ENCODER', 'VIDEO_RESOLUTION', 'VIDEO_FPS_NUM', 'VIDEO_BITRATE', 'VIDEO_MJPEG_QUALITY', 'VIDEO_DAYNIGHT_MODE']),
  );
  return {
    model: sysInfo.match(/Production ID\s*=\s*([^-\s]+)/)?.[1] ?? null,
    streaming: sys.V2_STREAMING_METHOD ?? null,
    streamingName: ACTI_STREAM_METHODS[sys.V2_STREAMING_METHOD] ?? null,
    encoder: v.VIDEO_ENCODER ?? null,
    resolution: v.VIDEO_RESOLUTION ?? null,
    fps: Number(v.VIDEO_FPS_NUM) || null,
    bitrate: v.VIDEO_BITRATE ?? null,
    mjpegQuality: Number(v.VIDEO_MJPEG_QUALITY) || null,
    dayNight: v.VIDEO_DAYNIGHT_MODE ?? null, // AUTO | DAY | NIGHT; null when the camera has no such setting
    resolutions: caps,
  };
}

// Day/night: AUTO switches to black & white in the dark, DAY stays in colour,
// NIGHT stays black & white. Applies at once; never restarts the camera for it.
async function actiSetDayNight(cam, mode) {
  if (!['AUTO', 'DAY', 'NIGHT'].includes(mode)) throw Object.assign(new Error('Day/night must be AUTO, DAY or NIGHT'), { status: 400 });
  const { host, user, password } = cam;
  const reply = await actiEncoder(host, user, password, [`VIDEO_DAYNIGHT_MODE=${mode}`], 8000);
  if (/ERROR/.test(reply)) throw Object.assign(new Error(`Camera refused: ${lastLine(reply)}`), { status: 502 });
  const saved = /^OK/m.test(await actiCommand(host, user, password, ['SAVE'], 8000).catch(() => ''));
  console.log(`[${cam.name}] Day/night set to ${mode}${saved ? '' : ' (not saved: lasts until the camera restarts)'}.`);
  return { ok: true, saved };
}

// Saves without restarting when the firmware can; otherwise Save & Reboot.
async function actiSave(ip, user, password) {
  const text = await actiCommand(ip, user, password, ['SAVE'], 8000);
  if (/^OK/m.test(text)) return false;
  await actiSaveReboot(ip, user, password);
  return true;
}

async function actiApplyVideo(cam, body) {
  const fail = (msg, status = 400) => {
    throw Object.assign(new Error(msg), { status });
  };
  const encoder = body.encoder === 'MJPEG' ? 'MJPEG' : 'MPEG4';
  const resolution = String(body.resolution || '');
  const fps = Number(body.fps);
  if (!/^N\d+x\d+$/.test(resolution)) fail('Pick a resolution');
  if (!Number.isInteger(fps) || fps < 1 || fps > 30) fail('Frame rate must be 1 to 30');
  const cmds = [`VIDEO_ENCODER=${encoder}`, `VIDEO_RESOLUTION=${resolution}`, `VIDEO_FPS_NUM=${fps}`];
  if (encoder === 'MPEG4') {
    if (!/^\d+(\.\d+)?[KM]$/.test(String(body.bitrate || ''))) fail('Pick a bitrate');
    cmds.push(`VIDEO_BITRATE=${body.bitrate}`);
  } else {
    const q = Number(body.mjpegQuality);
    if (!Number.isInteger(q) || q < 1 || q > 100) fail('MJPEG quality must be 1 to 100');
    cmds.push(`VIDEO_MJPEG_QUALITY=${q}`);
  }

  const { host, user, password } = cam;
  const replies = [];
  // RTSP only runs with an RTP streaming method; "RTP over UDP" is what Monitor uses.
  const sys = actiValues(await actiCommand(host, user, password, ['V2_STREAMING_METHOD']));
  if (!['3', '5'].includes(sys.V2_STREAMING_METHOD)) replies.push(await actiCommand(host, user, password, ['V2_STREAMING_METHOD=3'], 8000));
  replies.push(await actiEncoder(host, user, password, cmds, 8000));
  const errors = replies.join('\n').split(/\r?\n/).filter((l) => /ERROR/.test(l));
  if (errors.length) fail(`Camera refused: ${errors.join('; ')}`, 502);

  const rebooting = await actiSave(host, user, password);

  // Monitor follows along: MPEG4 comes in over RTSP (this camera only does RTP
  // over UDP), MJPEG as snapshots, both at the camera's frame rate.
  const entry = (config.cameras ?? []).find((c) => c.id === cam.id);
  if (entry) {
    entry.mode = encoder === 'MPEG4' ? 'rtsp' : 'snapshot';
    entry.fps = fps;
    if (encoder === 'MPEG4') entry.rtspTransport = 'udp';
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n');
    applyConfig(config);
  }
  console.log(`[${cam.name}] Video set to ${encoder} ${resolution.slice(1)} @ ${fps} fps${rebooting ? ', camera restarting' : ''}.`);
  return { ok: true, rebooting, monitorUpdated: Boolean(entry) };
}

// The settings page sends a camera like for TEST: stored password unless one was typed.
function cameraFromBody(body) {
  const cfg = cleanConfig({ ...config, cameras: [body] }, config).cameras[0];
  return { ...normalizeCamera(cfg, 0), id: body.id ? String(body.id) : null };
}

async function describeCamera(dev) {
  if (!reachable(dev.ip)) return dev;
  for (const login of loginsFor(dev.ip)) {
    const d = new OnvifDevice(onvifUrl(dev.ip, dev.xaddr), login.user, login.password);
    try {
      const [info, netw] = await Promise.all([d.info(), d.network().catch(() => null)]);
      return { ...dev, ...info, network: netw, loginOk: true };
    } catch (e) {
      dev.loginError = e.message;
    }
  }
  return dev;
}

// Web devices found by the sweep: ACTi cameras answer ACTi's URL commands.
async function describeWebDevice(dev) {
  for (const login of loginsFor(dev.ip)) {
    try {
      return { ...dev, ...(await actiDescribe(dev.ip, login.user, login.password)), acti: true, loginOk: true };
    } catch (e) {
      if (e.message === 'wrong user name or password') Object.assign(dev, { acti: true, loginError: e.message });
      else if (!dev.acti) return dev;
    }
  }
  return dev;
}

async function scanNetwork() {
  const [onvif, web] = await Promise.all([discoverOnvif(), sweepHttp()]);
  const byIp = new Map(onvif.map((d) => [d.ip, d]));
  for (const w of web) {
    const d = byIp.get(w.ip);
    if (d) Object.assign(d, { server: w.server, title: w.title });
    else byIp.set(w.ip, { ...w, onvif: false });
  }
  const devices = await Promise.all([...byIp.values()].map((d) => (d.onvif ? describeCamera(d) : describeWebDevice(d))));
  const configured = new Map((config.cameras ?? []).map((c) => [c.host, c.name]));
  const isCam = (d) => Number(Boolean(d.onvif || d.acti));
  return devices
    .map((d) => ({ ...d, camera: Boolean(d.onvif || d.acti), reachable: reachable(d.ip), monitorName: configured.get(d.ip) ?? null }))
    .sort((a, b) => isCam(b) - isCam(a) || ipToInt(a.ip) - ipToInt(b.ip));
}

// Changes a camera's IP address, with ACTi's URL commands when the camera
// speaks them, otherwise over ONVIF.
async function changeCameraIp(body) {
  const fail = (msg, status = 400) => {
    throw Object.assign(new Error(msg), { status });
  };
  const host = String(body.host || '').trim();
  const newIp = String(body.newIp || '').trim();
  const gateway = String(body.gateway || '').trim();
  const prefix = Number(body.prefix || 24);
  if (!IPV4.test(host)) fail('Current camera address is not valid');
  if (!IPV4.test(newIp)) fail(`"${newIp}" is not a valid IP address`);
  if (!Number.isInteger(prefix) || prefix < 8 || prefix > 30) fail('Prefix length must be 8 to 30 (24 = 255.255.255.0)');
  if (gateway && !IPV4.test(gateway)) fail(`Gateway "${gateway}" is not a valid IP address`);
  if (gateway && !sameSubnet(gateway, newIp, prefix)) fail(`Gateway ${gateway} is not in the same range as ${newIp}/${prefix}`);
  if (!reachable(host)) fail(`This PC cannot reach ${host}. First add a PC address in that range (THIS PC section).`, 409);
  if (newIp !== host && (await addressInUse(newIp))) fail(`${newIp} is already in use by another device. Pick another address.`, 409);

  const stored = loginsFor(host)[0];
  const user = String(body.user || '').trim() || stored.user;
  const password = typeof body.password === 'string' && body.password !== '' ? body.password : stored.password;

  let acti = false;
  try {
    acti = /Firmware Version/.test(await actiCommand(host, user, password, ['SYSTEM_INFO']));
  } catch (e) {
    if (e.message === 'wrong user name or password') fail('Wrong user name or password for this camera', 401);
  }
  const { rebooting, warnings } = acti
    ? await actiSetIp(host, user, password, newIp, prefix, gateway)
    : await onvifSetIp(host, body.xaddr, user, password, newIp, prefix, gateway);

  // Point Monitor's own camera entries at the new address.
  const updated = [];
  if (newIp !== host) {
    for (const c of config.cameras ?? []) {
      if (c.host === host) {
        c.host = newIp;
        updated.push(c.name);
      }
    }
    if (updated.length) {
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n');
      applyConfig(config);
    }
  }
  if (!reachable(newIp)) warnings.push(`This PC is not in the ${newIp}/${prefix} range, so Monitor cannot reach the camera there yet.`);
  console.log(`Camera ${host} -> ${newIp}/${prefix} (${acti ? 'ACTi URL commands' : 'ONVIF'})${rebooting ? ', rebooting' : ''}.`);
  return { ok: true, rebooting, updated, warnings };
}

// Gateway first: once the address changes, the camera no longer answers on the old one.
async function onvifSetIp(host, xaddr, user, password, newIp, prefix, gateway) {
  const fail = (msg, status = 502) => {
    throw Object.assign(new Error(msg), { status });
  };
  const dev = new OnvifDevice(onvifUrl(host, xaddr), user, password);
  const current = await dev.network().catch((e) => fail(`Cannot read the camera's network settings: ${e.message}`));
  const warnings = [];

  if (gateway && gateway !== current.gateway) {
    try {
      await dev.call(`<tds:SetNetworkDefaultGateway><tds:IPv4Address>${gateway}</tds:IPv4Address></tds:SetNetworkDefaultGateway>`);
    } catch (e) {
      warnings.push(`Gateway not changed (${e.message}).`);
    }
  }

  let rebooting = false;
  try {
    const xml = await dev.call(
      `<tds:SetNetworkInterfaces><tds:InterfaceToken>${xmlEsc(current.token)}</tds:InterfaceToken><tds:NetworkInterface>` +
        '<tt:Enabled>true</tt:Enabled><tt:IPv4><tt:Enabled>true</tt:Enabled>' +
        `<tt:Manual><tt:Address>${newIp}</tt:Address><tt:PrefixLength>${prefix}</tt:PrefixLength></tt:Manual>` +
        '<tt:DHCP>false</tt:DHCP></tt:IPv4></tds:NetworkInterface></tds:SetNetworkInterfaces>',
      { timeoutMs: 8000 },
    );
    if (xmlText(xml, 'RebootNeeded') === 'true') {
      rebooting = true;
      await dev.call('<tds:SystemReboot/>').catch(() => {}); // the camera may hang up while rebooting
    }
  } catch (e) {
    // Many cameras switch address straight away and never send the reply.
    if (!['ETIMEDOUT', 'ECONNRESET', 'EPIPE'].includes(e.code)) fail(`Camera refused the new address: ${e.message}`);
    warnings.push('The camera stopped answering on the old address, which usually means it already switched.');
  }
  return { rebooting, warnings };
}

// --- This PC's network adapters (Windows) ----------------------------------

function powershell(script, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      windowsHide: true,
    });
    let out = '';
    let err = '';
    const timer = setTimeout(() => p.kill(), timeoutMs);
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    p.on('error', (e) => {
      clearTimeout(timer);
      reject(e);
    });
    p.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(out);
      else reject(new Error(lastLine(err.replace(/^\s*(\+|At line|CategoryInfo|FullyQualifiedErrorId).*$/gm, '')) || `PowerShell exited with code ${code}`));
    });
  });
}

// Runs a script as administrator. Windows shows its permission prompt (UAC) on
// this PC's screen. The elevated window can't hand back output, so it writes
// its result to a temp file.
async function powershellAdmin(script) {
  const out = path.join(os.tmpdir(), `monitor-${crypto.randomUUID()}.txt`);
  const inner =
    `$ErrorActionPreference = 'Stop'; try { ${script}; 'OK' | Set-Content -LiteralPath '${out}' } ` +
    `catch { $_.Exception.Message | Set-Content -LiteralPath '${out}' }`;
  const encoded = Buffer.from(inner, 'utf16le').toString('base64');
  try {
    await powershell(
      `Start-Process powershell.exe -Verb RunAs -WindowStyle Hidden -Wait -ArgumentList '-NoProfile','-NonInteractive','-EncodedCommand','${encoded}'`,
      180_000,
    );
  } catch (e) {
    throw new Error(/cancel/i.test(e.message) ? 'Cancelled: Windows permission was not given' : e.message);
  }
  let result;
  try {
    result = fs.readFileSync(out, 'utf8').trim();
  } catch {
    throw new Error('No result from the administrator window');
  } finally {
    fs.rmSync(out, { force: true });
  }
  if (result !== 'OK') throw new Error(result);
}

const LIST_ADAPTERS_PS = `
$ErrorActionPreference = 'SilentlyContinue'
$list = @(Get-NetAdapter -Physical | Sort-Object Name | ForEach-Object {
  $i = Get-NetIPInterface -InterfaceIndex $_.ifIndex -AddressFamily IPv4
  [pscustomobject]@{
    index = [int]$_.ifIndex; name = $_.Name; description = $_.InterfaceDescription; status = [string]$_.Status
    mac = $_.MacAddress; dhcp = ([string]$i.Dhcp -eq 'Enabled')
    addresses = @(Get-NetIPAddress -InterfaceIndex $_.ifIndex -AddressFamily IPv4 | ForEach-Object {
      [pscustomobject]@{ ip = $_.IPAddress; prefix = [int]$_.PrefixLength; origin = [string]$_.PrefixOrigin } })
    gateways = @(Get-NetRoute -InterfaceIndex $_.ifIndex -DestinationPrefix '0.0.0.0/0' | ForEach-Object { $_.NextHop })
  }
})
ConvertTo-Json -InputObject $list -Depth 4 -Compress`;

async function listAdapters() {
  if (process.platform === 'win32') {
    try {
      return JSON.parse((await powershell(LIST_ADAPTERS_PS)).trim() || '[]');
    } catch (e) {
      console.warn(`Could not list network adapters: ${e.message}`);
    }
  }
  // Read-only fallback: what Node can see.
  const byIface = new Map();
  for (const s of localSubnets()) {
    if (!byIface.has(s.iface)) byIface.set(s.iface, { index: null, name: s.iface, status: 'Up', dhcp: null, addresses: [], gateways: [] });
    byIface.get(s.iface).addresses.push({ ip: s.address, prefix: s.prefix, origin: 'Unknown' });
  }
  return [...byIface.values()];
}

async function changePcAddress(body) {
  const fail = (msg, status = 400) => {
    throw Object.assign(new Error(msg), { status });
  };
  if (process.platform !== 'win32') fail('Changing this PC\'s addresses is only supported on Windows');
  const index = Number(body.index);
  if (!Number.isInteger(index) || index <= 0) fail('Unknown network adapter');
  const adapter = (await listAdapters()).find((a) => a.index === index);
  if (!adapter) fail('Unknown network adapter');
  const ip = String(body.ip || '').trim();
  const prefix = Number(body.prefix || 24);

  if (body.action === 'add') {
    if (!IPV4.test(ip)) fail(`"${ip}" is not a valid IP address`);
    if (!Number.isInteger(prefix) || prefix < 8 || prefix > 30) fail('Prefix length must be 8 to 30 (24 = 255.255.255.0)');
    if (adapter.addresses.some((a) => a.ip === ip)) fail(`${adapter.name} already has ${ip}`);
    if (await addressInUse(ip)) fail(`${ip} is already in use by another device. Pick another address.`, 409);
    // DHCP/static coexistence keeps the adapter's normal (DHCP) address working next to the new one.
    await powershellAdmin(
      `$i = Get-NetIPInterface -InterfaceIndex ${index} -AddressFamily IPv4; ` +
        `if ($i.Dhcp -eq 'Enabled') { netsh interface ipv4 set interface ${index} dhcpstaticipcoexistence=enabled | Out-Null; ` +
        `if ($LASTEXITCODE) { throw 'This Windows version cannot add a fixed address next to DHCP (needs Windows 10 2004 or newer)' } }; ` +
        `New-NetIPAddress -InterfaceIndex ${index} -IPAddress '${ip}' -PrefixLength ${prefix} | Out-Null`,
    );
    console.log(`Added ${ip}/${prefix} to ${adapter.name}.`);
  } else if (body.action === 'remove') {
    if (!adapter.addresses.some((a) => a.ip === ip && a.origin === 'Manual')) fail(`${ip} is not a fixed address of ${adapter.name}`);
    await powershellAdmin(`Remove-NetIPAddress -InterfaceIndex ${index} -IPAddress '${ip}' -Confirm:$false`);
    console.log(`Removed ${ip} from ${adapter.name}.`);
  } else if (body.action === 'dhcp') {
    await powershellAdmin(
      `Get-NetIPAddress -InterfaceIndex ${index} -AddressFamily IPv4 -PrefixOrigin Manual -ErrorAction SilentlyContinue | Remove-NetIPAddress -Confirm:$false; ` +
        `Get-NetRoute -InterfaceIndex ${index} -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Where-Object Protocol -eq 'NetMgmt' | Remove-NetRoute -Confirm:$false; ` +
        `Set-NetIPInterface -InterfaceIndex ${index} -Dhcp Enabled; ` +
        `Set-DnsClientServerAddress -InterfaceIndex ${index} -ResetServerAddresses`,
    );
    console.log(`${adapter.name} set back to automatic (DHCP).`);
  } else fail('Unknown action');
  await sleep(1500); // let Windows bring the address up before listing again
  return listAdapters();
}

// --- ACTi IP Utility (for what Monitor doesn't do, like firmware upgrades) ---

function findIpUtility() {
  // Next to the exe, one folder up, or next to cameras.json (the desktop app's data folder).
  const roots = [...new Set([APP_DIR, path.dirname(APP_DIR), path.dirname(CONFIG_FILE)])];
  const hits = [];
  const look = (dir, depth) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isFile() && e.name.toLowerCase() === 'ip_utility.exe') hits.push(full);
      else if (e.isDirectory() && depth > 0 && /ip.?utility/i.test(e.name)) look(full, depth - 1);
    }
  };
  for (const r of roots) look(r, 2);
  for (const pf of [process.env['ProgramFiles(x86)'], process.env.ProgramFiles]) {
    if (pf) look(path.join(pf, 'ACTi'), 2);
  }
  // The standalone edition includes .NET, so it runs on any PC.
  return hits.sort((a, b) => /standalone/i.test(b) - /standalone/i.test(a))[0] ?? null;
}

function openIpUtility() {
  const exe = findIpUtility();
  if (!exe) throw Object.assign(new Error('ACTi IP Utility not found. Put its folder next to Monitor.'), { status: 404 });
  // Start-Process goes through the shell, so Windows can ask for admin rights if the utility needs them.
  spawn('powershell.exe', ['-NoProfile', '-Command', 'Start-Process -FilePath $env:IPU_EXE -WorkingDirectory (Split-Path $env:IPU_EXE)'], {
    env: { ...process.env, IPU_EXE: exe },
    windowsHide: true,
    stdio: 'ignore',
    detached: true,
  })
    .on('error', () => {})
    .unref();
  return exe;
}

// --- HTTP ---------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

const PAGES = { '/': 'index.html', '/settings': 'settings.html', '/network': 'network.html' };

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

function sendJpeg(res, frame) {
  res.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': frame.length, 'Cache-Control': 'no-store' });
  res.end(frame);
}

function readPublicFile(rel) {
  if (IS_EXE) return Buffer.from(sea.getAsset(rel));
  return fs.readFileSync(path.join(PUBLIC_DIR, rel));
}

function serveStatic(res, pathname) {
  const rel = PAGES[pathname] ?? decodeURIComponent(pathname).replace(/^\/+/, '');
  if (!rel || rel.split(/[\\/]/).includes('..')) return sendJson(res, 403, { error: 'forbidden' });
  try {
    const data = readPublicFile(rel);
    res.writeHead(200, { 'Content-Type': MIME[path.extname(rel)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  } catch {
    sendJson(res, 404, { error: 'not found' });
  }
}

function readJson(req, limit = 1_000_000) {
  return new Promise((resolve, reject) => {
    // Requiring a JSON content type blocks cross-site form posts from other websites.
    if (!String(req.headers['content-type'] || '').includes('application/json')) {
      return reject(Object.assign(new Error('expected application/json'), { status: 415 }));
    }
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('request too large'), { status: 413 }));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(Object.assign(new Error('invalid JSON'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

async function handleSnapshot(res, feed) {
  try {
    sendJpeg(res, await feed.snapshot());
  } catch (e) {
    sendJson(res, 502, { error: e.message });
  }
}

function handleStream(req, res, feed) {
  res.writeHead(200, {
    'Content-Type': `multipart/x-mixed-replace; boundary=${BOUNDARY}`,
    'Cache-Control': 'no-store',
    Connection: 'close',
  });
  const unsubscribe = feed.subscribe({
    onFrame(frame) {
      // dropLate: skip frames while the previous one is still being sent, since a queue
      // of frames for a slow viewer is a delay that never catches up. Otherwise queue up to ~1 MB.
      if (res.writableLength > (feed.cam.dropLate ? frame.length : 1_000_000)) return;
      res.write(`--${BOUNDARY}\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`);
      res.write(frame);
      res.write('\r\n');
    },
    onClose: () => res.end(),
  });
  req.on('close', unsubscribe);
}

// Several cameras over one connection, for the LIVE page: browsers open at
// most ~6 connections per server, so one MJPEG stream per camera stalls beyond
// that. Same multipart format as handleStream, each part names its camera in X-Camera.
function handleMultiStream(req, res, ids) {
  const list = [...new Set(ids)].map((id) => feeds.get(id)).filter(Boolean);
  if (!list.length) return sendJson(res, 404, { error: 'unknown camera' });
  res.writeHead(200, {
    'Content-Type': `multipart/x-mixed-replace; boundary=${BOUNDARY}`,
    'Cache-Control': 'no-store',
    Connection: 'close',
  });
  const unsubscribes = list.map((feed) =>
    feed.subscribe({
      onFrame(frame) {
        if (res.writableLength > (feed.cam.dropLate ? frame.length : 1_000_000)) return;
        res.write(`--${BOUNDARY}\r\nContent-Type: image/jpeg\r\nX-Camera: ${enc(feed.cam.id)}\r\nContent-Length: ${frame.length}\r\n\r\n`);
        res.write(frame);
        res.write('\r\n');
      },
      onClose: () => res.end(),
    }),
  );
  req.on('close', () => unsubscribes.forEach((u) => u()));
}

async function handleSaveConfig(req, res) {
  const next = cleanConfig(await readJson(req), config);
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(next, null, 2) + '\n');
  const portChanged = next.port !== currentPort && !process.env.PORT;
  applyConfig(next);
  console.log(`Settings saved (${next.cameras.length} camera${next.cameras.length === 1 ? '' : 's'}).`);
  sendJson(res, 200, { ok: true, port: portChanged ? next.port : currentPort, portChanged, config: publicConfig(), ffmpeg: ffmpegPath });
  if (portChanged) setTimeout(() => relisten(next.port), 300);
}

// Tests a camera from the settings page, which may not be saved yet.
async function handleTest(req, res, type) {
  const body = await readJson(req);
  const cfg = cleanConfig({ ...config, cameras: [body] }, config).cameras[0];
  const cam = normalizeCamera(cfg, 0);
  try {
    sendJpeg(res, type === 'rtsp' ? await grabRtspFrame(cam) : await fetchJpeg(cam));
  } catch (e) {
    sendJson(res, 502, { error: e.message });
  }
}

async function route(req, res) {
  const { pathname, searchParams } = new URL(req.url, 'http://localhost');

  if (pathname === '/api/cameras') {
    return sendJson(res, 200, {
      overviewRefreshMs: config.overviewRefreshMs ?? 1000,
      ffmpeg: ffmpegPath !== null,
      share: shareUrls(),
      cameras: [...feeds.values()].map((f) => f.status()),
    });
  }

  if (pathname === '/api/config') {
    if (req.method === 'GET') return sendJson(res, 200, { config: publicConfig(), ffmpeg: ffmpegPath, configFile: CONFIG_FILE, share: shareUrls() });
    if (req.method === 'PUT') return handleSaveConfig(req, res);
    return sendJson(res, 405, { error: 'method not allowed' });
  }

  if (pathname === '/api/test' && req.method === 'POST') {
    return handleTest(req, res, searchParams.get('type'));
  }

  if (pathname === '/api/camera-video' && req.method === 'POST') {
    const body = await readJson(req);
    const cam = cameraFromBody(body.camera ?? {});
    if (body.dayNight) return sendJson(res, 200, await actiSetDayNight(cam, body.dayNight));
    if (!body.apply) return sendJson(res, 200, await actiReadVideo(cam.host, cam.user, cam.password));
    return sendJson(res, 200, await actiApplyVideo(cam, body.apply));
  }

  if (pathname === '/api/network' && req.method === 'GET') {
    const local = isLocalRequest(req);
    return sendJson(res, 200, {
      local,
      canChangePc: local && process.platform === 'win32',
      adapters: await listAdapters(),
      ipUtility: local && process.platform === 'win32' && findIpUtility() !== null,
    });
  }
  if (pathname === '/api/network/scan' && req.method === 'POST') {
    return sendJson(res, 200, { devices: await scanNetwork(), subnets: localSubnets() });
  }
  if (pathname === '/api/network/camera-ip' && req.method === 'POST') {
    return sendJson(res, 200, await changeCameraIp(await readJson(req)));
  }
  // Changing this PC's network settings needs someone at this PC to approve the Windows prompt.
  if (pathname === '/api/network/pc' && req.method === 'POST') {
    if (!isLocalRequest(req)) return sendJson(res, 403, { error: 'Change this PC\'s network settings on the PC itself' });
    return sendJson(res, 200, { adapters: await changePcAddress(await readJson(req)) });
  }
  if (pathname === '/api/network/ip-utility' && req.method === 'POST') {
    if (!isLocalRequest(req)) return sendJson(res, 403, { error: 'Open the IP Utility on the PC itself' });
    return sendJson(res, 200, { ok: true, path: openIpUtility() });
  }

  if (pathname === '/api/multistream') return handleMultiStream(req, res, searchParams.getAll('id'));

  const m = pathname.match(/^\/api\/cameras\/([^/]+)(?:\/(snapshot|stream))?$/);
  if (m) {
    const feed = feeds.get(decodeURIComponent(m[1]));
    if (!feed) return sendJson(res, 404, { error: 'unknown camera' });
    if (m[2] === 'snapshot') return handleSnapshot(res, feed);
    if (m[2] === 'stream') return handleStream(req, res, feed);
    return sendJson(res, 200, feed.status());
  }

  if (req.method !== 'GET') return sendJson(res, 405, { error: 'method not allowed' });
  serveStatic(res, pathname);
}

const server = http.createServer((req, res) => {
  route(req, res).catch((e) => {
    if (!res.headersSent) sendJson(res, e.status || 500, { error: e.message });
    else res.end();
  });
});

function listen(port) {
  return new Promise((resolve, reject) => {
    const onError = (e) => {
      server.off('listening', onListening);
      reject(e);
    };
    const onListening = () => {
      server.off('error', onError);
      currentPort = port;
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port);
  });
}

async function relisten(port) {
  const oldPort = currentPort;
  server.closeAllConnections();
  await new Promise((r) => server.close(r));
  try {
    await listen(port);
    printUrls();
  } catch (e) {
    console.error(`Port ${port} is not available (${e.code}). Staying on port ${oldPort}.`);
    await listen(oldPort);
  }
}

// --- Startup --------------------------------------------------------------

// Addresses other devices can use to open Monitor, best first. An address that
// only exists to reach cameras (e.g. the extra 192.168.0.250 for cameras at
// 192.168.0.x) is useless for phones and PCs on the home network, so it goes last.
function shareUrls() {
  const subnets = localSubnets().filter((s) => !s.address.startsWith('169.254.'));
  const hasCamera = (s) => (config.cameras ?? []).some((c) => IPV4.test(c.host || '') && sameSubnet(c.host, s.address, s.prefix));
  const mixed = subnets.some((s) => hasCamera(s)) && subnets.some((s) => !hasCamera(s));
  return subnets
    .map((s) => ({ ip: s.address, iface: s.iface, url: `http://${s.address}:${currentPort}`, cameraNetwork: mixed && hasCamera(s) }))
    .sort((a, b) => a.cameraNetwork - b.cameraNetwork);
}

function printUrls() {
  console.log('');
  console.log(`  Monitor is running.`);
  console.log(`  On this PC:        http://localhost:${currentPort}`);
  for (const s of shareUrls()) console.log(`  From other PCs:    ${s.url}${s.cameraNetwork ? '   (camera network only)' : ''}`);
  console.log(`  Camera settings:   http://localhost:${currentPort}/settings`);
  console.log(`  Find cameras / IP: http://localhost:${currentPort}/network`);
  console.log('');
}

function openBrowser(url) {
  const [cmd, args] =
    process.platform === 'win32' ? ['explorer.exe', [url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try {
    spawn(cmd, args, { detached: true, stdio: 'ignore' }).on('error', () => {}).unref();
  } catch {}
}

// When started as an exe the console window would close before the error can be read.
function fatal(msg) {
  console.error(`\n  ERROR: ${msg}\n`);
  if (!IS_EXE || SIDECAR) process.exit(1);
  console.log('  Press Enter to close this window.');
  process.stdin.resume();
  process.stdin.once('data', () => process.exit(1));
}

async function main() {
  process.title = 'Monitor';
  try {
    applyConfig(loadConfig());
  } catch (e) {
    return fatal(`Could not read ${CONFIG_FILE}: ${e.message}`);
  }

  const port = Number(process.env.PORT || config.port || 8080);
  try {
    await listen(port);
  } catch (e) {
    // Another Monitor (e.g. Monitor.exe) already serves this port: let the app window show that one.
    if (e.code === 'EADDRINUSE' && SIDECAR && (await isMonitorAt(port))) {
      console.log(`Port ${port} is already served by another Monitor; using that one.`);
      console.log(`MONITOR_URL http://localhost:${port}`);
      return setTimeout(() => process.exit(0), 200);
    }
    if (e.code === 'EADDRINUSE' && OPEN_BROWSER) {
      console.log(`Port ${port} is already in use, probably by Monitor itself. Opening it in the browser.`);
      openBrowser(`http://localhost:${port}`);
      return setTimeout(() => process.exit(0), 2000);
    }
    return fatal(e.code === 'EADDRINUSE' ? `Port ${port} is already in use by another program. Change "port" in ${CONFIG_FILE}.` : e.message);
  }

  printUrls();
  console.log(`  Settings file:     ${CONFIG_FILE}`);
  console.log(`  ffmpeg:            ${ffmpegPath ? `found (${ffmpegPath})` : 'not found, RTSP cameras use snapshot mode'}`);
  for (const f of feeds.values()) console.log(`    - ${f.cam.name} [${f.cam.mode}, ${f.cam.fps} fps]`);
  if (IS_EXE && !SIDECAR) console.log('\n  Close this window to stop Monitor.');
  console.log('');
  if (OPEN_BROWSER) openBrowser(`http://localhost:${port}`);
  if (SIDECAR) {
    console.log(`MONITOR_URL http://localhost:${port}`); // the app window waits for this line
    // The app writes "quit" (or its pipe closes when it exits): stop ffmpeg before leaving.
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (d) => d.includes('quit') && shutdown());
    process.stdin.on('end', shutdown);
    process.stdin.resume();
  }
}

function shutdown() {
  for (const f of feeds.values()) f.destroy();
  server.closeAllConnections();
  process.exit(0);
}

function isMonitorAt(port) {
  return httpText(`http://localhost:${port}/api/cameras`, { timeoutMs: 2000 })
    .then((r) => r.status === 200 && Array.isArray(JSON.parse(r.text).cameras))
    .catch(() => false);
}

main();
