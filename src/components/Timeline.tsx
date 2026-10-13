// ============================================================
// Timeline.tsx - timeline sequence ala Premiere.
//
// - Track visual (V1, V2, ...) di atas, track audio (A1, A2, ...) di bawah,
//   dengan header: target, mata/bisu, solo (audio), kunci, nama (klik dua kali = ubah).
// - Ruler timecode (klik/seret = pindah playhead), rentang In/Out, penanda.
// - Alat: Seleksi (pindah & trim), Razor (potong di titik klik),
//   Ripple (trim yang menggeser klip berikutnya), Slip (geser isi sumber),
//   Tangan (geser tampilan), Zoom (klik = perbesar, Alt+klik = perkecil).
// - Aksi *Live saat menyeret, pushHistory() SEKALI di awal gesture.
// - Snap ke 0, playhead, tepi klip, In/Out, dan penanda (ambang 8 px).
// - Waveform klip audio digambar dari data audio yang didekode sekali per aset.
// ============================================================
import { useEffect, useRef, useState } from 'react';
import type { ReactElement, PointerEvent as RPointerEvent, DragEvent as RDragEvent, MouseEvent as RMouseEvent } from 'react';
import { useProject } from '../store/projectStore';
import { useUi, type Tool } from '../store/uiStore';
import { projectDuration, sortedClips, clipEnd, ADJACENT_EPS, toTimecode } from '../types';
import type { Clip, MediaAsset, Project, Track } from '../types';
import { loadPeaks } from '../engine/waveform';
import Icon from './Icon';

const HEAD_W = 170; // lebar header track (sticky kiri) - sinkron dengan styles.css
const ASSET_MIME = 'application/x-dcut-asset';
const SNAP_PX = 8;

const TOOL_CURSOR: Record<Tool, string> = {
  select: 'default', razor: 'crosshair', ripple: 'ew-resize', slip: 'ew-resize', hand: 'grab', zoom: 'zoom-in',
};

/** Pilih interval tick agar label tidak bertumpuk (min ~80 px per label). */
function pickInterval(pxPerSec: number, fps: number): number {
  const frame = 1 / fps;
  for (const o of [frame, frame * 5, 0.5, 1, 2, 5, 10, 30, 60, 120, 300]) if (o * pxPerSec >= 80) return o;
  return 600;
}

function collectSnapPoints(p: Project, excludeClipId: string, playhead: number): number[] {
  const pts: number[] = [0, playhead];
  if (p.inPoint !== undefined) pts.push(p.inPoint);
  if (p.outPoint !== undefined) pts.push(p.outPoint);
  for (const m of p.markers ?? []) pts.push(m.time);
  for (const t of p.tracks) for (const c of t.clips) {
    if (c.id === excludeClipId) continue;
    pts.push(c.start, clipEnd(c));
  }
  return pts;
}

function snapValue(v: number, pts: number[], threshold: number): number {
  let best = v, bestD = threshold;
  for (const pt of pts) { const d = Math.abs(pt - v); if (d < bestD) { bestD = d; best = pt; } }
  return best;
}

function snapMove(start: number, duration: number, pts: number[], threshold: number): number {
  let bestDelta = Infinity;
  for (const pt of pts) {
    const dS = pt - start; if (Math.abs(dS) < Math.abs(bestDelta)) bestDelta = dS;
    const dE = pt - (start + duration); if (Math.abs(dE) < Math.abs(bestDelta)) bestDelta = dE;
  }
  return Math.abs(bestDelta) <= threshold ? start + bestDelta : start;
}

function findClipIn(p: Project, clipId: string): { track: Track; clip: Clip } | null {
  for (const track of p.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return { track, clip };
  }
  return null;
}

function clipLabel(clip: Clip, p: Project): string {
  if (clip.kind === 'text') return clip.text || 'Teks';
  const asset = p.assets.find((a) => a.id === clip.assetId);
  if (asset) return asset.name;
  return clip.kind === 'audio' ? 'Audio' : clip.kind === 'image' ? 'Gambar' : 'Video';
}

function hasEffects(c: Clip): boolean {
  const e = c.effects;
  return !!e && (e.brightness !== 0 || e.contrast !== 1 || e.saturation !== 1 || e.temperature !== 0 || e.hue !== 0 || e.blur > 0 || e.vignette > 0);
}

interface DragState {
  mode: 'move' | 'trim-start' | 'trim-end' | 'ripple-start' | 'ripple-end' | 'slip';
  clipId: string;
  grabOffset: number;
  pushed: boolean;
  startX: number;
  startY: number;
  startSourceIn: number;
}

// ---------- waveform ----------

function Waveform({ asset, clip, width, color }: { asset: MediaAsset; clip: Clip; width: number; color: string }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  useEffect(() => {
    let alive = true;
    void loadPeaks(asset.url).then((p) => { if (alive) setPeaks(p); });
    return () => { alive = false; };
  }, [asset.url]);
  useEffect(() => {
    const cv = ref.current;
    if (!cv || !peaks || asset.duration <= 0) return;
    const w = Math.max(1, Math.min(4000, Math.round(width)));
    const h = 32;
    cv.width = w; cv.height = h;
    const g = cv.getContext('2d');
    if (!g) return;
    g.clearRect(0, 0, w, h);
    g.fillStyle = color;
    const perSec = peaks.length / asset.duration;
    for (let x = 0; x < w; x++) {
      const tSrc = clip.sourceIn + (x / w) * clip.duration * clip.speed;
      const tEnd = clip.sourceIn + ((x + 1) / w) * clip.duration * clip.speed;
      let pk = 0;
      for (let i = Math.floor(tSrc * perSec); i < Math.ceil(tEnd * perSec) && i < peaks.length; i++) if (peaks[i] > pk) pk = peaks[i];
      const bh = Math.max(1, pk * h * clip.volume);
      g.fillRect(x, (h - bh) / 2, 1, bh);
    }
  }, [peaks, width, clip.sourceIn, clip.duration, clip.speed, clip.volume, asset.duration, color]);
  return <canvas ref={ref} className="wave" />;
}

// ---------- header track ----------

function TrackHead({ track, isTarget, onTarget }: { track: Track; isTarget: boolean; onTarget(): void }) {
  const toggleTrackMuted = useProject((s) => s.toggleTrackMuted);
  const toggleTrackLocked = useProject((s) => s.toggleTrackLocked);
  const toggleTrackSolo = useProject((s) => s.toggleTrackSolo);
  const removeTrack = useProject((s) => s.removeTrack);
  const renameTrack = useProject((s) => s.renameTrack);
  const [editing, setEditing] = useState(false);
  const audio = track.kind === 'audio';

  return (
    <div className="tl-track-head">
      <button className={`icon-btn ${track.locked ? 'on' : ''}`} title={track.locked ? 'Buka kunci track' : 'Kunci track'}
        aria-label={track.locked ? `Buka kunci ${track.name}` : `Kunci ${track.name}`} aria-pressed={track.locked} onClick={() => toggleTrackLocked(track.id)}>
        <Icon name={track.locked ? 'lock' : 'unlock'} size={13} />
      </button>
      {editing ? (
        <span className="tname">
          <input
            autoFocus
            defaultValue={track.name}
            aria-label="Nama track"
            onBlur={(e) => { renameTrack(track.id, e.target.value); setEditing(false); }}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') setEditing(false); }}
          />
        </span>
      ) : (
        <span
          className={`tname ${isTarget ? 'target' : ''}`}
          title="Klik: jadikan track sasaran. Klik dua kali: ubah nama."
          onClick={onTarget}
          onDoubleClick={() => setEditing(true)}
        >
          {track.name}
        </span>
      )}
      {audio ? (
        <>
          <button className={`icon-btn warn ${track.muted ? 'on' : ''}`} title={track.muted ? 'Bunyikan track' : 'Bisukan track'}
            aria-label={`Bisu ${track.name}`} aria-pressed={track.muted} onClick={() => toggleTrackMuted(track.id)}
            style={{ fontWeight: 700, fontSize: 11 }}>M</button>
          <button className={`icon-btn ${track.solo ? 'on' : ''}`} title={track.solo ? 'Matikan solo' : 'Solo: hanya track ini yang berbunyi'}
            aria-label={`Solo ${track.name}`} aria-pressed={!!track.solo} onClick={() => toggleTrackSolo(track.id)}
            style={{ fontWeight: 700, fontSize: 11 }}>S</button>
        </>
      ) : (
        <button className={`icon-btn ${track.muted ? 'on' : ''}`} title={track.muted ? 'Tampilkan track' : 'Sembunyikan track (keluaran)'}
          aria-label={track.muted ? `Tampilkan ${track.name}` : `Sembunyikan ${track.name}`} aria-pressed={track.muted} onClick={() => toggleTrackMuted(track.id)}>
          <Icon name={track.muted ? 'eyeOff' : 'eye'} size={13} />
        </button>
      )}
      <button className="icon-btn" title="Hapus track" aria-label={`Hapus ${track.name}`}
        onClick={() => { if (!track.clips.length || window.confirm(`Hapus ${track.name} beserta ${track.clips.length} klipnya?`)) removeTrack(track.id); }}>
        <Icon name="trash" size={12} />
      </button>
    </div>
  );
}

// ---------- komponen utama ----------

export default function Timeline() {
  const project = useProject((s) => s.project);
  const pushHistory = useProject((s) => s.pushHistory);
  const addTrack = useProject((s) => s.addTrack);
  const addClipFromAsset = useProject((s) => s.addClipFromAsset);
  const splitClipAt = useProject((s) => s.splitClipAt);
  const updateMarker = useProject((s) => s.updateMarker);
  const removeMarker = useProject((s) => s.removeMarker);

  const currentTime = useUi((s) => s.currentTime);
  const setCurrentTime = useUi((s) => s.setCurrentTime);
  const pxPerSec = useUi((s) => s.pxPerSec);
  const setPxPerSec = useUi((s) => s.setPxPerSec);
  const snapping = useUi((s) => s.snapping);
  const toggleSnapping = useUi((s) => s.toggleSnapping);
  const selectedClipId = useUi((s) => s.selectedClipId);
  const selectClip = useUi((s) => s.selectClip);
  const showToast = useUi((s) => s.showToast);
  const tool = useUi((s) => s.tool);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const laneRefs = useRef(new Map<string, HTMLDivElement>());
  const dragRef = useRef<DragState | null>(null);
  const [dragOverTrack, setDragOverTrack] = useState<string | null>(null);
  const [viewLeft, setViewLeft] = useState(0);
  const [viewW, setViewW] = useState(1800);
  const [razorX, setRazorX] = useState<number | null>(null);
  const [targets, setTargets] = useState<{ v?: string; a?: string }>({});

  const fps = project.fps || 30;

  useEffect(() => {
    const sc = scrollRef.current;
    if (!sc) return;
    const update = () => setViewW(sc.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(sc);
    return () => ro.disconnect();
  }, []);

  // Alt+scroll (Premiere) atau Ctrl+scroll = zoom dengan anchor di kursor.
  useEffect(() => {
    const sc = scrollRef.current;
    if (!sc) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.altKey) return;
      e.preventDefault();
      zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX);
    };
    sc.addEventListener('wheel', onWheel, { passive: false });
    return () => sc.removeEventListener('wheel', onWheel);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // "\" = muatkan seluruh sequence ke lebar timeline.
  useEffect(() => {
    const onFit = () => {
      const sc = scrollRef.current;
      if (!sc) return;
      const dur = projectDuration(useProject.getState().project);
      useUi.getState().setPxPerSec((sc.clientWidth - HEAD_W - 40) / dur);
      sc.scrollLeft = 0;
    };
    window.addEventListener('dcut:zoom-fit', onFit);
    return () => window.removeEventListener('dcut:zoom-fit', onFit);
  }, []);

  // Ikuti playhead saat diputar: halaman bergeser bila playhead keluar dari layar.
  useEffect(() => {
    const sc = scrollRef.current;
    if (!sc) return;
    const x = HEAD_W + currentTime * pxPerSec;
    if (x < sc.scrollLeft + HEAD_W || x > sc.scrollLeft + sc.clientWidth - 20) {
      if (useUi.getState().playing) sc.scrollLeft = Math.max(0, x - HEAD_W - 20);
    }
  }, [currentTime, pxPerSec]);

  const zoomAt = (factor: number, clientX: number) => {
    const sc = scrollRef.current;
    if (!sc) return;
    const ui = useUi.getState();
    const oldPx = ui.pxPerSec;
    ui.setPxPerSec(oldPx * factor);
    const newPx = useUi.getState().pxPerSec;
    if (newPx === oldPx) return;
    const rect = sc.getBoundingClientRect();
    const xInView = clientX - rect.left;
    const tAtCursor = (xInView + sc.scrollLeft - HEAD_W) / oldPx;
    sc.scrollLeft = Math.max(0, tAtCursor * newPx + HEAD_W - xInView);
  };

  const durTotal = Math.max(projectDuration(project) + 10, 30);
  const innerW = HEAD_W + durTotal * pxPerSec + 200;

  const timeAtClientX = (clientX: number): number => {
    const sc = scrollRef.current;
    if (!sc) return 0;
    const rect = sc.getBoundingClientRect();
    return (clientX - rect.left + sc.scrollLeft - HEAD_W) / useUi.getState().pxPerSec;
  };

  /** Bulatkan ke frame terdekat, seperti Premiere. */
  const toFrame = (t: number) => Math.round(Math.max(0, t) * fps) / fps;

  // ---- ruler: klik/seret = pindah playhead ----
  const onRulerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    useUi.getState().pause();
    useUi.getState().setFocusedMonitor('program');
    setCurrentTime(toFrame(timeAtClientX(e.clientX)));
  };
  const onRulerMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    let t = toFrame(timeAtClientX(e.clientX));
    if (useUi.getState().snapping && e.shiftKey) t = snapValue(t, collectSnapPoints(project, '', -1), SNAP_PX / pxPerSec);
    setCurrentTime(t);
  };
  const onRulerUp = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  // ---- gesture klip ----
  const detachDragListeners = useRef<(() => void) | null>(null);
  const endDrag = () => {
    dragRef.current = null;
    detachDragListeners.current?.();
    detachDragListeners.current = null;
  };

  const onWindowDragMove = (e: PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    if ((e.buttons & 1) === 0) { endDrag(); return; }
    if (!d.pushed) {
      if (Math.abs(e.clientX - d.startX) < 3 && Math.abs(e.clientY - d.startY) < 3) return;
      pushHistory();
      d.pushed = true;
    }
    const st = useProject.getState();
    const ui = useUi.getState();
    const found = findClipIn(st.project, d.clipId);
    if (!found) return;
    const threshold = SNAP_PX / ui.pxPerSec;
    const pts = () => collectSnapPoints(st.project, d.clipId, ui.currentTime);

    if (d.mode === 'move') {
      let newStart = timeAtClientX(e.clientX) - d.grabOffset;
      let targetTrackId = found.track.id;
      for (const [tid, el] of laneRefs.current) {
        const r = el.getBoundingClientRect();
        if (e.clientY >= r.top && e.clientY <= r.bottom) { targetTrackId = tid; break; }
      }
      if (ui.snapping) newStart = snapMove(newStart, found.clip.duration, pts(), threshold);
      st.moveClipLive(d.clipId, targetTrackId, toFrame(newStart));
    } else if (d.mode === 'slip') {
      const dx = (e.clientX - d.startX) / ui.pxPerSec;
      st.slipClipLive(d.clipId, d.startSourceIn - dx * found.clip.speed);
    } else {
      let t = timeAtClientX(e.clientX);
      if (ui.snapping) t = snapValue(t, pts(), threshold);
      t = toFrame(t);
      if (d.mode === 'ripple-start' || d.mode === 'ripple-end') st.rippleResizeLive(d.clipId, d.mode === 'ripple-start' ? 'start' : 'end', t);
      else st.resizeClipLive(d.clipId, d.mode === 'trim-start' ? 'start' : 'end', t);
    }
  };

  const startGesture = (e: RPointerEvent<HTMLDivElement>, clip: Clip, mode: DragState['mode']) => {
    dragRef.current = {
      mode, clipId: clip.id, grabOffset: timeAtClientX(e.clientX) - clip.start,
      pushed: false, startX: e.clientX, startY: e.clientY, startSourceIn: clip.sourceIn,
    };
    window.addEventListener('pointermove', onWindowDragMove);
    window.addEventListener('pointerup', endDrag);
    window.addEventListener('pointercancel', endDrag);
    detachDragListeners.current = () => {
      window.removeEventListener('pointermove', onWindowDragMove);
      window.removeEventListener('pointerup', endDrag);
      window.removeEventListener('pointercancel', endDrag);
    };
  };

  const onClipDown = (e: RPointerEvent<HTMLDivElement>, track: Track, clip: Clip, edge?: 'start' | 'end') => {
    if (e.button !== 0) return;
    const curTool = useUi.getState().tool;
    if (curTool === 'hand' || curTool === 'zoom') return; // ditangani oleh area scroll
    e.stopPropagation();
    e.preventDefault();
    selectClip(clip.id);
    useUi.getState().setFocusedMonitor('program');
    if (track.locked) return;
    endDrag();

    if (curTool === 'razor') {
      let t = toFrame(timeAtClientX(e.clientX));
      if (useUi.getState().snapping) t = snapValue(t, collectSnapPoints(project, clip.id, currentTime), SNAP_PX / pxPerSec);
      // Shift + razor = potong semua track di titik itu (Premiere).
      if (e.shiftKey) useProject.getState().addEditAllTracks(t);
      else splitClipAt(clip.id, t);
      return;
    }
    if (curTool === 'slip') {
      if (clip.kind === 'video' || clip.kind === 'audio') startGesture(e, clip, 'slip');
      return;
    }
    if (curTool === 'ripple') {
      // Alat ripple: tepi terdekat menentukan sisi trim.
      const r = e.currentTarget.getBoundingClientRect();
      const side = edge ?? (e.clientX - r.left < r.width / 2 ? 'start' : 'end');
      startGesture(e, clip, side === 'start' ? 'ripple-start' : 'ripple-end');
      return;
    }
    // Seleksi: Ctrl+seret tepi = ripple trim (Premiere).
    if (edge) startGesture(e, clip, e.ctrlKey ? (edge === 'start' ? 'ripple-start' : 'ripple-end') : (edge === 'start' ? 'trim-start' : 'trim-end'));
    else startGesture(e, clip, 'move');
  };

  useEffect(() => () => { detachDragListeners.current?.(); }, []);

  // ---- alat Tangan & Zoom di area scroll ----
  const onScrollDown = (e: RPointerEvent<HTMLDivElement>) => {
    const curTool = useUi.getState().tool;
    const sc = scrollRef.current;
    if (!sc || (e.button !== 0 && e.button !== 1)) return;
    if (curTool === 'zoom' && e.button === 0) {
      e.preventDefault();
      zoomAt(e.altKey ? 1 / 1.6 : 1.6, e.clientX);
      return;
    }
    if (curTool === 'hand' || e.button === 1) {
      e.preventDefault();
      const x0 = e.clientX, y0 = e.clientY, sl = sc.scrollLeft, stp = sc.scrollTop;
      sc.style.cursor = 'grabbing';
      const mv = (ev: PointerEvent) => { sc.scrollLeft = sl - (ev.clientX - x0); sc.scrollTop = stp - (ev.clientY - y0); };
      const up = () => { sc.style.cursor = ''; window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
      window.addEventListener('pointermove', mv);
      window.addEventListener('pointerup', up);
    }
  };

  const onScrollMove = (e: RMouseEvent<HTMLDivElement>) => {
    if (useUi.getState().tool !== 'razor') { if (razorX !== null) setRazorX(null); return; }
    const sc = scrollRef.current;
    if (!sc) return;
    const r = sc.getBoundingClientRect();
    setRazorX(e.clientX - r.left + sc.scrollLeft);
  };

  // ---- drop media dari panel Proyek ----
  const onLaneDragOver = (e: RDragEvent<HTMLDivElement>, track: Track) => {
    if (!e.dataTransfer.types.includes(ASSET_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (dragOverTrack !== track.id) setDragOverTrack(track.id);
  };
  const onLaneDragLeave = (e: RDragEvent<HTMLDivElement>, track: Track) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setDragOverTrack((cur) => (cur === track.id ? null : cur));
  };
  const onLaneDrop = (e: RDragEvent<HTMLDivElement>, track: Track) => {
    setDragOverTrack(null);
    const assetId = e.dataTransfer.getData(ASSET_MIME);
    if (!assetId) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    let at = toFrame((e.clientX - rect.left) / pxPerSec);
    if (snapping) at = snapValue(at, collectSnapPoints(project, '', currentTime), SNAP_PX / pxPerSec);
    const newId = addClipFromAsset(track.id, assetId, at);
    if (newId) selectClip(newId);
    else showToast('Tidak bisa ditaruh di sini: jenis media tidak cocok dengan track, atau track terkunci.');
  };

  const onScroll = () => {
    const sc = scrollRef.current;
    if (sc) setViewLeft(Math.floor(sc.scrollLeft / 300) * 300);
  };

  // ---- penanda: klik = lompat, klik dua kali = ubah nama, klik kanan = hapus ----
  const onMarkerClick = (time: number) => setCurrentTime(time);
  const onMarkerDouble = (id: string, name: string) => {
    const v = window.prompt('Nama penanda:', name);
    if (v !== null) updateMarker(id, { name: v.trim() || name });
  };

  // ---- tick ruler (hanya yang terlihat) ----
  const interval = pickInterval(pxPerSec, fps);
  const minor = interval / 5;
  const tStart = Math.max(0, (viewLeft - HEAD_W - 300) / pxPerSec);
  const tEnd = Math.min((viewLeft + viewW + 600 - HEAD_W) / pxPerSec, (innerW - HEAD_W) / pxPerSec);
  const ticks: ReactElement[] = [];
  for (let i = Math.floor(tStart / minor); i <= Math.ceil(tEnd / minor); i++) {
    const t = i * minor;
    if (t < 0 || t > tEnd) continue;
    const major = i % 5 === 0;
    ticks.push(
      <div key={i} className="tl-ruler-tick"
        style={major ? { left: HEAD_W + t * pxPerSec } : { left: HEAD_W + t * pxPerSec, top: 'auto', bottom: 0, height: 6, padding: 0 }}>
        {major ? toTimecode(t, fps) : ''}
      </div>,
    );
  }

  const visual = project.tracks.filter((t) => t.kind !== 'audio');
  const audio = project.tracks.filter((t) => t.kind === 'audio');
  // Premiere: track video tertinggi di atas. Tampilkan visual terbalik (V1 paling bawah).
  const visualShown = [...visual].reverse();
  const targetV = targets.v && visual.some((t) => t.id === targets.v) ? targets.v : visual[0]?.id;
  const targetA = targets.a && audio.some((t) => t.id === targets.a) ? targets.a : audio[0]?.id;

  const renderTrack = (track: Track, idx: number) => {
    const sorted = sortedClips(track);
    const isAudio = track.kind === 'audio';
    const laneH = isAudio ? 46 : 52;
    return (
      <div className="tl-track-row" key={track.id}>
        <TrackHead
          track={track}
          isTarget={track.id === (isAudio ? targetA : targetV)}
          onTarget={() => setTargets((s) => (isAudio ? { ...s, a: track.id } : { ...s, v: track.id }))}
        />
        <div
          className={`tl-track-lane ${idx % 2 ? 'alt' : ''} ${dragOverTrack === track.id ? 'drag-over' : ''}`}
          data-track-id={track.id}
          style={{ height: laneH, opacity: track.muted ? 0.5 : 1 }}
          ref={(el) => { if (el) laneRefs.current.set(track.id, el); else laneRefs.current.delete(track.id); }}
          onPointerDown={(e) => { if (e.target === e.currentTarget && useUi.getState().tool === 'select') selectClip(null); }}
          onDragOver={(e) => onLaneDragOver(e, track)}
          onDragLeave={(e) => onLaneDragLeave(e, track)}
          onDrop={(e) => onLaneDrop(e, track)}
        >
          {sorted.map((clip) => {
            const label = clipLabel(clip, project);
            const clipW = Math.max(3, clip.duration * pxPerSec);
            const showHandles = clipW > 24 && tool === 'select';
            const asset = clip.assetId ? project.assets.find((a) => a.id === clip.assetId) : undefined;
            const speedTag = Math.abs(clip.speed - 1) > 0.001 ? ` [${Math.round(clip.speed * 100)}%]` : '';
            return (
              <div
                key={clip.id}
                className={`tl-clip kind-${clip.kind} ${selectedClipId === clip.id ? 'selected' : ''} ${clip.disabled ? 'disabled' : ''}`}
                style={{
                  left: clip.start * pxPerSec,
                  width: clipW,
                  cursor: track.locked ? 'not-allowed' : tool === 'select' ? 'grab' : TOOL_CURSOR[tool],
                  ...(clip.label ? { background: clip.label } : {}),
                }}
                title={`${label}${speedTag}\n${toTimecode(clip.start, fps)} - ${toTimecode(clipEnd(clip), fps)} (${toTimecode(clip.duration, fps)})${clip.disabled ? '\nNonaktif (Shift+E)' : ''}`}
                onPointerDown={(e) => onClipDown(e, track, clip)}
              >
                {isAudio && asset && clipW > 30 && (
                  <Waveform asset={asset} clip={clip} width={clipW} color="rgba(255,255,255,.55)" />
                )}
                {showHandles && <div className="trim-handle left" onPointerDown={(e) => onClipDown(e, track, clip, 'start')} />}
                <span className="clip-name">{label}{speedTag}</span>
                {hasEffects(clip) && <span className="fx-badge" title="Klip memakai efek warna">fx</span>}
                {showHandles && <div className="trim-handle right" onPointerDown={(e) => onClipDown(e, track, clip, 'end')} />}
              </div>
            );
          })}
          {sorted.map((clip, i) => {
            if (!clip.transitionOut || clip.transitionOut.type === 'none') return null;
            const next = sorted[i + 1];
            if (!next || Math.abs(next.start - clipEnd(clip)) >= ADJACENT_EPS) return null;
            return (
              <div key={`tr-${clip.id}`} className="tl-transition-badge"
                style={{ left: clipEnd(clip) * pxPerSec, width: Math.max(10, clip.transitionOut.duration * pxPerSec) }}
                title={`Transisi: ${clip.transitionOut.type}, ${clip.transitionOut.duration.toFixed(2)} dtk`} />
            );
          })}
        </div>
      </div>
    );
  };

  const inX = project.inPoint, outX = project.outPoint;

  return (
    <div className="tl-wrap" onPointerDown={() => useUi.getState().setFocusedMonitor('program')}>
      <div className="tl-head">
        <span style={{ fontWeight: 600 }}>{project.name}</span>
        <span className="hint">· {project.width}×{project.height}, {fps} fps</span>
        <span style={{ flex: 1 }} />
        <button className={`icon-btn ${snapping ? 'on' : ''}`} onClick={toggleSnapping} aria-pressed={snapping}
          title={snapping ? 'Snap aktif (S)' : 'Snap mati (S)'} aria-label="Snap"><Icon name="magnet" size={14} /></button>
        <button className="btn btn-sm" onClick={() => addTrack('overlay')} title="Tambah track video"><Icon name="plus" size={12} /> Video</button>
        <button className="btn btn-sm" onClick={() => addTrack('audio')} title="Tambah track audio"><Icon name="plus" size={12} /> Audio</button>
        <span style={{ color: 'var(--muted)' }}><Icon name="zoom" size={14} /></span>
        <input type="range" className="slider" min={4} max={600} step={1} value={pxPerSec}
          onChange={(e) => setPxPerSec(Number(e.target.value))} style={{ width: 120 }} aria-label="Zoom timeline" />
        <span className="tl-zoom-label" title="Posisi playhead">{toTimecode(currentTime, fps)}</span>
      </div>

      <div
        className="tl-scroll"
        ref={scrollRef}
        onScroll={onScroll}
        onPointerDown={onScrollDown}
        onMouseMove={onScrollMove}
        onMouseLeave={() => setRazorX(null)}
        style={{ cursor: tool === 'hand' ? 'grab' : tool === 'zoom' ? 'zoom-in' : undefined }}
      >
        <div className="tl-inner" style={{ width: innerW }}>
          <div className="tl-ruler" onPointerDown={onRulerDown} onPointerMove={onRulerMove} onPointerUp={onRulerUp} onPointerCancel={onRulerUp}
            title="Klik atau seret untuk memindah playhead (tahan Shift untuk snap)">
            {ticks}
            {(inX !== undefined || outX !== undefined) && (
              <div className="tl-inout" style={{
                left: HEAD_W + (inX ?? 0) * pxPerSec,
                width: Math.max(2, ((outX ?? projectDuration(project)) - (inX ?? 0)) * pxPerSec),
              }} />
            )}
            {(project.markers ?? []).map((m) => (
              <div key={m.id} className="tl-marker" style={{ left: HEAD_W + m.time * pxPerSec, background: m.color }}
                title={`${m.name} · ${toTimecode(m.time, fps)}\nKlik: lompat. Klik dua kali: ubah nama. Klik kanan: hapus.`}
                onPointerDown={(e) => { e.stopPropagation(); onMarkerClick(m.time); }}
                onDoubleClick={(e) => { e.stopPropagation(); onMarkerDouble(m.id, m.name); }}
                onContextMenu={(e) => { e.preventDefault(); removeMarker(m.id); }} />
            ))}
            <div style={{ position: 'sticky', left: 0, width: HEAD_W, height: '100%', background: '#262626', borderRight: '1px solid #141414', zIndex: 1 }} />
          </div>

          {visualShown.map((t, i) => renderTrack(t, i))}
          <div className="tl-sep" />
          {audio.map((t, i) => renderTrack(t, i))}

          {tool === 'razor' && razorX !== null && razorX > HEAD_W && <div className="tl-ghost-razor" style={{ left: razorX }} />}
          <div className="tl-playhead" style={{ left: HEAD_W + currentTime * pxPerSec }} />
        </div>
      </div>
    </div>
  );
}
