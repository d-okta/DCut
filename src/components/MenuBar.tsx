// ============================================================
// Menu bar ala aplikasi desktop: Berkas / Edit / Klip / Sequence /
// Penanda / Tampilan / Bantuan, ruang kerja, nama proyek, Ekspor.
// Semua item diambil dari registry COMMANDS (satu sumber dengan pintasan).
// ============================================================
import { useEffect, useRef, useState } from 'react';
import { COMMANDS, MENUS, type Menu } from '../commands';
import { useProject } from '../store/projectStore';
import { useUi, type Workspace } from '../store/uiStore';
import Icon from './Icon';

const WORKSPACES: { id: Workspace; label: string }[] = [
  { id: 'editing', label: 'Editing' },
  { id: 'color', label: 'Warna' },
  { id: 'audio', label: 'Audio' },
  { id: 'captions', label: 'Teks & Caption' },
];

export default function MenuBar() {
  const [open, setOpen] = useState<Menu | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const workspace = useUi((s) => s.workspace);
  const setWorkspace = useUi((s) => s.setWorkspace);
  const setExportOpen = useUi((s) => s.setExportOpen);
  const projectName = useProject((s) => s.project.name);
  const renameProject = useProject((s) => s.renameProject);
  // Re-render saat history berubah supaya item Undo/Redo aktif/nonaktif tepat.
  useProject((s) => s.past.length + s.future.length);
  useUi((s) => s.selectedClipId);

  const [name, setName] = useState(projectName);
  useEffect(() => setName(projectName), [projectName]);

  // Tutup menu saat klik di luar atau Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (barRef.current && !barRef.current.contains(e.target as Node)) setOpen(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); setOpen(null); }
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  // Fokus ke item pertama saat menu dibuka lewat keyboard.
  const popRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (open) popRef.current?.querySelector<HTMLButtonElement>('.menu-item:not(:disabled)')?.focus();
  }, [open]);

  const onPopKey = (e: React.KeyboardEvent) => {
    const items = [...(popRef.current?.querySelectorAll<HTMLButtonElement>('.menu-item:not(:disabled)') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      const idx = MENUS.indexOf(open!);
      setOpen(MENUS[(idx + (e.key === 'ArrowRight' ? 1 : -1) + MENUS.length) % MENUS.length]);
    }
    e.stopPropagation();
  };

  const commitName = () => {
    const t = name.trim();
    if (!t) setName(projectName);
    else if (t !== projectName) renameProject(t);
  };

  return (
    <div className="menubar" ref={barRef}>
      <span className="menubar-brand">D<b>Cut</b></span>
      {MENUS.map((m) => (
        <div key={m} className="menu-root">
          <button
            className={`menu-btn ${open === m ? 'open' : ''}`}
            aria-haspopup="menu"
            aria-expanded={open === m}
            onClick={() => setOpen(open === m ? null : m)}
            onPointerEnter={() => { if (open && open !== m) setOpen(m); }}
          >
            {m}
          </button>
          {open === m && (
            <div className="menu-pop" role="menu" ref={popRef} onKeyDown={onPopKey}>
              {COMMANDS.filter((c) => c.menu === m).map((c) => {
                const enabled = c.enabled ? c.enabled() : true;
                return (
                  <div key={c.id}>
                    {c.separator && <div className="menu-sep" />}
                    <button
                      className="menu-item"
                      role="menuitem"
                      disabled={!enabled}
                      onClick={() => { setOpen(null); c.run(); }}
                    >
                      <span>{c.label}</span>
                      {c.keys && <span className="menu-keys">{c.keys[0]}</span>}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      ))}

      <nav className="workspaces" aria-label="Ruang kerja">
        {WORKSPACES.map((w) => (
          <button
            key={w.id}
            className={`ws-tab ${workspace === w.id ? 'active' : ''}`}
            aria-pressed={workspace === w.id}
            onClick={() => setWorkspace(w.id)}
          >
            {w.label}
          </button>
        ))}
      </nav>

      <input
        className="project-name-input"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commitName}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        aria-label="Nama proyek"
        spellCheck={false}
      />
      <button className="btn btn-primary btn-sm" style={{ marginLeft: 8 }} onClick={() => setExportOpen(true)} title="Ekspor media (Ctrl+M)">
        <Icon name="export" size={14} /> Ekspor
      </button>
    </div>
  );
}
