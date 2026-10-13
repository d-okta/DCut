// ============================================================
// Tata letak ala Premiere Pro (ruang kerja Editing):
//
//   [ Menu bar + ruang kerja + Ekspor                                    ]
//   [ Source Monitor            |  Program Monitor        | Kontrol Efek ]
//   [ Proyek / Efek / ...  |Alat| Timeline                         |Meter]
//
// Semua pembagi bisa diseret; ukurannya disimpan di localStorage.
// ============================================================
import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as RPointerEvent, ReactNode } from 'react';
import { useUi, type LeftTab, type RightTab } from './store/uiStore';
import { handleKey } from './commands';
import MenuBar from './components/MenuBar';
import SourceMonitor from './components/SourceMonitor';
import ProgramMonitor from './components/ProgramMonitor';
import Timeline from './components/Timeline';
import Inspector from './components/Inspector';
import ToolsPanel from './components/ToolsPanel';
import AudioMeters from './components/AudioMeters';
import ExportDialog from './components/ExportDialog';
import ShortcutHelp from './components/ShortcutHelp';
import MediaPanel from './components/panels/MediaPanel';
import EffectsPanel from './components/panels/EffectsPanel';
import TextPanel from './components/panels/TextPanel';
import TemplatesPanel from './components/panels/TemplatesPanel';
import AiPanel from './components/panels/AiPanel';
import MarkersPanel from './components/panels/MarkersPanel';

const LEFT_TABS: { id: LeftTab; label: string }[] = [
  { id: 'project', label: 'Proyek' },
  { id: 'effects', label: 'Efek' },
  { id: 'text', label: 'Grafis' },
  { id: 'ai', label: 'AI' },
  { id: 'markers', label: 'Penanda' },
  { id: 'templates', label: 'Template' },
];

const RIGHT_TABS: { id: RightTab; label: string }[] = [
  { id: 'controls', label: 'Kontrol Efek' },
  { id: 'color', label: 'Warna' },
  { id: 'audio', label: 'Audio' },
  { id: 'captions', label: 'Caption' },
];

const LAYOUT_KEY = 'dcut_layout_v1';
interface Layout { topH: number; srcW: number; rightW: number; leftW: number }
const DEFAULT_LAYOUT: Layout = { topH: 0.52, srcW: 0.36, rightW: 340, leftW: 0.3 };

function loadLayout(): Layout {
  try { return { ...DEFAULT_LAYOUT, ...JSON.parse(localStorage.getItem(LAYOUT_KEY) || '{}') }; }
  catch { return DEFAULT_LAYOUT; }
}

/** Frame panel dengan tab di atas. */
function Frame<T extends string>({ tabs, active, onTab, focused, extra, children }: {
  tabs: { id: T; label: string }[]; active: T; onTab(t: T): void; focused?: boolean; extra?: ReactNode; children: ReactNode;
}) {
  return (
    <section className={`frame ${focused ? 'focused' : ''}`}>
      <div className="frame-tabs" role="tablist">
        {tabs.map((t) => (
          <button key={t.id} role="tab" aria-selected={active === t.id} className={`frame-tab ${active === t.id ? 'active' : ''}`} onClick={() => onTab(t.id)}>
            {t.label}
          </button>
        ))}
        {extra && <div className="frame-tab-extra">{extra}</div>}
      </div>
      <div className="frame-body" role="tabpanel">{children}</div>
    </section>
  );
}

/** Pembagi yang bisa diseret. `onDrag` menerima posisi pointer relatif ke `container`. */
function Splitter({ dir, onDrag, container }: { dir: 'h' | 'v'; onDrag(fracOrPx: number, rect: DOMRect): void; container: () => HTMLElement | null }) {
  const [dragging, setDragging] = useState(false);
  const down = (e: RPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
  };
  const move = (e: RPointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const el = container();
    if (!el) return;
    const r = el.getBoundingClientRect();
    onDrag(dir === 'h' ? e.clientY - r.top : e.clientX - r.left, r);
  };
  const up = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    setDragging(false);
  };
  return (
    <div className={`splitter-${dir} ${dragging ? 'dragging' : ''}`} role="separator" aria-orientation={dir === 'h' ? 'horizontal' : 'vertical'}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} />
  );
}

export default function App() {
  const leftTab = useUi((s) => s.leftTab);
  const setLeftTab = useUi((s) => s.setLeftTab);
  const rightTab = useUi((s) => s.rightTab);
  const setRightTab = useUi((s) => s.setRightTab);
  const toast = useUi((s) => s.toast);
  const exportOpen = useUi((s) => s.exportOpen);
  const focused = useUi((s) => s.focusedMonitor);

  const [layout, setLayout] = useState<Layout>(loadLayout);
  useEffect(() => { try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); } catch { /* penyimpanan penuh */ } }, [layout]);

  const bodyRef = useRef<HTMLDivElement | null>(null);
  const topRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // Pintasan global dari registry perintah.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const typing = t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable;
      if (document.querySelector('.modal-backdrop') && e.key !== 'F1') return; // dialog terbuka: biarkan dialog yang menangani
      // Tombol aktif (Spasi/Enter) di tombol yang terfokus jangan dibajak.
      if (!typing && t.tagName === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return;
      handleKey(e, typing);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

  return (
    <div className="app-shell">
      <MenuBar />

      <div className="app-body" ref={bodyRef} style={{ gridTemplateRows: `${layout.topH * 100}% auto 1fr` }}>
        {/* ---------- baris atas: Source | Program | panel kanan ---------- */}
        <div className="app-row" ref={topRef} style={{ gridTemplateColumns: `${layout.srcW * 100}% auto 1fr auto ${layout.rightW}px` }}>
          <Frame tabs={[{ id: 'source', label: 'Source' }]} active="source" onTab={() => undefined} focused={focused === 'source'}>
            <SourceMonitor />
          </Frame>
          <Splitter dir="v" container={() => topRef.current}
            onDrag={(x, r) => setLayout((l) => ({ ...l, srcW: clamp(x / r.width, 0.15, 0.6) }))} />
          <Frame tabs={[{ id: 'program', label: 'Program' }]} active="program" onTab={() => undefined} focused={focused === 'program'}>
            <ProgramMonitor />
          </Frame>
          <Splitter dir="v" container={() => topRef.current}
            onDrag={(x, r) => setLayout((l) => ({ ...l, rightW: clamp(r.width - x, 260, 560) }))} />
          <Frame tabs={RIGHT_TABS} active={rightTab} onTab={setRightTab}>
            <Inspector />
          </Frame>
        </div>

        <Splitter dir="h" container={() => bodyRef.current}
          onDrag={(y, r) => setLayout((l) => ({ ...l, topH: clamp(y / r.height, 0.25, 0.75) }))} />

        {/* ---------- baris bawah: panel kiri | alat | timeline | meter ---------- */}
        <div className="app-row" ref={bottomRef} style={{ gridTemplateColumns: `${layout.leftW * 100}% auto 44px 1fr 46px` }}>
          <Frame tabs={LEFT_TABS} active={leftTab} onTab={setLeftTab}>
            {leftTab === 'project' && <MediaPanel />}
            {leftTab === 'effects' && <EffectsPanel />}
            {leftTab === 'text' && <TextPanel />}
            {leftTab === 'ai' && <AiPanel />}
            {leftTab === 'markers' && <MarkersPanel />}
            {leftTab === 'templates' && <TemplatesPanel />}
          </Frame>
          <Splitter dir="v" container={() => bottomRef.current}
            onDrag={(x, r) => setLayout((l) => ({ ...l, leftW: clamp(x / r.width, 0.16, 0.5) }))} />
          <ToolsPanel />
          <section className="frame">
            <Timeline />
          </section>
          <AudioMeters />
        </div>
      </div>

      {exportOpen && <ExportDialog />}
      <ShortcutHelp />
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}
