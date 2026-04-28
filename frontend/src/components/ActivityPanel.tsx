import React, { useEffect, useRef, useState, useCallback } from 'react';
import api from '../api';
import { getSocket } from '../socket';

interface ActivityEntry {
  id: string;
  board_id: string;
  user_id: string | null;
  actor_name: string | null;
  actor_email: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  target_label: string | null;
  metadata: any;
  created_at: string;
}

interface Props {
  boardId: string;
  onClose: () => void;
}

const PAGE = 50;

const ACTION_META: Record<string, { label: string; verb: string; tone: 'add' | 'remove' | 'edit' | 'comment'; icon: string }> = {
  'image.added':       { label: 'Image',    verb: 'added',     tone: 'add',     icon: '🖼' },
  'video.added':       { label: 'Video',    verb: 'added',     tone: 'add',     icon: '🎞' },
  'pdf.added':         { label: 'PDF',      verb: 'added',     tone: 'add',     icon: '📄' },
  'board.created':     { label: 'Board',    verb: 'created',   tone: 'add',     icon: '✦' },
  'board.renamed':     { label: 'Board',    verb: 'renamed',   tone: 'edit',    icon: '✎' },
  'board.deleted':     { label: 'Board',    verb: 'deleted',   tone: 'remove',  icon: '✕' },
  'thread.created':    { label: 'Comment',  verb: 'started',   tone: 'comment', icon: '💬' },
  'thread.resolved':   { label: 'Thread',   verb: 'resolved',  tone: 'edit',    icon: '✓' },
  'thread.reopened':   { label: 'Thread',   verb: 'reopened',  tone: 'edit',    icon: '↺' },
  'comment.added':     { label: 'Reply',    verb: 'posted',    tone: 'comment', icon: '↪' },
};

const TONE_COLOR: Record<string, string> = {
  add:     '#5fc97e',
  remove:  '#ff8a8a',
  edit:    '#7ba9ff',
  comment: '#e0b75b',
};

function timeAgo(iso: string): string {
  // SQLite returns "2026-04-28 15:50:02" — append Z so JS parses as UTC
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 5) return 'just now';
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString();
}

function dayBucket(iso: string): string {
  const d = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  const now = new Date();
  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.floor((startOfDay(now) - startOfDay(d)) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days} days ago`;
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function ActivityPanel({ boardId, onClose }: Props) {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0); // Force re-render every 30s for relative timestamps
  const listRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (before: string | null = null) => {
    if (before) setLoadingMore(true); else setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams({ limit: String(PAGE) });
      if (before) params.append('before', before);
      const res = await api.get(`/api/boards/${boardId}/activity?${params.toString()}`);
      const newEntries: ActivityEntry[] = res.data?.activity || [];
      setEntries((prev) => before ? [...prev, ...newEntries] : newEntries);
      setHasMore(!!res.data?.hasMore);
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Failed to load activity');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [boardId]);

  useEffect(() => {
    load(null);
  }, [load]);

  // Live updates via Socket.IO
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onNew = (entry: ActivityEntry) => {
      if (entry.board_id !== boardId) return;
      setEntries((prev) => {
        if (prev.some((e) => e.id === entry.id)) return prev;
        return [entry, ...prev];
      });
    };
    socket.on('activity:new', onNew);
    return () => { socket.off('activity:new', onNew); };
  }, [boardId]);

  // Tick every 30s so relative timestamps stay fresh
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30000);
    return () => clearInterval(t);
  }, []);

  // Group by day bucket
  const groups: { label: string; items: ActivityEntry[] }[] = [];
  for (const e of entries) {
    const bucket = dayBucket(e.created_at);
    const last = groups[groups.length - 1];
    if (last && last.label === bucket) last.items.push(e);
    else groups.push({ label: bucket, items: [e] });
  }

  const oldestTs = entries.length ? entries[entries.length - 1].created_at : null;

  // Quiet "tick" warning
  void tick;

  return (
    <div style={{
      position: 'fixed', top: 0, right: 0, height: '100vh',
      width: 'min(420px, 92vw)',
      background: '#0e0e0e', borderLeft: '1px solid #1c1c1c',
      boxShadow: '-12px 0 32px rgba(0,0,0,0.4)',
      display: 'flex', flexDirection: 'column',
      zIndex: 90, color: '#e0e0e0',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '14px 18px', borderBottom: '1px solid #1c1c1c', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 28, height: 28, borderRadius: 7,
            background: 'linear-gradient(135deg, #4a9eff, #3d7dd8)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 14, fontWeight: 700, color: '#fff',
          }}>~</div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#e8e8e8' }}>Activity</div>
            <div style={{ fontSize: 11, color: '#666' }}>Per-board log · live</div>
          </div>
        </div>
        <button onClick={onClose} style={{
          width: 28, height: 28, borderRadius: 6,
          background: 'transparent', border: '1px solid #252525',
          color: '#888', cursor: 'pointer', fontSize: 14,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} title="Close">×</button>
      </div>

      {/* List */}
      <div ref={listRef} style={{ flex: 1, overflowY: 'auto', padding: '12px 0' }}>
        {loading ? (
          <div style={{ color: '#666', padding: 32, textAlign: 'center', fontSize: 13 }}>
            Loading activity…
          </div>
        ) : error ? (
          <div style={{
            color: '#ff8a8a', padding: '12px 16px', margin: '0 14px',
            background: 'rgba(255,107,107,0.08)', border: '1px solid rgba(255,107,107,0.18)',
            borderRadius: 6, fontSize: 12,
          }}>{error}</div>
        ) : entries.length === 0 ? (
          <div style={{ color: '#666', padding: '40px 24px', textAlign: 'center', fontSize: 13, lineHeight: 1.6 }}>
            No activity yet.
            <div style={{ marginTop: 6, fontSize: 11, color: '#444' }}>
              Uploads, board renames, threads and comments will show up here.
            </div>
          </div>
        ) : groups.map((g) => (
          <div key={g.label}>
            <div style={{
              padding: '14px 18px 6px', fontSize: 10, fontWeight: 700,
              color: '#5a5a5a', textTransform: 'uppercase', letterSpacing: '0.8px',
            }}>{g.label}</div>
            {g.items.map((e) => (
              <Row key={e.id} entry={e} />
            ))}
          </div>
        ))}

        {hasMore && !loading && (
          <div style={{ padding: '12px 14px' }}>
            <button
              onClick={() => oldestTs && load(oldestTs)}
              disabled={loadingMore}
              style={{
                width: '100%', padding: '10px',
                background: '#171717', border: '1px solid #252525', borderRadius: 6,
                color: '#888', fontSize: 12, cursor: loadingMore ? 'wait' : 'pointer',
              }}
            >{loadingMore ? 'Loading…' : 'Load older'}</button>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ entry }: { entry: ActivityEntry }) {
  const meta = ACTION_META[entry.action] || { label: entry.action, verb: '', tone: 'edit' as const, icon: '•' };
  const accent = TONE_COLOR[meta.tone];
  return (
    <div style={{
      display: 'flex', gap: 12, padding: '8px 18px',
      alignItems: 'flex-start',
    }}>
      <div style={{
        flexShrink: 0,
        width: 28, height: 28, borderRadius: 7,
        background: 'rgba(255,255,255,0.03)',
        border: `1px solid ${accent}33`,
        color: accent,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 13, marginTop: 2,
      }}>{meta.icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 12.5, lineHeight: 1.45, color: '#cfcfcf' }}>
          <span style={{ color: '#e8e8e8', fontWeight: 600 }}>{entry.actor_name || 'Someone'}</span>
          <span style={{ color: '#888' }}> {meta.verb} </span>
          <span style={{ color: accent, fontWeight: 500 }}>{meta.label.toLowerCase()}</span>
          {entry.target_label && (
            <>
              <span style={{ color: '#666' }}> · </span>
              <span style={{
                color: '#dadada',
                overflow: 'hidden', textOverflow: 'ellipsis',
                whiteSpace: 'nowrap', display: 'inline-block',
                maxWidth: 240, verticalAlign: 'bottom',
              }} title={entry.target_label}>{entry.target_label}</span>
            </>
          )}
        </div>
        <div style={{ fontSize: 10.5, color: '#555', marginTop: 2 }}>{timeAgo(entry.created_at)}</div>
      </div>
    </div>
  );
}
