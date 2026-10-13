// ============================================================
// Panel "Efek & Color Grading" - preset color grade untuk klip.
// Klik preset -> terapkan ke klip terpilih. Tombol "Terapkan ke
// semua klip video" mengulang preset terakhir ke seluruh klip
// video/gambar (satu langkah undo).
// ============================================================
import { useMemo, useState } from 'react';
import { useProject } from '../../store/projectStore';
import { useUi } from '../../store/uiStore';
import { COLOR_GRADE_PRESETS, ColorGradePreset } from '../../presets/colorGrades';
import type { Clip } from '../../types';

export default function EffectsPanel() {
  const project = useProject((s) => s.project);
  const updateEffects = useProject((s) => s.updateEffects);
  const updateEffectsLive = useProject((s) => s.updateEffectsLive);
  const pushHistory = useProject((s) => s.pushHistory);
  const selectedClipId = useUi((s) => s.selectedClipId);
  const showToast = useUi((s) => s.showToast);

  // preset terakhir yang diklik - dipakai tombol "Terapkan ke semua"
  const [lastPresetId, setLastPresetId] = useState<string | null>(null);

  // klip terpilih (untuk menandai preset aktifnya)
  const selectedClip = useMemo<Clip | null>(() => {
    if (!selectedClipId) return null;
    for (const t of project.tracks) {
      const c = t.clips.find((x) => x.id === selectedClipId);
      if (c) return c;
    }
    return null;
  }, [project, selectedClipId]);

  const terapkan = (p: ColorGradePreset) => {
    if (!selectedClipId || !selectedClip) {
      showToast('Pilih klip di timeline terlebih dahulu');
      return;
    }
    updateEffects(selectedClipId, { ...p.effects });
    setLastPresetId(p.id);
    showToast(`Preset "${p.name}" diterapkan ke klip`);
  };

  /** Terapkan preset terakhir ke semua klip video/gambar di track video & overlay. */
  const terapkanSemua = () => {
    const preset = COLOR_GRADE_PRESETS.find((p) => p.id === lastPresetId);
    if (!preset) return;
    const targetIds: string[] = [];
    for (const t of project.tracks) {
      if (t.kind !== 'video' && t.kind !== 'overlay') continue;
      for (const c of t.clips) {
        if (c.kind === 'video' || c.kind === 'image') targetIds.push(c.id);
      }
    }
    if (!targetIds.length) {
      showToast('Tidak ada klip video/gambar di timeline');
      return;
    }
    // satu snapshot history untuk seluruh loop -> satu langkah undo
    pushHistory();
    for (const id of targetIds) updateEffectsLive(id, { ...preset.effects });
    showToast(`Preset "${preset.name}" diterapkan ke ${targetIds.length} klip`);
  };

  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div className="panel-title">Efek &amp; Color Grading</div>
      <div className="panel-body">
        <div className="card-grid">
          {COLOR_GRADE_PRESETS.map((p) => (
            <div
              key={p.id}
              className={`card ${selectedClip?.effects.presetId === p.id ? 'selected' : ''}`}
              title={`Terapkan preset "${p.name}"`}
              onClick={() => terapkan(p)}
            >
              <div
                style={{
                  height: 44,
                  borderRadius: 5,
                  background: p.swatch,
                  marginBottom: 6,
                }}
              />
              <div style={{ fontSize: 10.5, color: 'var(--muted)', textAlign: 'center' }}>{p.name}</div>
            </div>
          ))}
        </div>

        <div className="divider" />

        <button
          className="btn"
          style={{ width: '100%' }}
          disabled={!lastPresetId}
          onClick={terapkanSemua}
          title={lastPresetId ? 'Terapkan preset terakhir ke semua klip video/gambar' : 'Klik satu preset dulu'}
        >
          Terapkan ke semua klip video
        </button>

        <div className="divider" />
        <div className="hint">
          Butuh penyesuaian manual? Atur brightness, kontras, saturasi, temperatur, hue, blur,
          dan vignette lewat panel Inspector di sebelah kanan setelah klip dipilih.
        </div>
      </div>
    </div>
  );
}
