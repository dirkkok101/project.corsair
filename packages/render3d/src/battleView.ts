import type { Wind } from '@corsair/core';

// What the 3D view draws of a sea battle: structural types, so the renderer stays free of the battle module.

export interface BattleViewShip {
  x: number;
  y: number;
  headingDeg: number;
  classId: string;
  sails: 'full' | 'half' | 'furled';
  /** Tiles a second, for her wake. */
  speed?: number;
  /** Her state, drawn: sails shot to rags show as less canvas set, a hurt hull smokes and then burns. */
  sailCondition?: number;
  hull?: number;
  hullMax?: number;
  /** Each mast's strength, fore to aft (0: gone by the board). */
  masts?: number[];
  /** Her men aboard, and her guns still mounted. */
  crew?: number;
  guns?: number;
  /** Seconds until each broadside is loaded again. */
  reload?: { port: number; starboard: number };
  /** Her shipwright's fit (upgrades.json ids), drawn on her. */
  upgrades?: string[];
}
/** Where a ball struck her: along her length (bow positive, -0.5 .. 0.5), in what, how high and how far out (tiles). */
export interface BattleViewPlace {
  along: number;
  part: 'hull' | 'rigging' | 'deck';
  up?: number;
  across?: number;
  /** A raking shot, down her length. */
  rake?: boolean;
}
export interface BattleViewState {
  tick: number;
  wind: Wind;
  ships: { player: BattleViewShip; enemy: BattleViewShip };
  /** Balls in flight; `hit` ones end on her (the 3D view lands them on her rail or sails, misses in the sea). */
  /** Balls in flight, one a gun: where each is now (x, y, height in tiles), from its gun toward its aim point. */
  shots: { x: number; y: number; tx: number; ty: number; t: number; flight: number; ammo?: 'round' | 'chain' | 'grape'; at?: [number, number, number] }[];
  /** A hit's ship and place on her; a mast going by the board, which and the way it fell. */
  effects: {
    kind: 'smoke' | 'splash' | 'hit' | 'sail' | 'grape' | 'mast';
    x: number;
    y: number;
    at: number;
    ship?: 'player' | 'enemy';
    place?: BattleViewPlace;
    mast?: number;
    towardDeg?: number;
  }[];
  /** The player's firing arcs: degrees either side of each beam, reach in tiles for the shot loaded, and
   * whether each broadside can fire now (as the battle's aim reports it). */
  arcs?: { arcDeg: number; rangeTiles: number; port: string; starboard: string };
  /** She has gone down: barrels and men in the water where she sank. */
  wreck?: { barrels: { x: number; y: number }[]; survivors: { x: number; y: number; men: number }[] };
}
