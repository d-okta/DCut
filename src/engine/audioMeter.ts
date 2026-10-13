// ============================================================
// Meter audio: semua elemen <video>/<audio> di Program Monitor
// dialirkan lewat satu AudioContext, lalu diukur dengan
// AnalyserNode kiri/kanan. Nilai yang dibaca meter = dBFS puncak.
// ============================================================

let ctx: AudioContext | null = null;
let splitter: ChannelSplitterNode | null = null;
const analysers: AnalyserNode[] = [];
const attached = new WeakSet<HTMLMediaElement>();

function ensure(): AudioContext | null {
  if (ctx) return ctx;
  const AC = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  splitter = ctx.createChannelSplitter(2);
  const merger = ctx.createChannelMerger(2);
  for (let i = 0; i < 2; i++) {
    const a = ctx.createAnalyser();
    a.fftSize = 1024;
    a.smoothingTimeConstant = 0;
    splitter.connect(a, i);
    a.connect(merger, 0, i);
    analysers.push(a);
  }
  merger.connect(ctx.destination);
  // Browser menahan AudioContext sampai ada interaksi pengguna.
  const resume = () => { void ctx?.resume(); };
  window.addEventListener('pointerdown', resume);
  window.addEventListener('keydown', resume);
  return ctx;
}

/**
 * Sambungkan elemen media ke meter. Aman dipanggil berkali-kali.
 * Elemen dari asal lain tanpa CORS tidak bisa diukur (browser membisukannya),
 * jadi elemen wajib ber-crossOrigin="anonymous" dan server mengirim CORS.
 */
export function attachMeter(el: HTMLMediaElement): void {
  if (attached.has(el)) return;
  const c = ensure();
  if (!c || !splitter) return;
  try {
    const src = c.createMediaElementSource(el);
    src.connect(splitter);
    attached.add(el);
  } catch {
    // elemen sudah tersambung ke konteks lain; biarkan berbunyi tanpa diukur
  }
}

const buf = new Float32Array(1024);

/** Level puncak tiap kanal dalam dBFS (-Infinity = hening). */
export function readLevels(): [number, number] {
  if (!analysers.length) return [-Infinity, -Infinity];
  const out: number[] = [];
  for (const a of analysers) {
    a.getFloatTimeDomainData(buf);
    let peak = 0;
    for (let i = 0; i < buf.length; i++) {
      const v = Math.abs(buf[i]);
      if (v > peak) peak = v;
    }
    out.push(peak > 0 ? 20 * Math.log10(peak) : -Infinity);
  }
  return [out[0], out[1]];
}
