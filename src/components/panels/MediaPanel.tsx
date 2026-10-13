// ============================================================
// Panel Proyek (bin media): impor, tampilan daftar / ikon, cari,
// urutkan. Klik dua kali = buka di Source Monitor; seret = ke timeline.
// ============================================================
import { useMemo, useState } from 'react';
import type { DragEvent } from 'react';
import { useProject } from '../../store/projectStore';
import { useUi } from '../../store/uiStore';
import { importMediaFiles } from '../../utils/importMedia';
import { toTimecode } from '../../types';
import type { MediaAsset } from '../../types';
import Icon from '../Icon';

const TYPE_LABEL: Record<MediaAsset['type'], string> = { video: 'Video', audio: 'Audio', image: 'Gambar' };
const TYPE_COLOR: Record<MediaAsset['type'], string> = { video: 'var(--clip-video)', audio: 'var(--clip-audio)', image: 'var(--clip-image)' };

type SortKey = 'name' | 'type' | 'duration' | 'res';

export default function MediaPanel() {
  const assets = useProject((s) => s.project.assets);
  const fps = useProject((s) => s.project.fps);
  const tracks = useProject((s) => s.project.tracks);
  const showToast = useUi((s) => s.showToast);
  const openInSource = useUi((s) => s.openInSource);
  const sourceId = useUi((s) => s.source?.assetId);
  const [importing, setImporting] = useState(false);
  const [view, setView] = useState<'list' | 'icon'>('list');
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'name', dir: 1 });
  const [selected, setSelected] = useState<string | null>(null);

  // Berapa kali tiap aset dipakai di sequence (kolom "Dipakai" seperti Premiere).
  const usage = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of tracks) for (const c of t.clips) if (c.assetId) m.set(c.assetId, (m.get(c.assetId) ?? 0) + 1);
    return m;
  }, [tracks]);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    const out = assets.filter((a) => !q || a.name.toLowerCase().includes(q));
    const val = (a: MediaAsset) =>
      sort.key === 'name' ? a.name.toLowerCase()
        : sort.key === 'type' ? a.type
          : sort.key === 'duration' ? a.duration
            : (a.width ?? 0) * (a.height ?? 0);
    return out.sort((x, y) => (val(x) < val(y) ? -1 : val(x) > val(y) ? 1 : 0) * sort.dir);
  }, [assets, query, sort]);

  const onImport = async () => {
    if (importing) return;
    setImporting(true);
    try {
      const n = await importMediaFiles();
      showToast(n > 0 ? `${n} file media diimpor.` : 'Tidak ada file dipilih.');
    } catch {
      showToast('Gagal mengimpor media.');
    } finally {
      setImporting(false);
    }
  };

  const onDragStart = (e: DragEvent, asset: MediaAsset) => {
    e.dataTransfer.setData('application/x-dcut-asset', asset.id);
    e.dataTransfer.effectAllowed = 'copy';
  };

  const onRemove = (asset: MediaAsset) => {
    const n = usage.get(asset.id) ?? 0;
    const msg = n ? `Hapus "${asset.name}"? ${n} klip di timeline yang memakainya ikut terhapus.` : `Hapus "${asset.name}" dari proyek?`;
    if (!window.confirm(msg)) return;
    useProject.getState().removeAsset(asset.id);
    setSelected(null);
    showToast('Media dihapus dari proyek.');
  };

  const sortBy = (key: SortKey) => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : 1 }));
  const arrow = (key: SortKey) => (sort.key === key ? (sort.dir === 1 ? ' ▲' : ' ▼') : '');
  const durText = (a: MediaAsset) => (a.type === 'image' ? 'Diam' : toTimecode(a.duration, fps));
  const sel = assets.find((a) => a.id === selected);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="bin-toolbar">
        <button className="btn btn-sm btn-primary" onClick={onImport} disabled={importing} title="Impor media (Ctrl+I)">
          <Icon name="plus" size={13} /> {importing ? 'Mengimpor…' : 'Impor'}
        </button>
        <div style={{ position: 'relative', flex: 1 }}>
          <span style={{ position: 'absolute', left: 7, top: 6, color: 'var(--muted)' }}><Icon name="search" size={13} /></span>
          <input className="input" style={{ paddingLeft: 26 }} placeholder="Cari media" value={query}
            onChange={(e) => setQuery(e.target.value)} aria-label="Cari media" />
        </div>
        <button className={`icon-btn ${view === 'list' ? 'on' : ''}`} title="Tampilan daftar" aria-label="Tampilan daftar" onClick={() => setView('list')}><Icon name="list" size={14} /></button>
        <button className={`icon-btn ${view === 'icon' ? 'on' : ''}`} title="Tampilan ikon" aria-label="Tampilan ikon" onClick={() => setView('icon')}><Icon name="grid" size={14} /></button>
        <button className="icon-btn" title="Hapus media terpilih" aria-label="Hapus media terpilih" disabled={!sel} onClick={() => sel && onRemove(sel)}><Icon name="trash" size={14} /></button>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        {assets.length === 0 ? (
          <div className="empty-state">
            Proyek ini belum punya media.
            <br />
            Klik <b>Impor</b> atau tekan <kbd>Ctrl</kbd> + <kbd>I</kbd> untuk menambah video, audio, atau gambar.
          </div>
        ) : list.length === 0 ? (
          <div className="empty-state">Tidak ada media yang namanya cocok dengan "{query}".</div>
        ) : view === 'list' ? (
          <table className="bin-list">
            <thead>
              <tr>
                <th onClick={() => sortBy('name')}>Nama{arrow('name')}</th>
                <th onClick={() => sortBy('type')}>Jenis{arrow('type')}</th>
                <th onClick={() => sortBy('duration')} style={{ textAlign: 'right' }}>Durasi{arrow('duration')}</th>
                <th onClick={() => sortBy('res')} style={{ textAlign: 'right' }}>Ukuran{arrow('res')}</th>
                <th style={{ textAlign: 'right' }}>Dipakai</th>
              </tr>
            </thead>
            <tbody>
              {list.map((a) => (
                <tr
                  key={a.id}
                  className={selected === a.id ? 'sel' : ''}
                  draggable
                  onDragStart={(e) => onDragStart(e, a)}
                  onClick={() => setSelected(a.id)}
                  onDoubleClick={() => openInSource(a.id)}
                  title={`${a.name}\nKlik dua kali: buka di Source Monitor. Seret: taruh di timeline.`}
                >
                  <td><span className="swatch" style={{ background: TYPE_COLOR[a.type] }} />{a.name}{a.hasAlpha && <span className="badge" style={{ marginLeft: 6 }} title="Video dengan saluran alfa (latar transparan)">alfa</span>}{sourceId === a.id && <span className="badge" style={{ marginLeft: 6 }}>di Source</span>}</td>
                  <td>{TYPE_LABEL[a.type]}</td>
                  <td className="num">{durText(a)}</td>
                  <td className="num">{a.width && a.height ? `${a.width}×${a.height}` : '-'}</td>
                  <td className="num">{usage.get(a.id) ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="bin-grid">
            {list.map((a) => (
              <div
                key={a.id}
                className={`bin-tile ${selected === a.id ? 'sel' : ''}`}
                draggable
                onDragStart={(e) => onDragStart(e, a)}
                onClick={() => setSelected(a.id)}
                onDoubleClick={() => openInSource(a.id)}
                title={`${a.name}\nKlik dua kali: buka di Source Monitor.`}
              >
                <div className="asset-thumb">
                  {a.thumbnail ? <img src={a.thumbnail} alt="" draggable={false} /> : <Icon name={a.type === 'audio' ? 'wave' : a.type === 'image' ? 'image' : 'film'} size={26} />}
                  <span className="dur">{durText(a)}</span>
                </div>
                <div className="asset-name">{a.name}</div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="hint" style={{ padding: '5px 10px', borderTop: '1px solid #1c1c1c' }}>
        {assets.length} media{sel ? ` · ${sel.name}` : ''}
      </div>
    </div>
  );
}
