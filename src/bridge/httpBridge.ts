// Implementasi Bridge untuk mode dev di browser (via dev-server.mjs, proxy /api).
import type { Bridge, ImportedFile } from './index';
import type { ExportOptions, ExportProgress, Project, TtsRequest } from '../types';

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path}: ${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const httpBridge: Bridge = {
  isElectron: false,

  async pickMediaFiles(): Promise<ImportedFile[]> {
    // Di browser tidak ada dialog file sistem dengan path asli.
    // dev-server menyediakan endpoint yang membuka dialog PowerShell.
    return post<ImportedFile[]>('/pick-media');
  },

  probe(path) {
    return post('/probe', { path });
  },

  extractAudio(path, from, duration, clean) {
    return post('/extract-audio', { path, from, duration, clean });
  },

  detectSilence(path, thresholdDb, minDuration) {
    return post('/detect-silence', { path, thresholdDb, minDuration });
  },

  tts(req: TtsRequest) {
    return post('/tts', req);
  },

  ttsVoices() {
    return post('/tts-voices');
  },

  async saveProcessedVideo(data: ArrayBuffer, baseName: string): Promise<ImportedFile> {
    const res = await fetch(`/api/save-processed?name=${encodeURIComponent(baseName)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/octet-stream' },
      body: data,
    });
    if (!res.ok) throw new Error(`save-processed: ${res.status}`);
    return res.json();
  },

  bgrStart(name, fps, origPath, startTime) {
    return post('/bgr/start', { name, fps, origPath, startTime });
  },
  async bgrCancel(id) {
    await post('/bgr/cancel', { id });
  },
  async bgrFrame(id, idx, png) {
    const res = await fetch(`/api/bgr/frame?id=${encodeURIComponent(id)}&idx=${idx}`, {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: png,
    });
    if (!res.ok) throw new Error(`bgr/frame: ${res.status}`);
  },
  bgrFinish(id) {
    return post('/bgr/finish', { id });
  },

  async exportProject(project: Project, opts: ExportOptions, onProgress): Promise<ExportProgress> {
    const { jobId } = await post<{ jobId: string }>('/export/start', { project, opts });
    return new Promise((resolve) => {
      const timer = setInterval(async () => {
        try {
          const p = await post<ExportProgress>('/export/status', { jobId });
          onProgress(p);
          if (p.phase === 'done' || p.phase === 'error') {
            clearInterval(timer);
            resolve(p);
          }
        } catch (e) {
          clearInterval(timer);
          const err: ExportProgress = { phase: 'error', percent: 0, message: String(e) };
          onProgress(err);
          resolve(err);
        }
      }, 500);
    });
  },

  saveProjectFile(project) {
    return post('/save-project', { project });
  },

  openProjectFile() {
    return post('/open-project');
  },
};
