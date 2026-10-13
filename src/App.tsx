import { useEffect } from 'react';
import { useProject } from './store/projectStore';
import { useUi } from './store/uiStore';
import { bridge } from './bridge';
import { projectDuration } from './types';
import ShortcutHelp from './components/ShortcutHelp';
import TopBar from './components/TopBar';
import PreviewPlayer from './components/PreviewPlayer';
import Timeline from './components/Timeline';
import Inspector from './components/Inspector';
import ExportDialog from './components/ExportDialog';
import MediaPanel from './components/panels/MediaPanel';
import TextPanel from './components/panels/TextPanel';
import TransitionsPanel from './components/panels/TransitionsPanel';
import EffectsPanel from './components/panels/EffectsPanel';
import TemplatesPanel from './components/panels/TemplatesPanel';
import AiPanel from './components/panels/AiPanel';

const PANELS = [
  { id: 'media', label: 'Media', icon: '🎬' },
  { id: 'templates', label: 'Template', icon: '📐' },
  { id: 'text', label: 'Teks', icon: '🅣' },
  { id: 'transitions', label: 'Transisi', icon: '⇄' },
  { id: 'effects', label: 'Efek', icon: '🎨' },
  { id: 'ai', label: 'AI', icon: '✨' },
] as const;

export default function App() {
  const activePanel = useUi((s) => s.activePanel);
  const setActivePanel = useUi((s) => s.setActivePanel);
  const toast = useUi((s) => s.toast);
  const exportOpen = useUi((s) => s.exportOpen);

  // ---------- pintasan keyboard global (ala CapCut/Premiere) ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      const ui = useUi.getState();
      const prj = useProject.getState();
      const key = e.key.toLowerCase();

      // Cari klip terpilih beserta track-nya (untuk copy/duplicate/trim/mute).
      const findSelected = () => {
        if (!ui.selectedClipId) return null;
        for (const t of prj.project.tracks) {
          const c = t.clips.find((x) => x.id === ui.selectedClipId);
          if (c) return { clip: c, track: t };
        }
        return null;
      };

      // ----- kombinasi Ctrl yang tetap aktif saat mengetik -----
      if (e.ctrlKey && key === 's') {
        e.preventDefault();
        void bridge.saveProjectFile(prj.project)
          .then((r) => { if (r) ui.showToast(`Proyek disimpan: ${r.path}`); })
          .catch((err) => ui.showToast(`Gagal menyimpan: ${String(err)}`));
        return;
      }
      if (typing) return; // sisanya tidak boleh membajak pengetikan

      // ----- Ctrl+... -----
      if (e.ctrlKey) {
        if (key === 'y' || (e.shiftKey && key === 'z')) { e.preventDefault(); prj.redo(); return; }
        if (key === 'z') { e.preventDefault(); prj.undo(); return; }
        if (key === 'o') {
          e.preventDefault();
          void bridge.openProjectFile()
            .then((p) => { if (p) { prj.setProject(p); ui.showToast('Proyek dibuka.'); } })
            .catch((err) => ui.showToast(`Gagal membuka: ${String(err)}`));
          return;
        }
        if (key === 'e' || key === 'm') { e.preventDefault(); ui.setExportOpen(true); return; }
        if (key === 'c' || key === 'x') {
          const sel = findSelected();
          if (sel) {
            e.preventDefault();
            ui.setClipboard({ clip: structuredClone(sel.clip), trackId: sel.track.id });
            if (key === 'x') { prj.deleteClip(sel.clip.id); ui.selectClip(null); }
            ui.showToast(key === 'x' ? 'Klip dipotong ke clipboard.' : 'Klip disalin.');
          }
          return;
        }
        if (key === 'v') {
          if (ui.clipboard) {
            e.preventDefault();
            const id = prj.pasteClip(ui.clipboard.clip, ui.currentTime, ui.clipboard.trackId);
            if (id) { ui.selectClip(id); ui.showToast('Klip ditempel di playhead.'); }
          }
          return;
        }
        if (key === 'd') {
          e.preventDefault();
          const sel = findSelected();
          if (sel) {
            const id = prj.duplicateClip(sel.clip.id);
            if (id) { ui.selectClip(id); ui.showToast('Klip digandakan.'); }
          }
          return;
        }
        if (key === 'b') { // Premiere: Ctrl+B ~ split
          e.preventDefault();
          if (ui.selectedClipId) prj.splitClipAt(ui.selectedClipId, ui.currentTime);
          return;
        }
        return;
      }

      // ----- tombol tunggal -----
      if (e.code === 'Space') { e.preventDefault(); ui.togglePlay(); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (ui.selectedClipId) { prj.deleteClip(ui.selectedClipId); ui.selectClip(null); }
        else if (ui.selectedSubtitleId) { prj.removeSubtitle(ui.selectedSubtitleId); ui.selectSubtitle(null); }
        return;
      }
      if (key === 's') {
        if (ui.selectedClipId) prj.splitClipAt(ui.selectedClipId, ui.currentTime);
        return;
      }
      if (key === 'q' || key === 'w') { // CapCut: buang kiri/kanan playhead
        if (ui.selectedClipId) prj.trimToPlayhead(ui.selectedClipId, key === 'q' ? 'left' : 'right', ui.currentTime);
        return;
      }
      if (key === 'm') { // bisukan/bunyikan klip terpilih
        const sel = findSelected();
        if (sel && (sel.clip.kind === 'video' || sel.clip.kind === 'audio')) {
          prj.updateClip(sel.clip.id, { muted: !sel.clip.muted });
          ui.showToast(sel.clip.muted ? 'Suara klip dinyalakan.' : 'Klip dibisukan.');
        }
        return;
      }
      if (e.key === 'Escape') { ui.selectClip(null); ui.selectSubtitle(null); return; }
      if (key === 'j') { ui.setCurrentTime(ui.currentTime - 1); return; }
      if (key === 'k') { ui.pause(); return; }
      if (key === 'l') { ui.play(); return; }
      if (e.key === '+' || e.key === '=') { ui.setPxPerSec(ui.pxPerSec * 1.25); return; }
      if (e.key === '-' || e.key === '_') { ui.setPxPerSec(ui.pxPerSec / 1.25); return; }
      if (e.key === '?' || e.key === 'F1') { e.preventDefault(); ui.setHelpOpen(!ui.helpOpen); return; }
      if (e.key === 'ArrowLeft') { ui.setCurrentTime(ui.currentTime - (e.shiftKey ? 1 : 1 / prj.project.fps)); return; }
      if (e.key === 'ArrowRight') { ui.setCurrentTime(ui.currentTime + (e.shiftKey ? 1 : 1 / prj.project.fps)); return; }
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        // lompat ke titik edit (batas klip) sebelumnya/berikutnya
        e.preventDefault();
        const pts = new Set<number>([0, projectDuration(prj.project)]);
        for (const t of prj.project.tracks) for (const c of t.clips) { pts.add(c.start); pts.add(c.start + c.duration); }
        const sorted = [...pts].sort((a, b) => a - b);
        const t0 = ui.currentTime;
        const next = e.key === 'ArrowDown'
          ? sorted.find((p) => p > t0 + 0.001)
          : [...sorted].reverse().find((p) => p < t0 - 0.001);
        if (next !== undefined) ui.setCurrentTime(next);
        return;
      }
      if (e.key === 'Home') { ui.setCurrentTime(0); return; }
      if (e.key === 'End') { ui.setCurrentTime(projectDuration(prj.project)); return; }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="app-shell">
      <div className="app-top"><TopBar /></div>

      <div className="app-middle">
        {/* sisi kiri: tab ikon + panel aktif */}
        <div className="app-left">
          <div className="side-tabs">
            {PANELS.map((p) => (
              <button
                key={p.id}
                className={`side-tab ${activePanel === p.id ? 'active' : ''}`}
                onClick={() => setActivePanel(p.id)}
              >
                <span className="icon">{p.icon}</span>
                <span>{p.label}</span>
              </button>
            ))}
          </div>
          <div style={{ flex: 1, minWidth: 0, overflowY: 'auto' }}>
            {activePanel === 'media' && <MediaPanel />}
            {activePanel === 'templates' && <TemplatesPanel />}
            {activePanel === 'text' && <TextPanel />}
            {activePanel === 'transitions' && <TransitionsPanel />}
            {activePanel === 'effects' && <EffectsPanel />}
            {activePanel === 'ai' && <AiPanel />}
          </div>
        </div>

        {/* tengah: preview */}
        <div className="app-center">
          <PreviewPlayer />
        </div>

        {/* kanan: inspector */}
        <div className="app-right">
          <Inspector />
        </div>
      </div>

      {/* bawah: timeline */}
      <div className="app-bottom">
        <Timeline />
      </div>

      {exportOpen && <ExportDialog />}
      <ShortcutHelp />
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
