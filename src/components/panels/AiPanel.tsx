// ============================================================
// AiPanel - panel fitur AI dengan 4 tab:
//   subtitle : transkripsi otomatis (Whisper) -> SubtitleCue
//   bgremove : hapus latar belakang -> media WebM alpha baru
//   tts      : text-to-speech Windows -> asset audio (+ ke timeline)
//   autocut  : deteksi hening -> potong & ripple klip terpilih
// ============================================================
import { useEffect, useMemo, useState } from 'react';
import { useProject } from '../../store/projectStore';
import { useUi, type AiTab } from '../../store/uiStore';
import { bridge, type ImportedFile } from '../../bridge';
import { type Clip, type MediaAsset, type SubtitleCue, clipEnd, uid } from '../../types';
import { transcribeAudio } from '../../ai/whisper';
import { removeBackground } from '../../ai/bgremove';
import { planAutoCut, applyAutoCut, type AutoCutPlan } from '../../ai/autocut';

// ---------- helper bersama ----------

interface SelInfo { clip: Clip; asset: MediaAsset | null }

/** Ambil klip terpilih + asset-nya dari project (null bila tidak ada). */
function useSelectedClip(): SelInfo | null {
  const selId = useUi((s) => s.selectedClipId);
  const project = useProject((s) => s.project);
  return useMemo(() => {
    if (!selId) return null;
    for (const t of project.tracks) {
      const clip = t.clips.find((c) => c.id === selId);
      if (clip) {
        const asset = clip.assetId ? project.assets.find((a) => a.id === clip.assetId) ?? null : null;
        return { clip, asset };
      }
    }
    return null;
  }, [selId, project]);
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ---------- komponen kecil ----------

interface Prog { message: string; pct: number | null }

/** Indikator progres: pesan + bar bila pct tersedia (0..100). */
function ProgressBox({ prog }: { prog: Prog }) {
  return (
    <div style={{ marginTop: 10 }}>
      <div className="hint" style={{ marginBottom: 6 }}>{prog.message}</div>
      {prog.pct !== null && (
        <div className="progress">
          <div style={{ width: `${Math.max(0, Math.min(100, prog.pct))}%` }} />
        </div>
      )}
    </div>
  );
}

function SliderField(props: {
  label: string;
  display: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  onChange: (v: number) => void;
}) {
  return (
    <div className="field">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <span className="field-label">{props.label}</span>
        <span className="badge">{props.display}</span>
      </div>
      <input
        type="range"
        className="slider"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        disabled={props.disabled}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </div>
  );
}

// ============================================================
// TAB 1: SUBTITLE (Whisper)
// ============================================================

function SubtitleTab() {
  const sel = useSelectedClip();
  const selectClip = useUi((s) => s.selectClip);
  const showToast = useUi((s) => s.showToast);

  const [model, setModel] = useState<'tiny' | 'base' | 'small'>('base');
  const [language, setLanguage] = useState<'id' | 'en' | 'auto'>('id');
  const [cleanAudio, setCleanAudio] = useState(true);
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState<Prog | null>(null);

  const usable = sel && (sel.clip.kind === 'video' || sel.clip.kind === 'audio') && sel.asset
    ? { clip: sel.clip, asset: sel.asset }
    : null;

  const run = async () => {
    if (!usable || busy) return;
    const { clip, asset } = usable;
    setBusy(true);
    setProg({ message: 'Menyiapkan audio…', pct: null });
    try {
      const clipId = clip.id;
      // Snapshot rentang sumber yang diekstrak SEKARANG - audio diambil dari
      // rentang ini, jadi waktu RawCue selalu relatif terhadap oldSourceIn.
      const oldSourceIn = clip.sourceIn;
      const speed = clip.speed || 1;
      // ekstrak bagian sumber yang dipakai klip (durasi dalam waktu SUMBER)
      const { url } = await bridge.extractAudio(asset.path, oldSourceIn, clip.duration * speed, cleanAudio);
      const raws = await transcribeAudio(url, {
        model,
        language,
        wordTimestamps: true, // timing per kata -> cue subtitle presisi
        onProgress: (message, pct) => setProg({ message, pct }),
      });
      // Transkripsi bisa lama & timeline bisa diedit selama menunggu:
      // JANGAN pakai snapshot closure - baca ulang klip & subtitles TERKINI.
      const store = useProject.getState();
      let freshClip: Clip | null = null;
      for (const t of store.project.tracks) {
        const c = t.clips.find((x) => x.id === clipId);
        if (c) { freshClip = c; break; }
      }
      if (!freshClip) {
        showToast('Klip sudah dihapus selama transkripsi — hasil tidak diterapkan.');
        return;
      }
      const fc = freshClip;
      const fcSpeed = fc.speed || 1;
      const a = fc.start;
      const b = clipEnd(fc);
      // waktu RawCue relatif potongan audio (waktu SUMBER mulai oldSourceIn)
      // -> waktu timeline memakai posisi/trim/speed klip TERKINI;
      // cue di luar rentang klip terkini dibuang.
      const fresh: SubtitleCue[] = raws
        .map((r) => {
          const srcStart = oldSourceIn + r.start;
          const srcEnd = oldSourceIn + r.end;
          const start = fc.start + (srcStart - fc.sourceIn) / fcSpeed;
          const end = Math.max(fc.start + (srcEnd - fc.sourceIn) / fcSpeed, start + 0.2);
          return { id: uid('sub_'), start, end, text: r.text.trim() };
        })
        .filter((c) => c.text.length > 0 && c.start < b && c.end > a)
        .map((c) => ({ ...c, start: Math.max(a, c.start), end: Math.min(b, c.end) }))
        .filter((c) => c.end - c.start > 0.05);
      // buang cue lama yang overlap rentang klip TERKINI, lalu gabung + urutkan
      const kept = store.project.subtitles.filter((c) => c.end <= a || c.start >= b);
      store.setSubtitles([...kept, ...fresh].sort((x, y) => x.start - y.start));
      showToast(`Transkripsi selesai: ${fresh.length} subtitle dibuat.`);
      selectClip(null); // Inspector akan menampilkan daftar subtitle
    } catch (err) {
      showToast(`Transkripsi gagal: ${errMsg(err)}`);
    } finally {
      setBusy(false);
      setProg(null);
    }
  };

  return (
    <div>
      <p className="hint" style={{ marginBottom: 12 }}>
        Transkripsi otomatis audio klip terpilih menjadi subtitle.
        Model AI diunduh sekali saat pertama kali dipakai, selanjutnya offline.
      </p>

      <div className="field">
        <label className="field-label">Model</label>
        <select
          className="select"
          value={model}
          disabled={busy}
          onChange={(e) => setModel(e.target.value as 'tiny' | 'base' | 'small')}
        >
          <option value="tiny">Cepat (tiny, ±40MB)</option>
          <option value="base">Seimbang (base, ±80MB)</option>
          <option value="small">Paling akurat (small, ±250MB)</option>
        </select>
      </div>

      <div className="field">
        <label className="field-row" style={{ cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={cleanAudio}
            disabled={busy}
            onChange={(e) => setCleanAudio(e.target.checked)}
          />
          <span className="field-label">Bersihkan audio dulu (reduksi noise — disarankan)</span>
        </label>
      </div>

      <div className="field">
        <label className="field-label">Bahasa</label>
        <select
          className="select"
          value={language}
          disabled={busy}
          onChange={(e) => setLanguage(e.target.value as 'id' | 'en' | 'auto')}
        >
          <option value="id">Indonesia</option>
          <option value="en">Inggris</option>
          <option value="auto">Deteksi otomatis</option>
        </select>
      </div>

      {!usable ? (
        <div className="empty-state">
          Pilih klip video/audio di timeline<br />untuk mulai transkripsi.
        </div>
      ) : (
        <button className="btn btn-primary" style={{ width: '100%' }} disabled={busy} onClick={run}>
          🎙 Transkripsi Klip Ini
        </button>
      )}

      {busy && prog && <ProgressBox prog={prog} />}
    </div>
  );
}

// ============================================================
// TAB 2: HAPUS BACKGROUND
// ============================================================

function BgRemoveTab() {
  const sel = useSelectedClip();
  const addAssets = useProject((s) => s.addAssets);
  const showToast = useUi((s) => s.showToast);

  const [maxDuration, setMaxDuration] = useState(30);
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState<Prog | null>(null);

  const usable = sel && sel.clip.kind === 'video' && sel.asset
    ? { clip: sel.clip, asset: sel.asset }
    : null;

  const run = async () => {
    if (!usable || busy) return;
    const { clip, asset } = usable;
    setBusy(true);
    setProg({ message: 'Memuat model…', pct: null });
    try {
      const file: ImportedFile = await removeBackground(asset, {
        maxDuration,
        // proses bagian sumber yang benar-benar dipakai klip terpilih
        startTime: clip.sourceIn,
        clipDuration: clip.duration * (clip.speed || 1),
        onProgress: (message, pct) => setProg({ message, pct }),
      });
      // lengkapi metadata via probe, tandai punya alpha
      const info = await bridge.probe(file.path);
      const newAsset: MediaAsset = {
        id: uid('ast_'),
        name: file.name,
        type: 'video',
        path: file.path,
        url: file.url,
        duration: info.duration,
        width: info.width,
        height: info.height,
        hasAudio: info.hasAudio,
        hasAlpha: true,
      };
      addAssets([newAsset]); // klip asal TIDAK diubah
      showToast('Media baru ditambahkan ke panel Media (latar belakang dihapus).');
    } catch (err) {
      showToast(`Hapus background gagal: ${errMsg(err)}`);
    } finally {
      setBusy(false);
      setProg(null);
    }
  };

  return (
    <div>
      <p className="hint" style={{ marginBottom: 12 }}>
        Menghapus latar belakang orang tanpa green screen. Hasilnya menjadi media baru
        (WebM transparan) di panel Media. Proses cukup berat — batasi durasinya.
      </p>

      <SliderField
        label="Durasi maks"
        display={`${maxDuration} dtk`}
        value={maxDuration}
        min={5}
        max={60}
        step={1}
        disabled={busy}
        onChange={setMaxDuration}
      />

      {!usable ? (
        <div className="empty-state">
          Pilih klip video di timeline<br />untuk menghapus background-nya.
        </div>
      ) : (
        <button className="btn btn-primary" style={{ width: '100%' }} disabled={busy} onClick={run}>
          ✨ Hapus Background
        </button>
      )}

      {busy && prog && <ProgressBox prog={prog} />}
    </div>
  );
}

// ============================================================
// TAB 3: SUARA AI (TTS Windows)
// ============================================================

// cache daftar suara di level modul agar hanya dimuat sekali
let voicesCache: string[] | null = null;

function TtsTab() {
  const tracks = useProject((s) => s.project.tracks);
  const addAssets = useProject((s) => s.addAssets);
  const addClipFromAsset = useProject((s) => s.addClipFromAsset);
  const currentTime = useUi((s) => s.currentTime);
  const showToast = useUi((s) => s.showToast);

  const [text, setText] = useState('Halo! Selamat datang di video saya. Jangan lupa like dan subscribe.');
  const [voices, setVoices] = useState<string[] | null>(voicesCache);
  const [voice, setVoice] = useState(''); // '' = suara default
  const [rate, setRate] = useState(0);
  const [addToTimeline, setAddToTimeline] = useState(true);
  const [busy, setBusy] = useState(false);

  // muat daftar suara sekali saat tab pertama kali dibuka
  useEffect(() => {
    if (voicesCache !== null) return;
    let alive = true;
    bridge.ttsVoices()
      .then((v) => { voicesCache = v; if (alive) setVoices(v); })
      .catch(() => { voicesCache = []; if (alive) setVoices([]); });
    return () => { alive = false; };
  }, []);

  const run = async () => {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      const res = await bridge.tts({ text: t, voice: voice || undefined, rate });
      const asset: MediaAsset = {
        id: uid('ast_'),
        name: 'TTS - ' + (t.length > 24 ? t.slice(0, 24) + '…' : t),
        type: 'audio',
        path: res.path,
        url: res.url,
        duration: res.duration,
        hasAudio: true,
      };
      addAssets([asset]);
      let placed = false;
      if (addToTimeline) {
        const audioTrack = tracks.find((tr) => tr.kind === 'audio');
        if (audioTrack) {
          addClipFromAsset(audioTrack.id, asset.id, currentTime);
          placed = true;
        }
      }
      showToast(placed
        ? 'Narasi dibuat & ditambahkan ke timeline.'
        : 'Narasi dibuat & ditambahkan ke panel Media.');
    } catch (err) {
      showToast(`Pembuatan suara gagal: ${errMsg(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <p className="hint" style={{ marginBottom: 12 }}>
        Ubah teks menjadi narasi suara memakai suara bawaan Windows — sepenuhnya offline.
      </p>

      <div className="field">
        <label className="field-label">Teks narasi</label>
        <textarea
          className="textarea"
          value={text}
          disabled={busy}
          onChange={(e) => setText(e.target.value)}
          placeholder="Tulis teks yang ingin diubah menjadi suara…"
        />
      </div>

      <div className="field">
        <label className="field-label">Suara</label>
        <select
          className="select"
          value={voice}
          disabled={busy || voices === null}
          onChange={(e) => setVoice(e.target.value)}
        >
          {voices === null ? (
            <option value="">Memuat daftar suara…</option>
          ) : (
            <>
              <option value="">Suara default</option>
              {voices.map((v) => (
                <option key={v} value={v}>{v}</option>
              ))}
            </>
          )}
        </select>
      </div>

      <SliderField
        label="Kecepatan"
        display={rate > 0 ? `+${rate}` : `${rate}`}
        value={rate}
        min={-5}
        max={5}
        step={1}
        disabled={busy}
        onChange={setRate}
      />

      <label className="field-row" style={{ marginBottom: 12, cursor: 'pointer' }}>
        <input
          type="checkbox"
          checked={addToTimeline}
          disabled={busy}
          onChange={(e) => setAddToTimeline(e.target.checked)}
        />
        <span className="field-label">Langsung tambahkan ke timeline</span>
      </label>

      <button
        className="btn btn-primary"
        style={{ width: '100%' }}
        disabled={busy || !text.trim()}
        onClick={run}
      >
        🔊 Buat Suara
      </button>

      {busy && <div className="hint" style={{ marginTop: 10 }}>Membuat narasi…</div>}
    </div>
  );
}

// ============================================================
// TAB 4: AUTO CUT (buang hening)
// ============================================================

/** Snapshot geometri klip saat Analisis - plan hanya valid selama nilai ini tidak berubah. */
interface ClipSnapshot {
  clipId: string;
  start: number;
  duration: number;
  sourceIn: number;
  speed: number;
}

function AutoCutTab() {
  const sel = useSelectedClip();
  const selId = useUi((s) => s.selectedClipId);
  const showToast = useUi((s) => s.showToast);

  const [thresholdDb, setThresholdDb] = useState(-35);
  const [minSilence, setMinSilence] = useState(0.6);
  const [padding, setPadding] = useState(0.1);
  const [busy, setBusy] = useState(false);
  const [planState, setPlanState] = useState<{ plan: AutoCutPlan; snap: ClipSnapshot } | null>(null);

  // plan tidak valid lagi bila seleksi klip berganti
  useEffect(() => { setPlanState(null); }, [selId]);

  const usable = sel && (sel.clip.kind === 'video' || sel.clip.kind === 'audio') && sel.asset
    ? { clip: sel.clip, asset: sel.asset }
    : null;

  const analyze = async () => {
    if (!usable || busy) return;
    const { clip, asset } = usable;
    setBusy(true);
    setPlanState(null);
    try {
      const p = await planAutoCut(clip, asset, { thresholdDb, minSilence, padding });
      if (p.removedCount === 0) {
        showToast('Tidak ada bagian hening terdeteksi. Coba naikkan ambang dB.');
      } else {
        setPlanState({
          plan: p,
          snap: {
            clipId: clip.id,
            start: clip.start,
            duration: clip.duration,
            sourceIn: clip.sourceIn,
            speed: clip.speed,
          },
        });
      }
    } catch (err) {
      showToast(`Analisis gagal: ${errMsg(err)}`);
    } finally {
      setBusy(false);
    }
  };

  const apply = () => {
    if (!planState || planState.plan.removedCount === 0) return;
    const { plan, snap } = planState;
    // Validasi terhadap klip TERKINI di store: plan dihitung dari geometri
    // klip saat Analisis; bila klip hilang/berubah, plan sudah basi.
    const project = useProject.getState().project;
    let fresh: Clip | null = null;
    for (const t of project.tracks) {
      const c = t.clips.find((x) => x.id === snap.clipId);
      if (c) { fresh = c; break; }
    }
    if (
      !fresh ||
      fresh.start !== snap.start ||
      fresh.duration !== snap.duration ||
      fresh.sourceIn !== snap.sourceIn ||
      fresh.speed !== snap.speed
    ) {
      showToast('Klip berubah setelah analisis — jalankan Analisis ulang.');
      setPlanState(null);
      return;
    }
    const ok = applyAutoCut(snap.clipId, plan);
    showToast(ok
      ? `Auto cut diterapkan: ${plan.removedCount} bagian hening dihapus.`
      : 'Auto cut tidak diterapkan — tidak ada perubahan pada klip.');
    setPlanState(null);
  };

  return (
    <div>
      <p className="hint" style={{ marginBottom: 12 }}>
        Deteksi lalu buang bagian hening dari klip terpilih.
        Potongan yang tersisa merapat otomatis (ripple).
      </p>

      <SliderField
        label="Ambang (dB)"
        display={`${thresholdDb} dB`}
        value={thresholdDb}
        min={-60}
        max={-20}
        step={1}
        disabled={busy}
        onChange={setThresholdDb}
      />
      <SliderField
        label="Min. hening"
        display={`${minSilence.toFixed(1)} dtk`}
        value={minSilence}
        min={0.2}
        max={2}
        step={0.1}
        disabled={busy}
        onChange={setMinSilence}
      />
      <SliderField
        label="Padding"
        display={`${padding.toFixed(2)} dtk`}
        value={padding}
        min={0}
        max={0.5}
        step={0.05}
        disabled={busy}
        onChange={setPadding}
      />

      {!usable ? (
        <div className="empty-state">
          Pilih klip video/audio di timeline<br />untuk dianalisis.
        </div>
      ) : (
        <>
          <button className="btn" style={{ width: '100%' }} disabled={busy} onClick={analyze}>
            🔍 Analisis
          </button>
          {busy && <div className="hint" style={{ marginTop: 10 }}>Menganalisis audio…</div>}

          {planState && planState.plan.removedCount > 0 && (
            planState.plan.keptSegments.length === 0 ? (
              <div className="card" style={{ cursor: 'default', marginTop: 12 }}>
                <div style={{ fontSize: 12.5, lineHeight: 1.6 }}>
                  Seluruh klip terdeteksi <b>hening</b> — tidak ada bagian yang
                  tersisa untuk dipertahankan, jadi tidak ada yang bisa diterapkan.
                  Bila klip ini memang tidak diperlukan, hapus secara manual
                  (pilih klip lalu tekan Delete).
                </div>
              </div>
            ) : (
              <>
                <div className="card" style={{ cursor: 'default', marginTop: 12 }}>
                  <div style={{ fontSize: 12.5, lineHeight: 1.6 }}>
                    Ditemukan <b>{planState.plan.removedCount}</b> bagian hening
                    (total <b>{planState.plan.removedDuration.toFixed(1)} dtk</b> akan dihapus,
                    klip menjadi <b>{planState.plan.keptSegments.length}</b> segmen).
                  </div>
                </div>
                <button
                  className="btn btn-primary"
                  style={{ width: '100%', marginTop: 10 }}
                  onClick={apply}
                >
                  ✂ Terapkan
                </button>
              </>
            )
          )}
        </>
      )}
    </div>
  );
}

// ============================================================
// Panel utama
// ============================================================

const AI_TABS: { id: AiTab; label: string }[] = [
  { id: 'subtitle', label: 'Subtitle' },
  { id: 'bgremove', label: 'Hapus BG' },
  { id: 'tts', label: 'Suara AI' },
  { id: 'autocut', label: 'Auto Cut' },
];

export default function AiPanel() {
  const aiTab = useUi((s) => s.aiTab);
  const setAiTab = useUi((s) => s.setAiTab);

  return (
    <div>
      <div className="panel-title">Fitur AI</div>
      <div className="panel-body">
        <div className="tabs" style={{ marginBottom: 14 }}>
          {AI_TABS.map((t) => (
            <button
              key={t.id}
              className={`tab ${aiTab === t.id ? 'active' : ''}`}
              onClick={() => setAiTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {aiTab === 'subtitle' && <SubtitleTab />}
        {aiTab === 'bgremove' && <BgRemoveTab />}
        {aiTab === 'tts' && <TtsTab />}
        {aiTab === 'autocut' && <AutoCutTab />}
      </div>
    </div>
  );
}
