// ============================================================
// Panel "Transisi" - terapkan transisi ke AKHIR klip terpilih
// (perpindahan ke klip berikutnya yang bersebelahan di track sama).
// ============================================================
import { useMemo, useState } from 'react';
import { useProject } from '../../store/projectStore';
import { useUi } from '../../store/uiStore';
import { TRANSITION_PRESETS, TransitionPreset } from '../../presets/transitions';
import type { Clip, TransitionType } from '../../types';

export default function TransitionsPanel() {
  const project = useProject((s) => s.project);
  const setTransition = useProject((s) => s.setTransition);
  const selectedClipId = useUi((s) => s.selectedClipId);
  const showToast = useUi((s) => s.showToast);

  // durasi transisi (state lokal panel, bukan bagian proyek)
  const [duration, setDuration] = useState(0.8);

  // klip yang sedang terpilih (untuk menandai transisi aktif)
  const selectedClip = useMemo<Clip | null>(() => {
    if (!selectedClipId) return null;
    for (const t of project.tracks) {
      const c = t.clips.find((x) => x.id === selectedClipId);
      if (c) return c;
    }
    return null;
  }, [project, selectedClipId]);

  // transisi aktif klip terpilih; tanpa transisi = 'none'
  const activeType: TransitionType | null = selectedClip
    ? selectedClip.transitionOut?.type ?? 'none'
    : null;

  const terapkan = (p: TransitionPreset) => {
    if (!selectedClipId) {
      showToast('Pilih klip di timeline terlebih dahulu');
      return;
    }
    if (p.type === 'none') {
      setTransition(selectedClipId, undefined);
      showToast('Transisi dihapus dari klip');
    } else {
      setTransition(selectedClipId, { type: p.type, duration });
      showToast(`Transisi "${p.name}" diterapkan ke akhir klip`);
    }
  };

  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div className="panel-title">Transisi</div>
      <div className="panel-body">
        <div className="field">
          <div className="field-label">Durasi</div>
          <div className="field-row">
            <input
              type="range"
              className="slider"
              min={0.2}
              max={2.0}
              step={0.1}
              value={duration}
              onChange={(e) => setDuration(parseFloat(e.target.value))}
            />
            <span style={{ fontVariantNumeric: 'tabular-nums', minWidth: 46, textAlign: 'right' }}>
              {duration.toFixed(1)} dtk
            </span>
          </div>
        </div>

        <div className="card-grid">
          {TRANSITION_PRESETS.map((p) => (
            <div
              key={p.type}
              className={`card ${activeType === p.type ? 'selected' : ''}`}
              title={p.name}
              onClick={() => terapkan(p)}
              style={{ textAlign: 'center' }}
            >
              <div style={{ fontSize: 22, lineHeight: '30px' }}>{p.icon}</div>
              <div style={{ fontSize: 10.5, color: 'var(--muted)', marginTop: 4 }}>{p.name}</div>
            </div>
          ))}
        </div>

        <div className="divider" />
        <div className="hint">
          Transisi berlaku pada perpindahan dari klip yang dipilih ke klip BERIKUTNYA yang
          bersebelahan di track yang sama. Pilih klip di timeline, lalu klik salah satu preset
          di atas.
        </div>
      </div>
    </div>
  );
}
