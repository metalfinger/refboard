export type UploadStatus = 'uploading' | 'processing' | 'done' | 'failed';

export interface UploadJob {
  id: string;
  fileName: string;
  fileSize: number;
  mediaType: 'image' | 'video';
  status: UploadStatus;
  progress: number; // 0-1 for upload phase
  error?: string;
  /** DB image ID — set after upload response, used to match media:job:update */
  imageId?: string;
  /** For retry */
  file?: File;
  boardId?: string;
  createdAt: number;
}

type Listener = () => void;

export class UploadManager {
  jobs = new Map<string, UploadJob>();
  private _listeners = new Set<Listener>();
  private _dismissTimers = new Map<string, ReturnType<typeof setTimeout>>();

  subscribe(fn: Listener): () => void {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  private _notify() {
    for (const fn of this._listeners) fn();
  }

  /** Create a new upload job. Returns the job ID. */
  addJob(file: File, boardId: string): string {
    const id = crypto.randomUUID();
    const isVideo = file.type.startsWith('video/');
    this.jobs.set(id, {
      id,
      fileName: file.name || (isVideo ? 'video' : 'image'),
      fileSize: file.size,
      mediaType: isVideo ? 'video' : 'image',
      status: 'uploading',
      progress: 0,
      file,
      boardId,
      createdAt: Date.now(),
    });
    this._notify();
    return id;
  }

  /** Update upload progress (0-1). */
  setProgress(jobId: string, progress: number) {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.progress = progress;
    this._notify();
  }

  /** Upload finished — image is done, video moves to processing. */
  uploadComplete(jobId: string, imageId: string) {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.imageId = imageId;
    job.progress = 1;
    // Clean up retained file reference
    delete job.file;
    if (job.mediaType === 'video') {
      job.status = 'processing';
    } else {
      job.status = 'done';
      this._autoDismiss(jobId);
    }
    this._notify();
  }

  /** Video processing finished (from media:job:update socket event). */
  processingComplete(imageId: string) {
    for (const job of this.jobs.values()) {
      if (job.imageId === imageId && job.status === 'processing') {
        job.status = 'done';
        this._autoDismiss(jobId(job));
        this._notify();
        return;
      }
    }
  }

  /** Mark a job as failed. */
  setFailed(jobId: string, error: string) {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.status = 'failed';
    job.error = error;
    this._notify();
  }

  /** Remove a job from the list. */
  dismiss(jobId: string) {
    this._clearDismissTimer(jobId);
    this.jobs.delete(jobId);
    this._notify();
  }

  /** Remove all completed/failed jobs. */
  clearFinished() {
    for (const [id, job] of this.jobs) {
      if (job.status === 'done' || job.status === 'failed') {
        this._clearDismissTimer(id);
        this.jobs.delete(id);
      }
    }
    this._notify();
  }

  /** Get active (non-done) job count. */
  get activeCount(): number {
    let count = 0;
    for (const job of this.jobs.values()) {
      if (job.status !== 'done') count++;
    }
    return count;
  }

  private _autoDismiss(jobId: string) {
    this._clearDismissTimer(jobId);
    this._dismissTimers.set(jobId, setTimeout(() => {
      this.jobs.delete(jobId);
      this._dismissTimers.delete(jobId);
      this._notify();
    }, 4000));
  }

  private _clearDismissTimer(jobId: string) {
    const timer = this._dismissTimers.get(jobId);
    if (timer) {
      clearTimeout(timer);
      this._dismissTimers.delete(jobId);
    }
  }
}

function jobId(job: UploadJob): string {
  return job.id;
}
