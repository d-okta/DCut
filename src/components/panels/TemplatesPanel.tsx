// ============================================================
// Panel Template: template bawaan + template milik pengguna
// (tersimpan di localStorage lewat presets/templates.ts).
// ============================================================
import { useState } from 'react';
import { useProject } from '../../store/projectStore';
import { useUi } from '../../store/uiStore';
import {
  BUILTIN_TEMPLATES,
  loadUserTemplates,
  saveUserTemplate,
  deleteUserTemplate,
  instantiateTemplate,
} from '../../presets/templates';
import type { BuiltinTemplate, UserTemplate } from '../../presets/templates';

/** Format ISO date -> tanggal singkat Indonesia. */
function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function TemplatesPanel() {
  const showToast = useUi((s) => s.showToast);
  const [userTemplates, setUserTemplates] = useState<UserTemplate[]>(() => loadUserTemplates());

  const applyBuiltin = (t: BuiltinTemplate) => {
    if (!window.confirm('Terapkan template? Proyek saat ini akan diganti.')) return;
    useProject.getState().setProject(instantiateTemplate(t.build()));
    showToast(`Template "${t.name}" diterapkan`);
  };

  const applyUser = (t: UserTemplate) => {
    if (!window.confirm('Terapkan template? Proyek saat ini akan diganti.')) return;
    useProject.getState().setProject(instantiateTemplate(t.project));
    showToast(`Template "${t.name}" diterapkan`);
  };

  const onSaveAsTemplate = () => {
    const project = useProject.getState().project;
    const name = window.prompt('Nama template:', project.name);
    if (name === null) return; // batal
    saveUserTemplate(name.trim() || project.name, project);
    setUserTemplates(loadUserTemplates());
    showToast('Proyek disimpan sebagai template');
  };

  const onDeleteUser = (t: UserTemplate) => {
    if (!window.confirm(`Hapus template "${t.name}"?`)) return;
    deleteUserTemplate(t.id);
    setUserTemplates(loadUserTemplates());
    showToast('Template dihapus');
  };

  return (
    <div>
      <div className="panel-title">Template</div>
      <div className="panel-body">
        {/* ---------- Template bawaan ---------- */}
        <div className="field-label" style={{ marginBottom: 8 }}>Template Bawaan</div>
        <div className="card-grid-lg">
          {BUILTIN_TEMPLATES.map((t) => (
            <div key={t.id} className="card" onClick={() => applyBuiltin(t)} title="Klik untuk menerapkan template">
              <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                <strong style={{ fontSize: 12 }}>{t.name}</strong>
                <span className="badge">{t.ratio}</span>
              </div>
              <div className="hint">{t.description}</div>
            </div>
          ))}
        </div>

        <div className="divider" />

        {/* ---------- Template pengguna ---------- */}
        <div className="field-label" style={{ marginBottom: 8 }}>Template Saya</div>
        <button className="btn" style={{ width: '100%' }} onClick={onSaveAsTemplate}>
          💾 Simpan proyek sebagai template
        </button>

        {userTemplates.length === 0 ? (
          <div className="hint" style={{ marginTop: 10 }}>
            Belum ada template tersimpan. Susun proyek, lalu simpan sebagai template agar bisa dipakai ulang.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
            {userTemplates.map((t) => (
              <div key={t.id} className="card" style={{ cursor: 'default' }}>
                <div className="asset-name" style={{ fontWeight: 600, fontSize: 12 }}>{t.name}</div>
                <div className="hint" style={{ margin: '2px 0 8px' }}>Disimpan {fmtDate(t.savedAt)}</div>
                <div className="row">
                  <button className="btn btn-sm btn-primary" onClick={() => applyUser(t)}>Terapkan</button>
                  <button className="btn btn-sm btn-danger" onClick={() => onDeleteUser(t)}>Hapus</button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
