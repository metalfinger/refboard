import { useCallback, useRef } from 'react';
import type { PixiCanvasHandle } from '../canvas/PixiCanvas';
import type { SelectionManager } from '../canvas/SelectionManager';
import type { SceneItem } from '../canvas/SceneManager';
import type { GroupObject } from '../canvas/scene-format';

interface LayerItem {
  id: string;
  name: string;
  type: string;
  visible: boolean;
  locked: boolean;
  isGroup: boolean;
  children?: LayerItem[];
}

interface LayerPanelDeps {
  canvasRef: React.RefObject<PixiCanvasHandle | null>;
  selectionRef: React.RefObject<SelectionManager | null>;
  onCanvasChange: () => void;
}

function autoName(item: SceneItem, i: number, counters: Record<string, number>): string {
  if (item.data.name) return item.data.name;
  const type = item.data.type;
  if (type === 'image') {
    counters.image = (counters.image || 0) + 1;
    return `Image ${counters.image}`;
  }
  if (type === 'text') {
    const textData = item.data as any;
    return (textData.text || 'Text').slice(0, 20);
  }
  if (type === 'group') {
    const groupData = item.data as GroupObject;
    return `Group (${groupData.children?.length || 0})`;
  }
  return `${type} ${i + 1}`;
}

function buildLayerItem(
  item: SceneItem,
  i: number,
  counters: Record<string, number>,
  getScene: () => ReturnType<PixiCanvasHandle['getScene']>,
): LayerItem {
  const isGroup = item.data.type === 'group';
  let children: LayerItem[] | undefined;
  if (isGroup) {
    const groupData = item.data as GroupObject;
    const scene = getScene();
    if (scene && groupData.children) {
      children = groupData.children.map((childId, ci) => {
        const childItem = scene.getById(childId);
        if (childItem) return buildLayerItem(childItem, ci, counters, getScene);
        return { id: childId, name: `Missing ${childId.slice(0, 6)}`, type: 'unknown', visible: true, locked: false, isGroup: false };
      });
    }
  }
  return {
    id: item.id,
    name: autoName(item, i, counters),
    type: item.data.type,
    visible: item.data.visible,
    locked: item.data.locked,
    isGroup,
    children,
  };
}

/**
 * Layer panel handlers — provides refresh function and all layer panel callbacks.
 */
export function useLayerPanel(deps: LayerPanelDeps) {
  const { canvasRef, selectionRef, onCanvasChange } = deps;
  const nameCounters = useRef<Record<string, number>>({});

  const refreshLayers = useCallback((): LayerItem[] => {
    const scene = canvasRef.current?.getScene();
    if (!scene) return [];
    nameCounters.current = {};
    const items = scene.getAllItems().sort((a, b) => a.data.z - b.data.z);
    return items.map((item, i) =>
      buildLayerItem(item, i, nameCounters.current, () => canvasRef.current?.getScene() ?? null),
    );
  }, [canvasRef]);

  const onSelect = useCallback((id: string) => {
    selectionRef.current?.selectOnly(id);
  }, [selectionRef]);

  const onToggleVisible = useCallback((id: string) => {
    const scene = canvasRef.current?.getScene();
    if (!scene) return;
    const item = scene.getById(id);
    if (item) {
      item.data.visible = !item.data.visible;
      item.displayObject.visible = item.data.visible;
      onCanvasChange();
    }
  }, [canvasRef, onCanvasChange]);

  const onToggleLock = useCallback((id: string) => {
    const scene = canvasRef.current?.getScene();
    if (!scene) return;
    const item = scene.getById(id);
    if (item) {
      item.data.locked = !item.data.locked;
      item.displayObject.eventMode = item.data.locked ? 'none' : 'static';
    }
  }, [canvasRef]);

  const onReorder = useCallback((from: number, to: number) => {
    const scene = canvasRef.current?.getScene();
    if (!scene) return;
    const items = scene.getAllItems().sort((a, b) => a.data.z - b.data.z);
    if (from < 0 || from >= items.length || to < 0 || to >= items.length) return;
    const tmp = items[from].data.z;
    items[from].data.z = items[to].data.z;
    items[to].data.z = tmp;
    scene._applyZOrder();
    onCanvasChange();
  }, [canvasRef, onCanvasChange]);

  const onDelete = useCallback((id: string) => {
    const scene = canvasRef.current?.getScene();
    if (!scene) return;
    scene.removeItem(id, true);
    selectionRef.current?.clear();
    onCanvasChange();
  }, [canvasRef, selectionRef, onCanvasChange]);

  const onRename = useCallback((id: string, name: string) => {
    const scene = canvasRef.current?.getScene();
    if (!scene) return;
    const item = scene.getById(id);
    if (item) {
      item.data.name = name;
      // Also update frame label for groups
      if (item.data.type === 'group') {
        (item.data as any).label = name;
        if (item.displayObject && 'setLabel' in item.displayObject) {
          (item.displayObject as any).setLabel(name);
        }
      }
      onCanvasChange(); // Broadcast rename to other clients
    }
  }, [canvasRef, onCanvasChange]);

  return {
    refreshLayers,
    layerHandlers: {
      onSelect,
      onToggleVisible,
      onToggleLock,
      onReorder,
      onDelete,
      onRename,
    },
  };
}
