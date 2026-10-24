import type { Command, Voyage } from '@corsair/core';

// The First Voyage's port (docs/design/first-voyage.md): a building opens as she needs it. The rest stand shuttered,
// and what would be done in them is refused, so the sim and the screen agree.

export type PortService = 'merchant' | 'tavern' | 'governor' | 'shipwright';

const ALL: PortService[] = ['merchant', 'tavern', 'governor', 'shipwright'];
/** The buildings open at each step: none before she has something to bring them, then three, then the governor. */
const OPEN: Record<Voyage['step'], PortService[]> = {
  harbour: [],
  helm: [],
  salvage: [],
  prize: [],
  home: ['merchant', 'shipwright', 'tavern'],
  governor: ALL,
  done: ALL,
};

/** The building each port command is done in. */
const SERVICE: Partial<Record<Command['type'], PortService>> = {
  Buy: 'merchant',
  Sell: 'merchant',
  BuyGuns: 'shipwright',
  SellGuns: 'shipwright',
  Repair: 'shipwright',
  Careen: 'shipwright',
  BuyUpgrade: 'shipwright',
  BuyShip: 'shipwright',
  SellShip: 'shipwright',
  MakeFlagship: 'shipwright',
  ReclaimShip: 'shipwright',
  Recruit: 'tavern',
  DividePlunder: 'tavern',
  PayWages: 'tavern',
  BuyMapPiece: 'tavern',
  BuyMarque: 'governor',
  CollectBounties: 'governor',
  AcceptMission: 'governor',
  CallOnGovernor: 'governor',
};

/** Whether a building is open to her (always, off the voyage). */
export function voyageOpen(voyage: Voyage | undefined, service: PortService): boolean {
  return !voyage || OPEN[voyage.step].includes(service);
}

/** The shuttered building a command would be done in, if the voyage has it shut. */
export function voyageShut(voyage: Voyage | undefined, command: Command): PortService | undefined {
  const service = SERVICE[command.type];
  return service && !voyageOpen(voyage, service) ? service : undefined;
}
