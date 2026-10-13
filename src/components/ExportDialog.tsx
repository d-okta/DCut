// ============================================================
// ExportDialog: pengaturan ekspor (rentang, resolusi, fps, kualitas,
// bakar caption) + progres render + hasil/galat.
// Selama render, dialog tidak bisa ditutup.
// ============================================================
import { useEffect, useState } from 'react';
import { useProject } from '../store/projectStore';
import { useUi } from '../store/uiStore';
import { bridge } from '../bridge';
import { projectDuration, toTimecode } from '../types';
import type { ExportOptions, ExportProgress } from '../types';
import Icon from './Icon';

type ResChoice = 'project' | '3840x2160' | '1920x1080' | '1280x720' | '1080x1920' | '1080x1080';
type FpsChoice = 'project' | '24' | '25' | '30' | '50' | '60';
type Status = 'setup' | 'rendering' | 'done' | 'error';
type Range = 'all' | 'inout';

export default function ExportDialog() {
  const project = useProject((s) => s.project);
  const setExportOpen = useUi((s) => s.setExportOpen);

  const hasSubtitles = project.subtitles.length > 0;
  const hasInOut = project.inPoint !== undefined || project.outPoint !== undefined;
  const fullDur = projectDuration(project);
  const rangeIn = project.inPoint ?? 0;
  const rangeOut = project.outPoint ?? fullDur;

  const [range, setRange] = useState<Range>(hasInOut ? 'inout' : 'all');
  const [resolution, setResolution] = useState<ResChoice>('project');
  const [fpsChoice, setFpsChoice] = useState<FpsChoice>('project');
  const [crf, setCrf] = useState(20);
  const [burnSubtitles, setBurnSubtitles] = useState(project.showSubtitles && hasSubtitles);

  const [status, setStatus] = useState<Status>('setup');
  const [progress, setProgress] = useState<ExportProgress>({ phase: 'preparing', percent: 0 });
  const [outPath, setOutPath] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const rendering = status === 'rendering';

  const close = () => { if (!rendering) setExportOpen(false); };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const dur = range === 'inout' ? Math.max(0, rangeOut - rangeIn) : fullDur;

  const startExport = async () => {
    let width = project.width, height = project.height;
    if (resolution !== 'project') { const [w, h] = resolution.split('x').map(Number); width = w; height = h; }
    const fps = fpsChoice === 'project' ? project.fps : Number(fpsChoice);
    const opts: ExportOptions = {
      width, height, fps, crf,
      burnSubtitles: burnSubtitles && hasSubtitles,
      ...(range === 'inout' ? { rangeStart: rangeIn, rangeEnd: rangeOut } : {}),
    };
    setStatus('rendering');
    setProgress({ phase: 'preparing', percent: 0 });
    try {
      const result = await bridge.exportProject(project, opts, (p) => setProgress(p));
      if (result.phase === 'error') { setErrorMsg(result.message ?? 'Ekspor gagal tanpa pesan galat.'); setStatus('error'); }
      else { setOutPath(result.outPath ?? ''); setStatus('done'); }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
      setStatus('error');
    }
  };

  const pct = Math.max(0, Math.min(100, Math.round(progress.percent)));

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-label="Ekspor media">
        <div className="modal-header">
          <span>Ekspor media</span>
          <button className="icon-btn" onClick={close} disabled={rendering} aria-label="Tutup" title={rendering ? 'Tunggu render selesai' : 'Tutup'}>
            <Icon name="close" size={14} />
          </button>
        </div>

        <div className="modal-body">
          {(status === 'setup' || status === 'rendering') && (
            <>
              <div className="field">
                <span className="field-label">Rentang</span>
                <div className="tabs" role="radiogroup" aria-label="Rentang ekspor">
                  <button role="radio" aria-checked={range === 'all'} className={`tab ${range === 'all' ? 'active' : ''}`} disabled={rendering} onClick={() => setRange('all')}>Seluruh sequence</button>
                  <button role="radio" aria-checked={range === 'inout'} className={`tab ${range === 'inout' ? 'active' : ''}`} disabled={rendering || !hasInOut} onClick={() => setRange('inout')}
                    title={hasInOut ? undefined : 'Tandai In (I) dan Out (O) di timeline dulu'}>In sampai Out</button>
                </div>
                <span className="hint" style={{ fontFamily: 'var(--mono)' }}>
                  {range === 'inout' ? `${toTimecode(rangeIn, project.fps)} - ${toTimecode(rangeOut, project.fps)} · ` : ''}durasi {toTimecode(dur, project.fps)}
                </span>
              </div>

              <div className="field-row" style={{ marginBottom: 10 }}>
                <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                  <span className="field-label">Resolusi</span>
                  <select className="select" value={resolution} disabled={rendering} onChange={(e) => setResolution(e.target.value as ResChoice)} aria-label="Resolusi">
                    <option value="project">{`Sesuai sequence (${project.width}×${project.height})`}</option>
                    <option value="3840x2160">4K UHD (3840×2160)</option>
                    <option value="1920x1080">1080p (1920×1080)</option>
                    <option value="1280x720">720p (1280×720)</option>
                    <option value="1080x1920">Vertikal 9:16 (1080×1920)</option>
                    <option value="1080x1080">Persegi (1080×1080)</option>
                  </select>
                </div>
                <div className="field" style={{ width: 130, marginBottom: 0 }}>
                  <span className="field-label">Frame rate</span>
                  <select className="select" value={fpsChoice} disabled={rendering} onChange={(e) => setFpsChoice(e.target.value as FpsChoice)} aria-label="Frame rate">
                    <option value="project">{`Sequence (${project.fps})`}</option>
                    {['24', '25', '30', '50', '60'].map((f) => <option key={f} value={f}>{f} fps</option>)}
                  </select>
                </div>
              </div>

              <div className="field">
                <span className="field-label">Kualitas (H.264, CRF)</span>
                <select className="select" value={String(crf)} disabled={rendering} onChange={(e) => setCrf(Number(e.target.value))} aria-label="Kualitas">
                  <option value="16">Sangat tinggi, berkas besar (CRF 16)</option>
                  <option value="20">Tinggi (CRF 20)</option>
                  <option value="23">Seimbang (CRF 23)</option>
                  <option value="27">Hemat ukuran (CRF 27)</option>
                </select>
              </div>

              <label className="field-row" style={{ marginBottom: 4, cursor: hasSubtitles ? 'pointer' : 'default' }}>
                <input type="checkbox" checked={burnSubtitles} disabled={!hasSubtitles || rendering} onChange={(e) => setBurnSubtitles(e.target.checked)} />
                <span className="field-label">Bakar caption ke video</span>
              </label>
              {!hasSubtitles && <div className="hint" style={{ marginBottom: 8 }}>Sequence ini belum punya caption.</div>}
              <div className="hint">Format MP4 (H.264 + AAC 192 kbps). Klip nonaktif tidak ikut; track audio ber-solo berlaku.</div>

              <div className="divider" />

              {status === 'setup' ? (
                <button className="btn btn-primary" style={{ width: '100%' }} onClick={() => { void startExport(); }} disabled={dur < 0.05}>
                  Ekspor
                </button>
              ) : (
                <div>
                  <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}><div style={{ width: `${pct}%` }} /></div>
                  <div className="hint" style={{ marginTop: 8, textAlign: 'center' }}>{progress.phase === 'preparing' ? 'Menyiapkan…' : `Merender… ${pct}%`}</div>
                </div>
              )}
            </>
          )}

          {status === 'done' && (
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Ekspor selesai</div>
              {outPath
                ? <div style={{ wordBreak: 'break-all', userSelect: 'text', fontSize: 12, color: 'var(--muted)', marginBottom: 14, lineHeight: 1.5 }}>{outPath}</div>
                : <div className="hint" style={{ marginBottom: 14 }}>Video tersimpan.</div>}
              <button className="btn" style={{ width: '100%' }} onClick={() => setExportOpen(false)}>Tutup</button>
            </div>
          )}

          {status === 'error' && (
            <div>
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--danger)', marginBottom: 8 }}>Ekspor gagal</div>
              <pre style={{ maxHeight: 140, overflowY: 'auto', userSelect: 'text', whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 11, lineHeight: 1.5, color: 'var(--text)', background: 'var(--panel-2)', border: '1px solid #444', borderRadius: 3, padding: 8, marginBottom: 14 }}>
                {errorMsg}
              </pre>
              <div className="row">
                <button className="btn" style={{ flex: 1 }} onClick={() => setStatus('setup')}>Ubah pengaturan</button>
                <button className="btn" style={{ flex: 1 }} onClick={() => setExportOpen(false)}>Tutup</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
