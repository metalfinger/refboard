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
  getBoundsFromPoints,
  transformPoint,
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

  it('crop entry after flipX+flipY preserves visible bounds', () => {
    const data = makeImage({ x: 100, y: 50, flipX: true, flipY: true, crop: { x: 0.1, y: 0.2, w: 0.6, h: 0.5 } });
    const visibleBounds = getImageWorldBounds(data);

    const eg = getImageEditorGeometry(data);
    // The crop corners in editor should match the original visible bounds
    const cropBounds = getBoundsFromPoints(eg.cropWorldCorners);
    expectClose(cropBounds.x, visibleBounds.x, 0.5);
    expectClose(cropBounds.y, visibleBounds.y, 0.5);
    expectClose(cropBounds.w, visibleBounds.w, 0.5);
    expectClose(cropBounds.h, visibleBounds.h, 0.5);
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

// ─── Integration: Crop Confirm Anchor ────────────────────────
// Simulates the crop confirm path: CropOverlay passes anchorWorld (crop
// corner in editor space), then useCanvasSetup repositions data.x/y so
// the crop corner stays at that world point after applying the new crop.

describe('crop confirm anchor preservation (integration)', () => {
  function simulateCropConfirm(
    original: ImageObject,
    newCrop: { x: number; y: number; w: number; h: number },
  ) {
    // 1. Editor geometry: get anchor from editor data (as CropOverlay does)
    const eg = getImageEditorGeometry(original);
    const displayCrop = getImageDisplayCropRect({ crop: newCrop, flipX: original.flipX, flipY: original.flipY });
    const anchorWorld = imageViewPointToWorld(eg.editorData, displayCrop.x, displayCrop.y);

    // 2. Apply new crop to a copy (as useCanvasSetup does)
    const result: ImageObject = { ...original, crop: newCrop };

    // 3. Reposition using crop corner (fixed path), not AABB min
    const currentAnchor = imageViewPointToWorld(result, displayCrop.x, displayCrop.y);
    result.x += anchorWorld.x - currentAnchor.x;
    result.y += anchorWorld.y - currentAnchor.y;

    return { result, anchorWorld };
  }

  it('rotate → crop confirm preserves crop corner', () => {
    const data = makeImage({ x: 100, y: 50, angle: 45, crop: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 } });
    const newCrop = { x: 0.2, y: 0.2, w: 0.6, h: 0.6 };
    const { result, anchorWorld } = simulateCropConfirm(data, newCrop);

    // After confirm, the crop corner should be at the same world point
    const displayCrop = getImageDisplayCropRect({ crop: newCrop, flipX: data.flipX, flipY: data.flipY });
    const finalAnchor = imageViewPointToWorld(result, displayCrop.x, displayCrop.y);
    expectClose(finalAnchor.x, anchorWorld.x, 0.01);
    expectClose(finalAnchor.y, anchorWorld.y, 0.01);
  });

  it('rotate + flipX → crop confirm preserves crop corner', () => {
    const data = makeImage({ x: 100, y: 50, angle: 30, flipX: true, crop: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 } });
    const newCrop = { x: 0.15, y: 0.1, w: 0.7, h: 0.8 };
    const { result, anchorWorld } = simulateCropConfirm(data, newCrop);

    const displayCrop = getImageDisplayCropRect({ crop: newCrop, flipX: data.flipX, flipY: data.flipY });
    const finalAnchor = imageViewPointToWorld(result, displayCrop.x, displayCrop.y);
    expectClose(finalAnchor.x, anchorWorld.x, 0.01);
    expectClose(finalAnchor.y, anchorWorld.y, 0.01);
  });

  it('plain image crop confirm (no rotation)', () => {
    const data = makeImage({ x: 200, y: 100 });
    const newCrop = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };
    const { result, anchorWorld } = simulateCropConfirm(data, newCrop);

    const displayCrop = getImageDisplayCropRect({ crop: newCrop, flipX: data.flipX, flipY: data.flipY });
    const finalAnchor = imageViewPointToWorld(result, displayCrop.x, displayCrop.y);
    expectClose(finalAnchor.x, anchorWorld.x, 0.01);
    expectClose(finalAnchor.y, anchorWorld.y, 0.01);
  });
});

// ─── Integration: Ungroup Image Position ─────────────────────
// Simulates the ungroup path for images: transform display position
// through group transform, propagate scale/angle, back-calculate data.x/y.

describe('ungroup image position preservation (integration)', () => {
  function simulateGroupAndUngroup(
    imageData: ImageObject,
    groupTransform: { x: number; y: number; sx: number; sy: number; angle: number },
  ) {
    const { x: gx, y: gy, sx: gsx, sy: gsy, angle: ga } = groupTransform;

    // GROUP: convert world → local (as groupItems does)
    const grouped = { ...imageData };
    grouped.x = imageData.x - gx;
    grouped.y = imageData.y - gy;

    // UNGROUP: convert local → world (as ungroupItems does for images)
    const ungrouped = { ...grouped };
    const localDisplay = getImageDisplayTransform(ungrouped);
    const worldDisplay = transformPoint(
      { x: localDisplay.x, y: localDisplay.y },
      { x: gx, y: gy, sx: gsx, sy: gsy, angle: ga },
    );
    ungrouped.sx *= gsx;
    ungrouped.sy *= gsy;
    ungrouped.angle = (ungrouped.angle || 0) + ga;
    const newSx = Math.abs(ungrouped.sx);
    const newSy = Math.abs(ungrouped.sy);
    const visibleRect = getImageVisibleLocalRect(ungrouped);
    ungrouped.x = worldDisplay.x - (ungrouped.flipX ? visibleRect.w * newSx : 0);
    ungrouped.y = worldDisplay.y - (ungrouped.flipY ? visibleRect.h * newSy : 0);

    return ungrouped;
  }

  it('flipped image in non-rotated group round-trips', () => {
    const img = makeImage({ x: 150, y: 80, flipX: true });
    const result = simulateGroupAndUngroup(img, { x: 100, y: 50, sx: 1, sy: 1, angle: 0 });
    expectClose(result.x, img.x, 0.01);
    expectClose(result.y, img.y, 0.01);
  });

  it('flipped image in rotated uniform-scale group: ungroup preserves display position', () => {
    // Start with image already in group-local coordinates
    const localImg = makeImage({ x: 50, y: 30, flipX: true, flipY: true });
    const group = { x: 100, y: 50, sx: 1, sy: 1, angle: 90 };

    // Compute what PixiJS world display position would be inside the group
    const localDisplay = getImageDisplayTransform(localImg);
    const worldDisplay = transformPoint(
      { x: localDisplay.x, y: localDisplay.y },
      group,
    );

    // Ungroup
    const ungrouped = { ...localImg };
    ungrouped.sx *= group.sx;
    ungrouped.sy *= group.sy;
    ungrouped.angle = (ungrouped.angle || 0) + group.angle;
    const newSx = Math.abs(ungrouped.sx);
    const newSy = Math.abs(ungrouped.sy);
    const visibleRect = getImageVisibleLocalRect(ungrouped);
    ungrouped.x = worldDisplay.x - (ungrouped.flipX ? visibleRect.w * newSx : 0);
    ungrouped.y = worldDisplay.y - (ungrouped.flipY ? visibleRect.h * newSy : 0);

    // The ungrouped display position should match the world display position
    const ungroupedDisplay = getImageDisplayTransform(ungrouped);
    expectClose(ungroupedDisplay.x, worldDisplay.x, 0.01);
    expectClose(ungroupedDisplay.y, worldDisplay.y, 0.01);
  });

  it('cropped + flipped image in non-rotated group round-trips', () => {
    const img = makeImage({ x: 150, y: 80, flipX: true, crop: { x: 0.2, y: 0, w: 0.6, h: 1 } });
    const result = simulateGroupAndUngroup(img, { x: 100, y: 50, sx: 1, sy: 1, angle: 0 });
    expectClose(result.x, img.x, 0.01);
    expectClose(result.y, img.y, 0.01);
  });

  it('non-flipped image in scaled group round-trips', () => {
    const img = makeImage({ x: 150, y: 80 });
    const result = simulateGroupAndUngroup(img, { x: 100, y: 50, sx: 2, sy: 2, angle: 0 });
    // After ungrouping from 2x group, sx/sy should be 2 and position should preserve display
    expect(result.sx).toBe(2);
    expect(result.sy).toBe(2);
    const origBounds = getImageWorldBounds(img);
    const resultBounds = getImageWorldBounds(result);
    // With 2x scale, bounds should be 2x size, anchored at correct position
    expectClose(resultBounds.w, origBounds.w * 2);
  });
});

// ─── Integration: Crop → Flip → Re-enter Crop ───────────────
// Simulates: user crops an image, flips it, then enters crop mode again.
// The editor geometry (full uncropped image) must be positioned so the
// crop rectangle aligns with the current visible bounds.

describe('crop → flip → re-enter crop mode (integration)', () => {
  it('editor geometry aligns crop region with visible bounds after flipX', () => {
    // Step 1: Cropped image
    const data = makeImage({ x: 100, y: 100, w: 400, h: 300, crop: { x: 0.2, y: 0, w: 0.6, h: 1 } });
    const visibleBefore = getImageWorldBounds(data);

    // Step 2: Flip (what operations.flipHorizontal does)
    data.flipX = true;
    const visibleAfterFlip = getImageWorldBounds(data);

    // Visible bounds should not change after flip
    expectClose(visibleAfterFlip.x, visibleBefore.x, 0.01);
    expectClose(visibleAfterFlip.y, visibleBefore.y, 0.01);
    expectClose(visibleAfterFlip.w, visibleBefore.w, 0.01);
    expectClose(visibleAfterFlip.h, visibleBefore.h, 0.01);

    // Step 3: Enter crop mode — get editor geometry
    const eg = getImageEditorGeometry(data);

    // The crop rectangle in editor space should match the current visible bounds
    const cropCorners = eg.cropWorldCorners;
    const cropBounds = {
      x: Math.min(...cropCorners.map(c => c.x)),
      y: Math.min(...cropCorners.map(c => c.y)),
      w: Math.max(...cropCorners.map(c => c.x)) - Math.min(...cropCorners.map(c => c.x)),
      h: Math.max(...cropCorners.map(c => c.y)) - Math.min(...cropCorners.map(c => c.y)),
    };
    expectClose(cropBounds.x, visibleAfterFlip.x, 0.01);
    expectClose(cropBounds.y, visibleAfterFlip.y, 0.01);
    expectClose(cropBounds.w, visibleAfterFlip.w, 0.01);
    expectClose(cropBounds.h, visibleAfterFlip.h, 0.01);
  });

  it('editor geometry aligns crop region after flipX + flipY', () => {
    const data = makeImage({ x: 100, y: 100, w: 400, h: 300, crop: { x: 0.1, y: 0.2, w: 0.6, h: 0.5 } });
    const visibleBefore = getImageWorldBounds(data);

    // Flip both axes
    data.flipX = true;
    data.flipY = true;
    const visibleAfterFlip = getImageWorldBounds(data);

    // Bounds unchanged
    expectClose(visibleAfterFlip.x, visibleBefore.x, 0.01);
    expectClose(visibleAfterFlip.w, visibleBefore.w, 0.01);

    // Enter crop mode
    const eg = getImageEditorGeometry(data);
    const cropCorners = eg.cropWorldCorners;
    const cropBounds = {
      x: Math.min(...cropCorners.map(c => c.x)),
      y: Math.min(...cropCorners.map(c => c.y)),
      w: Math.max(...cropCorners.map(c => c.x)) - Math.min(...cropCorners.map(c => c.x)),
      h: Math.max(...cropCorners.map(c => c.y)) - Math.min(...cropCorners.map(c => c.y)),
    };
    expectClose(cropBounds.x, visibleAfterFlip.x, 0.01);
    expectClose(cropBounds.y, visibleAfterFlip.y, 0.01);
    expectClose(cropBounds.w, visibleAfterFlip.w, 0.01);
    expectClose(cropBounds.h, visibleAfterFlip.h, 0.01);
  });

  it('editor geometry aligns crop region after flipX + rotation', () => {
    // For rotated images, flip changes the AABB position (not size), so we
    // only check that the editor crop matches the post-flip visible bounds.
    const data = makeImage({ x: 100, y: 100, w: 400, h: 300, angle: 30, flipX: true, crop: { x: 0.1, y: 0, w: 0.7, h: 1 } });
    const visibleBounds = getImageWorldBounds(data);

    const eg = getImageEditorGeometry(data);
    const cropBounds = getBoundsFromPoints(eg.cropWorldCorners);
    expectClose(cropBounds.x, visibleBounds.x, 0.5);
    expectClose(cropBounds.y, visibleBounds.y, 0.5);
    expectClose(cropBounds.w, visibleBounds.w, 0.5);
    expectClose(cropBounds.h, visibleBounds.h, 0.5);
  });

  it('crop confirm after flip preserves anchor through re-entry', () => {
    // Full round-trip: crop → flip → enter crop → confirm same crop → position stable
    const original = makeImage({ x: 100, y: 100, w: 400, h: 300, crop: { x: 0.2, y: 0, w: 0.6, h: 1 } });
    const visibleBefore = getImageWorldBounds(original);

    // Flip
    original.flipX = true;

    // Enter crop mode
    const eg = getImageEditorGeometry(original);

    // Confirm with same crop (user didn't change anything)
    const sameCrop = { ...eg.sourceCrop };
    const displayCrop = getImageDisplayCropRect({ crop: sameCrop, flipX: original.flipX, flipY: original.flipY });
    const anchorWorld = imageViewPointToWorld(eg.editorData, displayCrop.x, displayCrop.y);

    // Apply crop (as useCanvasSetup does)
    const result = { ...original, crop: sameCrop };
    const currentAnchor = imageViewPointToWorld(result, displayCrop.x, displayCrop.y);
    result.x += anchorWorld.x - currentAnchor.x;
    result.y += anchorWorld.y - currentAnchor.y;

    // Position should be unchanged
    const visibleAfter = getImageWorldBounds(result);
    expectClose(visibleAfter.x, visibleBefore.x, 0.01);
    expectClose(visibleAfter.y, visibleBefore.y, 0.01);
    expectClose(visibleAfter.w, visibleBefore.w, 0.01);
    expectClose(visibleAfter.h, visibleBefore.h, 0.01);
  });
});
