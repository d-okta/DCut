// ============================================================
// DCut - Auto-Cut bagian hening
// Mendeteksi rentang hening pada sumber (via FFmpeg silencedetect
// di backend), lalu menyusun rencana pemotongan: segmen sumber
// yang DIPERTAHANKAN. Penerapan memakai replaceClipWithSegments
// (ripple: segmen ditempatkan berurutan dari posisi klip lama).
// Semua satuan waktu dalam DETIK pada waktu SUMBER.
// ============================================================
import type { Clip, MediaAsset, SilenceRange } from '../types';
import { bridge } from '../bridge';
import { useProject } from '../store/projectStore';

export interface AutoCutOptions {
  /** Ambang volume dianggap hening (dB), mis. -35. */
  thresholdDb: number;
  /** Durasi minimum rentang hening (detik) agar terdeteksi. */
  minSilence: number;
  /** Sisa jeda yang dipertahankan di kedua sisi tiap silence (detik). */
  padding: number;
}

export interface AutoCutPlan {
  /** Segmen sumber yang dipertahankan, berurutan. */
  keptSegments: { sourceIn: number; duration: number }[];
  /** Jumlah rentang hening yang akan dibuang. */
  removedCount: number;
  /** Total durasi hening yang dibuang (detik, waktu sumber). */
  removedDuration: number;
}

/** Durasi minimum segmen hasil agar tidak menghasilkan klip mikroskopis. */
const MIN_SEGMENT = 0.15;

/**
 * Susun rencana auto-cut untuk satu klip.
 * Hanya bagian sumber yang benar-benar dipakai klip yang dianalisis:
 * [clip.sourceIn, clip.sourceIn + clip.duration * clip.speed].
 */
export async function planAutoCut(clip: Clip, asset: MediaAsset, opts: AutoCutOptions): Promise<AutoCutPlan> {
  const result = await bridge.detectSilence(asset.path, opts.thresholdDb, opts.minSilence);

  // Rentang sumber yang dipakai klip (memperhitungkan speed).
  const rangeStart = clip.sourceIn;
  const rangeEnd = clip.sourceIn + clip.duration * clip.speed;

  // Potong tiap silence ke rentang klip, lalu kecilkan dengan padding
  // di kedua sisi; buang yang habis (<= 0).
  const silences: SilenceRange[] = [];
  for (const s of result.silences) {
    const start = Math.max(s.start, rangeStart) + opts.padding;
    const end = Math.min(s.end, rangeEnd) - opts.padding;
    if (end - start > 0) silences.push({ start, end });
  }
  silences.sort((a, b) => a.start - b.start);

  // keptSegments = komplemen silences di dalam rentang.
  const kept: { sourceIn: number; duration: number }[] = [];
  let cursor = rangeStart;
  let removedDuration = 0;
  for (const s of silences) {
    if (s.start > cursor) kept.push({ sourceIn: cursor, duration: s.start - cursor });
    // bagian silence yang benar-benar terpakai (aman bila tumpang tindih)
    removedDuration += Math.max(0, s.end - Math.max(s.start, cursor));
    cursor = Math.max(cursor, s.end);
  }
  if (cursor < rangeEnd) kept.push({ sourceIn: cursor, duration: rangeEnd - cursor });

  return {
    keptSegments: kept.filter((k) => k.duration >= MIN_SEGMENT),
    removedCount: silences.length,
    removedDuration,
  };
}

/**
 * Terapkan rencana: ganti klip dengan rangkaian segmen yang dipertahankan.
 * Mengembalikan true bila penggantian benar-benar terjadi; false bila tidak
 * ada segmen tersisa (klip seluruhnya hening), klip sudah hilang, atau
 * track-nya terkunci - pada kasus ini TIDAK ada mutasi/entri undo.
 */
export function applyAutoCut(clipId: string, plan: AutoCutPlan): boolean {
  if (!plan.keptSegments.length) return false;
  const store = useProject.getState();
  const track = store.project.tracks.find((t) => t.clips.some((c) => c.id === clipId));
  if (!track || track.locked) return false;
  store.replaceClipWithSegments(clipId, plan.keptSegments);
  return true;
}
