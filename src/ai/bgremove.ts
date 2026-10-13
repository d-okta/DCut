// ============================================================
// Diandra Cut - AI Background Removal
// Menghapus latar belakang video orang memakai MediaPipe
// ImageSegmenter (model selfie segmenter). Frame diproses satu
// per satu di renderer (canvas + alpha dari confidence mask),
// lalu dikirim ke backend (bgrStart/bgrFrame/bgrFinish) untuk
// dirakit menjadi WebM alpha.
// CATATAN: runtime WASM + model diunduh dari CDN, butuh internet.
// ============================================================
import { FilesetResolver, ImageSegmenter } from '@mediapipe/tasks-vision';
import type { MediaAsset } from '../types';
import { bridge } from '../bridge';
import type { ImportedFile } from '../bridge';

const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.18/wasm';
const MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite';

/** FPS pemrosesan (hemat: cukup halus untuk overlay orang). */
const PROCESS_FPS = 24;
/** Durasi maksimum default yang diproses (detik). */
const DEFAULT_MAX_DURATION = 30;

export interface BgRemoveOptions {
  /** Callback progres. pct = 0..100, atau null bila belum bisa diperkirakan. */
  onProgress: (message: string, pct: number | null) => void;
  /** Batas durasi yang diproses (detik); default 30. */
  maxDuration?: number;
  /** Offset ke dalam file sumber (detik) tempat mulai memproses (= clip.sourceIn); default 0. */
  startTime?: number;
  /** Durasi bagian sumber yang dipakai klip (detik, waktu SUMBER); default sisa durasi aset. */
  clipDuration?: number;
}

// ---------- util kecil ----------

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Interpolasi halus 0..1 di antara ambang e0..e1 (tepi mask jadi lembut). */
function smoothstep(e0: number, e1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

/** Muat elemen <video> dan tunggu metadata siap. */
function loadVideo(url: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.crossOrigin = 'anonymous';
    v.muted = true;
    v.preload = 'auto';
    v.playsInline = true;
    v.addEventListener('loadedmetadata', () => resolve(v), { once: true });
    v.addEventListener(
      'error',
      () => reject(new Error('Gagal memuat video sumber. Pastikan file masih ada di disk.')),
      { once: true },
    );
    v.src = url;
  });
}

/** Seek video ke detik `t` dan tunggu event 'seeked'. */
function seekTo(video: HTMLVideoElement, t: number): Promise<void> {
  return new Promise((resolve, reject) => {
    // Sudah tepat di posisi & frame siap -> tidak perlu seek (event tidak akan terpicu).
    if (video.readyState >= 2 && Math.abs(video.currentTime - t) < 0.001) {
      resolve();
      return;
    }
    const cleanup = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
    };
    const onSeeked = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error('Gagal membaca frame video (seek error).')); };
    video.addEventListener('seeked', onSeeked, { once: true });
    video.addEventListener('error', onError, { once: true });
    video.currentTime = t;
  });
}

function canvasToPngBlob(c: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    c.toBlob((b) => (b ? resolve(b) : reject(new Error('Gagal meng-encode frame PNG.'))), 'image/png');
  });
}

/** Unduh runtime WASM + model dan buat segmenter mode VIDEO. */
async function createSegmenter(onProgress: BgRemoveOptions['onProgress']): Promise<ImageSegmenter> {
  onProgress('Mengunduh runtime & model AI (butuh koneksi internet)…', null);
  try {
    const fileset = await FilesetResolver.forVisionTasks(WASM_URL);
    return await ImageSegmenter.createFromOptions(fileset, {
      baseOptions: { modelAssetPath: MODEL_URL },
      runningMode: 'VIDEO',
      outputCategoryMask: false,
      outputConfidenceMasks: true,
    });
  } catch (e) {
    throw new Error(
      `Gagal memuat model AI. Pastikan komputer terhubung ke internet lalu coba lagi. (${errMsg(e)})`,
    );
  }
}

/**
 * Hapus latar belakang sebuah aset video.
 * Menghasilkan file WebM dengan kanal alpha (dirakit backend), yang bisa
 * ditambahkan sebagai MediaAsset baru dengan hasAlpha = true.
 */
export async function removeBackground(asset: MediaAsset, opts: BgRemoveOptions): Promise<ImportedFile> {
  const { onProgress } = opts;
  if (asset.type !== 'video') {
    throw new Error('Background removal hanya bisa dilakukan pada aset video.');
  }

  const segmenter = await createSegmenter(onProgress);
  let video: HTMLVideoElement | null = null;

  try {
    onProgress('Memuat video sumber…', null);
    video = await loadVideo(asset.url);

    const w = video.videoWidth;
    const h = video.videoHeight;
    if (!w || !h) throw new Error('Dimensi video tidak terbaca. File mungkin rusak.');

    const srcDuration = asset.duration > 0 ? asset.duration : video.duration;
    // Mulai dari bagian sumber yang benar-benar dipakai klip (sourceIn),
    // dan batasi ke durasi terpakai klip + sisa sumber + batas maksimum.
    const startTime = Math.max(0, opts.startTime ?? 0);
    const avail = srcDuration - startTime;
    const duration = Math.min(
      opts.clipDuration ?? avail,
      avail,
      opts.maxDuration ?? DEFAULT_MAX_DURATION,
    );
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error('Durasi video tidak valid untuk diproses.');
    }
    const total = Math.max(1, Math.round(duration * PROCESS_FPS));

    // Tentukan mask "orang" dari label model. Untuk selfie segmenter,
    // confidenceMasks[0] = probabilitas orang; bila label menunjukkan
    // sebaliknya (mask latar), nilai dibalik (1 - v).
    const labels = segmenter.getLabels();
    let maskIndex = 0;
    let invert = false;
    const personIdx = labels.findIndex((l) => /person|selfie|foreground/i.test(l));
    if (personIdx >= 0) {
      maskIndex = personIdx;
    } else if (labels.length === 1 && /background/i.test(labels[0])) {
      invert = true; // mask tunggal berlabel background -> balikkan jadi probabilitas orang
    }

    // Canvas sumber (frame asli) + canvas keluaran (frame dengan alpha).
    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = w; srcCanvas.height = h;
    const outCanvas = document.createElement('canvas');
    outCanvas.width = w; outCanvas.height = h;
    const srcCtx = srcCanvas.getContext('2d', { willReadFrequently: true });
    const outCtx = outCanvas.getContext('2d');
    if (!srcCtx || !outCtx) throw new Error('Canvas 2D tidak tersedia di perangkat ini.');

    // Mulai sesi perakitan di backend (audio hasil ikut offset startTime).
    const { id } = await bridge.bgrStart(asset.name, PROCESS_FPS, asset.path, startTime);

    try {
      let lastTs = 0;
      for (let i = 0; i < total; i++) {
        try {
          const t = startTime + Math.min(i / PROCESS_FPS, Math.max(0, duration - 0.001));
          await seekTo(video, t);

          // Timestamp segmentForVideo wajib monoton naik.
          const ts = Math.max(performance.now(), lastTs + 1);
          lastTs = ts;
          const result = segmenter.segmentForVideo(video, ts);
          try {
            const masks = result.confidenceMasks;
            if (!masks || masks.length === 0) {
              throw new Error('Model tidak mengembalikan confidence mask.');
            }
            const mask = masks[Math.min(maskIndex, masks.length - 1)];
            const maskData = mask.getAsFloat32Array();
            const mw = mask.width;
            const mh = mask.height;
            const sameSize = mw === w && mh === h;

            // Gambar frame lalu tulis alpha per piksel dari mask.
            srcCtx.drawImage(video, 0, 0, w, h);
            const img = srcCtx.getImageData(0, 0, w, h);
            const px = img.data;
            for (let y = 0; y < h; y++) {
              const my = sameSize ? y : Math.min(mh - 1, Math.floor((y * mh) / h));
              const rowOff = my * mw;
              for (let x = 0; x < w; x++) {
                const mx = sameSize ? x : Math.min(mw - 1, Math.floor((x * mw) / w));
                let v = maskData[rowOff + mx];
                if (invert) v = 1 - v;
                // smoothstep di ambang 0.3..0.7 agar tepi halus
                px[(y * w + x) * 4 + 3] = smoothstep(0.3, 0.7, v) * 255;
              }
            }
            outCtx.putImageData(img, 0, 0);
          } finally {
            result.close(); // lepas memori mask MediaPipe
          }

          const blob = await canvasToPngBlob(outCanvas);
          const buf = await blob.arrayBuffer();
          await bridge.bgrFrame(id, i, buf);

          onProgress(`Memproses frame ${i + 1}/${total}`, Math.round(((i + 1) / total) * 100));
        } catch (e) {
          throw new Error(`Gagal memproses frame ${i + 1}/${total}: ${errMsg(e)}`);
        }
      }

      onProgress('Merakit video WebM alpha…', null);
      const out = await bridge.bgrFinish(id);
      onProgress('Selesai.', 100);
      return out;
    } catch (e) {
      // Gagal di tengah sesi: bersihkan frame PNG yang sudah terkirim di backend
      // (best-effort - jangan sampai menutupi error aslinya).
      try { await bridge.bgrCancel(id); } catch { /* abaikan */ }
      throw e;
    }
  } finally {
    // Lepas semua resource, apa pun hasilnya.
    try { segmenter.close(); } catch { /* abaikan */ }
    if (video) {
      video.removeAttribute('src');
      video.load();
    }
  }
}
