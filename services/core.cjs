// ============================================================
// DCut - layanan backend inti (dipakai Electron main & dev-server).
// Semua fungsi berbasis ffmpeg-static + PowerShell (TTS/dialog).
// ============================================================
const { spawn, execFile } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');

const ffmpegPath = require('ffmpeg-static');

const WORK_DIR = path.join(os.tmpdir(), 'dcut-work');
fs.mkdirSync(WORK_DIR, { recursive: true });

const MEDIA_PORT = 5174;

function mediaUrl(filePath) {
  return `http://localhost:${MEDIA_PORT}/media?path=${encodeURIComponent(filePath)}`;
}

function runFfmpeg(args, { onStderr } = {}) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = '';
    proc.stderr.on('data', (d) => {
      const s = d.toString();
      stderr += s;
      if (onStderr) onStderr(s);
    });
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve({ stderr });
      else reject(new Error(`ffmpeg exit ${code}:\n${stderr.slice(-2000)}`));
    });
  });
}

// ---------- Probe (parse output `ffmpeg -i`) ----------

async function probe(filePath) {
  let stderr = '';
  try {
    await runFfmpeg(['-hide_banner', '-i', filePath], { onStderr: (s) => (stderr += s) });
  } catch (e) {
    // `ffmpeg -i` tanpa output selalu exit != 0; info ada di stderr.
    stderr = e.message;
  }
  const durMatch = stderr.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/);
  let duration = 0;
  if (durMatch) {
    duration = Number(durMatch[1]) * 3600 + Number(durMatch[2]) * 60 + Number(durMatch[3]);
  }
  const videoMatch = stderr.match(/Stream #.*Video:.* (\d{2,5})x(\d{2,5})/);
  const fpsMatch = stderr.match(/(\d+(?:\.\d+)?)\s*fps/);
  const hasAudio = /Stream #.*Audio:/.test(stderr);
  return {
    duration,
    width: videoMatch ? Number(videoMatch[1]) : undefined,
    height: videoMatch ? Number(videoMatch[2]) : undefined,
    hasAudio,
    fps: fpsMatch ? Number(fpsMatch[1]) : undefined,
  };
}

// ---------- Ekstrak audio untuk Whisper ----------

async function extractAudio(filePath, from, duration, clean) {
  const attempt = async (af) => {
    const out = path.join(WORK_DIR, `audio_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.wav`);
    const args = ['-y', '-hide_banner'];
    if (from > 0) args.push('-ss', String(from));
    args.push('-i', filePath);
    if (duration > 0) args.push('-t', String(duration));
    args.push('-vn', '-ac', '1', '-ar', '16000');
    if (af) args.push('-af', af);
    args.push('-f', 'wav', out);
    await runFfmpeg(args);
    return { url: mediaUrl(out), path: out };
  };

  if (clean) {
    // Pembersihan untuk transkripsi: buang dengung rendah, reduksi noise,
    // dan ratakan volume - meningkatkan akurasi Whisper pada rekaman lapangan.
    try {
      return await attempt('highpass=f=70,afftdn=nf=-22,dynaudnorm=f=200:g=15');
    } catch {
      try {
        // build ffmpeg tanpa afftdn: tetap highpass + normalisasi
        return await attempt('highpass=f=70,dynaudnorm=f=200:g=15');
      } catch { /* jatuh ke ekstraksi polos */ }
    }
  }
  return attempt(null);
}

// ---------- Deteksi hening (auto-cut) ----------

async function detectSilence(filePath, thresholdDb = -35, minDuration = 0.6) {
  let stderr = '';
  await runFfmpeg(
    ['-hide_banner', '-i', filePath, '-af', `silencedetect=noise=${thresholdDb}dB:d=${minDuration}`, '-f', 'null', '-'],
    { onStderr: (s) => (stderr += s) },
  );
  const silences = [];
  const re = /silence_start:\s*([\d.]+)[\s\S]*?silence_end:\s*([\d.]+)/g;
  let m;
  while ((m = re.exec(stderr)) !== null) {
    silences.push({ start: Number(m[1]), end: Number(m[2]) });
  }
  // silence_start tanpa silence_end = hening sampai akhir file
  const starts = [...stderr.matchAll(/silence_start:\s*([\d.]+)/g)].length;
  if (starts > silences.length) {
    const lastStart = [...stderr.matchAll(/silence_start:\s*([\d.]+)/g)].pop();
    if (lastStart) {
      const info = await probe(filePath);
      silences.push({ start: Number(lastStart[1]), end: info.duration });
    }
  }
  return { silences };
}

// ---------- TTS Windows (System.Speech) ----------

function runPowerShellScript(script) {
  return new Promise((resolve, reject) => {
    const psFile = path.join(WORK_DIR, `ps_${Date.now()}_${Math.random().toString(36).slice(2, 6)}.ps1`);
    // Prelude: paksa stdout PS 5.1 ke UTF-8 (default-nya codepage OEM,
    // yang merusak path/nama voice non-ASCII saat didecode Node sebagai UTF-8).
    const prelude = '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\n';
    fs.writeFileSync(psFile, '﻿' + prelude + script, 'utf8'); // BOM agar PowerShell baca UTF-8
    execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', psFile],
      { windowsHide: true, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderrOut) => {
        try { fs.unlinkSync(psFile); } catch {}
        if (err) reject(new Error(`PowerShell: ${err.message}\n${stderrOut}`));
        else resolve(stdout);
      },
    );
  });
}

async function ttsVoices() {
  const out = await runPowerShellScript(`
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name }
`);
  return out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
}

async function tts({ text, voice, rate }) {
  const out = path.join(WORK_DIR, `tts_${Date.now()}.wav`);
  const textFile = path.join(WORK_DIR, `tts_text_${Date.now()}.txt`);
  fs.writeFileSync(textFile, text, 'utf8');
  const voiceLine = voice ? `$s.SelectVoice('${String(voice).replace(/'/g, "''")}')` : '';
  await runPowerShellScript(`
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
${voiceLine}
$s.Rate = ${Math.max(-10, Math.min(10, Math.round(rate || 0)))}
$s.SetOutputToWaveFile('${out.replace(/'/g, "''")}')
$text = [System.IO.File]::ReadAllText('${textFile.replace(/'/g, "''")}', [System.Text.Encoding]::UTF8)
$s.Speak($text)
$s.Dispose()
`);
  try { fs.unlinkSync(textFile); } catch {}
  const info = await probe(out);
  return { path: out, url: mediaUrl(out), duration: info.duration };
}

// ---------- Simpan video hasil background-removal ----------

function saveProcessedVideo(buffer, baseName) {
  const safe = String(baseName).replace(/[^\w.-]+/g, '_').slice(0, 60) || 'processed';
  const out = path.join(WORK_DIR, `${safe}_${Date.now()}.webm`);
  fs.writeFileSync(out, Buffer.from(buffer));
  return { path: out, name: path.basename(out), url: mediaUrl(out) };
}

// ---------- Dialog file via PowerShell (untuk mode dev browser) ----------

async function pickMediaDialog() {
  const out = await runPowerShellScript(`
Add-Type -AssemblyName System.Windows.Forms
$dlg = New-Object System.Windows.Forms.OpenFileDialog
$dlg.Multiselect = $true
$dlg.Title = 'Pilih media - DCut'
$dlg.Filter = 'Media|*.mp4;*.mov;*.mkv;*.webm;*.avi;*.mp3;*.wav;*.m4a;*.aac;*.ogg;*.jpg;*.jpeg;*.png;*.gif;*.bmp;*.webp|Semua file|*.*'
if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $dlg.FileNames }
`);
  return out
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((p) => ({ path: p, name: path.basename(p), url: mediaUrl(p) }));
}

async function saveFileDialog(defaultName, filter) {
  const out = await runPowerShellScript(`
Add-Type -AssemblyName System.Windows.Forms
$dlg = New-Object System.Windows.Forms.SaveFileDialog
$dlg.FileName = '${String(defaultName).replace(/'/g, "''")}'
$dlg.Filter = '${filter}'
if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $dlg.FileName }
`);
  const p = out.trim();
  return p || null;
}

async function openFileDialog(filter) {
  const out = await runPowerShellScript(`
Add-Type -AssemblyName System.Windows.Forms
$dlg = New-Object System.Windows.Forms.OpenFileDialog
$dlg.Filter = '${filter}'
if ($dlg.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { $dlg.FileName }
`);
  const p = out.trim();
  return p || null;
}

// ---------- Perakitan video alpha dari urutan frame PNG (background removal) ----------

const bgrJobs = new Map();

// Sapu direktori bgr_* yatim dari sesi sebelumnya (job gagal/aplikasi ditutup).
try {
  for (const entry of fs.readdirSync(WORK_DIR)) {
    if (entry.startsWith('bgr_')) {
      try { fs.rmSync(path.join(WORK_DIR, entry), { recursive: true, force: true }); } catch {}
    }
  }
} catch {}

function bgrStart(name, fps, origPath, startTime) {
  const id = 'bgr_' + Date.now();
  const dir = path.join(WORK_DIR, id);
  fs.mkdirSync(dir, { recursive: true });
  bgrJobs.set(id, { dir, fps: fps || 30, origPath: origPath || null, name: name || 'tanpa-bg', startTime: Math.max(0, Number(startTime) || 0) });
  return { id };
}

/** Batalkan job BGR dan hapus frame PNG yang sudah terkumpul. */
function bgrCancel(id) {
  const job = bgrJobs.get(id);
  if (job) {
    try { fs.rmSync(job.dir, { recursive: true, force: true }); } catch {}
    bgrJobs.delete(id);
  }
  return { ok: true };
}

function bgrFrame(id, idx, buffer) {
  const job = bgrJobs.get(id);
  if (!job) throw new Error('job bgr tidak ditemukan');
  const file = path.join(job.dir, `frame_${String(idx).padStart(6, '0')}.png`);
  fs.writeFileSync(file, Buffer.from(buffer));
  return { ok: true };
}

async function bgrFinish(id) {
  const job = bgrJobs.get(id);
  if (!job) throw new Error('job bgr tidak ditemukan');
  const safe = String(job.name).replace(/[^\w.-]+/g, '_').slice(0, 50) || 'tanpa-bg';
  const out = path.join(WORK_DIR, `${safe}_${Date.now()}.webm`);
  const args = ['-y', '-hide_banner', '-framerate', String(job.fps), '-i', path.join(job.dir, 'frame_%06d.png')];
  if (job.origPath && fs.existsSync(job.origPath)) {
    // Audio diambil mulai dari bagian sumber yang diproses (sourceIn klip).
    if (job.startTime > 0.001) args.push('-ss', job.startTime.toFixed(3));
    args.push('-i', job.origPath);
  }
  args.push('-map', '0:v', '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '4M', '-auto-alt-ref', '0');
  if (job.origPath && fs.existsSync(job.origPath)) {
    args.push('-map', '1:a?', '-c:a', 'libopus', '-b:a', '128k', '-shortest');
  }
  args.push(out);
  await runFfmpeg(args);
  try { fs.rmSync(job.dir, { recursive: true, force: true }); } catch {}
  bgrJobs.delete(id);
  return { path: out, name: path.basename(out), url: mediaUrl(out) };
}

module.exports = {
  ffmpegPath, WORK_DIR, MEDIA_PORT, mediaUrl, runFfmpeg,
  probe, extractAudio, detectSilence, tts, ttsVoices,
  saveProcessedVideo, pickMediaDialog, saveFileDialog, openFileDialog,
  bgrStart, bgrFrame, bgrFinish, bgrCancel,
};
