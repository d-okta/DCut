// Panel Penanda: daftar penanda sequence, ubah nama/warna/catatan, lompat, hapus.
import { useProject } from '../../store/projectStore';
import { useUi } from '../../store/uiStore';
import { MARKER_COLORS, toTimecode } from '../../types';
import Icon from '../Icon';

export default function MarkersPanel() {
  const markers = useProject((s) => s.project.markers ?? []);
  const fps = useProject((s) => s.project.fps);
  const { addMarker, updateMarker, removeMarker } = useProject.getState();
  const currentTime = useUi((s) => s.currentTime);
  const setCurrentTime = useUi((s) => s.setCurrentTime);

  return (
    <div>
      <div className="panel-title" style={{ display: 'flex', alignItems: 'center' }}>
        <span style={{ flex: 1 }}>Penanda sequence</span>
        <button className="btn btn-sm" onClick={() => addMarker(currentTime)} title="Tambah penanda di playhead (M)">
          <Icon name="marker" size={12} /> Di playhead
        </button>
      </div>
      <div className="panel-body">
        {markers.length === 0 ? (
          <div className="empty-state">
            Belum ada penanda. Tekan <kbd>M</kbd> saat memutar untuk menandai momen penting,
            lalu <kbd>Shift</kbd> + <kbd>M</kbd> untuk melompat ke penanda berikutnya.
          </div>
        ) : markers.map((m) => (
          <div key={m.id} className="card" style={{ marginBottom: 6, cursor: 'default' }}>
            <div className="row" style={{ marginBottom: 6 }}>
              <button className="tc-display" style={{ fontSize: 12 }} onClick={() => setCurrentTime(m.time)} title="Lompat ke penanda">
                {toTimecode(m.time, fps)}
              </button>
              <input className="input" value={m.name} aria-label="Nama penanda"
                onChange={(e) => updateMarker(m.id, { name: e.target.value })} />
              <button className="icon-btn" aria-label={`Hapus ${m.name}`} title="Hapus penanda" onClick={() => removeMarker(m.id)}>
                <Icon name="trash" size={13} />
              </button>
            </div>
            <div className="row" style={{ marginBottom: 6, gap: 4 }} role="radiogroup" aria-label="Warna penanda">
              {MARKER_COLORS.map((c) => (
                <button key={c} role="radio" aria-checked={m.color === c} aria-label={`Warna ${c}`}
                  onClick={() => updateMarker(m.id, { color: c })}
                  style={{ width: 18, height: 18, borderRadius: 2, background: c, border: m.color === c ? '2px solid #fff' : '1px solid #000', cursor: 'pointer' }} />
              ))}
            </div>
            <textarea className="textarea" rows={2} style={{ minHeight: 34 }} placeholder="Catatan (opsional)" value={m.comment ?? ''}
              aria-label="Catatan penanda" onChange={(e) => updateMarker(m.id, { comment: e.target.value })} />
          </div>
        ))}
      </div>
    </div>
  );
}
