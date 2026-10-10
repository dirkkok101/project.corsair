// Mouse controls (left-click to move, right-click to act). This file only turns pointer events on the
// game canvas into tile positions and presses; main.tsx decides what a click means at sea or in battle.

export interface MouseHandlers {
  /** Tile under a point on the canvas, in CSS pixels from the canvas's top-left; undefined off the sea. */
  toTile(px: number, py: number): { x: number; y: number } | undefined;
  /** Left button pressed, or the pointer moved while it is held (`held` true; at most every HOLD_MS). */
  left(tile: { x: number; y: number }, held: boolean): void;
  right(tile: { x: number; y: number }): void;
  rightUp(): void;
  /** The pointer over the canvas (no button), for hover cards; undefined when it leaves. */
  hover(tile: { x: number; y: number } | undefined, client: { x: number; y: number }): void;
}

/** Holding the left button re-aims at most this often, so following the pointer stays cheap. */
const HOLD_MS = 250;

export function bindMouse(canvas: HTMLCanvasElement, handlers: MouseHandlers) {
  let leftHeld = false;
  let lastHold = 0;
  const tileOf = (e: MouseEvent) => {
    const r = canvas.getBoundingClientRect();
    return handlers.toTile(e.clientX - r.left, e.clientY - r.top);
  };
  // The game owns the right button over the sea: no browser menu.
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) {
      const tile = tileOf(e);
      if (!tile) return;
      leftHeld = true;
      lastHold = performance.now();
      handlers.left(tile, false);
    } else if (e.button === 2) {
      const tile = tileOf(e);
      if (tile) handlers.right(tile);
    }
  });
  canvas.addEventListener('mousemove', (e) => {
    const now = performance.now();
    const tile = tileOf(e);
    if (leftHeld && tile && now - lastHold >= HOLD_MS) {
      lastHold = now;
      handlers.left(tile, true);
    }
    handlers.hover(leftHeld ? undefined : tile, { x: e.clientX, y: e.clientY });
  });
  canvas.addEventListener('mouseleave', () => handlers.hover(undefined, { x: 0, y: 0 }));
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) leftHeld = false;
    if (e.button === 2) handlers.rightUp();
  });
  window.addEventListener('blur', () => {
    leftHeld = false;
    handlers.rightUp();
  });
}
