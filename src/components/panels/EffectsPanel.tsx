// ============================================================
// Panel Efek: daftar yang bisa dicari, berisi Transisi Video dan
// Tampilan Warna. Klik dua kali item = terapkan ke klip terpilih.
// ============================================================
import { useMemo, useState } from 'react';
import { useProject } from '../../store/projectStore';
import { useUi } from '../../store/uiStore';
import { COLOR_GRADE_PRESETS } from '../../presets/colorGrades';
import { TRANSITION_PRESETS } from '../../presets/transitions';
import { findSelected } from '../../commands';
import Icon from '../Icon';

export default function EffectsPanel() {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Record<string, boolean>>({ transisi: true, warna: true });
  const [duration, setDuration] = useState(0.8);
  const showToast = useUi((s) => s.showToast);
  useUi((s) => s.selectedClipId);
  useProject((s) => s.project);

  const query = q.trim().toLowerCase();
  const transitions = useMemo(() => TRANSITION_PRESETS.filter((p) => p.type !== 'none' && p.name.toLowerCase().includes(query)), [query]);
  const looks = useMemo(() => COLOR_GRADE_PRESETS.filter((p) => p.name.toLowerCase().includes(query)), [query]);
  const sel = findSelected();

  const applyTransition = (type: (typeof TRANSITION_PRESETS)[number]['type'], name: string) => {
    if (!sel) { showToast('Pilih klip di timeline dulu.'); return; }
    useProject.getState().setTransition(sel.clip.id, { type, duration });
    showToast(`Transisi "${name}" dipasang di akhir klip.`);
  };
  const applyLook = (id: string) => {
    const p = COLOR_GRADE_PRESETS.find((x) => x.id === id);
    if (!p) return;
    if (!sel || (sel.clip.kind !== 'video' && sel.clip.kind !== 'image')) { showToast('Pilih klip video atau gambar dulu.'); return; }
    useProject.getState().updateEffects(sel.clip.id, { ...p.effects });
    showToast(`Tampilan "${p.name}" diterapkan.`);
  };

  const Group = ({ id, title, count, children }: { id: string; title: string; count: number; children: React.ReactNode }) => (
    <div className="fx-section">
      <button className={`fx-head ${open[id] ? 'open' : ''}`} aria-expanded={!!open[id]} onClick={() => setOpen((s) => ({ ...s, [id]: !s[id] }))}>
        <span className="chev"><Icon name="chevron" size={12} /></span>
        <span>{title}</span>
        <span className="hint" style={{ marginLeft: 'auto', fontWeight: 400 }}>{count}</span>
      </button>
      {open[id] && <div>{children}</div>}
    </div>
  );

  const itemStyle = { display: 'flex', alignItems: 'center', gap: 8, width: '100%', padding: '5px 12px 5px 28px', background: 'transparent', border: 'none', color: 'var(--text)', font: 'inherit', fontSize: 12, cursor: 'pointer', textAlign: 'left' as const };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="bin-toolbar">
        <div style={{ position: 'relative', flex: 1 }}>
          <span style={{ position: 'absolute', left: 7, top: 6, color: 'var(--muted)' }}><Icon name="search" size={13} /></span>
          <input className="input" style={{ paddingLeft: 26 }} placeholder="Cari efek" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Cari efek" />
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <Group id="transisi" title="Transisi video" count={transitions.length}>
          <div className="fx-row" style={{ padding: '4px 12px 4px 28px' }}>
            <span className="fx-name">Durasi</span>
            <input type="range" className="slider" min={0.2} max={2} step={0.1} value={duration} aria-label="Durasi transisi"
              onChange={(e) => setDuration(parseFloat(e.target.value))} />
            <span className="hint" style={{ fontFamily: 'var(--mono)' }}>{duration.toFixed(1)} dtk</span>
          </div>
          {transitions.map((p) => (
            <button key={p.type} style={itemStyle} className="menu-item" onDoubleClick={() => applyTransition(p.type, p.name)}
              onKeyDown={(e) => { if (e.key === 'Enter') applyTransition(p.type, p.name); }}
              title="Klik dua kali atau Enter: pasang di akhir klip terpilih">
              <Icon name="fx" size={13} /> {p.name}
            </button>
          ))}
        </Group>
        <Group id="warna" title="Tampilan warna" count={looks.length}>
          {looks.map((p) => (
            <button key={p.id} style={itemStyle} className="menu-item" onDoubleClick={() => applyLook(p.id)}
              onKeyDown={(e) => { if (e.key === 'Enter') applyLook(p.id); }}
              title="Klik dua kali atau Enter: terapkan ke klip terpilih">
              <span style={{ width: 22, height: 12, borderRadius: 2, background: p.swatch, flex: 'none' }} /> {p.name}
            </button>
          ))}
        </Group>
        {transitions.length + looks.length === 0 && <div className="empty-state">Tidak ada efek bernama "{q}".</div>}
        <p className="hint" style={{ padding: 12 }}>
          {sel ? `Klip terpilih: ${sel.track.name}.` : 'Belum ada klip terpilih.'} Atur nilai efek lebih lanjut di Kontrol Efek dan Warna.
        </p>
      </div>
    </div>
  );
}
