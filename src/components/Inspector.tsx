// ============================================================
// Inspector - panel kanan properti.
// - Ada klip terpilih  -> editor properti klip.
// - Tidak ada          -> editor subtitle (rumah utama pengelolaan cue).
//
// Aturan history: semua slider memakai aksi *Live saat digeser
// (onChange) + pushHistory() sekali di onPointerDown; input lain
// memakai aksi biasa (otomatis menyimpan history).
// ============================================================
import type { ReactNode } from 'react';
import { useProject } from '../store/projectStore';
import { useUi } from '../store/uiStore';
import {
  Clip, ClipKind, ClipEffects, TransitionType,
  DEFAULT_EFFECTS, DEFAULT_TRANSFORM,
} from '../types';
import { FONT_CHOICES } from '../presets/textStyles';
import { TRANSITION_PRESETS } from '../presets/transitions';

// ---------- util format ----------

const fmtSec = (v: number) => `${v.toFixed(2)} dtk`;
const fmtPct = (v: number) => `${Math.round(v * 100)}%`;
const fmtDeg = (v: number) => `${Math.round(v)}°`;
const fmtX = (v: number) => `${v.toFixed(2)}×`;
const fmtPx = (v: number) => `${Math.round(v)} px`;
const fmt2 = (v: number) => v.toFixed(2);

const KIND_LABEL: Record<ClipKind, string> = {
  video: 'Video', audio: 'Audio', image: 'Gambar', text: 'Teks',
};

const SPEED_CHOICES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4];

// ---------- komponen kecil ----------

/** Judul seksi + isi, memakai kelas design system. */
function Section({ title, extra, children }: { title: string; extra?: ReactNode; children: ReactNode }) {
  return (
    <>
      <div className="panel-title" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span>{title}</span>
        {extra}
      </div>
      <div className="panel-body">{children}</div>
    </>
  );
}

/** Slider berlabel: pushHistory di pointerdown, aksi Live saat digeser. */
function SliderField(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  onStart(): void;
  onLive(v: number): void;
}) {
  const { label, value, min, max, step = 0.01, format = fmt2, onStart, onLive } = props;
  return (
    <div className="field" style={{ marginBottom: 10 }}>
      <div className="field-row">
        <span className="field-label">{label}</span>
        <span className="hint" style={{ minWidth: 52, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
          {format(value)}
        </span>
      </div>
      <input
        type="range"
        className="slider"
        min={min}
        max={max}
        step={step}
        value={value}
        onPointerDown={onStart}
        onChange={(e) => onLive(parseFloat(e.target.value))}
      />
    </div>
  );
}

// ============================================================
// Editor KLIP
// ============================================================

function ClipInspector({ clip }: { clip: Clip }) {
  const assets = useProject((s) => s.project.assets);
  const {
    pushHistory, deleteClip, updateClip, updateClipLive,
    updateTransform, updateTransformLive, updateEffects, updateEffectsLive,
    updateTextStyle, setTransition,
  } = useProject.getState(); // aksi zustand bersifat stabil

  const asset = clip.assetId ? assets.find((a) => a.id === clip.assetId) : undefined;
  const name = clip.kind === 'text' ? (clip.text || 'Teks') : (asset?.name ?? '(aset hilang)');

  const showAudio = clip.kind === 'audio' || (clip.kind === 'video' && !!asset?.hasAudio);
  const showSpeed = clip.kind === 'video' || clip.kind === 'audio';
  const showTransform = clip.kind !== 'audio';
  const showEffects = clip.kind === 'video' || clip.kind === 'image';

  /** Perubahan efek manual mematikan preset color grade yang aktif. */
  const effLive = (patch: Partial<ClipEffects>) =>
    updateEffectsLive(clip.id, { ...patch, presetId: undefined });

  const tr = clip.transitionOut;
  const ts = clip.textStyle;

  return (
    <div>
      {/* ---------- header ---------- */}
      <div className="panel-body" style={{ paddingTop: 12 }}>
        <div className="row">
          <span className="badge">{KIND_LABEL[clip.kind]}</span>
          <span
            style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600 }}
            title={name}
          >
            {name}
          </span>
          <button
            className="btn btn-icon btn-ghost btn-danger"
            title="Hapus klip"
            onClick={() => { deleteClip(clip.id); useUi.getState().selectClip(null); }}
          >
            🗑
          </button>
        </div>
      </div>

      {/* ---------- waktu ---------- */}
      <Section title="Waktu">
        <div className="field-row" style={{ marginBottom: 6 }}>
          <span className="field-label">Mulai</span>
          <span className="hint" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtSec(clip.start)}</span>
        </div>
        <div className="field-row" style={{ marginBottom: showSpeed ? 10 : 0 }}>
          <span className="field-label">Durasi</span>
          <span className="hint" style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtSec(clip.duration)}</span>
        </div>
        {showSpeed && (
          <div className="field-row">
            <span className="field-label">Kecepatan</span>
            <select
              className="select"
              style={{ width: 90 }}
              value={String(clip.speed)}
              onChange={(e) => updateClip(clip.id, { speed: parseFloat(e.target.value) })}
            >
              {SPEED_CHOICES.map((v) => (
                <option key={v} value={String(v)}>{v}×</option>
              ))}
            </select>
          </div>
        )}
      </Section>

      {/* ---------- audio ---------- */}
      {showAudio && (
        <Section title="Audio">
          <SliderField
            label="Volume" value={clip.volume} min={0} max={2} step={0.01} format={fmtPct}
            onStart={pushHistory}
            onLive={(v) => updateClipLive(clip.id, { volume: v })}
          />
          <label className="field-row" style={{ cursor: 'pointer' }}>
            <span className="field-label">Bisu</span>
            <input
              type="checkbox"
              checked={clip.muted}
              onChange={(e) => updateClip(clip.id, { muted: e.target.checked })}
            />
          </label>
        </Section>
      )}

      {/* ---------- transform ---------- */}
      {showTransform && (
        <Section
          title="Transform"
          extra={
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => updateTransform(clip.id, { ...DEFAULT_TRANSFORM })}
            >
              Reset
            </button>
          }
        >
          <SliderField label="Posisi X" value={clip.transform.x} min={0} max={1} step={0.005}
            onStart={pushHistory} onLive={(v) => updateTransformLive(clip.id, { x: v })} />
          <SliderField label="Posisi Y" value={clip.transform.y} min={0} max={1} step={0.005}
            onStart={pushHistory} onLive={(v) => updateTransformLive(clip.id, { y: v })} />
          <SliderField label="Skala" value={clip.transform.scale} min={0.1} max={3} step={0.01} format={fmtX}
            onStart={pushHistory} onLive={(v) => updateTransformLive(clip.id, { scale: v })} />
          {/* Rotasi teks tidak didukung drawtext saat export - sembunyikan agar preview jujur */}
          {clip.kind !== 'text' && (
            <SliderField label="Rotasi" value={clip.transform.rotation} min={-180} max={180} step={1} format={fmtDeg}
              onStart={pushHistory} onLive={(v) => updateTransformLive(clip.id, { rotation: v })} />
          )}
          <SliderField label="Opasitas" value={clip.transform.opacity} min={0} max={1} step={0.01} format={fmtPct}
            onStart={pushHistory} onLive={(v) => updateTransformLive(clip.id, { opacity: v })} />
        </Section>
      )}

      {/* ---------- efek warna ---------- */}
      {showEffects && (
        <Section
          title="Efek Warna"
          extra={
            <button
              className="btn btn-sm btn-ghost"
              onClick={() => updateEffects(clip.id, { ...DEFAULT_EFFECTS, presetId: undefined })}
            >
              Reset
            </button>
          }
        >
          <SliderField label="Kecerahan" value={clip.effects.brightness} min={-1} max={1} step={0.01}
            onStart={pushHistory} onLive={(v) => effLive({ brightness: v })} />
          <SliderField label="Kontras" value={clip.effects.contrast} min={0} max={2} step={0.01}
            onStart={pushHistory} onLive={(v) => effLive({ contrast: v })} />
          <SliderField label="Saturasi" value={clip.effects.saturation} min={0} max={2} step={0.01}
            onStart={pushHistory} onLive={(v) => effLive({ saturation: v })} />
          <SliderField label="Suhu Warna" value={clip.effects.temperature} min={-1} max={1} step={0.01}
            onStart={pushHistory} onLive={(v) => effLive({ temperature: v })} />
          <SliderField label="Hue" value={clip.effects.hue} min={-180} max={180} step={1} format={fmtDeg}
            onStart={pushHistory} onLive={(v) => effLive({ hue: v })} />
          <SliderField label="Blur" value={clip.effects.blur} min={0} max={20} step={0.5} format={fmtPx}
            onStart={pushHistory} onLive={(v) => effLive({ blur: v })} />
          <SliderField label="Vignette" value={clip.effects.vignette} min={0} max={1} step={0.01} format={fmtPct}
            onStart={pushHistory} onLive={(v) => effLive({ vignette: v })} />
        </Section>
      )}

      {/* ---------- teks ---------- */}
      {clip.kind === 'text' && ts && (
        <Section title="Teks">
          <div className="field">
            <span className="field-label">Isi Teks</span>
            <textarea
              className="textarea"
              rows={3}
              value={clip.text ?? ''}
              onChange={(e) => updateClip(clip.id, { text: e.target.value })}
            />
          </div>

          <div className="field">
            <span className="field-label">Font</span>
            <select
              className="select"
              value={ts.fontFamily}
              onChange={(e) => updateTextStyle(clip.id, { fontFamily: e.target.value })}
            >
              {FONT_CHOICES.map((f) => (
                <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>
              ))}
            </select>
          </div>

          <div className="field-row" style={{ marginBottom: 12 }}>
            <span className="field-label">Ukuran</span>
            <input
              type="number"
              className="input"
              min={12}
              max={200}
              value={ts.fontSize}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v)) updateTextStyle(clip.id, { fontSize: Math.min(200, Math.max(12, v)) });
              }}
            />
            <span className="field-label" style={{ flex: 'none' }}>Warna</span>
            <input
              type="color"
              className="input"
              value={ts.color}
              onChange={(e) => updateTextStyle(clip.id, { color: e.target.value })}
            />
          </div>

          <div className="field-row" style={{ marginBottom: 12 }}>
            <button
              className={`btn btn-sm ${ts.bold ? 'active' : ''}`}
              style={{ fontWeight: 800 }}
              title="Tebal"
              onClick={() => updateTextStyle(clip.id, { bold: !ts.bold })}
            >
              B
            </button>
            <button
              className={`btn btn-sm ${ts.italic ? 'active' : ''}`}
              style={{ fontStyle: 'italic' }}
              title="Miring"
              onClick={() => updateTextStyle(clip.id, { italic: !ts.italic })}
            >
              I
            </button>
            <span style={{ flex: 1 }} />
            {(['left', 'center', 'right'] as const).map((a) => (
              <button
                key={a}
                className={`btn btn-sm ${ts.align === a ? 'active' : ''}`}
                title={a === 'left' ? 'Rata kiri' : a === 'center' ? 'Rata tengah' : 'Rata kanan'}
                onClick={() => updateTextStyle(clip.id, { align: a })}
              >
                {a === 'left' ? '⯇' : a === 'center' ? '≡' : '⯈'}
              </button>
            ))}
          </div>

          <div className="field-row" style={{ marginBottom: 12 }}>
            <span className="field-label">Outline</span>
            <input
              type="color"
              className="input"
              value={ts.outlineColor}
              onChange={(e) => updateTextStyle(clip.id, { outlineColor: e.target.value })}
            />
            <input
              type="number"
              className="input"
              min={0}
              max={10}
              value={ts.outlineWidth}
              onChange={(e) => {
                const v = Number(e.target.value);
                if (Number.isFinite(v)) updateTextStyle(clip.id, { outlineWidth: Math.min(10, Math.max(0, v)) });
              }}
            />
          </div>

          <label className="field-row" style={{ cursor: 'pointer', marginBottom: 8 }}>
            <span className="field-label">Latar belakang</span>
            <input
              type="checkbox"
              checked={ts.backgroundColor !== undefined}
              onChange={(e) =>
                updateTextStyle(clip.id, { backgroundColor: e.target.checked ? '#000000' : undefined })
              }
            />
            {ts.backgroundColor !== undefined && (
              <input
                type="color"
                className="input"
                value={ts.backgroundColor}
                onChange={(e) => updateTextStyle(clip.id, { backgroundColor: e.target.value })}
              />
            )}
          </label>

          <label className="field-row" style={{ cursor: 'pointer' }}>
            <span className="field-label">Bayangan</span>
            <input
              type="checkbox"
              checked={ts.shadow}
              onChange={(e) => updateTextStyle(clip.id, { shadow: e.target.checked })}
            />
          </label>
        </Section>
      )}

      {/* ---------- transisi keluar ---------- */}
      <Section title="Transisi Keluar">
        {tr ? (
          <>
            <div className="field">
              <span className="field-label">Jenis</span>
              <select
                className="select"
                value={tr.type}
                onChange={(e) => {
                  const t = e.target.value as TransitionType;
                  // pilihan 'none' = hapus transisi
                  setTransition(clip.id, t === 'none' ? undefined : { type: t, duration: tr.duration });
                }}
              >
                {TRANSITION_PRESETS.map((p) => (
                  <option key={p.type} value={p.type}>{p.icon} {p.name}</option>
                ))}
              </select>
            </div>
            <SliderField
              label="Durasi" value={tr.duration} min={0.2} max={2} step={0.05} format={fmtSec}
              onStart={pushHistory}
              onLive={(v) => updateClipLive(clip.id, { transitionOut: { type: tr.type, duration: v } })}
            />
            <div className="hint">Transisi berlaku menuju klip berikutnya yang bersebelahan di track yang sama.</div>
          </>
        ) : (
          <button
            className="btn btn-sm"
            onClick={() => setTransition(clip.id, { type: 'fade', duration: 0.5 })}
          >
            ＋ Tambah transisi
          </button>
        )}
      </Section>
    </div>
  );
}

// ============================================================
// Editor SUBTITLE (saat tidak ada klip terpilih)
// ============================================================

function SubtitleInspector() {
  const subtitles = useProject((s) => s.project.subtitles);
  const subtitleStyle = useProject((s) => s.project.subtitleStyle);
  const showSubtitles = useProject((s) => s.project.showSubtitles);
  const selectedSubtitleId = useUi((s) => s.selectedSubtitleId);
  const {
    addSubtitle, updateSubtitle, removeSubtitle, setSubtitleStyle, setShowSubtitles,
  } = useProject.getState();

  const cues = [...subtitles].sort((a, b) => a.start - b.start);

  const seekTo = (t: number) => useUi.getState().setCurrentTime(t);

  return (
    <div>
      {/* ---------- judul + toggle tampil ---------- */}
      <div
        className="panel-title"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}
      >
        <span>Subtitle</span>
        <label className="row" style={{ cursor: 'pointer', textTransform: 'none', letterSpacing: 0, fontWeight: 400, gap: 5 }}>
          <input
            type="checkbox"
            checked={showSubtitles}
            onChange={(e) => setShowSubtitles(e.target.checked)}
          />
          <span className="hint">Tampilkan subtitle</span>
        </label>
      </div>

      {/* ---------- gaya global ---------- */}
      <div className="panel-body">
        <div className="field">
          <span className="field-label">Font</span>
          <select
            className="select"
            value={subtitleStyle.fontFamily}
            onChange={(e) => setSubtitleStyle({ fontFamily: e.target.value })}
          >
            {FONT_CHOICES.map((f) => (
              <option key={f} value={f} style={{ fontFamily: f }}>{f}</option>
            ))}
          </select>
        </div>
        <div className="field-row" style={{ marginBottom: 12 }}>
          <span className="field-label">Ukuran</span>
          <input
            type="number"
            className="input"
            min={12}
            max={200}
            value={subtitleStyle.fontSize}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) setSubtitleStyle({ fontSize: Math.min(200, Math.max(12, v)) });
            }}
          />
          <span className="field-label" style={{ flex: 'none' }}>Warna</span>
          <input
            type="color"
            className="input"
            value={subtitleStyle.color}
            onChange={(e) => setSubtitleStyle({ color: e.target.value })}
          />
        </div>
        <div className="field-row">
          <span className="field-label">Outline</span>
          <input
            type="color"
            className="input"
            value={subtitleStyle.outlineColor}
            onChange={(e) => setSubtitleStyle({ outlineColor: e.target.value })}
          />
          <input
            type="number"
            className="input"
            min={0}
            max={10}
            value={subtitleStyle.outlineWidth}
            onChange={(e) => {
              const v = Number(e.target.value);
              if (Number.isFinite(v)) setSubtitleStyle({ outlineWidth: Math.min(10, Math.max(0, v)) });
            }}
          />
        </div>

        <div className="divider" />

        <button
          className="btn btn-primary"
          style={{ width: '100%', marginBottom: 12 }}
          onClick={() => {
            const t = useUi.getState().currentTime;
            addSubtitle({ start: t, end: t + 2, text: 'Teks subtitle' });
          }}
        >
          ＋ Tambah di playhead
        </button>

        {/* ---------- daftar cue ---------- */}
        {cues.length === 0 ? (
          <div className="empty-state">
            Belum ada subtitle.
            <br />
            Buka panel <b>AI ✨</b> untuk transkripsi otomatis,
            <br />
            atau tambah manual lewat tombol di atas.
            <div style={{ marginTop: 10 }}>
              <button
                className="btn btn-sm"
                onClick={() => {
                  const ui = useUi.getState();
                  ui.setActivePanel('ai');
                  ui.setAiTab('subtitle');
                }}
              >
                ✨ Buka panel AI
              </button>
            </div>
          </div>
        ) : (
          cues.map((cue) => {
            const selected = cue.id === selectedSubtitleId;
            return (
              <div
                key={cue.id}
                className={`card ${selected ? 'selected' : ''}`}
                style={{ marginBottom: 8 }}
                onClick={() => {
                  useUi.getState().selectSubtitle(cue.id);
                  seekTo(cue.start);
                }}
              >
                <div className="row" style={{ marginBottom: 6 }} onClick={(e) => e.stopPropagation()}>
                  <input
                    type="number"
                    className="input"
                    style={{ width: 62 }}
                    step={0.1}
                    min={0}
                    value={Number(cue.start.toFixed(2))}
                    title="Waktu mulai (detik)"
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v)) updateSubtitle(cue.id, { start: Math.max(0, v) });
                    }}
                  />
                  <span className="hint">→</span>
                  <input
                    type="number"
                    className="input"
                    style={{ width: 62 }}
                    step={0.1}
                    min={0}
                    value={Number(cue.end.toFixed(2))}
                    title="Waktu selesai (detik)"
                    onChange={(e) => {
                      const v = Number(e.target.value);
                      if (Number.isFinite(v)) updateSubtitle(cue.id, { end: Math.max(0, v) });
                    }}
                  />
                  <span style={{ flex: 1 }} />
                  <button
                    className="btn btn-icon btn-ghost"
                    title="Putar dari awal cue"
                    onClick={() => {
                      useUi.getState().selectSubtitle(cue.id);
                      seekTo(cue.start);
                    }}
                  >
                    ▶
                  </button>
                  <button
                    className="btn btn-icon btn-ghost btn-danger"
                    title="Hapus subtitle"
                    onClick={() => {
                      removeSubtitle(cue.id);
                      if (selected) useUi.getState().selectSubtitle(null);
                    }}
                  >
                    🗑
                  </button>
                </div>
                <textarea
                  className="textarea"
                  rows={2}
                  style={{ minHeight: 34 }}
                  value={cue.text}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => updateSubtitle(cue.id, { text: e.target.value })}
                />
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ============================================================
// Komponen utama
// ============================================================

export default function Inspector() {
  const project = useProject((s) => s.project);
  const selectedClipId = useUi((s) => s.selectedClipId);

  // cari klip terpilih di seluruh track
  let clip: Clip | null = null;
  if (selectedClipId) {
    for (const t of project.tracks) {
      const found = t.clips.find((c) => c.id === selectedClipId);
      if (found) { clip = found; break; }
    }
  }

  return clip ? <ClipInspector clip={clip} /> : <SubtitleInspector />;
}
