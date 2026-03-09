# RefBoard Changelog

Collaborative reference image board for game dev teams (PureRef-style, web-based).

---

## v0.4.0 — Layers, Groups & UI Overhaul (2026-03-09)

### Added
- **Layer panel** — collapsible sidebar showing all canvas objects with visibility toggle, lock toggle, drag-to-reorder, and delete
- **Grouping** — Ctrl+G to group selected objects, Ctrl+Shift+G to ungroup; also available in right-click context menu
- **Arrangement tools** — right-click to auto-arrange selected objects in Grid, Row, or Column layout
- **Number shortcuts** — keys 1-5 select tools (1=Select, 2=Pan, 3=Draw, 4=Text, 5=Eraser)
- **Shortcut labels on toolbar** — each tool button shows its name and number key badge
- **Layers toggle** in toolbar — click to show/hide the layer panel

### Changed
- **All pages redesigned** — Login, CollectionList, CollectionDetail, and Editor all share a cohesive dark theme with refined spacing, gradients, subtle shadows, and premium typography
- **Background**: deeper `#0d0d0d` base with subtle radial gradient accents
- **Cards**: refined borders, hover lift animations, gradient thumbnails
- **Modals**: backdrop blur, deeper shadows, better spacing
- **Buttons**: gradient fills with glow shadows, smooth transitions
- **Toolbar**: taller (44px), tool buttons show name + number key, gradient active state, stacked user avatars
- **Toast notifications**: frosted glass effect with backdrop blur

### Fixed
- **Copy/paste creating empty outlines** — images now properly cloned using `FabricImage.fromURL` instead of generic `fromObject` which didn't reload image data
- **Copy includes `src`** — serialization now includes `['id', 'src']` so image URLs survive clipboard operations

---

## v0.3.0 — UX Polish & Clipboard (2026-03-09)

### Added
- **Right-click context menu** — Copy, Paste, Duplicate, Copy as Image, Layer ordering, Select All, Fit All, Delete
- **Copy to system clipboard** — Ctrl+Shift+C copies selected objects as PNG image (paste in Paint, Photoshop, etc.)
- **Layer ordering** — `]` bring forward, `[` send backward
- **Zoom +/- buttons** in toolbar with Ctrl+=/Ctrl+- keyboard shortcuts
- **Toast notifications** — user join/leave alerts, copy confirmation
- **Empty canvas guide** — shows instructions when canvas is blank (drop, paste, draw, text)

### Fixed
- Fixed `FabricObj` undefined error in paste handler
- Fixed all Fabric.js TypeScript type mismatches (`toJSON`, `fromObject`, `bringObjectForward`)
- Zero TypeScript errors across the project

---

## v0.2.0 — Real-time Collaboration Rewrite (2026-03-09)

### Added
- **Full-scene sync (Excalidraw approach)** — broadcast entire `canvas.toJSON()` on every change, `loadFromJSON` on receive
- **Lightweight transform events** — 50ms throttled position/scale/angle during drag for smooth real-time
- **Interaction deferral** — remote scene updates queued during active mouse interaction to prevent conflicts
- **Suppress/resume broadcasts** — prevents flooding during initial load and remote scene application
- **User search autocomplete** in ShareDialog — searches by name/email via `/api/users/search`
- **Copy/Paste/Duplicate** — Ctrl+C/V for canvas objects, Ctrl+D for duplicate with offset
- **Breadcrumb navigation** — Username / Collection / Board with clickable links
- **User cursors** — real-time cursor position display with colored name labels

### Changed
- Save debounce reduced from 5s to 2s
- Remote changes no longer reset save timer (checks `isRemoteUpdate()`)
- Scene sync throttle: 300ms for full scene, 50ms for transforms

### Fixed
- Images now served through backend proxy (`/api/images/*`) instead of internal Docker URLs
- Canvas height not filling viewport
- `cursor:move` vs `cursor:moved` event name mismatch
- User joined/left field name mismatches (`userId`/`id`, `displayName`/`display_name`)
- "Unsaved" status stuck due to remote changes triggering save debounce

---

## v0.1.0 — Initial Scaffold (2026-03-08)

### Architecture
- **Frontend**: React + Vite + TypeScript + Fabric.js v6
- **Backend**: Express + SQLite (WAL mode) + Socket.IO
- **Storage**: MinIO (S3-compatible) for images
- **Auth**: JWT-based with login/register
- **Deployment**: Docker single-container (multi-stage build)

### Features
- Collections with boards hierarchy
- Board editor with Fabric.js canvas
- Tools: Select, Pan, Draw (PencilBrush), Text (IText), Eraser
- Image upload via drag & drop and clipboard paste
- URL drag support (drag image URL from browser)
- Auto-save with debounce
- Canvas state persistence (JSON in SQLite)
- Collection sharing with role-based access (owner, editor, viewer)
- Undo/Redo history
- Scroll-to-zoom, middle-mouse pan, space+drag pan
- Fit All (Ctrl+0)
- Select All (Ctrl+A)
- Delete selected (Del/Backspace)
- Dark theme UI
- Compact toolbar with SVG icons
- Status bar with save indicator
- Color picker for draw/text tools
- Stroke width slider (draw mode)
- Font size slider (text mode)
- Online user avatars in toolbar

### Backend Endpoints
- `POST /api/auth/register` — create account
- `POST /api/auth/login` — JWT login
- `GET /api/collections` — list user's collections
- `POST /api/collections` — create collection
- `GET /api/boards/:id` — get board with canvas state
- `POST /api/boards/:id/save` — save canvas state
- `POST /api/boards/:id/images` — upload image to MinIO
- `POST /api/boards/:id/images/from-url` — upload from URL
- `GET /api/images/*` — image proxy (MinIO → browser)
- `GET /api/users/search` — user search for sharing

### Socket.IO Events
- `board:join` / `board:leave` — room management
- `scene:update` — full canvas JSON broadcast
- `object:transform` — lightweight transform during drag
- `cursor:move` / `cursor:moved` — real-time cursor positions
- `user:joined` / `user:left` — presence notifications

### File Structure (38 files)
```
refboard/
├── backend/
│   ├── server.js          # Express + Socket.IO setup
│   ├── db.js              # SQLite with WAL mode
│   ├── auth.js            # JWT auth middleware
│   ├── minio.js           # MinIO client + image proxy URLs
│   ├── routes/
│   │   ├── auth.js        # Login/register
│   │   ├── boards.js      # Board CRUD + image upload
│   │   └── collections.js # Collection CRUD + sharing
│   └── socket/
│       ├── index.js        # Socket.IO auth + setup
│       └── board-room.js   # Room management + sync relay
├── frontend/
│   ├── src/
│   │   ├── canvas/
│   │   │   ├── FabricCanvas.tsx  # Fabric.js canvas wrapper
│   │   │   ├── image-drop.ts    # Drag/drop + paste handlers
│   │   │   ├── sync.ts          # Full-scene sync engine
│   │   │   ├── history.ts       # Undo/redo manager
│   │   │   └── tools.ts         # Tool activation logic
│   │   ├── components/
│   │   │   ├── Toolbar.tsx       # Tool bar with SVG icons
│   │   │   ├── StatusBar.tsx     # Bottom status bar
│   │   │   ├── UserCursors.tsx   # Remote cursor display
│   │   │   ├── ContextMenu.tsx   # Right-click menu
│   │   │   ├── ShareDialog.tsx   # Collection sharing
│   │   │   └── ColorPicker.tsx   # Color selection
│   │   ├── pages/
│   │   │   ├── Editor.tsx        # Main board editor
│   │   │   ├── Dashboard.tsx     # Collections list
│   │   │   └── Login.tsx         # Auth page
│   │   ├── api.ts               # HTTP API client
│   │   ├── auth.ts              # Auth context
│   │   └── socket.ts            # Socket.IO client
│   └── vite.config.ts
├── Dockerfile
└── docker-compose.yml
```
