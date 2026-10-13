// ============================================================
// Server HTTP lokal: streaming media (range request) + API dev.
// Dipakai oleh dev-server.mjs DAN Electron main (untuk URL media).
// ============================================================
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const core = require('./core.cjs');
const { exportProject } = require('./exporter.cjs');

const MIME = {
  '.mp4': 'video/mp4', '.mov': 'video/quicktime', '.mkv': 'video/x-matroska',
  '.webm': 'video/webm', '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif',
  '.bmp': 'image/bmp', '.webp': 'image/webp',
};

function createApp() {
  const app = express();
  // Server hanya mendengarkan di 127.0.0.1; CORS terbuka agar renderer
  // (vite 5173 / file:// Electron) bisa fetch media & API lintas port.
  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Range');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Range,Accept-Ranges,Content-Length');
    if (req.method === 'OPTIONS') return res.status(204).end();
    next();
  });
  app.use(express.json({ limit: '50mb' }));

  // ---- streaming media dengan dukungan Range (wajib untuk seeking <video>) ----
  app.get('/media', (req, res) => {
    const filePath = String(req.query.path || '');
    if (!filePath || !fs.existsSync(filePath)) return res.status(404).end('not found');
    const stat = fs.statSync(filePath);
    const mime = MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
    const range = req.headers.range;
    if (range) {
      const m = range.match(/bytes=(\d*)-(\d*)/);
      let start = m && m[1] ? Number(m[1]) : 0;
      let end = m && m[2] ? Number(m[2]) : stat.size - 1;
      end = Math.min(end, stat.size - 1);
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        'Content-Type': mime,
      });
      fs.createReadStream(filePath, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { 'Content-Length': stat.size, 'Content-Type': mime, 'Accept-Ranges': 'bytes' });
      fs.createReadStream(filePath).pipe(res);
    }
  });

  // ---- API (mencerminkan Bridge) ----
  const wrap = (fn) => async (req, res) => {
    try { res.json(await fn(req)); }
    catch (e) { res.status(500).end(String(e && e.message || e)); }
  };

  app.post('/api/pick-media', wrap(() => core.pickMediaDialog()));
  app.post('/api/probe', wrap((req) => core.probe(req.body.path)));
  app.post('/api/extract-audio', wrap((req) => core.extractAudio(req.body.path, req.body.from || 0, req.body.duration || 0, !!req.body.clean)));
  app.post('/api/detect-silence', wrap((req) => core.detectSilence(req.body.path, req.body.thresholdDb, req.body.minDuration)));
  app.post('/api/tts', wrap((req) => core.tts(req.body)));
  app.post('/api/tts-voices', wrap(() => core.ttsVoices()));

  app.post('/api/save-processed', express.raw({ type: '*/*', limit: '2gb' }), (req, res) => {
    try {
      const name = String(req.query.name || 'processed');
      res.json(core.saveProcessedVideo(req.body, name));
    } catch (e) { res.status(500).end(String(e.message || e)); }
  });

  // ---- background removal: rakit frame PNG -> WebM alpha ----
  app.post('/api/bgr/start', wrap((req) => core.bgrStart(req.body.name, req.body.fps, req.body.origPath, req.body.startTime)));
  app.post('/api/bgr/cancel', wrap((req) => core.bgrCancel(req.body.id)));
  app.post('/api/bgr/frame', express.raw({ type: '*/*', limit: '50mb' }), (req, res) => {
    try { res.json(core.bgrFrame(String(req.query.id), Number(req.query.idx), req.body)); }
    catch (e) { res.status(500).end(String(e.message || e)); }
  });
  app.post('/api/bgr/finish', wrap((req) => core.bgrFinish(req.body.id)));

  // ---- export sebagai job async ----
  const jobs = new Map();
  app.post('/api/export/start', (req, res) => {
    const { project, opts } = req.body;
    const jobId = 'job_' + Date.now();
    const state = { phase: 'preparing', percent: 0 };
    jobs.set(jobId, state);
    (async () => {
      let outPath = opts.outPath;
      if (!outPath) {
        outPath = await core.saveFileDialog(`${project.name || 'video'}.mp4`, 'Video MP4|*.mp4');
        if (!outPath) { Object.assign(state, { phase: 'error', percent: 0, message: 'Export dibatalkan.' }); return; }
      }
      exportProject(project, { ...opts, outPath }, (p) => Object.assign(state, p));
    })().catch((e) => Object.assign(state, { phase: 'error', percent: 0, message: String(e.message || e) }));
    res.json({ jobId });
  });
  app.post('/api/export/status', (req, res) => {
    const state = jobs.get(req.body.jobId);
    if (!state) return res.status(404).end('job tidak ditemukan');
    res.json(state);
  });

  // ---- simpan / buka proyek ----
  app.post('/api/save-project', wrap(async (req) => {
    const project = req.body.project;
    const p = await core.saveFileDialog(`${project.name || 'proyek'}.dcut.json`, 'Proyek DCut|*.dcut.json;*.json');
    if (!p) return null;
    fs.writeFileSync(p, JSON.stringify(project, null, 2), 'utf8');
    return { path: p };
  }));
  app.post('/api/open-project', wrap(async () => {
    const p = await core.openFileDialog('Proyek DCut|*.dcut.json;*.nusacut.json;*.json|Semua file|*.*');
    if (!p) return null;
    const project = JSON.parse(fs.readFileSync(p, 'utf8'));
    // segarkan URL media (port/lokasi bisa berubah antar sesi)
    for (const a of project.assets || []) a.url = core.mediaUrl(a.path);
    return project;
  }));

  return app;
}

function startServer() {
  const app = createApp();
  return new Promise((resolve, reject) => {
    const srv = app.listen(core.MEDIA_PORT, '127.0.0.1', () => resolve(srv));
    // Tanpa handler ini, port yang sudah dipakai membuat promise menggantung
    // (mis. Electron dijalankan bersamaan dengan dev-server).
    srv.on('error', (err) => reject(err));
  });
}

module.exports = { createApp, startServer };
