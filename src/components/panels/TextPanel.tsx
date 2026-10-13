// ============================================================
// Panel "Teks" - tambah klip teks & preset gaya teks.
// Klip teks ditempatkan di track overlay pertama (fallback: video
// track pertama) pada posisi playhead.
// ============================================================
import type { CSSProperties } from 'react';
import { useProject } from '../../store/projectStore';
import { useUi } from '../../store/uiStore';
import { TEXT_STYLE_PRESETS, TextStylePreset } from '../../presets/textStyles';
import type { TextStyle } from '../../types';

/** Gaya inline untuk contoh teks kartu preset (ukuran dikecilkan ~18px). */
function sampleStyle(st: TextStyle): CSSProperties {
  return {
    fontFamily: st.fontFamily,
    fontSize: 18,
    color: st.color,
    fontWeight: st.bold ? 700 : 400,
    fontStyle: st.italic ? 'italic' : 'normal',
    lineHeight: 1.3,
    // outline sederhana via text-shadow 4 arah; kalau tanpa outline pakai drop shadow bila ada
    textShadow:
      st.outlineWidth > 0
        ? `-1px -1px 0 ${st.outlineColor}, 1px -1px 0 ${st.outlineColor}, -1px 1px 0 ${st.outlineColor}, 1px 1px 0 ${st.outlineColor}`
        : st.shadow
          ? '0 1px 3px rgba(0,0,0,.65)'
          : 'none',
    backgroundColor: st.backgroundColor ?? 'transparent',
    padding: st.backgroundColor ? '1px 6px' : undefined,
    borderRadius: st.backgroundColor ? 3 : undefined,
    display: 'inline-block',
    whiteSpace: 'nowrap',
    maxWidth: '100%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  };
}

export default function TextPanel() {
  const project = useProject((s) => s.project);
  const addTextClip = useProject((s) => s.addTextClip);
  const updateClip = useProject((s) => s.updateClip);
  const currentTime = useUi((s) => s.currentTime);
  const selectClip = useUi((s) => s.selectClip);
  const showToast = useUi((s) => s.showToast);

  /** Tambah klip teks di playhead; opsional langsung terapkan preset. */
  const tambahTeks = (preset?: TextStylePreset) => {
    const track =
      project.tracks.find((t) => t.kind === 'overlay') ??
      project.tracks.find((t) => t.kind === 'video');
    if (!track) {
      showToast('Tidak ada track video untuk menaruh teks.');
      return;
    }
    const id = addTextClip(track.id, currentTime);
    if (!id) {
      showToast('Teks tidak bisa ditambahkan: track terkunci.');
      return;
    }
    if (preset) {
      updateClip(id, {
        textStyle: { ...preset.style },
        text: preset.id === 'judul' ? 'JUDUL ANDA' : 'Teks Anda',
      });
    }
    selectClip(id);
    showToast('Klip teks ditambahkan di playhead.');
  };

  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div className="panel-title">Grafis teks</div>
      <div className="panel-body">
        <button className="btn btn-primary" style={{ width: '100%' }} onClick={() => tambahTeks()}>
          Tambah teks di playhead
        </button>

        <div className="divider" />

        <div className="field-label" style={{ marginBottom: 8 }}>Preset Gaya</div>
        <div className="card-grid-lg">
          {TEXT_STYLE_PRESETS.map((p) => (
            <div
              key={p.id}
              className="card"
              title={`Tambah teks dengan gaya "${p.name}"`}
              onClick={() => tambahTeks(p)}
            >
              <div
                style={{
                  height: 44,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                  marginBottom: 6,
                }}
              >
                <span style={sampleStyle(p.style)}>Aa Teks</span>
              </div>
              <div style={{ fontSize: 11, color: 'var(--muted)', textAlign: 'center' }}>{p.name}</div>
            </div>
          ))}
        </div>

        <div className="divider" />
        <div className="hint">
          Klik klip teks di timeline, lalu edit isi &amp; gayanya (font, warna, outline, posisi)
          lewat panel Kontrol Efek di kanan atas.
        </div>
      </div>
    </div>
  );
}
