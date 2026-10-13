// ============================================================
// Util impor media: pilih file lewat bridge, probe metadata,
// buat thumbnail kecil, lalu daftarkan sebagai MediaAsset.
// ============================================================
import { bridge } from '../bridge';
import type { ImportedFile } from '../bridge';
import { uid } from '../types';
import type { MediaAsset, MediaType, ProbeResult } from '../types';
import { useProject } from '../store/projectStore';

const VIDEO_EXT = ['mp4', 'mov', 'mkv', 'webm', 'avi'];
const AUDIO_EXT = ['mp3', 'wav', 'm4a', 'aac', 'ogg'];
const IMAGE_EXT = ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'];

const THUMB_WIDTH = 160;
const THUMB_TIMEOUT_MS = 4000;

/** Tentukan MediaType dari ekstensi nama file. Default: video. */
export function mediaTypeFromName(name: string): MediaType {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (AUDIO_EXT.includes(ext)) return 'audio';
  if (IMAGE_EXT.includes(ext)) return 'image';
  if (VIDEO_EXT.includes(ext)) return 'video';
  return 'video';
}

/** Gambar sumber (video/img) ke canvas lebar 160 -> dataURL JPEG 0.7. */
function drawToThumb(source: CanvasImageSource, srcW: number, srcH: number): string | undefined {
  const w = THUMB_WIDTH;
  const h = Math.max(1, Math.round(w * (srcH / Math.max(1, srcW))));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) return undefined;
  ctx.drawImage(source, 0, 0, w, h);
  return canvas.toDataURL('image/jpeg', 0.7);
}

/** Thumbnail video: seek ke min(0.5, durasi/2), timeout 4 detik. Gagal = undefined. */
function videoThumbnail(url: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    let done = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const video = document.createElement('video');

    const finish = (result: string | undefined) => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      // lepaskan resource
      video.onloadedmetadata = null;
      video.onseeked = null;
      video.onerror = null;
      video.removeAttribute('src');
      try { video.load(); } catch { /* abaikan */ }
      resolve(result);
    };

    timer = setTimeout(() => finish(undefined), THUMB_TIMEOUT_MS);

    video.crossOrigin = 'anonymous';
    video.muted = true;
    video.preload = 'auto';
    video.onloadedmetadata = () => {
      const dur = Number.isFinite(video.duration) ? video.duration : 0;
      try {
        video.currentTime = Math.min(0.5, dur / 2);
      } catch {
        finish(undefined);
      }
    };
    video.onseeked = () => {
      try {
        finish(drawToThumb(video, video.videoWidth, video.videoHeight));
      } catch {
        finish(undefined);
      }
    };
    video.onerror = () => finish(undefined);
    video.src = url;
  });
}

/** Thumbnail gambar: load <img>, gambar ke canvas 160. Gagal = undefined. */
function imageThumbnail(url: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (result: string | undefined) => {
      if (done) return;
      done = true;
      resolve(result);
    };
    setTimeout(() => finish(undefined), THUMB_TIMEOUT_MS);

    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        finish(drawToThumb(img, img.naturalWidth, img.naturalHeight));
      } catch {
        finish(undefined);
      }
    };
    img.onerror = () => finish(undefined);
    img.src = url;
  });
}

/**
 * Buat MediaAsset dari file terimpor: probe metadata + thumbnail + uid.
 * `extra` di-merge terakhir (mis. { hasAlpha: true } untuk hasil bg-removal).
 */
export async function assetFromImportedFile(f: ImportedFile, extra?: Partial<MediaAsset>): Promise<MediaAsset> {
  const type = mediaTypeFromName(f.name);

  let probe: ProbeResult = { duration: 0, hasAudio: false };
  try {
    probe = await bridge.probe(f.path);
  } catch {
    // probe gagal: pakai nilai default, aset tetap bisa dipakai
  }

  let thumbnail: string | undefined;
  if (type === 'video') thumbnail = await videoThumbnail(f.url);
  else if (type === 'image') thumbnail = await imageThumbnail(f.url);
  // audio: tanpa thumbnail

  return {
    id: uid('ast_'),
    name: f.name,
    type,
    path: f.path,
    url: f.url,
    duration: type === 'image' ? 0 : probe.duration || 0,
    width: probe.width,
    height: probe.height,
    hasAudio: probe.hasAudio,
    thumbnail,
    ...extra,
  };
}

/**
 * Buka dialog pilih media, proses semua file terpilih,
 * daftarkan ke proyek. Mengembalikan jumlah file yang diimpor.
 */
export async function importMediaFiles(): Promise<number> {
  const files = await bridge.pickMediaFiles();
  if (!files.length) return 0;

  const assets: MediaAsset[] = [];
  for (const f of files) {
    assets.push(await assetFromImportedFile(f));
  }
  useProject.getState().addAssets(assets);
  return assets.length;
}
