// ============================================================
// Puncak waveform per aset: audio didekode sekali (Web Audio),
// diringkas jadi 100 puncak per detik, lalu di-cache per URL.
// File besar (> 300 MB) dilewati supaya memori tidak membengkak.
// ============================================================

const PEAKS_PER_SEC = 100;
const MAX_BYTES = 300 * 1024 * 1024;
const cache = new Map<string, Promise<Float32Array | null>>();

export function loadPeaks(url: string): Promise<Float32Array | null> {
  let p = cache.get(url);
  if (!p) {
    p = decode(url).catch(() => null);
    cache.set(url, p);
  }
  return p;
}

async function decode(url: string): Promise<Float32Array | null> {
  const res = await fetch(url);
  const len = Number(res.headers.get('content-length') || 0);
  if (len > MAX_BYTES) return null;
  const buf = await res.arrayBuffer();
  const AC = window.OfflineAudioContext;
  if (!AC) return null;
  // Konteks offline kecil hanya untuk decodeAudioData.
  const ctx = new AC(1, 1, 44100);
  const audio = await ctx.decodeAudioData(buf);
  const n = Math.max(1, Math.ceil(audio.duration * PEAKS_PER_SEC));
  const out = new Float32Array(n);
  const step = audio.length / n;
  for (let ch = 0; ch < audio.numberOfChannels; ch++) {
    const data = audio.getChannelData(ch);
    for (let i = 0; i < n; i++) {
      const a = Math.floor(i * step), b = Math.min(data.length, Math.floor((i + 1) * step));
      let pk = out[i];
      for (let j = a; j < b; j += 4) { const v = Math.abs(data[j]); if (v > pk) pk = v; }
      out[i] = pk;
    }
  }
  return out;
}
