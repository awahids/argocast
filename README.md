# argocast (prototype)

Screen-cast sender for interactive panels that speak the Lango/XBH **LRTSP/2.0**
protocol (the panels used by Airgo Cast). Built from static analysis of the
official clients — see [docs/](docs/):

- [01-airgocast-windows-analysis.md](docs/01-airgocast-windows-analysis.md) — what the Windows client is made of
- [02-lango-protocol-spec.md](docs/02-lango-protocol-spec.md) — reconstructed protocol (with confidence markers)

> ⚠️ Not yet tested against a real panel. Everything is verified only against
> the bundled mock panel, which implements our reading of the protocol.

## Requirements

- Node.js ≥ 22
- FFmpeg on `PATH` (or set `FFMPEG_PATH`) — `winget install Gyan.FFmpeg`

```powershell
npm install
```

## Desktop app (GUI)

```powershell
npm run app
```

- **Panel di jaringan** — panels found over mDNS; click one and enter the PIN.
- **Sambung manual** — type `IP` or `IP:port` plus the PIN.
- **LIVE screen** — timer, FPS, bitrate, resolution, *Hentikan cast*.
- **Pengaturan** (gear icon) — device name, resolution, frame rate, quality
  (weak network 2.5 Mbps / standard 5 Mbps / high 8 Mbps), source (desktop or test pattern).
- Closing the window while casting keeps it running in the system tray.

Settings live in `%APPDATA%\argocast\settings.json`.

GUI smoke test (drives the real window against an in-process mock panel and
saves screenshots to `smoke-output/`):

```powershell
npm run smoke
```

## Windows installer

```powershell
npm run dist      # → dist\argocast-Setup-<version>.exe
```

- NSIS installer (x64), per-user install (no admin), choice of install folder,
  Desktop + Start Menu shortcuts, uninstaller, Indonesian/English UI.
- **FFmpeg is bundled** (`resources\ffmpeg.exe` from `ffmpeg-static`), so the target PC needs nothing else.
- Icon: `build/icon.png` (regenerate with `npm run icon`).
- The installer is **not code-signed**: Windows SmartScreen will show
  "Windows protected your PC" → *More info* → *Run anyway*.
- The first launch after install can take a few seconds while Windows Defender scans `ffmpeg.exe`.
- Silent install for IT: `argocast-Setup-0.1.0.exe /S` (optional `/D=C:\path`).

Licensing note: the bundled FFmpeg build includes GPL components (libx264).
Distributing the installer outside your organisation means complying with the
GPL (provide/offer the corresponding FFmpeg source; see `resources\ffmpeg-LICENSE.txt`).

## Command line

```powershell
node src/cli.js discover                       # find panels via mDNS (_airgo._tcp)
node src/cli.js cast                           # cast to the first panel found
node src/cli.js cast 192.168.1.50:PORT --pin 1234
node src/cli.js cast 192.168.1.50:PORT --pin 1234 --size 1280x720 --fps 30 --bitrate 4000 -v
node src/cli.js cast 127.0.0.1 --test          # ffmpeg test pattern instead of the desktop
```

The LRTSP control port comes from the panel's mDNS SRV record. When you give an
IP without a port, `8554` is used (`--port` or `ARGOCAST_PORT` to override) —
that default is only the mock panel's port, not a known Lango default.

## Local testing without a panel

```powershell
node mock/panel.js --pin 1234 --out received.h264   # terminal 1
node src/cli.js cast 127.0.0.1:8554 --pin 1234      # terminal 2
ffplay received.h264                                # inspect what the "panel" got
```

```powershell
npm test   # unit tests + end-to-end session against the mock panel
```

## How it works

```
discover ─ mDNS PTR _airgo._tcp.local → SRV (ip:port)
control  ─ TCP: OPTIONS(Code: PIN) → ANNOUNCE(SDP WxH, H.264) → SETUP → PLAY
           ACTIVE heartbeat every 5 s, TEARDOWN on Ctrl+C
media    ─ TCP to rtp_port from the SETUP Transport header
           each H.264 access unit = 16-byte header (0xE8, key flag, seq, ms, SSRC, len) + Annex-B
capture  ─ ffmpeg gdigrab → libx264 baseline / ultrafast / zerolatency / repeat-headers
```

| File | Role |
|---|---|
| `src/lrtsp.js` | request builders (Android client layout), response parser |
| `src/frame.js` | 16-byte media framing, H.264 access-unit splitter |
| `src/session.js` | LRTSP state machine, heartbeat, media socket |
| `src/discovery.js` | mDNS browse |
| `src/capture.js` | ffmpeg screen capture / encode |
| `src/caster.js` | start/stop controller shared by CLI and GUI |
| `src/cli.js` | command line |
| `electron/main.js` | GUI main process (IPC, tray, settings) |
| `electron/ui/` | GUI renderer (HTML/CSS/JS) |
| `mock/panel.js` | fake panel for local testing |

## Not implemented yet

Audio, reverse cast, touch/mouse (LRTCP), file upload, moderator control,
virtual display/extend screen, choosing a single window or monitor, installer (.exe).

## Open protocol questions (need a real panel)

mDNS TXT contents, exact response formatting, whether panels accept the
Windows-style request line (`lrtsp://ip:port`), whether `aeskey` is ever
required, LRTCP state byte order. Details in the spec §7.
