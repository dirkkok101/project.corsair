// A fleet at sea: the ships sailing in company with a flagship (the player's fleet, a pirate's prizes in tow) are
// not on the sea map of their own (the sim pools them with her), so the view draws them in line astern of her: each
// follows the ship ahead of her, closing on her station `spacing` astern of that ship and pointing at her, so the
// whole line swings round behind the flagship when she turns (following her old track instead left the line strung
// out beside her after a tight turn). Out of port they come out one by one, each once her station is open water.

/** A flagship moved this far between two frames has jumped (a new career, a debug move): the line starts afresh. */
const JUMP_TILES = 12;
/** How fast a ship closes on her station, a share of the gap a second (about a ship's turn of speed). */
const FOLLOW_RATE = 1.5;
/** The farthest a ship falls behind the one ahead, in spacings. */
const LEASH = 1.3;

export interface Station {
  x: number;
  y: number;
  headingDeg: number;
}

const bearing = (from: { x: number; y: number }, to: { x: number; y: number }) => ((Math.atan2(to.x - from.x, -(to.y - from.y)) * 180) / Math.PI + 360) % 360;

export function createConsorts() {
  /** Each flagship's line, nearest first, and where she was last. */
  const lines = new Map<string, { at: { x: number; y: number }; ships: Station[] }>();
  return {
    /**
     * Where the ships in company with her lie, nearest first: each easing toward her station `spacing` astern of the
     * ship ahead (along that ship's heading), heading for her; `dt` seconds since the last look. Only over open water
     * (`water`): fewer than `count` come back while the rest are still in port behind her, never over the land.
     */
    stations(id: string, at: { x: number; y: number; headingDeg: number }, count: number, spacing: number, water: (x: number, y: number) => boolean = () => true, dt = 1 / 60): Station[] {
      let line = lines.get(id);
      if (!line || Math.hypot(line.at.x - at.x, line.at.y - at.y) > JUMP_TILES) line = { at: { x: at.x, y: at.y }, ships: [] };
      line.at = { x: at.x, y: at.y };
      const ease = 1 - Math.exp(-dt * FOLLOW_RATE);
      const out: Station[] = [];
      let ahead: Station = { x: at.x, y: at.y, headingDeg: at.headingDeg };
      for (let k = 0; k < count; k++) {
        const r = (ahead.headingDeg * Math.PI) / 180;
        const station = { x: ahead.x - Math.sin(r) * spacing, y: ahead.y + Math.cos(r) * spacing };
        const was = line.ships[k];
        // A ship not yet out comes out at her station, once it is open water (and the way to it from the one ahead).
        if (!was && !(water(station.x, station.y) && water((station.x + ahead.x) / 2, (station.y + ahead.y) / 2))) break;
        let pos = was ? { x: was.x + (station.x - was.x) * ease, y: was.y + (station.y - was.y) * ease } : station;
        // On a leash: never more than LEASH spacings from the ship ahead (at a cruise of 4x the easing alone would lag).
        const gap = Math.hypot(pos.x - ahead.x, pos.y - ahead.y);
        if (gap > spacing * LEASH) pos = { x: ahead.x + ((pos.x - ahead.x) * spacing * LEASH) / gap, y: ahead.y + ((pos.y - ahead.y) * spacing * LEASH) / gap };
        // Never onto the land: she holds where she was rather than cut a corner over it.
        const here = water(pos.x, pos.y) ? pos : (was ?? station);
        // Heading for the ship ahead; right on top of her station, the way the ship ahead heads.
        const headingDeg = Math.hypot(ahead.x - here.x, ahead.y - here.y) > spacing * 0.25 ? bearing(here, ahead) : ahead.headingDeg;
        const s = { x: here.x, y: here.y, headingDeg };
        out.push(s);
        ahead = s;
      }
      line.ships = out;
      lines.set(id, line);
      return out;
    },
    /** Forget the lines of flagships no longer leading anyone in sight. */
    keep(ids: Set<string>) {
      for (const id of lines.keys()) if (!ids.has(id)) lines.delete(id);
    },
  };
}
