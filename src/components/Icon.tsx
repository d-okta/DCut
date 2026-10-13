// Ikon garis monokrom untuk alat, transport, dan header track.
// Digambar sendiri (24x24, stroke currentColor) supaya warnanya ikut tema
// dan tidak bergantung pada pustaka ikon atau emoji.
import type { CSSProperties } from 'react';

const P: Record<string, string> = {
  select: 'M5 3l13 8-6 1.5L9 19z',
  razor: 'M6 3v6M6 15v6M3 9h6v6H3zM12 4l8 16M20 4l-8 16',
  ripple: 'M4 4v16M4 12h6M7 9l3 3-3 3M20 4v16M14 12h6',
  slip: 'M3 12h18M7 8l-4 4 4 4M17 8l4 4-4 4M10 6v12M14 6v12',
  hand: 'M8 13V6a1.5 1.5 0 013 0v5M11 11V4.5a1.5 1.5 0 013 0V11M14 11V6a1.5 1.5 0 013 0v7c0 4-2.5 7-6 7-2.5 0-4-1.2-5.5-3.5L3.8 13a1.5 1.5 0 012.6-1.5L8 14',
  zoom: 'M10.5 4a6.5 6.5 0 110 13 6.5 6.5 0 010-13zM15.5 15.5L21 21M8 10.5h5M10.5 8v5',
  type: 'M5 5h14M12 5v14M9 19h6',
  play: 'M7 4l13 8-13 8z',
  pause: 'M7 4h3v16H7zM14 4h3v16h-3z',
  stepBack: 'M18 5L9 12l9 7zM6 5v14',
  stepFwd: 'M6 5l9 7-9 7zM18 5v14',
  goIn: 'M5 4v16M19 5l-9 7 9 7z',
  goOut: 'M19 4v16M5 5l9 7-9 7z',
  markIn: 'M8 4h-3v16h3',
  markOut: 'M16 4h3v16h-3',
  marker: 'M7 3h10v12l-5 5-5-5z',
  lift: 'M12 18V6M7 11l5-5 5 5M4 21h16',
  extract: 'M12 6v12M7 13l5 5 5-5M4 3h16',
  camera: 'M4 7h3l2-3h6l2 3h3v12H4zM12 10a3.5 3.5 0 110 7 3.5 3.5 0 010-7z',
  insert: 'M3 6h7v12H3zM14 6h7v12h-7zM12 2v8M9 7l3 3 3-3',
  overwrite: 'M3 6h18v12H3zM12 2v8M9 7l3 3 3-3',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 9a3 3 0 110 6 3 3 0 010-6z',
  eyeOff: 'M3 3l18 18M10.6 5.1A10.8 10.8 0 0112 5c6.5 0 10 7 10 7a17 17 0 01-3.2 4M6.6 6.6C3.9 8.4 2 12 2 12s3.5 7 10 7c1.6 0 3-.4 4.3-1',
  lock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 017 0v3',
  unlock: 'M6 11h12v9H6zM8.5 11V8a3.5 3.5 0 016.8-1.2',
  magnet: 'M5 4h4v8a3 3 0 006 0V4h4v8a7 7 0 01-14 0zM5 8h4M15 8h4',
  plus: 'M12 5v14M5 12h14',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13',
  list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
  grid: 'M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z',
  search: 'M10.5 4a6.5 6.5 0 110 13 6.5 6.5 0 010-13zM15.5 15.5L21 21',
  folder: 'M3 6h6l2 2h10v11H3z',
  close: 'M6 6l12 12M18 6L6 18',
  reset: 'M4 12a8 8 0 108-8 8.2 8.2 0 00-6 2.6M4 4v4h4',
  chevron: 'M9 6l6 6-6 6',
  fx: 'M4 18c3 0 3-12 6-12M5 11h5M13 9l6 8M19 9l-6 8',
  wave: 'M3 12h2M7 8v8M11 5v14M15 9v6M19 7v10M21 12h0',
  film: 'M4 4h16v16H4zM8 4v16M16 4v16M4 8h4M4 12h4M4 16h4M16 8h4M16 12h4M16 16h4',
  image: 'M4 5h16v14H4zM8 10a1.5 1.5 0 110 3 1.5 1.5 0 010-3zM20 16l-5-5-8 8',
  text: 'M5 5h14M12 5v14',
  sound: 'M4 9h4l5-4v14l-5-4H4zM16 9a4 4 0 010 6M18.5 6.5a8 8 0 010 11',
  keyboard: 'M3 6h18v12H3zM7 10h.01M11 10h.01M15 10h.01M7 14h10',
  export: 'M12 4v11M7 9l5-5 5 5M5 15v5h14v-5',
};

export type IconName = keyof typeof P;

export default function Icon({ name, size = 16, style, title }: { name: IconName; size?: number; style?: CSSProperties; title?: string }) {
  const filled = name === 'play' || name === 'stepBack' || name === 'stepFwd' || name === 'goIn' || name === 'goOut' || name === 'marker';
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={filled ? 1.2 : 1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flex: 'none', display: 'block', ...style }}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title && <title>{title}</title>}
      <path d={P[name]} />
    </svg>
  );
}
