// ============================================================
// Store UI/transport: playhead, zoom, seleksi, panel aktif.
// (Tidak masuk undo/redo.)
// ============================================================
import { create } from 'zustand';
import type { Clip } from '../types';

export type PanelTab = 'media' | 'text' | 'transitions' | 'effects' | 'templates' | 'ai';
export type AiTab = 'subtitle' | 'bgremove' | 'tts' | 'autocut';

export interface ClipboardEntry {
  clip: Clip;      // salinan dalam (deep clone) - aman walau klip asal berubah
  trackId: string; // track asal, jadi Ctrl+V mengutamakan track yang sama
}

interface UiStore {
  // transport
  currentTime: number;
  playing: boolean;
  setCurrentTime(t: number): void;
  play(): void;
  pause(): void;
  togglePlay(): void;

  // timeline view
  pxPerSec: number;              // zoom timeline
  setPxPerSec(v: number): void;
  snapping: boolean;
  toggleSnapping(): void;

  // seleksi
  selectedClipId: string | null;
  selectClip(id: string | null): void;
  selectedSubtitleId: string | null;
  selectSubtitle(id: string | null): void;

  // panel
  activePanel: PanelTab;
  setActivePanel(p: PanelTab): void;
  aiTab: AiTab;
  setAiTab(t: AiTab): void;
  exportOpen: boolean;
  setExportOpen(v: boolean): void;
  helpOpen: boolean;
  setHelpOpen(v: boolean): void;

  // clipboard klip (Ctrl+C/X/V)
  clipboard: ClipboardEntry | null;
  setClipboard(entry: ClipboardEntry | null): void;

  // notifikasi ringan
  toast: string | null;
  showToast(msg: string): void;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;

export const useUi = create<UiStore>((set, get) => ({
  currentTime: 0,
  playing: false,
  setCurrentTime: (t) => set({ currentTime: Math.max(0, t) }),
  play: () => set({ playing: true }),
  pause: () => set({ playing: false }),
  togglePlay: () => set({ playing: !get().playing }),

  pxPerSec: 60,
  setPxPerSec: (v) => set({ pxPerSec: Math.max(8, Math.min(400, v)) }),
  snapping: true,
  toggleSnapping: () => set({ snapping: !get().snapping }),

  selectedClipId: null,
  selectClip: (id) => set({ selectedClipId: id, selectedSubtitleId: null }),
  selectedSubtitleId: null,
  selectSubtitle: (id) => set({ selectedSubtitleId: id, selectedClipId: id ? null : get().selectedClipId }),

  activePanel: 'media',
  setActivePanel: (p) => set({ activePanel: p }),
  aiTab: 'subtitle',
  setAiTab: (t) => set({ aiTab: t }),
  exportOpen: false,
  setExportOpen: (v) => set({ exportOpen: v }),
  helpOpen: false,
  setHelpOpen: (v) => set({ helpOpen: v }),

  clipboard: null,
  setClipboard: (entry) => set({ clipboard: entry }),

  toast: null,
  showToast: (msg) => {
    set({ toast: msg });
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => set({ toast: null }), 3500);
  },
}));
