// ============================================================
// Store UI/transport: playhead, zoom, seleksi, alat, panel aktif,
// Source Monitor. (Tidak masuk undo/redo.)
// ============================================================
import { create } from 'zustand';
import type { Clip } from '../types';

/** Alat timeline ala Premiere (V, C, B, Y, H, Z). */
export type Tool = 'select' | 'razor' | 'ripple' | 'slip' | 'hand' | 'zoom';

/** Panel kiri-atas (bertab, seperti frame Project/Effects di Premiere). */
export type LeftTab = 'project' | 'effects' | 'text' | 'templates' | 'ai' | 'markers';
/** Panel kanan-atas (Effect Controls / Lumetri / Essential Sound / Captions). */
export type RightTab = 'controls' | 'color' | 'audio' | 'captions';
export type AiTab = 'subtitle' | 'bgremove' | 'tts' | 'autocut';
/** Ruang kerja: tata letak panel yang disimpan per kebutuhan. */
export type Workspace = 'editing' | 'color' | 'audio' | 'captions';

export interface ClipboardEntry {
  clip: Clip;      // salinan dalam (deep clone) - aman walau klip asal berubah
  trackId: string; // track asal, jadi Ctrl+V mengutamakan track yang sama
}

/** Isi Source Monitor: aset yang dibuka dari panel Project, beserta In/Out-nya sendiri. */
export interface SourceState {
  assetId: string;
  time: number;
  inPoint?: number;
  outPoint?: number;
}

interface UiStore {
  // transport
  currentTime: number;
  playing: boolean;
  /** Kecepatan shuttle J/K/L: 1 = normal, 2/4/8 = cepat, negatif = mundur. */
  shuttle: number;
  setCurrentTime(t: number): void;
  play(): void;
  pause(): void;
  togglePlay(): void;
  setShuttle(v: number): void;

  // monitor aktif menerima pintasan transport & I/O
  focusedMonitor: 'source' | 'program';
  setFocusedMonitor(m: 'source' | 'program'): void;
  source: SourceState | null;
  sourcePlaying: boolean;
  openInSource(assetId: string): void;
  setSource(patch: Partial<SourceState>): void;
  setSourcePlaying(v: boolean): void;

  // timeline view
  pxPerSec: number;              // zoom timeline
  setPxPerSec(v: number): void;
  snapping: boolean;
  toggleSnapping(): void;
  tool: Tool;
  setTool(t: Tool): void;

  // seleksi
  selectedClipId: string | null;
  selectClip(id: string | null): void;
  selectedSubtitleId: string | null;
  selectSubtitle(id: string | null): void;

  // panel
  leftTab: LeftTab;
  setLeftTab(p: LeftTab): void;
  rightTab: RightTab;
  setRightTab(p: RightTab): void;
  workspace: Workspace;
  setWorkspace(w: Workspace): void;
  aiTab: AiTab;
  setAiTab(t: AiTab): void;
  exportOpen: boolean;
  setExportOpen(v: boolean): void;
  helpOpen: boolean;
  setHelpOpen(v: boolean): void;
  /** Kotak isian timecode program (Ctrl+G / klik timecode). */
  gotoOpen: boolean;
  setGotoOpen(v: boolean): void;

  // clipboard klip (Ctrl+C/X/V)
  clipboard: ClipboardEntry | null;
  setClipboard(entry: ClipboardEntry | null): void;

  // notifikasi ringan
  toast: string | null;
  showToast(msg: string): void;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

/** Tab panel yang dibuka tiap ruang kerja, supaya satu klik menata ulang layar. */
const WORKSPACE_TABS: Record<Workspace, { left: LeftTab; right: RightTab }> = {
  editing: { left: 'project', right: 'controls' },
  color: { left: 'effects', right: 'color' },
  audio: { left: 'project', right: 'audio' },
  captions: { left: 'ai', right: 'captions' },
};

export const useUi = create<UiStore>((set, get) => ({
  currentTime: 0,
  playing: false,
  shuttle: 1,
  setCurrentTime: (t) => set({ currentTime: Math.max(0, t) }),
  play: () => set({ playing: true, shuttle: 1 }),
  pause: () => set({ playing: false, shuttle: 1 }),
  togglePlay: () => set({ playing: !get().playing, shuttle: 1 }),
  setShuttle: (v) => set({ shuttle: v, playing: v !== 0 }),

  focusedMonitor: 'program',
  setFocusedMonitor: (m) => set({ focusedMonitor: m }),
  source: null,
  sourcePlaying: false,
  openInSource: (assetId) => {
    const cur = get().source;
    set({
      source: cur && cur.assetId === assetId ? cur : { assetId, time: 0 },
      focusedMonitor: 'source',
      sourcePlaying: false,
    });
  },
  setSource: (patch) => {
    const cur = get().source;
    if (cur) set({ source: { ...cur, ...patch } });
  },
  setSourcePlaying: (v) => set({ sourcePlaying: v }),

  pxPerSec: 60,
  setPxPerSec: (v) => set({ pxPerSec: Math.max(4, Math.min(600, v)) }),
  snapping: true,
  toggleSnapping: () => set({ snapping: !get().snapping }),
  tool: 'select',
  setTool: (t) => set({ tool: t }),

  selectedClipId: null,
  selectClip: (id) => set({ selectedClipId: id, selectedSubtitleId: null }),
  selectedSubtitleId: null,
  selectSubtitle: (id) => set({ selectedSubtitleId: id, selectedClipId: id ? null : get().selectedClipId }),

  leftTab: 'project',
  setLeftTab: (p) => set({ leftTab: p }),
  rightTab: 'controls',
  setRightTab: (p) => set({ rightTab: p }),
  workspace: 'editing',
  setWorkspace: (w) => set({ workspace: w, leftTab: WORKSPACE_TABS[w].left, rightTab: WORKSPACE_TABS[w].right }),
  aiTab: 'subtitle',
  setAiTab: (t) => set({ aiTab: t }),
  exportOpen: false,
  setExportOpen: (v) => set({ exportOpen: v }),
  helpOpen: false,
  setHelpOpen: (v) => set({ helpOpen: v }),
  gotoOpen: false,
  setGotoOpen: (v) => set({ gotoOpen: v }),

  clipboard: null,
  setClipboard: (entry) => set({ clipboard: entry }),

  toast: null,
  showToast: (msg) => {
    set({ toast: msg });
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => set({ toast: null }), 3500);
  },
}));
