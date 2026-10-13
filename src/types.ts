// ============================================================
// NusaCut Studio - Model data inti
// Semua satuan waktu dalam DETIK (number, boleh pecahan).
// Koordinat posisi klip dinormalisasi 0..1 relatif ke frame proyek.
// ============================================================

export type MediaType = 'video' | 'audio' | 'image';

export interface MediaAsset {
  id: string;
  name: string;
  type: MediaType;
  /** Path file absolut di disk (dipakai FFmpeg saat export). */
  path: string;
  /** URL yang bisa dipakai <video>/<img> di renderer (file:// di Electron, /media/... di dev). */
  url: string;
  duration: number; // detik; untuk gambar = 0
  width?: number;
  height?: number;
  hasAudio?: boolean;
  /** WebM alpha hasil background-removal, bila ada. */
  hasAlpha?: boolean;
  thumbnail?: string; // dataURL kecil untuk media bin
}

// ---------- Efek & tampilan ----------

export interface ClipEffects {
  brightness: number;  // -1..1, 0 = normal
  contrast: number;    // 0..2, 1 = normal
  saturation: number;  // 0..2, 1 = normal
  temperature: number; // -1 (dingin/biru) .. 1 (hangat/oranye), 0 = normal
  hue: number;         // derajat -180..180, 0 = normal
  blur: number;        // px 0..20
  vignette: number;    // 0..1
  presetId?: string;   // id preset color grade yang sedang aktif (informasi UI)
}

export const DEFAULT_EFFECTS: ClipEffects = {
  brightness: 0, contrast: 1, saturation: 1, temperature: 0, hue: 0, blur: 0, vignette: 0,
};

export interface TextStyle {
  fontFamily: string;   // nama font sistem, mis. "Arial"
  fontSize: number;     // px relatif terhadap tinggi proyek 1080
  color: string;        // hex
  bold: boolean;
  italic: boolean;
  align: 'left' | 'center' | 'right';
  outlineColor: string;
  outlineWidth: number; // px, 0 = tanpa outline
  backgroundColor?: string; // hex atau undefined = transparan
  shadow: boolean;
}

export const DEFAULT_TEXT_STYLE: TextStyle = {
  fontFamily: 'Arial', fontSize: 64, color: '#ffffff', bold: true, italic: false,
  align: 'center', outlineColor: '#000000', outlineWidth: 2, shadow: true,
};

export type TransitionType =
  | 'none' | 'fade' | 'dissolve' | 'wipeleft' | 'wiperight'
  | 'slideup' | 'slidedown' | 'slideleft' | 'slideright'
  | 'circleopen' | 'circleclose' | 'pixelize' | 'radial';

export interface Transition {
  type: TransitionType;
  duration: number; // detik, overlap dengan klip berikutnya
}

/** Transform posisi klip di frame. Nilai default: penuh satu frame. */
export interface ClipTransform {
  x: number;       // 0..1 posisi tengah klip (0.5 = tengah)
  y: number;       // 0..1
  scale: number;   // 1 = ukuran fit-frame
  rotation: number; // derajat
  opacity: number; // 0..1
}

export const DEFAULT_TRANSFORM: ClipTransform = { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1 };

// ---------- Klip & track ----------

export type ClipKind = 'video' | 'audio' | 'image' | 'text';

export interface Clip {
  id: string;
  kind: ClipKind;
  /** id MediaAsset; kosong untuk klip teks. */
  assetId?: string;
  /** Posisi mulai di timeline (detik). */
  start: number;
  /** Durasi tampil di timeline (detik). */
  duration: number;
  /** Offset ke dalam file sumber (detik) - bagian sumber yang dipakai mulai dari sini. */
  sourceIn: number;
  /** Kecepatan playback, 1 = normal. (MVP: memengaruhi export & preview video) */
  speed: number;
  volume: number;  // 0..2, 1 = normal
  muted: boolean;
  effects: ClipEffects;
  transform: ClipTransform;
  /** Transisi MENUJU klip berikutnya di track yang sama (jika bersebelahan). */
  transitionOut?: Transition;
  /** Untuk kind === 'text' */
  text?: string;
  textStyle?: TextStyle;
}

export type TrackKind = 'video' | 'overlay' | 'audio';

export interface Track {
  id: string;
  kind: TrackKind;
  name: string;
  muted: boolean;
  locked: boolean;
  /** Klip TIDAK dijamin terurut; gunakan util sortedClips(). */
  clips: Clip[];
}

// ---------- Subtitle ----------

export interface SubtitleCue {
  id: string;
  start: number;
  end: number;
  text: string;
}

// ---------- Proyek ----------

export interface Project {
  id: string;
  name: string;
  width: number;   // mis. 1920
  height: number;  // mis. 1080
  fps: number;     // mis. 30
  tracks: Track[];
  subtitles: SubtitleCue[];
  subtitleStyle: TextStyle;
  showSubtitles: boolean;
  assets: MediaAsset[];
}

// ---------- Template ----------

export interface ProjectTemplate {
  id: string;
  name: string;
  description: string;
  /** Rasio & setting yang diterapkan. */
  width: number;
  height: number;
  fps: number;
  /** Fungsi pembuat isi template dijalankan di presets/templates.ts */
  builder?: string;
}

// ---------- Export ----------

export interface ExportOptions {
  outPath?: string;        // diisi dialog electron; dev-server menaruh di folder proyek
  width: number;
  height: number;
  fps: number;
  crf: number;             // 18..28
  burnSubtitles: boolean;
}

export interface ExportProgress {
  phase: 'preparing' | 'rendering' | 'done' | 'error';
  percent: number;         // 0..100
  message?: string;
  outPath?: string;
}

// ---------- AI ----------

export interface SilenceRange { start: number; end: number }

export interface AutoCutResult {
  /** Rentang hening pada SUMBER (detik dari awal file). */
  silences: SilenceRange[];
}

export interface TtsRequest {
  text: string;
  voice?: string;   // nama voice Windows; kosong = default
  rate?: number;    // -10..10, 0 normal
}

export interface TtsResult {
  path: string;     // file WAV di disk
  url: string;      // URL untuk renderer
  duration: number;
}

export interface ProbeResult {
  duration: number;
  width?: number;
  height?: number;
  hasAudio: boolean;
  fps?: number;
}

// ---------- Util ----------

/**
 * Ambang "bersebelahan" (detik) untuk transisi antar klip.
 * HARUS sama dengan EPS di services/exportGraph.cjs agar UI/preview/export konsisten.
 */
export const ADJACENT_EPS = 0.05;

export function uid(prefix = ''): string {
  return prefix + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function sortedClips(track: Track): Clip[] {
  return [...track.clips].sort((a, b) => a.start - b.start);
}

export function clipEnd(c: Clip): number {
  return c.start + c.duration;
}

/** Durasi proyek = akhir klip terjauh (min 5 detik supaya timeline tidak kosong). */
export function projectDuration(p: Project): number {
  let end = 0;
  for (const t of p.tracks) for (const c of t.clips) end = Math.max(end, clipEnd(c));
  for (const s of p.subtitles) end = Math.max(end, s.end);
  return Math.max(end, 5);
}

export function createEmptyProject(name = 'Proyek Baru'): Project {
  return {
    id: uid('prj_'),
    name,
    width: 1920,
    height: 1080,
    fps: 30,
    tracks: [
      { id: uid('trk_'), kind: 'video', name: 'Video 1', muted: false, locked: false, clips: [] },
      { id: uid('trk_'), kind: 'overlay', name: 'Overlay / Teks', muted: false, locked: false, clips: [] },
      { id: uid('trk_'), kind: 'audio', name: 'Audio 1', muted: false, locked: false, clips: [] },
    ],
    subtitles: [],
    subtitleStyle: { ...DEFAULT_TEXT_STYLE, fontSize: 48 },
    showSubtitles: true,
    assets: [],
  };
}
