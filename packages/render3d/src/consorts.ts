// A fleet at sea: the ships sailing in company with a flagship (the player's fleet, a pirate's prizes in tow) are
// not on the sea map of their own (the sim pools them with her), so the view draws them in line astern of her, each
// on the very track she sailed, `spacing` apart: they follow her round a turn as ships in company do. Out of port
// they come out one by one, each as the flagship has sailed far enough to make room for her on open water.

/** A track this much shorter (tiles) than she moved is a jump (a new career, a debug move), not sailing. */
const JUMP_TILES = 12;
/** Her track is kept as a point every this many tiles. */
const STEP_TILES = 0.25;

export interface Station {
  x: number;
  y: number;
  headingDeg: number;
}

const bearing = (from: [number, number], to: [number, number]) => ((Math.atan2(to[0] - from[0], -(to[1] - from[1])) * 180) / Math.PI + 360) % 360;

export function createConsorts() {
  /** Each flagship's track, newest first. */
  const tracks = new Map<string, [number, number][]>();
  return {
    /**
     * Where the ships in company with her lie, nearest first: along her track, `spacing` tiles apart, each heading the
     * way the track runs there. Short of track (just sailed), straight astern of her heading, but only over open water
     * (`water`): fewer than `count` come back while the rest are still in port behind her, never over the land.
     */
    stations(id: string, at: { x: number; y: number; headingDeg: number }, count: number, spacing: number, water: (x: number, y: number) => boolean = () => true): Station[] {
      let track = tracks.get(id);
      const here: [number, number] = [at.x, at.y];
      if (!track || Math.hypot(track[0]![0] - at.x, track[0]![1] - at.y) > JUMP_TILES) track = [here];
      else if (Math.hypot(track[0]![0] - at.x, track[0]![1] - at.y) >= STEP_TILES) track.unshift(here);
      const out: Station[] = [];
      let k = 0;
      let walked = 0;
      let prev = here;
      for (const p of track) {
        const leg = Math.hypot(p[0] - prev[0], p[1] - prev[1]);
        while (k < count && walked + leg >= (k + 1) * spacing && leg > 0) {
          const t = ((k + 1) * spacing - walked) / leg;
          const pt: [number, number] = [prev[0] + (p[0] - prev[0]) * t, prev[1] + (p[1] - prev[1]) * t];
          out.push({ x: pt[0], y: pt[1], headingDeg: bearing(p, prev) });
          k++;
        }
        walked += leg;
        prev = p;
        if (k >= count) break;
      }
      // Past the end of her track, the line runs on straight back from its last point, the way she was heading.
      const last = out.at(-1);
      const r = (((last?.headingDeg ?? at.headingDeg) * Math.PI) / 180);
      const [bx, by] = last ? [last.x, last.y] : here;
      for (let n = 1; k < count; k++, n++) {
        const back = last ? n * spacing : (k + 1) * spacing;
        const from = last ? (n - 1) * spacing : k * spacing;
        // The way back to her station must be open water too (a halfway check is enough at a ship's spacing).
        const pt = (d: number): [number, number] => [bx - Math.sin(r) * d, by + Math.cos(r) * d];
        if (![pt(back), pt((back + from) / 2)].every(([x, y]) => water(x, y))) break;
        const [x, y] = pt(back);
        out.push({ x, y, headingDeg: last?.headingDeg ?? at.headingDeg });
      }
      // Kept only as long as the line needs it.
      let len = 0;
      let keep = 1;
      for (; keep < track.length && len <= (count + 1) * spacing; keep++) len += Math.hypot(track[keep]![0] - track[keep - 1]![0], track[keep]![1] - track[keep - 1]![1]);
      track.length = Math.min(track.length, keep + 1);
      tracks.set(id, track);
      return out;
    },
    /** Forget the tracks of flagships no longer leading anyone in sight. */
    keep(ids: Set<string>) {
      for (const id of tracks.keys()) if (!ids.has(id)) tracks.delete(id);
    },
  };
}
