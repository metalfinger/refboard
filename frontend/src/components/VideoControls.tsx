import React, { useEffect, useRef, useState, useCallback } from 'react';
import { VideoSprite } from '../canvas/sprites/VideoSprite';

interface VideoControlsProps {
  videoSprite: VideoSprite;
  /** Screen-space rect of the video element */
  screenRect: { x: number; y: number; w: number; h: number };
}

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function VideoControls({ videoSprite, screenRect }: VideoControlsProps) {
  const video = videoSprite.videoElement;
  const [playing, setPlaying] = useState(videoSprite.isPlaying);
  const [muted, setMuted] = useState(videoSprite.muted);
  const [currentTime, setCurrentTime] = useState(video.currentTime || 0);
  const [duration, setDuration] = useState(video.duration || 0);
  const [seeking, setSeeking] = useState(false);
  const pollRef = useRef<number | null>(null);

  // Poll currentTime while playing
  useEffect(() => {
    if (pollRef.current) {
      cancelAnimationFrame(pollRef.current);
      pollRef.current = null;
    }

    if (!playing || seeking) return;

    let lastUpdate = 0;
    const poll = (now: number) => {
      if (now - lastUpdate >= 250) {
        setCurrentTime(video.currentTime || 0);
        setDuration(video.duration || 0);
        lastUpdate = now;
      }
      pollRef.current = requestAnimationFrame(poll);
    };
    pollRef.current = requestAnimationFrame(poll);

    return () => {
      if (pollRef.current) {
        cancelAnimationFrame(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [playing, seeking, video]);

  // Sync duration on metadata load
  useEffect(() => {
    const onMeta = () => setDuration(video.duration || 0);
    video.addEventListener('loadedmetadata', onMeta);
    // Also grab current values
    setDuration(video.duration || 0);
    setCurrentTime(video.currentTime || 0);
    return () => video.removeEventListener('loadedmetadata', onMeta);
  }, [video]);

  const handlePlayPause = useCallback(() => {
    videoSprite.togglePlayPause();
    setPlaying(videoSprite.isPlaying);
  }, [videoSprite]);

  const handleMuteToggle = useCallback(() => {
    videoSprite.toggleMute();
    setMuted(videoSprite.muted);
  }, [videoSprite]);

  const handleSeekStart = useCallback(() => {
    setSeeking(true);
  }, []);

  const handleSeekChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const t = parseFloat(e.target.value);
    setCurrentTime(t);
  }, []);

  const handleSeekEnd = useCallback((e: React.MouseEvent<HTMLInputElement> | React.TouchEvent<HTMLInputElement>) => {
    const t = parseFloat((e.target as HTMLInputElement).value);
    videoSprite.seek(t);
    setCurrentTime(t);
    setSeeking(false);
  }, [videoSprite]);

  // Position at bottom of the video, centered
  const barWidth = Math.max(200, Math.min(screenRect.w, 400));
  const left = screenRect.x + screenRect.w / 2;
  const top = screenRect.y + screenRect.h + 8;

  return (
    <div
      style={{
        position: 'absolute',
        left,
        top,
        transform: 'translateX(-50%)',
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        padding: '4px 10px',
        width: barWidth,
        height: '36px',
        background: 'rgba(22, 22, 22, 0.96)',
        border: '1px solid #333',
        borderRadius: '10px',
        backdropFilter: 'blur(12px)',
        boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
        zIndex: 100,
        pointerEvents: 'auto',
        boxSizing: 'border-box',
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {/* Play / Pause */}
      <button
        onClick={handlePlayPause}
        title={playing ? 'Pause' : 'Play'}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '24px',
          height: '24px',
          background: 'transparent',
          border: 'none',
          borderRadius: '5px',
          color: '#ccc',
          cursor: 'pointer',
          padding: 0,
          flexShrink: 0,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = '#333'; e.currentTarget.style.color = '#fff'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#ccc'; }}
      >
        {playing ? <IcoPause /> : <IcoPlay />}
      </button>

      {/* Seekbar */}
      <input
        type="range"
        min={0}
        max={duration || 1}
        step={0.1}
        value={currentTime}
        onMouseDown={handleSeekStart}
        onTouchStart={handleSeekStart}
        onChange={handleSeekChange}
        onMouseUp={handleSeekEnd}
        onTouchEnd={handleSeekEnd}
        style={{
          flex: 1,
          height: '4px',
          appearance: 'none',
          background: `linear-gradient(to right, #4a9eff ${(currentTime / (duration || 1)) * 100}%, #444 ${(currentTime / (duration || 1)) * 100}%)`,
          borderRadius: '2px',
          outline: 'none',
          cursor: 'pointer',
        }}
      />

      {/* Time display */}
      <span style={{
        fontSize: '10px',
        color: '#888',
        whiteSpace: 'nowrap',
        fontFamily: 'monospace',
        flexShrink: 0,
        minWidth: '70px',
        textAlign: 'center',
      }}>
        {formatTime(currentTime)} / {formatTime(duration)}
      </span>

      {/* Mute / Unmute */}
      <button
        onClick={handleMuteToggle}
        title={muted ? 'Unmute' : 'Mute'}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '24px',
          height: '24px',
          background: 'transparent',
          border: 'none',
          borderRadius: '5px',
          color: '#ccc',
          cursor: 'pointer',
          padding: 0,
          flexShrink: 0,
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = '#333'; e.currentTarget.style.color = '#fff'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = '#ccc'; }}
      >
        {muted ? <IcoMuted /> : <IcoUnmuted />}
      </button>
    </div>
  );
}

// -- Tiny SVG icons --------------------------------------------------------

function IcoPlay() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
      <path d="M4 2.5v9l7-4.5-7-4.5z" />
    </svg>
  );
}

function IcoPause() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
      <rect x="3" y="2" width="3" height="10" rx="0.5" />
      <rect x="8" y="2" width="3" height="10" rx="0.5" />
    </svg>
  );
}

function IcoUnmuted() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
      <path d="M2 5.5h2l3-2.5v8l-3-2.5H2v-3z" fill="currentColor" opacity="0.3" />
      <path d="M10 4.5c.8.8.8 4.2 0 5" strokeLinecap="round" />
      <path d="M11.5 3c1.3 1.3 1.3 6.7 0 8" strokeLinecap="round" />
    </svg>
  );
}

function IcoMuted() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.3">
      <path d="M2 5.5h2l3-2.5v8l-3-2.5H2v-3z" fill="currentColor" opacity="0.3" />
      <line x1="10" y1="5" x2="13" y2="9" strokeLinecap="round" />
      <line x1="13" y1="5" x2="10" y2="9" strokeLinecap="round" />
    </svg>
  );
}
