import type { PlacedSettlement } from '@corsair/data';

// Labels are DOM text over the canvas so they stay crisp at any scale; pixel fonts come later.
const LABEL_OFFSET_PX = 26; // below the town sprite's ground point, in view pixels

export function createLabels(parent: HTMLElement, settlements: PlacedSettlement[], tileSize: number) {
  const layer = parent.appendChild(document.createElement('div'));
  layer.className = 'labels';
  const nodes = settlements.map((s) => {
    const el = layer.appendChild(document.createElement('div'));
    el.className = `label label-${s.nation}`;
    el.textContent = s.name;
    return { el, x: s.x * tileSize, y: s.y * tileSize + LABEL_OFFSET_PX };
  });

  return {
    /** `camera` is the top-left of the view in world pixels; `scale` is CSS pixels per art pixel. */
    update(camera: { x: number; y: number }, view: { width: number; height: number }, scale: number) {
      for (const n of nodes) {
        const vx = n.x - camera.x;
        const vy = n.y - camera.y;
        const visible = vx > -100 && vx < view.width + 100 && vy > -20 && vy < view.height + 20;
        n.el.style.display = visible ? '' : 'none';
        if (visible) n.el.style.transform = `translate(${vx * scale}px, ${vy * scale}px) translateX(-50%)`;
      }
    },
  };
}
