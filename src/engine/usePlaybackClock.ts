// ============================================================
// Jam playback preview berbasis WALL-TIME (bukan akumulasi delta),
// sehingga tetap akurat walau rAF di-throttle (jendela tersembunyi).
// - rAF untuk pembaruan halus saat terlihat.
// - setInterval 200ms sebagai cadangan saat rAF mati.
// - Bila currentTime diubah pihak lain (seek saat playing), jam
//   me-rebase otomatis.
// ============================================================
import { useEffect } from 'react';
import { useUi } from '../store/uiStore';
import { useProject } from '../store/projectStore';
import { projectDuration } from '../types';

/** Jalankan jam playback global. Cukup dipanggil sekali (di ProgramMonitor). */
export function usePlaybackClock(): void {
  const playing = useUi((s) => s.playing);
  // Shuttle J/K/L: kecepatan & arah. Perubahan kecepatan me-rebase jam.
  const rate = useUi((s) => s.shuttle);

  useEffect(() => {
    if (!playing || rate === 0) return;

    const ui = useUi.getState();
    const durAwal = projectDuration(useProject.getState().project);
    if (rate > 0 && ui.currentTime >= durAwal - 1 / 60) ui.setCurrentTime(0);

    let wallStart = performance.now();
    let baseT = useUi.getState().currentTime;
    let lastSet = baseT;
    let raf = 0;
    let stopped = false;

    const tick = () => {
      if (stopped) return;
      const u = useUi.getState();

      // Rebase bila ada seek eksternal saat playing. Ambang <= setengah
      // frame supaya nudge 1 frame (tombol maju/mundur) tidak dibuang.
      const fps = useProject.getState().project.fps || 30;
      const rebaseEps = Math.min(0.02, 1 / (2 * Math.max(1, fps)));
      if (Math.abs(u.currentTime - lastSet) > rebaseEps) {
        baseT = u.currentTime;
        wallStart = performance.now();
      }

      const dur = projectDuration(useProject.getState().project);
      const t = baseT + ((performance.now() - wallStart) / 1000) * rate;

      if (t >= dur || t <= 0) {
        const edge = t <= 0 ? 0 : dur;
        lastSet = edge;
        u.setCurrentTime(edge);
        u.pause();
        stopped = true;
        return;
      }
      lastSet = t;
      u.setCurrentTime(t);
    };

    const loop = () => {
      tick();
      if (!stopped) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const backup = setInterval(tick, 200); // tetap jalan saat rAF di-throttle

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      clearInterval(backup);
    };
  }, [playing, rate]);
}
