import { useCallback, useRef } from 'react';
import { saveCanvas } from '../api';
import type { PixiCanvasHandle } from '../canvas/PixiCanvas';
import type { SaveStatus } from '../components/StatusBar';

interface SaveManagerOptions {
  resolvedBoardId: string | undefined;
  isPublicView?: boolean;
  readOnly?: boolean;
  canvasRef: React.RefObject<PixiCanvasHandle | null>;
  setSaveStatus: (s: SaveStatus) => void;
}

/**
 * Debounced autosave — state only, no thumbnail.
 *
 * Thumbnail generation (extract.canvas on the full viewport) was removed
 * from the hot save path because it blocks the main thread and GPU for
 * hundreds of ms, causing focus/typing/wheel jank.  Thumbnails should be
 * generated on idle, on explicit export, or server-side.
 */
export function useSaveManager({ resolvedBoardId, isPublicView, readOnly, canvasRef, setSaveStatus }: SaveManagerOptions) {
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scheduleSave = useCallback(() => {
    if (!resolvedBoardId || isPublicView || readOnly) return;
    setSaveStatus('unsaved');
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      const scene = canvasRef.current?.getScene();
      if (!scene) return;
      setSaveStatus('saving');
      try {
        const state = JSON.stringify(scene.serialize());
        await saveCanvas(resolvedBoardId, state, undefined);
        setSaveStatus('saved');
      } catch (err: any) {
        if (err?.response?.status === 403) {
          setSaveStatus('readonly');
        } else {
          setSaveStatus('unsaved');
        }
      }
    }, 2000);
  }, [resolvedBoardId, isPublicView, readOnly, canvasRef, setSaveStatus]);

  return { scheduleSave, saveTimerRef };
}
