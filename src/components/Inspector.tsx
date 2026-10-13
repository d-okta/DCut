// ============================================================
// Panel kanan bertab, seperti Premiere:
// - Kontrol Efek  : Gerak (posisi/skala/rotasi), Opasitas, Waktu, Teks, Transisi
// - Warna         : koreksi dasar + tampilan kreatif (preset) per klip
// - Audio         : volume, bisu, kecepatan, track solo/mute
// - Caption       : gaya & daftar subtitle
//
// Aturan history: slider memakai aksi *Live saat digeser + pushHistory()
// sekali di onPointerDown; input lain memakai aksi biasa.
// ============================================================
import { useState } from 'react';
import type { ReactNode } from 'react';
import { useProject } from '../store/projectStore';
import { useUi } from '../store/uiStore';
import {
  Clip, ClipKind, ClipEffects, TransitionType, Track,
  DEFAULT_EFFECTS, DEFAULT_TRANSFORM, toTimecode, parseTimecode,
} from '../types';
import { FONT_CHOICES } from '../presets/textStyles';
import { TRANSITION_PRESETS } from '../presets/transitions';
import { COLOR_GRADE_PRESETS } from '../presets/colorGrades';
import Icon from './Icon';

const KIND_LABEL: Record<ClipKind, string> = { video: 'Video', audio: 'Audio', image: 'Gambar', text: 'Grafis teks' };
const SPEED_CHOICES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

// ---------- komponen kecil ----------

/** Bagian lipat dengan tombol reset, seperti grup efek di Effect Controls. */
function FxSection({ title, onReset, defaultOpen = true, children }: { title: string; onReset?(): void; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="fx-section">
      <button className={`fx-head ${open ? 'open' : ''}`} aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="chev"><Icon name="chevron" size={12} /></span>
        <span>{title}</span>
        {onReset && (
          <span className="fx-extra">
            <span role="button" tabIndex={0} className="icon-btn" title={`Reset ${title}`} aria-label={`Reset ${title}`}
              onClick={(e) => { e.stopPropagation(); onReset(); }}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onReset(); } }}>
              <Icon name="reset" size={12} />
            </span>
          </span>
        )}
      </button>
      {open && <div className="fx-body">{children}</div>}
    </div>
  );
}

/**
 * Baris properti: nama, slider, dan angka yang bisa diketik langsung.
 * `scale` mengubah nilai internal ke angka yang ditampilkan (mis. 0..1 -> 0..100%).
 */
function FxRow(props: {
  label: string; value: number; min: number; max: number; step?: number;
  scale?: number; digits?: number; unit?: string;
  onStart(): void; onLive(v: number): void; onCommit?(v: number): void;
}) {
  const { label, value, min, max, step = 0.01, scale = 1, digits = 1, unit = '', onStart, onLive, onCommit } = props;
  const [text, setText] = useState<string | null>(null);
  const shown = (value * scale).toFixed(digits);
  const commitText = () => {
    if (text === null) return;
    const n = Number(text.replace(',', '.'));
    if (Number.isFinite(n)) {
      const v = Math.min(max, Math.max(min, n / scale));
      onStart(); onLive(v); onCommit?.(v);
    }
    setText(null);
  };
  return (
    <div className="fx-row">
      <span className="fx-name">{label}</span>
      <input type="range" className="slider" min={min} max={max} step={step} value={value}
        aria-label={label} onPointerDown={onStart} onKeyDown={onStart}
        onChange={(e) => onLive(parseFloat(e.target.value))} />
      <input
        className="fx-val"
        value={text ?? `${shown}${unit}`}
        aria-label={`${label}, angka`}
        onFocus={(e) => { setText(shown); requestAnimationFrame(() => e.target.select()); }}
        onChange={(e) => setText(e.target.value)}
        onBlur={commitText}
        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setText(null); e.currentTarget.blur(); } }}
      />
    </div>
  );
}

function useSelectedClip(): { clip: Clip; track: Track } | null {
  const project = useProject((s) => s.project);
  const id = useUi((s) => s.selectedClipId);
  if (!id) return null;
  for (const t of project.tracks) {
    const c = t.clips.find((x) => x.id === id);
    if (c) return { clip: c, track: t };
  }
  return null;
}

function NoClip({ what }: { what: string }) {
  return (
    <div className="empty-state">
      Pilih klip di timeline untuk mengatur {what}.
      <br />
      <span className="hint">Klik klip, atau pindahkan playhead lalu tekan <kbd>↓</kbd> untuk melompat antar-klip.</span>
    </div>
  );
}

function ClipHeader({ clip, track }: { clip: Clip; track: Track }) {
  const assets = useProject((s) => s.project.assets);
  const fps = useProject((s) => s.project.fps);
  const asset = clip.assetId ? assets.find((a) => a.id === clip.assetId) : undefined;
  const name = clip.kind === 'text' ? (clip.text || 'Teks') : (asset?.name ?? '(media hilang)');
  return (
    <div style={{ padding: '8px 10px', borderBottom: '1px solid #1c1c1c', background: '#2a2a2a' }}>
      <div className="row">
        <span className="badge">{KIND_LABEL[clip.kind]}</span>
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }} title={name}>{name}</span>
        <span className="hint">{track.name}</span>
      </div>
      <div className="hint" style={{ fontFamily: 'var(--mono)', marginTop: 4 }}>
        {toTimecode(clip.start, fps)} · durasi {toTimecode(clip.duration, fps)}{clip.disabled ? ' · nonaktif' : ''}
      </div>
    </div>
  );
}

// ============================================================
// Kontrol Efek
// ============================================================

function EffectControls() {
  const sel = useSelectedClip();
  const fps = useProject((s) => s.project.fps);
  const st = useProject.getState();
  if (!sel) return <NoClip what="gerak, opasitas, teks, dan transisi" />;
  const { clip, track } = sel;
  const { pushHistory, updateClip, updateTransform, updateTransformLive, updateTextStyle, setTransition, updateClipLive } = st;
  const showTransform = clip.kind !== 'audio';
  const tr = clip.transitionOut;
  const ts = clip.textStyle;

  return (
    <div>
      <ClipHeader clip={clip} track={track} />

      {showTransform && (
        <FxSection title="Gerak" onReset={() => updateTransform(clip.id, { x: DEFAULT_TRANSFORM.x, y: DEFAULT_TRANSFORM.y, scale: DEFAULT_TRANSFORM.scale, rotation: DEFAULT_TRANSFORM.rotation })}>
          <FxRow label="Posisi X" value={clip.transform.x} min={0} max={1} step={0.001} scale={100} digits={1} unit="%"
            onStart={pushHistory} onLive={(v) => updateTransformLive(clip.id, { x: v })} />
          <FxRow label="Posisi Y" value={clip.transform.y} min={0} max={1} step={0.001} scale={100} digits={1} unit="%"
            onStart={pushHistory} onLive={(v) => updateTransformLive(clip.id, { y: v })} />
          <FxRow label="Skala" value={clip.transform.scale} min={0.05} max={4} step={0.005} scale={100} digits={1} unit="%"
            onStart={pushHistory} onLive={(v) => updateTransformLive(clip.id, { scale: v })} />
          {clip.kind !== 'text' && (
            <FxRow label="Rotasi" value={clip.transform.rotation} min={-180} max={180} step={0.5} digits={1} unit="°"
              onStart={pushHistory} onLive={(v) => updateTransformLive(clip.id, { rotation: v })} />
          )}
          {track.kind === 'video' && clip.kind !== 'text' && (
            <p className="hint" style={{ marginTop: 6 }}>Klip di track dasar selalu memenuhi bingkai. Posisi dan skala berlaku untuk klip di track video atas (V2 dan seterusnya).</p>
          )}
        </FxSection>
      )}

      {showTransform && (
        <FxSection title="Opasitas" onReset={() => updateTransform(clip.id, { opacity: 1 })}>
          <FxRow label="Opasitas" value={clip.transform.opacity} min={0} max={1} step={0.005} scale={100} digits={1} unit="%"
            onStart={pushHistory} onLive={(v) => updateTransformLive(clip.id, { opacity: v })} />
        </FxSection>
      )}

      <FxSection title="Waktu">
        <div className="fx-row">
          <span className="fx-name">Mulai</span>
          <TcInput value={clip.start} fps={fps} label="Waktu mulai klip"
            onCommit={(v) => st.moveClip(clip.id, track.id, v)} />
          <span />
        </div>
        {(clip.kind === 'video' || clip.kind === 'audio') && (
          <div className="fx-row">
            <span className="fx-name">Kecepatan</span>
            <select className="select" value={String(clip.speed)} aria-label="Kecepatan klip"
              onChange={(e) => {
                const ns = parseFloat(e.target.value);
                updateClip(clip.id, { speed: ns, duration: (clip.duration * clip.speed) / ns });
              }}>
              {[...new Set([...SPEED_CHOICES, clip.speed])].sort((a, b) => a - b).map((v) => <option key={v} value={String(v)}>{Math.round(v * 100)}%</option>)}
            </select>
            <span />
          </div>
        )}
        <label className="fx-row" style={{ cursor: 'pointer' }}>
          <span className="fx-name">Aktif</span>
          <input type="checkbox" checked={!clip.disabled} onChange={(e) => st.setClipsDisabled([clip.id], !e.target.checked)} />
          <span className="hint">Shift+E</span>
        </label>
      </FxSection>

      {clip.kind === 'text' && ts && (
        <FxSection title="Teks">
          <div className="field">
            <textarea className="textarea" rows={3} value={clip.text ?? ''} aria-label="Isi teks"
              onChange={(e) => updateClip(clip.id, { text: e.target.value })} />
          </div>
          <div className="field-row" style={{ marginBottom: 8 }}>
            <select className="select" value={ts.fontFamily} aria-label="Font" onChange={(e) => updateTextStyle(clip.id, { fontFamily: e.target.value })}>
              {FONT_CHOICES.map((f) => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
            </select>
            <input type="number" className="input" min={12} max={200} value={ts.fontSize} aria-label="Ukuran huruf"
              onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) updateTextStyle(clip.id, { fontSize: Math.min(200, Math.max(12, v)) }); }} />
            <input type="color" className="input" value={ts.color} aria-label="Warna huruf" onChange={(e) => updateTextStyle(clip.id, { color: e.target.value })} />
          </div>
          <div className="field-row" style={{ marginBottom: 8 }}>
            <button className={`btn btn-sm ${ts.bold ? 'active' : ''}`} style={{ fontWeight: 800 }} aria-pressed={ts.bold} title="Tebal" onClick={() => updateTextStyle(clip.id, { bold: !ts.bold })}>B</button>
            <button className={`btn btn-sm ${ts.italic ? 'active' : ''}`} style={{ fontStyle: 'italic' }} aria-pressed={ts.italic} title="Miring" onClick={() => updateTextStyle(clip.id, { italic: !ts.italic })}>I</button>
            <span style={{ flex: 1 }} />
            <span className="fx-name">Garis tepi</span>
            <input type="color" className="input" value={ts.outlineColor} aria-label="Warna garis tepi" onChange={(e) => updateTextStyle(clip.id, { outlineColor: e.target.value })} />
            <input type="number" className="input" style={{ width: 52 }} min={0} max={10} value={ts.outlineWidth} aria-label="Tebal garis tepi"
              onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) updateTextStyle(clip.id, { outlineWidth: Math.min(10, Math.max(0, v)) }); }} />
          </div>
          <label className="field-row" style={{ cursor: 'pointer', marginBottom: 6 }}>
            <span className="field-label">Latar</span>
            <input type="checkbox" checked={ts.backgroundColor !== undefined} onChange={(e) => updateTextStyle(clip.id, { backgroundColor: e.target.checked ? '#000000' : undefined })} />
            {ts.backgroundColor !== undefined && <input type="color" className="input" value={ts.backgroundColor} aria-label="Warna latar" onChange={(e) => updateTextStyle(clip.id, { backgroundColor: e.target.value })} />}
          </label>
          <label className="field-row" style={{ cursor: 'pointer' }}>
            <span className="field-label">Bayangan</span>
            <input type="checkbox" checked={ts.shadow} onChange={(e) => updateTextStyle(clip.id, { shadow: e.target.checked })} />
          </label>
        </FxSection>
      )}

      <FxSection title="Transisi keluar" defaultOpen={!!tr}>
        {tr ? (
          <>
            <div className="fx-row">
              <span className="fx-name">Jenis</span>
              <select className="select" value={tr.type} aria-label="Jenis transisi"
                onChange={(e) => { const t = e.target.value as TransitionType; setTransition(clip.id, t === 'none' ? undefined : { type: t, duration: tr.duration }); }}>
                {TRANSITION_PRESETS.map((p) => <option key={p.type} value={p.type}>{p.name}</option>)}
              </select>
              <span />
            </div>
            <FxRow label="Durasi" value={tr.duration} min={0.1} max={3} step={1 / fps} digits={2} unit=" dtk"
              onStart={pushHistory} onLive={(v) => updateClipLive(clip.id, { transitionOut: { type: tr.type, duration: v } })} />
            <p className="hint">Berlaku menuju klip berikutnya yang bersebelahan di track yang sama.</p>
          </>
        ) : (
          <button className="btn btn-sm" onClick={() => setTransition(clip.id, { type: 'fade', duration: 0.5 })}>
            <Icon name="plus" size={12} /> Tambah transisi
          </button>
        )}
      </FxSection>
    </div>
  );
}

function TcInput({ value, fps, label, onCommit }: { value: number; fps: number; label: string; onCommit(v: number): void }) {
  const [text, setText] = useState<string | null>(null);
  return (
    <input className="input tc" value={text ?? toTimecode(value, fps)} aria-label={label}
      onFocus={(e) => { setText(toTimecode(value, fps)); requestAnimationFrame(() => e.target.select()); }}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => { const t = text !== null ? parseTimecode(text, fps, value) : null; if (t !== null) onCommit(t); setText(null); }}
      onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { setText(null); e.currentTarget.blur(); } }} />
  );
}

// ============================================================
// Warna (koreksi per klip, gaya panel Lumetri)
// ============================================================

function ColorPanel() {
  const sel = useSelectedClip();
  const project = useProject((s) => s.project);
  const { pushHistory, updateEffects, updateEffectsLive } = useProject.getState();
  if (!sel || (sel.clip.kind !== 'video' && sel.clip.kind !== 'image')) return <NoClip what="warna (klip video atau gambar)" />;
  const { clip, track } = sel;
  const fx = clip.effects;
  const live = (patch: Partial<ClipEffects>) => updateEffectsLive(clip.id, { ...patch, presetId: undefined });

  const applyAll = () => {
    const ids: string[] = [];
    for (const t of project.tracks) if (t.kind !== 'audio' && !t.locked) for (const c of t.clips) if (c.kind === 'video' || c.kind === 'image') ids.push(c.id);
    pushHistory();
    for (const id of ids) updateEffectsLive(id, { ...fx });
    useUi.getState().showToast(`Pengaturan warna disalin ke ${ids.length} klip.`);
  };

  return (
    <div>
      <ClipHeader clip={clip} track={track} />
      <FxSection title="Koreksi dasar" onReset={() => updateEffects(clip.id, { brightness: 0, contrast: 1, saturation: 1, temperature: 0, hue: 0, presetId: undefined })}>
        <FxRow label="Suhu" value={fx.temperature} min={-1} max={1} step={0.01} scale={100} digits={0}
          onStart={pushHistory} onLive={(v) => live({ temperature: v })} />
        <FxRow label="Pencahayaan" value={fx.brightness} min={-1} max={1} step={0.01} scale={100} digits={0}
          onStart={pushHistory} onLive={(v) => live({ brightness: v })} />
        <FxRow label="Kontras" value={fx.contrast} min={0} max={2} step={0.01} scale={100} digits={0} unit="%"
          onStart={pushHistory} onLive={(v) => live({ contrast: v })} />
        <FxRow label="Saturasi" value={fx.saturation} min={0} max={2} step={0.01} scale={100} digits={0} unit="%"
          onStart={pushHistory} onLive={(v) => live({ saturation: v })} />
        <FxRow label="Rona" value={fx.hue} min={-180} max={180} step={1} digits={0} unit="°"
          onStart={pushHistory} onLive={(v) => live({ hue: v })} />
      </FxSection>
      <FxSection title="Kreatif" onReset={() => updateEffects(clip.id, { ...DEFAULT_EFFECTS })}>
        <div className="field-label" style={{ marginBottom: 6 }}>Tampilan (look)</div>
        <div className="card-grid" style={{ marginBottom: 10 }}>
          {COLOR_GRADE_PRESETS.map((p) => (
            <button key={p.id} className={`card ${fx.presetId === p.id ? 'selected' : ''}`} style={{ padding: 5, color: 'inherit', font: 'inherit' }}
              aria-pressed={fx.presetId === p.id} title={`Terapkan tampilan "${p.name}"`} onClick={() => updateEffects(clip.id, { ...p.effects })}>
              <div style={{ height: 30, borderRadius: 2, background: p.swatch, marginBottom: 4 }} />
              <div style={{ fontSize: 10.5, color: 'var(--muted)' }}>{p.name}</div>
            </button>
          ))}
        </div>
        <FxRow label="Vinyet" value={fx.vignette} min={0} max={1} step={0.01} scale={100} digits={0}
          onStart={pushHistory} onLive={(v) => live({ vignette: v })} />
        <FxRow label="Blur" value={fx.blur} min={0} max={20} step={0.5} digits={1} unit=" px"
          onStart={pushHistory} onLive={(v) => live({ blur: v })} />
      </FxSection>
      <div className="panel-body" style={{ paddingTop: 10 }}>
        <button className="btn" style={{ width: '100%' }} onClick={applyAll} title="Salin semua pengaturan warna klip ini ke klip video dan gambar lain">
          Salin ke semua klip video
        </button>
      </div>
    </div>
  );
}

// ============================================================
// Audio
// ============================================================

function AudioPanel() {
  const sel = useSelectedClip();
  const project = useProject((s) => s.project);
  const { pushHistory, updateClip, updateClipLive, toggleTrackMuted, toggleTrackSolo } = useProject.getState();
  const asset = sel?.clip.assetId ? project.assets.find((a) => a.id === sel.clip.assetId) : undefined;
  const hasAudio = sel && (sel.clip.kind === 'audio' || (sel.clip.kind === 'video' && asset?.hasAudio));
  const db = (v: number) => (v <= 0.0001 ? '-∞' : (20 * Math.log10(v)).toFixed(1));

  return (
    <div>
      {sel && hasAudio ? (
        <>
          <ClipHeader clip={sel.clip} track={sel.track} />
          <FxSection title="Volume klip" onReset={() => updateClip(sel.clip.id, { volume: 1, muted: false })}>
            <FxRow label="Level" value={sel.clip.volume} min={0} max={2} step={0.01} scale={100} digits={0} unit="%"
              onStart={pushHistory} onLive={(v) => updateClipLive(sel.clip.id, { volume: v })} />
            <div className="fx-row"><span className="fx-name">Dalam dB</span><span className="hint" style={{ fontFamily: 'var(--mono)' }}>{db(sel.clip.volume)} dB</span><span /></div>
            <label className="fx-row" style={{ cursor: 'pointer' }}>
              <span className="fx-name">Bisu</span>
              <input type="checkbox" checked={sel.clip.muted} onChange={(e) => updateClip(sel.clip.id, { muted: e.target.checked })} />
              <span />
            </label>
          </FxSection>
        </>
      ) : (
        <NoClip what="volume (klip audio atau video bersuara)" />
      )}
      <div className="panel-title">Track audio</div>
      <div className="panel-body">
        {project.tracks.filter((t) => t.kind === 'audio').map((t) => (
          <div key={t.id} className="row" style={{ padding: '4px 0', borderBottom: '1px solid #303030' }}>
            <span style={{ flex: 1, fontWeight: 600 }}>{t.name}</span>
            <span className="hint">{t.clips.length} klip</span>
            <button className={`icon-btn warn ${t.muted ? 'on' : ''}`} aria-pressed={t.muted} aria-label={`Bisu ${t.name}`} title="Bisukan track" onClick={() => toggleTrackMuted(t.id)} style={{ fontWeight: 700, fontSize: 11 }}>M</button>
            <button className={`icon-btn ${t.solo ? 'on' : ''}`} aria-pressed={!!t.solo} aria-label={`Solo ${t.name}`} title="Solo" onClick={() => toggleTrackSolo(t.id)} style={{ fontWeight: 700, fontSize: 11 }}>S</button>
          </div>
        ))}
        <p className="hint" style={{ marginTop: 8 }}>Solo berlaku juga saat ekspor: bila ada track ber-solo, hanya track itu yang ikut dirender.</p>
      </div>
    </div>
  );
}

// ============================================================
// Caption (subtitle)
// ============================================================

function CaptionsPanel() {
  const subtitles = useProject((s) => s.project.subtitles);
  const subtitleStyle = useProject((s) => s.project.subtitleStyle);
  const showSubtitles = useProject((s) => s.project.showSubtitles);
  const fps = useProject((s) => s.project.fps);
  const selectedSubtitleId = useUi((s) => s.selectedSubtitleId);
  const { addSubtitle, updateSubtitle, removeSubtitle, setSubtitleStyle, setShowSubtitles } = useProject.getState();
  const cues = [...subtitles].sort((a, b) => a.start - b.start);
  const seekTo = (t: number) => useUi.getState().setCurrentTime(t);

  return (
    <div>
      <div className="panel-title" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ flex: 1 }}>Caption · {cues.length} baris</span>
        <label className="row" style={{ cursor: 'pointer', gap: 5, fontWeight: 400 }}>
          <input type="checkbox" checked={showSubtitles} onChange={(e) => setShowSubtitles(e.target.checked)} />
          <span className="hint">Tampilkan</span>
        </label>
      </div>
      <div className="panel-body">
        <div className="field-row" style={{ marginBottom: 8 }}>
          <select className="select" value={subtitleStyle.fontFamily} aria-label="Font caption" onChange={(e) => setSubtitleStyle({ fontFamily: e.target.value })}>
            {FONT_CHOICES.map((f) => <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>)}
          </select>
          <input type="number" className="input" min={12} max={200} value={subtitleStyle.fontSize} aria-label="Ukuran caption"
            onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) setSubtitleStyle({ fontSize: Math.min(200, Math.max(12, v)) }); }} />
          <input type="color" className="input" value={subtitleStyle.color} aria-label="Warna caption" onChange={(e) => setSubtitleStyle({ color: e.target.value })} />
        </div>
        <div className="field-row" style={{ marginBottom: 10 }}>
          <span className="field-label">Garis tepi</span>
          <input type="color" className="input" value={subtitleStyle.outlineColor} aria-label="Warna garis tepi caption" onChange={(e) => setSubtitleStyle({ outlineColor: e.target.value })} />
          <input type="number" className="input" style={{ width: 52 }} min={0} max={10} value={subtitleStyle.outlineWidth} aria-label="Tebal garis tepi caption"
            onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) setSubtitleStyle({ outlineWidth: Math.min(10, Math.max(0, v)) }); }} />
        </div>
        <button className="btn btn-primary" style={{ width: '100%', marginBottom: 10 }}
          onClick={() => { const t = useUi.getState().currentTime; addSubtitle({ start: t, end: t + 2, text: 'Teks caption' }); }}>
          <Icon name="plus" size={12} /> Tambah di playhead
        </button>
        {cues.length === 0 ? (
          <div className="empty-state">
            Belum ada caption. Buka tab <b>AI</b> di panel kiri untuk membuat caption otomatis dari suara,
            atau tambah baris manual lewat tombol di atas.
          </div>
        ) : cues.map((cue) => {
          const selected = cue.id === selectedSubtitleId;
          return (
            <div key={cue.id} className={`card ${selected ? 'selected' : ''}`} style={{ marginBottom: 6 }}
              onClick={() => { useUi.getState().selectSubtitle(cue.id); seekTo(cue.start); }}>
              <div className="row" style={{ marginBottom: 5 }} onClick={(e) => e.stopPropagation()}>
                <TcInput value={cue.start} fps={fps} label="Mulai caption" onCommit={(v) => updateSubtitle(cue.id, { start: v })} />
                <TcInput value={cue.end} fps={fps} label="Akhir caption" onCommit={(v) => updateSubtitle(cue.id, { end: v })} />
                <button className="icon-btn" title="Hapus caption" aria-label="Hapus caption"
                  onClick={() => { removeSubtitle(cue.id); if (selected) useUi.getState().selectSubtitle(null); }}>
                  <Icon name="trash" size={13} />
                </button>
              </div>
              <textarea className="textarea" rows={2} style={{ minHeight: 34 }} value={cue.text} aria-label="Teks caption"
                onClick={(e) => e.stopPropagation()} onChange={(e) => updateSubtitle(cue.id, { text: e.target.value })} />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ============================================================

export default function Inspector() {
  const tab = useUi((s) => s.rightTab);
  if (tab === 'color') return <ColorPanel />;
  if (tab === 'audio') return <AudioPanel />;
  if (tab === 'captions') return <CaptionsPanel />;
  return <EffectControls />;
}
