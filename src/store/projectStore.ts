// ============================================================
// Store proyek (Zustand) + undo/redo.
//
// ATURAN HISTORY:
// - Semua aksi mutasi biasa otomatis menyimpan snapshot undo.
// - Aksi ber-suffix `Live` TIDAK menyimpan history - dipakai saat drag.
//   Pemanggil WAJIB memanggil pushHistory() sekali di awal gesture.
// ============================================================
import { create } from 'zustand';
import {
  Project, Track, Clip, MediaAsset, SubtitleCue, TextStyle, Transition,
  ClipEffects, ClipTransform, TrackKind, Marker,
  createEmptyProject, normalizeProject, uid, sortedClips, clipEnd,
  DEFAULT_EFFECTS, DEFAULT_TEXT_STYLE, DEFAULT_TRANSFORM, MARKER_COLORS,
} from '../types';

const HISTORY_LIMIT = 50;

interface ProjectStore {
  project: Project;
  past: Project[];
  future: Project[];

  // ---- history ----
  pushHistory(): void;
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;

  // ---- proyek ----
  setProject(p: Project): void;               // ganti seluruh proyek (load/template) - dengan history
  newProject(): void;
  renameProject(name: string): void;
  setProjectSettings(s: { width?: number; height?: number; fps?: number }): void;

  // ---- aset ----
  addAssets(assets: MediaAsset[]): void;
  removeAsset(assetId: string): void;

  // ---- track ----
  addTrack(kind: TrackKind): void;
  removeTrack(trackId: string): void;
  toggleTrackMuted(trackId: string): void;
  toggleTrackLocked(trackId: string): void;

  // ---- klip ----
  addClipFromAsset(trackId: string, assetId: string, at: number): string | null;
  addTextClip(trackId: string, at: number, text?: string): string | null;
  moveClip(clipId: string, trackId: string, newStart: number): void;
  moveClipLive(clipId: string, trackId: string, newStart: number): void;
  resizeClipLive(clipId: string, edge: 'start' | 'end', newTime: number): void;
  /** Belah klip; kembalikan id potongan KANAN (null bila tidak terbelah). */
  splitClipAt(clipId: string, time: number): string | null;
  deleteClip(clipId: string): void;
  /** Gandakan klip; salinan ditempatkan setelah klip asal. */
  duplicateClip(clipId: string): string | null;
  /**
   * Tempel salinan klip di waktu tertentu (untuk clipboard Ctrl+V).
   * preferTrackId dipakai bila masih ada & cocok jenisnya; selain itu
   * jatuh ke track kompatibel pertama yang tidak terkunci.
   */
  pasteClip(clip: Clip, at: number, preferTrackId?: string): string | null;
  /** Buang bagian kiri/kanan klip pada playhead (Q/W ala CapCut) - satu entri undo. */
  trimToPlayhead(clipId: string, side: 'left' | 'right', time: number): void;
  updateClip(clipId: string, patch: Partial<Clip>): void;
  updateClipLive(clipId: string, patch: Partial<Clip>): void;
  updateEffects(clipId: string, patch: Partial<ClipEffects>): void;
  updateEffectsLive(clipId: string, patch: Partial<ClipEffects>): void;
  updateTransform(clipId: string, patch: Partial<ClipTransform>): void;
  updateTransformLive(clipId: string, patch: Partial<ClipTransform>): void;
  updateTextStyle(clipId: string, patch: Partial<TextStyle>): void;
  setTransition(clipId: string, tr: Transition | undefined): void;

  /**
   * Ganti satu klip dengan rangkaian segmen sumber (dipakai auto-cut).
   * Segmen ditempatkan berurutan mulai dari posisi klip lama (ripple).
   */
  replaceClipWithSegments(clipId: string, segments: { sourceIn: number; duration: number }[]): void;

  // ---- subtitle ----
  setSubtitles(cues: SubtitleCue[]): void;
  addSubtitle(cue: Omit<SubtitleCue, 'id'>): void;
  updateSubtitle(id: string, patch: Partial<SubtitleCue>): void;
  removeSubtitle(id: string): void;
  setSubtitleStyle(patch: Partial<TextStyle>): void;
  setShowSubtitles(v: boolean): void;

  // ---- editing ala Premiere ----
  /** Ripple Delete (Shift+Delete): hapus klip, klip setelahnya di track yang sama bergeser menutup celah. */
  rippleDeleteClip(clipId: string): void;
  /** Add Edit (Ctrl+K): belah semua klip yang dilalui playhead di track yang tidak terkunci. */
  addEditAllTracks(time: number): number;
  /** Ripple Trim (Q/W Premiere): buang bagian sebelum/sesudah playhead lalu rapatkan track. */
  rippleTrimToPlayhead(clipId: string, side: 'left' | 'right', time: number): void;
  /** Slip (alat Y): geser isi sumber tanpa mengubah posisi & durasi klip di timeline. */
  slipClipLive(clipId: string, sourceIn: number): void;
  /** Ripple trim tepi (alat B): ubah durasi klip dan geser klip setelahnya. */
  rippleResizeLive(clipId: string, edge: 'start' | 'end', newTime: number): void;
  /** Sisipkan klip dari Source Monitor: insert (geser) atau overwrite (timpa). */
  editFromSource(
    assetId: string, srcIn: number, srcOut: number, at: number,
    mode: 'insert' | 'overwrite', videoTrackId?: string, audioTrackId?: string,
  ): string | null;
  /** Lift (;) / Extract (') rentang In-Out sequence di track yang tidak terkunci. */
  liftOrExtract(mode: 'lift' | 'extract'): boolean;
  setClipsDisabled(ids: string[], disabled: boolean): void;
  toggleTrackSolo(trackId: string): void;
  renameTrack(trackId: string, name: string): void;

  // ---- penanda & In/Out ----
  addMarker(time: number, name?: string): string;
  updateMarker(id: string, patch: Partial<Marker>): void;
  removeMarker(id: string): void;
  setInOut(patch: { inPoint?: number | null; outPoint?: number | null }): void;
}

// ---------- util internal ----------

function findClip(p: Project, clipId: string): { track: Track; clip: Clip } | null {
  for (const track of p.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return { track, clip };
  }
  return null;
}

/**
 * Cari posisi valid terdekat agar klip tidak menimpa klip lain di track.
 * Deterministik: enumerasi semua celah kosong yang muat, pilih posisi
 * valid yang paling dekat dengan `desired` (tidak ada ping-pong).
 */
function clampToFreeSpace(track: Track, clipId: string, desired: number, duration: number): number {
  const others = sortedClips(track).filter((c) => c.id !== clipId);
  const want = Math.max(0, desired);
  if (!others.length) return want;

  // Bangun daftar celah [gapStart, gapEnd) termasuk sebelum klip pertama
  // dan setelah klip terakhir (tak berhingga).
  const gaps: { start: number; end: number }[] = [];
  let cursor = 0;
  for (const o of others) {
    if (o.start - cursor > 0.0001) gaps.push({ start: cursor, end: o.start });
    cursor = Math.max(cursor, clipEnd(o));
  }
  gaps.push({ start: cursor, end: Infinity });

  let best = cursor; // fallback: setelah klip terakhir
  let bestDist = Infinity;
  for (const g of gaps) {
    if (g.end - g.start < duration - 0.0001) continue; // celah tidak muat
    // posisi valid dalam celah ini yang terdekat ke `want`
    const upper = g.end === Infinity ? Infinity : g.end - duration;
    const pos = Math.min(Math.max(want, g.start), upper);
    const dist = Math.abs(pos - want);
    if (dist < bestDist) { best = pos; bestDist = dist; }
  }
  return Math.max(0, best);
}

function clone(p: Project): Project {
  return structuredClone(p);
}

export const useProject = create<ProjectStore>((set, get) => {
  /** Mutasi DENGAN history. Mutasi no-op (tidak mengubah apa pun) di-skip
   *  agar tidak menumpuk entri undo kosong / menghapus redo tanpa alasan. */
  const commit = (fn: (p: Project) => void) => {
    const { project, past } = get();
    const snapshot = clone(project);
    const next = clone(project);
    fn(next);
    if (JSON.stringify(next) === JSON.stringify(project)) return;
    set({ project: next, past: [...past.slice(-HISTORY_LIMIT + 1), snapshot], future: [] });
  };
  /** Mutasi TANPA history (live/drag). */
  const live = (fn: (p: Project) => void) => {
    const next = clone(get().project);
    fn(next);
    set({ project: next });
  };

  return {
    project: createEmptyProject(),
    past: [],
    future: [],

    pushHistory() {
      const { project, past } = get();
      set({ past: [...past.slice(-HISTORY_LIMIT + 1), clone(project)], future: [] });
    },
    undo() {
      const { past, future, project } = get();
      if (!past.length) return;
      const prev = past[past.length - 1];
      set({ project: prev, past: past.slice(0, -1), future: [clone(project), ...future].slice(0, HISTORY_LIMIT) });
    },
    redo() {
      const { past, future, project } = get();
      if (!future.length) return;
      const next = future[0];
      set({ project: next, past: [...past, clone(project)].slice(-HISTORY_LIMIT), future: future.slice(1) });
    },
    canUndo: () => get().past.length > 0,
    canRedo: () => get().future.length > 0,

    setProject(p) {
      const { project, past } = get();
      set({ project: normalizeProject(clone(p)), past: [...past.slice(-HISTORY_LIMIT + 1), clone(project)], future: [] });
    },
    newProject() {
      get().setProject(createEmptyProject());
    },
    renameProject(name) {
      commit((p) => { p.name = name; });
    },
    setProjectSettings(s) {
      commit((p) => {
        if (s.width) p.width = s.width;
        if (s.height) p.height = s.height;
        if (s.fps) p.fps = s.fps;
      });
    },

    addAssets(assets) {
      commit((p) => { p.assets.push(...assets); });
    },
    removeAsset(assetId) {
      commit((p) => {
        p.assets = p.assets.filter((a) => a.id !== assetId);
        for (const t of p.tracks) t.clips = t.clips.filter((c) => c.assetId !== assetId);
      });
    },

    addTrack(kind) {
      commit((p) => {
        // Penamaan ala Premiere: track visual V1, V2, ...; track audio A1, A2, ...
        const visual = p.tracks.filter((t) => t.kind !== 'audio').length;
        const audio = p.tracks.filter((t) => t.kind === 'audio').length;
        const name = kind === 'audio' ? `A${audio + 1}` : `V${visual + 1}`;
        const track: Track = { id: uid('trk_'), kind, name, muted: false, locked: false, clips: [] };
        if (kind === 'audio') {
          p.tracks.push(track);
          return;
        }
        // Sisipkan SETELAH track sejenis terakhir: track video pertama tetap
        // menjadi base export; track baru menumpuk di atasnya.
        let idx = -1;
        for (let i = 0; i < p.tracks.length; i++) if (p.tracks[i].kind === kind) idx = i;
        if (idx < 0) {
          // belum ada track sejenis: video di depan, overlay setelah semua video
          if (kind === 'video') idx = -1;
          else for (let i = 0; i < p.tracks.length; i++) if (p.tracks[i].kind === 'video') idx = i;
        }
        p.tracks.splice(idx + 1, 0, track);
      });
    },
    removeTrack(trackId) {
      commit((p) => { p.tracks = p.tracks.filter((t) => t.id !== trackId); });
    },
    toggleTrackMuted(trackId) {
      commit((p) => {
        const t = p.tracks.find((x) => x.id === trackId);
        if (t) t.muted = !t.muted;
      });
    },
    toggleTrackLocked(trackId) {
      commit((p) => {
        const t = p.tracks.find((x) => x.id === trackId);
        if (t) t.locked = !t.locked;
      });
    },

    addClipFromAsset(trackId, assetId, at) {
      let newId: string | null = null;
      commit((p) => {
        const track = p.tracks.find((t) => t.id === trackId);
        const asset = p.assets.find((a) => a.id === assetId);
        if (!track || !asset || track.locked) return;
        const duration = asset.type === 'image' ? 4 : Math.max(0.1, asset.duration);
        const kind = asset.type === 'video' ? 'video' : asset.type === 'audio' ? 'audio' : 'image';
        if (track.kind === 'audio' && kind !== 'audio') return;
        if (track.kind !== 'audio' && kind === 'audio') return;
        const start = clampToFreeSpace(track, '__new__', Math.max(0, at), duration);
        const clip: Clip = {
          id: uid('clp_'), kind, assetId, start, duration, sourceIn: 0, speed: 1,
          volume: 1, muted: false,
          effects: { ...DEFAULT_EFFECTS }, transform: { ...DEFAULT_TRANSFORM },
        };
        track.clips.push(clip);
        newId = clip.id;
      });
      return newId;
    },

    addTextClip(trackId, at, text = 'Teks baru') {
      let newId: string | null = null;
      commit((p) => {
        const track = p.tracks.find((t) => t.id === trackId);
        if (!track || track.kind === 'audio' || track.locked) return;
        const duration = 3;
        const start = clampToFreeSpace(track, '__new__', Math.max(0, at), duration);
        const clip: Clip = {
          id: uid('clp_'), kind: 'text', start, duration, sourceIn: 0, speed: 1,
          volume: 1, muted: false, text, textStyle: { ...DEFAULT_TEXT_STYLE },
          effects: { ...DEFAULT_EFFECTS }, transform: { ...DEFAULT_TRANSFORM, y: 0.5 },
        };
        track.clips.push(clip);
        newId = clip.id;
      });
      return newId;
    },

    moveClip(clipId, trackId, newStart) {
      commit((p) => doMove(p, clipId, trackId, newStart));
    },
    moveClipLive(clipId, trackId, newStart) {
      live((p) => doMove(p, clipId, trackId, newStart));
    },

    resizeClipLive(clipId, edge, newTime) {
      live((p) => {
        const found = findClip(p, clipId);
        if (!found || found.track.locked) return;
        const { track, clip } = found;
        const asset = p.assets.find((a) => a.id === clip.assetId);
        const others = sortedClips(track).filter((c) => c.id !== clipId);
        if (edge === 'start') {
          const prevEnd = Math.max(0, ...others.filter((o) => clipEnd(o) <= clipEnd(clip) - 0.01 && o.start < clip.start).map(clipEnd));
          let ns = Math.max(prevEnd, Math.min(newTime, clipEnd(clip) - 0.1));
          const delta = ns - clip.start;
          // klip media: tidak bisa menarik lebih awal dari awal sumber
          if (clip.kind !== 'text' && clip.kind !== 'image' && asset) {
            const maxEarlier = -clip.sourceIn / clip.speed;
            if (delta < maxEarlier) ns = clip.start + maxEarlier;
          }
          const d2 = ns - clip.start;
          clip.start = ns;
          clip.duration -= d2;
          if (clip.kind !== 'text' && clip.kind !== 'image') clip.sourceIn += d2 * clip.speed;
        } else {
          const nextStart = Math.min(Infinity, ...others.filter((o) => o.start >= clip.start + 0.01).map((o) => o.start));
          let ne = Math.min(newTime, nextStart);
          ne = Math.max(ne, clip.start + 0.1);
          // batasi ke sisa durasi sumber
          if (clip.kind === 'video' || clip.kind === 'audio') {
            if (asset && asset.duration > 0) {
              const maxDur = (asset.duration - clip.sourceIn) / clip.speed;
              ne = Math.min(ne, clip.start + maxDur);
            }
          }
          clip.duration = ne - clip.start;
        }
      });
    },

    splitClipAt(clipId, time) {
      let rightId: string | null = null;
      commit((p) => {
        const found = findClip(p, clipId);
        if (!found || found.track.locked) return;
        const { track, clip } = found;
        if (time <= clip.start + 0.05 || time >= clipEnd(clip) - 0.05) return;
        const offset = time - clip.start;
        const right: Clip = structuredClone(clip);
        right.id = uid('clp_');
        right.start = time;
        right.duration = clip.duration - offset;
        if (clip.kind === 'video' || clip.kind === 'audio') {
          right.sourceIn = clip.sourceIn + offset * clip.speed;
        }
        right.transitionOut = clip.transitionOut;
        clip.duration = offset;
        clip.transitionOut = undefined;
        track.clips.push(right);
        rightId = right.id;
      });
      return rightId;
    },

    duplicateClip(clipId) {
      let newId: string | null = null;
      commit((p) => {
        const found = findClip(p, clipId);
        if (!found || found.track.locked) return;
        const { track, clip } = found;
        const copy: Clip = structuredClone(clip);
        copy.id = uid('clp_');
        copy.start = clampToFreeSpace(track, '__new__', clipEnd(clip), copy.duration);
        track.clips.push(copy);
        newId = copy.id;
      });
      return newId;
    },

    pasteClip(clip, at, preferTrackId) {
      let newId: string | null = null;
      commit((p) => {
        const compatible = (t: Track) =>
          !t.locked && (clip.kind === 'audio' ? t.kind === 'audio' : t.kind !== 'audio');
        let track = preferTrackId ? p.tracks.find((t) => t.id === preferTrackId) : undefined;
        if (!track || !compatible(track)) track = p.tracks.find(compatible);
        if (!track) return;
        const copy: Clip = structuredClone(clip);
        copy.id = uid('clp_');
        copy.start = clampToFreeSpace(track, '__new__', Math.max(0, at), copy.duration);
        track.clips.push(copy);
        newId = copy.id;
      });
      return newId;
    },

    trimToPlayhead(clipId, side, time) {
      commit((p) => {
        const found = findClip(p, clipId);
        if (!found || found.track.locked) return;
        const { clip } = found;
        if (time <= clip.start + 0.05 || time >= clipEnd(clip) - 0.05) return;
        if (side === 'left') {
          const delta = time - clip.start;
          if (clip.kind === 'video' || clip.kind === 'audio') clip.sourceIn += delta * clip.speed;
          clip.start = time;
          clip.duration -= delta;
        } else {
          clip.duration = time - clip.start;
          clip.transitionOut = undefined; // ujung kanan baru: transisi lama tak relevan
        }
      });
    },

    deleteClip(clipId) {
      commit((p) => {
        for (const t of p.tracks) {
          if (t.locked) continue;
          t.clips = t.clips.filter((c) => c.id !== clipId);
        }
      });
    },

    updateClip(clipId, patch) {
      commit((p) => applyClipPatch(p, clipId, patch));
    },
    updateClipLive(clipId, patch) {
      live((p) => applyClipPatch(p, clipId, patch));
    },
    updateEffects(clipId, patch) {
      commit((p) => {
        const found = findClip(p, clipId);
        if (found && !found.track.locked) Object.assign(found.clip.effects, patch);
      });
    },
    updateEffectsLive(clipId, patch) {
      live((p) => {
        const found = findClip(p, clipId);
        if (found && !found.track.locked) Object.assign(found.clip.effects, patch);
      });
    },
    updateTransform(clipId, patch) {
      commit((p) => {
        const found = findClip(p, clipId);
        if (found && !found.track.locked) Object.assign(found.clip.transform, patch);
      });
    },
    updateTransformLive(clipId, patch) {
      live((p) => {
        const found = findClip(p, clipId);
        if (found && !found.track.locked) Object.assign(found.clip.transform, patch);
      });
    },
    updateTextStyle(clipId, patch) {
      commit((p) => {
        const found = findClip(p, clipId);
        if (found && !found.track.locked && found.clip.textStyle) Object.assign(found.clip.textStyle, patch);
      });
    },
    setTransition(clipId, tr) {
      commit((p) => {
        const found = findClip(p, clipId);
        if (found && !found.track.locked) found.clip.transitionOut = tr;
      });
    },

    replaceClipWithSegments(clipId, segments) {
      commit((p) => {
        const found = findClip(p, clipId);
        if (!found || found.track.locked || !segments.length) return;
        const { track, clip } = found;
        track.clips = track.clips.filter((c) => c.id !== clipId);
        let at = clip.start;
        for (const seg of segments) {
          const dur = seg.duration / (clip.speed || 1);
          if (dur < 0.05) continue;
          const c: Clip = structuredClone(clip);
          c.id = uid('clp_');
          c.start = at;
          c.sourceIn = seg.sourceIn;
          c.duration = dur;
          c.transitionOut = undefined;
          track.clips.push(c);
          at += dur;
        }
      });
    },

    setSubtitles(cues) {
      commit((p) => { p.subtitles = cues; });
    },
    addSubtitle(cue) {
      commit((p) => { p.subtitles.push({ ...cue, id: uid('sub_') }); });
    },
    updateSubtitle(id, patch) {
      commit((p) => {
        const c = p.subtitles.find((s) => s.id === id);
        if (c) Object.assign(c, patch);
      });
    },
    removeSubtitle(id) {
      commit((p) => { p.subtitles = p.subtitles.filter((s) => s.id !== id); });
    },
    setSubtitleStyle(patch) {
      commit((p) => { Object.assign(p.subtitleStyle, patch); });
    },
    setShowSubtitles(v) {
      commit((p) => { p.showSubtitles = v; });
    },

    // ---------- editing ala Premiere ----------

    rippleDeleteClip(clipId) {
      commit((p) => {
        const found = findClip(p, clipId);
        if (!found || found.track.locked) return;
        const { track, clip } = found;
        const gap = clip.duration;
        const end = clipEnd(clip);
        track.clips = track.clips.filter((c) => c.id !== clipId);
        for (const c of track.clips) if (c.start >= end - 0.0001) c.start = Math.max(0, c.start - gap);
      });
    },

    addEditAllTracks(time) {
      let count = 0;
      commit((p) => {
        for (const track of p.tracks) {
          if (track.locked) continue;
          const clip = track.clips.find((c) => time > c.start + 0.05 && time < clipEnd(c) - 0.05);
          if (!clip) continue;
          splitInPlace(track, clip, time);
          count++;
        }
      });
      return count;
    },

    rippleTrimToPlayhead(clipId, side, time) {
      commit((p) => {
        const found = findClip(p, clipId);
        if (!found || found.track.locked) return;
        const { track, clip } = found;
        if (time <= clip.start + 0.05 || time >= clipEnd(clip) - 0.05) return;
        if (side === 'left') {
          // Buang bagian kiri; klip tetap mulai di posisi lama, sisanya merapat ke kiri.
          const delta = time - clip.start;
          if (clip.kind === 'video' || clip.kind === 'audio') clip.sourceIn += delta * clip.speed;
          clip.duration -= delta;
          for (const c of track.clips) if (c.id !== clip.id && c.start >= clip.start + delta - 0.0001) c.start -= delta;
        } else {
          const removed = clipEnd(clip) - time;
          const oldEnd = clipEnd(clip);
          clip.duration = time - clip.start;
          clip.transitionOut = undefined;
          for (const c of track.clips) if (c.id !== clip.id && c.start >= oldEnd - 0.0001) c.start -= removed;
        }
      });
    },

    slipClipLive(clipId, sourceIn) {
      live((p) => {
        const found = findClip(p, clipId);
        if (!found || found.track.locked) return;
        const { clip } = found;
        if (clip.kind !== 'video' && clip.kind !== 'audio') return;
        const asset = p.assets.find((a) => a.id === clip.assetId);
        const maxIn = asset && asset.duration > 0 ? Math.max(0, asset.duration - clip.duration * clip.speed) : sourceIn;
        clip.sourceIn = Math.min(Math.max(0, sourceIn), maxIn);
      });
    },

    rippleResizeLive(clipId, edge, newTime) {
      live((p) => {
        const found = findClip(p, clipId);
        if (!found || found.track.locked) return;
        const { track, clip } = found;
        const asset = p.assets.find((a) => a.id === clip.assetId);
        const isMedia = clip.kind === 'video' || clip.kind === 'audio';
        const oldEnd = clipEnd(clip);
        let newDur: number;
        if (edge === 'end') {
          newDur = Math.max(0.1, newTime - clip.start);
          if (isMedia && asset && asset.duration > 0) newDur = Math.min(newDur, (asset.duration - clip.sourceIn) / clip.speed);
        } else {
          // Tepi kiri: ubah sourceIn, posisi awal klip tetap (ripple ke kanan)
          const delta = newTime - clip.start; // >0 = memendek
          let d = Math.min(delta, clip.duration - 0.1);
          if (isMedia) d = Math.max(d, -clip.sourceIn / clip.speed);
          else d = Math.max(d, -clip.start);
          if (isMedia) clip.sourceIn += d * clip.speed;
          newDur = clip.duration - d;
        }
        const shift = clip.start + newDur - oldEnd;
        clip.duration = newDur;
        for (const c of track.clips) if (c.id !== clip.id && c.start >= oldEnd - 0.0001) c.start = Math.max(0, c.start + shift);
      });
    },

    editFromSource(assetId, srcIn, srcOut, at, mode, videoTrackId, audioTrackId) {
      let newId: string | null = null;
      commit((p) => {
        const asset = p.assets.find((a) => a.id === assetId);
        if (!asset) return;
        const isImage = asset.type === 'image';
        const dur = isImage ? Math.max(0.1, srcOut - srcIn || 4) : Math.max(0.1, srcOut - srcIn);
        const kind = asset.type === 'video' ? 'video' : asset.type === 'audio' ? 'audio' : 'image';
        const pick = (id: string | undefined, audio: boolean) => {
          const ok = (t: Track) => !t.locked && (audio ? t.kind === 'audio' : t.kind !== 'audio');
          const t = id ? p.tracks.find((x) => x.id === id) : undefined;
          return t && ok(t) ? t : p.tracks.find(ok);
        };
        const target = pick(kind === 'audio' ? audioTrackId : videoTrackId, kind === 'audio');
        if (!target) return;
        const tracks = [target];
        if (mode === 'insert') {
          // Insert menggeser semua track yang tidak terkunci supaya sinkronisasi antar-track terjaga.
          for (const t of p.tracks) {
            if (t.locked) continue;
            const c = t.clips.find((x) => at > x.start + 0.0001 && at < clipEnd(x) - 0.0001);
            if (c) splitInPlace(t, c, at);
            for (const x of t.clips) if (x.start >= at - 0.0001) x.start += dur;
          }
        } else {
          for (const t of tracks) clearRange(t, at, at + dur);
        }
        const clip: Clip = {
          id: uid('clp_'), kind, assetId, start: at, duration: dur, sourceIn: isImage ? 0 : srcIn, speed: 1,
          volume: 1, muted: false, effects: { ...DEFAULT_EFFECTS }, transform: { ...DEFAULT_TRANSFORM },
        };
        target.clips.push(clip);
        newId = clip.id;
      });
      return newId;
    },

    liftOrExtract(mode) {
      const { inPoint, outPoint } = get().project;
      if (inPoint === undefined || outPoint === undefined || outPoint - inPoint < 0.02) return false;
      commit((p) => {
        const a = inPoint, b = outPoint;
        for (const t of p.tracks) {
          if (t.locked) continue;
          clearRange(t, a, b);
          if (mode === 'extract') for (const c of t.clips) if (c.start >= b - 0.0001) c.start -= b - a;
        }
        if (mode === 'extract') {
          p.markers = (p.markers ?? []).filter((m) => m.time < a || m.time >= b).map((m) => (m.time >= b ? { ...m, time: m.time - (b - a) } : m));
          p.outPoint = undefined;
        }
      });
      return true;
    },

    setClipsDisabled(ids, disabled) {
      commit((p) => {
        for (const t of p.tracks) {
          if (t.locked) continue;
          for (const c of t.clips) if (ids.includes(c.id)) c.disabled = disabled || undefined;
        }
      });
    },

    toggleTrackSolo(trackId) {
      commit((p) => {
        const t = p.tracks.find((x) => x.id === trackId);
        if (t) t.solo = !t.solo || undefined;
      });
    },

    renameTrack(trackId, name) {
      commit((p) => {
        const t = p.tracks.find((x) => x.id === trackId);
        if (t && name.trim()) t.name = name.trim().slice(0, 24);
      });
    },

    addMarker(time, name) {
      const id = uid('mrk_');
      commit((p) => {
        p.markers ??= [];
        const existing = p.markers.find((m) => Math.abs(m.time - time) < 1 / (2 * p.fps));
        if (existing) return; // satu penanda per frame
        p.markers.push({ id, time: Math.max(0, time), name: name ?? `Penanda ${p.markers.length + 1}`, color: MARKER_COLORS[0] });
        p.markers.sort((x, y) => x.time - y.time);
      });
      return id;
    },
    updateMarker(id, patch) {
      commit((p) => {
        const m = (p.markers ?? []).find((x) => x.id === id);
        if (m) Object.assign(m, patch);
        p.markers?.sort((x, y) => x.time - y.time);
      });
    },
    removeMarker(id) {
      commit((p) => { p.markers = (p.markers ?? []).filter((m) => m.id !== id); });
    },

    setInOut(patch) {
      commit((p) => {
        if ('inPoint' in patch) p.inPoint = patch.inPoint ?? undefined;
        if ('outPoint' in patch) p.outPoint = patch.outPoint ?? undefined;
        // In tidak boleh melewati Out: titik yang bertabrakan dibuang, seperti Premiere.
        if (p.inPoint !== undefined && p.outPoint !== undefined && p.outPoint <= p.inPoint) {
          if ('inPoint' in patch) p.outPoint = undefined; else p.inPoint = undefined;
        }
      });
    },
  };
});

/** Belah klip di `time` (tanpa history; dipakai di dalam commit). */
function splitInPlace(track: Track, clip: Clip, time: number) {
  const offset = time - clip.start;
  const right: Clip = structuredClone(clip);
  right.id = uid('clp_');
  right.start = time;
  right.duration = clip.duration - offset;
  if (clip.kind === 'video' || clip.kind === 'audio') right.sourceIn = clip.sourceIn + offset * clip.speed;
  right.transitionOut = clip.transitionOut;
  clip.duration = offset;
  clip.transitionOut = undefined;
  track.clips.push(right);
}

/** Kosongkan rentang [a, b) di track: klip yang terpotong dipangkas atau dibelah. */
function clearRange(track: Track, a: number, b: number) {
  const out: Clip[] = [];
  for (const c of track.clips) {
    const s = c.start, e = clipEnd(c);
    if (e <= a + 0.0001 || s >= b - 0.0001) { out.push(c); continue; }
    const media = c.kind === 'video' || c.kind === 'audio';
    if (s < a - 0.0001) {
      const left: Clip = { ...structuredClone(c), duration: a - s, transitionOut: undefined };
      out.push(left);
    }
    if (e > b + 0.0001) {
      const right: Clip = structuredClone(c);
      right.id = s < a - 0.0001 ? uid('clp_') : c.id;
      right.start = b;
      right.duration = e - b;
      if (media) right.sourceIn = c.sourceIn + (b - s) * c.speed;
      out.push(right);
    }
  }
  track.clips = out;
}

/**
 * Terapkan patch klip dengan penjagaan invarian:
 * - track terkunci diabaikan;
 * - perubahan speed/sourceIn/duration pada klip media di-clamp agar
 *   duration <= sisa sumber ((asset.duration - sourceIn) / speed).
 */
function applyClipPatch(p: Project, clipId: string, patch: Partial<Clip>) {
  const found = findClip(p, clipId);
  if (!found || found.track.locked) return;
  const { clip } = found;
  Object.assign(clip, patch);
  if (
    (clip.kind === 'video' || clip.kind === 'audio') &&
    ('speed' in patch || 'sourceIn' in patch || 'duration' in patch)
  ) {
    const asset = p.assets.find((a) => a.id === clip.assetId);
    if (asset && asset.duration > 0) {
      clip.speed = Math.max(0.05, clip.speed || 1);
      clip.sourceIn = Math.min(Math.max(0, clip.sourceIn), Math.max(0, asset.duration - 0.1));
      const maxDur = (asset.duration - clip.sourceIn) / clip.speed;
      clip.duration = Math.max(0.1, Math.min(clip.duration, maxDur));
    }
  }
}

function doMove(p: Project, clipId: string, trackId: string, newStart: number) {
  const found = findClip(p, clipId);
  const target = p.tracks.find((t) => t.id === trackId);
  if (!found || !target || found.track.locked || target.locked) return;
  const { track, clip } = found;
  // validasi jenis track
  if (target.kind === 'audio' && clip.kind !== 'audio') return;
  if (target.kind !== 'audio' && clip.kind === 'audio') return;
  if (track.id !== target.id) {
    track.clips = track.clips.filter((c) => c.id !== clipId);
    target.clips.push(clip);
  }
  clip.start = clampToFreeSpace(target, clipId, newStart, clip.duration);
}
