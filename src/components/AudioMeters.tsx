// Meter audio stereo (dBFS puncak) seperti panel Audio Meters Premiere.
import { useEffect, useRef } from 'react';
import { readLevels } from '../engine/audioMeter';

const FLOOR = -60;
const SCALE = [0, -6, -12, -24, -36, -48];

function pct(db: number): number {
  if (!Number.isFinite(db)) return 0;
  return Math.max(0, Math.min(1, (db - FLOOR) / -FLOOR)) * 100;
}

export default function AudioMeters() {
  const lvlRefs = [useRef<HTMLDivElement | null>(null), useRef<HTMLDivElement | null>(null)];
  const peakRefs = [useRef<HTMLDivElement | null>(null), useRef<HTMLDivElement | null>(null)];

  useEffect(() => {
    let raf = 0;
    const peaks = [FLOOR, FLOOR];
    const hold = [0, 0];
    const tick = () => {
      const lv = readLevels();
      const now = performance.now();
      for (let i = 0; i < 2; i++) {
        const db = Number.isFinite(lv[i]) ? lv[i] : FLOOR;
        if (db >= peaks[i] || now - hold[i] > 1200) { peaks[i] = db; hold[i] = now; }
        const l = lvlRefs[i].current;
        const p = peakRefs[i].current;
        if (l) l.style.height = `${pct(db)}%`;
        if (p) p.style.bottom = `${pct(peaks[i])}%`;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="meters" role="img" aria-label="Meter audio stereo">
      <div className="meter-bars">
        <div style={{ position: 'relative', width: 20 }}>
          {SCALE.map((db) => (
            <span key={db} className="meter-scale" style={{ position: 'absolute', right: 0, bottom: `calc(${pct(db)}% - 5px)` }}>{db}</span>
          ))}
        </div>
        {[0, 1].map((i) => (
          <div key={i} className="meter-bar">
            <div className="lvl" ref={lvlRefs[i]} style={{ height: 0 }} />
            <div className="peak" ref={peakRefs[i]} style={{ bottom: 0 }} />
          </div>
        ))}
      </div>
      <div className="meter-scale">L R</div>
    </div>
  );
}
