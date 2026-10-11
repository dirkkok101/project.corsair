import { isLand, tileAt } from '@corsair/data';
import type { TileMap } from '@corsair/data';
import { useEffect, useRef } from 'preact/hooks';

/** The inset's size in CSS pixels; the sea is drawn in 2-pixel cells. */
const W = 240;
const H = 150;

/**
 * A small parchment chart of where some news is from (storyboard 2.7): the coast between here and there, both
 * ports inked in, and the way between them as a dashed line, so a place named in the tavern is a place on the sea.
 */
export function ChartInset({ map, here, there }: { map: TileMap; here: { x: number; y: number; name: string }; there: { x: number; y: number; name: string } }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    // Frame both ports with a margin, at the inset's aspect, and never closer than a day's sail across.
    const cx = (here.x + there.x) / 2;
    const cy = (here.y + there.y) / 2;
    const span = Math.max(120, Math.abs(here.x - there.x) * 1.4, (Math.abs(here.y - there.y) * 1.4 * W) / H);
    const perTile = W / span;
    const x0 = cx - span / 2;
    const y0 = cy - H / perTile / 2;
    const land = (x: number, y: number) => isLand(tileAt(map, x, y));
    const step = 0.6 / perTile;
    for (let py = 0; py < H; py += 2) {
      for (let px = 0; px < W; px += 2) {
        const tx = x0 + px / perTile;
        const ty = y0 + py / perTile;
        const here = land(tx, ty);
        const shore = here && (!land(tx + step, ty) || !land(tx - step, ty) || !land(tx, ty + step) || !land(tx, ty - step));
        ctx.fillStyle = shore ? '#5e4024' : here ? '#a8834e' : '#e2cfa3';
        ctx.fillRect(px, py, 2, 2);
      }
    }
    const at = (p: { x: number; y: number }) => [(p.x - x0) * perTile, (p.y - y0) * perTile] as const;
    const [ax, ay] = at(here);
    const [bx, by] = at(there);
    ctx.strokeStyle = '#3a2614';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(bx, by);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.font = '600 11px "Alegreya Sans", sans-serif';
    for (const [x, y, name, colour] of [
      [ax, ay, here.name, '#3a2614'],
      [bx, by, there.name, '#a53030'],
    ] as const) {
      ctx.fillStyle = colour;
      ctx.beginPath();
      ctx.arc(x, y, 3.5, 0, Math.PI * 2);
      ctx.fill();
      // Names sit to the side with more room, so they stay on the parchment.
      ctx.textAlign = x > W / 2 ? 'right' : 'left';
      // Clear of the edges, and haloed in parchment so a name over land still reads.
      const tx = x + (x > W / 2 ? -7 : 7);
      const ty = Math.max(12, Math.min(H - 5, y + 4));
      ctx.strokeStyle = '#e2cfa3';
      ctx.lineWidth = 3;
      ctx.strokeText(name, tx, ty);
      ctx.fillText(name, tx, ty);
    }
  }, [map, here.x, here.y, there.x, there.y]);
  return <canvas ref={ref} class="chart-inset" width={W} height={H} />;
}
