// Panel bantuan pintasan keyboard (dibuka dengan ?, F1, atau tombol ⌨ di TopBar).
import type { CSSProperties } from 'react';
import { useUi } from '../store/uiStore';

interface Row { keys: string[]; desc: string }
interface Group { title: string; rows: Row[] }

const GROUPS: Group[] = [
  {
    title: 'Playback',
    rows: [
      { keys: ['Spasi'], desc: 'Putar / jeda' },
      { keys: ['K', 'L', 'J'], desc: 'Jeda / putar / mundur 1 detik' },
      { keys: ['←', '→'], desc: 'Mundur / maju 1 frame' },
      { keys: ['Shift', '←/→'], desc: 'Mundur / maju 1 detik' },
      { keys: ['↑', '↓'], desc: 'Lompat ke titik edit sebelumnya / berikutnya' },
      { keys: ['Home', 'End'], desc: 'Ke awal / akhir proyek' },
    ],
  },
  {
    title: 'Editing',
    rows: [
      { keys: ['S'], desc: 'Split klip terpilih di playhead (juga Ctrl+B)' },
      { keys: ['Q', 'W'], desc: 'Buang bagian kiri / kanan klip di playhead' },
      { keys: ['Delete'], desc: 'Hapus klip / subtitle terpilih' },
      { keys: ['M'], desc: 'Bisukan / bunyikan klip terpilih' },
      { keys: ['Ctrl', 'C'], desc: 'Salin klip terpilih' },
      { keys: ['Ctrl', 'X'], desc: 'Potong klip terpilih' },
      { keys: ['Ctrl', 'V'], desc: 'Tempel klip di playhead' },
      { keys: ['Ctrl', 'D'], desc: 'Gandakan klip terpilih' },
      { keys: ['Ctrl', 'Z'], desc: 'Undo' },
      { keys: ['Ctrl', 'Y'], desc: 'Redo (juga Ctrl+Shift+Z)' },
      { keys: ['Esc'], desc: 'Batalkan seleksi' },
    ],
  },
  {
    title: 'Tampilan & proyek',
    rows: [
      { keys: ['+', '-'], desc: 'Zoom timeline masuk / keluar (juga Ctrl+scroll)' },
      { keys: ['Ctrl', 'S'], desc: 'Simpan proyek' },
      { keys: ['Ctrl', 'O'], desc: 'Buka proyek' },
      { keys: ['Ctrl', 'E'], desc: 'Export video (juga Ctrl+M)' },
      { keys: ['?', 'F1'], desc: 'Buka / tutup panel bantuan ini' },
    ],
  },
];

const keyStyle: CSSProperties = {
  display: 'inline-block',
  minWidth: 22,
  padding: '2px 7px',
  borderRadius: 5,
  border: '1px solid var(--border-light)',
  background: 'var(--panel-3)',
  fontSize: 11.5,
  fontWeight: 700,
  textAlign: 'center',
  fontFamily: 'inherit',
};

export default function ShortcutHelp() {
  const open = useUi((s) => s.helpOpen);
  const setOpen = useUi((s) => s.setHelpOpen);
  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <div className="modal" style={{ width: 520 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>⌨ Pintasan Keyboard</span>
          <button className="btn btn-icon btn-ghost" onClick={() => setOpen(false)}>✕</button>
        </div>
        <div className="modal-body">
          {GROUPS.map((g) => (
            <div key={g.title} style={{ marginBottom: 14 }}>
              <div className="panel-title" style={{ padding: '0 0 6px' }}>{g.title}</div>
              {g.rows.map((r) => (
                <div key={r.desc} className="row" style={{ justifyContent: 'space-between', padding: '4px 0' }}>
                  <span style={{ color: 'var(--muted)', fontSize: 12.5 }}>{r.desc}</span>
                  <span className="row" style={{ gap: 4 }}>
                    {r.keys.map((k) => <kbd key={k} style={keyStyle}>{k}</kbd>)}
                  </span>
                </div>
              ))}
            </div>
          ))}
          <p className="hint">Pintasan tidak aktif saat sedang mengetik di kolom teks (kecuali Ctrl+S).</p>
        </div>
      </div>
    </div>
  );
}
