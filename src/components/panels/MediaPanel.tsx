// ============================================================
// Panel Media (media bin): impor, grid aset, drag ke timeline,
// double-click = tambah di playhead, hapus aset.
// ============================================================
import { useState } from 'react';
import type { DragEvent } from 'react';
import { useProject } from '../../store/projectStore';
import { useUi } from '../../store/uiStore';
import { importMediaFiles } from '../../utils/importMedia';
import type { MediaAsset } from '../../types';

const TYPE_ICON: Record<MediaAsset['type'], string> = {
  video: '🎬',
  audio: '🔊',
  image: '🖼',
};

/** Format detik -> mm:ss. */
function fmtDur(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export default function MediaPanel() {
  const assets = useProject((s) => s.project.assets);
  const showToast = useUi((s) => s.showToast);
  const [importing, setImporting] = useState(false);

  const onImport = async () => {
    if (importing) return;
    setImporting(true);
    try {
      const n = await importMediaFiles();
      showToast(n > 0 ? `${n} file media berhasil diimpor` : 'Tidak ada file dipilih');
    } catch {
      showToast('Gagal mengimpor media');
    } finally {
      setImporting(false);
    }
  };

  const onDragStart = (e: DragEvent, asset: MediaAsset) => {
    e.dataTransfer.setData('application/x-nusacut-asset', asset.id);
    e.dataTransfer.effectAllowed = 'copy';
  };

  /** Double-click: tambah ke track pertama yang cocok di posisi playhead. */
  const addToTimeline = (asset: MediaAsset) => {
    const { project, addClipFromAsset } = useProject.getState();
    const ui = useUi.getState();
    const wantedKind = asset.type === 'audio' ? 'audio' : 'video';
    const track = project.tracks.find((t) => t.kind === wantedKind);
    if (!track) {
      ui.showToast(wantedKind === 'audio' ? 'Tidak ada track audio di proyek' : 'Tidak ada track video di proyek');
      return;
    }
    const id = addClipFromAsset(track.id, asset.id, ui.currentTime);
    if (id) {
      ui.selectClip(id);
      ui.showToast(`"${asset.name}" ditambahkan ke ${track.name}`);
    } else {
      ui.showToast('Gagal menambahkan klip (track terkunci?)');
    }
  };

  const onRemove = (asset: MediaAsset) => {
    if (!window.confirm(`Hapus "${asset.name}"? Semua klip yang memakai aset ini juga akan dihapus.`)) return;
    useProject.getState().removeAsset(asset.id);
    showToast('Aset dihapus');
  };

  return (
    <div>
      <div className="panel-title">Media</div>
      <div className="panel-body">
        <button
          className="btn btn-primary"
          style={{ width: '100%', marginBottom: 12 }}
          onClick={onImport}
          disabled={importing}
        >
          {importing ? 'Mengimpor…' : '＋ Impor Media'}
        </button>

        {assets.length === 0 ? (
          <div className="empty-state">
            Belum ada media di proyek.
            <br />
            Klik <b>＋ Impor Media</b> untuk menambah video, audio, atau gambar.
            <div className="hint" style={{ marginTop: 10 }}>
              Seret aset ke timeline, atau klik dua kali untuk menambahkannya di posisi playhead.
            </div>
          </div>
        ) : (
          <div className="card-grid">
            {assets.map((asset) => (
              <div
                key={asset.id}
                className="card asset-card"
                draggable
                onDragStart={(e) => onDragStart(e, asset)}
                onDoubleClick={() => addToTimeline(asset)}
                title={`${asset.name}\nSeret ke timeline, atau klik dua kali untuk menambah di playhead.`}
              >
                <button
                  className="asset-remove"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(asset);
                  }}
                  title="Hapus aset"
                >
                  ×
                </button>
                <div className="asset-thumb">
                  {asset.thumbnail ? (
                    <img src={asset.thumbnail} alt={asset.name} draggable={false} />
                  ) : (
                    <span>{TYPE_ICON[asset.type]}</span>
                  )}
                </div>
                <div className="asset-name">{asset.name}</div>
                <div className="asset-dur">
                  {asset.type === 'image' ? 'Gambar' : fmtDur(asset.duration)}
                  {asset.hasAlpha && (
                    <span className="badge" style={{ marginLeft: 5 }} title="Video dengan alpha (transparansi)">
                      α
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
