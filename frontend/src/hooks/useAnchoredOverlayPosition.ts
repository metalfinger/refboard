import { useState, useEffect, useRef } from 'react';
import type { Viewport } from 'pixi-viewport';
import type { SceneManager } from '../canvas/SceneManager';
import { getPointAnchorWorld } from '../canvas/reviewAnchors';

export interface AnchoredOverlayAnchor {
  objectId: string;
  pinX: number;
  pinY: number;
}

export interface AnchoredOverlayPosition {
  visible: boolean;
  screenX: number;
  screenY: number;
  /** 'right' if the composer fits to the right of the pin, 'left' if it would overflow */
  placement: 'right' | 'left';
}

const COMPOSER_WIDTH = 260;
const OFFSET_X = 16; // gap between pin and composer edge

/**
 * Converts a world-space anchor (objectId + relative pin coords) to screen
 * coordinates. Recomputes on viewport move/zoom and when sceneVersion changes
 * (object moved/resized). Returns { visible: false } when anchor is null or
 * target object is missing.
 *
 * Reusable for any anchored overlay: inline composer, quick reply, popovers.
 *
 * @param sceneVersion - A counter that increments whenever scene objects move
 *   or resize. Editor.tsx already tracks this as the value returned by
 *   useSyncExternalStore or an equivalent counter bumped by onChange. Pass it
 *   here so the hook recomputes when the target object's world bounds change.
 */
export function useAnchoredOverlayPosition(
  viewport: Viewport | null,
  scene: SceneManager | null,
  anchor: AnchoredOverlayAnchor | null,
  sceneVersion: number = 0,
): AnchoredOverlayPosition {
  const [pos, setPos] = useState<AnchoredOverlayPosition>({
    visible: false, screenX: 0, screenY: 0, placement: 'right',
  });
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!viewport || !scene || !anchor) {
      setPos({ visible: false, screenX: 0, screenY: 0, placement: 'right' });
      return;
    }

    const compute = () => {
      const world = getPointAnchorWorld(scene, anchor.objectId, anchor.pinX, anchor.pinY);
      if (!world) {
        setPos((p) => p.visible ? { visible: false, screenX: 0, screenY: 0, placement: 'right' } : p);
        return;
      }
      const screen = viewport.toScreen(world.x, world.y);
      // Determine if composer fits to the right; if not, place left
      const rightEdge = screen.x + OFFSET_X + COMPOSER_WIDTH;
      const placement: 'right' | 'left' = rightEdge > viewport.screenWidth ? 'left' : 'right';

      setPos({ visible: true, screenX: screen.x, screenY: screen.y, placement });
    };

    // Initial compute
    compute();

    // Recompute on viewport move/zoom (RAF-throttled)
    const onMoved = () => {
      if (rafRef.current) return;
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null;
        compute();
      });
    };
    viewport.on('moved', onMoved);
    viewport.on('wheel-scroll', onMoved);

    return () => {
      viewport.off('moved', onMoved);
      viewport.off('wheel-scroll', onMoved);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [viewport, scene, anchor?.objectId, anchor?.pinX, anchor?.pinY, sceneVersion]);

  return pos;
}
