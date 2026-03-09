// scene-format.ts — v2 scene format types and Fabric v1→v2 converter

// ── Types ──────────────────────────────────────────────────────────────

export interface SceneObject {
  id: string;
  type: 'image' | 'video' | 'text' | 'group' | 'drawing';
  x: number;
  y: number;
  w: number;
  h: number;
  sx: number;
  sy: number;
  angle: number;
  z: number;
  opacity: number;
  locked: boolean;
  name: string;
  visible: boolean;
  flipX?: boolean;
  flipY?: boolean;
}

export interface ImageObject extends SceneObject {
  type: 'image';
  asset: string;
  filters: string[];
}

export interface VideoObject extends SceneObject {
  type: 'video';
  asset: string;
  muted: boolean;
  loop: boolean;
}

export interface TextObject extends SceneObject {
  type: 'text';
  text: string;
  fontSize: number;
  fill: string;
  fontFamily: string;
}

export interface DrawingObject extends SceneObject {
  type: 'drawing';
  points: number[];   // flat array: [x0, y0, x1, y1, ...]
  color: string;
  strokeWidth: number;
}

export interface GroupObject extends SceneObject {
  type: 'group';
  children: string[];
  bgColor?: string;   // frame background color (e.g. '#2a2a3a'), empty/undefined = transparent
  label?: string;      // frame title label
  padding?: number;    // inner padding around children (default 12)
}

export type AnySceneObject = ImageObject | VideoObject | TextObject | DrawingObject | GroupObject;

export interface SceneData {
  v: 2;
  bg: string;
  objects: AnySceneObject[];
}

// ── Helpers ────────────────────────────────────────────────────────────

const API_IMAGES_PREFIX = '/api/images/';

/** Extract asset key from a Fabric image src URL.
 *  `/api/images/boards/abc/def.png` → `boards/abc/def.png`
 *  Falls back to full src if pattern doesn't match. */
function extractAssetKey(src: string | undefined): string {
  if (!src) return '';
  const idx = src.indexOf(API_IMAGES_PREFIX);
  if (idx !== -1) return src.slice(idx + API_IMAGES_PREFIX.length);
  // Absolute URL with host — try stripping origin
  try {
    const url = new URL(src);
    const pathIdx = url.pathname.indexOf(API_IMAGES_PREFIX);
    if (pathIdx !== -1) return url.pathname.slice(pathIdx + API_IMAGES_PREFIX.length);
  } catch {
    // not a valid URL — fine
  }
  return src;
}

/** Pull filter type names from Fabric's filter array. */
function extractFilters(fabricFilters: any[] | undefined): string[] {
  if (!Array.isArray(fabricFilters)) return [];
  return fabricFilters
    .map((f) => f?.type ?? f?.Type ?? '')
    .filter(Boolean);
}

/** Build base SceneObject fields from a Fabric object. */
function baseFields(fObj: any, index: number): SceneObject {
  return {
    id: fObj.id ?? crypto.randomUUID(),
    type: 'image', // caller overrides
    x: fObj.left ?? 0,
    y: fObj.top ?? 0,
    w: fObj.width ?? 0,
    h: fObj.height ?? 0,
    sx: fObj.scaleX ?? 1,
    sy: fObj.scaleY ?? 1,
    angle: fObj.angle ?? 0,
    z: index,
    opacity: fObj.opacity ?? 1,
    locked: fObj.selectable === false,
    name: fObj.name ?? '',
    visible: fObj.visible !== false,
    ...(fObj.flipX ? { flipX: true } : {}),
    ...(fObj.flipY ? { flipY: true } : {}),
  };
}

// ── Converter ──────────────────────────────────────────────────────────

/** Convert Fabric.js canvas JSON (v1 format) to SceneData v2. */
export function convertFabricToV2(fabricJson: any): SceneData {
  const objects: AnySceneObject[] = [];
  const srcObjects: any[] = fabricJson?.objects ?? [];
  let zCounter = 0;

  for (const fObj of srcObjects) {
    const fabricType: string = fObj.type ?? '';

    // Skip unsupported types (e.g. path from drawing tools)
    if (fabricType === 'path') continue;

    if (fabricType === 'group') {
      convertGroup(fObj, objects, zCounter);
      // Group + its children all get z slots
      const childCount = Array.isArray(fObj.objects) ? fObj.objects.length : 0;
      zCounter += 1 + childCount;
      continue;
    }

    const converted = convertSingle(fObj, zCounter);
    if (converted) {
      objects.push(converted);
      zCounter++;
    }
  }

  return {
    v: 2,
    bg: fabricJson?.background ?? fabricJson?.backgroundColor ?? '',
    objects,
  };
}

/** Convert a single non-group Fabric object. Returns null for unsupported types. */
function convertSingle(fObj: any, z: number): AnySceneObject | null {
  const fabricType: string = fObj.type ?? '';

  if (fabricType === 'image') {
    return {
      ...baseFields(fObj, z),
      type: 'image',
      asset: extractAssetKey(fObj.src),
      filters: extractFilters(fObj.filters),
    } as ImageObject;
  }

  if (fabricType === 'i-text' || fabricType === 'text' || fabricType === 'textbox') {
    return {
      ...baseFields(fObj, z),
      type: 'text',
      text: fObj.text ?? '',
      fontSize: fObj.fontSize ?? 24,
      fill: fObj.fill ?? '#000000',
      fontFamily: fObj.fontFamily ?? 'sans-serif',
    } as TextObject;
  }

  if (fabricType === 'video') {
    return {
      ...baseFields(fObj, z),
      type: 'video',
      asset: extractAssetKey(fObj.src),
      muted: fObj.muted ?? true,
      loop: fObj.loop ?? true,
    } as VideoObject;
  }

  // Unknown type — treat as image with empty asset (best-effort)
  if (fabricType) {
    return {
      ...baseFields(fObj, z),
      type: 'image',
      asset: extractAssetKey(fObj.src),
      filters: [],
    } as ImageObject;
  }

  return null;
}

/** Convert a Fabric group: flatten children to top-level with absolute coords. */
function convertGroup(
  fObj: any,
  out: AnySceneObject[],
  zStart: number,
): void {
  const groupId = fObj.id ?? crypto.randomUUID();
  const groupLeft = fObj.left ?? 0;
  const groupTop = fObj.top ?? 0;
  const groupScaleX = fObj.scaleX ?? 1;
  const groupScaleY = fObj.scaleY ?? 1;
  const groupAngle = fObj.angle ?? 0;

  const children: any[] = fObj.objects ?? [];
  const childIds: string[] = [];

  // Convert radians for rotation transform
  const rad = (groupAngle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  for (let i = 0; i < children.length; i++) {
    const child = children[i];
    if (child.type === 'path') continue;

    const childId = child.id ?? crypto.randomUUID();
    // Fabric groups store children relative to group center.
    // Transform child position to canvas-absolute coordinates.
    const relX = (child.left ?? 0) * groupScaleX;
    const relY = (child.top ?? 0) * groupScaleY;
    const absX = groupLeft + relX * cos - relY * sin;
    const absY = groupTop + relX * sin + relY * cos;

    const adjusted = {
      ...child,
      id: childId,
      left: absX,
      top: absY,
      scaleX: (child.scaleX ?? 1) * groupScaleX,
      scaleY: (child.scaleY ?? 1) * groupScaleY,
      angle: (child.angle ?? 0) + groupAngle,
    };

    const converted = convertSingle(adjusted, zStart + 1 + i);
    if (converted) {
      childIds.push(converted.id);
      out.push(converted);
    }
  }

  // Push the group object itself (references children by ID)
  const group: GroupObject = {
    ...baseFields(fObj, zStart),
    type: 'group',
    id: groupId,
    children: childIds,
  };
  out.push(group);
}
