// ============================================================
// ExportDialog: modal pengaturan export (resolusi, fps, kualitas,
// bakar subtitle) + progress render + hasil/error.
// Saat rendering, modal tidak bisa ditutup.
// ============================================================
import { useState } from 'react';
import { useProject } from '../store/projectStore';
import { useUi } from '../store/uiStore';
import { bridge } from '../bridge';
import type { ExportOptions, ExportProgress } from '../types';

type ResChoice = 'project' | '1920x1080' | '1280x720' | '1080x1920';
type FpsChoice = 'project' | '24' | '30' | '60';
type Status = 'setup' | 'rendering' | 'done' | 'error';

export default function ExportDialog() {
  const project = useProject((s) => s.project);
  const setExportOpen = useUi((s) => s.setExportOpen);

  const hasSubtitles = project.subtitles.length > 0;

  // ---- pengaturan ----
  const [resolution, setResolution] = useState<ResChoice>('project');
  const [fpsChoice, setFpsChoice] = useState<FpsChoice>('project');
  const [crf, setCrf] = useState(21);
  const [burnSubtitles, setBurnSubtitles] = useState(project.showSubtitles && hasSubtitles);

  // ---- state proses ----
  const [status, setStatus] = useState<Status>('setup');
  const [progress, setProgress] = useState<ExportProgress>({ phase: 'preparing', percent: 0 });
  const [outPath, setOutPath] = useState('');
  const [errorMsg, setErrorMsg] = useState('');

  const rendering = status === 'rendering';

  const close = () => {
    if (!rendering) setExportOpen(false);
  };

  const startExport = async () => {
    // Resolusi & fps efektif dari pilihan.
    let width = project.width;
    let height = project.height;
    if (resolution !== 'project') {
      const parts = resolution.split('x');
      width = Number(parts[0]);
      height = Number(parts[1]);
    }
    const fps = fpsChoice === 'project' ? project.fps : Number(fpsChoice);

    // outPath sengaja dikosongkan: backend membuka dialog simpan sendiri.
    const opts: ExportOptions = {
      width, height, fps, crf,
      burnSubtitles: burnSubtitles && hasSubtitles,
    };

    setStatus('rendering');
    setProgress({ phase: 'preparing', percent: 0 });
    try {
      const result = await bridge.exportProject(project, opts, (p) => setProgress(p));
      if (result.phase === 'error') {
        setErrorMsg(result.message ?? 'Export gagal tanpa pesan error.');
        setStatus('error');
      } else {
        setOutPath(result.outPath ?? '');
        setStatus('done');
        // JANGAN menutup modal otomatis - biarkan pengguna membaca hasilnya.
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  };

  const pct = Math.max(0, Math.min(100, Math.round(progress.percent)));
  const phaseText = progress.phase === 'preparing'
    ? 'Menyiapkan...'
    : `Merender... ${pct}%`;

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}
    >
      <div className="modal">
        <div className="modal-header">
          <span>Export Video</span>
          <button
            className="btn btn-icon btn-ghost"
            onClick={close}
            disabled={rendering}
            title={rendering ? 'Tunggu render selesai' : 'Tutup'}
          >
            ✕
          </button>
        </div>

        <div className="modal-body">
          {(status === 'setup' || status === 'rendering') && (
            <>
              <div className="field">
                <span className="field-label">Resolusi</span>
                <select
                  className="select"
                  value={resolution}
                  disabled={rendering}
                  onChange={(e) => setResolution(e.target.value as ResChoice)}
                >
                  <option value="project">{`Sesuai proyek (${project.width}×${project.height})`}</option>
                  <option value="1920x1080">1080p (1920×1080)</option>
                  <option value="1280x720">720p (1280×720)</option>
                  <option value="1080x1920">Vertikal (1080×1920)</option>
                </select>
              </div>

              <div className="field">
                <span className="field-label">FPS</span>
                <select
                  className="select"
                  value={fpsChoice}
                  disabled={rendering}
                  onChange={(e) => setFpsChoice(e.target.value as FpsChoice)}
                >
                  <option value="project">{`Sesuai proyek (${project.fps} fps)`}</option>
                  <option value="24">24 fps</option>
                  <option value="30">30 fps</option>
                  <option value="60">60 fps</option>
                </select>
              </div>

              <div className="field">
                <span className="field-label">Kualitas</span>
                <select
                  className="select"
                  value={String(crf)}
                  disabled={rendering}
                  onChange={(e) => setCrf(Number(e.target.value))}
                >
                  <option value="18">Tinggi (CRF 18)</option>
                  <option value="21">Seimbang (CRF 21)</option>
                  <option value="26">Hemat (CRF 26)</option>
                </select>
              </div>

              <label className="field-row" style={{ marginBottom: 4, cursor: hasSubtitles ? 'pointer' : 'default' }}>
                <input
                  type="checkbox"
                  checked={burnSubtitles}
                  disabled={!hasSubtitles || rendering}
                  onChange={(e) => setBurnSubtitles(e.target.checked)}
                />
                <span className="field-label">Bakar subtitle ke video</span>
              </label>
              {!hasSubtitles && (
                <div className="hint" style={{ marginBottom: 8 }}>Belum ada subtitle di proyek ini.</div>
              )}

              <div className="divider" />

              {status === 'setup' ? (
                <button
                  className="btn btn-primary"
                  style={{ width: '100%' }}
                  onClick={() => { void startExport(); }}
                >
                  Mulai Export
                </button>
              ) : (
                <div>
                  <div className="progress">
                    <div style={{ width: `${pct}%` }} />
                  </div>
                  <div className="hint" style={{ marginTop: 8, textAlign: 'center' }}>{phaseText}</div>
                </div>
              )}
            </>
          )}

          {status === 'done' && (
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 8 }}>✅ Berhasil</div>
              {outPath ? (
                <div
                  style={{
                    wordBreak: 'break-all', userSelect: 'text', fontSize: 12,
                    color: 'var(--muted)', marginBottom: 14, lineHeight: 1.5,
                  }}
                >
                  {outPath}
                </div>
              ) : (
                <div className="hint" style={{ marginBottom: 14 }}>Video berhasil di-export.</div>
              )}
              <button className="btn" style={{ width: '100%' }} onClick={() => setExportOpen(false)}>Tutup</button>
            </div>
          )}

          {status === 'error' && (
            <div>
              <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--danger)', marginBottom: 8 }}>
                ⚠ Export gagal
              </div>
              <pre
                style={{
                  maxHeight: 120, overflowY: 'auto', userSelect: 'text',
                  whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                  fontSize: 11, lineHeight: 1.5, color: 'var(--text)',
                  background: 'var(--panel-2)', border: '1px solid var(--border)',
                  borderRadius: 5, padding: 8, marginBottom: 14,
                }}
              >
                {errorMsg}
              </pre>
              <button className="btn" style={{ width: '100%' }} onClick={() => setExportOpen(false)}>Tutup</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
