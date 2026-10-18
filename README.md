# Monitor

View several IP cameras in the browser. **OVERVIEW** shows a picture of every camera, refreshed every second; click one
to watch it **LIVE**. LIVE shows 1, 4, 6, 8 or 9 cameras at once, and you pick which camera goes in which spot.
Works in any browser (no ActiveX / Internet Explorer needed).

## Start it

**Easiest: the desktop app.** Run `Monitor_1.2.0_x64-setup.exe` (from `src-tauri\target\release\bundle\nsis\`) once to
install it, then start **Monitor** from the Start menu. It opens in its own window, without a browser or console window.
Closing the window stops Monitor (also for other devices). Starting it again while it runs brings the window to the front.
The app keeps its settings in `%APPDATA%\com.monitor.cameraviewer\cameras.json` and its log in `monitor.log` next to it.
If an older Monitor (`Monitor.exe` or `npm start`) already runs on the same port, the app shows that one instead.

**The exe.** Double-click `dist\Monitor.exe`. A console window opens with the addresses, and the browser opens
the monitor. Close that window to stop Monitor. Starting it a second time just opens the browser again.

The exe is self-contained (Node.js is built in). In `dist\` it uses the project's own `cameras.json`, the same one as
`npm start`, so both always see the same cameras. To put it somewhere else, copy `Monitor.exe` together with a
`cameras.json`. If `cameras.json` is missing there, the exe creates one with a default camera. You can also put `ffmpeg.exe`
in the same folder and Monitor will use it.

Windows SmartScreen may warn the first time ("Windows protected your PC") because the exe isn't signed:
click *More info* > *Run anyway*.

**From the source:** `npm start` (opens the browser) or `npm run serve` (doesn't).

To start Monitor automatically when Windows starts: press Win+R, type `shell:startup`, and put a shortcut to
`Monitor.exe` in that folder.

## Camera settings

Click **SETUP** (top right), or go to http://localhost:8080/settings. **BASIC** / **ADVANCED** at the top picks how much
it shows (each browser remembers it).

**BASIC** is what you need to add a camera and see it:

- add, remove and reorder cameras, and set the name, IP address and login
- **IN THE CAMERA: DAY/NIGHT** (ACTi cameras): **AUTO** (colour by day, black & white in the dark), **DAY** (always colour)
  or **NIGHT** (always black & white). This changes the camera itself, straight away: no SAVE needed
- **TEST SNAPSHOT**: check a camera before saving, with a preview image or the exact error
- **WEB UI**: open the camera's own web interface
- **LIVE FROM OTHER PCs**: the exact link to watch that camera on another PC or phone, with **COPY**

**ADVANCED** adds the web port, overview refresh and ffmpeg path (SYSTEM), each camera's mode (RTSP/snapshot) and frame
rate, **CONNECTION & LIVE DELAY** (ports, RTSP transport, URL overrides, live view delay), **TEST RTSP**, and the camera's
**VIDEO** (MPEG4 / MJPEG, resolution, frame rate) next to day/night, see below.

**SAVE** (or Ctrl+S) writes `cameras.json` and applies the changes immediately, without a restart. Open live views
reconnect by themselves. Passwords are never sent to the browser: leave a password field empty to keep the stored one.

**SETUP or NETWORK?** SETUP is per camera: which cameras Monitor shows, how it connects to them, and the camera's picture
(day/night, video). NETWORK is about addresses: finding cameras, giving them an IP address, and giving this PC an address
in a camera's range.

## Find cameras and set IP addresses

Click **NETWORK** (top right), or go to http://localhost:8080/network. This page does what the ACTi IP Utility is
usually needed for:

- **SCAN** finds cameras on every network this PC is connected to. ONVIF cameras are found also in another IP range;
  ACTi cameras without ONVIF (older models such as the ACM-5601) are found in the PC's own ranges. It shows model, firmware,
  MAC and whether this PC can reach the camera. Other web devices are listed under *OTHER WEB DEVICES*.
- **ADD TO MONITOR** opens SETUP with that camera filled in. Check the login and save.
- **CHANGE IP** gives the camera a new fixed address. Monitor suggests one in your home network (with your router as
  gateway). It refuses an address that is already in use, and updates the camera's entry in Monitor by itself.
- **THIS PC** lists the network adapters. To reach a camera in another range (a new ACTi camera starts at `192.168.0.100`),
  use *REACH A CAMERA IN ANOTHER IP RANGE*: it gives the adapter an **extra** address such as `192.168.0.250`, so the PC's
  normal address and internet keep working. Windows asks for administrator permission. Remove the extra address again
  with **REMOVE** when you're done, or use **BACK TO AUTOMATIC** to reset an adapter that you set to a fixed address by hand.

Typical setup of a new camera: plug it in, **SCAN**, click **PUT PC IN THIS RANGE** on the camera and **ADD PC ADDRESS**,
**SCAN** again, **CHANGE IP** to an address in your home network, then **ADD TO MONITOR**.

Notes:

- Changing camera IPs uses ACTi's URL commands when the camera has them (`/cgi-bin/system`: sets a static `WAN_IP`,
  `WAN_NETMASK` and `WAN_GATEWAY`, then *Save & Reboot*, which takes about a minute), otherwise ONVIF. Login: the one
  stored in Monitor, or ACTi's default `Admin` / `123456`.
- An ACTi camera set to *Dynamic IP* falls back to `192.168.0.100` when no router hands it an address, so its address can
  change once it's connected to a router. CHANGE IP sets it to a fixed address.
- If the camera isn't in the PC's ranges, the scan only finds it via ONVIF. For an older ACTi camera, add a PC address in its
  range first (new ACTi cameras start at `192.168.0.100`) and scan again.
- Changing this PC's addresses only works on Windows, and only from the PC that runs Monitor (someone has to approve the
  Windows prompt). Other devices see the adapters read-only.
- **OPEN IP UTILITY** starts the ACTi IP Utility for what Monitor doesn't do (firmware upgrades, config backup). Monitor
  finds it when its folder (`IP_Utility_...`) is next to `Monitor.exe` or one folder up, or installed under Program Files\ACTi.

## MPEG4 or MJPEG (ACTi cameras)

In SETUP (ADVANCED), open **IN THE CAMERA** on a camera. Monitor reads the camera's current settings. Pick the
encoder: the fields fill in with the recommended settings for it (**USE RECOMMENDED** brings them back), then
**APPLY TO CAMERA**. Monitor sets its own mode to match.

| | Recommended | Monitor shows it as | Good for |
|---|---|---|---|
| **MPEG4** | 1280x1024, 8 fps, 3 Mbps | RTSP (over UDP) | Smooth live view, little network traffic. Needs ffmpeg |
| **MJPEG** | 1280x1024, 8 fps, quality 70 | Snapshots | Sharpest single frames, no ffmpeg; about 2 MB/s traffic |

8 fps is the camera's maximum at 1280x1024 (10 fps at 1280x720). For more fluid motion pick 640x480, which goes up to
30 fps. The camera stores the settings straight away (older firmware without a save command restarts, about a minute).

## Rebuild the exe / the app

After changing the code: `npm install` (once), then:

- `npm run build:exe` writes `dist\Monitor.exe`. Close a running Monitor first. No settings are copied: in `dist\` the exe
  reads the project's `cameras.json` (a `dist\cameras.json` would take precedence, so don't put one there).
- `npm run build:app` builds the exe, then the desktop app and its installer
  (`src-tauri\target\release\bundle\nsis\Monitor_<version>_x64-setup.exe`). Needs Rust (`winget install Rustlang.Rustup`)
  and the Visual Studio C++ build tools. The first build takes a few minutes.

## Open it from another PC

The PC that runs Monitor (`Monitor.exe` or `npm start`) is the server: it talks to the cameras and every other device talks to it.
The other devices never connect to the cameras directly, so they only need to reach the server.

1. **Keep the server running.** Leave the Monitor window open on the server PC. If it closes, the viewer stops for everyone.
2. **Get the address.** Monitor shows it for you: *OTHER PCs* in the top bar of the overview, **LINK** (or `L`) in LIVE for exactly what you're watching
   (e.g. `http://192.168.50.44:8080/#live=1&cams=1`), and *LIVE FROM OTHER PCs* on each camera in SETUP, each with **COPY**. Monitor picks the address of your home network; an extra address that only exists
   to reach cameras (like `192.168.0.250`) doesn't work for other devices.
3. **Allow port 8080 through Windows Firewall.** The first time you start Monitor, Windows may ask whether it may use the
   network: tick **Private networks** and click *Allow*. If you missed that prompt, open PowerShell **as administrator** on the
   server PC and run:

   ```powershell
   New-NetFirewallRule -DisplayName "Monitor" -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow -Profile Private
   ```

   The rule applies to *Private* networks only. Check under Settings > Network & internet > (your connection) that your home
   network is set to **Private**, not Public.
4. **Open it on the other device.** Make sure the other PC or phone is on the same network (same router or Wi-Fi), then browse to
   `http://<server-ip>:8080`, for example `http://192.168.1.25:8080`. Bookmark it, or bookmark a single camera
   (`http://192.168.1.25:8080/#live=1&cams=1`) or a set of cameras (`#live=4&cams=1,4,8,9`).

**Tip: give the server PC a fixed address.** Routers can hand out a different IP after a restart, which breaks the bookmark. Set a
DHCP reservation for the server PC in your router's settings so it always gets the same IP.

**It doesn't load from the other device?**

- Test on the server PC itself with `http://<server-ip>:8080` (not `localhost`). If that works but the other device can't
  connect, it's the firewall (step 3).
- From the other PC, run `ping <server-ip>`. If that fails, the devices aren't on the same network. Guest Wi-Fi networks often
  block devices from seeing each other.
- If you set the server PC to a static `192.168.0.x` address earlier to reach the camera, switch it back to *Obtain an IP address
  automatically* (and move the camera into your home network's range), otherwise other devices can't reach it.

## cameras.json

The settings page edits this file for you. You can also edit it by hand, then restart Monitor:

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
| `mode` | `snapshot` | `snapshot`: polls the camera's JPEG snapshot (works without extra software). `rtsp`: decodes the RTSP stream with ffmpeg (smoother) |
| `fps` | `5` | Frame rate of the live view |
| `httpPort` / `rtspPort` | `80` / `7070` | Camera ports |
| `snapshotUrl` / `rtspUrl` | ACTi URLs | Override for other camera brands |
| `rtspTransport` | `tcp` | `tcp` or `udp` |

## RTSP mode and automatic fallback

RTSP mode needs ffmpeg: `winget install Gyan.FFmpeg`, then restart Monitor (or put `ffmpeg.exe` next to `Monitor.exe`).
The settings page shows whether ffmpeg was found.

Snapshots are the safety net, and RTSP runs in the background on top of them, so the picture never stops:

- When you open a camera, snapshots start right away while RTSP connects. As soon as RTSP delivers video, it takes over.
- If RTSP frames are about 1 second late, snapshots fill in immediately. If no frame arrives for 3 seconds, or a new
  connection hasn't produced video within 8 seconds, ffmpeg is restarted.
- Failed RTSP attempts are retried in the background after 1 s, 3 s, 10 s, 30 s, and then every 60 s, while snapshots
  keep the picture going. A stream that ran fine for 30 seconds starts the retry schedule afresh.

The live view shows the active mode at the bottom left, for example `RTSP`, `SNAPSHOT (CONNECTING RTSP)` or
`SNAPSHOT (RTSP FAILED, RETRY IN 10S)`, and the Monitor window logs each attempt. Without ffmpeg, RTSP cameras always
use snapshot mode.

The browser also reconnects on its own: if the live view gets no video for about 10 seconds, it opens a new stream.

**Live view delay.** Under CONNECTION & LIVE DELAY > *LIVE VIEW DELAY* on each camera, pick a preset or set the options yourself:

| Option | Lowest delay | Balanced (default) | Smoothest |
|---|---|---|---|
| Low-delay decoding (ffmpeg doesn't buffer) | on | on | off |
| Fast start (first picture after ~1 s instead of ~3-4 s) | on | on | off |
| Wait for late packets (UDP) | 0 ms | 200 ms | 500 ms |
| Frame pacing | as they arrive | as they arrive | exact fps |
| Picture quality (2 = best … 12 = smallest) | 5 | 5 | 3 |
| Slow viewers | skip frames | skip frames | queue frames |

Measured on an ACM-5601 at 1280x1024: with the old fixed settings frames came in bursts (shows as delay) and the first
picture took 3.6 s; with *Balanced* they arrive evenly and the first picture takes about 1 s. *Lowest delay* can show
broken frames on a busy network. The camera itself adds some delay too; a lower resolution or MJPEG (VIDEO, under IN THE CAMERA)
can help there.

**RTSP doesn't work on an ACTi camera?** Older ACTi cameras (such as the ACM-5601) only run RTSP when their *Streaming
Method* is an "RTP" one. With the factory setting *TCP Only* the camera has no RTSP server at all (port 7070 closed). Applying
MPEG4 under VIDEO in SETUP sets it to *RTP over UDP*. These cameras also refuse RTSP over TCP ("400 Bad Request"):
Monitor then switches that camera to UDP by itself (RTSP TRANSPORT under CONNECTION & LIVE DELAY).

## Live

**LIVE** in the menu, or click a camera in the overview (that opens LIVE with just that camera).

- **1 / 4 / 6 / 8 / 9**: how many cameras, each an equal part of the screen. 8 is 4x2 on a monitor and 2x4 on a phone held
  upright. Each layout remembers its cameras; LIVE in the menu reopens the last multi-camera layout.
- **Pick the cameras**: click a spot (it gets a green frame), then choose its camera in the menu in the bar, or step through
  them with the arrows. So a 4-screen can show cameras 1, 4, 8 and 9. A spot can also be left empty.
- **Double-click** a spot (double tap on a phone): that camera alone. Double-click again or `Esc` goes back to the layout.
- **SNAPSHOT** saves a picture of the selected camera, **LINK** gives the address of exactly this view for another PC or
  phone (e.g. `#live=4&cams=1,4,8,9`).
- **FILL** (`Z`) lets the video fill its whole spot instead of showing black bars, cropping the edges. Handy on a phone.
  Each browser remembers it.

All cameras on screen come in over a single connection, so 9 cameras work as well as 1. Old `#cam=1` links still work.

## Keys in LIVE

Controls are hidden at first: `C` (or a tap on a phone/tablet) shows/hides them · `1` `4` `6` `8` `9` layout ·
`↑` / `↓` select a spot · `←` / `→` previous/next camera in that spot · double-click: one camera / back · `Z` fill ·
`F` fullscreen · `L` link for other PCs · `Esc` back (to the layout, then to the overview)

## Security

The camera passwords stay on the server, but Monitor itself has no login: anyone who can reach port 8080 can watch
the cameras and change the settings. Use it only on your local network and do not forward port 8080 on your router.
