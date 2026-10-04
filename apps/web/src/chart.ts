import type { Ship } from '@corsair/core';
import { Tile } from '@corsair/data';
import type { PlacedSettlement, TileMap } from '@corsair/data';
import { VIEW_HEIGHT, VIEW_WIDTH } from '@corsair/render';

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
  for (const s of settlements) {
    const pin = sheet.appendChild(document.createElement('div'));
    pin.className = `chart-port label-${s.nation}`;
    pin.textContent = s.name;
    pin.style.left = `${(s.x / map.width) * 100}%`;
    pin.style.top = `${(s.y / map.height) * 100}%`;
  }
  const marker = sheet.appendChild(document.createElement('div'));
  marker.className = 'chart-player';
  const hint = chart.appendChild(document.createElement('div'));
  hint.className = 'chart-hint';
  hint.textContent = 'Sea chart · M to close';

  window.addEventListener('keydown', (e) => {
    if (e.key.toLowerCase() === 'm') chart.hidden = !chart.hidden;
    if (e.key === 'Escape') chart.hidden = true;
  });

  return {
    /** `camera` is the top-left of the view in world pixels. */
    update(player: Ship | undefined, camera: { x: number; y: number }) {
      if (!player) return;
      // Minimap: a window on the overview centred on the ship, clamped to the map.
      const sx = Math.max(0, Math.min(map.width - MINIMAP_TILES.w, Math.round(player.x - MINIMAP_TILES.w / 2)));
      const sy = Math.max(0, Math.min(map.height - MINIMAP_TILES.h, Math.round(player.y - MINIMAP_TILES.h / 2)));
      mctx.drawImage(overview, sx, sy, MINIMAP_TILES.w, MINIMAP_TILES.h, 0, 0, MINIMAP_TILES.w, MINIMAP_TILES.h);
      for (const s of settlements) {
        mctx.fillStyle = NATION_COLOURS[s.nation];
        mctx.fillRect(Math.floor(s.x - sx) - 1, Math.floor(s.y - sy) - 1, 3, 3);
      }
      const vw = VIEW_WIDTH / map.tileSize;
      const vh = VIEW_HEIGHT / map.tileSize;
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
