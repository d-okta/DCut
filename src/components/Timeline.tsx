// ============================================================
// Timeline.tsx - timeline multi-track NusaCut Studio.
//
// - Toolbar: split, hapus klip, tambah track, snapping, zoom, waktu.
// - Ruler adaptif (klik/drag = seek), header track sticky kiri.
// - Drag pindah klip antar track + trim kiri/kanan (aksi *Live,
//   pushHistory() SEKALI di awal gesture).
// - Snapping ke 0, playhead, dan tepi klip lain (ambang 8px).
// - Drop asset dari MediaPanel (application/x-nusacut-asset).
// ============================================================
import { useEffect, useRef, useState } from 'react';
import type {
  ReactElement,
  PointerEvent as RPointerEvent,
  DragEvent as RDragEvent,
  ChangeEvent,
} from 'react';
import { useProject } from '../store/projectStore';
import { useUi } from '../store/uiStore';
import { projectDuration, sortedClips, clipEnd, ADJACENT_EPS } from '../types';
import type { Clip, Project, Track } from '../types';

const HEAD_W = 150; // lebar header track (sticky kiri) - sinkron dengan styles.css
const ASSET_MIME = 'application/x-nusacut-asset';
const SNAP_PX = 8;  // ambang snap dalam piksel

// ---------- util format waktu ----------

/** Format mm:ss.d (persepuluh detik) untuk tampilan playhead. */
function fmtTime(t: number): string {
  // kuantisasi dulu ke persepuluh detik agar pembulatan tidak menghasilkan "00:60.0"
  const d = Math.round(Math.max(0, t) * 10);
  const m = Math.floor(d / 600);
  const s = (d % 600) / 10;
  return `${String(m).padStart(2, '0')}:${s < 10 ? '0' : ''}${s.toFixed(1)}`;
}

/** Label ruler: m:ss, plus ".5" bila tick setengah detik. */
function fmtRuler(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  const whole = Math.floor(s + 1e-6);
  const frac = s - whole;
  const base = `${m}:${String(whole).padStart(2, '0')}`;
  return frac > 0.01 ? `${base}.5` : base;
}

/** Pilih interval tick agar label tidak bertumpuk (min ~60px per label). */
function pickInterval(pxPerSec: number): number {
  for (const o of [0.5, 1, 2, 5, 10, 30, 60]) if (o * pxPerSec >= 60) return o;
  return 60;
}

// ---------- util snapping ----------

/** Kumpulkan titik snap: 0, playhead, dan tepi semua klip lain. */
function collectSnapPoints(p: Project, excludeClipId: string, playhead: number): number[] {
  const pts: number[] = [0, playhead];
  for (const t of p.tracks) {
    for (const c of t.clips) {
      if (c.id === excludeClipId) continue;
      pts.push(c.start, clipEnd(c));
    }
  }
  return pts;
}

/** Snap satu nilai waktu ke titik terdekat dalam ambang. */
function snapValue(v: number, pts: number[], threshold: number): number {
  let best = v;
  let bestD = threshold;
  for (const pt of pts) {
    const d = Math.abs(pt - v);
    if (d < bestD) { bestD = d; best = pt; }
  }
  return best;
}

/** Snap posisi start klip: pertimbangkan tepi kiri DAN kanan klip. */
function snapMove(start: number, duration: number, pts: number[], threshold: number): number {
  let bestDelta = Infinity;
  for (const pt of pts) {
    const dS = pt - start;
    if (Math.abs(dS) < Math.abs(bestDelta)) bestDelta = dS;
    const dE = pt - (start + duration);
    if (Math.abs(dE) < Math.abs(bestDelta)) bestDelta = dE;
  }
  return Math.abs(bestDelta) <= threshold ? start + bestDelta : start;
}

// ---------- util lain ----------

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

interface DragState {
  mode: 'move' | 'trim-start' | 'trim-end';
  clipId: string;
  /** Selisih (detik) antara posisi pointer dan clip.start saat mulai (mode move). */
  grabOffset: number;
  /** pushHistory sudah dipanggil? (dipanggil sekali saat gerakan pertama) */
  pushed: boolean;
  startX: number;
  startY: number;
}

// ---------- header track ----------

function TrackHead({ track }: { track: Track }) {
  const [hover, setHover] = useState(false);
  const toggleTrackMuted = useProject((s) => s.toggleTrackMuted);
  const toggleTrackLocked = useProject((s) => s.toggleTrackLocked);
  const removeTrack = useProject((s) => s.removeTrack);

  const icon = track.kind === 'video' ? '🎬' : track.kind === 'overlay' ? '🖼' : '🔊';
  const smallBtn = { padding: '2px 5px', fontSize: 10.5 } as const;

  return (
    <div
      className="tl-track-head"
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <span aria-hidden>{icon}</span>
      <span
        style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
        title={track.name}
      >
        {track.name}
      </span>
      <button
        className={`btn btn-sm btn-ghost ${track.muted ? 'active' : ''}`}
        style={smallBtn}
        title={track.muted ? 'Bunyikan track' : 'Bisukan track'}
        onClick={() => toggleTrackMuted(track.id)}
      >
        M
      </button>
      <button
        className={`btn btn-sm btn-ghost ${track.locked ? 'active' : ''}`}
        style={smallBtn}
        title={track.locked ? 'Buka kunci track' : 'Kunci track'}
        onClick={() => toggleTrackLocked(track.id)}
      >
        {track.locked ? '🔒' : '🔓'}
      </button>
      <button
        className="btn btn-sm btn-ghost"
        style={{ ...smallBtn, color: 'var(--danger)', visibility: hover ? 'visible' : 'hidden' }}
        title="Hapus track"
        onClick={() => removeTrack(track.id)}
      >
        ✕
      </button>
    </div>
  );
}

// ---------- komponen utama ----------

export default function Timeline() {
  const project = useProject((s) => s.project);
  const pushHistory = useProject((s) => s.pushHistory);
  const splitClipAt = useProject((s) => s.splitClipAt);
  const deleteClip = useProject((s) => s.deleteClip);
  const addTrack = useProject((s) => s.addTrack);
  const addClipFromAsset = useProject((s) => s.addClipFromAsset);

  const currentTime = useUi((s) => s.currentTime);
  const setCurrentTime = useUi((s) => s.setCurrentTime);
  const pxPerSec = useUi((s) => s.pxPerSec);
  const setPxPerSec = useUi((s) => s.setPxPerSec);
  const snapping = useUi((s) => s.snapping);
  const toggleSnapping = useUi((s) => s.toggleSnapping);
  const selectedClipId = useUi((s) => s.selectedClipId);
  const selectClip = useUi((s) => s.selectClip);
  const showToast = useUi((s) => s.showToast);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const laneRefs = useRef(new Map<string, HTMLDivElement>());
  const dragRef = useRef<DragState | null>(null);
  const [dragOverTrack, setDragOverTrack] = useState<string | null>(null);
  // posisi scroll horizontal (dibulatkan) untuk virtualisasi tick ruler
  const [viewLeft, setViewLeft] = useState(0);
  // lebar viewport timeline (di-update lewat ResizeObserver, bukan dibaca saat render)
  const [viewW, setViewW] = useState(1800);

  useEffect(() => {
    const sc = scrollRef.current;
    if (!sc) return;
    const update = () => setViewW(sc.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(sc);
    return () => ro.disconnect();
  }, []);

  // ---- Ctrl+scroll = zoom timeline dengan anchor di posisi kursor ----
  // Listener native ({passive:false}) karena React memasang wheel secara pasif.
  useEffect(() => {
    const sc = scrollRef.current;
    if (!sc) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      const ui = useUi.getState();
      const oldPx = ui.pxPerSec;
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      ui.setPxPerSec(oldPx * factor);
      const newPx = useUi.getState().pxPerSec;
      if (newPx === oldPx) return;
      // pertahankan waktu di bawah kursor tetap di tempatnya
      const rect = sc.getBoundingClientRect();
      const xInView = e.clientX - rect.left;
      const tAtCursor = (xInView + sc.scrollLeft - HEAD_W) / oldPx;
      sc.scrollLeft = Math.max(0, tAtCursor * newPx + HEAD_W - xInView);
    };
    sc.addEventListener('wheel', onWheel, { passive: false });
    return () => sc.removeEventListener('wheel', onWheel);
  }, []);

  const durTotal = Math.max(projectDuration(project), 60);
  const innerW = durTotal * pxPerSec + 300;

  // ---- konversi X pointer (client) -> waktu timeline (detik) ----
  const timeAtClientX = (clientX: number): number => {
    const sc = scrollRef.current;
    if (!sc) return 0;
    const rect = sc.getBoundingClientRect();
    return (clientX - rect.left + sc.scrollLeft - HEAD_W) / useUi.getState().pxPerSec;
  };

  // ---- ruler: klik/drag = seek ----
  const onRulerDown = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setCurrentTime(Math.max(0, timeAtClientX(e.clientX)));
  };
  const onRulerMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    setCurrentTime(Math.max(0, timeAtClientX(e.clientX)));
  };
  const onRulerUp = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  };

  // ---- drag klip: pindah & trim ----
  // Listener gesture dipasang di WINDOW saat gesture mulai (bukan pada node klip,
  // karena node klip di-unmount saat klip di-reparent lintas track sehingga
  // pointer capture / handler lokal akan mati di tengah gesture).
  const detachDragListeners = useRef<(() => void) | null>(null);

  const endDrag = () => {
    dragRef.current = null;
    if (detachDragListeners.current) {
      detachDragListeners.current();
      detachDragListeners.current = null;
    }
  };

  const onWindowDragMove = (e: PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    // pengaman: tombol kiri sudah tidak ditekan -> akhiri gesture (anti "ghost drag")
    if ((e.buttons & 1) === 0) { endDrag(); return; }
    // baru dianggap gesture setelah bergerak > 3px; pushHistory SEKALI di sini
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

    if (d.mode === 'move') {
      let newStart = timeAtClientX(e.clientX) - d.grabOffset;
      // tentukan track target dari posisi Y pointer (hit-test rect lane,
      // tidak bergantung pada node klip)
      let targetTrackId = found.track.id;
      for (const [tid, el] of laneRefs.current) {
        const r = el.getBoundingClientRect();
        if (e.clientY >= r.top && e.clientY <= r.bottom) { targetTrackId = tid; break; }
      }
      if (ui.snapping) {
        const pts = collectSnapPoints(st.project, d.clipId, ui.currentTime);
        newStart = snapMove(newStart, found.clip.duration, pts, threshold);
      }
      st.moveClipLive(d.clipId, targetTrackId, Math.max(0, newStart));
    } else {
      let t = timeAtClientX(e.clientX);
      if (ui.snapping) {
        const pts = collectSnapPoints(st.project, d.clipId, ui.currentTime);
        t = snapValue(t, pts, threshold);
      }
      st.resizeClipLive(d.clipId, d.mode === 'trim-start' ? 'start' : 'end', t);
    }
  };

  const onWindowDragEnd = () => endDrag();

  const startDrag = (
    e: RPointerEvent<HTMLDivElement>,
    track: Track,
    clip: Clip,
    mode: DragState['mode'],
  ) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    selectClip(clip.id);
    if (track.locked) return; // track terkunci: hanya seleksi
    endDrag(); // bersihkan sisa gesture sebelumnya (jaga-jaga)
    dragRef.current = {
      mode,
      clipId: clip.id,
      grabOffset: timeAtClientX(e.clientX) - clip.start,
      pushed: false,
      startX: e.clientX,
      startY: e.clientY,
    };
    window.addEventListener('pointermove', onWindowDragMove);
    window.addEventListener('pointerup', onWindowDragEnd);
    window.addEventListener('pointercancel', onWindowDragEnd);
    detachDragListeners.current = () => {
      window.removeEventListener('pointermove', onWindowDragMove);
      window.removeEventListener('pointerup', onWindowDragEnd);
      window.removeEventListener('pointercancel', onWindowDragEnd);
    };
  };

  // lepas listener global bila komponen unmount di tengah gesture
  useEffect(() => () => { detachDragListeners.current?.(); }, []);

  // ---- drop asset dari MediaPanel ----
  const onLaneDragOver = (e: RDragEvent<HTMLDivElement>, track: Track) => {
    if (!e.dataTransfer.types.includes(ASSET_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    if (dragOverTrack !== track.id) setDragOverTrack(track.id);
  };
  const onLaneDragLeave = (e: RDragEvent<HTMLDivElement>, track: Track) => {
    // abaikan bila pointer hanya berpindah ke elemen anak lane
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setDragOverTrack((cur) => (cur === track.id ? null : cur));
  };
  const onLaneDrop = (e: RDragEvent<HTMLDivElement>, track: Track) => {
    setDragOverTrack(null);
    const assetId = e.dataTransfer.getData(ASSET_MIME);
    if (!assetId) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const at = Math.max(0, (e.clientX - rect.left) / pxPerSec);
    const newId = addClipFromAsset(track.id, assetId, at);
    if (newId) selectClip(newId);
    else showToast('Klip tidak bisa ditambahkan: jenis media tidak cocok atau track terkunci.');
  };

  // ---- toolbar ----
  const doSplit = () => {
    if (!selectedClipId) return;
    const found = findClipIn(project, selectedClipId);
    if (!found) return;
    if (currentTime <= found.clip.start + 0.05 || currentTime >= clipEnd(found.clip) - 0.05) {
      showToast('Posisikan playhead di dalam klip terpilih untuk split.');
      return;
    }
    splitClipAt(selectedClipId, currentTime);
  };
  const doDelete = () => {
    if (!selectedClipId) return;
    deleteClip(selectedClipId);
    selectClip(null);
  };

  const onScroll = () => {
    const sc = scrollRef.current;
    if (!sc) return;
    setViewLeft(Math.floor(sc.scrollLeft / 300) * 300); // dibulatkan agar re-render jarang
  };

  // ---- tick ruler (hanya render yang terlihat) ----
  const interval = pickInterval(pxPerSec);
  const minor = interval / 5;
  const tStart = Math.max(0, (viewLeft - HEAD_W - 300) / pxPerSec);
  const tEnd = Math.min((viewLeft + viewW + 600 - HEAD_W) / pxPerSec, (innerW - HEAD_W) / pxPerSec);
  const ticks: ReactElement[] = [];
  for (let i = Math.floor(tStart / minor); i <= Math.ceil(tEnd / minor); i++) {
    const t = i * minor;
    if (t < 0 || t > tEnd) continue;
    const major = i % 5 === 0;
    ticks.push(
      <div
        key={i}
        className="tl-ruler-tick"
        style={major
          ? { left: HEAD_W + t * pxPerSec }
          : { left: HEAD_W + t * pxPerSec, top: 'auto', bottom: 0, height: 8, padding: 0 }}
      >
        {major ? fmtRuler(t) : ''}
      </div>,
    );
  }

  return (
    <>
      {/* ------- toolbar ------- */}
      <div className="tl-toolbar">
        <button className="btn btn-sm" disabled={!selectedClipId} onClick={doSplit} title="Split klip di playhead (S)">
          ✂ Split
        </button>
        <button className="btn btn-sm" disabled={!selectedClipId} onClick={doDelete} title="Hapus klip terpilih (Del)">
          🗑 Hapus
        </button>
        <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--border)' }} />
        <span className="hint">Track:</span>
        <button className="btn btn-sm" onClick={() => addTrack('video')} title="Tambah track video">+ Video</button>
        <button className="btn btn-sm" onClick={() => addTrack('overlay')} title="Tambah track overlay">+ Overlay</button>
        <button className="btn btn-sm" onClick={() => addTrack('audio')} title="Tambah track audio">+ Audio</button>
        <div style={{ width: 1, alignSelf: 'stretch', background: 'var(--border)' }} />
        <button
          className={`btn btn-sm ${snapping ? 'active' : ''}`}
          onClick={toggleSnapping}
          title={snapping ? 'Snapping aktif - klik untuk mematikan' : 'Snapping mati - klik untuk mengaktifkan'}
        >
          🧲 Snap
        </button>
        <div style={{ flex: 1 }} />
        <span aria-hidden style={{ fontSize: 12 }}>🔍</span>
        <input
          type="range"
          className="slider"
          min={8}
          max={400}
          step={1}
          value={pxPerSec}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setPxPerSec(Number(e.target.value))}
          style={{ width: 140 }}
          title="Zoom timeline"
        />
        <span className="time-display">{fmtTime(currentTime)}</span>
      </div>

      {/* ------- area scroll ------- */}
      <div className="tl-scroll" ref={scrollRef} onScroll={onScroll}>
        <div className="tl-inner" style={{ width: innerW }}>
          {/* ruler sticky top: klik/drag = seek */}
          <div
            className="tl-ruler"
            onPointerDown={onRulerDown}
            onPointerMove={onRulerMove}
            onPointerUp={onRulerUp}
            onPointerCancel={onRulerUp}
          >
            {ticks}
            {/* penutup sudut kiri agar tick tidak tampak di bawah kolom header */}
            <div
              style={{
                position: 'sticky', left: 0, width: HEAD_W, height: '100%',
                background: 'var(--panel-2)', borderRight: '1px solid var(--border)', zIndex: 1,
              }}
            />
          </div>

          {/* baris track */}
          {project.tracks.map((track) => {
            const sorted = sortedClips(track);
            const laneH = track.kind === 'audio' ? 40 : 56;
            return (
              <div className="tl-track-row" key={track.id}>
                <TrackHead track={track} />
                <div
                  className={`tl-track-lane ${dragOverTrack === track.id ? 'drag-over' : ''}`}
                  data-track-id={track.id}
                  style={{ height: laneH, opacity: track.muted ? 0.55 : 1 }}
                  ref={(el) => {
                    if (el) laneRefs.current.set(track.id, el);
                    else laneRefs.current.delete(track.id);
                  }}
                  onPointerDown={(e) => {
                    // klik area kosong lane = batalkan seleksi (tanpa seek)
                    if (e.target === e.currentTarget) selectClip(null);
                  }}
                  onDragOver={(e) => onLaneDragOver(e, track)}
                  onDragLeave={(e) => onLaneDragLeave(e, track)}
                  onDrop={(e) => onLaneDrop(e, track)}
                >
                  {sorted.map((clip) => {
                    const label = clipLabel(clip, project);
                    const clipW = Math.max(3, clip.duration * pxPerSec);
                    // klip sempit: sembunyikan trim handle agar area 'move' selalu ada
                    const showHandles = clipW > 24;
                    return (
                      <div
                        key={clip.id}
                        className={`tl-clip kind-${clip.kind} ${selectedClipId === clip.id ? 'selected' : ''}`}
                        style={{
                          left: clip.start * pxPerSec,
                          width: clipW,
                          cursor: track.locked ? 'not-allowed' : undefined,
                        }}
                        title={label}
                        onPointerDown={(e) => startDrag(e, track, clip, 'move')}
                      >
                        {showHandles && (
                          <div
                            className="trim-handle left"
                            onPointerDown={(e) => startDrag(e, track, clip, 'trim-start')}
                          />
                        )}
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', pointerEvents: 'none' }}>
                          {label}
                        </span>
                        {showHandles && (
                          <div
                            className="trim-handle right"
                            onPointerDown={(e) => startDrag(e, track, clip, 'trim-end')}
                          />
                        )}
                      </div>
                    );
                  })}

                  {/* badge transisi di batas antar klip bersebelahan */}
                  {sorted.map((clip, i) => {
                    if (!clip.transitionOut || clip.transitionOut.type === 'none') return null;
                    const next = sorted[i + 1];
                    if (!next || Math.abs(next.start - clipEnd(clip)) >= ADJACENT_EPS) return null;
                    return (
                      <div
                        key={`tr-${clip.id}`}
                        className="tl-transition-badge"
                        style={{ left: clipEnd(clip) * pxPerSec }}
                        title={`Transisi: ${clip.transitionOut.type}`}
                      >
                        ⇄
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* playhead di atas seluruh area track, ikut scroll horizontal */}
          <div className="tl-playhead" style={{ left: HEAD_W + currentTime * pxPerSec }} />
        </div>
      </div>
    </>
  );
}
