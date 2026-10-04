export type WindStrength = 'calm' | 'light' | 'fresh' | 'strong' | 'gale';

/** Helm: -1 = turn to port (anticlockwise), 0 = hold course, 1 = turn to starboard. */
export type Helm = -1 | 0 | 1;

/** How much canvas is set (PRD section 4 sail state). */
export type SailSetting = 'furled' | 'half' | 'full';

export interface Wind {
  /** Direction the wind blows FROM, degrees clockwise from north (sailing convention). */
  fromDeg: number;
  strength: WindStrength;
}

export interface Ship {
  id: string;
  classId: string;
  /** Position in map tiles; y grows southward. */
  x: number;
  y: number;
  /** Degrees clockwise from north, matching sprite facing f00. */
  headingDeg: number;
  /** Tiles per second. */
  speed: number;
  helm: Helm;
  sails: SailSetting;
  /** True while the ship is pressed against land, so ShipBlocked fires once per contact. */
  blocked: boolean;
}

export interface WorldState {
  tick: number;
  wind: Wind;
  ships: Record<string, Ship>;
}

export type Command =
  | { type: 'SetHelm'; shipId: string; helm: Helm }
  | { type: 'SetSails'; shipId: string; sails: SailSetting }
  | { type: 'SetWind'; fromDeg: number; strength: WindStrength };

export interface GameEvent {
  tick: number;
  type: string;
  system: string;
  entityIds: string[];
  payload: Record<string, unknown>;
}
