# RefBoard Product Expansion Plan — 2026-03-12

## Goal

Turn RefBoard from a collaborative media board into a stronger visual workspace that combines:

- PureRef-style media handling
- Figma-style review and comments
- Milanote-style notes and structure
- Kosmik-style mixed-media research and retrieval

This plan is written for iterative implementation with code review after each slice.

---

## Working Model

### Roles

- **Builder session**: implements one scoped slice at a time
- **Reviewer session**: reviews code for correctness, regressions, UX consistency, and plan adherence

### Delivery rules

- Ship in thin vertical slices, not broad unfinished scaffolding
- Preserve existing board stability and current media workflows
- Avoid overloading the current `text` element with unrelated behavior
- Add first-class object types where semantics differ
- Prefer migration-safe schema and scene-format extensions

### Definition of done for each slice

- Data model is explicit
- UI behavior is testable manually
- Socket sync behavior is defined
- Save/load survives reload
- Permissions are enforced
- Existing image/video flows still work

---

## Current State Summary

### Already present

- Infinite canvas with images, GIFs, videos, drawings, text, frames/groups
- Real-time sync
- Upload pipeline with image/video support
- Thread/comment backend and frontend groundwork
- Votes groundwork
- Mattermost import

### Main gaps

- Comments need to reach a polished Figma-like UX
- No sticky notes / note cards
- No PDF media type
- No markdown/doc object
- Current `text` object is too primitive for notes/docs
- No strong retrieval layer for mixed media
- No Milanote-style structural/workflow objects

---

## Product Principles

1. **Labels are not documents**
   Keep lightweight canvas text for labels and annotations.

2. **Every content type needs its own semantics**
   `text`, `sticky`, `pdf`, `markdown`, `comment`, and `task` should not collapse into one generic object.

3. **Canvas should stay visually fast**
   Large or dense content must degrade gracefully with zoom and viewport distance.

4. **Review is a first-class layer**
   Comments, pins, resolution state, and jump-to-context should feel native, not bolted on.

5. **Mixed media must be searchable**
   PDF text, markdown text, note text, filenames, and comments should converge in one retrieval model.

---

## Object Model Direction

### Keep

- `image`
- `video`
- `drawing`
- `text` for lightweight labels
- `group` / frame

### Add next

- `sticky` — visual note card
- `pdf` — document or page-based asset object
- `markdown` — rich document card with preview

### Add later

- `web` — URL/article/embed card
- `task` — checklist/work item card
- `connector` — relationship line
- `column` or stronger structure container if needed beyond frames

---

## Zoom Behavior Rules

### `text`

- World-space label
- Scales naturally with zoom
- Best for captions and annotations

### `sticky`

- Canvas object with card chrome
- Text remains readable longer than plain labels
- Use clamped on-screen font sizing or simplified preview when zoomed out

### `markdown`

- Card preview on canvas
- Full reading/editing in side panel or modal inspector
- Do not render entire long documents at tiny zoom levels

### `comment`

- Review UI overlay behavior, not a regular scene text object

---

## Priority Plan

## Phase 1 — Review Layer Completion

### Objective

Finish comments into a reliable Figma-style review workflow before adding more content types.

### Scope

- Object-level comments
- Point/region-pinned comments
- Thread list + detail panel polish
- Resolve/reopen flow
- Unread state
- Jump-to-object
- Better pin visibility and interactions
- Notification/toast behavior for incoming comments
- Permissions for comment vs edit vs view

### Key tasks

1. Audit existing comments/votes code paths and close gaps
2. Stabilize socket event flows and sender behavior
3. Ensure orphan handling for deleted objects is sane
4. Add unread/new indicators and active-thread focus behavior
5. Tighten panel UX and pin hit-testing

### Acceptance criteria

- User can comment on an object and on a specific point
- Another user sees updates live without reload
- Threads can be resolved and reopened
- Deleted objects do not break thread history
- Jump-to-object is reliable
- Review flow feels coherent on a live board

### Reviewer focus

- Event duplication
- Board permission leaks
- Orphaned thread correctness
- Socket race conditions
- UI regressions in editor layout

---

## Phase 2 — Sticky Notes

### Objective

Add Milanote-style note cards without damaging the current label text tool.

### Scope

- New `sticky` scene object
- Preset colors/themes
- Title/body or single-body variant
- Resize behavior
- Duplicate/copy-paste
- Inline editing
- Selection, layering, grouping

### Data model

Suggested fields:

```ts
type StickyObject = {
  id: string;
  type: 'sticky';
  x: number; y: number; w: number; h: number;
  sx: number; sy: number; angle: number; z: number;
  opacity: number; locked: boolean; visible: boolean; name: string;
  title?: string;
  text: string;
  theme: string;
  fontSize: number;
};
```

### Key tasks

1. Extend scene schema and serialization
2. Add Pixi renderer for note card
3. Add editing UX
4. Add toolbar action and shortcuts
5. Validate transform, selection, save/load, sync

### Acceptance criteria

- Sticky can be created in one action
- It looks like a note card, not raw canvas text
- It persists and syncs correctly
- It remains readable enough across zoom levels

### Reviewer focus

- Scene-format backward compatibility
- Hitbox and transform correctness
- Editing UX under zoom
- Performance with many notes

---

## Phase 3 — PDF Support ✅ COMPLETED (2026-03-14)

> **Implemented:** Full PDF upload → page rasterization (pdftoppm) → page picker modal → canvas placement as `pdf-page` objects. See `docs/superpowers/specs/2026-03-14-pdf-support-design.md` for detailed spec and `docs/superpowers/plans/2026-03-14-pdf-support-plan.md` for implementation plan.

### Objective

Make PDFs a first-class media type with strong review utility.

### Scope

- Upload PDF files
- Backend page rasterization
- PDF metadata storage
- Page thumbnails / previews
- Place full doc card or individual pages on canvas
- Comment on page/region
- Basic PDF text extraction for search preparation

### Product choice

Start with **page-based ingestion**, not an embedded fully interactive PDF viewer on the canvas.

Reason:

- simpler scene model
- easier comments
- better performance predictability
- closer to board workflows

### Backend tasks

1. Accept `application/pdf`
2. Generate page previews
3. Store doc metadata: page count, dimensions, extracted text status
4. Add asset routing for preview pages

### Frontend tasks

1. Add PDF upload handling
2. Add PDF card/import dialog
3. Support dragging pages onto canvas as scene objects
4. Allow comments pinned to page content

### Acceptance criteria

- User uploads a PDF successfully
- User can place page previews on canvas
- PDF pages persist and sync like other assets
- Comments can be attached to a page object

### Reviewer focus

- Processing failures and user feedback
- Storage layout and cleanup
- Large PDF performance
- Whether page objects and source document records stay consistent

---

## Phase 4 — Text System Overhaul

### Objective

Fix the current text element so it remains strong for labels while not pretending to be a note/doc system.

### Scope

- Better text box layout and wrapping
- Alignment
- Curated font set
- Background/padding for label chips if needed
- Improved resize semantics
- Better zoom behavior

### Explicit non-goal

Do not turn `text` into markdown or sticky notes.

### Acceptance criteria

- Text boxes wrap predictably
- Editing overlay aligns correctly under zoom and rotation
- Font options are intentional, not random browser defaults
- Labels remain lightweight

### Reviewer focus

- Text measurement drift
- Serialization of layout fields
- Rotation/edit overlay bugs
- Cross-browser behavior

---

## Phase 5 — Markdown Cards

### Objective

Add richer document-like content while keeping the canvas uncluttered.

### Scope

- New `markdown` object
- Canvas preview card with title/excerpt
- Source edit mode
- Render mode
- Links, lists, headings, code blocks
- Open-full-doc side panel

### Product rule

Canvas shows a compact preview, not the entire markdown body at all zoom levels.

### Suggested fields

```ts
type MarkdownObject = {
  id: string;
  type: 'markdown';
  x: number; y: number; w: number; h: number;
  sx: number; sy: number; angle: number; z: number;
  opacity: number; locked: boolean; visible: boolean; name: string;
  title: string;
  markdown: string;
  previewMode: 'card' | 'expanded';
};
```

### Acceptance criteria

- Markdown card can be created and edited
- Canvas preview is readable and compact
- Full content opens in panel/modal
- Save/load/sync works without corruption

### Reviewer focus

- Unsafe markdown rendering
- Performance of live render
- Whether the object should stay on-canvas or move to inspector sooner

---

## Phase 6 — Search and Retrieval

### Objective

Make mixed-media boards retrievable, not just visually navigable.

### Scope

- Search across board titles, filenames, notes, markdown, comments
- PDF extracted text indexing
- Later OCR for images
- Filter by object type, author, tag, updated time

### Acceptance criteria

- A user can search content inside a board and find the right object
- Results can jump to canvas context
- Search does not require full reload of large boards

### Reviewer focus

- Query performance
- Index strategy
- Search result relevance vs complexity

---

## Phase 7 — Structure and Workflow

### Objective

Bring in selected Milanote-style organization features after the content core is solid.

### Scope

- Better frames/sections
- Optional columns/stacks
- Connectors
- Task/checklist cards
- Better share roles: view, comment, edit
- Presentation / clean-share mode
- Export improvements

### Important constraint

Do not add task/workflow objects until notes, docs, and comments are already stable.

### Reviewer focus

- Product sprawl
- Interaction conflicts with selection/grouping
- Share-mode permission correctness

---

## Cross-Cutting Technical Work

### Scene format versioning

- Extend scene schema conservatively
- Keep old boards loadable
- Add migration helpers where needed

### Upload pipeline

- Add clear status feedback for every media type
- Unify queued/processing/ready/failed states

### Performance

- Avoid rendering full-detail content when zoomed out
- Ensure many notes/pages/comments do not tank frame rate

### Permissions

- Formalize role behavior:
  - `viewer`
  - `commenter`
  - `editor`
  - `owner`

### Export

- Board export to image
- Board export to PDF
- Selection export

---

## Recommended Implementation Order

1. Finish review/comments UX
2. Add sticky notes
3. Add PDF ingestion and page placement
4. Overhaul plain text behavior
5. Add markdown cards
6. Add search and PDF text indexing
7. Add structural/workflow features

---

## Suggested PR / Review Slices

### Slice A

- Review/comments gap audit and polish

### Slice B

- `sticky` scene object end-to-end

### Slice C

- PDF backend ingestion and metadata

### Slice D

- PDF page placement UI

### Slice E

- Text box overhaul

### Slice F

- Markdown card object

### Slice G

- Search and retrieval

Each slice should be reviewable independently and should not mix unrelated feature families.

---

## Risks

- Overloading the canvas with too many object semantics too early
- Regressing existing image/video performance
- Mixing review UI and content UI in confusing ways
- Turning text into a catch-all object
- Adding PDF support without strong processing/error handling

---

## Reviewer Checklist

- Is the slice aligned with the current phase?
- Does it preserve current board behavior?
- Is the object schema explicit and future-safe?
- Are save/load/sync semantics correct?
- Are permissions and roles enforced?
- Does the UI feel coherent at different zoom levels?
- Is there a simpler implementation that preserves the same product outcome?

---

## Next Action

Start with **Slice A / Phase 1**:

- review the current comments implementation
- enumerate gaps against the desired review workflow
- close the highest-value UX and correctness issues before adding new content types
