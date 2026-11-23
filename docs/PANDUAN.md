# Panduan Penggunaan argocast

argocast menampilkan layar laptop atau ponsel Anda ke **panel interaktif** (layar
sentuh besar di ruang rapat/kelas) secara nirkabel, tanpa kabel HDMI.

> ⚠️ argocast masih **pre-release**. Protokolnya direkonstruksi dari aplikasi
> resmi dan baru diuji terhadap panel tiruan. Jika gagal terhubung ke panel
> sungguhan, lihat [Mengatasi masalah](#mengatasi-masalah) dan laporkan di
> [Issues](https://github.com/awahids/argocast/issues).

**Daftar isi**
1. [Sebelum mulai](#1-sebelum-mulai)
2. [Instalasi](#2-instalasi) — [Windows](#windows) · [macOS](#macos) · [Android](#android)
3. [Cast layar](#3-cast-layar)
4. [Menghentikan cast](#4-menghentikan-cast)
5. [Pengaturan](#5-pengaturan)
6. [Mengatasi masalah](#mengatasi-masalah)

---

## 1. Sebelum mulai

Yang Anda butuhkan:

- **Panel interaktif** yang mendukung Airgo Cast / Lango (biasanya ada aplikasi penerima cast di panel).
- **Jaringan yang sama** — laptop/ponsel dan panel tersambung ke Wi-Fi/LAN yang sama
  (mis. SSID `KANTOR_GUEST` di keduanya). Jika tidak memungkinkan, sambungkan
  laptop/ponsel ke **hotspot panel**.
- **Kode di layar panel** — buka aplikasi penerima cast di panel; tampil **KODE PIN**
  (mis. `834 109`) dan **QR code**. Kode ini sekaligus menunjukkan alamat panel,
  jadi cukup kode itu saja untuk terhubung.

> 💡 Wi-Fi tamu (*guest*) kantor sering memblokir komunikasi antar-perangkat.
> Jika gagal terhubung di Wi-Fi tamu, pindah ke Wi-Fi kantor biasa atau hotspot panel.

## 2. Instalasi

Unduh file untuk perangkat Anda dari halaman
**[Releases](https://github.com/awahids/argocast/releases)**:

| Perangkat | File |
|---|---|
| Windows 10/11 (64-bit) | `argocast-Setup-<versi>.exe` |
| Mac Apple Silicon (M1, M2, M3, M4) | `argocast-<versi>-mac-arm64.dmg` |
| Mac Intel | `argocast-<versi>-mac-x64.dmg` |
| Ponsel/tablet Android 7.0+ | `argocast-<versi>-android.apk` |
| iPhone/iPad iOS 15+ | `argocast-<versi>-ios-unsigned.ipa` (perlu ditandatangani, lihat [iOS](#ios)) |

> Tidak yakin Mac Anda Apple Silicon atau Intel? Klik menu  › **About This Mac**.
> Jika tertulis **Chip Apple M…**, pilih `arm64`; jika **Processor Intel**, pilih `x64`.

### Windows

1. Jalankan `argocast-Setup-<versi>.exe`.
2. Jika muncul **"Windows protected your PC"**, klik **More info → Run anyway**
   (installer belum ditandatangani secara digital).
3. Ikuti wizard (tidak perlu hak administrator). Pilih folder instalasi bila perlu.
4. Buka **argocast** dari ikon di Desktop atau Start Menu.

Pembukaan pertama bisa butuh beberapa detik karena Windows Defender memeriksa komponen video.

### macOS

1. Buka file `.dmg`, lalu seret ikon **argocast** ke folder **Applications**.
2. Buka **argocast** dari Applications. Pada pembukaan pertama macOS akan
   memblokirnya karena aplikasi belum dinotarisasi Apple:
   - Buka **System Settings › Privacy & Security**, gulir ke bawah, klik
     **Open Anyway** di samping pesan tentang argocast, lalu konfirmasi; **atau**
   - jalankan di Terminal: `xattr -dr com.apple.quarantine /Applications/argocast.app`
3. Saat ditanya **"argocast would like to find devices on your local network"**, klik **Allow**.
4. Saat pertama kali cast, macOS meminta izin **Screen Recording**:
   buka **System Settings › Privacy & Security › Screen Recording**, aktifkan
   **argocast**, lalu **tutup dan buka ulang** argocast.

### Android

1. Unduh `argocast-<versi>-android.apk` di ponsel, lalu ketuk file tersebut.
2. Jika Android menolak, izinkan **Install unknown apps** untuk browser / pengelola file
   yang Anda gunakan, lalu ketuk file APK lagi.
3. Ketuk **Install**, lalu **Open**.
4. Izinkan **notifikasi** saat ditanya (dipakai untuk tombol *Hentikan* selama cast).

### iOS

Aplikasi iOS di luar App Store harus **ditandatangani dengan Apple ID Anda sendiri**.
Apple ID gratis cukup, tetapi aplikasinya **kedaluwarsa setelah 7 hari** dan harus
dipasang ulang (data pengaturan tetap tersimpan). Pilih salah satu cara:

**Cara A — Xcode di Mac (disarankan)**

Butuh: Mac dengan Xcode 16+, Flutter, kabel USB, dan Apple ID.

1. Di Mac, ambil source code dan siapkan proyek:
   ```bash
   git clone https://github.com/awahids/argocast.git
   cd argocast/mobile
   flutter pub get
   open ios/Runner.xcworkspace
   ```
2. Di Xcode: **Settings › Accounts › +** → masuk dengan Apple ID Anda.
3. Pilih proyek **Runner** di panel kiri → target **Runner** → tab **Signing & Capabilities**:
   - **Team**: pilih *(Nama Anda) (Personal Team)*.
   - **Bundle Identifier**: ganti menjadi unik, misalnya `com.namaanda.argocast`.
4. Pilih target **ArgocastBroadcast** → **Signing & Capabilities**:
   - **Team**: tim yang sama.
   - **Bundle Identifier**: *harus* bundle id aplikasi + `.Broadcast`, misalnya `com.namaanda.argocast.Broadcast`.
5. Sambungkan iPhone dengan kabel, pilih iPhone di bagian atas Xcode, lalu tekan **▶ Run**.
6. Di iPhone (sekali saja):
   - **Settings › Privacy & Security › Developer Mode** → aktifkan, iPhone akan restart.
   - **Settings › General › VPN & Device Management** → pilih Apple ID Anda → **Trust**.
7. Setelah 7 hari aplikasi tidak bisa dibuka lagi: ulangi langkah 5.

**Cara B — Sideloadly (Windows atau Mac, tanpa Xcode)**

1. Unduh `argocast-<versi>-ios-unsigned.ipa` dari halaman Releases.
2. Pasang [Sideloadly](https://sideloadly.io) dan iTunes (Windows), sambungkan iPhone dengan kabel.
3. Seret file `.ipa` ke Sideloadly, isi Apple ID, klik **Start**.
4. Di iPhone: **Settings › General › VPN & Device Management** → **Trust**, dan aktifkan **Developer Mode** seperti di atas.

> Apple ID gratis dibatasi 3 aplikasi terpasang dan 10 App ID per minggu; argocast memakai 2 App ID
> (aplikasi + ekstensi siaran).

**Saat pertama dibuka**, izinkan **Local Network** ("argocast would like to find devices…") agar panel bisa ditemukan.

## 3. Cast layar

Langkahnya sama di Windows, macOS, Android, dan iOS:

| # | Di mana | Langkah |
|---|---|---|
| 1 | **Panel** | Buka aplikasi penerima cast. Tampil **KODE PIN** (mis. `834 109`) dan QR code. |
| 2 | Laptop/ponsel | Pastikan tersambung ke **Wi-Fi yang sama** dengan panel. |
| 3 | Laptop/ponsel | Buka **argocast**. |
| 4 | Laptop/ponsel | Ketik kode di **Kode di layar panel** → **Hubungkan**. Di ponsel bisa juga ketuk **Scan QR di layar panel**. |
| 5 | — | Layar **LIVE** muncul — layar Anda tampil di panel. 🎉 |

Kode boleh diketik dengan atau tanpa spasi (`834 109` = `834109`). Kode itu sekaligus
PIN, jadi tidak perlu mengisi PIN terpisah.

Di langkah 4, khusus ponsel:
- **Android:** muncul dialog *"Start recording or casting with argocast?"* →
  pilih **Entire screen / Seluruh layar** (jika ada pilihan) lalu **Start**.
- **iOS:** muncul lembar **Screen Broadcast** → pastikan **argocast** tercentang →
  ketuk **Start Broadcast**, tunggu hitung mundur 3 detik. Jika lembar tertutup,
  ketuk **Buka lembar siaran** di aplikasi.

Selama menghubungkan, argocast menampilkan *Menghubungi panel → Memeriksa PIN → Menyiapkan siaran*.

### Alternatif — pilih panel dari daftar

Bagian **Panel di jaringan** mencari panel otomatis (ketuk **Cari ulang**, atau tarik
layar ke bawah di ponsel). Ketuk nama panel, lalu masukkan PIN yang tampil di panel.

### Alternatif — alamat IP

Ketik alamat IP panel (mis. `192.168.1.50`) di kolom kode; kolom **PIN** akan muncul —
isi dengan kode di panel, lalu **Hubungkan**.

### Panel yang pernah dipakai

Panel yang berhasil tersambung disimpan di bagian **Terakhir dipakai**, sehingga
lain kali cukup ketuk dan masukkan PIN.

### Selama cast

Layar **LIVE** menampilkan:

| Info | Arti |
|---|---|
| Timer | lama cast berjalan |
| FPS | gambar terkirim per detik (idealnya 24–30) |
| Bitrate | besar data per detik; turun drastis = jaringan lemah |
| Resolusi | ukuran gambar yang dikirim |

Anda boleh beralih ke aplikasi lain; cast tetap berjalan:
- **Windows/macOS:** menutup jendela tidak menghentikan cast — argocast tetap di
  system tray / menu bar.
- **Android:** cast berjalan di latar belakang dengan notifikasi *"argocast sedang cast layar"*.
- **iOS:** selama siaran, jam/indikator di pojok kiri atas berwarna **merah**.
  Isi seluruh layar ikut terkirim, termasuk notifikasi — aktifkan *Focus / Do Not Disturb* bila perlu.
  Saat ini gambar dikirim dalam posisi **tegak (portrait)**; rotasi lanskap belum didukung.

### Touchback (Windows, macOS, Android)

Saat cast, Anda bisa **mengendalikan laptop/ponsel dengan menyentuh panel**.
Layar LIVE menampilkan **TOUCHBACK ACTIVE** saat aktif. Nonaktifkan di **Pengaturan › Touchback**
bila tidak diinginkan.

**Windows & macOS:** ketuk = klik kiri, geser = drag, tekan lama (≥ ½ detik) = klik kanan,
tombol panah/OK di remote panel = tombol panah/Enter.

- **macOS:** izinkan argocast di *System Settings › Privacy & Security › **Accessibility***,
  lalu buka ulang aplikasi.

**Android:** ketuk, tekan lama, geser/scroll, dan cubit (zoom) dua jari.
Tombol remote: Kembali, Home, Recent; tombol panah/OK hanya di Android 13+.

- Saat pertama cast, layar LIVE menampilkan kartu **Kendalikan ponsel dari panel** → ketuk
  **Aktifkan** → *Aksesibilitas* → **argocast touchback** → aktifkan → kembali ke argocast.
- **Android 13+ dan sakelar abu-abu / "Restricted setting"?** Karena APK dipasang manual,
  buka *Settings › Apps › argocast* → menu **⋮** (pojok kanan atas) → **Allow restricted settings**,
  lalu ulangi langkah di atas.
- Gerakan geser diputar **setelah jari diangkat** dari panel (batasan API Aksesibilitas Android),
  jadi scroll terasa sedikit tertunda; ketuk dan tekan lama langsung.
- argocast tidak membaca isi layar; layanan ini hanya meneruskan sentuhan dari panel.

**iOS:** tidak didukung — iOS tidak mengizinkan aplikasi mengendalikan sentuhan.

## 4. Menghentikan cast

- Ketuk **Hentikan cast** di layar LIVE, **atau**
- **Windows/macOS:** klik ikon argocast di tray/menu bar → **Hentikan cast**, **atau**
- **Android:** tarik panel notifikasi → **Hentikan**, **atau**
- **iOS:** ketuk indikator merah di pojok kiri atas → **Stop**, atau buka Control Center →
  tombol rekam layar.

Untuk keluar sepenuhnya di Windows/macOS: ikon tray → **Keluar**.

## 5. Pengaturan

Ketuk ikon ⚙️ di kanan atas (tidak tersedia saat sedang cast).

| Pengaturan | Pilihan | Saran |
|---|---|---|
| Nama perangkat | teks bebas | nama yang mudah dikenali di panel, mis. "Laptop Budi" |
| Resolusi | Full HD / HD | HD jika gambar patah-patah |
| Frame rate | 30 / 24 / 15 fps | 30 untuk video, 15 untuk dokumen statis |
| Kualitas | Jaringan lemah / Standar / Tinggi | *Jaringan lemah* bila Wi-Fi ramai |
| Sumber *(Windows/macOS)* | Layar desktop / Pola uji | *Pola uji* untuk mengetes koneksi tanpa menampilkan layar Anda |
| Touchback | aktif / nonaktif | lihat [Touchback](#touchback-windows-macos-android) |

### Pembaruan otomatis (Windows & macOS)

Aplikasi desktop memeriksa versi baru di GitHub saat dibuka dan setiap 6 jam
(perlu internet). Versi aplikasi dan tombol **Periksa pembaruan** ada di bawah Pengaturan.

- **Windows:** pembaruan diunduh otomatis di latar belakang. Setelah siap, muncul
  *"Pembaruan vX siap"* → klik **Mulai ulang sekarang**, atau biarkan — pembaruan dipasang
  otomatis saat argocast ditutup (lewat **Keluar** di tray).
- **macOS:** muncul *"argocast vX tersedia"* → klik **Perbarui sekarang**. argocast mengunduh
  versi baru, menggantinya di folder Applications, lalu membuka kembali. Jika gagal (mis. tidak ada
  izin menulis ke folder aplikasi), file DMG dibuka — seret argocast ke Applications seperti biasa.
- Pembaruan tidak dipasang selama cast berjalan; hentikan cast dulu.
- Android dan iOS: pasang versi baru secara manual dari halaman Releases.

## Mengatasi masalah

| Gejala | Penyebab & solusi |
|---|---|
| Panel tidak muncul di daftar | Pastikan satu jaringan. Wi-Fi kantor/tamu sering memblokir pencarian perangkat — ketik **kode di layar panel** (tidak butuh pencarian), atau sambungkan ke hotspot panel. macOS: pastikan izin **Local Network** untuk argocast aktif (System Settings › Privacy & Security › Local Network). |
| **"PIN salah."** | Masukkan ulang PIN yang tampil di panel; PIN bisa berganti setiap kali penerima dibuka. |
| **"Kode tidak valid."** | Kode panel berupa 6 atau 8 angka (atau 8 huruf). Periksa lagi, atau gunakan alamat IP panel. |
| **"Panel dengan kode ini tidak ditemukan."** | Kode benar tetapi panel tidak terjangkau — hampir selalu karena beda jaringan atau Wi-Fi tamu yang memblokir antar-perangkat. |
| **"Panel menolak koneksi. Periksa IP dan port."** | IP benar tetapi aplikasi penerima di panel belum dibuka, atau port bukan 3056. |
| Scan QR tidak berfungsi | Izinkan akses **kamera** untuk argocast di pengaturan ponsel. Atau ketik saja kodenya. |
| **"Panel tidak dapat dijangkau."** | IP salah atau beda jaringan. |
| **"Panel sedang sibuk atau koneksi penuh."** | Peserta lain sedang cast atau batas peserta tercapai. Hentikan cast lain di panel lalu coba lagi. |
| macOS: **"Tangkap layar gagal"** | Izin Screen Recording belum aktif — lihat [Instalasi macOS](#macos) langkah 4, lalu buka ulang argocast. |
| Android: **"Izin merekam layar ditolak."** | Hubungkan lagi dan pilih **Start** di dialog perekaman layar. |
| Android: cast berhenti sendiri | Beberapa merek ponsel menghentikan aplikasi latar belakang. Nonaktifkan *battery optimization* untuk argocast (Settings › Apps › argocast › Battery › Unrestricted). |
| Gambar patah-patah / tertunda | Pilih kualitas **Jaringan lemah**, resolusi **HD**, atau dekatkan ke router. |
| Windows: SmartScreen memblokir installer | Klik **More info → Run anyway**. |
| iOS: argocast tidak ada di lembar Screen Broadcast | Ekstensi siaran belum terpasang/ditandatangani. Pastikan Bundle Identifier target *ArgocastBroadcast* = bundle id aplikasi + `.Broadcast` (lihat [iOS](#ios)), lalu pasang ulang. |
| iOS: siaran langsung berhenti dengan pesan error | Pesan dari argocast ditampilkan iOS (mis. "PIN salah."). Perbaiki sesuai pesan lalu ulangi dari aplikasi. |
| iOS: *"Untrusted Developer"* / aplikasi tidak bisa dibuka | **Settings › General › VPN & Device Management** → Trust. Jika sudah lewat 7 hari, pasang ulang. |
| Android: sentuhan panel tidak berpengaruh | Pastikan **argocast touchback** aktif di Settings › Accessibility (lihat [Touchback](#touchback-windows-macos-android)). Pada Android 13+ izinkan dulu *Allow restricted settings*. |
| iOS: panel tidak ditemukan | Izinkan **Local Network**: Settings › Privacy & Security › Local Network › argocast. |

### Mode lanjutan (Windows/macOS, command line)

Untuk diagnosis, argocast bisa dijalankan dari terminal dengan log protokol lengkap
(perlu [source code](https://github.com/awahids/argocast) dan Node.js):

```powershell
node src/cli.js discover
node src/cli.js cast 192.168.1.50:7000 --pin 123456 -v
```

Sertakan output `-v` saat melaporkan masalah.
