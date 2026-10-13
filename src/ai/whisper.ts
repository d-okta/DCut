// ============================================================
// Diandra Cut - API transkripsi Whisper (main thread)
// Ambil audio WAV (URL dari bridge.extractAudio), decode ke PCM
// mono 16 kHz, lalu kirim ke Web Worker (whisperWorker.ts) yang
// menjalankan Whisper secara lokal via @huggingface/transformers.
// Catatan: model diunduh dari internet saat pemakaian pertama,
// setelah itu di-cache browser.
// ============================================================
import type { WhisperWorkerRequest, WhisperWorkerResponse } from './whisperWorker';

export interface TranscribeOptions {
  model: 'tiny' | 'base' | 'small';
  language: 'id' | 'en' | 'auto';
  onProgress: (message: string, pct: number | null) => void;
  /**
   * Timestamp per KATA lalu disusun ulang menjadi cue subtitle yang rapi
   * (timing jauh lebih presisi daripada segmen 30 detik). Default: true.
   * Bila model/backend tidak mendukung, otomatis mundur ke segmen.
   */
  wordTimestamps?: boolean;
}

export interface RawCue { start: number; end: number; text: string }

// ---------- Penyusunan kata -> cue subtitle ----------

/** Aturan tampilan subtitle yang enak dibaca. */
const MAX_CUE_CHARS = 42;   // panjang baris subtitle umum
const MAX_CUE_DUR = 5.0;    // detik maksimum satu cue
const GAP_BREAK = 0.6;      // jeda bicara >= ini memulai cue baru
const MIN_CUE_DUR = 0.3;

/**
 * Susun daftar kata bertimestamp menjadi cue subtitle:
 * pecah pada jeda bicara, akhir kalimat, batas panjang, dan batas durasi.
 */
export function wordsToCues(words: RawCue[]): RawCue[] {
  const cues: RawCue[] = [];
  let cur: RawCue | null = null;

  const push = () => {
    if (!cur) return;
    const text = cur.text.replace(/\s+/g, ' ').trim();
    if (text) cues.push({ start: cur.start, end: Math.max(cur.end, cur.start + MIN_CUE_DUR), text });
    cur = null;
  };

  for (const w of words) {
    const t = w.text; // biasanya berawalan spasi dari tokenizer
    if (!t.trim()) continue;
    if (!cur) {
      cur = { start: w.start, end: w.end, text: t };
      continue;
    }
    const gap = w.start - cur.end;
    const curText = cur.text.trim();
    const wouldLen = (curText + ' ' + t.trim()).length;
    const sentenceDone = /[.!?…]["')]?$/.test(curText);
    if (
      gap > GAP_BREAK ||
      wouldLen > MAX_CUE_CHARS ||
      (sentenceDone && curText.length >= 12) ||
      w.end - cur.start > MAX_CUE_DUR
    ) {
      push();
      cur = { start: w.start, end: w.end, text: t };
    } else {
      cur.text += t.startsWith(' ') ? t : ' ' + t;
      cur.end = Math.max(cur.end, w.end);
    }
  }
  push();

  // Gabungkan fragmen buntut yang terlalu pendek (mis. "channel." sendirian
  // karena batas panjang terlewati satu kata sebelum akhir kalimat) ke cue
  // sebelumnya, selama tanpa jeda bicara dan hasil gabungan masih wajar.
  const HARD_MAX_CHARS = 60;
  const merged: RawCue[] = [];
  for (const cue of cues) {
    const prev = merged[merged.length - 1];
    const tiny = cue.text.length <= 16 || cue.end - cue.start < 0.8;
    if (
      prev && tiny &&
      cue.start - prev.end < 0.3 &&
      (prev.text + ' ' + cue.text).length <= HARD_MAX_CHARS
    ) {
      prev.text += ' ' + cue.text;
      prev.end = cue.end;
    } else {
      merged.push({ ...cue });
    }
  }

  // Pastikan cue tidak saling tumpang tindih (end <= start cue berikutnya).
  for (let i = 0; i < merged.length - 1; i++) {
    if (merged[i].end > merged[i + 1].start) merged[i].end = Math.max(merged[i].start + 0.1, merged[i + 1].start);
  }
  return merged;
}

const TARGET_RATE = 16000;
const TIMEOUT_MS = 15 * 60 * 1000; // batas keseluruhan 15 menit

/** Decode buffer audio (WAV) menjadi PCM mono Float32Array 16 kHz. */
async function decodeTo16kMono(buf: ArrayBuffer): Promise<Float32Array> {
  // AudioContext dengan sampleRate 16000: browser umumnya langsung
  // me-resample hasil decode ke rate context.
  const ac = new AudioContext({ sampleRate: TARGET_RATE });
  let decoded: AudioBuffer;
  try {
    decoded = await ac.decodeAudioData(buf);
  } finally {
    ac.close().catch(() => { /* abaikan */ });
  }

  // Jaga-jaga: bila hasil decode bukan 16 kHz, resample sederhana via OfflineAudioContext.
  if (decoded.sampleRate !== TARGET_RATE) {
    const length = Math.max(1, Math.ceil(decoded.duration * TARGET_RATE));
    const oac = new OfflineAudioContext(1, length, TARGET_RATE);
    const src = oac.createBufferSource();
    src.buffer = decoded;
    src.connect(oac.destination);
    src.start(0);
    decoded = await oac.startRendering();
  }

  // Salin channel 0 supaya buffer aman untuk di-transfer ke worker.
  return decoded.getChannelData(0).slice();
}

/**
 * Transkripsi audio pada wavUrl menjadi daftar cue mentah {start,end,text}.
 * Progress (termasuk unduhan model saat pertama kali) dilaporkan lewat opts.onProgress.
 */
export async function transcribeAudio(wavUrl: string, opts: TranscribeOptions): Promise<RawCue[]> {
  return await new Promise<RawCue[]>((resolve, reject) => {
    let worker: Worker | null = null;
    let settled = false;

    const timer = setTimeout(() => {
      fail(new Error('Transkripsi melebihi batas waktu 15 menit. Coba klip yang lebih pendek atau model "tiny".'));
    }, TIMEOUT_MS);

    const cleanup = () => {
      settled = true;
      clearTimeout(timer);
      if (worker) { worker.terminate(); worker = null; }
    };
    const fail = (e: Error) => { if (!settled) { cleanup(); reject(e); } };
    const finish = (cues: RawCue[]) => { if (!settled) { cleanup(); resolve(cues); } };

    (async () => {
      opts.onProgress('Memuat audio...', null);
      const resp = await fetch(wavUrl);
      if (!resp.ok) throw new Error(`Gagal memuat audio (HTTP ${resp.status}).`);
      const buf = await resp.arrayBuffer();

      opts.onProgress('Menyiapkan audio (16 kHz mono)...', null);
      const audio = await decodeTo16kMono(buf);
      if (settled) return; // timeout sudah terjadi saat decode

      worker = new Worker(new URL('./whisperWorker.ts', import.meta.url), { type: 'module' });

      worker.onmessage = (ev: MessageEvent<WhisperWorkerResponse>) => {
        const msg = ev.data;
        if (msg.type === 'progress') {
          opts.onProgress(msg.message, msg.pct);
          return;
        }
        if (msg.type === 'done') {
          const raw = msg.chunks
            .map((c) => ({ start: c.start, end: c.end, text: c.text }))
            .filter((c) => c.text.trim().length > 0);
          // Mode per-kata: susun kata menjadi cue subtitle yang rapi;
          // mode segmen: pakai apa adanya (di-trim).
          finish(
            msg.granularity === 'word'
              ? wordsToCues(raw)
              : raw.map((c) => ({ ...c, text: c.text.trim() })),
          );
          return;
        }
        fail(new Error(msg.message || 'Transkripsi gagal.'));
      };
      worker.onerror = (ev) => { fail(new Error(ev.message || 'Worker Whisper mengalami kesalahan.')); };

      const req: WhisperWorkerRequest = {
        audio,
        model: opts.model,
        language: opts.language,
        wordTimestamps: opts.wordTimestamps !== false,
      };
      // Transfer buffer audio (zero-copy) ke worker.
      worker.postMessage(req, [audio.buffer as ArrayBuffer]);
      opts.onProgress('Memuat model AI... (perlu internet saat pertama kali)', null);
    })().catch((e: unknown) => {
      fail(e instanceof Error ? e : new Error(String(e)));
    });
  });
}
