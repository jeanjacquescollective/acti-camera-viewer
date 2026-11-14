# Monitor

**English** · [Nederlands](README.md)

Watch your IP cameras on your PC, phone or tablet. **OVERVIEW** shows a picture of every camera, refreshed every second.
Click one to watch it **LIVE**. LIVE shows 1, 4, 6, 8 or 9 cameras at once, and you choose which camera goes where.
Works in any browser. No ActiveX or Internet Explorer needed, as old ACTi cameras used to require.

Made for ACTi cameras (such as the ACM-5601), but other brands with a snapshot or RTSP address work too.

**Contents**

- [What you need](#what-you-need)
- [Hardware setup](#hardware-setup)
- [Network cables](#network-cables)
- [Install (step by step)](#install-step-by-step)
- [Connect your first camera](#connect-your-first-camera)
- [Daily use](#daily-use)
- [Watch on your phone or another PC](#watch-on-your-phone-or-another-pc)
- [Problems?](#problems)
- [For developers](#for-developers)

---

## What you need

- A **Windows 10 or 11 PC** that stays on while you want to watch. This PC talks to the cameras; phones and other PCs
  watch through it.
- One or more **IP cameras**, connected to the same router or network switch as the PC.
- A **network cable** per camera, see below.
- Optional: **ffmpeg**, a free program that makes the live picture smoother (see step 3 of the installation). Monitor
  works without it too.

## Hardware setup

Everything hangs off your router, usually through a **network switch** (a box with extra network ports):

```
                      Internet
                         │
                     [ Router ] ──── Wi-Fi ──── phones, tablets, laptops
                         │
        [ PoE switch ] ──┴── Monitor PC (with a cable, not Wi-Fi)
         │    │    │
       cam1 cam2 cam3 …
```

- **Monitor PC on a cable.** All camera video passes through this PC, so give it a network cable to the router or
  switch. Over Wi-Fi it works, but less smoothly with several cameras.
- **A switch for the cameras.** Few free ports on your router? A switch adds them. A **PoE switch** also powers the
  cameras through the network cable, so a camera on the wall needs just one cable. Check the PoE budget: count about
  **7 W per camera** (more with night lights/IR) and pick a switch whose total "PoE budget" is higher than that.
- **No PoE?** Then each camera needs its own power adapter near the camera, or a **PoE injector** (a small adapter that
  puts power on the cable) per camera.
- **Placement.** Mount cameras out of reach and under an overhang (rain and direct sun shorten their life). Not aimed at a
  lamp or the sun: the picture goes white. Indoor cameras (such as the ACM-5601) are not weatherproof: outdoors, use an
  outdoor camera or a protective housing.
- **Power outages.** Want the cameras to keep running briefly? Put router, switch and PC on a small **UPS** (backup battery).
- **Wireless cameras** (Wi-Fi) work too, as long as they have a fixed address in your network. A cable is more reliable.

## Network cables

Cameras connect with ordinary network cables (RJ45, also called "UTP" or "ethernet cables"). In short:

| | Advice |
|---|---|
| **Type** | **Cat6** for new cables. Cat5e is fine too (cameras need far less than its 1 Gbit/s). Avoid Cat5 and older. |
| **Length** | At most **100 m** per cable, from the camera to the switch or router. Longer needs a switch in between. |
| **Copper** | Buy **pure copper** ("solid copper" / "100% copper"). Cheap **CCA** cable (copper-clad aluminium) breaks more easily and causes trouble with PoE. |
| **Outdoors** | An **outdoor cable** (black, UV-resistant PE jacket). Indoor cable goes brittle in the sun. Underground: in a conduit, or gel-filled burial cable. |
| **PoE** | Power over the network cable: one cable for picture and power. Only if camera and switch both support it (check the label or manual, "802.3af"). Otherwise use the camera's power adapter. |
| **Plugs** | Ready-made cables are the easiest. Crimping them yourself: use the same standard (**T568B**) at both ends. |

Flat cables and very thin cables are fine for short runs indoors, but not for long runs or PoE.

## Install (step by step)

### 1. Install Monitor

You received one of these two files:

- **`Monitor_1.2.0_x64-setup.exe`** (the app, recommended): double-click it, and Monitor installs itself. Then start
  **Monitor** from the Start menu. It opens in its own window.
- **`Monitor.exe`** (no installation): put it in a folder of your own, e.g. `Documents\Monitor`, and double-click it.
  A black window opens (leave it open; it is Monitor itself) and your browser shows Monitor.

Does Windows say *"Windows protected your PC"*? That's because the program has no paid signature. Click
**More info** and then **Run anyway**.

### 2. Allow it through the firewall

The first time, Windows asks whether Monitor may use the network. Tick **Private networks** and click **Allow**. You
need this to watch from your phone or another PC.

### 3. Optional: smoother video with ffmpeg

Without ffmpeg, Monitor shows a few pictures per second. With ffmpeg you get smooth video.

1. Click Start, type **Terminal** and open it.
2. Type `winget install Gyan.FFmpeg` and press Enter. Confirm with `Y` if it asks.
3. Close Monitor and start it again.

Under SETUP > ADVANCED > SYSTEM you can see whether Monitor found ffmpeg.

### 4. Start automatically with Windows (optional)

Press **Windows key + R**, type `shell:startup` and press Enter. A folder opens: put a shortcut to Monitor in it
(right-click the Monitor icon > *Show more options* > *Create shortcut*, then drag it there).

## Connect your first camera

New ACTi cameras start at address `192.168.0.100`, login `Admin` / `123456`. Your home network usually uses a different
range (e.g. `192.168.1.x`), so at first your PC can't reach the camera. Monitor solves that for you:

1. Connect the camera to the router or switch and wait a minute until it has started.
2. Click **NETWORK** (top right) and then **SCAN**. Monitor searches the network.
3. Is the camera **not reachable** from your PC? Click **PUT PC IN THIS RANGE** on the camera and then
   **ADD PC ADDRESS**. Windows asks for permission: click **Yes**. Your PC gets an extra address; internet keeps working.
4. Click **SCAN** again. Then click **CHANGE IP** on the camera: Monitor suggests a free address in your home network.
   Click **CHANGE**. The camera restarts (about a minute).
5. Click **ADD TO MONITOR**. You land in SETUP with the camera filled in. Check the login and click **SAVE**.
6. Optional: remove the extra PC address again under NETWORK > THIS PC (**REMOVE**).

Done: the camera shows in **OVERVIEW**. Does it say *NO SIGNAL*? Use **TEST SNAPSHOT** in SETUP: it shows a picture, or
the exact error.

## Daily use

**OVERVIEW** shows all cameras. Click a camera to watch it LIVE.

**LIVE** fills the whole screen. Tap the picture (or press `C`) for the buttons:

- **1 / 4 / 6 / 8 / 9**: how many cameras at once. Each gets an equal part of the screen.
- **Choose cameras**: click a spot (green frame), then pick the camera in the menu at the bottom, or step with the arrows.
  So a 4-screen can show cameras 1, 4, 8 and 9.
- **Double-click** a spot (double tap on a phone): that camera alone. Double-click again or `Esc` goes back.
- **SNAPSHOT** saves a picture. **LINK** gives the address of this view for another device.
- **FILL** lets the video fill the whole screen without black bars (the edges get cut off). Handy on a phone.
- **FULLSCREEN**, or press `F`.

**SETUP** holds the camera settings. **BASIC** shows what you need: name, address, login and **DAY/NIGHT**
(**AUTO**: colour by day and black & white in the dark, **DAY**: always colour, **NIGHT**: always black & white). Day/night
changes the camera straight away. For everything else, click **SAVE** at the bottom. **ADVANCED** shows all options.

**NETWORK** is for addresses: finding cameras, giving them an IP address, and the addresses of this PC.

**Keys in LIVE:** `C` buttons on/off · `1` `4` `6` `8` `9` layout · `↑` `↓` select a spot · `←` `→` previous/next camera ·
`Z` fill · `F` fullscreen · `L` link · `Esc` back

## Watch on your phone or another PC

The PC running Monitor must stay on, and the other device must be on the **same network** (same router or Wi-Fi).

1. In OVERVIEW, the top bar shows **OTHER PCs** with an address such as `http://192.168.1.25:8080`. Click **COPY**.
2. Open that address in the browser of your phone or other PC. Add a bookmark, or on your phone: *Add to home screen*.

A single camera or a fixed set of cameras has its own address: use **LINK** in LIVE.

**Tip:** your router can give the PC a different address after a restart, and then the bookmark stops working. In your
router's settings, give the PC a fixed address ("DHCP reservation").

## Problems?

**A camera shows NO SIGNAL**
- Check the cable and the camera's power (does a light blink on the network port?).
- SETUP > **TEST SNAPSHOT** shows the exact error. *Wrong user name or password*: correct the login and SAVE.
  *Timeout*: the PC can't reach the camera, see NETWORK > SCAN.

**The phone or other PC doesn't load Monitor**
- Is the phone on the same Wi-Fi, and not on a guest network? Guest Wi-Fi often blocks this.
- Firewall: open PowerShell **as administrator** on the Monitor PC and run:
  ```powershell
  New-NetFirewallRule -DisplayName "Monitor" -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow -Profile Private
  ```
  Also check under Settings > Network & internet that your network is set to **Private**, not Public.
- Did you once give your PC a fixed `192.168.0.x` address by hand to reach a camera? Set it back to automatic (NETWORK >
  THIS PC > **BACK TO AUTOMATIC**).

**The picture is jerky or lags behind** — Install ffmpeg (step 3). Still lagging? SETUP > ADVANCED > CONNECTION & LIVE
DELAY > preset *LOWEST DELAY*.

**Firmware updates or config backup** — Monitor doesn't do these; use the ACTi IP Utility. NETWORK > **OPEN IP UTILITY**
starts it when its folder (`IP_Utility_...`) is next to Monitor.

**Security** — Monitor has no login of its own: anyone on your network can watch and change settings. Use it only at home
or at work, and never open port 8080 to the internet on your router.

---

## For developers

### Quick setup

Needs Node.js 20+ and Windows (the network page uses PowerShell; the viewer itself also runs elsewhere).

```powershell
git clone <repo> acti-camera-viewer
cd acti-camera-viewer
npm install
winget install Gyan.FFmpeg     # optional: RTSP mode
npm run dev                    # http://localhost:8080, opens the browser (npm run serve: without browser)
```

The first start creates `cameras.json` with a default camera (`192.168.0.100`, `admin` / `123456`). It is in
`.gitignore` because it contains passwords. The server has no build step: edit `server.js` or `public/` and restart (or
just reload for `public/`).

### Build

- `npm run build:exe` → `dist\Monitor.exe`: a copy of `node.exe` with `server.js` and `public/` embedded (Node single
  executable application). Close a running Monitor first. In `dist\` the exe uses the project's `cameras.json`; elsewhere
  a `cameras.json` next to the exe. Put `ffmpeg.exe` next to it and Monitor uses it.
- `npm run build:app` → the Tauri desktop app with installer
  (`src-tauri\target\release\bundle\nsis\Monitor_<version>_x64-setup.exe`). Builds the exe first and adds it as a sidecar.
  Needs Rust (`winget install Rustlang.Rustup`) and the Visual Studio C++ build tools; the first build takes a few
  minutes. The app keeps its settings in `%APPDATA%\com.monitor.cameraviewer\cameras.json`, its log in `monitor.log` next
  to it. If another Monitor already serves the same port, the app shows that one.

### Structure

| | |
|---|---|
| `server.js` | HTTP server: camera proxy (snapshot/RTSP via ffmpeg), settings API, network/ONVIF/ACTi functions |
| `public/` | The web pages: `index.html` + `app.js` (overview and LIVE), `settings.*`, `network.*`, `modal.js`, `style.css` |
| `src-tauri/` | Desktop app (Rust/Tauri): starts the server hidden and shows the pages in a window |
| `build-exe.js`, `build-app.js` | Build scripts |

### API (short)

`GET /api/cameras` status of all cameras · `GET /api/cameras/:id/snapshot` one JPEG · `GET /api/cameras/:id/stream`
MJPEG · `GET /api/multistream?id=1&id=2` several cameras over one connection (multipart, each part with `X-Camera`) ·
`GET|PUT /api/config` settings · `POST /api/camera-video` read/set ACTi video and day/night · `/api/network/*` scan,
camera IP, PC addresses.

LIVE addresses: `#live=4&cams=1,4,8,9` (empty spot: `cams=1,,8,9`); old `#cam=1` links still work.

### cameras.json

SETUP edits this file. By hand also works; restart Monitor afterwards.

```json
{
  "port": 8080,
  "overviewRefreshMs": 1000,
  "cameras": [
    { "id": "1", "name": "Entrance", "host": "192.168.0.100", "user": "admin", "password": "123456" },
    { "id": "2", "name": "Garden",   "host": "192.168.0.101", "user": "admin", "password": "123456", "mode": "rtsp", "fps": 10 }
  ]
}
```

| Field | Default | Meaning |
|---|---|---|
| `host` | | Camera IP address |
| `user` / `password` | `admin` / `123456` | Camera login |
| `mode` | `snapshot` | `snapshot`: polls the camera's JPEG snapshot (no extra software). `rtsp`: decodes the RTSP stream with ffmpeg (smoother) |
| `fps` | `5` | Frame rate of the live picture |
| `httpPort` / `rtspPort` | `80` / `7070` | Camera ports |
| `snapshotUrl` / `rtspUrl` | ACTi URLs | Override for other camera brands |
| `rtspTransport` | `tcp` | `tcp` or `udp` |
| `lowDelay`, `fastStart`, `jitterMs`, `pacing`, `jpegQuality`, `dropLate` | see below | Live delay options |

### RTSP and automatic fallback

Snapshots are the safety net; RTSP runs in the background on top of them, so the picture never stops:

- When a camera is opened, snapshots start right away while RTSP connects. As soon as RTSP delivers video, it takes over.
- RTSP frames about 1 s late: snapshots fill in. No frame for 3 s, or no video within 8 s of connecting: ffmpeg restarts.
- Retries after 1 s, 3 s, 10 s, 30 s, then every 60 s. A stream that ran fine for 30 s starts the schedule afresh.

LIVE shows the active mode at the bottom left (`RTSP`, `SNAPSHOT (CONNECTING RTSP)`, …) when the controls are open.

**Live delay** (SETUP > ADVANCED > CONNECTION & LIVE DELAY):

| Option | Lowest delay | Balanced (default) | Smoothest |
|---|---|---|---|
| Low-delay decoding (ffmpeg doesn't buffer) | on | on | off |
| Fast start (first picture after ~1 s instead of ~3-4 s) | on | on | off |
| Wait for late packets (UDP) | 0 ms | 200 ms | 500 ms |
| Frame pacing | as they arrive | as they arrive | exact fps |
| Picture quality (2 = best … 12 = smallest) | 5 | 5 | 3 |
| Slow viewers | skip frames | skip frames | queue frames |

Measured on an ACM-5601 at 1280x1024: *Balanced* gives the first picture after ~1 s (was 3.6 s) and frames arrive evenly
instead of in bursts. *Lowest delay* can show broken frames on a busy network.

### ACTi specifics

- **MPEG4 or MJPEG** (SETUP > ADVANCED > IN THE CAMERA > VIDEO): MPEG4 1280x1024, 8 fps, 3 Mbps comes in over RTSP
  (smooth, little traffic, needs ffmpeg). MJPEG 1280x1024, 8 fps, quality 70 comes in as snapshots (sharpest frames,
  ~2 MB/s). 8 fps is the maximum at 1280x1024 (10 at 1280x720, 30 at 640x480). Monitor sets its own mode to match.
- **RTSP doesn't work?** Older ACTi cameras only run RTSP with an "RTP" *Streaming Method*; with the factory setting
  *TCP Only*, port 7070 is closed. Applying MPEG4 sets it to *RTP over UDP*. These cameras refuse RTSP over TCP ("400 Bad
  Request"); Monitor then switches to UDP by itself.
- **Day/night**: `encoder?VIDEO_DAYNIGHT_MODE=AUTO|DAY|NIGHT`, then `system?SAVE` (no reboot; firmware without SAVE
  keeps the setting until the next restart).
- **IP change**: ACTi URL commands when available (`WAN_IP`, `WAN_NETMASK`, `WAN_GATEWAY`, then *Save & Reboot*, ~1 min),
  otherwise ONVIF. A camera on *Dynamic IP* falls back to `192.168.0.100` without DHCP.
- **Scan**: ONVIF WS-Discovery (also finds cameras in other ranges) plus a port-80 sweep of the PC's own /24 networks
  (finds ACTi cameras without ONVIF).
- Changing PC addresses only works on Windows and only from the Monitor PC itself (UAC prompt).
