// ============================================================
// Registry perintah: satu sumber untuk menu bar, pintasan keyboard,
// dan daftar di panel Pintasan. Pemetaan tombol mengikuti default
// Adobe Premiere Pro (Windows) sejauh fiturnya ada di aplikasi ini.
// ============================================================
import { useProject } from './store/projectStore';
import { useUi, type Tool, type Workspace } from './store/uiStore';
import { bridge } from './bridge';
import { clipEnd, normalizeProject, projectDuration, toTimecode } from './types';
import type { Clip, Track } from './types';
import { importMediaFiles } from './utils/importMedia';

export type Menu = 'Berkas' | 'Edit' | 'Klip' | 'Sequence' | 'Penanda' | 'Tampilan' | 'Bantuan';
export const MENUS: Menu[] = ['Berkas', 'Edit', 'Klip', 'Sequence', 'Penanda', 'Tampilan', 'Bantuan'];

export interface Command {
  id: string;
  label: string;
  menu?: Menu;
  /** Tombol untuk ditampilkan, mis. "Ctrl+K". */
  keys?: string[];
  /** Pemisah di menu sebelum item ini. */
  separator?: boolean;
  /** Tetap aktif walau fokus sedang di kolom teks. */
  whileTyping?: boolean;
  enabled?(): boolean;
  run(): void;
}

// ---------- pembantu ----------

const ui = () => useUi.getState();
const prj = () => useProject.getState();

export function findSelected(): { clip: Clip; track: Track } | null {
  const id = ui().selectedClipId;
  if (!id) return null;
  for (const t of prj().project.tracks) {
    const c = t.clips.find((x) => x.id === id);
    if (c) return { clip: c, track: t };
  }
  return null;
}

const hasSel = () => !!findSelected();
const fps = () => prj().project.fps || 30;

/** Titik edit (batas klip, In/Out, penanda) untuk lompat ↑/↓. */
function editPoints(): number[] {
  const p = prj().project;
  const pts = new Set<number>([0, projectDuration(p)]);
  for (const t of p.tracks) for (const c of t.clips) { pts.add(c.start); pts.add(clipEnd(c)); }
  return [...pts].sort((a, b) => a - b);
}

function jumpEdit(dir: 1 | -1) {
  const t0 = ui().currentTime;
  const pts = editPoints();
  const next = dir > 0 ? pts.find((p) => p > t0 + 0.001) : [...pts].reverse().find((p) => p < t0 - 0.001);
  if (next !== undefined) ui().setCurrentTime(next);
}

function jumpMarker(dir: 1 | -1) {
  const t0 = ui().currentTime;
  const ms = (prj().project.markers ?? []).map((m) => m.time).sort((a, b) => a - b);
  const next = dir > 0 ? ms.find((p) => p > t0 + 0.001) : [...ms].reverse().find((p) => p < t0 - 0.001);
  if (next !== undefined) ui().setCurrentTime(next);
  else ui().showToast(dir > 0 ? 'Tidak ada penanda setelah playhead.' : 'Tidak ada penanda sebelum playhead.');
}

/** J / K / L ala Premiere: tekan L berulang = 1x, 2x, 4x, 8x; J berulang = mundur. */
function shuttle(dir: 1 | -1) {
  const u = ui();
  if (u.focusedMonitor === 'source' && u.source) {
    u.setSourcePlaying(dir > 0);
    return;
  }
  const cur = u.playing ? u.shuttle : 0;
  let next: number;
  if (cur === 0 || Math.sign(cur) !== dir) next = dir;
  else next = Math.max(-8, Math.min(8, cur * 2));
  u.setShuttle(next);
}

function stepFrames(n: number) {
  const u = ui();
  if (u.focusedMonitor === 'source' && u.source) {
    u.setSource({ time: Math.max(0, u.source.time + n / fps()) });
    return;
  }
  u.pause();
  u.setCurrentTime(u.currentTime + n / fps());
}

/** I / O: tandai di monitor yang sedang aktif. */
function markPoint(which: 'in' | 'out') {
  const u = ui();
  if (u.focusedMonitor === 'source' && u.source) {
    u.setSource(which === 'in' ? { inPoint: u.source.time } : { outPoint: u.source.time });
    return;
  }
  prj().setInOut(which === 'in' ? { inPoint: u.currentTime } : { outPoint: u.currentTime });
}

function clearPoints(which: 'in' | 'out' | 'both') {
  const u = ui();
  if (u.focusedMonitor === 'source' && u.source) {
    u.setSource({
      ...(which !== 'out' ? { inPoint: undefined } : {}),
      ...(which !== 'in' ? { outPoint: undefined } : {}),
    });
    return;
  }
  prj().setInOut({
    ...(which !== 'out' ? { inPoint: null } : {}),
    ...(which !== 'in' ? { outPoint: null } : {}),
  });
}

/** Insert (,) / Overwrite (.) dari Source Monitor ke playhead sequence. */
export function sourceEdit(mode: 'insert' | 'overwrite') {
  const u = ui();
  const src = u.source;
  if (!src) { u.showToast('Buka media di Source Monitor dulu (klik dua kali di panel Proyek).'); return; }
  const asset = prj().project.assets.find((a) => a.id === src.assetId);
  if (!asset) return;
  const a = src.inPoint ?? 0;
  const b = src.outPoint ?? (asset.type === 'image' ? a + 4 : asset.duration);
  if (b - a < 0.05) { u.showToast('Rentang In-Out di Source Monitor terlalu pendek.'); return; }
  const id = prj().editFromSource(asset.id, a, b, u.currentTime, mode);
  if (!id) { u.showToast('Tidak ada track yang cocok dan tidak terkunci.'); return; }
  u.selectClip(id);
  u.setCurrentTime(u.currentTime + (b - a));
  u.showToast(mode === 'insert' ? `Disisipkan ${toTimecode(b - a, fps())} dari "${asset.name}".` : `Ditimpakan ${toTimecode(b - a, fps())} dari "${asset.name}".`);
}

async function saveProject() {
  try {
    const r = await bridge.saveProjectFile(prj().project);
    if (r) ui().showToast(`Proyek disimpan: ${r.path}`);
  } catch (err) {
    ui().showToast(`Gagal menyimpan: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function openProject() {
  try {
    const p = await bridge.openProjectFile();
    if (p) { prj().setProject(normalizeProject(p)); ui().showToast(`Proyek "${p.name}" dibuka.`); }
  } catch (err) {
    ui().showToast(`Gagal membuka: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function importMedia() {
  try {
    const n = await importMediaFiles();
    ui().showToast(n > 0 ? `${n} file media diimpor.` : 'Tidak ada file dipilih.');
  } catch {
    ui().showToast('Gagal mengimpor media.');
  }
}

const setTool = (t: Tool) => () => ui().setTool(t);
const setWs = (w: Workspace) => () => ui().setWorkspace(w);

// ---------- daftar perintah ----------

export const COMMANDS: Command[] = [
  // Berkas
  { id: 'file.new', label: 'Proyek baru', menu: 'Berkas', keys: ['Ctrl+Alt+N'], run: () => {
    if (window.confirm('Buat proyek baru? Perubahan yang belum disimpan akan hilang.')) { prj().newProject(); ui().showToast('Proyek baru dibuat.'); }
  } },
  { id: 'file.open', label: 'Buka proyek…', menu: 'Berkas', keys: ['Ctrl+O'], run: () => void openProject() },
  { id: 'file.save', label: 'Simpan proyek', menu: 'Berkas', keys: ['Ctrl+S'], whileTyping: true, run: () => void saveProject() },
  { id: 'file.import', label: 'Impor media…', menu: 'Berkas', keys: ['Ctrl+I'], separator: true, run: () => void importMedia() },
  { id: 'file.export', label: 'Ekspor media…', menu: 'Berkas', keys: ['Ctrl+M'], separator: true, run: () => ui().setExportOpen(true) },
  { id: 'file.exportFrame', label: 'Ekspor frame (PNG)', menu: 'Berkas', keys: ['Ctrl+Shift+E'], run: () => window.dispatchEvent(new CustomEvent('dcut:export-frame')) },

  // Edit
  { id: 'edit.undo', label: 'Undo', menu: 'Edit', keys: ['Ctrl+Z'], enabled: () => prj().past.length > 0, run: () => prj().undo() },
  { id: 'edit.redo', label: 'Redo', menu: 'Edit', keys: ['Ctrl+Shift+Z'], enabled: () => prj().future.length > 0, run: () => prj().redo() },
  { id: 'edit.cut', label: 'Potong', menu: 'Edit', keys: ['Ctrl+X'], separator: true, enabled: hasSel, run: () => {
    const s = findSelected(); if (!s) return;
    ui().setClipboard({ clip: structuredClone(s.clip), trackId: s.track.id });
    prj().deleteClip(s.clip.id); ui().selectClip(null); ui().showToast('Klip dipotong ke clipboard.');
  } },
  { id: 'edit.copy', label: 'Salin', menu: 'Edit', keys: ['Ctrl+C'], enabled: hasSel, run: () => {
    const s = findSelected(); if (!s) return;
    ui().setClipboard({ clip: structuredClone(s.clip), trackId: s.track.id }); ui().showToast('Klip disalin.');
  } },
  { id: 'edit.paste', label: 'Tempel di playhead', menu: 'Edit', keys: ['Ctrl+V'], enabled: () => !!ui().clipboard, run: () => {
    const cb = ui().clipboard; if (!cb) return;
    const id = prj().pasteClip(cb.clip, ui().currentTime, cb.trackId);
    if (id) { ui().selectClip(id); ui().showToast('Klip ditempel di playhead.'); }
  } },
  { id: 'edit.duplicate', label: 'Gandakan', menu: 'Edit', keys: ['Ctrl+D'], enabled: hasSel, run: () => {
    const s = findSelected(); if (!s) return;
    const id = prj().duplicateClip(s.clip.id); if (id) ui().selectClip(id);
  } },
  { id: 'edit.clear', label: 'Hapus', menu: 'Edit', keys: ['Delete'], separator: true, run: () => {
    const u = ui();
    if (u.selectedClipId) { prj().deleteClip(u.selectedClipId); u.selectClip(null); }
    else if (u.selectedSubtitleId) { prj().removeSubtitle(u.selectedSubtitleId); u.selectSubtitle(null); }
  } },
  { id: 'edit.rippleDelete', label: 'Ripple Delete', menu: 'Edit', keys: ['Shift+Delete'], enabled: hasSel, run: () => {
    const s = findSelected(); if (!s) return;
    prj().rippleDeleteClip(s.clip.id); ui().selectClip(null);
  } },
  { id: 'edit.deselect', label: 'Batalkan seleksi', menu: 'Edit', keys: ['Esc'], run: () => { ui().selectClip(null); ui().selectSubtitle(null); } },
  { id: 'edit.shortcuts', label: 'Pintasan keyboard…', menu: 'Edit', keys: ['Ctrl+Alt+K'], separator: true, run: () => ui().setHelpOpen(true) },

  // Klip
  { id: 'clip.enable', label: 'Aktif / nonaktifkan klip', menu: 'Klip', keys: ['Shift+E'], enabled: hasSel, run: () => {
    const s = findSelected(); if (!s) return;
    prj().setClipsDisabled([s.clip.id], !s.clip.disabled);
    ui().showToast(s.clip.disabled ? 'Klip diaktifkan.' : 'Klip dinonaktifkan: tetap di timeline, tidak tampil.');
  } },
  { id: 'clip.mute', label: 'Bisukan / bunyikan klip', menu: 'Klip', enabled: hasSel, run: () => {
    const s = findSelected(); if (!s || (s.clip.kind !== 'video' && s.clip.kind !== 'audio')) return;
    prj().updateClip(s.clip.id, { muted: !s.clip.muted });
  } },
  { id: 'clip.speed', label: 'Kecepatan / durasi…', menu: 'Klip', keys: ['Ctrl+R'], enabled: hasSel, run: () => {
    const s = findSelected(); if (!s || (s.clip.kind !== 'video' && s.clip.kind !== 'audio')) return;
    const v = window.prompt('Kecepatan klip dalam persen (100 = normal):', String(Math.round(s.clip.speed * 100)));
    if (v === null) return;
    const n = Number(v.replace(',', '.'));
    if (!Number.isFinite(n) || n < 5 || n > 1000) { ui().showToast('Isi angka 5 sampai 1000.'); return; }
    prj().updateClip(s.clip.id, { speed: n / 100, duration: (s.clip.duration * s.clip.speed) / (n / 100) });
  } },

  // Sequence
  { id: 'seq.split', label: 'Add Edit', menu: 'Sequence', keys: ['Ctrl+K'], run: () => {
    // Premiere: belah di playhead pada klip terpilih; tanpa seleksi, semua track.
    const s = findSelected();
    if (s) { prj().splitClipAt(s.clip.id, ui().currentTime); return; }
    const n = prj().addEditAllTracks(ui().currentTime);
    if (!n) ui().showToast('Playhead tidak berada di tengah klip mana pun.');
  } },
  { id: 'seq.addEdit', label: 'Add Edit ke semua track', menu: 'Sequence', keys: ['Ctrl+Shift+K'], run: () => {
    const n = prj().addEditAllTracks(ui().currentTime);
    ui().showToast(n ? `${n} klip dibelah di playhead.` : 'Playhead tidak berada di tengah klip mana pun.');
  } },
  { id: 'seq.rippleLeft', label: 'Ripple trim sebelumnya ke playhead', menu: 'Sequence', keys: ['Q'], separator: true, enabled: hasSel, run: () => {
    const s = findSelected(); if (s) prj().rippleTrimToPlayhead(s.clip.id, 'left', ui().currentTime);
  } },
  { id: 'seq.rippleRight', label: 'Ripple trim berikutnya ke playhead', menu: 'Sequence', keys: ['W'], enabled: hasSel, run: () => {
    const s = findSelected(); if (s) prj().rippleTrimToPlayhead(s.clip.id, 'right', ui().currentTime);
  } },
  { id: 'seq.insert', label: 'Insert dari Source', menu: 'Sequence', keys: [','], separator: true, run: () => sourceEdit('insert') },
  { id: 'seq.overwrite', label: 'Overwrite dari Source', menu: 'Sequence', keys: ['.'], run: () => sourceEdit('overwrite') },
  { id: 'seq.lift', label: 'Lift rentang In-Out', menu: 'Sequence', keys: [';'], separator: true, run: () => {
    if (!prj().liftOrExtract('lift')) ui().showToast('Tandai In (I) dan Out (O) di timeline dulu.');
  } },
  { id: 'seq.extract', label: 'Extract rentang In-Out', menu: 'Sequence', keys: ["'"], run: () => {
    if (!prj().liftOrExtract('extract')) ui().showToast('Tandai In (I) dan Out (O) di timeline dulu.');
  } },
  { id: 'seq.snap', label: 'Snap di timeline', menu: 'Sequence', keys: ['S'], separator: true, run: () => {
    ui().toggleSnapping(); ui().showToast(ui().snapping ? 'Snap aktif.' : 'Snap mati.');
  } },
  { id: 'seq.addVideo', label: 'Tambah track video', menu: 'Sequence', run: () => prj().addTrack('overlay') },
  { id: 'seq.addAudio', label: 'Tambah track audio', menu: 'Sequence', run: () => prj().addTrack('audio') },

  // Penanda (Markers)
  { id: 'mark.in', label: 'Tandai In', menu: 'Penanda', keys: ['I'], run: () => markPoint('in') },
  { id: 'mark.out', label: 'Tandai Out', menu: 'Penanda', keys: ['O'], run: () => markPoint('out') },
  { id: 'mark.clip', label: 'Tandai klip (In-Out = klip terpilih)', menu: 'Penanda', keys: ['X'], enabled: hasSel, run: () => {
    const s = findSelected(); if (s) prj().setInOut({ inPoint: s.clip.start, outPoint: clipEnd(s.clip) });
  } },
  { id: 'mark.goIn', label: 'Ke In', menu: 'Penanda', keys: ['Shift+I'], separator: true, run: () => {
    const v = prj().project.inPoint; if (v !== undefined) ui().setCurrentTime(v);
  } },
  { id: 'mark.goOut', label: 'Ke Out', menu: 'Penanda', keys: ['Shift+O'], run: () => {
    const v = prj().project.outPoint; if (v !== undefined) ui().setCurrentTime(v);
  } },
  { id: 'mark.clearIn', label: 'Hapus In', menu: 'Penanda', keys: ['Ctrl+Shift+I'], separator: true, run: () => clearPoints('in') },
  { id: 'mark.clearOut', label: 'Hapus Out', menu: 'Penanda', keys: ['Ctrl+Shift+O'], run: () => clearPoints('out') },
  { id: 'mark.clearInOut', label: 'Hapus In dan Out', menu: 'Penanda', keys: ['Ctrl+Shift+X'], run: () => clearPoints('both') },
  { id: 'mark.add', label: 'Tambah penanda', menu: 'Penanda', keys: ['M'], separator: true, run: () => {
    prj().addMarker(ui().currentTime); ui().showToast(`Penanda di ${toTimecode(ui().currentTime, fps())}.`);
  } },
  { id: 'mark.next', label: 'Ke penanda berikutnya', menu: 'Penanda', keys: ['Shift+M'], run: () => jumpMarker(1) },
  { id: 'mark.prev', label: 'Ke penanda sebelumnya', menu: 'Penanda', keys: ['Ctrl+Shift+M'], run: () => jumpMarker(-1) },

  // Tampilan
  { id: 'view.zoomIn', label: 'Perbesar timeline', menu: 'Tampilan', keys: ['='], run: () => ui().setPxPerSec(ui().pxPerSec * 1.25) },
  { id: 'view.zoomOut', label: 'Perkecil timeline', menu: 'Tampilan', keys: ['-'], run: () => ui().setPxPerSec(ui().pxPerSec / 1.25) },
  { id: 'view.zoomFit', label: 'Muatkan sequence ke layar', menu: 'Tampilan', keys: ['\\'], run: () => window.dispatchEvent(new CustomEvent('dcut:zoom-fit')) },
  { id: 'ws.editing', label: 'Ruang kerja: Editing', menu: 'Tampilan', keys: ['Alt+Shift+1'], separator: true, run: setWs('editing') },
  { id: 'ws.color', label: 'Ruang kerja: Warna', menu: 'Tampilan', keys: ['Alt+Shift+2'], run: setWs('color') },
  { id: 'ws.audio', label: 'Ruang kerja: Audio', menu: 'Tampilan', keys: ['Alt+Shift+3'], run: setWs('audio') },
  { id: 'ws.captions', label: 'Ruang kerja: Teks & Caption', menu: 'Tampilan', keys: ['Alt+Shift+4'], run: setWs('captions') },

  // Alat (Tools panel) - tidak di menu
  { id: 'tool.select', label: 'Alat Seleksi', keys: ['V'], run: setTool('select') },
  { id: 'tool.razor', label: 'Alat Razor (potong)', keys: ['C'], run: setTool('razor') },
  { id: 'tool.ripple', label: 'Alat Ripple Edit', keys: ['B'], run: setTool('ripple') },
  { id: 'tool.slip', label: 'Alat Slip', keys: ['Y'], run: setTool('slip') },
  { id: 'tool.hand', label: 'Alat Tangan (geser timeline)', keys: ['H'], run: setTool('hand') },
  { id: 'tool.zoom', label: 'Alat Zoom', keys: ['Z'], run: setTool('zoom') },

  // Transport - tidak di menu
  { id: 'play.toggle', label: 'Putar / jeda', keys: ['Spasi'], run: () => {
    const u = ui();
    if (u.focusedMonitor === 'source' && u.source) u.setSourcePlaying(!u.sourcePlaying);
    else u.togglePlay();
  } },
  { id: 'play.forward', label: 'Putar maju (tekan lagi = lebih cepat)', keys: ['L'], run: () => shuttle(1) },
  { id: 'play.stop', label: 'Berhenti', keys: ['K'], run: () => { ui().pause(); ui().setSourcePlaying(false); } },
  { id: 'play.reverse', label: 'Putar mundur (tekan lagi = lebih cepat)', keys: ['J'], run: () => shuttle(-1) },
  { id: 'play.prevFrame', label: 'Mundur 1 frame', keys: ['←'], run: () => stepFrames(-1) },
  { id: 'play.nextFrame', label: 'Maju 1 frame', keys: ['→'], run: () => stepFrames(1) },
  { id: 'play.prev5', label: 'Mundur 5 frame', keys: ['Shift+←'], run: () => stepFrames(-5) },
  { id: 'play.next5', label: 'Maju 5 frame', keys: ['Shift+→'], run: () => stepFrames(5) },
  { id: 'play.prevEdit', label: 'Ke titik edit sebelumnya', keys: ['↑'], run: () => jumpEdit(-1) },
  { id: 'play.nextEdit', label: 'Ke titik edit berikutnya', keys: ['↓'], run: () => jumpEdit(1) },
  { id: 'play.start', label: 'Ke awal sequence', keys: ['Home'], run: () => ui().setCurrentTime(0) },
  { id: 'play.end', label: 'Ke akhir sequence', keys: ['End'], run: () => ui().setCurrentTime(projectDuration(prj().project)) },
  { id: 'play.goto', label: 'Lompat ke timecode…', keys: ['Ctrl+G'], run: () => ui().setGotoOpen(true) },

  // Bantuan
  { id: 'help.shortcuts', label: 'Daftar pintasan', menu: 'Bantuan', keys: ['F1'], run: () => ui().setHelpOpen(true) },
];

// ---------- pencocokan tombol ----------

/** Ubah KeyboardEvent jadi string kombinasi yang sama formatnya dengan `keys`. */
export function comboOf(e: KeyboardEvent): string {
  const map: Record<string, string> = {
    ' ': 'Spasi', ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓',
    Escape: 'Esc', Delete: 'Delete', Backspace: 'Delete', Home: 'Home', End: 'End', F1: 'F1',
  };
  let k = map[e.key] ?? e.key;
  // Dengan Shift, e.key berubah jadi huruf besar / simbol; pakai e.code untuk huruf & angka.
  if (/^Key[A-Z]$/.test(e.code)) k = e.code.slice(3);
  else if (/^Digit\d$/.test(e.code) && (e.altKey || e.ctrlKey)) k = e.code.slice(5);
  else if (e.code === 'Equal') k = '=';
  else if (e.code === 'Minus') k = '-';
  else if (e.code === 'Backslash') k = '\\';
  else if (e.code === 'Comma') k = ',';
  else if (e.code === 'Period') k = '.';
  else if (e.code === 'Semicolon') k = ';';
  else if (e.code === 'Quote') k = "'";
  else if (e.code === 'NumpadAdd') k = '=';
  else if (e.code === 'NumpadSubtract') k = '-';
  else if (k.length === 1) k = k.toUpperCase();
  const mods: string[] = [];
  if (e.ctrlKey || e.metaKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  return [...mods, k].join('+');
}

const byCombo = new Map<string, Command>();
for (const c of COMMANDS) for (const k of c.keys ?? []) {
  if (!byCombo.has(k)) byCombo.set(k, c);
}
// Alias yang juga dikenal pengguna Premiere / dipertahankan dari versi lama.
const ALIASES: Record<string, string> = {
  'Ctrl+Y': 'edit.redo', 'Ctrl+E': 'file.export', 'Ctrl+B': 'seq.split', '?': 'help.shortcuts',
  'Shift+/': 'help.shortcuts', 'Shift+=': 'view.zoomIn', 'Ctrl+=': 'view.zoomIn', 'Ctrl+-': 'view.zoomOut',
};
for (const [k, id] of Object.entries(ALIASES)) {
  const c = COMMANDS.find((x) => x.id === id);
  if (c && !byCombo.has(k)) byCombo.set(k, c);
}

/**
 * Jalankan perintah yang cocok dengan tombol. Mengembalikan true bila ada.
 * Shift+M bentrok (Premiere: ke penanda berikutnya; versi lama: bisukan klip) -
 * di sini ikut Premiere.
 */
export function handleKey(e: KeyboardEvent, typing: boolean): boolean {
  const combo = comboOf(e);
  const cmd = byCombo.get(combo);
  if (!cmd) return false;
  if (typing && !cmd.whileTyping) return false;
  if (cmd.enabled && !cmd.enabled()) { e.preventDefault(); return true; }
  e.preventDefault();
  cmd.run();
  return true;
}
