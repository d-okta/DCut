// ============================================================
// TopBar: logo, nama proyek, file (baru/buka/simpan), undo/redo,
// pengaturan rasio & FPS proyek, dan tombol Export.
// ============================================================
import { useEffect, useState } from 'react';
import { useProject } from '../store/projectStore';
import { useUi } from '../store/uiStore';
import { bridge } from '../bridge';

/** Pilihan rasio/resolusi proyek. */
const RATIOS = [
  { value: '1920x1080', label: '16:9 (1920×1080)' },
  { value: '1080x1920', label: '9:16 (1080×1920)' },
  { value: '1080x1080', label: '1:1 (1080×1080)' },
  { value: '1440x1080', label: '4:3 (1440×1080)' },
] as const;

const FPS_OPTIONS = [24, 25, 30, 50, 60];

export default function TopBar() {
  const project = useProject((s) => s.project);
  const renameProject = useProject((s) => s.renameProject);
  const newProject = useProject((s) => s.newProject);
  const setProject = useProject((s) => s.setProject);
  const setProjectSettings = useProject((s) => s.setProjectSettings);
  const undo = useProject((s) => s.undo);
  const redo = useProject((s) => s.redo);
  // Subscribe ke panjang history agar tombol undo/redo ikut re-render.
  const canUndo = useProject((s) => s.past.length > 0);
  const canRedo = useProject((s) => s.future.length > 0);

  const setExportOpen = useUi((s) => s.setExportOpen);
  const showToast = useUi((s) => s.showToast);

  // Nama proyek diketik di state lokal, di-commit saat blur / Enter.
  const [name, setName] = useState(project.name);
  useEffect(() => { setName(project.name); }, [project.name]);

  const commitName = () => {
    const trimmed = name.trim();
    if (!trimmed) { setName(project.name); return; } // kosong -> kembalikan
    if (trimmed !== project.name) renameProject(trimmed);
  };

  const handleNew = () => {
    if (window.confirm('Buat proyek baru? Perubahan yang belum disimpan akan hilang.')) {
      newProject();
      showToast('Proyek baru dibuat');
    }
  };

  const handleOpen = async () => {
    try {
      const p = await bridge.openProjectFile();
      if (p) {
        setProject(p);
        showToast(`Proyek "${p.name}" dibuka`);
      }
    } catch (err) {
      showToast(`Gagal membuka proyek: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleSave = async () => {
    try {
      const res = await bridge.saveProjectFile(project);
      if (res) showToast(`Proyek disimpan: ${res.path}`);
    } catch (err) {
      showToast(`Gagal menyimpan proyek: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  // Nilai select rasio diturunkan dari ukuran proyek (fallback 16:9).
  const sizeValue = `${project.width}x${project.height}`;
  const ratioValue = RATIOS.some((r) => r.value === sizeValue) ? sizeValue : '1920x1080';

  const handleRatio = (v: string) => {
    const parts = v.split('x');
    const w = Number(parts[0]);
    const h = Number(parts[1]);
    if (w > 0 && h > 0) setProjectSettings({ width: w, height: h });
  };

  // Bila fps proyek tidak ada di daftar (mis. proyek lama), tampilkan juga.
  const fpsList = FPS_OPTIONS.includes(project.fps)
    ? FPS_OPTIONS
    : [project.fps, ...FPS_OPTIONS];

  return (
    <div className="topbar">
      <span className="topbar-logo">✂ NusaCut Studio</span>

      <input
        className="project-name-input"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onBlur={commitName}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
        title="Nama proyek"
        spellCheck={false}
      />

      <button className="btn btn-sm" onClick={handleNew} title="Proyek baru">Baru</button>
      <button className="btn btn-sm" onClick={() => { void handleOpen(); }} title="Buka file proyek">Buka</button>
      <button className="btn btn-sm" onClick={() => { void handleSave(); }} title="Simpan file proyek">Simpan</button>

      {/* divider vertikal kecil */}
      <span style={{ borderLeft: '1px solid var(--border)', alignSelf: 'stretch', margin: '4px 2px' }} />

      <button className="btn btn-icon" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">↶</button>
      <button className="btn btn-icon" onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Y)">↷</button>

      <div className="topbar-spacer" />

      <select
        className="select"
        style={{ width: 156 }}
        value={ratioValue}
        onChange={(e) => handleRatio(e.target.value)}
        title="Rasio / resolusi proyek"
      >
        {RATIOS.map((r) => (
          <option key={r.value} value={r.value}>{r.label}</option>
        ))}
      </select>

      <select
        className="select"
        style={{ width: 86 }}
        value={String(project.fps)}
        onChange={(e) => setProjectSettings({ fps: Number(e.target.value) })}
        title="Frame rate proyek"
      >
        {fpsList.map((f) => (
          <option key={f} value={String(f)}>{f} fps</option>
        ))}
      </select>

      <button
        className="btn btn-icon btn-ghost"
        title="Pintasan keyboard (?)"
        onClick={() => useUi.getState().setHelpOpen(!useUi.getState().helpOpen)}
      >
        ⌨
      </button>
      <button className="btn btn-primary" onClick={() => setExportOpen(true)}>⬆ Export</button>
    </div>
  );
}
