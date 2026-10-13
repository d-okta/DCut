// ============================================================
// Menjalankan export FFmpeg dengan pelaporan progress.
// ============================================================
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const { ffmpegPath, WORK_DIR } = require('./core.cjs');
const { buildExportArgs } = require('./exportGraph.cjs');

/**
 * @param {object} project
 * @param {object} opts   ExportOptions (outPath wajib terisi)
 * @param {(p: {phase:string,percent:number,message?:string,outPath?:string}) => void} onProgress
 * @returns {Promise<{phase:string,percent:number,message?:string,outPath?:string}>}
 */
function exportProject(project, opts, onProgress) {
  return new Promise((resolve) => {
    let plan;
    try {
      onProgress({ phase: 'preparing', percent: 0 });
      plan = buildExportArgs(project, opts, { workDir: WORK_DIR, outPath: opts.outPath });
    } catch (e) {
      const r = { phase: 'error', percent: 0, message: `Gagal menyusun perintah export: ${e.message}` };
      onProgress(r); resolve(r); return;
    }

    const proc = spawn(ffmpegPath, plan.args, { windowsHide: true });
    let stderrTail = '';

    proc.stdout.on('data', (d) => {
      // -progress pipe:1 -> baris key=value
      const text = d.toString();
      const m = text.match(/out_time_us=(\d+)/g);
      if (m && m.length) {
        const us = Number(m[m.length - 1].split('=')[1]);
        const percent = Math.max(0, Math.min(99, (us / 1e6 / plan.total) * 100));
        onProgress({ phase: 'rendering', percent });
      }
    });
    proc.stderr.on('data', (d) => {
      stderrTail = (stderrTail + d.toString()).slice(-4000);
    });
    proc.on('error', (e) => {
      const r = { phase: 'error', percent: 0, message: e.message };
      onProgress(r); resolve(r);
    });
    proc.on('close', (code) => {
      for (const f of plan.cleanupFiles || []) { try { fs.unlinkSync(f); } catch {} }
      if (code === 0) {
        const r = { phase: 'done', percent: 100, outPath: opts.outPath };
        onProgress(r); resolve(r);
      } else {
        const r = { phase: 'error', percent: 0, message: `FFmpeg exit ${code}:\n${stderrTail.slice(-1500)}` };
        onProgress(r); resolve(r);
      }
    });
  });
}

module.exports = { exportProject };
