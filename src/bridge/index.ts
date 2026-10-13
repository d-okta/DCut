// ============================================================
// Bridge: antarmuka UI <-> backend.
// Di Electron: implementasi IPC (window.dcut dari preload).
// Di browser dev: implementasi HTTP ke dev-server.mjs (proxy /api).
// ============================================================
import type {
  ExportOptions, ExportProgress, ProbeResult, AutoCutResult, TtsRequest, TtsResult, Project,
} from '../types';

export interface ImportedFile {
  /** Path absolut di disk. */
  path: string;
  name: string;
  /** URL yang bisa dipakai elemen <video>/<audio>/<img>. */
  url: string;
}

export interface Bridge {
  /** Buka dialog pilih file media; kembalikan daftar file terpilih. */
  pickMediaFiles(): Promise<ImportedFile[]>;
  /** Info durasi/dimensi media. */
  probe(path: string): Promise<ProbeResult>;
  /** Ekstrak audio klip ke WAV 16 kHz mono (untuk Whisper). Kembalikan URL-nya.
   *  clean=true: highpass + reduksi noise + normalisasi (akurasi transkripsi). */
  extractAudio(path: string, from: number, duration: number, clean?: boolean): Promise<{ url: string }>;
  /** Deteksi rentang hening pada file. */
  detectSilence(path: string, thresholdDb: number, minDuration: number): Promise<AutoCutResult>;
  /** Text-to-speech Windows -> WAV. */
  tts(req: TtsRequest): Promise<TtsResult>;
  /** Daftar voice TTS yang tersedia. */
  ttsVoices(): Promise<string[]>;
  /** Simpan video WebM (alpha) hasil background removal; kembalikan asset baru. */
  saveProcessedVideo(data: ArrayBuffer, baseName: string): Promise<ImportedFile>;
  /** Background removal via urutan frame PNG -> WebM alpha (dirakit backend).
   *  startTime = offset audio pada file sumber (sourceIn klip). */
  bgrStart(name: string, fps: number, origPath: string, startTime?: number): Promise<{ id: string }>;
  bgrFrame(id: string, idx: number, png: ArrayBuffer): Promise<void>;
  bgrFinish(id: string): Promise<ImportedFile>;
  /** Batalkan job BGR + bersihkan frame sementara (dipanggil saat gagal). */
  bgrCancel(id: string): Promise<void>;
  /** Mulai export; progress dikirim via callback. Resolve saat selesai/gagal. */
  exportProject(project: Project, opts: ExportOptions, onProgress: (p: ExportProgress) => void): Promise<ExportProgress>;
  /** Simpan / muat file proyek JSON. */
  saveProjectFile(project: Project): Promise<{ path: string } | null>;
  openProjectFile(): Promise<Project | null>;
  /** true bila berjalan di Electron. */
  isElectron: boolean;
}

import { httpBridge } from './httpBridge';
import { ipcBridge } from './ipcBridge';

declare global {
  interface Window { dcut?: unknown }
}

export const bridge: Bridge = typeof window !== 'undefined' && window.dcut ? ipcBridge : httpBridge;
