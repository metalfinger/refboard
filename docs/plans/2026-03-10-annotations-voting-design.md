# Annotations & Voting System — Design

## Goal

Add thread-centric comments (object-level and region-pinned) and per-object upvoting to refboard, turning it into a collaborative feedback tool for game dev art review and mood board curation.

## Core Decisions

| Decision | Choice |
|----------|--------|
| Comment anchoring | Both object-level and region-pinned (anchor_type + nullable pinX/pinY) |
| Pin coordinates | Relative 0-1 range (survives transforms naturally) |
| Structure | Thread-centric: one pin = one thread, flat replies inside |
| Reply depth | Flat (v1) — root comment + flat replies, no nested threading |
| Thread status | Enum: open, resolved, archived (with resolved_by, resolved_at) |
| Voting | Simple upvote per object, one vote per user, toggle on/off |
| Real-time sync | Everything live via socket events, server-authoritative |
| Socket broadcast | Include sender — canonical event is the single codepath for all clients |
| Canvas UX | Pin markers + side panel + Review Mode (soft, not modal) |
| Object delete | Soft orphan — comments hidden from canvas, visible in panel |
| Object duplicate | Comments do not copy |
| Object ID stability | Scene object UUIDs must remain stable across saves, sync, and reloads |

## Critical Assumption

`object_id` in threads/votes references scene object UUIDs inside `canvas_state`. These IDs **must remain stable** across saves, sync, and board reloads. This is already the case in the current SceneManager (objects get UUIDs at creation, preserved through all operations), but it is a hard dependency for this feature.

---

## Data Model

### `comment_threads` table

Thread is the anchor — one pin = one thread. Carries the spatial/object binding.

```sql
CREATE TABLE IF NOT EXISTS comment_threads (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  object_id TEXT NOT NULL,              -- scene object UUID (stable across saves)
  anchor_type TEXT NOT NULL DEFAULT 'object',  -- 'object' | 'point' (future: 'rect')
  pin_x REAL,                           -- null for anchor_type='object', 0-1 for 'point'
  pin_y REAL,
  status TEXT NOT NULL DEFAULT 'open',  -- 'open' | 'resolved' | 'archived'
  resolved_by TEXT REFERENCES users(id),
  resolved_at TEXT,
  comment_count INTEGER NOT NULL DEFAULT 1,  -- denormalized, includes root comment
  last_commented_at TEXT,                    -- denormalized, updated on each reply
  last_commented_by TEXT,                    -- denormalized, user_id of last commenter
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_threads_board ON comment_threads(board_id);
CREATE INDEX IF NOT EXISTS idx_threads_object ON comment_threads(board_id, object_id);
```

### `comments` table

Flat replies inside threads. No anchor fields — positioning belongs to the thread.
No parent_id in v1 — all replies are flat, ordered by created_at.

```sql
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  thread_id TEXT NOT NULL REFERENCES comment_threads(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  author_name TEXT NOT NULL,            -- snapshot at creation time
  author_color TEXT,                    -- user color snapshot for avatar
  content TEXT NOT NULL,
  edited_at TEXT,                       -- set on edit, null if never edited
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_comments_thread ON comments(thread_id);
```

### `object_votes` table

```sql
CREATE TABLE IF NOT EXISTS object_votes (
  board_id TEXT NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  object_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (board_id, object_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_votes_object ON object_votes(board_id, object_id);
```

### Object lifecycle

**Transform**: Pins derive position from object bounds each frame. Relative coords (0-1) survive move/scale/rotate automatically.

**Delete**: Don't hard-delete threads. Threads whose object_id no longer exists in canvas_state are "orphaned" — hidden from canvas pins but visible in panel under a "Deleted items" section. Review history matters.

**Duplicate**: Comments do not copy with the object. Clean slate for the duplicate.

---

## API Endpoints

### Threads & Comments

```
GET    /api/boards/:boardId/threads                          — all threads + comments for board
POST   /api/boards/:boardId/threads                          — create thread + first comment
                                                               { object_id, anchor_type, pin_x?, pin_y?, content }
PATCH  /api/boards/:boardId/threads/:threadId                — update status { status: 'open'|'resolved'|'archived' }
DELETE /api/boards/:boardId/threads/:threadId                 — delete thread + all comments

POST   /api/boards/:boardId/threads/:threadId/comments       — add reply { content }
PUT    /api/boards/:boardId/threads/:threadId/comments/:id   — edit own comment { content }
DELETE /api/boards/:boardId/threads/:threadId/comments/:id   — delete own comment
```

### Votes

```
GET    /api/boards/:boardId/votes                            — all votes for board
POST   /api/boards/:boardId/votes                            — toggle vote { object_id }
```

### Permissions

- **Public (unauthenticated)**: read-only — can view threads and vote counts, cannot comment or vote
- **Viewer** (collection member): read threads, add threads/comments, vote
- **Editor**: all viewer + resolve/archive threads
- **Owner**: all editor + delete any thread/comment

Public boards expose feedback as read-only. Participating in the review loop requires authentication and collection membership.

---

## Socket Events

Server-authoritative: client sends REST request → server writes DB → server broadcasts canonical event to **all clients in the room including sender**. The REST response returns minimal confirmation (id, timestamp); the socket event is the single codepath that updates local state for everyone.

| Event | Payload |
|-------|---------|
| `thread:add` | `{ boardId, thread, comment }` |
| `thread:status` | `{ boardId, threadId, status, resolvedBy, resolvedAt }` |
| `thread:delete` | `{ boardId, threadId }` |
| `comment:add` | `{ boardId, threadId, comment }` |
| `comment:update` | `{ boardId, threadId, commentId, content, editedAt }` |
| `comment:delete` | `{ boardId, threadId, commentId }` |
| `vote:toggle` | `{ boardId, objectId, userId, active }` |

All broadcast to `board:${boardId}` room.

---

## Canvas UX — Pin Markers

### Pin appearance
- Small circle (16-20px at 1x zoom, scale-independent)
- Unresolved: red fill with white thread count
- Resolved: gray fill, dimmed (hidden by default, toggle to show)
- Region pins: positioned at `(obj.x + pinX * obj.w, obj.y + pinY * obj.h)` in world space
- Object-level pins: top-right corner of object bounding box
- Do NOT render comment text on canvas — pins are minimal dots only

### Vote badge
- Small upvote arrow + count pill at bottom-right of object
- Only visible when count > 0 or in Review Mode

### Interaction
- Click pin → opens panel scrolled to that thread
- Hover pin → tooltip: author + first line of content
- Pins and vote badges visible in **Review Mode**

---

## Review Mode

Soft toggle in toolbar — not a separate locked mode. When enabled:

- Comment pins and vote badges become visible on canvas
- Editing still works — selection, move, resize all functional
- A "Place comment" subtool activates pin placement (crosshair cursor, click on object to place)
- Panel auto-opens to feedback view
- Exiting the subtool returns to normal select behavior

When disabled:

- Pins and badges hidden — clean canvas for arranging/editing
- Panel can still be opened manually but defaults to layer view

This keeps Review Mode useful without trapping users in a separate workflow.

---

## Panel UX — Feedback Panel

### Layout
- Right-side panel, 280px wide, same pattern as LayerPanel
- Toggled via toolbar button (comment icon) or auto-opens in Review Mode
- Tabs or toggle to switch between Layer view and Feedback view

### Filters (top of panel)
- Unresolved only (default on)
- Mine only
- Selected object
- Most voted

### Sort options
- Newest activity
- Unresolved first
- By vote count

### Views

**1. Overview (no selection)**
- List of objects with active threads, grouped by object
- Each row: object name, unresolved thread count badge, vote count + vote button
- "Top voted" section at top for lightweight poll results
- "Deleted items" collapsible section at bottom for orphaned threads

**2. Object detail (object selected or pin clicked)**
- Object name + vote button + count at top
- List of threads for that object
- Each thread: pin indicator (object/point), author, timestamp, first comment preview, reply count, status badge
- Click to expand

**3. Thread expanded**
- Root comment + flat replies in chronological order
- Reply input at bottom
- Resolve/archive button (editor+)
- "Edited" label on modified comments
- Delete button on own comments
- "Jump to object" button — pans/zooms viewport to center on the target object

---

## Frontend State

### Loaded on board open
- `GET /api/boards/:boardId/threads` → `Map<string, Thread>` with nested comments
- `GET /api/boards/:boardId/votes` → `Map<string, Set<string>>` (objectId → userIds)

### Socket updates (single codepath for all clients including sender)
- `thread:add` → insert thread + comment, add pin to overlay
- `thread:status` → update status + resolved_by/at, re-render pin
- `thread:delete` → remove thread, remove pin
- `comment:add` → append to thread's comment list
- `comment:update` → update comment content + edited_at
- `comment:delete` → remove from thread's comment list
- `vote:toggle` → add/remove userId from vote set, update badge

### Pin overlay
- Separate PixiJS Container on viewport (above objects, below selection handles)
- Re-derives positions from object world bounds on viewport change
- Only rendered when Review Mode is active

---

## Implementation Order

Ship comments first, then votes, then review mode polish.

### Phase 1: Comments (core value)
1. Backend: DB schema (comment_threads, comments tables + indexes)
2. Backend: REST endpoints for threads and comments
3. Backend: Socket event relay in board-room.js
4. Frontend: State management (load on board open, socket handlers)
5. Frontend: Feedback panel (overview, object detail, thread views)

### Phase 2: Canvas Pins
6. Frontend: Review Mode toggle in toolbar
7. Frontend: Pin overlay rendering (PixiJS container)
8. Frontend: Pin placement subtool (click-to-place region pins)
9. Frontend: Jump-to-object from thread

### Phase 3: Voting
10. Backend: object_votes table + REST endpoints + socket events
11. Frontend: Vote button in panel + badge on canvas
12. Frontend: "Top voted" section in panel overview

### Phase 4: Polish
13. Frontend: Orphan detection (deleted objects, show in panel)
14. Frontend: Filters and sort options in panel
15. Frontend: "Edited" labels, timestamps, author snapshots
