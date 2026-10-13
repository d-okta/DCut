// ============================================================
// Source Monitor: pratinjau satu media dari panel Proyek, tandai
// In/Out sendiri, lalu Insert (,) / Overwrite (.) ke sequence atau
// seret ke timeline. Sama seperti alur Source -> Program di Premiere.
// ============================================================
import { useEffect, useRef } from 'react';
import { useProject } from '../store/projectStore';
import { useUi } from '../store/uiStore';
import { toTimecode } from '../types';
import { sourceEdit } from '../commands';
import { MiniRuler, TimecodeField, Transport } from './MonitorBits';

export default function SourceMonitor() {
  const source = useUi((s) => s.source);
  const playing = useUi((s) => s.sourcePlaying);
  const setSource = useUi((s) => s.setSource);
  const setPlaying = useUi((s) => s.setSourcePlaying);
  const asset = useProject((s) => (source ? s.project.assets.find((a) => a.id === source.assetId) : undefined));
  const fps = useProject((s) => s.project.fps);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const isAV = asset && (asset.type === 'video' || asset.type === 'audio');
  const dur = asset ? (asset.type === 'image' ? 10 : asset.duration) : 0;

  // putar / jeda elemen sesuai state
  useEffect(() => {
    const el = videoRef.current;
    if (!el) return;
    if (playing) void el.play().catch(() => setPlaying(false));
    else el.pause();
  }, [playing, setPlaying]);

  // sinkronkan posisi saat di-seek dari luar (bukan saat sedang diputar)
  useEffect(() => {
    const el = videoRef.current;
    if (!el || playing || !source) return;
    if (Math.abs(el.currentTime - source.time) > 1 / (2 * fps)) {
      try { el.currentTime = source.time; } catch { /* belum siap */ }
    }
  }, [source?.time, playing, fps]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!source || !asset) {
    return (
      <div className="monitor">
        <div className="monitor-area">
          <p className="monitor-empty">
            Klik dua kali media di panel <b>Proyek</b> untuk melihatnya di sini. Tandai bagian yang dipakai
            dengan I dan O, lalu tekan koma untuk Insert atau titik untuk Overwrite ke timeline.
          </p>
        </div>
      </div>
    );
  }

  const seek = (t: number) => {
    const v = Math.max(0, Math.min(dur, t));
    setSource({ time: v });
  };
  const a = source.inPoint, b = source.outPoint;
  const span = (b ?? dur) - (a ?? 0);

  return (
    <div className="monitor" onPointerDown={() => useUi.getState().setFocusedMonitor('source')}>
      <div className="monitor-area">
        {asset.type === 'image' ? (
          <img src={asset.url} alt={asset.name} style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} draggable={false} />
        ) : (
          <video
            ref={videoRef}
            src={asset.url}
            style={{ maxWidth: '100%', maxHeight: '100%', background: '#000', display: asset.type === 'audio' ? 'none' : 'block' }}
            preload="auto"
            playsInline
            onTimeUpdate={(e) => { if (playing) setSource({ time: e.currentTarget.currentTime }); }}
            onEnded={() => setPlaying(false)}
            onLoadedMetadata={(e) => { try { e.currentTarget.currentTime = source.time; } catch { /* abaikan */ } }}
          />
        )}
        {asset.type === 'audio' && (
          <p className="monitor-empty">{asset.name}<br /><span className="hint">Berkas audio, tekan Spasi untuk mendengar.</span></p>
        )}
      </div>
      <div className="monitor-bar">
        <TimecodeField time={source.time} fps={fps} label="Timecode sumber" onCommit={seek} />
        <span className="hint" style={{ fontSize: 11, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={asset.name}>{asset.name}</span>
        <span className="tc-dim" title="Durasi In-Out">{toTimecode(Math.max(0, span), fps)}</span>
      </div>
      <MiniRuler time={source.time} duration={dur} inPoint={a} outPoint={b} onSeek={seek} />
      <Transport
        buttons={[
          { icon: 'markIn', label: 'Tandai In', keys: 'I', onClick: () => setSource({ inPoint: source.time }) },
          { icon: 'markOut', label: 'Tandai Out', keys: 'O', onClick: () => setSource({ outPoint: source.time }) },
          null,
          { icon: 'goIn', label: 'Ke In', onClick: () => seek(a ?? 0) },
          { icon: 'stepBack', label: 'Mundur 1 frame', keys: '←', onClick: () => seek(source.time - 1 / fps), disabled: !isAV },
          { icon: playing ? 'pause' : 'play', label: playing ? 'Jeda' : 'Putar', keys: 'Spasi', onClick: () => setPlaying(!playing), big: true, disabled: !isAV },
          { icon: 'stepFwd', label: 'Maju 1 frame', keys: '→', onClick: () => seek(source.time + 1 / fps), disabled: !isAV },
          { icon: 'goOut', label: 'Ke Out', onClick: () => seek(b ?? dur) },
          null,
          { icon: 'insert', label: 'Insert ke timeline', keys: ',', onClick: () => sourceEdit('insert') },
          { icon: 'overwrite', label: 'Overwrite ke timeline', keys: '.', onClick: () => sourceEdit('overwrite') },
        ]}
      />
    </div>
  );
}
