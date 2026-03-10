/**
 * SpatialGrid — fixed-cell spatial index for fast region queries.
 *
 * Each item occupies one or more grid cells based on its axis-aligned bounds.
 * Query returns all items whose cells overlap the query rectangle.
 *
 * Cell size should be ~1-2x the median item size for best performance.
 * Too small = many cells per item. Too large = too many items per cell.
 */

export interface SpatialEntry<T> {
  id: string;
  data: T;
  x: number;
  y: number;
  w: number;
  h: number;
}

export class SpatialGrid<T> {
  private cellSize: number;
  private cells: Map<string, Set<string>> = new Map();
  private entries: Map<string, SpatialEntry<T>> = new Map();

  constructor(cellSize = 512) {
    this.cellSize = cellSize;
  }

  /** Insert or update an entry. */
  upsert(id: string, data: T, x: number, y: number, w: number, h: number): void {
    // Remove old cells if updating
    if (this.entries.has(id)) {
      this._removeCells(id);
    }

    const entry: SpatialEntry<T> = { id, data, x, y, w, h };
    this.entries.set(id, entry);
    this._insertCells(id, x, y, w, h);
  }

  /** Remove an entry. */
  remove(id: string): void {
    if (!this.entries.has(id)) return;
    this._removeCells(id);
    this.entries.delete(id);
  }

  /** Query all entries that overlap the given rectangle. */
  query(rx: number, ry: number, rw: number, rh: number): SpatialEntry<T>[] {
    const seen = new Set<string>();
    const results: SpatialEntry<T>[] = [];

    const c0 = Math.floor(rx / this.cellSize);
    const r0 = Math.floor(ry / this.cellSize);
    const c1 = Math.floor((rx + rw) / this.cellSize);
    const r1 = Math.floor((ry + rh) / this.cellSize);

    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        const key = `${c},${r}`;
        const cell = this.cells.get(key);
        if (!cell) continue;

        for (const id of cell) {
          if (seen.has(id)) continue;
          seen.add(id);

          const entry = this.entries.get(id)!;
          // AABB overlap check
          if (
            entry.x < rx + rw &&
            entry.x + entry.w > rx &&
            entry.y < ry + rh &&
            entry.y + entry.h > ry
          ) {
            results.push(entry);
          }
        }
      }
    }

    return results;
  }

  /** Get a specific entry by ID. */
  get(id: string): SpatialEntry<T> | undefined {
    return this.entries.get(id);
  }

  /** Number of entries in the index. */
  get size(): number {
    return this.entries.size;
  }

  /** Clear the entire index. */
  clear(): void {
    this.cells.clear();
    this.entries.clear();
  }

  // ---- Internal ----

  private _cellKeys(x: number, y: number, w: number, h: number): string[] {
    const c0 = Math.floor(x / this.cellSize);
    const r0 = Math.floor(y / this.cellSize);
    const c1 = Math.floor((x + w) / this.cellSize);
    const r1 = Math.floor((y + h) / this.cellSize);

    const keys: string[] = [];
    for (let r = r0; r <= r1; r++) {
      for (let c = c0; c <= c1; c++) {
        keys.push(`${c},${r}`);
      }
    }
    return keys;
  }

  private _insertCells(id: string, x: number, y: number, w: number, h: number): void {
    for (const key of this._cellKeys(x, y, w, h)) {
      let cell = this.cells.get(key);
      if (!cell) {
        cell = new Set();
        this.cells.set(key, cell);
      }
      cell.add(id);
    }
  }

  private _removeCells(id: string): void {
    const entry = this.entries.get(id);
    if (!entry) return;
    for (const key of this._cellKeys(entry.x, entry.y, entry.w, entry.h)) {
      const cell = this.cells.get(key);
      if (cell) {
        cell.delete(id);
        if (cell.size === 0) this.cells.delete(key);
      }
    }
  }
}
