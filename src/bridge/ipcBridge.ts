// Implementasi Bridge untuk Electron - memanggil API dari preload (window.dcut).
import type { Bridge } from './index';
import type { ExportProgress } from '../types';

interface DcutApi {
  invoke(channel: string, ...args: unknown[]): Promise<unknown>;
  onExportProgress(cb: (p: ExportProgress) => void): () => void;
}

function api(): DcutApi {
  return (window as unknown as { dcut: DcutApi }).dcut;
}

export const ipcBridge: Bridge = {
  isElectron: true,

  pickMediaFiles: () => api().invoke('pick-media') as never,
  probe: (path) => api().invoke('probe', path) as never,
  extractAudio: (path, from, duration, clean) => api().invoke('extract-audio', path, from, duration, clean) as never,
  detectSilence: (path, thresholdDb, minDuration) => api().invoke('detect-silence', path, thresholdDb, minDuration) as never,
  tts: (req) => api().invoke('tts', req) as never,
  ttsVoices: () => api().invoke('tts-voices') as never,
  saveProcessedVideo: (data, baseName) => api().invoke('save-processed', data, baseName) as never,
  bgrStart: (name, fps, origPath, startTime) => api().invoke('bgr-start', name, fps, origPath, startTime) as never,
  bgrFrame: (id, idx, png) => api().invoke('bgr-frame', id, idx, png) as never,
  bgrFinish: (id) => api().invoke('bgr-finish', id) as never,
  bgrCancel: (id) => api().invoke('bgr-cancel', id) as never,

  async exportProject(project, opts, onProgress) {
    const off = api().onExportProgress(onProgress);
    try {
      const result = (await api().invoke('export-project', project, opts)) as ExportProgress;
      onProgress(result);
      return result;
    } finally {
      off();
    }
  },

  saveProjectFile: (project) => api().invoke('save-project', project) as never,
  openProjectFile: () => api().invoke('open-project') as never,
};
