import type { Ship } from '@corsair/core';
import { Tile } from '@corsair/data';
import type { PlacedSettlement, TileMap } from '@corsair/data';

// The map at one pixel per tile, palette colours shaded by elevation. The minimap crops it and
// the sea chart (PRD S2) shows it whole; neither needs new art.
const TILE_RGB: Record<Tile, [number, number, number]> = {
  [Tile.Deep]: [37, 58, 94],
  [Tile.Shallow]: [79, 143, 186],
  [Tile.Beach]: [215, 181, 148],
  [Tile.Jungle]: [70, 130, 50],
  [Tile.Hills]: [117, 167, 67],
  [Tile.Mountain]: [129, 151, 150],
};
const RELIEF_PER_BAND = 14; // brightness change per elevation band of slope, lit from the north-west

const MINIMAP_TILES = { w: 240, h: 135 };
const NATION_COLOURS: Record<PlacedSettlement['nation'], string> = {
  spain: '#e8c170',
  england: '#cf573c',
  france: '#73bed3',
  netherlands: '#de9e41',
  pirate: '#090a14',
};

// Label placement order: capitals, then cities, towns, hamlets. The first to claim a spot keeps it.
const RANK = { capital: 0, city: 1, town: 2, hamlet: 3 } as const;
const PLACEMENTS = ['right', 'left', 'above', 'below'] as const;

/**
 * Greedy label placement: try each side of the port's dot and keep the first spot that overlaps
 * no earlier label and no other port's dot. A town or hamlet name that fits nowhere is hidden;
 * its dot still shows it on hover.
 */
function layoutLabels(pins: { s: PlacedSettlement; dot: HTMLElement; label: HTMLElement }[]) {
  const rank = (s: PlacedSettlement) => (s.type === 'capital' ? RANK.capital : RANK[s.size]);
  // Dots are obstacles too, so a name never hides another port.
  const dots = new Map(pins.map((p) => [p.s.id, p.dot.getBoundingClientRect()]));
  const labels: DOMRect[] = [];
  const hit = (r: DOMRect, o: DOMRect) => r.left < o.right && r.right > o.left && r.top < o.bottom && r.bottom > o.top;
  for (const { s, label } of [...pins].sort((a, b) => rank(a.s) - rank(b.s))) {
    label.hidden = false;
    const clear = (r: DOMRect) => !labels.some((o) => hit(r, o)) && ![...dots].some(([id, o]) => id !== s.id && hit(r, o));
    const spot = PLACEMENTS.find((where) => {
      label.dataset.place = where;
      return clear(label.getBoundingClientRect());
    });
    // Capitals and cities always keep their name, on the right if nothing is clear.
    if (!spot && rank(s) > RANK.city) {
      label.hidden = true;
      continue;
    }
    if (!spot) label.dataset.place = 'right';
    labels.push(label.getBoundingClientRect());
  }
}

function paintOverview(map: TileMap): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = map.width;
  canvas.height = map.height;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(map.width, map.height);
  const h = (x: number, y: number) =>
    x < 0 || y < 0 || x >= map.width || y >= map.height ? 0 : (map.elevation[y * map.width + x] ?? 0);
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const i = y * map.width + x;
      const [r, g, b] = TILE_RGB[map.tiles[i]! as Tile];
      const shade = (h(x + 1, y + 1) - h(x - 1, y - 1)) * RELIEF_PER_BAND;
      image.data[i * 4] = r + shade;
      image.data[i * 4 + 1] = g + shade;
      image.data[i * 4 + 2] = b + shade;
      image.data[i * 4 + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

export function createCharts(parent: HTMLElement, map: TileMap, settlements: PlacedSettlement[]) {
  const overview = paintOverview(map);

  const minimap = parent.appendChild(document.createElement('canvas'));
  minimap.className = 'minimap';
  minimap.width = MINIMAP_TILES.w;
  minimap.height = MINIMAP_TILES.h;
  const mctx = minimap.getContext('2d')!;
  mctx.imageSmoothingEnabled = false;

  const chart = parent.appendChild(document.createElement('div'));
  chart.className = 'chart';
  chart.hidden = true;
  const sheet = chart.appendChild(document.createElement('div'));
  sheet.className = 'chart-sheet';
  sheet.style.aspectRatio = `${map.width} / ${map.height}`;
  sheet.appendChild(overview);
  // Every port gets a dot; its name is placed later by layoutLabels, which needs the chart visible.
  const pins = settlements.map((s) => {
    const dot = sheet.appendChild(document.createElement('div'));
    dot.className = `chart-dot label-${s.nation}`;
    dot.title = s.name;
    const label = sheet.appendChild(document.createElement('div'));
    label.className = `chart-port label-${s.nation}`;
    label.textContent = s.name;
    for (const el of [dot, label]) {
      el.style.left = `${(s.x / map.width) * 100}%`;
      el.style.top = `${(s.y / map.height) * 100}%`;
    }
    return { s, dot, label };
  });
  const marker = sheet.appendChild(document.createElement('div'));
  marker.className = 'chart-player';
  const hint = chart.appendChild(document.createElement('div'));
  hint.className = 'chart-hint';
  hint.textContent = 'Sea chart · M to close';

  window.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'm') {
      chart.hidden = !chart.hidden;
      if (!chart.hidden) layoutLabels(pins);
    }
    if (e.key === 'Escape') chart.hidden = true;
  });

  return {
    /** `camera` is the top-left of the view in world pixels. */
    update(player: Ship | undefined, camera: { x: number; y: number }, view: { width: number; height: number }) {
      if (!player) return;
      // Minimap: a window on the overview centred on the ship, clamped to the map.
      const sx = Math.max(0, Math.min(map.width - MINIMAP_TILES.w, Math.round(player.x - MINIMAP_TILES.w / 2)));
      const sy = Math.max(0, Math.min(map.height - MINIMAP_TILES.h, Math.round(player.y - MINIMAP_TILES.h / 2)));
      mctx.drawImage(overview, sx, sy, MINIMAP_TILES.w, MINIMAP_TILES.h, 0, 0, MINIMAP_TILES.w, MINIMAP_TILES.h);
      for (const s of settlements) {
        mctx.fillStyle = NATION_COLOURS[s.nation];
        mctx.fillRect(Math.floor(s.x - sx) - 1, Math.floor(s.y - sy) - 1, 3, 3);
      }
      const vw = view.width / map.tileSize;
      const vh = view.height / map.tileSize;
      mctx.strokeStyle = '#ebede9';
      const vx = camera.x / map.tileSize - sx;
      const vy = camera.y / map.tileSize - sy;
      mctx.strokeRect(Math.round(vx) + 0.5, Math.round(vy) + 0.5, vw, vh);
      mctx.fillStyle = '#e8c170';
      mctx.fillRect(Math.round(player.x - sx) - 1, Math.round(player.y - sy) - 1, 3, 3);

      if (!chart.hidden) {
        marker.style.left = `${(player.x / map.width) * 100}%`;
        marker.style.top = `${(player.y / map.height) * 100}%`;
      }
    },
  };
}
