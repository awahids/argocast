# argocast (prototype)

Screen-cast sender for interactive panels that speak the Lango/XBH **LRTSP/2.0**
protocol (the panels used by Airgo Cast). Built from static analysis of the
official clients — see [docs/](docs/):

- [01-airgocast-windows-analysis.md](docs/01-airgocast-windows-analysis.md) — what the Windows client is made of
- [02-lango-protocol-spec.md](docs/02-lango-protocol-spec.md) — reconstructed protocol (with confidence markers)

> ⚠️ Not yet tested against a real panel. Everything is verified only against
> the bundled mock panel, which implements our reading of the protocol.

📖 **Cara pakai (Bahasa Indonesia): [docs/PANDUAN.md](docs/PANDUAN.md)** — instalasi Windows/macOS/Android, cast, pengaturan, mengatasi masalah.

## Download

Latest: **[v0.3.0](https://github.com/awahids/argocast/releases/tag/v0.3.0)** (pre-release) · [all versions](https://github.com/awahids/argocast/releases)

[![Windows](https://img.shields.io/badge/Windows-x64-14b8a6?style=for-the-badge&logo=windows)](https://github.com/awahids/argocast/releases/download/v0.3.0/argocast-Setup-0.3.0.exe)
[![macOS Apple Silicon](https://img.shields.io/badge/macOS-Apple%20Silicon-14b8a6?style=for-the-badge&logo=apple)](https://github.com/awahids/argocast/releases/download/v0.3.0/argocast-0.3.0-mac-arm64.dmg)
[![macOS Intel](https://img.shields.io/badge/macOS-Intel-14b8a6?style=for-the-badge&logo=apple)](https://github.com/awahids/argocast/releases/download/v0.3.0/argocast-0.3.0-mac-x64.dmg)
[![Android](https://img.shields.io/badge/Android-APK-14b8a6?style=for-the-badge&logo=android)](https://github.com/awahids/argocast/releases/download/v0.3.0/argocast-0.3.0-android.apk)

| Platform | File | Size |
|---|---|---|
| Windows 10/11 x64 | [argocast-Setup-0.3.0.exe](https://github.com/awahids/argocast/releases/download/v0.3.0/argocast-Setup-0.3.0.exe) | — |
| macOS Apple Silicon (M1–M4) | [argocast-0.3.0-mac-arm64.dmg](https://github.com/awahids/argocast/releases/download/v0.3.0/argocast-0.3.0-mac-arm64.dmg) | — |
| macOS Intel | [argocast-0.3.0-mac-x64.dmg](https://github.com/awahids/argocast/releases/download/v0.3.0/argocast-0.3.0-mac-x64.dmg) | — |
| Android 7.0+ | [argocast-0.3.0-android.apk](https://github.com/awahids/argocast/releases/download/v0.3.0/argocast-0.3.0-android.apk) | — |
| iPhone/iPad iOS 15+ (sideload) | [argocast-0.3.0-ios-unsigned.ipa](https://github.com/awahids/argocast/releases/download/v0.3.0/argocast-0.3.0-ios-unsigned.ipa) — sign it yourself, see [PANDUAN › iOS](docs/PANDUAN.md#ios) | — |

Checksums: [SHA256SUMS.txt](https://github.com/awahids/argocast/releases/download/v0.3.0/SHA256SUMS.txt).
No Node.js, FFmpeg or build needed — everything is inside the installer.

**Windows**

1. Run `argocast-Setup-0.3.0.exe`. The installer is not code-signed yet: on
   **"Windows protected your PC"** click **More info → Run anyway**.
2. Follow the wizard (no admin rights needed).
3. Open **argocast** from the Desktop or Start Menu.

```powershell
Invoke-WebRequest -Uri https://github.com/awahids/argocast/releases/download/v0.3.0/argocast-Setup-0.3.0.exe -OutFile "$env:USERPROFILE\Downloads\argocast-Setup-0.3.0.exe"
```

**macOS** — the app is not notarized by Apple yet, so the first launch is blocked:

1. Open the `.dmg` and drag **argocast** into **Applications**.
2. Open it once (it will be blocked), then go to **System Settings › Privacy & Security**
   and click **Open Anyway** next to the argocast message. Alternatively run
   `xattr -dr com.apple.quarantine /Applications/argocast.app` in Terminal.
3. Allow **Local Network** when asked (needed to find panels).
4. On the first cast, allow **Screen Recording** in
   *System Settings › Privacy & Security › Screen Recording*, then reopen argocast.

**Android** — install the APK directly:

1. Download the `.apk` on the phone and open it; allow *Install unknown apps* for
   your browser/file manager when Android asks.
2. Open argocast, pick a panel (or type its IP) and enter the PIN.
3. Accept the **screen recording** prompt. Casting continues in the background;
   stop it from the app or the notification.

## Build from source

### Requirements

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
- **Sambung dengan kode** — type the code shown on the panel (e.g. `834 109`); an IP also works (then a PIN field appears).
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

## Building installers

Every platform is built in the cloud by GitHub Actions
([.github/workflows/build.yml](.github/workflows/build.yml)):

- **Actions → build → Run workflow** builds Windows `.exe`, macOS `.dmg` (arm64 + x64)
  and Android `.apk` as downloadable workflow artifacts.
- **Pushing a tag** `vX.Y.Z` does the same and attaches all files to that GitHub Release.

```powershell
git tag v0.3.0
git push origin v0.3.0
```

Local builds: `npm run dist` (Windows, on Windows), `npm run dist:mac` (on a Mac),
`cd mobile; flutter build apk --release` (needs the Android SDK).

## Android app (Flutter)

Lives in [mobile/](mobile/). Dart does the UI and the protocol
(`mobile/lib/protocol/` — a port of `src/lrtsp.js`, `src/frame.js`, `src/session.js`);
Kotlin does what only Android can: MediaProjection screen capture, hardware
H.264 (MediaCodec) in a `mediaProjection` foreground service, and NsdManager mDNS discovery
(`mobile/android/app/src/main/kotlin/…`).

```powershell
cd mobile
flutter test      # protocol unit tests + end-to-end against mock/panel.js (needs Node)
flutter run       # on a connected Android device
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
node src/cli.js cast 834109                     # the code shown on the panel (= PIN + panel address)
node src/cli.js cast 834 109 -v                 # spaces are fine; -v logs every LRTSP message
node src/cli.js discover                       # find panels via mDNS (_airgo._tcp)
node src/cli.js cast                           # cast to the first panel found
node src/cli.js cast 192.168.1.50 --pin 834109 --size 1280x720 --fps 30 --bitrate 4000
node src/cli.js cast 127.0.0.1 --pin 1234 --test   # ffmpeg test pattern instead of the desktop
```

A panel code encodes the panel's IP (see [spec §2b](docs/02-lango-protocol-spec.md)); Lango panels
listen on port **3056** (`--port` / `ARGOCAST_PORT` to override).

## Local testing without a panel

```powershell
node mock/panel.js --pin 1234 --out received.h264   # terminal 1 (listens on 3056)
node src/cli.js cast 127.0.0.1 --pin 1234           # terminal 2
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
