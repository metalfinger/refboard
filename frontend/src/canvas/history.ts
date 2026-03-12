import type { SceneManager } from './SceneManager';

export class UndoManager {
  private stack: string[] = [];
  private pointer: number = -1;
  private maxEntries: number = 50;
  private locked: boolean = false;
  private sceneManager: SceneManager;

  constructor(sceneManager: SceneManager) {
    this.sceneManager = sceneManager;
    // Save initial state
    this.saveState();
  }

  isLocked(): boolean {
    return this.locked;
  }

  saveState(): void {
    if (this.locked) return;

    const json = JSON.stringify(this.sceneManager.serialize());

    // If we're not at the end, discard forward history
    if (this.pointer < this.stack.length - 1) {
      this.stack = this.stack.slice(0, this.pointer + 1);
    }

    // Don't save if identical to current state
    if (this.stack.length > 0 && this.stack[this.pointer] === json) {
      return;
    }

    this.stack.push(json);

    // Enforce max entries
    if (this.stack.length > this.maxEntries) {
      this.stack.shift();
    }

    this.pointer = this.stack.length - 1;
  }

  undo(): void {
    if (!this.canUndo()) return;

    this.pointer--;
    this.restoreState();
  }

  redo(): void {
    if (!this.canRedo()) return;

    this.pointer++;
    this.restoreState();
  }

  canUndo(): boolean {
    return this.pointer > 0;
  }

  canRedo(): boolean {
    return this.pointer < this.stack.length - 1;
  }

  private restoreState(): void {
    const state = this.stack[this.pointer];
    if (!state) return;

    this.locked = true;
    const parsed = JSON.parse(state);
    this.sceneManager.loadScene(parsed).then(() => {
      this.locked = false;
    });
  }

  clear(): void {
    this.stack = [];
    this.pointer = -1;
    this.saveState();
  }
}
