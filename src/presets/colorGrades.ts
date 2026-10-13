import type { ClipEffects } from '../types';
import { DEFAULT_EFFECTS } from '../types';

export interface ColorGradePreset {
  id: string;
  name: string;
  effects: ClipEffects;
  /** Gradien CSS untuk thumbnail kartu preset. */
  swatch: string;
}

export const COLOR_GRADE_PRESETS: ColorGradePreset[] = [
  { id: 'normal', name: 'Normal', effects: { ...DEFAULT_EFFECTS, presetId: 'normal' }, swatch: 'linear-gradient(135deg,#8a8f98,#c8ccd4)' },
  { id: 'cinematic', name: 'Cinematic', effects: { ...DEFAULT_EFFECTS, presetId: 'cinematic', contrast: 1.18, saturation: 0.92, temperature: -0.18, brightness: -0.04, vignette: 0.35 }, swatch: 'linear-gradient(135deg,#0f2c40,#d38f5b)' },
  { id: 'warm', name: 'Hangat', effects: { ...DEFAULT_EFFECTS, presetId: 'warm', temperature: 0.35, saturation: 1.1, brightness: 0.03 }, swatch: 'linear-gradient(135deg,#f2a65a,#ef767a)' },
  { id: 'cool', name: 'Dingin', effects: { ...DEFAULT_EFFECTS, presetId: 'cool', temperature: -0.35, saturation: 1.05 }, swatch: 'linear-gradient(135deg,#4a7fb5,#9ad1d4)' },
  { id: 'vintage', name: 'Vintage', effects: { ...DEFAULT_EFFECTS, presetId: 'vintage', saturation: 0.7, contrast: 0.92, temperature: 0.22, brightness: 0.05, vignette: 0.45 }, swatch: 'linear-gradient(135deg,#b0885d,#e8d5b5)' },
  { id: 'bw', name: 'Hitam Putih', effects: { ...DEFAULT_EFFECTS, presetId: 'bw', saturation: 0, contrast: 1.15 }, swatch: 'linear-gradient(135deg,#222,#ddd)' },
  { id: 'vivid', name: 'Vivid', effects: { ...DEFAULT_EFFECTS, presetId: 'vivid', saturation: 1.45, contrast: 1.12, brightness: 0.02 }, swatch: 'linear-gradient(135deg,#ff4e50,#1fddff)' },
  { id: 'pastel', name: 'Pastel', effects: { ...DEFAULT_EFFECTS, presetId: 'pastel', saturation: 0.8, brightness: 0.09, contrast: 0.9 }, swatch: 'linear-gradient(135deg,#fbc2eb,#a6c1ee)' },
  { id: 'moody', name: 'Moody', effects: { ...DEFAULT_EFFECTS, presetId: 'moody', brightness: -0.09, contrast: 1.22, saturation: 0.85, temperature: -0.12, vignette: 0.5 }, swatch: 'linear-gradient(135deg,#1a1a2e,#4a4e69)' },
  { id: 'sunset', name: 'Sunset', effects: { ...DEFAULT_EFFECTS, presetId: 'sunset', temperature: 0.45, saturation: 1.2, contrast: 1.08, vignette: 0.25 }, swatch: 'linear-gradient(135deg,#f83600,#f9d423)' },
];
