export interface Thread {
  id: string;
  board_id: string;
  object_id: string;
  anchor_type: 'object' | 'point';
  pin_x: number | null;
  pin_y: number | null;
  status: 'open' | 'resolved' | 'archived';
  resolved_by: string | null;
  resolved_at: string | null;
  comment_count: number;
  last_commented_at: string | null;
  last_commented_by: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  comments: Comment[];
}

export interface Comment {
  id: string;
  thread_id: string;
  user_id: string;
  author_name: string;
  author_color: string | null;
  content: string;
  edited_at: string | null;
  created_at: string;
}

type Listener = () => void;

export class AnnotationStore {
  threads = new Map<string, Thread>();

  private _listeners = new Set<Listener>();
  private _version = 0;

  /** Monotonic version counter for useSyncExternalStore snapshots */
  get version(): number { return this._version; }

  subscribe(fn: Listener): () => void {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  private _notify() {
    this._version++;
    for (const fn of this._listeners) fn();
  }

  // ── Bulk load ──

  loadThreads(threads: Thread[]) {
    this.threads.clear();
    for (const t of threads) {
      this.threads.set(t.id, t);
    }
    this._notify();
  }

  clear() {
    this.threads.clear();
    this._notify();
  }

  // ── Socket event handlers ──

  onThreadAdd(thread: Thread, comment: Comment) {
    thread.comments = [comment];
    this.threads.set(thread.id, thread);
    this._notify();
  }

  onThreadStatus(threadId: string, status: string, resolvedBy: string | null, resolvedAt: string | null) {
    const t = this.threads.get(threadId);
    if (!t) return;
    t.status = status as Thread['status'];
    t.resolved_by = resolvedBy;
    t.resolved_at = resolvedAt;
    this._notify();
  }

  onThreadDelete(threadId: string) {
    this.threads.delete(threadId);
    this._notify();
  }

  onCommentAdd(threadId: string, comment: Comment) {
    const t = this.threads.get(threadId);
    if (!t) return;
    t.comments.push(comment);
    t.comment_count = t.comments.length;
    t.last_commented_at = comment.created_at;
    t.last_commented_by = comment.user_id;
    this._notify();
  }

  onCommentUpdate(threadId: string, commentId: string, content: string, editedAt: string) {
    const t = this.threads.get(threadId);
    if (!t) return;
    const c = t.comments.find((c) => c.id === commentId);
    if (c) {
      c.content = content;
      c.edited_at = editedAt;
    }
    this._notify();
  }

  onCommentDelete(threadId: string, commentId: string) {
    const t = this.threads.get(threadId);
    if (!t) return;
    t.comments = t.comments.filter((c) => c.id !== commentId);
    t.comment_count = t.comments.length;
    this._notify();
  }

  // ── Convenience getters ──

  /** Get 1-based sequential pin number for a thread on this board */
  getPinNumber(threadId: string): number {
    const sorted = Array.from(this.threads.values())
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    const idx = sorted.findIndex((t) => t.id === threadId);
    return idx + 1;
  }

  getThreadsForObject(objectId: string): Thread[] {
    const result: Thread[] = [];
    for (const t of this.threads.values()) {
      if (t.object_id === objectId) result.push(t);
    }
    return result;
  }

}
