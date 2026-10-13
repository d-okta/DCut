# DCut

Editor video desktop untuk Windows dengan alur kerja seperti Adobe Premiere Pro: Source Monitor dan Program Monitor, timeline multi-track V/A, alat Razor, Ripple, dan Slip, timecode, penanda, In/Out, serta pintasan keyboard yang mengikuti default Premiere. Fitur AI (caption otomatis, hapus latar, suara TTS, auto-cut) berjalan sepenuhnya di komputer.

Dirancang dan dibangun oleh **Diandra** dengan Electron, React, TypeScript, dan FFmpeg.

## Menjalankan

```bash
npm install
npm run app
```

`npm run app` menyalakan UI, server media lokal, dan jendela aplikasi Electron. Untuk mengembangkan UI di browser saja: `npm run dev`, lalu buka http://localhost:5173.

| Perintah | Fungsi |
| --- | --- |
| `npm run app` | Jalankan aplikasi desktop |
| `npm run dev` | UI di browser + server media |
| `npm run build` | Cek tipe lalu build produksi ke `dist/` |
| `npm run typecheck` | Cek tipe TypeScript |

## Tata letak

```
Menu bar · ruang kerja (Editing, Warna, Audio, Teks & Caption) · Ekspor
Source Monitor        | Program Monitor        | Kontrol Efek / Warna / Audio / Caption
Proyek / Efek / ...   | Alat | Timeline                                      | Meter audio
```

Semua pembagi panel bisa diseret, dan ukurannya diingat. Monitor yang sedang aktif diberi bingkai biru; I, O, J, K, L, Spasi, dan panah berlaku di monitor itu.

## Alur kerja

1. **Impor** media (`Ctrl+I`). Panel Proyek menampilkan durasi dalam timecode, ukuran, dan berapa kali media dipakai di sequence.
2. **Klik dua kali** media untuk membukanya di Source Monitor. Tandai bagian yang dipakai dengan `I` dan `O`.
3. Tekan `,` untuk **Insert** (klip setelah playhead bergeser) atau `.` untuk **Overwrite** (menimpa) ke playhead sequence. Media juga bisa diseret langsung ke track.
4. Rapikan di timeline dengan alat Seleksi, Razor, Ripple, atau Slip, lalu atur gerak, opasitas, warna, dan volume di panel kanan.
5. **Ekspor** (`Ctrl+M`) seluruh sequence atau hanya rentang In sampai Out.

## Pintasan utama

Daftar lengkap ada di dalam aplikasi: tekan `F1` atau `Ctrl+Alt+K`.

| Tombol | Aksi |
| --- | --- |
| `V` `C` `B` `Y` `H` `Z` | Alat Seleksi, Razor, Ripple Edit, Slip, Tangan, Zoom |
| `Spasi` | Putar / jeda |
| `J` `K` `L` | Mundur, berhenti, maju; tekan `L` atau `J` berulang = 2x, 4x, 8x |
| `←` `→` | Mundur / maju 1 frame (`Shift` = 5 frame) |
| `↑` `↓` | Ke titik edit sebelumnya / berikutnya |
| `I` `O` | Tandai In / Out (`Shift` = lompat, `Ctrl+Shift` = hapus) |
| `X` | In-Out = klip terpilih |
| `M` | Tambah penanda (`Shift+M` = penanda berikutnya) |
| `,` `.` | Insert / Overwrite dari Source |
| `;` `'` | Lift / Extract rentang In-Out |
| `Ctrl+K` | Add Edit di playhead (`Ctrl+Shift+K` = semua track) |
| `Q` `W` | Ripple trim bagian sebelum / sesudah playhead |
| `Shift+Delete` | Ripple Delete |
| `Shift+E` | Aktif / nonaktifkan klip |
| `S` | Snap |
| `=` `-` `\` | Perbesar, perkecil, muatkan sequence (juga `Alt`/`Ctrl` + scroll) |
| `Ctrl+G` | Lompat ke timecode |
| `Ctrl+Shift+E` | Ekspor frame PNG |
| `Ctrl+Z` / `Ctrl+Shift+Z` | Undo / redo |

Timecode bisa diklik lalu diketik: `00:00:12:15`, `12:15`, angka frame, atau `+30` / `-15` (frame relatif).

## Fitur

**Editing**
- Track video V1, V2, ... (V1 paling bawah) dan audio A1, A2, ...; tiap track bisa dikunci, disembunyikan/dibisukan, dan audio bisa di-solo
- Klik nama track untuk menjadikannya sasaran, klik dua kali untuk mengganti nama
- Snap ke playhead, tepi klip, In/Out, dan penanda; posisi dibulatkan ke frame
- Waveform di klip audio, label kecepatan klip, tanda `fx` bila klip memakai efek warna
- 12 transisi, 10 tampilan warna, koreksi dasar (suhu, pencahayaan, kontras, saturasi, rona), vinyet, blur
- Teks dengan preset gaya, caption terpisah yang bisa dibakar ke video
- Meter audio stereo dBFS dari audio yang benar-benar diputar
- Simpan / buka proyek (`.dcut.json`; berkas `.nusacut.json` dari versi lama tetap bisa dibuka)

**AI (semua lokal)**
- Caption otomatis dari suara (Whisper, timestamp per kata, Indonesia/Inggris)
- Hapus latar video tanpa green screen (MediaPipe), hasil WebM transparan
- Narasi teks ke suara memakai suara Windows
- Auto-cut bagian hening

**Ekspor**
- MP4 H.264 + AAC, seluruh sequence atau rentang In-Out, 720p sampai 4K, 24 sampai 60 fps
- Klip nonaktif tidak ikut, solo audio berlaku, caption bisa dibakar

## Catatan

- Model AI (Whisper sekitar 40 sampai 80 MB, MediaPipe sekitar 16 MB) diunduh sekali saat fitur pertama dipakai, setelah itu bekerja tanpa internet.
- Suara TTS mengikuti voice Windows yang terpasang. Untuk suara Indonesia: Settings, Time & Language, Speech, tambahkan bahasa Indonesia.
- FFmpeg sudah dibundel (`ffmpeg-static`).
- Belum ada installer; aplikasi dijalankan dengan `npm run app`.

## Struktur

```
electron/        proses utama & preload
services/        FFmpeg (probe, ekspor, auto-cut), TTS, server media lokal
src/commands.ts  registry perintah: menu bar, pintasan, panel pintasan
src/store/       state proyek (undo/redo) dan UI
src/components/  monitor, timeline, panel
src/engine/      jam playback, meter audio, waveform
src/ai/          Whisper, hapus latar, auto-cut
```

---

Dirancang dan dibangun oleh **Diandra**.
