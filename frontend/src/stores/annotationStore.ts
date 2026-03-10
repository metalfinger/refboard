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

export interface Vote {
  board_id: string;
  object_id: string;
  user_id: string;
}

type Listener = () => void;

export class AnnotationStore {
  threads = new Map<string, Thread>();
  /** objectId → Set<userId> */
  votes = new Map<string, Set<string>>();

  private _listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  private _notify() {
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

  loadVotes(votes: Vote[]) {
    this.votes.clear();
    for (const v of votes) {
      if (!this.votes.has(v.object_id)) this.votes.set(v.object_id, new Set());
      this.votes.get(v.object_id)!.add(v.user_id);
    }
    this._notify();
  }

  clear() {
    this.threads.clear();
    this.votes.clear();
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

  onVoteToggle(objectId: string, userId: string, active: boolean) {
    if (!this.votes.has(objectId)) this.votes.set(objectId, new Set());
    const set = this.votes.get(objectId)!;
    if (active) set.add(userId); else set.delete(userId);
    if (set.size === 0) this.votes.delete(objectId);
    this._notify();
  }

  // ── Convenience getters ──

  getThreadsForObject(objectId: string): Thread[] {
    const result: Thread[] = [];
    for (const t of this.threads.values()) {
      if (t.object_id === objectId) result.push(t);
    }
    return result;
  }

  getVoteCount(objectId: string): number {
    return this.votes.get(objectId)?.size ?? 0;
  }

  hasVoted(objectId: string, userId: string): boolean {
    return this.votes.get(objectId)?.has(userId) ?? false;
  }
}
