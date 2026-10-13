// Template proyek: kerangka siap pakai (rasio, track teks, gaya).
// Pengguna juga bisa menyimpan proyek sebagai template sendiri (localStorage).
import {
  Project, createEmptyProject, uid, DEFAULT_TEXT_STYLE, DEFAULT_EFFECTS, DEFAULT_TRANSFORM,
} from '../types';
import { COLOR_GRADE_PRESETS } from './colorGrades';

export interface BuiltinTemplate {
  id: string;
  name: string;
  description: string;
  ratio: string; // label, mis. "16:9"
  build(): Project;
}

function textClip(trackIdx: number, start: number, duration: number, text: string, overrides: Partial<typeof DEFAULT_TEXT_STYLE> = {}, y = 0.5) {
  return {
    id: uid('clp_'), kind: 'text' as const, start, duration, sourceIn: 0, speed: 1,
    volume: 1, muted: false, text,
    textStyle: { ...DEFAULT_TEXT_STYLE, ...overrides },
    effects: { ...DEFAULT_EFFECTS },
    transform: { ...DEFAULT_TRANSFORM, y },
  };
}

export const BUILTIN_TEMPLATES: BuiltinTemplate[] = [
  {
    id: 'youtube-169',
    name: 'YouTube Landscape',
    description: '1920x1080 - intro judul + subjudul, siap isi klip.',
    ratio: '16:9',
    build() {
      const p = createEmptyProject('Video YouTube');
      const overlay = p.tracks.find((t) => t.kind === 'overlay')!;
      overlay.clips.push(
        textClip(0, 0.5, 3, 'JUDUL VIDEO ANDA', { fontSize: 100 }, 0.42),
        textClip(0, 0.8, 2.7, 'Subjudul menarik di sini', { fontSize: 48, bold: false, color: '#ffe14d' }, 0.58),
      );
      return p;
    },
  },
  {
    id: 'shorts-916',
    name: 'Shorts / Reels / TikTok',
    description: '1080x1920 vertikal - hook di atas, caption di bawah.',
    ratio: '9:16',
    build() {
      const p = createEmptyProject('Video Shorts');
      p.width = 1080; p.height = 1920;
      const overlay = p.tracks.find((t) => t.kind === 'overlay')!;
      overlay.clips.push(
        textClip(0, 0, 2.5, 'TONTON SAMPAI HABIS 🔥', { fontSize: 72 }, 0.15),
      );
      p.subtitleStyle = { ...DEFAULT_TEXT_STYLE, fontSize: 56, outlineWidth: 3 };
      return p;
    },
  },
  {
    id: 'square-11',
    name: 'Instagram Feed',
    description: '1080x1080 persegi - cocok untuk feed IG.',
    ratio: '1:1',
    build() {
      const p = createEmptyProject('Video Instagram');
      p.width = 1080; p.height = 1080;
      return p;
    },
  },
  {
    id: 'cinematic-opener',
    name: 'Cinematic Opener',
    description: '16:9 dengan grade Cinematic + judul elegan fade-in.',
    ratio: '16:9',
    build() {
      const p = createEmptyProject('Cinematic Opener');
      const overlay = p.tracks.find((t) => t.kind === 'overlay')!;
      overlay.clips.push(
        textClip(0, 1, 4, 'SEBUAH FILM OLEH', { fontSize: 40, bold: false, outlineWidth: 0 }, 0.44),
        textClip(0, 1.6, 3.4, 'NAMA ANDA', { fontFamily: 'Georgia', fontSize: 110, outlineWidth: 0 }, 0.56),
      );
      // tandai preset default untuk klip yang nanti ditambahkan (informasi UI)
      p.name = 'Cinematic Opener';
      return p;
    },
  },
  {
    id: 'tutorial',
    name: 'Tutorial / Edukasi',
    description: '16:9 - lower-third nama + langkah, subtitle aktif.',
    ratio: '16:9',
    build() {
      const p = createEmptyProject('Video Tutorial');
      const overlay = p.tracks.find((t) => t.kind === 'overlay')!;
      overlay.clips.push(
        textClip(0, 0.5, 4, 'Nama Anda - Topik Tutorial', { fontSize: 44, backgroundColor: '#04395e', outlineWidth: 0, shadow: false, align: 'left' }, 0.88),
      );
      p.showSubtitles = true;
      return p;
    },
  },
];

// ---------- Template pengguna (localStorage) ----------

const LS_KEY = 'dcut_user_templates';

export interface UserTemplate {
  id: string;
  name: string;
  savedAt: string;
  project: Project;
}

export function loadUserTemplates(): UserTemplate[] {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || '[]');
  } catch {
    return [];
  }
}

export function saveUserTemplate(name: string, project: Project): UserTemplate {
  const templates = loadUserTemplates();
  const t: UserTemplate = {
    id: uid('tpl_'),
    name,
    savedAt: new Date().toISOString(),
    project: structuredClone(project),
  };
  templates.push(t);
  try { localStorage.setItem(LS_KEY, JSON.stringify(templates)); } catch {}
  return t;
}

export function deleteUserTemplate(id: string) {
  const templates = loadUserTemplates().filter((t) => t.id !== id);
  try { localStorage.setItem(LS_KEY, JSON.stringify(templates)); } catch {}
}

/** Terapkan template: proyek baru dengan struktur template (id di-regenerate). */
export function instantiateTemplate(project: Project): Project {
  const p = structuredClone(project);
  p.id = uid('prj_');
  return p;
}

export { COLOR_GRADE_PRESETS };
