// ============================================================
// NusaCut Studio - Web Worker transkripsi Whisper (lokal)
// Berjalan di thread terpisah supaya UI tidak macet saat inferensi.
// Dibuat dari sisi client dengan:
//   new Worker(new URL('./whisperWorker.ts', import.meta.url), { type: 'module' })
// ============================================================
import { pipeline, env } from '@huggingface/transformers';
import type {
  AutomaticSpeechRecognitionOutput,
  AutomaticSpeechRecognitionPipeline,
  PretrainedModelOptions,
} from '@huggingface/transformers';

// Signature generik pipeline() menghasilkan union tipe raksasa yang membuat
// TypeScript menyerah (TS2590); persempit tipenya khusus untuk task ASR.
const createAsrPipeline = pipeline as unknown as (
  task: 'automatic-speech-recognition',
  model?: string,
  options?: PretrainedModelOptions,
) => Promise<AutomaticSpeechRecognitionPipeline>;

// Model selalu diambil dari Hugging Face Hub (butuh internet saat pertama;
// setelah itu di-cache browser sehingga bisa offline).
env.allowLocalModels = false;

export type WhisperModelId = 'tiny' | 'base' | 'small';
export type WhisperLanguage = 'id' | 'en' | 'auto';

const MODEL_IDS: Record<WhisperModelId, string> = {
  tiny: 'onnx-community/whisper-tiny',
  base: 'onnx-community/whisper-base',
  small: 'onnx-community/whisper-small',
};

/** Pesan masuk dari main thread. */
export interface WhisperWorkerRequest {
  /** PCM mono 16 kHz. */
  audio: Float32Array;
  model: WhisperModelId;
  language: WhisperLanguage;
  /**
   * true  -> timestamp PER KATA (timing subtitle jauh lebih presisi;
   *          main thread yang menyusun kata menjadi cue).
   * false -> timestamp per segmen kalimat (perilaku lama).
   */
  wordTimestamps: boolean;
}

export interface WhisperChunk { start: number; end: number; text: string }

/** Pesan keluar ke main thread. */
export type WhisperWorkerResponse =
  | { type: 'progress'; message: string; pct: number | null }
  | { type: 'done'; granularity: 'word' | 'segment'; chunks: WhisperChunk[] }
  | { type: 'error'; message: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const post = (msg: WhisperWorkerResponse): void => { ctx.postMessage(msg); };

const SAMPLE_RATE = 16000;

ctx.onmessage = async (ev: MessageEvent<WhisperWorkerRequest>) => {
  try {
    const { audio, model, language, wordTimestamps } = ev.data;
    const modelId = MODEL_IDS[model] ?? MODEL_IDS.tiny;

    post({ type: 'progress', message: 'Menyiapkan model AI...', pct: null });

    // Buat pipeline ASR; progress unduhan model diteruskan ke main thread.
    const loadPipeline = (id: string) => createAsrPipeline('automatic-speech-recognition', id, {
      progress_callback: (info) => {
        if (info.status === 'progress') {
          post({
            type: 'progress',
            message: 'Mengunduh model AI (sekali saja)...',
            pct: typeof info.progress === 'number' && Number.isFinite(info.progress) ? Math.round(info.progress) : null,
          });
        } else if (info.status === 'initiate' || info.status === 'download') {
          post({ type: 'progress', message: 'Mengunduh model AI (sekali saja)...', pct: null });
        } else if (info.status === 'ready') {
          post({ type: 'progress', message: 'Model siap. Memulai transkripsi...', pct: null });
        }
      },
    });

    // Timestamp per kata butuh ekspor ONNX dengan cross-attentions:
    // varian "<model>_timestamped" dari onnx-community. Bila varian tidak
    // tersedia/gagal dimuat, mundur ke model biasa + timestamp segmen.
    let granularity: 'word' | 'segment' = wordTimestamps ? 'word' : 'segment';
    let asr: AutomaticSpeechRecognitionPipeline;
    if (wordTimestamps) {
      try {
        asr = await loadPipeline(`${modelId}_timestamped`);
      } catch {
        post({ type: 'progress', message: 'Varian per-kata tidak tersedia; memakai timestamp segmen...', pct: null });
        granularity = 'segment';
        asr = await loadPipeline(modelId);
      }
    } else {
      asr = await loadPipeline(modelId);
    }

    post({ type: 'progress', message: 'Mentranskripsi audio...', pct: null });

    const runAsr = (words: boolean) => asr(audio, {
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: words ? 'word' : true,
      ...(language !== 'auto' ? { language, task: 'transcribe' } : {}),
    });

    let result;
    try {
      result = await runAsr(granularity === 'word');
    } catch (e) {
      // Jaring pengaman terakhir: bila inferensi mode per-kata tetap gagal,
      // mundur ke timestamp segmen alih-alih gagal total.
      if (granularity !== 'word') throw e;
      const detail = e instanceof Error ? e.message : String(e);
      post({ type: 'progress', message: `Mode per-kata gagal (${detail.slice(0, 120)}); memakai timestamp segmen...`, pct: null });
      granularity = 'segment';
      result = await runAsr(false);
    }

    const out: AutomaticSpeechRecognitionOutput = Array.isArray(result) ? result[0] : result;

    const chunks: WhisperChunk[] = [];
    for (const c of out.chunks ?? []) {
      // Timestamp berbentuk [mulai, selesai]; "selesai" bisa null (chunk/kata terakhir).
      const [rawStart, rawEnd] = c.timestamp as unknown as [number | null, number | null];
      const start = typeof rawStart === 'number' && Number.isFinite(rawStart) ? Math.max(0, rawStart) : 0;
      const fallbackEnd = granularity === 'word'
        ? start + Math.max(0.15, c.text.trim().length * 0.06) // perkiraan durasi kata
        : start + 2;
      const end = typeof rawEnd === 'number' && Number.isFinite(rawEnd) && rawEnd > start ? rawEnd : fallbackEnd;
      chunks.push({ start, end, text: c.text });
    }

    // Fallback: model tidak memberi chunks tapi ada teks utuh -> satu cue sepanjang audio.
    if (chunks.length === 0 && out.text && out.text.trim().length > 0) {
      granularity = 'segment';
      chunks.push({ start: 0, end: Math.max(audio.length / SAMPLE_RATE, 2), text: out.text });
    }

    post({ type: 'done', granularity, chunks });
  } catch (err) {
    post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
