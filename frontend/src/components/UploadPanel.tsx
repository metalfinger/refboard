import React, { useSyncExternalStore } from 'react';
import { UploadManager, UploadJob } from '../stores/uploadManager';

interface UploadPanelProps {
  uploadManager: UploadManager;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const STATUS_LABELS: Record<string, string> = {
  queued: 'Queued',
  uploading: 'Uploading',
  processing: 'Processing',
  done: 'Done',
  failed: 'Failed',
};

const STATUS_COLORS: Record<string, string> = {
  queued: '#888',
  uploading: '#4a9eff',
  processing: '#ffa94d',
  done: '#4ade80',
  failed: '#f87171',
};

function JobRow({ job, onDismiss, onCancel }: { job: UploadJob; onDismiss: () => void; onCancel?: () => void }) {
  const pct = Math.round(job.progress * 100);
  const color = STATUS_COLORS[job.status];

  return (
    <div style={{
      padding: '6px 8px', display: 'flex', flexDirection: 'column', gap: '3px',
      borderBottom: '1px solid #222',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
        <span style={{
          width: '6px', height: '6px', borderRadius: '50%', background: color, flexShrink: 0,
          animation: job.status === 'processing' ? 'pulse 1.5s infinite' : undefined,
        }} />
        <span style={{
          flex: 1, fontSize: '11px', color: '#ccc', overflow: 'hidden',
          textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {job.fileName}
        </span>
        <span style={{ fontSize: '10px', color: '#555', flexShrink: 0 }}>
          {formatSize(job.fileSize)}
        </span>
        {job.status === 'queued' && onCancel && (
          <button onClick={onCancel} style={{
            background: 'none', border: 'none', color: '#f87171', cursor: 'pointer',
            fontSize: '10px', padding: '0 2px', flexShrink: 0,
          }}>cancel</button>
        )}
        {(job.status === 'done' || job.status === 'failed') && (
          <button onClick={onDismiss} style={{
            background: 'none', border: 'none', color: '#444', cursor: 'pointer',
            fontSize: '10px', padding: '0 2px', flexShrink: 0,
          }}>x</button>
        )}
      </div>

      {/* Progress bar for uploading */}
      {job.status === 'uploading' && (
        <div style={{ height: '3px', background: '#222', borderRadius: '2px', overflow: 'hidden' }}>
          <div style={{
            height: '100%', width: `${pct}%`, background: color,
            borderRadius: '2px', transition: 'width 0.2s ease',
          }} />
        </div>
      )}

      {/* Status label */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
        <span style={{ fontSize: '10px', color: color }}>
          {job.status === 'uploading' ? `${STATUS_LABELS[job.status]} ${pct}%` : STATUS_LABELS[job.status]}
        </span>
        {job.error && (
          <span style={{ fontSize: '10px', color: '#f87171' }}> — {job.error}</span>
        )}
      </div>
    </div>
  );
}

export default function UploadPanel({ uploadManager }: UploadPanelProps) {
  // Re-render on any store change
  const _v = useSyncExternalStore(
    (cb) => uploadManager.subscribe(cb),
    () => uploadManager.jobs.size + Array.from(uploadManager.jobs.values()).reduce((s, j) => s + j.progress + (j.status === 'done' ? 100 : 0), 0),
  );

  const jobs = Array.from(uploadManager.jobs.values())
    .sort((a, b) => b.createdAt - a.createdAt);

  if (jobs.length === 0) return null;

  return (
    <div style={{
      position: 'absolute', bottom: '40px', left: '12px', zIndex: 400,
      width: '240px', background: 'rgba(17,17,17,0.95)', border: '1px solid #2a2a2a',
      borderRadius: '8px', overflow: 'hidden', backdropFilter: 'blur(8px)',
      boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
    }}>
      {/* Header */}
      <div style={{
        padding: '6px 8px', borderBottom: '1px solid #2a2a2a',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <span style={{ fontSize: '11px', color: '#888', fontWeight: 600 }}>
          Uploads {uploadManager.activeCount > 0 ? `(${uploadManager.activeCount})` : ''}
        </span>
        {jobs.some((j) => j.status === 'done' || j.status === 'failed') && (
          <button onClick={() => uploadManager.clearFinished()} style={{
            background: 'none', border: 'none', color: '#555', cursor: 'pointer', fontSize: '10px',
          }}>Clear</button>
        )}
      </div>

      {/* Job list — max 4 visible, scroll */}
      <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
        {jobs.map((job) => (
          <JobRow
            key={job.id}
            job={job}
            onDismiss={() => uploadManager.dismiss(job.id)}
            onCancel={job.status === 'queued' ? () => uploadManager.cancel(job.id) : undefined}
          />
        ))}
      </div>

      {/* Pulse animation for processing state */}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </div>
  );
}
