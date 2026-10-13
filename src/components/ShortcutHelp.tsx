// Panel Pintasan Keyboard: dibangun dari registry COMMANDS, bisa dicari.
// Dibuka dengan F1, Ctrl+Alt+K, atau menu Edit / Bantuan.
import { useEffect, useMemo, useRef, useState } from 'react';
import { COMMANDS, MENUS } from '../commands';
import { useUi } from '../store/uiStore';
import Icon from './Icon';

const GROUP_OTHER: Record<string, string> = { tool: 'Alat', play: 'Transport' };

export default function ShortcutHelp() {
  const open = useUi((s) => s.helpOpen);
  const setOpen = useUi((s) => s.setHelpOpen);
  const [q, setQ] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => { if (open) { setQ(''); setTimeout(() => inputRef.current?.focus(), 0); } }, [open]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, setOpen]);

  const groups = useMemo(() => {
    const query = q.trim().toLowerCase();
    const withKeys = COMMANDS.filter((c) => c.keys?.length && (!query || c.label.toLowerCase().includes(query) || c.keys.some((k) => k.toLowerCase().includes(query))));
    const out: { title: string; rows: typeof withKeys }[] = [];
    for (const prefix of Object.keys(GROUP_OTHER)) {
      const rows = withKeys.filter((c) => c.id.startsWith(`${prefix}.`));
      if (rows.length) out.push({ title: GROUP_OTHER[prefix], rows });
    }
    for (const m of MENUS) {
      const rows = withKeys.filter((c) => c.menu === m);
      if (rows.length) out.push({ title: m, rows });
    }
    return out;
  }, [q]);

  if (!open) return null;

  return (
    <div className="modal-backdrop" onClick={() => setOpen(false)}>
      <div className="modal" style={{ width: 720 }} role="dialog" aria-modal="true" aria-label="Pintasan keyboard" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>Pintasan keyboard</span>
          <button className="icon-btn" aria-label="Tutup" onClick={() => setOpen(false)}><Icon name="close" size={14} /></button>
        </div>
        <div className="modal-body">
          <input ref={inputRef} className="input" placeholder="Cari perintah atau tombol, mis. ripple atau Ctrl+K" value={q}
            onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.stopPropagation()} aria-label="Cari pintasan" style={{ marginBottom: 12 }} />
          <div style={{ columns: 2, columnGap: 24 }}>
            {groups.map((g) => (
              <div key={g.title} style={{ breakInside: 'avoid', marginBottom: 14 }}>
                <div className="panel-title" style={{ padding: '0 0 4px' }}>{g.title}</div>
                {g.rows.map((r) => (
                  <div key={r.id} className="row" style={{ justifyContent: 'space-between', padding: '3px 0', borderBottom: '1px solid #303030' }}>
                    <span style={{ color: 'var(--text)', fontSize: 12 }}>{r.label}</span>
                    <span className="row" style={{ gap: 3 }}>
                      {r.keys![0].split('+').map((k, i) => <kbd key={`${k}${i}`}>{k}</kbd>)}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
          {groups.length === 0 && <div className="empty-state">Tidak ada pintasan yang cocok dengan "{q}".</div>}
          <p className="hint" style={{ marginTop: 6 }}>
            Tata letak tombol mengikuti default Adobe Premiere Pro. Pintasan tidak aktif saat mengetik di kolom teks, kecuali Ctrl+S.
            I, O, J, K, L, Spasi, dan panah berlaku di monitor yang sedang aktif (bingkai biru).
          </p>
        </div>
      </div>
    </div>
  );
}
