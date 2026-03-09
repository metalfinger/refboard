import { Canvas, PencilBrush, IText, FabricObject } from 'fabric';

export enum ToolType {
  SELECT = 'SELECT',
  PAN = 'PAN',
  PEN = 'PEN',
  TEXT = 'TEXT',
  ERASER = 'ERASER',
}

export interface ToolOptions {
  color?: string;
  strokeWidth?: number;
  fontSize?: number;
}

const defaultOptions: ToolOptions = {
  color: '#ffffff',
  strokeWidth: 4,
  fontSize: 24,
};

type CleanupFn = (() => void) | null;

export function activateTool(
  canvas: Canvas,
  tool: ToolType,
  options: ToolOptions = {}
): CleanupFn {
  const opts = { ...defaultOptions, ...options };

  // Reset common state
  canvas.isDrawingMode = false;
  canvas.selection = false;
  canvas.defaultCursor = 'default';
  canvas.hoverCursor = 'default';
  canvas.forEachObject((obj: FabricObject) => {
    obj.selectable = false;
    obj.evented = false;
  });

  switch (tool) {
    case ToolType.SELECT: {
      canvas.selection = true;
      canvas.defaultCursor = 'default';
      canvas.hoverCursor = 'move';
      canvas.forEachObject((obj: FabricObject) => {
        obj.selectable = true;
        obj.evented = true;
      });
      return null;
    }

    case ToolType.PAN: {
      canvas.defaultCursor = 'grab';
      canvas.hoverCursor = 'grab';
      // Pan is handled by FabricCanvas component directly
      return null;
    }

    case ToolType.PEN: {
      canvas.isDrawingMode = true;
      const brush = new PencilBrush(canvas);
      brush.color = opts.color!;
      brush.width = opts.strokeWidth!;
      canvas.freeDrawingBrush = brush;
      return null;
    }

    case ToolType.TEXT: {
      canvas.defaultCursor = 'text';
      canvas.hoverCursor = 'text';

      const handler = (e: any) => {
        const pointer = canvas.getScenePoint(e.e);
        const text = new IText('Type here', {
          left: pointer.x,
          top: pointer.y,
          fontSize: opts.fontSize!,
          fill: opts.color!,
          fontFamily: 'sans-serif',
          editable: true,
        });
        canvas.add(text);
        canvas.setActiveObject(text);
        text.enterEditing();
        text.selectAll();
        // Remove handler after placing text
        canvas.off('mouse:down', handler);
      };

      canvas.on('mouse:down', handler);
      return () => {
        canvas.off('mouse:down', handler);
      };
    }

    case ToolType.ERASER: {
      canvas.defaultCursor = 'crosshair';
      canvas.hoverCursor = 'crosshair';
      canvas.forEachObject((obj: FabricObject) => {
        obj.selectable = false;
        obj.evented = true;
      });

      const handler = (e: any) => {
        const target = e.target;
        if (target) {
          canvas.remove(target);
          canvas.requestRenderAll();
        }
      };

      canvas.on('mouse:down', handler);
      return () => {
        canvas.off('mouse:down', handler);
      };
    }

    default:
      return null;
  }
}

export const toolShortcuts: Record<string, ToolType> = {
  v: ToolType.SELECT,
  h: ToolType.PAN,
  p: ToolType.PEN,
  t: ToolType.TEXT,
  e: ToolType.ERASER,
  '1': ToolType.SELECT,
  '2': ToolType.PAN,
  '3': ToolType.PEN,
  '4': ToolType.TEXT,
  '5': ToolType.ERASER,
};
