# Analisis Airgo Cast Windows v2.10.1.403

Target: `target/AirgoCastWindows_v2.10.1.403.20240824.exe`
SHA-256 `1ca7745e38dfa43344cd1287083f3edca50b0de8890a656026c8aa35812f923d`
Metode: analisis statis saja (REA + 7-Zip + innoextract). Aplikasi **tidak dijalankan**.

Legenda keyakinan: **[O]** observasi langsung dari file · **[I]** inferensi dari nama/string · **[?]** belum diketahui

---

## 1. Arsitektur

| Lapisan | Isi | Keyakinan |
|---|---|---|
| Installer | Inno Setup 6.1 (32-bit) → diekstrak ke `target/win-extracted/` (781 file) | [O] |
| UI / aplikasi | `AirgoCast32.exe` = **OBS Studio yang dimodifikasi** (Qt5, string `OBSApp::AppInit`, `--portable`, `scenes.json`) | [O] |
| Mesin capture & encode | **libobs** + plugin OBS (`win-capture`, `win-dshow`, `win-wasapi`, `obs-x264`, `obs-qsv11`, `obs-ffmpeg`) | [O] |
| Codec | FFmpeg 4.x (`avcodec-58`), **x264** (H.264), libopus, libvpx, SRT (`libsrt.dll`) | [O] |
| SDK protokol Lango | `AirgoCastSendKit.dll` (kelas `AirgoCastSendKit`) | [O] |
| Lem antara OBS dan SDK | `airgocast.dll` (namespace `cast::` — `CastApp`, `CastClient`, `CastDisplay`, `DeviceDiscovery`) | [O] |
| Output OBS khusus | `obs-plugins/obs-lango.dll` (plugin OBS: push RTP, pull stream, perintah RTCP) | [O] |
| Driver | `AirgoDriver/` — virtual audio (`vrtaucbl`) + `devcon64.exe`, `AirgoDevInstall.exe` → layar virtual / extend screen & speaker virtual | [I] |
| Branding ganda | `locales/lango/` dan `locales/haixin/` → satu build dipakai OEM berbeda | [O] |

Evidence REA: exports `AirgoCastSendKit.dll` `ev_ebd7c094…`, `airgocast.dll` `ev_4a2fd34f…`, `obs-lango.dll` `ev_4ab8a359…`.

> ⚠️ **Lisensi:** OBS Studio berlisensi **GPL-2.0**. Airgo Cast adalah turunan OBS, jadi argocast juga boleh dibangun di atas OBS/libobs — asalkan argocast sendiri dirilis dengan lisensi yang kompatibel GPL.

## 2. Fitur (dari teks UI `locales/lango/en-US.ini` + exports SDK)

| Fitur | Bukti | |
|---|---|---|
| Cari perangkat (IFP / panel interaktif) di jaringan yang sama | `StartDiscoverServer`, mDNS `_airgo._tcp.local.` | [O] |
| Sambung via **PIN** atau **alamat IP** | `doAuthentication(str,str)`, UI "Please enter PIN code or IP address" | [O] |
| Fallback: sambung ke **hotspot** panel | teks "connect to the hotspot of the IFP" | [O] |
| Cast **Desktop**, **Extension screen** (layar virtual), **Application window** | `CastScreenType`, `setAppScreenInfo(HWND,…)`, UI Page4 | [O] |
| **Reverse cast** (tampilkan layar panel di PC) + kontrol Home/Back/Task, papan gambar | `doStartReverseScreen`, UI Page7 | [O] |
| Kirim mouse/keyboard ke panel | `doSendLrtcpMouseCommand(x,y,…)`, `send_special_key` | [O] |
| Full-screen di panel, pause/stop, volume remote, kirim suara PC | `doFullScreen`, `doPauseScreen`, `setRemoteVolume`, `setCastSpeaker` | [O] |
| Cast **file** & upload file | `doStartCastFile`, `doStartUploadFile`, `ftp_port` | [O] |
| **Kamera/mikrofon virtual** (pakai kamera/mic panel di PC) | `doStartVirtualCamera`, `doStartVirtualMicphone`, `obs-virtualcam-module32.dll` | [O] |
| **Moderator**: panel bisa menerima/menolak/memanggil peserta | `doSendModerator`, `GetServerEnableModerator`, `on_reModerator_push/close`, Settings "Accepting/Reject/Timeout" | [O] |
| Kualitas: Standard / Weak network / Enhanced, keep aspect ratio | Settings Page1 | [O] |
| Batas jumlah koneksi di panel | "maximum number of connections has been reached" | [O] |
| Shortcut global start/pause/mute, tray icon, auto-update | `startShortcutKey`, `pauseShortcutKey`, `muteShortcutKey` | [O] |

## 3. Protokol (sebagian)

```
PC (sender)                                   Panel IFP (receiver)
   │  mDNS query  _airgo._tcp.local.  ───────────▶ │  (SRV → host + port)
   │ ◀────────── SRV/TXT reply (nama, port)        │
   │  TCP control  "LRTSP" (mirip RTSP)  ────────▶ │  lrtsp://<ip>
   │     ACTIVE / ANNOUNCE / DESCRIBE / SETUP / PLAY / TEARDOWN / BYE
   │     MODERATOR_CONTROL / FILE_ANNOUNCE / FILE_SETUP / FILE_PLAY / REPORT
   │     header: SSRC:, Code:, Transport:, Rtptime:, Public:
   │  SDP:  m=video 0 LRTP/AVP 116  (video/h264, audio/aac)
   │  Transport: RTP/TCP/unicast;rtp_port=..;rtcp_port=..;control_port=..
   │         atau QUIC/TCP/unicast;quic_port=..   atau UDP:unicast
   │  Media: RTP H.264 + AAC  ═══════════════════▶ │
   │  LRTCP (TCP) : paket biner 8 byte  ◀═══════▶ │  mouse, status, full-screen, audio, rasio
```

- **Discovery:** mDNS service `_airgo._tcp.local.` [O]. Fallback IP manual atau PIN [O]. Bagaimana PIN diubah ke IP [?].
- **Kontrol:** protokol teks mirip RTSP bernama **LRTSP** (`lrtsp://`), daftar method di atas [O]. Format persis tiap request/response [?].
- **Media:** H.264 baseline (x264 `ultrafast`/`zerolatency`, VBR 5000–8000 kbps, keyint 3 dtk) atau Intel QSV; audio AAC [O]. Transport RTP over TCP, QUIC, atau UDP [O]; mana yang default [?].
- **LRTCP:** kanal TCP terpisah dengan paket 8 byte; field log: `RW RTSP MONO MARK ADIO PPT DLNA RATIO` [O]. Arti tiap byte [?].
- **Auth:** `doAuthentication(a, b)` — dua string (kemungkinan PIN + nama perangkat) [I]. Ada respons `Unauthorized` [O].
- Port default (rtp/rtcp/control/quic/ftp) **tidak ada sebagai string**; kemungkinan dari jawaban mDNS/SETUP [I].

## 4. Yang belum diketahui & cara menjawabnya

| Pertanyaan | Cara |
|---|---|
| Format persis pesan LRTSP & SDP | Ghidra: dekompilasi `AirgoCastSendKit::Connect`, handler `LG_RtspTcpClient` |
| Arti 8 byte LRTCP | Ghidra: `doSendLrtcpMouseCommand`, `doSendLrtcpStateCommand` |
| Port, TXT record mDNS | Rekam jaringan (Wireshark) saat cast ke panel asli |
| Alur PIN → IP | Ghidra pada `doAuthentication` + rekaman jaringan |
| Sisi penerima (panel) | Tidak ada di file ini — firmware panel Lango (`XBH_…XMH560A…` muncul di string) |

## 5. Implikasi untuk argocast

1. **Jalur cepat:** bangun di atas komponen terbuka yang sama — libobs/FFmpeg (capture + H.264/AAC), Qt atau Electron untuk UI, mDNS untuk discovery.
2. **Kompatibel dengan panel Lango** hanya mungkin bila LRTSP/LRTCP dipetakan lengkap (bagian 4). Butuh panel asli untuk menguji.
3. **Protokol sendiri** (argocast sender + argocast receiver) lebih sederhana: mDNS `_argocast._tcp` + WebRTC/SRT + kanal kontrol JSON — tanpa ketergantungan pada firmware Lango.
4. Gunakan nama, ikon, dan teks UI sendiri — jangan salin aset/locale Airgo Cast.
