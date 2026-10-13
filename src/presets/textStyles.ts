import type { TextStyle } from '../types';
import { DEFAULT_TEXT_STYLE } from '../types';

export interface TextStylePreset {
  id: string;
  name: string;
  style: TextStyle;
}

export const TEXT_STYLE_PRESETS: TextStylePreset[] = [
  { id: 'judul', name: 'Judul Besar', style: { ...DEFAULT_TEXT_STYLE, fontSize: 96, bold: true } },
  { id: 'subjudul', name: 'Subjudul', style: { ...DEFAULT_TEXT_STYLE, fontSize: 56, bold: false } },
  { id: 'caption-kuning', name: 'Caption Kuning', style: { ...DEFAULT_TEXT_STYLE, fontSize: 52, color: '#ffe14d', outlineWidth: 3 } },
  { id: 'kotak', name: 'Teks Berlatar', style: { ...DEFAULT_TEXT_STYLE, fontSize: 56, backgroundColor: '#000000', outlineWidth: 0, shadow: false } },
  { id: 'neon', name: 'Neon', style: { ...DEFAULT_TEXT_STYLE, fontSize: 72, color: '#4dffdf', outlineColor: '#0b6e5f', outlineWidth: 3 } },
  { id: 'elegan', name: 'Elegan (Serif)', style: { ...DEFAULT_TEXT_STYLE, fontFamily: 'Georgia', fontSize: 64, bold: false, italic: true, outlineWidth: 0, shadow: true } },
  { id: 'impact', name: 'Meme / Impact', style: { ...DEFAULT_TEXT_STYLE, fontFamily: 'Impact', fontSize: 84, color: '#ffffff', outlineWidth: 4 } },
];

export const FONT_CHOICES = [
  'Arial', 'Impact', 'Times New Roman', 'Courier New', 'Segoe UI', 'Verdana', 'Tahoma', 'Georgia', 'Comic Sans MS',
];
