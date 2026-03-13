import { describe, it, expect } from 'vitest';
import type { ImageObject } from './scene-format';
import {
  getImageSourceRect,
  getImageVisibleLocalRect,
  getImageDisplayTransform,
  getImageDisplayGeometry,
  getImageEditorGeometry,
  getImageDisplayCropRect,
  displayCropRectToSourceCrop,
  imageViewPointToWorld,
  worldToImageViewPoint,
  normalizeImageTransformData,
  getImageTransformedCorners,
  getImageWorldBounds,
} from './imageTransforms';

/** Helper to build a minimal ImageObject for testing. */
function makeImage(overrides: Partial<ImageObject> = {}): ImageObject {
  return {
    id: 'test',
    type: 'image',
    x: 0,
    y: 0,
    w: 200,
    h: 100,
    sx: 1,
    sy: 1,
    angle: 0,
    z: 1,
    opacity: 1,
    locked: false,
    name: '',
    visible: true,
    asset: 'test.png',
    filters: [],
    flipX: false,
    flipY: false,
    ...overrides,
  };
}

function expectClose(actual: number, expected: number, tolerance = 0.5) {
  expect(Math.abs(actual - expected)).toBeLessThan(tolerance);
}

// ─── Source Rect ──────────────────────────────────────────────

describe('getImageSourceRect', () => {
  it('returns full image when no crop', () => {
    const r = getImageSourceRect(makeImage());
    expect(r).toEqual({ x: 0, y: 0, w: 200, h: 100 });
  });

  it('returns cropped region in pixel coords', () => {
    const r = getImageSourceRect(makeImage({ crop: { x: 0.25, y: 0.1, w: 0.5, h: 0.8 } }));
    expect(r).toEqual({ x: 50, y: 10, w: 100, h: 80 });
  });
});

// ─── Visible Local Rect ──────────────────────────────────────

describe('getImageVisibleLocalRect', () => {
  it('full image → same as w/h', () => {
    const r = getImageVisibleLocalRect(makeImage());
    expect(r).toEqual({ x: 0, y: 0, w: 200, h: 100 });
  });

  it('cropped → visible dimensions match crop region', () => {
    const r = getImageVisibleLocalRect(makeImage({ crop: { x: 0.25, y: 0, w: 0.5, h: 1 } }));
    expect(r).toEqual({ x: 0, y: 0, w: 100, h: 100 });
  });
});

// ─── Display Transform ───────────────────────────────────────

describe('getImageDisplayTransform', () => {
  it('no flip → position equals data.x/y', () => {
    const t = getImageDisplayTransform(makeImage({ x: 50, y: 30 }));
    expect(t.x).toBe(50);
    expect(t.y).toBe(30);
    expect(t.scaleX).toBe(1);
    expect(t.scaleY).toBe(1);
  });

  it('flipX → position shifts right by visible width', () => {
    const t = getImageDisplayTransform(makeImage({ x: 50, y: 30, flipX: true }));
    expect(t.x).toBe(250); // 50 + 200*1
    expect(t.y).toBe(30);
    expect(t.scaleX).toBe(-1);
  });

  it('flipY → position shifts down by visible height', () => {
    const t = getImageDisplayTransform(makeImage({ x: 50, y: 30, flipY: true }));
    expect(t.x).toBe(50);
    expect(t.y).toBe(130); // 30 + 100*1
    expect(t.scaleY).toBe(-1);
  });

  it('flipX + crop → shift uses cropped visible width', () => {
    const data = makeImage({ x: 0, y: 0, flipX: true, crop: { x: 0, y: 0, w: 0.5, h: 1 } });
    const t = getImageDisplayTransform(data);
    expect(t.x).toBe(100); // 0 + 100*1 (half width cropped)
  });

  it('sx=2 + flipX → shift uses scaled visible width', () => {
    const t = getImageDisplayTransform(makeImage({ x: 0, y: 0, sx: 2, flipX: true }));
    expect(t.x).toBe(400); // 200 * 2
    expect(t.scaleX).toBe(-2);
  });
});

// ─── Display Geometry ────────────────────────────────────────

describe('getImageDisplayGeometry', () => {
  it('world bounds match visible frame for unflipped image', () => {
    const g = getImageDisplayGeometry(makeImage({ x: 100, y: 50 }));
    expect(g.worldBounds.x).toBe(100);
    expect(g.worldBounds.y).toBe(50);
    expect(g.worldBounds.w).toBe(200);
    expect(g.worldBounds.h).toBe(100);
  });

  it('flipped image has same world bounds as unflipped', () => {
    const normal = getImageDisplayGeometry(makeImage({ x: 100, y: 50 }));
    const flipped = getImageDisplayGeometry(makeImage({ x: 100, y: 50, flipX: true, flipY: true }));
    expectClose(flipped.worldBounds.x, normal.worldBounds.x);
    expectClose(flipped.worldBounds.y, normal.worldBounds.y);
    expectClose(flipped.worldBounds.w, normal.worldBounds.w);
    expectClose(flipped.worldBounds.h, normal.worldBounds.h);
  });

  it('cropped image has smaller world bounds', () => {
    const g = getImageDisplayGeometry(makeImage({ x: 0, y: 0, crop: { x: 0, y: 0, w: 0.5, h: 0.5 } }));
    expect(g.worldBounds.w).toBe(100); // half
    expect(g.worldBounds.h).toBe(50);  // half
  });
});

// ─── Editor Geometry (crop session) ──────────────────────────

describe('getImageEditorGeometry', () => {
  it('uncropped image → editor shows full image at same position', () => {
    const data = makeImage({ x: 100, y: 50 });
    const eg = getImageEditorGeometry(data);
    expect(eg.sourceCrop).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expectClose(eg.editorData.x, 100);
    expectClose(eg.editorData.y, 50);
  });

  it('crop entry preserves visible region anchor', () => {
    const data = makeImage({ x: 100, y: 50, crop: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } });
    const displayBefore = getImageDisplayGeometry(data);

    const eg = getImageEditorGeometry(data);
    // The crop anchor world point should match the display geometry's top-left
    expectClose(eg.cropAnchorWorld.x, displayBefore.worldBounds.x, 1);
    expectClose(eg.cropAnchorWorld.y, displayBefore.worldBounds.y, 1);
  });

  it('crop entry after flipX preserves anchor', () => {
    const data = makeImage({ x: 100, y: 50, flipX: true, crop: { x: 0.25, y: 0, w: 0.5, h: 1 } });
    const displayBefore = getImageDisplayGeometry(data);

    const eg = getImageEditorGeometry(data);
    expectClose(eg.cropAnchorWorld.x, displayBefore.worldBounds.x, 1);
    expectClose(eg.cropAnchorWorld.y, displayBefore.worldBounds.y, 1);
  });

  it('crop entry after flipY preserves anchor', () => {
    const data = makeImage({ x: 100, y: 50, flipY: true, crop: { x: 0, y: 0.25, w: 1, h: 0.5 } });
    const displayBefore = getImageDisplayGeometry(data);

    const eg = getImageEditorGeometry(data);
    expectClose(eg.cropAnchorWorld.x, displayBefore.worldBounds.x, 1);
    expectClose(eg.cropAnchorWorld.y, displayBefore.worldBounds.y, 1);
  });

  it('crop entry after flipX+flipY preserves anchor', () => {
    const data = makeImage({ x: 100, y: 50, flipX: true, flipY: true, crop: { x: 0.1, y: 0.2, w: 0.6, h: 0.5 } });
    // Anchor is the display crop's top-left in world space (not AABB min)
    const displayCrop = getImageDisplayCropRect(data);
    const expectedAnchor = imageViewPointToWorld(data, displayCrop.x, displayCrop.y);

    const eg = getImageEditorGeometry(data);
    expectClose(eg.cropAnchorWorld.x, expectedAnchor.x, 0.01);
    expectClose(eg.cropAnchorWorld.y, expectedAnchor.y, 0.01);

    // The editor's crop region should match the original crop region in world space
    const editorCropCorner = imageViewPointToWorld(eg.editorData, displayCrop.x, displayCrop.y);
    expectClose(editorCropCorner.x, expectedAnchor.x, 1);
    expectClose(editorCropCorner.y, expectedAnchor.y, 1);
  });

  it('crop entry after rotate preserves anchor', () => {
    const data = makeImage({ x: 100, y: 50, angle: 45, crop: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } });
    const displayCrop = getImageDisplayCropRect(data);
    const expectedAnchor = imageViewPointToWorld(data, displayCrop.x, displayCrop.y);

    const eg = getImageEditorGeometry(data);
    expectClose(eg.cropAnchorWorld.x, expectedAnchor.x, 0.01);
    expectClose(eg.cropAnchorWorld.y, expectedAnchor.y, 0.01);

    // The editor's crop region should match the original crop region in world space
    const editorCropCorner = imageViewPointToWorld(eg.editorData, displayCrop.x, displayCrop.y);
    expectClose(editorCropCorner.x, expectedAnchor.x, 1);
    expectClose(editorCropCorner.y, expectedAnchor.y, 1);
  });
});

// ─── Crop Rect Conversions ───────────────────────────────────

describe('crop rect conversions', () => {
  it('round-trip: display → source → display', () => {
    const data = makeImage({ flipX: true, flipY: true, crop: { x: 0.1, y: 0.2, w: 0.5, h: 0.3 } });
    const display = getImageDisplayCropRect(data);
    const source = displayCropRectToSourceCrop(data, display);
    expectClose(source.x, data.crop!.x);
    expectClose(source.y, data.crop!.y);
    expectClose(source.w, data.crop!.w);
    expectClose(source.h, data.crop!.h);
  });

  it('no flip → display crop equals source crop', () => {
    const data = makeImage({ crop: { x: 0.2, y: 0.3, w: 0.4, h: 0.5 } });
    const display = getImageDisplayCropRect(data);
    expect(display.x).toBe(0.2);
    expect(display.y).toBe(0.3);
  });

  it('flipX mirrors crop horizontally', () => {
    const data = makeImage({ flipX: true, crop: { x: 0.1, y: 0, w: 0.3, h: 1 } });
    const display = getImageDisplayCropRect(data);
    expectClose(display.x, 0.6); // 1 - (0.1 + 0.3)
    expect(display.w).toBe(0.3);
  });
});

// ─── Coordinate Round-Trips ──────────────────────────────────

describe('coordinate conversions', () => {
  it('source → world → source round-trip (no flip)', () => {
    const data = makeImage({ x: 100, y: 50 });
    const world = imageViewPointToWorld(data, 0.5, 0.5);
    const back = worldToImageViewPoint(data, world.x, world.y);
    expectClose(back.x, 0.5);
    expectClose(back.y, 0.5);
  });

  it('source → world → source round-trip (flipX)', () => {
    const data = makeImage({ x: 100, y: 50, flipX: true });
    const world = imageViewPointToWorld(data, 0.3, 0.7);
    const back = worldToImageViewPoint(data, world.x, world.y);
    expectClose(back.x, 0.3);
    expectClose(back.y, 0.7);
  });

  it('source → world → source round-trip (flipX + flipY + crop)', () => {
    const data = makeImage({ x: 100, y: 50, flipX: true, flipY: true, crop: { x: 0.1, y: 0.2, w: 0.6, h: 0.5 } });
    const world = imageViewPointToWorld(data, 0.4, 0.5);
    const back = worldToImageViewPoint(data, world.x, world.y);
    expectClose(back.x, 0.4);
    expectClose(back.y, 0.5);
  });

  it('source → world → source round-trip (rotated)', () => {
    const data = makeImage({ x: 100, y: 50, angle: 90 });
    const world = imageViewPointToWorld(data, 0.25, 0.75);
    const back = worldToImageViewPoint(data, world.x, world.y);
    expectClose(back.x, 0.25);
    expectClose(back.y, 0.75);
  });

  it('source → world → source round-trip (rotated + flipped + cropped)', () => {
    const data = makeImage({ x: 100, y: 50, angle: 45, flipX: true, crop: { x: 0.2, y: 0.1, w: 0.6, h: 0.8 } });
    const world = imageViewPointToWorld(data, 0.5, 0.5);
    const back = worldToImageViewPoint(data, world.x, world.y);
    expectClose(back.x, 0.5, 0.01);
    expectClose(back.y, 0.5, 0.01);
  });
});

// ─── Negative Scale Normalization ────────────────────────────

describe('normalizeImageTransformData', () => {
  it('normalizes negative sx to positive + flipX', () => {
    const data = makeImage({ sx: -2, flipX: false });
    normalizeImageTransformData(data);
    expect(data.sx).toBe(2);
    expect(data.flipX).toBe(true);
  });

  it('normalizes negative sy to positive + flipY', () => {
    const data = makeImage({ sy: -1.5, flipY: false });
    normalizeImageTransformData(data);
    expect(data.sy).toBe(1.5);
    expect(data.flipY).toBe(true);
  });

  it('double negative sx toggles existing flipX', () => {
    const data = makeImage({ sx: -1, flipX: true });
    normalizeImageTransformData(data);
    expect(data.sx).toBe(1);
    expect(data.flipX).toBe(false); // was true, negated
  });

  it('positive scale is unchanged', () => {
    const data = makeImage({ sx: 2, sy: 3, flipX: true, flipY: false });
    normalizeImageTransformData(data);
    expect(data.sx).toBe(2);
    expect(data.sy).toBe(3);
    expect(data.flipX).toBe(true);
    expect(data.flipY).toBe(false);
  });
});

// ─── World Bounds Invariants ─────────────────────────────────

describe('world bounds invariants', () => {
  it('flip does not change world bounds', () => {
    const base = makeImage({ x: 50, y: 50, sx: 1.5, sy: 1.5 });
    const bounds0 = getImageWorldBounds(base);

    const fx = makeImage({ ...base, flipX: true });
    const boundsX = getImageWorldBounds(fx);
    expectClose(boundsX.x, bounds0.x);
    expectClose(boundsX.w, bounds0.w);

    const fy = makeImage({ ...base, flipY: true });
    const boundsY = getImageWorldBounds(fy);
    expectClose(boundsY.y, bounds0.y);
    expectClose(boundsY.h, bounds0.h);
  });

  it('crop reduces world bounds proportionally', () => {
    const full = getImageWorldBounds(makeImage({ x: 0, y: 0 }));
    const half = getImageWorldBounds(makeImage({ x: 0, y: 0, crop: { x: 0, y: 0, w: 0.5, h: 0.5 } }));
    expectClose(half.w, full.w / 2);
    expectClose(half.h, full.h / 2);
  });
});
