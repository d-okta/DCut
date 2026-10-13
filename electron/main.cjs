// ============================================================
// Diandra Cut - proses utama Electron.
// ============================================================
const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const core = require('../services/core.cjs');
const { exportProject } = require('../services/exporter.cjs');
const { startServer } = require('../services/server.cjs');

const DEV_URL = 'http://localhost:5173';
let win = null;

async function createWindow() {
  // Server media lokal dipakai juga di Electron agar URL media konsisten.
  try { await startServer(); } catch { /* sudah berjalan (mode `npm run app`) */ }

  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1100,
    minHeight: 700,
    backgroundColor: '#0f1115',
    title: 'Diandra Cut',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.removeMenu();

  const distIndex = path.join(__dirname, '..', 'dist', 'index.html');
  if (fs.existsSync(distIndex) && !process.env.DCUT_DEV) {
    win.loadFile(distIndex);
  } else {
    // Dev: tunggu vite siap
    const tryLoad = (attempt = 0) => {
      win.loadURL(DEV_URL).catch(() => {
        if (attempt < 40) setTimeout(() => tryLoad(attempt + 1), 500);
      });
    };
    tryLoad();
  }
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => app.quit());

// ---------- IPC ----------

ipcMain.handle('pick-media', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Pilih media',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Media', extensions: ['mp4', 'mov', 'mkv', 'webm', 'avi', 'mp3', 'wav', 'm4a', 'aac', 'ogg', 'jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp'] },
      { name: 'Semua file', extensions: ['*'] },
    ],
  });
  if (canceled) return [];
  return filePaths.map((p) => ({ path: p, name: path.basename(p), url: core.mediaUrl(p) }));
});

ipcMain.handle('probe', (_e, p) => core.probe(p));
ipcMain.handle('extract-audio', (_e, p, from, duration, clean) => core.extractAudio(p, from, duration, clean));
ipcMain.handle('detect-silence', (_e, p, th, min) => core.detectSilence(p, th, min));
ipcMain.handle('tts', (_e, req) => core.tts(req));
ipcMain.handle('tts-voices', () => core.ttsVoices());
ipcMain.handle('save-processed', (_e, data, baseName) => core.saveProcessedVideo(data, baseName));
ipcMain.handle('bgr-start', (_e, name, fps, origPath, startTime) => core.bgrStart(name, fps, origPath, startTime));
ipcMain.handle('bgr-frame', (_e, id, idx, png) => core.bgrFrame(id, idx, png));
ipcMain.handle('bgr-finish', (_e, id) => core.bgrFinish(id));
ipcMain.handle('bgr-cancel', (_e, id) => core.bgrCancel(id));

ipcMain.handle('export-project', async (_e, project, opts) => {
  let outPath = opts.outPath;
  if (!outPath) {
    const { canceled, filePath } = await dialog.showSaveDialog(win, {
      title: 'Export video',
      defaultPath: `${project.name || 'video'}.mp4`,
      filters: [{ name: 'Video MP4', extensions: ['mp4'] }],
    });
    if (canceled || !filePath) return { phase: 'error', percent: 0, message: 'Export dibatalkan.' };
    outPath = filePath;
  }
  return exportProject(project, { ...opts, outPath }, (p) => {
    if (win && !win.isDestroyed()) win.webContents.send('export-progress', p);
  });
});

ipcMain.handle('save-project', async (_e, project) => {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: 'Simpan proyek',
    defaultPath: `${project.name || 'proyek'}.dcut.json`,
    filters: [{ name: 'Proyek Diandra Cut', extensions: ['dcut.json', 'json'] }],
  });
  if (canceled || !filePath) return null;
  fs.writeFileSync(filePath, JSON.stringify(project, null, 2), 'utf8');
  return { path: filePath };
});

ipcMain.handle('open-project', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: 'Buka proyek',
    filters: [{ name: 'Proyek Diandra Cut', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (canceled || !filePaths[0]) return null;
  const project = JSON.parse(fs.readFileSync(filePaths[0], 'utf8'));
  for (const a of project.assets || []) a.url = core.mediaUrl(a.path);
  return project;
});
