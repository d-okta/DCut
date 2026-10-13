// ============================================================
// Bagian bersama Source & Program Monitor: timecode yang bisa
// diketik, mini-ruler (scrub + rentang In/Out + penanda), transport.
// ============================================================
import { useEffect, useRef, useState } from 'react';
import type { PointerEvent as RPointerEvent } from 'react';
import { parseTimecode, toTimecode } from '../types';
import type { Marker } from '../types';
import Icon, { type IconName } from './Icon';

/** Timecode biru yang bisa diklik lalu diketik (HH:MM:SS:FF, atau +30 / -15 frame). */
export function TimecodeField({ time, fps, onCommit, label, forceEdit, onEditEnd }: {
  time: number; fps: number; onCommit(t: number): void; label: string;
  forceEdit?: boolean; onEditEnd?(): void;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (forceEdit && !editing) { setText(toTimecode(time, fps)); setEditing(true); }
  }, [forceEdit]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (editing) inputRef.current?.select(); }, [editing]);

  const finish = (apply: boolean) => {
    if (apply) {
      const t = parseTimecode(text, fps, time);
      if (t !== null) onCommit(t);
    }
    setEditing(false);
    onEditEnd?.();
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="input tc"
        style={{ width: 112, height: 22, padding: '0 4px', fontSize: 13 }}
        value={text}
        aria-label={label}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') finish(true);
          if (e.key === 'Escape') finish(false);
        }}
      />
    );
  }
  return (
    <button
      className="tc-display"
      title={`${label}: klik untuk mengetik timecode`}
      aria-label={`${label} ${toTimecode(time, fps)}, klik untuk mengubah`}
      onClick={() => { setText(toTimecode(time, fps)); setEditing(true); }}
    >
      {toTimecode(time, fps)}
    </button>
  );
}

/** Garis waktu mini di bawah monitor: klik/seret = pindah posisi. */
export function MiniRuler({ time, duration, inPoint, outPoint, markers, onSeek }: {
  time: number; duration: number; inPoint?: number; outPoint?: number; markers?: Marker[]; onSeek(t: number): void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const d = Math.max(0.001, duration);
  const toT = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.max(0, Math.min(d, ((clientX - r.left) / r.width) * d));
  };
  const down = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    onSeek(toT(e.clientX));
  };
  const move = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) onSeek(toT(e.clientX));
  };
  const pct = (t: number) => `${Math.max(0, Math.min(100, (t / d) * 100))}%`;
  const a = inPoint ?? 0;
  const b = outPoint ?? d;
  const showRange = inPoint !== undefined || outPoint !== undefined;
  return (
    <div className="mini-ruler" ref={ref} onPointerDown={down} onPointerMove={move} role="slider"
      aria-label="Posisi" aria-valuemin={0} aria-valuemax={Math.round(d)} aria-valuenow={Math.round(time)}>
      <div className="track" />
      {showRange && <div className="range" style={{ left: pct(a), width: `calc(${pct(b)} - ${pct(a)})` }} />}
      {(markers ?? []).map((m) => (
        <div key={m.id} className="mk" style={{ left: pct(m.time), background: m.color }} title={m.name} />
      ))}
      <div className="head" style={{ left: pct(time) }} />
    </div>
  );
}

export interface TransportButton {
  icon: IconName;
  label: string;
  keys?: string;
  onClick(): void;
  active?: boolean;
  disabled?: boolean;
  big?: boolean;
}

/** Deretan tombol transport; `null` = pemisah. */
export function Transport({ buttons }: { buttons: (TransportButton | null)[] }) {
  return (
    <div className="transport">
      {buttons.map((b, i) =>
        b === null ? <span key={`s${i}`} className="sep" /> : (
          <button
            key={b.label}
            className={`icon-btn ${b.big ? 'big' : ''} ${b.active ? 'on' : ''}`}
            title={b.keys ? `${b.label} (${b.keys})` : b.label}
            aria-label={b.label}
            disabled={b.disabled}
            onClick={b.onClick}
          >
            <Icon name={b.icon} size={b.big ? 18 : 15} />
          </button>
        ),
      )}
    </div>
  );
}
