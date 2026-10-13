import type { TransitionType } from '../types';

export interface TransitionPreset {
  type: TransitionType;
  name: string;
  /** Emoji/ikon sederhana untuk kartu preset. */
  icon: string;
}

export const TRANSITION_PRESETS: TransitionPreset[] = [
  { type: 'none', name: 'Tanpa transisi', icon: '∅' },
  { type: 'fade', name: 'Fade', icon: '◐' },
  { type: 'dissolve', name: 'Dissolve', icon: '▒' },
  { type: 'wipeleft', name: 'Wipe Kiri', icon: '◀' },
  { type: 'wiperight', name: 'Wipe Kanan', icon: '▶' },
  { type: 'slideup', name: 'Slide Atas', icon: '▲' },
  { type: 'slidedown', name: 'Slide Bawah', icon: '▼' },
  { type: 'slideleft', name: 'Slide Kiri', icon: '⬅' },
  { type: 'slideright', name: 'Slide Kanan', icon: '➡' },
  { type: 'circleopen', name: 'Lingkaran Buka', icon: '◎' },
  { type: 'circleclose', name: 'Lingkaran Tutup', icon: '◉' },
  { type: 'pixelize', name: 'Pixelize', icon: '▦' },
  { type: 'radial', name: 'Radial', icon: '❋' },
];
