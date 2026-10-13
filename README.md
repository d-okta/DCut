# ✂ NusaCut Studio

Aplikasi **editing video desktop untuk Windows** bergaya CapCut/Premiere dengan fitur AI, berjalan sepenuhnya di komputer Anda.

![Stack](https://img.shields.io/badge/stack-Electron%20%2B%20React%20%2B%20FFmpeg-6c8cff)

## Fitur

**Editing**
- Timeline multi-track (video, overlay/teks, audio) — drag, trim, split, snapping, zoom
- Preview real-time dengan komposit teks, overlay (picture-in-picture), dan subtitle
- Teks & judul dengan preset gaya (outline, latar, bayangan, font Windows)
- 12 transisi (fade, dissolve, wipe, slide, circle, pixelize, radial)
- 10 preset color grading (Cinematic, Vintage, Moody, dll) + pengaturan manual (brightness, kontras, saturasi, temperatur, hue, blur, vignette)
- Template proyek bawaan (YouTube, Shorts/TikTok, Instagram, Cinematic, Tutorial) + simpan template sendiri
- Undo/redo penuh, simpan/buka file proyek (.nusacut.json)
- Export MP4 (H.264 + AAC) dengan pilihan resolusi, fps, kualitas, dan burn subtitle

**AI (semua berjalan lokal)**
- 🎙 **Auto-subtitle** — transkripsi audio menjadi subtitle otomatis (Whisper; Indonesia/Inggris/deteksi otomatis) dengan **timestamp per kata** (timing presisi mengikuti jeda bicara), 3 pilihan model (tiny/base/small), dan pembersihan noise otomatis sebelum transkripsi
- ✨ **Hapus background** — tanpa green screen (MediaPipe), hasil WebM transparan siap ditumpuk
- 🔊 **Suara AI (TTS)** — teks menjadi narasi memakai suara Windows, offline
- ✂ **Auto-cut** — deteksi bagian hening lalu buang otomatis (klip merapat sendiri)

## Menjalankan

```bash
npm install
```

```bash
npm run app
```

`npm run app` menyalakan UI + server media + jendela aplikasi Electron sekaligus.
Untuk pengembangan UI di browser saja: `npm run dev` lalu buka http://localhost:5173.

## Pintasan keyboard

Tekan `?` atau `F1` (atau tombol ⌨ di TopBar) untuk melihat daftar lengkap di dalam aplikasi.

| Tombol | Aksi |
|---|---|
| `Spasi` | Putar / jeda (`K` jeda, `L` putar, `J` mundur 1 dtk) |
| `S` / `Ctrl+B` | Split klip terpilih di playhead |
| `Q` / `W` | Buang bagian kiri / kanan klip di playhead |
| `Delete` | Hapus klip/subtitle terpilih |
| `M` | Bisukan / bunyikan klip terpilih |
| `Ctrl+C` / `X` / `V` | Salin / potong / tempel klip di playhead |
| `Ctrl+D` | Gandakan klip |
| `Ctrl+Z` / `Ctrl+Y` | Undo / redo (juga `Ctrl+Shift+Z`) |
| `←` / `→` | Mundur / maju 1 frame (tahan `Shift` = 1 detik) |
| `↑` / `↓` | Lompat ke titik edit sebelumnya / berikutnya |
| `Home` / `End` | Ke awal / akhir proyek |
| `+` / `-` / `Ctrl+scroll` | Zoom timeline (scroll = anchor di kursor) |
| `Ctrl+S` / `O` / `E` | Simpan / buka proyek / export |
| `Esc` | Batalkan seleksi |

## Catatan

- Model AI (Whisper ±40–80 MB, MediaPipe ±16 MB) diunduh **sekali** saat fitur pertama kali dipakai; setelah itu offline.
- Suara TTS mengikuti voice Windows yang terpasang. Untuk suara Indonesia: Settings → Time & Language → Speech → tambahkan bahasa Indonesia.
- FFmpeg sudah dibundel (`ffmpeg-static`) — tidak perlu instal apa pun.
