import type { FlatSail, HullPlan, Mast, ShipPlan, SquareSail } from './shipyard';

// Each class's plan for the ship builder (shipyard.ts): hull lines, paint, gun decks, masts and sails. The
// proportions follow the class models the sprites were rendered from (tools/art/render_brig.py,
// render_ships.py), so sizes on the map are unchanged. Forward positions are from the hull's middle (bow
// positive); heights from the waterline; model units (the brig is 2.4 long).

type Paint = HullPlan['paint'];
/** Pirates! 2004's golden-brown hulls: dark planking below, a warm painted band above, gilt trim. */
const WARM: Paint = { hull: '#5b3425', band: '#c98f3d', wale: '#2b1b16', deck: '#9c7a57', trim: '#e6bf6a' };
/** A plain trader: weathered brown with a dull ochre band. */
const TRADER: Paint = { hull: '#4f3426', band: '#a87b45', wale: '#2b1b16', deck: '#967553', trim: '#c9a35e' };
/** A navy sloop: blue with a gold band. */
const ROYAL: Paint = { hull: '#24406e', band: '#d6ae4a', wale: '#14213a', deck: '#9c7a57', trim: '#f0cf72' };
/** A man-of-war: dark hull, gilded bands between the gun decks. */
const NAVY: Paint = { hull: '#3a2820', band: '#d4a83c', wale: '#1d1714', deck: '#987755', trim: '#f2cf6e' };
/** A Spanish galleon: dark wood, a red band, gold trim. */
const SPANISH: Paint = { hull: '#46281d', band: '#b0422c', wale: '#22140f', deck: '#967350', trim: '#e9c26a' };
/** The treasure galleon: gilded all along. */
const TREASURE: Paint = { hull: '#46281d', band: '#d9a83c', wale: '#22140f', deck: '#967350', trim: '#ffe08a' };

const sq = (name: string, zt: number, zb: number, wt: number, wb: number, billow: number): SquareSail => ({ name, zt, zb, wt, wb, billow });
const mast = (at: number, height: number, ...squares: SquareSail[]): Mast => ({ at, height, squares });
const hull = (o: Partial<HullPlan> & Pick<HullPlan, 'length' | 'beam' | 'rail' | 'ports' | 'paint'>): HullPlan => ({
  sheerStern: 0.08,
  sheerBow: 0.07,
  castle: 0,
  castleTo: 0.2,
  forecastle: 0,
  forecastleFrom: 1,
  fullness: 0.3,
  sternWidth: 0.75,
  ...o,
});
const jib = (tack: [number, number], head: [number, number], clew: [number, number]): FlatSail => ({ kind: 'jib', corners: [tack, head, clew], pivot: tack[0] });
const spanker = (corners: [number, number][], pivot: number): FlatSail => ({ kind: 'spanker', corners, pivot, spar: true, boom: true });
const gaff = (corners: [number, number][], pivot: number): FlatSail => ({ kind: 'gaff', corners, pivot, spar: true, boom: true });
const lateen = (mz: number, castle: number): FlatSail => ({
  kind: 'lateen',
  corners: [
    [mz + 0.42, 0.62 + castle],
    [mz - 0.56, 1.5],
    [mz - 0.48, 0.58 + castle],
  ],
  pivot: mz,
  spar: true,
});

/**
 * A lugsail on the mast at `mz`: its yard hung a little forward of the mast from luff (`fwd`) to leech (`aft`), the
 * foot at `foot`, the yard rising from `throat` at the luff to `peak` at the leech.
 */
const lug = (mz: number, fwd: number, aft: number, foot: number, throat: number, peak: number): FlatSail => ({
  kind: 'gaff',
  corners: [
    [fwd, foot],
    [fwd + 0.04, throat],
    [aft, peak],
    [aft - 0.04, foot + 0.04],
  ],
  pivot: mz,
  spar: true,
});
/** A galley's lateen on the mast at `mz`: the long yard from low forward to high aft, the sail's foot `aft` long behind the tack. */
const lateenSail = (mz: number, fwd: number, aft: number, top: number): FlatSail => ({
  kind: 'lateen',
  corners: [
    [mz + fwd, 0.3],
    [mz - aft * 1.3, top],
    [mz - aft, 0.28],
  ],
  pivot: mz,
  spar: true,
});

/** A gaff sloop stretched `k` along: one mast, a gaff main, a jib, perhaps a square topsail and a second jib. */
function sloop(k: number, kw: number, top: number, ports: number, paint: Paint, topsail: boolean, secondJib: boolean): ShipPlan {
  const my = 0.22 * k;
  return {
    hull: hull({ length: 1.8 * k, beam: 0.31 * kw, rail: 0.21 + (k - 1) * 0.1, sheerStern: 0.05, sheerBow: 0.07, fullness: 0.1, sternWidth: 0.78, ports: [{ at: 0.75, count: ports }], paint }),
    masts: [mast(my, top, ...(topsail ? [sq('topsail', top - 0.1, 1.5, 0.52, 0.7, 0.06)] : []))],
    flats: [
      gaff([[my - 0.05, 0.44], [my - 0.05, 1.42], [-0.86 * k, 1.7], [-1.12 * k, 0.48]], my),
      jib([1.44 * k, 0.44], [my + 0.04, 1.62], [0.46 * k, 0.36]),
      ...(secondJib ? [jib([1.12 * k, 0.4], [my + 0.06, 1.3], [0.52 * k, 0.4])] : []),
    ],
    bowsprit: [
      [0.8 * k, 0.28],
      [1.48 * k, 0.42],
    ],
  };
}

/** A galleon: high castles fore and aft, two gun decks, square fore and main, a lateen mizzen. */
function galleon(length: number, castle: number, paint: Paint): ShipPlan {
  return {
    hull: hull({ length, beam: 0.48, rail: 0.36, castle, castleTo: 0.24, forecastle: 0.18, forecastleFrom: 0.82, fullness: 0.6, sternWidth: 0.7, ports: [{ at: 0.62, count: 7 }, { at: 0.4, count: 7 }], paint }),
    masts: [
      mast(0.85, 1.92, sq('fore_top', 1.64, 1.18, 0.72, 0.92, 0.08), sq('fore_course', 1.1, 0.62, 1.04, 1.14, 0.1)),
      mast(0.1, 2.18, sq('main_top', 1.88, 1.3, 0.84, 1.08, 0.08), sq('main_course', 1.22, 0.64, 1.2, 1.3, 0.1)),
      mast(-0.8, 1.74),
    ],
    flats: [lateen(-0.8, castle), jib([1.6, 0.84], [0.95, 1.48], [1.2, 0.72])],
    bowsprit: [
      [1.38, 0.56],
      [1.62, 0.84],
    ],
  };
}

export const RIGS: Record<string, ShipPlan> = {
  'ship.brig': {
    hull: hull({ length: 2.4, beam: 0.4, rail: 0.3, sheerStern: 0.12, castle: 0.08, ports: [{ at: 0.78, count: 5 }], paint: WARM }),
    masts: [
      mast(0.42, 1.62, sq('fore_top', 1.52, 1.06, 0.62, 0.82, 0.08), sq('fore_course', 1.0, 0.48, 0.92, 1.0, 0.1)),
      mast(-0.28, 1.78, sq('main_top', 1.66, 1.14, 0.68, 0.9, 0.08), sq('main_course', 1.08, 0.5, 1.0, 1.08, 0.1)),
    ],
    flats: [jib([1.68, 0.45], [0.5, 1.4], [1.1, 0.33]), spanker([[-0.33, 0.52], [-0.33, 1.22], [-1.15, 0.92], [-1.22, 0.52]], -0.33)],
    bowsprit: [
      [1.12, 0.28],
      [1.72, 0.46],
    ],
  },
  'ship.sloop': sloop(1, 1, 1.86, 3, WARM, false, false),
  'ship.war_sloop': sloop(1.12, 1.08, 2.02, 5, WARM, true, false),
  'ship.royal_sloop': sloop(1.2, 1.1, 2.1, 6, ROYAL, true, true),
  'ship.brigantine': {
    hull: hull({ length: 2.28, beam: 0.4, rail: 0.26, sheerStern: 0.04, sheerBow: 0.06, sternWidth: 0.8, ports: [{ at: 0.78, count: 5 }], paint: WARM }),
    masts: [mast(0.56, 1.8, sq('fore_top', 1.56, 1.08, 0.6, 0.78, 0.08), sq('fore_course', 1.0, 0.5, 0.86, 0.96, 0.1)), mast(-0.28, 1.96)],
    flats: [gaff([[-0.33, 0.42], [-0.33, 1.46], [-1.16, 1.84], [-1.28, 0.46]], -0.28), jib([1.56, 0.54], [0.6, 1.66], [1.02, 0.42])],
    bowsprit: [
      [1.02, 0.32],
      [1.6, 0.54],
    ],
  },
  'ship.fluyt': {
    // Bluff and pear-shaped: wide at the waterline, a narrow, high, stepped stern.
    hull: hull({ length: 2.64, beam: 0.5, rail: 0.28, castle: 0.34, castleTo: 0.27, sheerBow: 0.1, fullness: 0.9, sternWidth: 0.3, ports: [{ at: 0.7, count: 3 }], paint: TRADER }),
    masts: [
      mast(0.7, 1.62, sq('fore_top', 1.5, 1.06, 0.58, 0.76, 0.08), sq('fore_course', 1.0, 0.5, 0.84, 0.94, 0.1)),
      mast(0, 1.86, sq('main_top', 1.74, 1.16, 0.64, 0.86, 0.08), sq('main_course', 1.1, 0.52, 0.94, 1.04, 0.1)),
      mast(-0.8, 1.3),
    ],
    flats: [lateen(-0.8, 0.16), jib([1.6, 0.6], [0.78, 1.46], [1.12, 0.5])],
    bowsprit: [
      [1.18, 0.3],
      [1.7, 0.62],
    ],
  },
  'ship.barque': {
    hull: hull({ length: 2.4, beam: 0.42, rail: 0.27, castle: 0.1, castleTo: 0.2, fullness: 0.5, sternWidth: 0.55, ports: [{ at: 0.7, count: 3 }], paint: TRADER }),
    masts: [
      mast(0.68, 1.62, sq('fore_top', 1.52, 1.06, 0.56, 0.74, 0.08), sq('fore_course', 1.0, 0.5, 0.8, 0.9, 0.1)),
      mast(0, 1.84, sq('main_top', 1.66, 1.14, 0.62, 0.82, 0.08), sq('main_course', 1.08, 0.52, 0.9, 1.0, 0.1)),
      mast(-0.72, 1.4),
    ],
    flats: [spanker([[-0.76, 0.56], [-0.76, 1.22], [-1.28, 1.08], [-1.36, 0.56]], -0.76), jib([1.58, 0.58], [0.74, 1.5], [1.1, 0.48])],
    bowsprit: [
      [1.12, 0.32],
      [1.62, 0.58],
    ],
  },
  'ship.merchantman': {
    hull: hull({ length: 3.0, beam: 0.52, rail: 0.36, castle: 0.16, castleTo: 0.22, forecastle: 0.05, forecastleFrom: 0.85, fullness: 0.7, sternWidth: 0.7, ports: [{ at: 0.72, count: 8 }], paint: TRADER }),
    masts: [
      mast(0.8, 1.96, sq('fore_top', 1.66, 1.18, 0.8, 1.02, 0.08), sq('fore_course', 1.1, 0.56, 1.1, 1.2, 0.1)),
      mast(0.05, 2.18, sq('main_top', 1.86, 1.28, 0.88, 1.12, 0.08), sq('main_course', 1.2, 0.6, 1.22, 1.32, 0.1)),
      mast(-0.82, 1.74, sq('mizzen_top', 1.52, 1.1, 0.66, 0.82, 0.07)),
    ],
    flats: [spanker([[-0.88, 0.7], [-0.88, 1.3], [-1.42, 1.14], [-1.52, 0.7]], -0.88), jib([1.7, 0.78], [0.86, 1.7], [1.22, 0.62])],
    bowsprit: [
      [1.4, 0.42],
      [1.72, 0.78],
    ],
  },
  'ship.frigate': {
    hull: hull({ length: 3.24, beam: 0.46, rail: 0.33, castle: 0.08, castleTo: 0.34, forecastle: 0.04, forecastleFrom: 0.8, fullness: 0.35, sternWidth: 0.78, ports: [{ at: 0.72, count: 11 }], paint: NAVY }),
    masts: [
      mast(0.75, 2.06, sq('fore_tgallant', 1.96, 1.68, 0.56, 0.76, 0.06), sq('fore_top', 1.62, 1.14, 0.84, 1.06, 0.08), sq('fore_course', 1.08, 0.52, 1.14, 1.24, 0.1)),
      mast(0.05, 2.28, sq('main_tgallant', 2.18, 1.86, 0.62, 0.84, 0.06), sq('main_top', 1.8, 1.24, 0.92, 1.16, 0.08), sq('main_course', 1.18, 0.56, 1.26, 1.36, 0.1)),
      mast(-0.85, 1.86, sq('mizzen_tgallant', 1.78, 1.56, 0.46, 0.62, 0.05), sq('mizzen_top', 1.5, 1.06, 0.7, 0.86, 0.07)),
    ],
    flats: [spanker([[-0.9, 0.66], [-0.9, 1.3], [-1.52, 1.14], [-1.62, 0.66]], -0.9), jib([1.72, 0.78], [0.83, 1.66], [1.2, 0.62])],
    bowsprit: [
      [1.5, 0.4],
      [1.73, 0.8],
    ],
  },
  // A sixth rate: the frigate's rig on a shorter, lighter hull.
  'ship.light_frigate': {
    hull: hull({ length: 2.9, beam: 0.42, rail: 0.31, castle: 0.07, castleTo: 0.34, forecastle: 0.04, forecastleFrom: 0.8, fullness: 0.33, sternWidth: 0.76, ports: [{ at: 0.7, count: 11 }], paint: NAVY }),
    masts: [
      mast(0.68, 1.86, sq('fore_tgallant', 1.78, 1.52, 0.5, 0.68, 0.05), sq('fore_top', 1.46, 1.02, 0.76, 0.96, 0.07), sq('fore_course', 0.98, 0.48, 1.04, 1.12, 0.09)),
      mast(0.04, 2.06, sq('main_tgallant', 1.96, 1.68, 0.56, 0.76, 0.05), sq('main_top', 1.62, 1.12, 0.84, 1.04, 0.07), sq('main_course', 1.06, 0.5, 1.14, 1.22, 0.09)),
      mast(-0.76, 1.68, sq('mizzen_tgallant', 1.6, 1.4, 0.42, 0.56, 0.05), sq('mizzen_top', 1.36, 0.96, 0.64, 0.78, 0.06)),
    ],
    flats: [spanker([[-0.81, 0.6], [-0.81, 1.18], [-1.36, 1.03], [-1.45, 0.6]], -0.81), jib([1.55, 0.7], [0.75, 1.5], [1.08, 0.56])],
    bowsprit: [
      [1.35, 0.36],
      [1.56, 0.72],
    ],
  },
  'ship.ship_of_the_line': {
    hull: hull({
      length: 3.3,
      beam: 0.54,
      rail: 0.46,
      castle: 0.1,
      castleTo: 0.32,
      forecastle: 0.05,
      forecastleFrom: 0.82,
      fullness: 0.45,
      sternWidth: 0.78,
      ports: [{ at: 0.84, count: 11 }, { at: 0.62, count: 11 }, { at: 0.4, count: 11 }],
      paint: NAVY,
    }),
    masts: [
      mast(0.75, 2.04, sq('fore_tgallant', 1.96, 1.72, 0.58, 0.78, 0.06), sq('fore_top', 1.66, 1.2, 0.88, 1.1, 0.08), sq('fore_course', 1.14, 0.6, 1.2, 1.3, 0.1)),
      mast(0.05, 2.26, sq('main_tgallant', 2.18, 1.9, 0.64, 0.86, 0.06), sq('main_top', 1.84, 1.3, 0.96, 1.2, 0.08), sq('main_course', 1.24, 0.64, 1.32, 1.42, 0.1)),
      mast(-0.85, 1.86, sq('mizzen_tgallant', 1.8, 1.6, 0.48, 0.64, 0.05), sq('mizzen_top', 1.56, 1.14, 0.72, 0.88, 0.07)),
    ],
    flats: [spanker([[-0.9, 0.76], [-0.9, 1.34], [-1.5, 1.18], [-1.6, 0.76]], -0.9), jib([1.73, 0.84], [0.83, 1.7], [1.2, 0.7])],
    bowsprit: [
      [1.52, 0.5],
      [1.74, 0.86],
    ],
  },
  'ship.galleon': galleon(3.1, 0.36, SPANISH),
  'ship.treasure_galleon': galleon(3.16, 0.42, TREASURE),
  // The Pirates! pinnace: a small, low raider with two lugsails and sweeps, crammed with men.
  'ship.pinnace': {
    hull: hull({ length: 1.9, beam: 0.32, rail: 0.2, sheerStern: 0.05, sheerBow: 0.06, fullness: 0.12, sternWidth: 0.7, ports: [{ at: 0.75, count: 3 }], paint: WARM }),
    masts: [mast(0.55, 1.5), mast(-0.15, 1.7)],
    flats: [
      lug(0.55, 0.62, 0.0, 0.36, 1.36, 1.5),
      lug(-0.15, -0.06, -0.86, 0.38, 1.52, 1.68),
      jib([1.25, 0.34], [0.6, 1.2], [0.95, 0.3]),
    ],
    bowsprit: [
      [0.85, 0.24],
      [1.3, 0.36],
    ],
  },
  // A periagua: a great dugout canoe, two lugsails, no guns, swivels on the gunwale and her men at the oars.
  'ship.periagua': {
    hull: hull({ length: 1.6, beam: 0.24, rail: 0.12, sheerStern: 0.04, sheerBow: 0.05, fullness: 0.05, sternWidth: 0.5, ports: [], paint: TRADER }),
    masts: [mast(0.45, 1.2), mast(-0.2, 1.3)],
    flats: [lug(0.45, 0.5, -0.05, 0.24, 1.08, 1.18), lug(-0.2, -0.16, -0.72, 0.26, 1.18, 1.28)],
    bowsprit: [
      [0.7, 0.12],
      [0.82, 0.16],
    ],
  },
  // The guarda costa's half-galley: long and low, lateen sails on two masts, a gun in her bow and oars all along.
  'ship.half_galley': {
    hull: hull({ length: 2.2, beam: 0.28, rail: 0.16, sheerStern: 0.06, sheerBow: 0.04, castle: 0.04, castleTo: 0.12, fullness: 0.08, sternWidth: 0.6, ports: [], paint: SPANISH }),
    masts: [mast(0.45, 1.55), mast(-0.33, 1.4)],
    flats: [lateenSail(0.45, 0.46, 0.5, 1.5), lateenSail(-0.33, 0.38, 0.45, 1.34)],
    bowsprit: [
      [0.98, 0.2],
      [1.22, 0.3],
    ],
  },
  // The galley-frigate: a frigate's battery and rig on a longer, lower hull, with a row of sweep ports below.
  'ship.galley_frigate': {
    hull: hull({ length: 3.3, beam: 0.44, rail: 0.3, castle: 0.06, castleTo: 0.3, forecastle: 0.03, forecastleFrom: 0.82, fullness: 0.3, sternWidth: 0.76, ports: [{ at: 0.74, count: 11 }], paint: NAVY }),
    masts: [
      mast(0.75, 1.96, sq('fore_tgallant', 1.86, 1.6, 0.54, 0.72, 0.06), sq('fore_top', 1.54, 1.08, 0.8, 1.02, 0.08), sq('fore_course', 1.02, 0.5, 1.1, 1.2, 0.1)),
      mast(0.05, 2.18, sq('main_tgallant', 2.08, 1.78, 0.6, 0.8, 0.06), sq('main_top', 1.72, 1.18, 0.88, 1.12, 0.08), sq('main_course', 1.12, 0.54, 1.22, 1.32, 0.1)),
      mast(-0.85, 1.78, sq('mizzen_top', 1.44, 1.02, 0.66, 0.82, 0.07)),
    ],
    flats: [spanker([[-0.9, 0.62], [-0.9, 1.24], [-1.52, 1.1], [-1.62, 0.62]], -0.9), jib([1.74, 0.76], [0.83, 1.6], [1.2, 0.6])],
    bowsprit: [
      [1.52, 0.38],
      [1.76, 0.76],
    ],
  },
  // A ketch: a tall square-rigged mainmast and a short mizzen, no foremast; a handy coaster.
  'ship.ketch': {
    hull: hull({ length: 2.1, beam: 0.4, rail: 0.25, castle: 0.06, castleTo: 0.2, fullness: 0.5, sternWidth: 0.6, ports: [{ at: 0.72, count: 3 }], paint: TRADER }),
    masts: [mast(0.25, 1.86, sq('main_top', 1.74, 1.2, 0.62, 0.82, 0.08), sq('main_course', 1.14, 0.52, 0.92, 1.02, 0.1)), mast(-0.6, 1.4)],
    flats: [spanker([[-0.64, 0.48], [-0.64, 1.18], [-1.12, 1.02], [-1.2, 0.48]], -0.64), jib([1.36, 0.5], [0.3, 1.66], [0.82, 0.4]), jib([1.12, 0.46], [0.32, 1.3], [0.76, 0.42])],
    bowsprit: [
      [0.92, 0.28],
      [1.42, 0.5],
    ],
  },
  // A pink: a small square-rigged trader with the fluyt's narrow, pinched stern.
  'ship.pink': {
    hull: hull({ length: 2.3, beam: 0.44, rail: 0.26, castle: 0.26, castleTo: 0.25, sheerBow: 0.09, fullness: 0.8, sternWidth: 0.25, ports: [{ at: 0.7, count: 3 }], paint: TRADER }),
    masts: [
      mast(0.6, 1.5, sq('fore_top', 1.4, 1.0, 0.52, 0.7, 0.08), sq('fore_course', 0.94, 0.48, 0.78, 0.88, 0.1)),
      mast(0, 1.72, sq('main_top', 1.62, 1.1, 0.58, 0.8, 0.08), sq('main_course', 1.04, 0.5, 0.88, 0.98, 0.1)),
      mast(-0.7, 1.2),
    ],
    flats: [lateen(-0.7, 0.12), jib([1.4, 0.56], [0.68, 1.36], [1.0, 0.46])],
    bowsprit: [
      [1.04, 0.3],
      [1.48, 0.58],
    ],
  },
};
