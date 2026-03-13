import { describe, it, expect } from 'vitest';
import type { SceneItem } from './SceneManager';
import type { ImageObject, AnySceneObject } from './scene-format';
import { flattenToExportEntries, getCompositionDimensions } from './compositionRenderer';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeImageItem(overrides: Partial<ImageObject> = {}): SceneItem {
  const data: ImageObject = {
    id: overrides.id ?? 'img-1',
    type: 'image',
    x: overrides.x ?? 0,
    y: overrides.y ?? 0,
    w: overrides.w ?? 100,
    h: overrides.h ?? 80,
    sx: overrides.sx ?? 1,
    sy: overrides.sy ?? 1,
    angle: overrides.angle ?? 0,
    z: overrides.z ?? 0,
    opacity: overrides.opacity ?? 1,
    locked: false,
    name: '',
    visible: true,
    asset: overrides.asset ?? 'test.png',
    filters: [],
    flipX: overrides.flipX,
    flipY: overrides.flipY,
    crop: overrides.crop,
  };
  return {
    id: data.id,
    type: 'image',
    displayObject: {} as any,
    data,
  };
}

function makeTextItem(overrides: Partial<AnySceneObject> = {}): SceneItem {
  const data = {
    id: overrides.id ?? 'txt-1',
    type: 'text' as const,
    x: overrides.x ?? 0,
    y: overrides.y ?? 0,
    w: overrides.w ?? 200,
    h: overrides.h ?? 50,
    sx: overrides.sx ?? 1,
    sy: overrides.sy ?? 1,
    angle: overrides.angle ?? 0,
    z: overrides.z ?? 1,
    opacity: 1,
    locked: false,
    name: '',
    visible: true,
    text: 'hello',
    fontSize: 24,
    fill: '#000',
    fontFamily: 'sans-serif',
  };
  return {
    id: data.id,
    type: 'text',
    displayObject: {} as any,
    data: data as any,
  };
}

function makeGroupItem(childIds: string[]): SceneItem {
  const data = {
    id: 'grp-1',
    type: 'group' as const,
    x: 0,
    y: 0,
    w: 300,
    h: 200,
    sx: 1,
    sy: 1,
    angle: 0,
    z: 0,
    opacity: 1,
    locked: false,
    name: '',
    visible: true,
    children: childIds,
  };
  return {
    id: data.id,
    type: 'group',
    displayObject: {} as any,
    data: data as any,
  };
}

// ---------------------------------------------------------------------------
// flattenToExportEntries
// ---------------------------------------------------------------------------

describe('flattenToExportEntries', () => {
  it('converts image items to export entries with world bounds', () => {
    const items = [
      makeImageItem({ id: 'a', x: 10, y: 20, w: 100, h: 80, z: 0 }),
      makeImageItem({ id: 'b', x: 200, y: 50, w: 150, h: 100, z: 1 }),
    ];
    const entries = flattenToExportEntries(items);
    expect(entries).toHaveLength(2);
    expect(entries[0].id).toBe('a');
    expect(entries[1].id).toBe('b');
    // z-sorted
    expect(entries[0].z).toBeLessThan(entries[1].z);
  });

  it('sorts entries by z-order', () => {
    const items = [
      makeImageItem({ id: 'b', z: 5 }),
      makeImageItem({ id: 'a', z: 1 }),
      makeImageItem({ id: 'c', z: 3 }),
    ];
    const entries = flattenToExportEntries(items);
    expect(entries.map((e) => e.id)).toEqual(['a', 'c', 'b']);
  });

  it('skips group items — includes children already in selection', () => {
    const items = [
      makeGroupItem(['img-1']),
      makeImageItem({ id: 'img-1', z: 1 }),
    ];
    const entries = flattenToExportEntries(items);
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe('img-1');
    // Children already in selection are NOT marked as group children
    expect(entries[0].isGroupChild).toBe(false);
  });

  it('resolves group children via itemResolver and marks them as group children', () => {
    const child = makeImageItem({ id: 'child-1', z: 2 });
    const items = [makeGroupItem(['child-1'])];
    const resolver = (id: string) => id === 'child-1' ? child : undefined;
    const entries = flattenToExportEntries(items, resolver);
    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe('child-1');
    expect(entries[0].isGroupChild).toBe(true);
  });

  it('marks non-group items as isGroupChild=false', () => {
    const items = [makeImageItem({ id: 'standalone' })];
    const entries = flattenToExportEntries(items);
    expect(entries[0].isGroupChild).toBe(false);
  });

  it('computes correct world bounds for cropped image', () => {
    const items = [
      makeImageItem({
        x: 10,
        y: 20,
        w: 200,
        h: 100,
        sx: 0.5,
        sy: 0.5,
        crop: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 },
      }),
    ];
    const entries = flattenToExportEntries(items);
    expect(entries).toHaveLength(1);
    // Cropped visible rect: 100x50 source pixels, scaled by 0.5 = 50x25 world
    expect(entries[0].worldBounds.w).toBeCloseTo(50, 1);
    expect(entries[0].worldBounds.h).toBeCloseTo(25, 1);
  });

  it('computes correct world bounds for flipped image', () => {
    const items = [
      makeImageItem({
        x: 10,
        y: 20,
        w: 100,
        h: 80,
        sx: 1,
        sy: 1,
        flipX: true,
      }),
    ];
    const entries = flattenToExportEntries(items);
    // Flipped image occupies same world-space bounds
    expect(entries[0].worldBounds.x).toBeCloseTo(10, 1);
    expect(entries[0].worldBounds.y).toBeCloseTo(20, 1);
    expect(entries[0].worldBounds.w).toBeCloseTo(100, 1);
    expect(entries[0].worldBounds.h).toBeCloseTo(80, 1);
  });
});

// ---------------------------------------------------------------------------
// getCompositionDimensions
// ---------------------------------------------------------------------------

describe('getCompositionDimensions', () => {
  it('returns zero for empty selection', () => {
    const dims = getCompositionDimensions([], 1, 10);
    expect(dims.width).toBe(0);
    expect(dims.height).toBe(0);
  });

  it('returns native=true for image-only selection', () => {
    const items = [makeImageItem({ w: 400, h: 300, sx: 0.5, sy: 0.5 })];
    const dims = getCompositionDimensions(items, 1, 10);
    expect(dims.native).toBe(true);
    // At scale 1, ppw = 1/0.5 = 2
    // World size = 200x150, export pixels = 400x300 + 20 padding = 420x320
    expect(dims.width).toBeGreaterThan(400);
    expect(dims.height).toBeGreaterThan(300);
  });

  it('returns native=false for mixed selection', () => {
    const items = [
      makeImageItem({ z: 0 }),
      makeTextItem({ z: 1 }),
    ];
    const dims = getCompositionDimensions(items, 1, 10);
    expect(dims.native).toBe(false);
  });

  it('scale=1 and scale=2 produce different dimensions for native images', () => {
    const items = [makeImageItem({ w: 400, h: 300, sx: 1, sy: 1 })];
    const dims1 = getCompositionDimensions(items, 1, 10);
    const dims2 = getCompositionDimensions(items, 2, 10);
    expect(dims2.width).toBeGreaterThan(dims1.width);
    expect(dims2.height).toBeGreaterThan(dims1.height);
  });

  it('returns native=false for group children (local coords not drawable natively)', () => {
    const child = makeImageItem({ id: 'child-1', z: 1 });
    const items = [makeGroupItem(['child-1'])];
    const resolver = (id: string) => id === 'child-1' ? child : undefined;
    const dims = getCompositionDimensions(items, 1, 10, resolver);
    expect(dims.native).toBe(false);
  });

  it('dimensions are zoom-independent for native images', () => {
    // Two identical items — same result regardless of "zoom"
    // (composition renderer ignores viewport zoom entirely)
    const items = [makeImageItem({ w: 200, h: 150, sx: 0.5, sy: 0.5 })];
    const dims1 = getCompositionDimensions(items, 1, 10);
    const dims2 = getCompositionDimensions(items, 1, 10);
    expect(dims1.width).toBe(dims2.width);
    expect(dims1.height).toBe(dims2.height);
  });
});
