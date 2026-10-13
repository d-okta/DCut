// Panel Alat vertikal di samping timeline (Premiere: Tools panel).
import { useUi, type Tool } from '../store/uiStore';
import Icon, { type IconName } from './Icon';

const TOOLS: { id: Tool; icon: IconName; label: string; key: string; hint: string }[] = [
  { id: 'select', icon: 'select', label: 'Seleksi', key: 'V', hint: 'Pilih, pindah, dan trim klip. Ctrl+seret tepi = ripple trim.' },
  { id: 'ripple', icon: 'ripple', label: 'Ripple Edit', key: 'B', hint: 'Trim tepi klip; klip setelahnya ikut bergeser.' },
  { id: 'razor', icon: 'razor', label: 'Razor', key: 'C', hint: 'Klik klip untuk memotong. Shift+klik = semua track.' },
  { id: 'slip', icon: 'slip', label: 'Slip', key: 'Y', hint: 'Seret klip untuk menggeser isi sumber tanpa memindah klip.' },
  { id: 'hand', icon: 'hand', label: 'Tangan', key: 'H', hint: 'Seret untuk menggeser tampilan timeline.' },
  { id: 'zoom', icon: 'zoom', label: 'Zoom', key: 'Z', hint: 'Klik = perbesar, Alt+klik = perkecil.' },
];

export default function ToolsPanel() {
  const tool = useUi((s) => s.tool);
  const setTool = useUi((s) => s.setTool);
  return (
    <div className="tools" role="toolbar" aria-label="Alat timeline" aria-orientation="vertical">
      {TOOLS.map((t) => (
        <button
          key={t.id}
          className={`tool-btn ${tool === t.id ? 'active' : ''}`}
          title={`${t.label} (${t.key})\n${t.hint}`}
          aria-label={`${t.label} (${t.key})`}
          aria-pressed={tool === t.id}
          onClick={() => setTool(t.id)}
        >
          <Icon name={t.icon} size={17} />
        </button>
      ))}
    </div>
  );
}
