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
- **Jaringan yang sama** — laptop/ponsel dan panel tersambung ke Wi-Fi/LAN yang sama.
  Jika tidak memungkinkan, sambungkan laptop/ponsel ke **hotspot panel**.
- **PIN** — kode angka yang tampil di layar panel saat aplikasi penerima dibuka.
- **Alamat IP panel** (opsional) — hanya jika panel tidak muncul otomatis.
  Biasanya tertera di layar penerima cast pada panel.

## 2. Instalasi

Unduh file untuk perangkat Anda dari halaman
**[Releases](https://github.com/awahids/argocast/releases)**:

| Perangkat | File |
|---|---|
| Windows 10/11 (64-bit) | `argocast-Setup-<versi>.exe` |
| Mac Apple Silicon (M1, M2, M3, M4) | `argocast-<versi>-mac-arm64.dmg` |
| Mac Intel | `argocast-<versi>-mac-x64.dmg` |
| Ponsel/tablet Android 7.0+ | `argocast-<versi>-android.apk` |

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

## 3. Cast layar

Langkahnya sama di Windows, macOS, dan Android.

### Cara A — pilih panel dari daftar (otomatis)

1. Buka **argocast**. Bagian **Panel di jaringan** langsung mencari panel.
   Ketuk **Cari ulang** (atau tarik layar ke bawah di Android) untuk mencari lagi.
2. Ketuk nama panel.
3. Masukkan **PIN** yang tampil di layar panel, lalu **Hubungkan**.
4. **Android:** muncul dialog *"Start recording or casting with argocast?"* →
   pilih **Entire screen / Seluruh layar** (jika ada pilihan) lalu **Start**.
5. Tunggu langkah *Menghubungi panel → Memeriksa PIN → Menyiapkan siaran*.
6. Layar **LIVE** muncul — layar Anda kini tampil di panel. 🎉

### Cara B — sambung manual dengan IP

Gunakan jika panel tidak muncul di daftar.

1. Di bagian **Sambung manual**, isi **Alamat IP panel**, misalnya `192.168.1.50`.
   Jika Anda tahu port-nya, tulis `192.168.1.50:7000`.
2. Isi **PIN**, lalu **Hubungkan**.

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

## 4. Menghentikan cast

- Ketuk **Hentikan cast** di layar LIVE, **atau**
- **Windows/macOS:** klik ikon argocast di tray/menu bar → **Hentikan cast**, **atau**
- **Android:** tarik panel notifikasi → **Hentikan**.

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

## Mengatasi masalah

| Gejala | Penyebab & solusi |
|---|---|
| Panel tidak muncul di daftar | Pastikan satu jaringan. Wi-Fi kantor/tamu sering memblokir pencarian perangkat — gunakan **Sambung manual** dengan IP, atau sambungkan ke hotspot panel. macOS: pastikan izin **Local Network** untuk argocast aktif (System Settings › Privacy & Security › Local Network). |
| **"PIN salah."** | Masukkan ulang PIN yang tampil di panel; PIN bisa berganti setiap kali penerima dibuka. |
| **"Panel menolak koneksi. Periksa IP dan port."** | IP benar tetapi port salah. Gunakan daftar otomatis (port terdeteksi sendiri) atau tanyakan port ke admin panel. |
| **"Panel tidak dapat dijangkau."** | IP salah atau beda jaringan. |
| **"Panel sedang sibuk atau koneksi penuh."** | Peserta lain sedang cast atau batas peserta tercapai. Hentikan cast lain di panel lalu coba lagi. |
| macOS: **"Tangkap layar gagal"** | Izin Screen Recording belum aktif — lihat [Instalasi macOS](#macos) langkah 4, lalu buka ulang argocast. |
| Android: **"Izin merekam layar ditolak."** | Hubungkan lagi dan pilih **Start** di dialog perekaman layar. |
| Android: cast berhenti sendiri | Beberapa merek ponsel menghentikan aplikasi latar belakang. Nonaktifkan *battery optimization* untuk argocast (Settings › Apps › argocast › Battery › Unrestricted). |
| Gambar patah-patah / tertunda | Pilih kualitas **Jaringan lemah**, resolusi **HD**, atau dekatkan ke router. |
| Windows: SmartScreen memblokir installer | Klik **More info → Run anyway**. |

### Mode lanjutan (Windows/macOS, command line)

Untuk diagnosis, argocast bisa dijalankan dari terminal dengan log protokol lengkap
(perlu [source code](https://github.com/awahids/argocast) dan Node.js):

```powershell
node src/cli.js discover
node src/cli.js cast 192.168.1.50:7000 --pin 123456 -v
```

Sertakan output `-v` saat melaporkan masalah.
