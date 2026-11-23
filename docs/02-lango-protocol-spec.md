# Spesifikasi Protokol Airgo Cast / Lango (draf v0.4)

Sumber (analisis statis, aplikasi tidak dijalankan):
- **Windows** — Ghidra 12.2 via REA atas `AirgoCastSendKit.dll` (SHA-256 `dbe7c744…a411a`), Airgo Cast v2.10.1.403.
- **Android** — JADX via REA atas `AirgoCast_Android_V2.10.1.200_Lango_20241026.apk` (SHA-256 `02430e59…68f5d37d`), package `com.xbh.client`.

Lihat juga [01-airgocast-windows-analysis.md](01-airgocast-windows-analysis.md).

Legenda: **[O]** terlihat langsung di kode · **[I]** inferensi · **[?]** belum diketahui → verifikasi dengan panel asli.
Kelas Android disebut dengan nama hasil JADX (sebagian disamarkan, mis. `RtspClient.read`).

---

## 1. Ringkasan kanal

| Kanal | Transport | Isi | Status |
|---|---|---|---|
| Discovery | mDNS | PTR `_airgo._tcp.local.` → SRV/TXT | [O] nama, [?] TXT |
| Control (LRTSP) | TCP | teks mirip RTSP, `LRTSP/2.0` | [O] format request & respons |
| Media (Android) | TCP `rtp_port` | header 16 byte + H.264 Annex-B (§4) | [O] layout lengkap |
| Media (Windows) | RTP via TCP/QUIC/UDP | H.264/AAC, PT 116 | [O] PT, [?] framing |
| LRTCP state | TCP `rtcp_port` | paket biner 14 byte | [O] layout |
| Input mouse | TCP | paket biner 8 byte | [O] layout |
| File | FTP | kredensial dari respons FILE_SETUP | [O] |

**Port tidak hardcode** di klien: `rtp_port`, `rtcp_port`, `control_port` dikirim **panel** di header `Transport` pada respons [O, `Response.parseResponse`]. Port LRTSP awal datang dari mDNS SRV [I].

## 2a. Port tetap [O, `Constant.<clinit>`]

| Nama | Nilai | Keterangan |
|---|---|---|
| `PORT_RTSP` | **3056** | kontrol LRTSP — dipakai saat panel ditemukan lewat kode/IP |
| `PORT_TCP` | 8899 | default rtp_port (ditimpa oleh `Transport` dari panel) |
| `PORT_RTCP` | 38769 | default rtcp_port |
| `PORT_CONTROL` | 38767 | default control_port |

## 2b. Kode di layar panel ("share code") → IP [O, `com.xbh.client.utils.d` = CryCodeUtils, `ScreenMainActivity.f1` "shareCodeToIP"]

Kode yang ditampilkan panel **sekaligus PIN** (dikirim di `Code:`) **dan alamat panel**:

| Input | Dekode |
|---|---|
| alamat IPv4 | dipakai langsung |
| 6 digit `D` | `i = D; while i ≤ 999999: i += 65536`; `v = 999999 − (i − 65536)`; IP = `<2 oktet pertama IP pengirim>.(v >> 8).(v & 255)` |
| 8 digit | `k = int(d[0..2]) ^ 13`; IP = `<2 oktet pengirim>.(int(d[2..5]) ^ k).(int(d[5..8]) ^ k)` |
| 8 huruf | huruf `A`..`Y` → basis 25, huruf pertama paling tidak signifikan → 32 bit → IPv4 penuh |

Contoh: `834109` → `x.y.136.2`. Pengirim lalu konek ke port 3056 (§2a).
Jika pengirim punya beberapa antarmuka (VPN, WSL, …), argocast mencoba satu kandidat per prefiks /16.

**NFC/QR** [O, `ScreenMainActivity.e1`, `ScanCodeActivity`]: payload berupa tautan
`airgocast://?networkType=…&pinCode=…&ssid=…&deviceName=…&password=…&ipGroup=…`
(atau `https://www.airgo.link?…`). `pinCode` = kode di atas; `ipGroup` = alamat panel [I].

## 2. Discovery
- Query mDNS `_airgo._tcp.local.` (PTR) [O]. Jawaban SRV → host + port [O].
- Fallback: IP manual, PIN, QR (`ScanCodeActivity`), NFC (`NfcScanActivity`) [O].
- PIN dikirim sebagai header `Code:` pada OPTIONS [O]. Jika PIN salah → status **406** [O].

## 3. LRTSP — kanal kontrol

### 3.1 Format umum
- Request line: `<METHOD> lrtsp://<server_ip> LRTSP/2.0\r\n` [O, Android]. Windows menambahkan `:<port>` [O].
- Header `Nama: nilai` (Android pakai spasi setelah `:`; Windows tanpa spasi) → parser panel kemungkinan toleran [I].
- Badan SDP didahului `Content-Length` + `Content-Type: application/sdp` [O].
- Request diakhiri `\r\n\r` (Android) — kemungkinan bug kecil, panel toleran [O/I].
- `Cseq` naik 1 tiap request [O, Android].
- Respons dikenali dengan mencari `LRTSP/2.0`; beberapa respons bisa datang dalam satu paket TCP [O, `RtspClient.read`].

### 3.2 Alur sesi (state machine `RtspClient`) [O]

```
           ┌──────────── OPTIONS (Code: PIN) ──────────┐
           ▼                                            │
   200 OK + SSRC + Public:… ──► state = active          │  401 Unauthorized / 406 PIN salah
           │                                            │  501 panel sibuk / 500 error
           ├─ cast layar  : ANNOUNCE (SDP) ─► 200 + a=aeskey ─► SETUP ─► 200 + Session + Transport ─► PLAY ─► 200 → streaming
           ├─ reverse cast: DESCRIBE       ─► 200 + a=aeskey ─► SETUP ─► PLAY
           ├─ kamera      : CAMERA_ANNOUNCE ─► 200 + a=aeskey ─► SETUP ─► PLAY
           ├─ sentuh/remote: TOUCH_ANNOUNCE ─► 200 + width=integer/height=integer ─► (touch)SETUP ─► PLAY
           ├─ file        : FILE_ANNOUNCE ─► FILE_SETUP ─► 200 + port/username/password/currentdirectory (FTP) ─► FILE_PLAY
           ├─ moderator   : MODERATOR_CONTROL ─► 200 + controltype
           ├─ BYE (berhenti cast, sesi tetap) / TEARDOWN (putus)
           └─ keep-alive  : panel/klien mengirim "ACTIVE\r\n"
```

Kemampuan panel diumumkan di header `Public:` respons OPTIONS: `FILE_ANNOUNCE`, `TOUCH_ANNOUNCE`, `CAMERA_ANNOUNCE`, `MODERATOR_CONTROL` [O].

### 3.3 Request (Android, verbatim struktur) [O]

**OPTIONS**
```
OPTIONS lrtsp://<ip> LRTSP/2.0
Cseq: <n>
SSRC: <ssrc>                      ← hanya jika sudah punya SSRC
Content-Length: <len>
Content-Type: application/sdp
Version: sender v20210311
Os: Android<versi>
Model: <nama perangkat>
uuid: <uuid>
Code: <PIN>                       ← atau "From: <produk>" bila tanpa PIN
```

**ANNOUNCE** (badan SDP)
```
ANNOUNCE lrtsp://<ip> LRTSP/2.0
Cseq: <n>
SSRC: <ssrc>
Content-Length: <len>
Content-Type: application/sdp
m=video 0 LRTP/AVP 116
Width=integer:<w>
Height=integer:<h>
Mimetype=string:"video/avc"
Framerate=integer:30
AudioOn=integer:<0|1>
```

**SETUP / PLAY** — hanya request line + `Cseq` + `SSRC` [O].

### 3.4 Respons — header yang dibaca klien [O, `Response.parseResponse`]

| Header | Arti |
|---|---|
| status line → kode | `200`, `400`, `401`, `404`, `406` (PIN salah), `500`, `501` (sibuk) |
| `SSRC` | ID sesi dari panel (disimpan klien) |
| `Public` | daftar method yang didukung panel |
| `a=aeskey:string` | **kunci AES** dari panel (respons ANNOUNCE/DESCRIBE) |
| `Session` | ID sesi media (respons SETUP) |
| `Transport` | `…;rtp_port=N;rtcp_port=N;control_port=N` |
| `Connection` | `ACTIVE` / `Close` |
| `Device`, `Orientation` (`landscape`/`seascape`/…) | info panel |
| `width=integer`, `height=integer` | resolusi panel (reverse/touch) |
| `ConnectCount`, `TvCount`, `ShowCount` | jumlah peserta |
| `DlnaRunning`, `DlnaPort`, `DlnaUuid` | DLNA di panel |
| `IsBase` | jenis produk |
| `port`, `username`, `password`, `currentdirectory` | login FTP (FILE_SETUP) |
| `controltype` | aksi moderator |

## 4. Media — framing 16 byte (Android, jalur yang benar-benar dipakai) [O]

> **Koreksi v0.3:** thread pengirim `com.xbh.client.sender.h.run()` menulis setiap frame lewat helper
> `androidx.constraintlayout.motion.widget.b.l(data, frameType)` — **bukan** lewat kelas chunk RTMP di bawah.
> Kelas chunk RTMP tampaknya sisa/tidak dipakai di jalur cast layar.

Semua integer **big-endian** (`b.y0(value, n)`), dikirim lewat TCP ke `rtp_port`:

```
0   u8   0xE8            magic (byte rendah dari 2100200)
1   u8   1 | 2           1 = frameType 5 (IDR/key), 2 = lainnya
2   u16  sn_num          nomor urut, naik 1 per frame
4   u32  currentTimeMillis (32 bit rendah)
8   u32  SSRC            Integer.parseInt(SSRC dari respons OPTIONS)
12  u32  panjang payload
16  ...  frame H.264 dari MediaCodec (Annex-B)
```

- **Tidak ada enkripsi** di jalur ini; `aeskey` tidak dipakai di sini [O].
- Heartbeat `ACTIVE` dikirim tiap **5 detik** setelah OPTIONS berhasil (`RtspClient.l()`, `Timer.schedule(…, 5000, 5000)`) [O].
- Format `ACTIVE` / `TEARDOWN`: request line + `Cseq` + `SSRC` + `\r\n\r` [O].

## 4b. Kelas chunk ala RTMP (ada di APK, kemungkinan tidak dipakai) [O, `ChunkHeader.writeTo`]

Format sama dengan **RTMP chunk stream**:

| Tipe chunk (fmt) | Header setelah basic header |
|---|---|
| 0 | timestamp u24 BE · panjang pesan u24 BE · tipe pesan u8 · stream id **u32 LE** · [ext timestamp u32 BE jika ≥ 0xFFFFFF] |
| 1 | timestamp delta u24 · panjang u24 · tipe u8 · [ext ts] |
| 2 | timestamp delta u24 · [ext ts] |
| 3 | [ext ts] saja |

- Basic header 1 byte: `(fmt << 6) | chunkStreamId` [O].
- `MessageType` memakai nama RTMP: `SET_CHUNK_SIZE, ABORT, ACKNOWLEDGEMENT, USER_CONTROL_MESSAGE, WINDOW_ACKNOWLEDGEMENT_SIZE, SET_PEER_BANDWIDTH, AUDIO, VIDEO, DATA_AMF0/3, COMMAND_AMF0/3, SHARED_OBJECT_AMF0/3, AGGREGATE_MESSAGE` [O]. Nilai byte kemungkinan sama dengan RTMP (VIDEO=9, AUDIO=8, …) [I].
- Isi VIDEO: frame H.264 dari MediaCodec (`video/avc`, 30 fps) [O]. Bungkus payload (ala FLV/AVCC atau Annex-B) [?].
- **Enkripsi:** panel mengirim `a=aeskey`; tidak ada kelas AES di kode Java [O] → kemungkinan dipakai di library native atau tidak dipakai di versi ini [?].
- Windows memakai jalur lain (RTP PT 116 via `obs-lango.dll`) [O]; panel kemungkinan menerima keduanya [I].

## 4c. Touchback — sentuhan panel → pengirim [O, obs-lango.dll `LGFeedBack::onRecvCommond` + Android `TouchReadRunnable`]

Pengirim membuka **TCP ke `control_port`** dari header `Transport` (default 38767) setelah PLAY, lalu hanya membaca:

```
u8 type, u8 n
type 3              -> tombol; n = keycode Android
                       (0x13 ↑, 0x14 ↓, 0x15 ←, 0x16 →, 0x17 OK/Enter, 0x5c/0x5d page)
type 0 (sentuh)     -> n (1..10) titik × 6 byte:
type lain (mouse)      u8 id (7 bit), u8 aksi (0 down, 1 up, 2 move),
                       u16 x, u16 y  big-endian, 0..65535 relatif layar pengirim
```

Windows menyuntikkan dengan `InjectTouchInput` (POINTER_FLAG_DOWN|INRANGE|INCONTACT = 0x10006, UP 0x40000,
UPDATE 0x20006); tekan lama > 500 ms tanpa geser (< 4 px) → klik kanan (`mouse_event` 8/0x10).
Tombol: keycode Android → VK (`↑ 0x26, ↓ 0x28, ← 0x25, → 0x27, OK 0x0D, 0x5c → VK_NEXT, 0x5d → VK_PRIOR`).
Android: paket yang sama lewat `TouchServer` + `type 6` (volume) dan `type 4` (pesan JSON, panjang u24).

argocast: `src/touchback.js` (parser, pemetaan letterbox, emulasi mouse) + helper `src/inject/` (SendInput / CGEvent).
Android: `mobile/lib/protocol/touchback.dart` + `TouchService.kt` (AccessibilityService `dispatchGesture`; jalur
per jari direkam down→up lalu diputar sebagai satu gesture; tombol → `performGlobalAction`).

## 4d. Audio [O/?]

`obs-lango.dll` mengirim `AudioOn=integer:1` di ANNOUNCE (SDP sama dengan Android), dan SendKit punya
`m=audio 0 LRTP/AVP 116` / `audio/aac`. **Cara frame AAC dikirim belum ditemukan** — tidak ada magic 0xE8 di
obs-lango; kemungkinan lewat jalur RTP SendKit [?]. Android (Wi-Fi) tidak mengirim audio sama sekali.

## 5. LRTCP — paket status (14 byte) [O, Windows `FUN_10001e60`]
```
0  u32 BE  id sesi
4  u8      RW flag
5  8×u8    state: RTSP MONO MARK ADIO PPT DLNA RATIO (+1)
13 u8      0x0A
```
Android punya kelas status yang cocok: `RtspStatus, ScreenStatus, NotesStatus(MARK?), AudioStatus, PptStatus, DlnaStatus, KeepScreenAspectRatioStatus, ResponseCodeStatus` [O] → urutan byte [I].

## 6. Input mouse (8 byte) [O, Windows `FUN_10009c70`]
```
01 | event | aksi | 00 | X u16 BE | Y u16 BE
```

## 7. Sisa yang belum diketahui

| # | Pertanyaan | Cara tanpa panel | Cara dengan panel |
|---|---|---|---|
| 1 | Nilai byte `MessageType` & bungkus payload H.264 di chunk | JADX: `Video`, `Chunk`, `sender.*` | Wireshark |
| 2 | Kegunaan `aeskey` | cari di `lib/*.so` APK (Ghidra) | Wireshark: payload terenkripsi atau tidak |
| 3 | Isi TXT mDNS & port LRTSP default | — | Wireshark / `dns-sd` |
| 4 | Urutan posisi state LRTCP | JADX: `rtcp.*` | Wireshark |
| 5 | Format respons persis (spasi, CRLF) | — | Wireshark |

## 8. Status untuk argocast
Sudah cukup untuk menulis **prototipe klien** (discovery → OPTIONS+PIN → ANNOUNCE → SETUP → PLAY → kirim chunk H.264). Titik risiko terbesar adalah #1 dan #2; keduanya bisa dicoba dijawab dari APK sebelum ada panel.
