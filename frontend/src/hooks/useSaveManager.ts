import { useCallback, useRef } from 'react';
import { saveCanvas } from '../api';
import type { PixiCanvasHandle } from '../canvas/PixiCanvas';
import type { SaveStatus } from '../components/StatusBar';

interface SaveManagerOptions {
  resolvedBoardId: string | undefined;
  isPublicView?: boolean;
  canvasRef: React.RefObject<PixiCanvasHandle | null>;
  setSaveStatus: (s: SaveStatus) => void;
}

/**
 * Debounced save with thumbnail generation from PixiJS renderer.
 */
export function useSaveManager({ resolvedBoardId, isPublicView, canvasRef, setSaveStatus }: SaveManagerOptions) {
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleSave = useCallback(() => {
    if (!resolvedBoardId || isPublicView) return;
    setSaveStatus('unsaved');
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const scene = canvasRef.current?.getScene();
      if (!scene) return;
      setSaveStatus('saving');
      try {
        const state = JSON.stringify(scene.serialize());

        // Generate thumbnail — skip for large scenes to avoid GPU OOM
        let thumbnail: string | undefined;
        try {
          const app = canvasRef.current?.getApp();
          const viewport = canvasRef.current?.getViewport();
          const itemCount = scene.getAllItems().length;
          // Skip thumbnail extraction when >50 items — extract.canvas on
          // the full viewport with many textures causes WebGL OOM.
          if (app?.renderer?.extract && viewport && itemCount <= 50) {
            const fullCanvas = app.renderer.extract.canvas(viewport) as HTMLCanvasElement;
            const thumbMax = 400;
            const sw = fullCanvas.width;
            const sh = fullCanvas.height;
            if (sw > 0 && sh > 0) {
              const ratio = Math.min(thumbMax / sw, thumbMax / sh, 1);
              const tw = Math.round(sw * ratio);
              const th = Math.round(sh * ratio);
              const offscreen = document.createElement('canvas');
              offscreen.width = tw;
              offscreen.height = th;
              const ctx = offscreen.getContext('2d');
              if (ctx) {
                ctx.drawImage(fullCanvas, 0, 0, tw, th);
                thumbnail = offscreen.toDataURL('image/webp', 0.6);
              }
            }
          }
        } catch (thumbErr) {
          console.warn('Thumbnail generation failed:', thumbErr);
        }
        await saveCanvas(resolvedBoardId, state, thumbnail);
        setSaveStatus('saved');
      } catch {
        setSaveStatus('unsaved');
      }
    }, 2000);
  }, [resolvedBoardId, isPublicView, canvasRef, setSaveStatus]);

  return { scheduleSave, saveTimerRef };
}
