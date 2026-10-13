// ============================================================
// ProgramMonitor - hasil sequence (komposit DOM) + transport.
//
// Arsitektur:
// - Stage mengikuti rasio proyek, fit ke container (ResizeObserver).
// - Layer digambar bawah -> atas mengikuti semantik EXPORT: track video
//   pertama YANG BERISI klip media = dasar (full-frame), track video
//   lainnya + track overlay = overlay ber-transform. Track (video ekstra/
//   overlay) yang muted tidak digambar, sama seperti export.
//   Track audio tidak digambar tapi tetap diputar lewat elemen <audio>
//   tersembunyi.
// - Semua elemen media TETAP MOUNTED (tidak reload saat scrub);
//   klip non-aktif hanya disembunyikan (visibility: hidden).
// - Sinkronisasi media dilakukan tiap frame terhadap currentTime.
// ============================================================
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { useProject } from '../store/projectStore';
import { useUi } from '../store/uiStore';
import {
  ADJACENT_EPS, clipEnd, projectDuration, sortedClips, DEFAULT_TEXT_STYLE, toTimecode, trackAudible,
} from '../types';
import type { Clip, ClipEffects, MediaAsset, TextStyle, Track } from '../types';
import { usePlaybackClock } from '../engine/usePlaybackClock';
import { attachMeter } from '../engine/audioMeter';
import { COMMANDS } from '../commands';
import { MiniRuler, TimecodeField, Transport } from './MonitorBits';

// ---------- util kecil ----------

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

const run = (id: string) => () => COMMANDS.find((c) => c.id === id)?.run();

/** Susun CSS filter dari efek klip. `sc` = skala px proyek -> px stage. */
function cssFilter(fx: ClipEffects, sc: number): string | undefined {
  const parts: string[] = [];
  if (fx.brightness !== 0) parts.push(`brightness(${1 + fx.brightness})`);
  if (fx.contrast !== 1) parts.push(`contrast(${fx.contrast})`);
  if (fx.saturation !== 1) parts.push(`saturate(${fx.saturation})`);
  if (fx.hue !== 0) parts.push(`hue-rotate(${fx.hue}deg)`);
  if (fx.blur > 0) parts.push(`blur(${fx.blur * sc}px)`);
  return parts.length ? parts.join(' ') : undefined;
}

/** text-shadow: outline 4 arah + drop shadow lembut. `k` = skala teks. */
function textShadowCss(st: TextStyle, k: number): string | undefined {
  const parts: string[] = [];
  if (st.outlineWidth > 0) {
    const w = st.outlineWidth * k;
    parts.push(
      `${-w}px 0 0 ${st.outlineColor}`,
      `${w}px 0 0 ${st.outlineColor}`,
      `0 ${-w}px 0 ${st.outlineColor}`,
      `0 ${w}px 0 ${st.outlineColor}`,
    );
  }
  if (st.shadow) parts.push(`0 ${2 * k}px ${8 * k}px rgba(0,0,0,.65)`);
  return parts.length ? parts.join(', ') : undefined;
}

// ---------- komponen ----------

export default function ProgramMonitor() {
  const project = useProject((s) => s.project);
  const pushHistory = useProject((s) => s.pushHistory);
  const updateTransformLive = useProject((s) => s.updateTransformLive);

  const currentTime = useUi((s) => s.currentTime);
  const playing = useUi((s) => s.playing);
  const shuttle = useUi((s) => s.shuttle);
  const selectedClipId = useUi((s) => s.selectedClipId);
  const selectClip = useUi((s) => s.selectClip);
  const setCurrentTime = useUi((s) => s.setCurrentTime);
  const togglePlay = useUi((s) => s.togglePlay);
  const gotoOpen = useUi((s) => s.gotoOpen);
  const setGotoOpen = useUi((s) => s.setGotoOpen);

  usePlaybackClock();
  // Media hanya diputar elemen <video>/<audio> saat maju 1x-8x; mundur ditampilkan per frame.
  const mediaPlaying = playing && shuttle > 0;
  const stageRef = useRef<HTMLDivElement | null>(null);

  // ----- ukuran stage: fit rasio proyek ke container -----
  const areaRef = useRef<HTMLDivElement | null>(null);
  const [area, setArea] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const en of entries) {
        setArea({ w: en.contentRect.width, h: en.contentRect.height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = area.w > 0 && area.h > 0
    ? Math.min(area.w / project.width, area.h / project.height)
    : 0;
  const stageW = Math.max(1, Math.floor(project.width * fit));
  const stageH = Math.max(1, Math.floor(project.height * fit));
  const sc = stageH / project.height; // skala efek (px proyek -> px stage)
  const kText = stageH / 1080;        // skala teks (referensi tinggi 1080)

  // ----- registry elemen media (tetap mounted, disinkronkan tiap frame) -----
  const mediaEls = useRef(new Map<string, HTMLMediaElement>());
  const refFns = useRef(new Map<string, (el: HTMLMediaElement | null) => void>());
  /** Callback ref stabil per id klip (agar tidak dipasang ulang tiap render). */
  const mediaRef = (id: string) => {
    let fn = refFns.current.get(id);
    if (!fn) {
      fn = (el) => {
        if (el) {
          mediaEls.current.set(id, el);
          attachMeter(el); // meter audio membaca semua elemen yang berbunyi
        } else {
          // Unmount: elemen media yang dilepas dari dokumen TETAP memutar
          // audionya (spec HTML) dan tidak lagi tersentuh loop sinkronisasi.
          // Pause di sini menghentikan audio "hantu" (klip dihapus, undo,
          // ganti proyek saat playing) dan membuat elemen bisa di-GC.
          const prev = mediaEls.current.get(id);
          if (prev) {
            try {
              if (!prev.paused) prev.pause();
            } catch { /* abaikan: elemen sudah tidak valid */ }
            mediaEls.current.delete(id);
          }
          // JANGAN hapus entri refFns di sini: saat klip di-reparent
          // (unmount+mount dalam satu commit) fn harus tetap stabil.
          // Entri usang dibersihkan lewat effect [project] di bawah.
        }
      };
      refFns.current.set(id, fn);
    }
    return fn;
  };

  // Bersihkan cache callback-ref untuk id klip yang sudah tidak ada di
  // proyek (mencegah refFns tumbuh tanpa batas).
  useEffect(() => {
    const ids = new Set<string>();
    for (const tr of project.tracks) for (const c of tr.clips) ids.add(c.id);
    for (const id of [...refFns.current.keys()]) {
      if (!ids.has(id)) refFns.current.delete(id);
    }
  }, [project]);

  // ----- sinkronisasi audio/video terhadap playhead -----
  useEffect(() => {
    // Toleransi seek: saat playing longgar (0.25 dtk, hindari stutter);
    // saat pause ketat (setengah frame) supaya step-frame / scrub kecil
    // benar-benar menampilkan frame baru.
    const tol = mediaPlaying ? 0.25 * Math.max(1, shuttle) : 1 / (2 * Math.max(1, project.fps));
    for (const track of project.tracks) {
      for (const clip of track.clips) {
        if (clip.kind !== 'video' && clip.kind !== 'audio') continue;
        const el = mediaEls.current.get(clip.id);
        if (!el) continue;

        const active = !clip.disabled && currentTime >= clip.start && currentTime < clipEnd(clip);
        if (!active) {
          if (!el.paused) el.pause();
          continue;
        }
        const desired = clip.sourceIn + (currentTime - clip.start) * clip.speed;
        // Track video mengikuti mute biasa; track audio juga mengikuti solo antar-track.
        const silent = clip.muted || (track.kind === 'audio' ? !trackAudible(track, project.tracks.filter((t) => t.kind === 'audio')) : track.muted);
        try {
          if (Math.abs(el.currentTime - desired) > tol) el.currentTime = desired;
          const rate = clip.speed * (mediaPlaying ? shuttle : 1);
          if (el.playbackRate !== rate) el.playbackRate = Math.min(16, rate);
          // Shuttle di atas 2x: dibisukan seperti Premiere, supaya tidak memekakkan.
          const vol = clamp01(clip.volume * (silent || shuttle > 2 ? 0 : 1));
          if (el.volume !== vol) el.volume = vol;
        } catch {
          // media belum siap; frame berikutnya dicoba lagi
        }
        if (mediaPlaying) {
          if (el.paused) void el.play().catch(() => { /* autoplay ditolak */ });
        } else if (!el.paused) {
          el.pause();
        }
      }
    }
  }, [currentTime, mediaPlaying, shuttle, project]);

  // ----- Ekspor frame (Ctrl+Shift+E): gambar stage ke canvas pada resolusi proyek -----
  useEffect(() => {
    const onExportFrame = async () => {
      const ui = useUi.getState();
      try {
        const blob = await renderFrame();
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `${project.name || 'frame'}_${toTimecode(currentTime, project.fps).replace(/:/g, '-')}.png`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        ui.showToast('Frame diekspor sebagai PNG.');
      } catch (e) {
        ui.showToast(`Gagal mengekspor frame: ${e instanceof Error ? e.message : String(e)}`);
      }
    };
    /** Komposit sederhana: klip dasar + overlay gambar/video yang aktif + teks, pada ukuran proyek. */
    const renderFrame = async (): Promise<Blob> => {
      const W = project.width, H = project.height;
      const cv = document.createElement('canvas');
      cv.width = W; cv.height = H;
      const g = cv.getContext('2d');
      if (!g) throw new Error('canvas tidak tersedia');
      g.fillStyle = '#000';
      g.fillRect(0, 0, W, H);
      const stage = stageRef.current;
      if (!stage) throw new Error('monitor belum siap');
      const sr = stage.getBoundingClientRect();
      const k = W / sr.width;
      for (const el of stage.querySelectorAll<HTMLElement>('video, img, [data-text]')) {
        const cs = getComputedStyle(el);
        if (cs.visibility === 'hidden' || cs.display === 'none') continue;
        const r = el.getBoundingClientRect();
        g.save();
        g.globalAlpha = Number(cs.opacity) || 1;
        g.filter = cs.filter && cs.filter !== 'none' ? cs.filter : 'none';
        if (el instanceof HTMLVideoElement || el instanceof HTMLImageElement) {
          const nw = el instanceof HTMLVideoElement ? el.videoWidth : el.naturalWidth;
          const nh = el instanceof HTMLVideoElement ? el.videoHeight : el.naturalHeight;
          if (!nw || !nh) { g.restore(); continue; }
          // object-fit: contain untuk klip dasar
          let dx = (r.left - sr.left) * k, dy = (r.top - sr.top) * k, dw = r.width * k, dh = r.height * k;
          if (cs.objectFit === 'contain') {
            const s = Math.min(dw / nw, dh / nh);
            dx += (dw - nw * s) / 2; dy += (dh - nh * s) / 2; dw = nw * s; dh = nh * s;
          }
          g.drawImage(el, dx, dy, dw, dh);
        } else {
          g.fillStyle = cs.color;
          g.font = `${cs.fontStyle} ${cs.fontWeight} ${parseFloat(cs.fontSize) * k}px ${cs.fontFamily}`;
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          const lines = (el.textContent ?? '').split('\n');
          const lh = parseFloat(cs.fontSize) * k * 1.25;
          const cx = (r.left - sr.left + r.width / 2) * k;
          const cy = (r.top - sr.top + r.height / 2) * k - ((lines.length - 1) * lh) / 2;
          lines.forEach((ln, i) => g.fillText(ln, cx, cy + i * lh));
        }
        g.restore();
      }
      return new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('gagal membuat PNG'))), 'image/png'));
    };
    window.addEventListener('dcut:export-frame', onExportFrame);
    return () => window.removeEventListener('dcut:export-frame', onExportFrame);
  }, [project, currentTime]);

  // ----- drag klip overlay/teks di stage -----
  const onClipPointerDown = (e: ReactPointerEvent, clip: Clip) => {
    e.stopPropagation();
    e.preventDefault();
    selectClip(clip.id);
    if (e.button !== 0) return;

    const startX = e.clientX;
    const startY = e.clientY;
    const tx = clip.transform.x;
    const ty = clip.transform.y;
    const sw = stageW;
    const sh = stageH;
    let dragging = false; // pushHistory sekali, tepat sebelum perubahan pertama

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!dragging) {
        if (Math.abs(dx) < 2 && Math.abs(dy) < 2) return; // masih klik biasa
        pushHistory();
        dragging = true;
      }
      updateTransformLive(clip.id, {
        x: clamp01(tx + dx / sw),
        y: clamp01(ty + dy / sh),
      });
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  // ----- data turunan -----
  const assetById = useMemo(() => {
    const m = new Map<string, MediaAsset>();
    for (const a of project.assets) m.set(a.id, a);
    return m;
  }, [project.assets]);

  const videoTracks = project.tracks.filter((tr) => tr.kind === 'video');
  const overlayTracks = project.tracks.filter((tr) => tr.kind === 'overlay');
  const audioTracks = project.tracks.filter((tr) => tr.kind === 'audio');
  // Semantik export: base = track video PERTAMA YANG BERISI klip media
  // (track kosong dilewati); track video lainnya dirender sebagai overlay.
  const baseVideoTrack =
    videoTracks.find((tr) => tr.clips.some((c) => c.kind !== 'text')) ?? videoTracks[0];

  const t = currentTime;
  const dur = projectDuration(project);
  const frameStep = 1 / Math.max(1, project.fps);

  // ----- render satu klip teks (dipakai track video & overlay) -----
  const renderTextClip = (clip: Clip, visible: boolean) => {
    const st = clip.textStyle ?? DEFAULT_TEXT_STYLE;
    const tr = clip.transform;
    const selected = clip.id === selectedClipId;
    // Jujur terhadap drawtext export: TANPA rotasi (drawtext tidak
    // mendukungnya) dan TANPA word-wrap otomatis (whiteSpace 'pre' -
    // hanya baris baru manual yang dirender, sama seperti drawtext).
    const style: CSSProperties = {
      position: 'absolute',
      left: tr.x * stageW,
      top: tr.y * stageH,
      transform: 'translate(-50%, -50%)',
      fontFamily: st.fontFamily,
      fontWeight: st.bold ? 700 : 400,
      fontStyle: st.italic ? 'italic' : 'normal',
      fontSize: Math.max(1, st.fontSize * kText * tr.scale),
      color: st.color,
      textAlign: st.align,
      whiteSpace: 'pre',
      lineHeight: 1.25,
      opacity: tr.opacity,
      visibility: visible ? 'visible' : 'hidden',
      textShadow: textShadowCss(st, kText),
      cursor: 'move',
      outline: selected ? '1px dashed var(--accent)' : undefined,
      outlineOffset: 2,
    };
    if (st.backgroundColor) {
      style.backgroundColor = st.backgroundColor;
      style.padding = '0.2em 0.5em';
      style.borderRadius = '0.15em';
    }
    return (
      <div key={clip.id} data-text style={style} onPointerDown={(e) => onClipPointerDown(e, clip)}>
        {clip.text ?? ''}
      </div>
    );
  };

  // ----- render satu track visual (video = dasar, overlay = transform) -----
  const renderVisualTrack = (track: Track, isBase: boolean) => {
    const clips = sortedClips(track);
    return clips.map((clip, i) => {
      let visible = !clip.disabled && t >= clip.start && t < clipEnd(clip);
      let opacity = clip.transform.opacity;

      // Transisi dianggap aktif hanya bila export juga menerapkannya:
      // tipe bukan 'none', durasi > 0.05, dan klip bersebelahan dalam
      // ambang ADJACENT_EPS (sama dengan EPS exportGraph).
      const crossable = (tn?: { type: string; duration: number }) =>
        !!tn && tn.type !== 'none' && tn.duration > 0.05;

      // Aproksimasi transisi (hanya klip dasar): semua jenis -> crossfade.
      if (isBase && clip.kind !== 'text') {
        // A tetap tampil di bawah selama jendela transisi menuju klip berikutnya.
        const next = clips[i + 1];
        if (crossable(clip.transitionOut) && clip.transitionOut && next
          && Math.abs(next.start - clipEnd(clip)) <= ADJACENT_EPS) {
          const td = Math.max(0.01, clip.transitionOut.duration);
          if (t >= next.start && t < next.start + td) visible = true;
        }
        // B fade-in 0 -> 1 bila klip sebelumnya punya transitionOut ke klip ini.
        const prev = clips[i - 1];
        if (prev && crossable(prev.transitionOut) && prev.transitionOut
          && Math.abs(clip.start - clipEnd(prev)) <= ADJACENT_EPS) {
          const td = Math.max(0.01, prev.transitionOut.duration);
          if (t >= clip.start && t < clip.start + td) {
            opacity *= clamp01((t - clip.start) / td);
          }
        }
      }

      if (clip.kind === 'text') {
        // Export men-skip drawtext untuk track muted (termasuk track dasar).
        if (track.muted) return null;
        return renderTextClip(clip, visible);
      }

      const asset = clip.assetId ? assetById.get(clip.assetId) : undefined;
      if (!asset) return null;

      const fx = clip.effects;
      const filter = cssFilter(fx, sc);

      if (isBase) {
        // Klip dasar: penuhi stage (contain, sisi dibiarkan hitam).
        const mediaStyle: CSSProperties = {
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'contain',
          filter,
          opacity,
          visibility: visible ? 'visible' : 'hidden',
          pointerEvents: 'none',
        };
        const fxOverlayBase: CSSProperties = { position: 'absolute', inset: 0, pointerEvents: 'none' };
        return (
          <Fragment key={clip.id}>
            {clip.kind === 'video' ? (
              <video
                ref={mediaRef(clip.id)}
                src={asset.url}
                style={mediaStyle}
                preload="auto"
                playsInline
                crossOrigin="anonymous"
              />
            ) : (
              <img src={asset.url} alt="" style={mediaStyle} draggable={false} crossOrigin="anonymous" />
            )}
            {/* Temperature: overlay warna penuh stage, hanya saat klip dasar aktif. */}
            {visible && fx.temperature !== 0 && (
              <div
                style={{
                  ...fxOverlayBase,
                  background: fx.temperature > 0
                    ? `rgba(255,140,0,${fx.temperature * 0.22})`
                    : `rgba(40,110,255,${-fx.temperature * 0.22})`,
                  mixBlendMode: 'overlay',
                }}
              />
            )}
            {/* Vignette di atas stage saat klip dasar aktif. */}
            {visible && fx.vignette > 0 && (
              <div
                style={{
                  ...fxOverlayBase,
                  background: `radial-gradient(ellipse, transparent 55%, rgba(0,0,0,${fx.vignette}))`,
                }}
              />
            )}
          </Fragment>
        );
      }

      // Klip overlay: ukuran & posisi dari transform, bisa di-drag.
      const trf = clip.transform;
      const selected = clip.id === selectedClipId;
      const style: CSSProperties = {
        position: 'absolute',
        left: trf.x * stageW,
        top: trf.y * stageH,
        width: stageW * trf.scale,
        height: 'auto',
        transform: `translate(-50%, -50%) rotate(${trf.rotation}deg)`,
        filter,
        opacity,
        visibility: visible ? 'visible' : 'hidden',
        cursor: 'move',
        outline: selected ? '1px dashed var(--accent)' : undefined,
        outlineOffset: 2,
      };
      return clip.kind === 'video' ? (
        <video
          key={clip.id}
          ref={mediaRef(clip.id)}
          src={asset.url}
          style={style}
          preload="auto"
          playsInline
          crossOrigin="anonymous"
          onPointerDown={(e) => onClipPointerDown(e, clip)}
        />
      ) : (
        <img
          key={clip.id}
          src={asset.url}
          alt=""
          style={style}
          draggable={false}
          crossOrigin="anonymous"
          onPointerDown={(e) => onClipPointerDown(e, clip)}
        />
      );
    });
  };

  // ----- subtitle aktif -----
  const activeCue = project.showSubtitles
    ? project.subtitles.find((c) => t >= c.start && t < c.end)
    : undefined;
  const ss = project.subtitleStyle;

  // ----- transport -----
  const onTogglePlay = () => {
    if (!playing && currentTime >= dur - 0.01) setCurrentTime(0);
    togglePlay();
  };
  const fps = project.fps;

  return (
    <div className="monitor" onPointerDown={() => useUi.getState().setFocusedMonitor('program')}>
      <div className="monitor-area" ref={areaRef}>
        <div
          className="preview-stage"
          ref={stageRef}
          style={{ width: stageW, height: stageH }}
          onPointerDown={() => selectClip(null)}
        >
          {/* Layer bawah -> atas (semantik export): track dasar full-frame,
              lalu track video ekstra + track overlay sebagai overlay
              ber-transform. Track overlay/video-ekstra yang muted tidak
              dirender, konsisten dengan export. */}
          {baseVideoTrack && (
            <Fragment key={baseVideoTrack.id}>{renderVisualTrack(baseVideoTrack, true)}</Fragment>
          )}
          {videoTracks
            .filter((tr) => tr !== baseVideoTrack && !tr.muted)
            .map((tr) => (
              <Fragment key={tr.id}>{renderVisualTrack(tr, false)}</Fragment>
            ))}
          {overlayTracks
            .filter((tr) => !tr.muted)
            .map((tr) => (
              <Fragment key={tr.id}>{renderVisualTrack(tr, false)}</Fragment>
            ))}

          {/* Subtitle di bawah-tengah stage. */}
          {activeCue && (
            <div
              style={{
                position: 'absolute',
                left: '50%',
                bottom: '4%',
                transform: 'translateX(-50%)',
                maxWidth: '85%',
                textAlign: 'center',
                pointerEvents: 'none',
                fontFamily: ss.fontFamily,
                fontWeight: ss.bold ? 700 : 400,
                fontStyle: ss.italic ? 'italic' : 'normal',
                fontSize: Math.max(1, ss.fontSize * kText),
                color: ss.color,
                whiteSpace: 'pre-wrap',
                lineHeight: 1.3,
                textShadow: textShadowCss(ss, kText),
                ...(ss.backgroundColor
                  ? { backgroundColor: ss.backgroundColor, padding: '0.2em 0.5em', borderRadius: '0.15em' }
                  : {}),
              }}
            >
              {activeCue.text}
            </div>
          )}
        </div>

        {/* Audio track: tidak digambar, hanya diputar (tersembunyi). */}
        <div style={{ display: 'none' }}>
          {audioTracks.map((track) =>
            sortedClips(track).map((clip) => {
              if (clip.kind !== 'audio' || !clip.assetId) return null;
              const asset = assetById.get(clip.assetId);
              if (!asset) return null;
              return (
                <audio key={clip.id} ref={mediaRef(clip.id)} src={asset.url} preload="auto" crossOrigin="anonymous" />
              );
            }),
          )}
        </div>
        {playing && shuttle !== 1 && (
          <div style={{ position: 'absolute', top: 14, right: 16, fontFamily: 'var(--mono)', fontSize: 12, background: 'rgba(0,0,0,.6)', padding: '2px 6px', borderRadius: 2 }}>
            {shuttle > 0 ? `${shuttle}x` : `${shuttle}x mundur`}
          </div>
        )}
      </div>

      <div className="monitor-bar">
        <TimecodeField
          time={currentTime}
          fps={fps}
          label="Timecode program"
          forceEdit={gotoOpen}
          onEditEnd={() => setGotoOpen(false)}
          onCommit={(v) => setCurrentTime(Math.min(dur, v))}
        />
        <span className="hint" style={{ fontSize: 11 }}>{project.width}×{project.height} · {fps} fps</span>
        <span className="tc-dim" title="Durasi sequence">{toTimecode(dur, fps)}</span>
      </div>
      <MiniRuler
        time={currentTime}
        duration={dur}
        inPoint={project.inPoint}
        outPoint={project.outPoint}
        markers={project.markers}
        onSeek={(v) => setCurrentTime(v)}
      />
      <Transport
        buttons={[
          { icon: 'marker', label: 'Tambah penanda', keys: 'M', onClick: run('mark.add') },
          { icon: 'markIn', label: 'Tandai In', keys: 'I', onClick: run('mark.in') },
          { icon: 'markOut', label: 'Tandai Out', keys: 'O', onClick: run('mark.out') },
          null,
          { icon: 'goIn', label: 'Ke In', keys: 'Shift+I', onClick: run('mark.goIn'), disabled: project.inPoint === undefined },
          { icon: 'stepBack', label: 'Mundur 1 frame', keys: '←', onClick: () => setCurrentTime(currentTime - frameStep) },
          { icon: playing ? 'pause' : 'play', label: playing ? 'Jeda' : 'Putar', keys: 'Spasi', onClick: onTogglePlay, big: true },
          { icon: 'stepFwd', label: 'Maju 1 frame', keys: '→', onClick: () => setCurrentTime(Math.min(dur, currentTime + frameStep)) },
          { icon: 'goOut', label: 'Ke Out', keys: 'Shift+O', onClick: run('mark.goOut'), disabled: project.outPoint === undefined },
          null,
          { icon: 'lift', label: 'Lift rentang In-Out', keys: ';', onClick: run('seq.lift') },
          { icon: 'extract', label: 'Extract rentang In-Out', keys: "'", onClick: run('seq.extract') },
          { icon: 'camera', label: 'Ekspor frame', keys: 'Ctrl+Shift+E', onClick: run('file.exportFrame') },
        ]}
      />
    </div>
  );
}
