// ============================================================
// Membangun argumen FFmpeg dari Project JSON.
// Fungsi murni (tanpa side effect kecuali menulis file .ass subtitle).
// ============================================================
const path = require('node:path');
const fs = require('node:fs');

const EPS = 0.05; // toleransi "bersebelahan" (detik)

// ---------- util ----------

function sorted(clips) {
  return [...clips].sort((a, b) => a.start - b.start);
}

function projectDuration(p) {
  if (p.__fixedDuration) return p.__fixedDuration; // ekspor rentang In-Out
  let end = 0;
  for (const t of p.tracks) for (const c of t.clips) end = Math.max(end, c.start + c.duration);
  for (const s of p.subtitles || []) end = Math.max(end, s.end);
  return Math.max(end, 1);
}

/** Escape teks untuk drawtext. */
function escText(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\\\\\'")
    .replace(/:/g, '\\:')
    .replace(/%/g, '\\%')
    .replace(/\r/g, '')
    .replace(/\n/g, '\\n');
}

/** Escape path untuk dipakai di dalam filter (fontfile/subtitles). */
function escFilterPath(p) {
  return p.replace(/\\/g, '/').replace(/:/g, '\\:');
}

const FONT_FILES = {
  arial: { normal: 'arial.ttf', bold: 'arialbd.ttf', italic: 'ariali.ttf', bolditalic: 'arialbi.ttf' },
  impact: { normal: 'impact.ttf', bold: 'impact.ttf', italic: 'impact.ttf', bolditalic: 'impact.ttf' },
  'times new roman': { normal: 'times.ttf', bold: 'timesbd.ttf', italic: 'timesi.ttf', bolditalic: 'timesbi.ttf' },
  'courier new': { normal: 'cour.ttf', bold: 'courbd.ttf', italic: 'couri.ttf', bolditalic: 'courbi.ttf' },
  'segoe ui': { normal: 'segoeui.ttf', bold: 'segoeuib.ttf', italic: 'segoeuii.ttf', bolditalic: 'segoeuiz.ttf' },
  verdana: { normal: 'verdana.ttf', bold: 'verdanab.ttf', italic: 'verdanai.ttf', bolditalic: 'verdanaz.ttf' },
  tahoma: { normal: 'tahoma.ttf', bold: 'tahomabd.ttf', italic: 'tahoma.ttf', bolditalic: 'tahomabd.ttf' },
  georgia: { normal: 'georgia.ttf', bold: 'georgiab.ttf', italic: 'georgiai.ttf', bolditalic: 'georgiaz.ttf' },
  'comic sans ms': { normal: 'comic.ttf', bold: 'comicbd.ttf', italic: 'comici.ttf', bolditalic: 'comicz.ttf' },
};

function fontFile(style, fontsDir) {
  const fam = FONT_FILES[(style.fontFamily || 'Arial').toLowerCase()] || FONT_FILES.arial;
  const key = style.bold && style.italic ? 'bolditalic' : style.bold ? 'bold' : style.italic ? 'italic' : 'normal';
  const p = path.join(fontsDir, fam[key]);
  return fs.existsSync(p) ? p : path.join(fontsDir, 'arial.ttf');
}

function hexToAssColor(hex, alpha = '00') {
  // #RRGGBB -> &HAABBGGRR
  const h = (hex || '#ffffff').replace('#', '').padEnd(6, 'f');
  const r = h.slice(0, 2), g = h.slice(2, 4), b = h.slice(4, 6);
  return `&H${alpha}${b}${g}${r}`.toUpperCase();
}

function assTime(t) {
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const s = Math.floor(t % 60);
  const cs = Math.floor((t - Math.floor(t)) * 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

/** Tulis file .ass dari cues + style proyek. */
function writeAssFile(project, filePath) {
  const st = project.subtitleStyle;
  const scale = project.height / 1080;
  const fontSize = Math.round((st.fontSize || 48) * scale);
  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${project.width}
PlayResY: ${project.height}
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${st.fontFamily || 'Arial'},${fontSize},${hexToAssColor(st.color)},&H000000FF,${hexToAssColor(st.outlineColor)},&H64000000,${st.bold ? -1 : 0},${st.italic ? -1 : 0},0,0,100,100,0,0,1,${st.outlineWidth ?? 2},${st.shadow ? 1 : 0},2,40,40,${Math.round(40 * scale)},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;
  const lines = (project.subtitles || [])
    .filter((c) => c.text && c.text.trim())
    .map((c) => `Dialogue: 0,${assTime(c.start)},${assTime(c.end)},Default,,0,0,0,,${c.text.replace(/\r?\n/g, '\\N')}`);
  fs.writeFileSync(filePath, header + lines.join('\n') + '\n', 'utf8');
}

// ---------- filter per klip ----------

/** Chain normalisasi + efek untuk satu segmen video, hasil ukuran penuh WxH. */
function baseVideoChain(clip, W, H, fps) {
  const parts = [];
  parts.push(`scale=${W}:${H}:force_original_aspect_ratio=decrease`);
  parts.push(`pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:black`);
  parts.push('setsar=1');
  parts.push(`fps=${fps}`);
  parts.push(...effectFilters(clip.effects));
  // Opasitas klip dasar = fade menuju hitam (latar di bawahnya hitam).
  const op = clip.transform && typeof clip.transform.opacity === 'number' ? clip.transform.opacity : 1;
  if (op < 0.999) {
    const o = Math.max(0, op).toFixed(3);
    parts.push(`colorchannelmixer=rr=${o}:gg=${o}:bb=${o}`);
  }
  parts.push('format=yuv420p');
  return parts.join(',');
}

function effectFilters(fx) {
  const parts = [];
  if (!fx) return parts;
  const eq = [];
  if (Math.abs(fx.brightness) > 0.001) eq.push(`brightness=${fx.brightness.toFixed(3)}`);
  if (Math.abs(fx.contrast - 1) > 0.001) eq.push(`contrast=${fx.contrast.toFixed(3)}`);
  if (Math.abs(fx.saturation - 1) > 0.001) eq.push(`saturation=${fx.saturation.toFixed(3)}`);
  if (eq.length) parts.push(`eq=${eq.join(':')}`);
  if (Math.abs(fx.hue) > 0.5) parts.push(`hue=h=${fx.hue.toFixed(1)}`);
  if (Math.abs(fx.temperature) > 0.01) {
    const t = fx.temperature * 0.3;
    parts.push(`colorbalance=rs=${t.toFixed(3)}:bs=${(-t).toFixed(3)}:rm=${(t * 0.5).toFixed(3)}:bm=${(-t * 0.5).toFixed(3)}`);
  }
  if (fx.blur > 0.2) parts.push(`gblur=sigma=${(fx.blur / 2).toFixed(2)}`);
  if (fx.vignette > 0.01) parts.push(`vignette=PI/4*${Math.min(1, fx.vignette).toFixed(2)}`);
  return parts;
}

// ---------- persiapan proyek ----------

/**
 * Salinan proyek yang siap dirender:
 * - klip nonaktif (Shift+E) dibuang;
 * - bila ada track audio ber-solo, track audio lain dibisukan;
 * - bila opts.rangeStart/rangeEnd diisi (ekspor In-Out), hanya rentang itu
 *   yang dipertahankan dan semuanya digeser supaya rentang mulai di 0.
 */
function prepareProject(project, opts) {
  const p = JSON.parse(JSON.stringify(project));
  for (const t of p.tracks) t.clips = t.clips.filter((c) => !c.disabled);

  const audio = p.tracks.filter((t) => t.kind === 'audio');
  if (audio.some((t) => t.solo)) for (const t of audio) if (!t.solo) t.muted = true;

  const a = Number(opts.rangeStart), b = Number(opts.rangeEnd);
  if (Number.isFinite(a) && Number.isFinite(b) && b - a > 0.02) {
    const media = (c) => c.kind === 'video' || c.kind === 'audio';
    for (const t of p.tracks) {
      const out = [];
      for (const c of t.clips) {
        const s = c.start, e = c.start + c.duration;
        if (e <= a + 1e-4 || s >= b - 1e-4) continue;
        const ns = Math.max(s, a), ne = Math.min(e, b);
        if (media(c)) c.sourceIn = (c.sourceIn || 0) + (ns - s) * (c.speed || 1);
        if (ne < e - 1e-4) c.transitionOut = undefined; // ujung baru di batas Out
        c.start = ns - a;
        c.duration = ne - ns;
        out.push(c);
      }
      t.clips = out;
    }
    p.subtitles = (p.subtitles || [])
      .filter((s) => s.end > a && s.start < b)
      .map((s) => ({ ...s, start: Math.max(0, s.start - a), end: Math.min(b, s.end) - a }));
    p.__fixedDuration = b - a;
  }
  return p;
}

// ---------- builder utama ----------

/**
 * @returns {{args: string[], total: number, assFile: string|null}}
 */
function buildExportArgs(rawProject, opts, ctx) {
  const project = prepareProject(rawProject, opts);
  const { workDir, fontsDir = 'C:/Windows/Fonts', outPath } = ctx;
  const W = opts.width, H = opts.height, FPS = opts.fps;
  const total = projectDuration(project);
  const assets = Object.fromEntries((project.assets || []).map((a) => [a.id, a]));

  const inputs = [];   // array of string[] (opsi input + -i path)
  const filters = [];
  let inIdx = 0;

  const addInput = (opts_) => { inputs.push(opts_); return inIdx++; };

  // ----- 1. Base video: track 'video' pertama -----
  const videoTracks = project.tracks.filter((t) => t.kind === 'video');
  const overlayTracks = project.tracks.filter((t) => t.kind === 'overlay');
  const audioTracks = project.tracks.filter((t) => t.kind === 'audio');
  // Base = track video PERTAMA YANG BERISI klip media (track kosong dilewati,
  // mis. track baru dari tombol "+ Video").
  const baseTrack = videoTracks.find((t) => t.clips.some((c) => c.kind !== 'text')) || videoTracks[0];
  const extraVideoTracks = videoTracks.filter((t) => t !== baseTrack); // diperlakukan sebagai overlay

  const baseClips = baseTrack ? sorted(baseTrack.clips).filter((c) => c.kind !== 'text') : [];

  let cursor = 0;
  let segCount = 0;
  let current = null;       // label stream video berjalan
  let currentDur = 0;
  let pendingTransition = null; // transisi dari klip sebelumnya

  const attach = (label, dur, transition) => {
    if (current === null) {
      current = label; currentDur = dur;
    } else if (transition && transition.type !== 'none' && transition.duration > 0.05) {
      // Perpanjang stream berjalan dengan freeze-frame sepanjang transisi,
      // lalu xfade -> durasi timeline tetap terjaga.
      // settb=AVTB WAJIB pada kedua input: concat sebelumnya mengubah
      // timebase, dan xfade menolak input dengan timebase berbeda.
      const td = Math.min(transition.duration, dur * 0.9, 3);
      const frozen = `xf${segCount}`;
      filters.push(`[${current}]tpad=stop_mode=clone:stop_duration=${td.toFixed(3)},settb=AVTB[${frozen}]`);
      const tbIn = `xi${segCount}`;
      filters.push(`[${label}]settb=AVTB[${tbIn}]`);
      const outL = `vx${segCount}`;
      filters.push(`[${frozen}][${tbIn}]xfade=transition=${transition.type}:duration=${td.toFixed(3)}:offset=${currentDur.toFixed(3)}[${outL}]`);
      current = outL; currentDur += dur;
    } else {
      const outL = `vc${segCount}`;
      filters.push(`[${current}][${label}]concat=n=2:v=1:a=0[${outL}]`);
      current = outL; currentDur += dur;
    }
    segCount++;
  };

  const makeGap = (dur) => {
    const idx = addInput(['-f', 'lavfi', '-t', dur.toFixed(3), '-i', `color=black:s=${W}x${H}:r=${FPS}`]);
    const label = `g${idx}`;
    filters.push(`[${idx}:v]setsar=1,format=yuv420p,settb=AVTB[${label}]`);
    return label;
  };

  const audioJobs = []; // {inputIdx, clip} -> untuk amix

  for (const clip of baseClips) {
    const asset = assets[clip.assetId];
    if (!asset) continue;
    // gap sebelum klip
    if (clip.start > cursor + EPS) {
      attach(makeGap(clip.start - cursor), clip.start - cursor, null);
      pendingTransition = null;
    }
    const speed = clip.speed || 1;
    const srcDur = clip.duration * speed;
    let idx;
    if (asset.type === 'image') {
      idx = addInput(['-loop', '1', '-t', clip.duration.toFixed(3), '-i', asset.path]);
    } else {
      const inOpts = [];
      if (clip.sourceIn > 0.001) inOpts.push('-ss', clip.sourceIn.toFixed(3));
      inOpts.push('-t', srcDur.toFixed(3), '-i', asset.path);
      idx = addInput(inOpts);
    }
    const label = `s${idx}`;
    const speedFilter = Math.abs(speed - 1) > 0.001 ? `setpts=PTS/${speed.toFixed(4)},` : '';
    // tpad clone menjamin segmen TEPAT sepanjang slot timeline-nya walau
    // sumber lebih pendek (mis. speed>1 melebihi sisa sumber) - frame
    // terakhir dibekukan, lalu trim memotong pas.
    filters.push(`[${idx}:v]${speedFilter}${baseVideoChain(clip, W, H, FPS)},tpad=stop_mode=clone:stop_duration=${clip.duration.toFixed(3)},trim=duration=${clip.duration.toFixed(3)},setpts=PTS-STARTPTS,settb=AVTB[${label}]`);
    const adjacent = Math.abs(clip.start - cursor) <= EPS;
    attach(label, clip.duration, adjacent ? pendingTransition : null);
    pendingTransition = clip.transitionOut || null;
    cursor = clip.start + clip.duration;

    // audio dari klip video
    if (asset.type === 'video' && asset.hasAudio && !clip.muted && !baseTrack.muted && (clip.volume ?? 1) > 0.001) {
      audioJobs.push({ inputIdx: idx, clip });
    }
  }

  // tail gap sampai durasi penuh
  if (total > cursor + EPS) attach(makeGap(total - cursor), total - cursor, null);
  if (current === null) {
    attach(makeGap(total), total, null);
  }

  let vout = current;

  // ----- 2. Overlay: track video ekstra + track overlay -----
  const overlayClips = [];
  for (const t of extraVideoTracks) if (!t.muted) for (const c of sorted(t.clips)) overlayClips.push({ c, track: t });
  for (const t of overlayTracks) if (!t.muted) for (const c of sorted(t.clips)) overlayClips.push({ c, track: t });

  let ovCount = 0;
  for (const { c: clip, track } of overlayClips) {
    if (clip.kind === 'text') continue; // teks digambar terakhir via drawtext
    const asset = assets[clip.assetId];
    if (!asset) continue;
    const tr = clip.transform || { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1 };
    const speed = clip.speed || 1;
    const inOpts = [];
    if (asset.hasAlpha) inOpts.push('-c:v', 'libvpx-vp9');
    if (asset.type === 'image') {
      inOpts.push('-loop', '1', '-t', clip.duration.toFixed(3), '-i', asset.path);
    } else {
      if (clip.sourceIn > 0.001) inOpts.push('-ss', clip.sourceIn.toFixed(3));
      inOpts.push('-t', (clip.duration * speed).toFixed(3), '-i', asset.path);
    }
    const idx = addInput(inOpts);
    const targetW = Math.max(16, Math.round(W * (tr.scale ?? 1)));
    const parts = [];
    if (Math.abs(speed - 1) > 0.001) parts.push(`setpts=PTS/${speed.toFixed(4)}`);
    parts.push(`scale=${targetW}:-2:force_original_aspect_ratio=decrease`, `fps=${FPS}`);
    parts.push(...effectFilters(clip.effects));
    parts.push('format=yuva420p');
    if (Math.abs(tr.rotation || 0) > 0.5) {
      parts.push(`rotate=${((tr.rotation * Math.PI) / 180).toFixed(4)}:c=none:ow=rotw(iw):oh=roth(ih)`);
    }
    const op = tr.opacity ?? 1;
    if (op < 0.999) parts.push(`colorchannelmixer=aa=${op.toFixed(3)}`);
    parts.push(`trim=duration=${clip.duration.toFixed(3)}`, 'setpts=PTS-STARTPTS');
    // geser PTS agar muncul pada waktunya
    parts.push(`setpts=PTS+${clip.start.toFixed(3)}/TB`);
    const ovLabel = `ov${ovCount}`;
    filters.push(`[${idx}:v]${parts.join(',')}[${ovLabel}]`);
    const outL = `vo${ovCount}`;
    const x = `${(tr.x ?? 0.5).toFixed(4)}*W-w/2`;
    const y = `${(tr.y ?? 0.5).toFixed(4)}*H-h/2`;
    filters.push(`[${vout}][${ovLabel}]overlay=x='${x}':y='${y}':enable='between(t,${clip.start.toFixed(3)},${(clip.start + clip.duration).toFixed(3)})':eof_action=pass[${outL}]`);
    vout = outL;
    ovCount++;

    if (asset.type === 'video' && asset.hasAudio && !clip.muted && (clip.volume ?? 1) > 0.001) {
      audioJobs.push({ inputIdx: idx, clip });
    }
  }

  // ----- 3. Teks (drawtext) -----
  const textClips = [];
  for (const t of [...videoTracks, ...overlayTracks]) {
    if (t.muted) continue;
    for (const c of t.clips) if (c.kind === 'text' && c.text && c.text.trim()) textClips.push(c);
  }
  let txtCount = 0;
  const textFiles = [];
  for (const clip of textClips) {
    const st = clip.textStyle || {};
    const tr = clip.transform || { x: 0.5, y: 0.5, scale: 1, rotation: 0, opacity: 1 };
    const scalePx = H / 1080;
    const size = Math.max(8, Math.round((st.fontSize || 64) * scalePx * (tr.scale ?? 1)));
    const font = escFilterPath(fontFile(st, fontsDir));
    // textfile= (bukan text=) menghindari seluruh masalah escaping drawtext
    // (apostrof, titik dua, %, baris baru) - teks ditulis apa adanya ke file.
    const txtPath = path.join(workDir, `dtext_${Date.now()}_${txtCount}.txt`);
    fs.writeFileSync(txtPath, String(clip.text).replace(/\r\n/g, '\n'), 'utf8');
    textFiles.push(txtPath);
    const dt = [
      `fontfile='${font}'`,
      `textfile='${escFilterPath(txtPath)}'`,
      // Tanpa ini, "%" di teks dibaca drawtext sebagai kode ekspansi dan seluruh teks hilang.
      'expansion=none',
      `fontsize=${size}`,
      `fontcolor=${(st.color || '#ffffff').replace('#', '0x')}@${(tr.opacity ?? 1).toFixed(3)}`,
      `x=${(tr.x ?? 0.5).toFixed(4)}*w-text_w/2`,
      `y=${(tr.y ?? 0.5).toFixed(4)}*h-text_h/2`,
      `enable='between(t,${clip.start.toFixed(3)},${(clip.start + clip.duration).toFixed(3)})'`,
    ];
    if (st.outlineWidth > 0) dt.push(`borderw=${Math.round(st.outlineWidth * scalePx)}`, `bordercolor=${(st.outlineColor || '#000000').replace('#', '0x')}`);
    if (st.shadow) dt.push('shadowx=2', 'shadowy=2', 'shadowcolor=0x000000@0.6');
    if (st.backgroundColor) dt.push(`box=1`, `boxcolor=${st.backgroundColor.replace('#', '0x')}@0.6`, `boxborderw=${Math.round(12 * scalePx)}`);
    const outL = `vt${txtCount}`;
    filters.push(`[${vout}]drawtext=${dt.join(':')}[${outL}]`);
    vout = outL;
    txtCount++;
  }

  // ----- 4. Subtitle burn-in (.ass) -----
  let assFile = null;
  if (opts.burnSubtitles && (project.subtitles || []).some((c) => c.text && c.text.trim())) {
    assFile = path.join(workDir, `subtitles_${Date.now()}.ass`);
    writeAssFile(project, assFile);
    const outL = 'vsub';
    filters.push(`[${vout}]subtitles=filename='${escFilterPath(assFile)}'[${outL}]`);
    vout = outL;
  }

  // ----- 5. Audio: klip track audio -----
  for (const t of audioTracks) {
    if (t.muted) continue;
    for (const clip of sorted(t.clips)) {
      const asset = assets[clip.assetId];
      if (!asset || clip.muted || (clip.volume ?? 1) <= 0.001) continue;
      const speed = clip.speed || 1;
      const inOpts = [];
      if (clip.sourceIn > 0.001) inOpts.push('-ss', clip.sourceIn.toFixed(3));
      inOpts.push('-t', (clip.duration * speed).toFixed(3), '-i', asset.path);
      const idx = addInput(inOpts);
      audioJobs.push({ inputIdx: idx, clip });
    }
  }

  const audioLabels = [];
  audioJobs.forEach(({ inputIdx, clip }, i) => {
    const speed = clip.speed || 1;
    const parts = ['aresample=48000'];
    if (Math.abs(speed - 1) > 0.001) {
      // atempo hanya 0.5..2 per filter; rantai bila perlu
      let s = speed;
      while (s > 2) { parts.push('atempo=2.0'); s /= 2; }
      while (s < 0.5) { parts.push('atempo=0.5'); s *= 2; }
      parts.push(`atempo=${s.toFixed(4)}`);
    }
    parts.push(`volume=${(clip.volume ?? 1).toFixed(3)}`);
    parts.push(`atrim=duration=${clip.duration.toFixed(3)}`, 'asetpts=PTS-STARTPTS');
    const delayMs = Math.round(clip.start * 1000);
    parts.push(`adelay=${delayMs}|${delayMs}`);
    const label = `a${i}`;
    filters.push(`[${inputIdx}:a]${parts.join(',')}[${label}]`);
    audioLabels.push(label);
  });

  let aout;
  if (audioLabels.length === 0) {
    const idx = addInput(['-f', 'lavfi', '-t', total.toFixed(3), '-i', 'anullsrc=r=48000:cl=stereo']);
    filters.push(`[${idx}:a]anull[aout]`);
    aout = 'aout';
  } else if (audioLabels.length === 1) {
    filters.push(`[${audioLabels[0]}]apad,atrim=duration=${total.toFixed(3)}[aout]`);
    aout = 'aout';
  } else {
    filters.push(`[${audioLabels.map((l) => `${l}]`).join('[').replace(/\]$/, ']')}amix=inputs=${audioLabels.length}:duration=longest:normalize=0,apad,atrim=duration=${total.toFixed(3)}[aout]`);
    aout = 'aout';
  }

  // ----- 6. Rakit argumen -----
  // Filter graph ditulis ke FILE (-filter_complex_script) supaya proyek
  // dengan banyak klip tidak menabrak batas panjang argumen Windows (32K).
  const graphFile = path.join(workDir, `graph_${Date.now()}.txt`);
  fs.writeFileSync(graphFile, filters.join(';\n'), 'utf8');

  const args = ['-y', '-hide_banner'];
  for (const inp of inputs) args.push(...inp);
  args.push('-filter_complex_script', graphFile);
  args.push('-map', `[${vout}]`, '-map', `[${aout}]`);
  args.push(
    '-c:v', 'libx264', '-preset', 'medium', '-crf', String(opts.crf ?? 21),
    '-pix_fmt', 'yuv420p', '-r', String(FPS),
    '-c:a', 'aac', '-b:a', '192k',
    '-t', total.toFixed(3),
    '-movflags', '+faststart',
    '-progress', 'pipe:1',
    outPath,
  );

  const cleanupFiles = [graphFile, ...textFiles];
  if (assFile) cleanupFiles.push(assFile);
  return { args, total, assFile, cleanupFiles };
}

module.exports = { buildExportArgs, projectDuration, writeAssFile, prepareProject };
