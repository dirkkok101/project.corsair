import { describe, expect, it } from 'vitest';
import { weigh } from '../src/captain';
import type { Situation } from '../src/captain';
import { content } from './fixtures';

const w = content.combat.tactics.utility;
const bold = content.combat.tactics.temperaments.bold!;
const steadfast = content.combat.tactics.temperaments.steadfast!;
/** A fair fight just begun: both whole, crews even, no opening, no gauge. */
const fair: Situation = { hull: 1, crew: 1, menRatio: 1, firepower: 1, theirSails: 100, opening: false, apart: 4, gauge: undefined };

describe("a boarding captain's mind", () => {
  it('with nothing calling, she stalks', () => {
    expect(weigh(fair, bold, w).intent).toBe('stalk');
  });

  it('boards past any one of her thresholds, as before: a crippled rig, more men, or an opening', () => {
    expect(weigh({ ...fair, theirSails: bold.boardBelowSails - 10 }, bold, w).intent).toBe('board');
    expect(weigh({ ...fair, menRatio: bold.boardCrewRatio + 0.2 }, bold, w).intent).toBe('board');
    expect(weigh({ ...fair, opening: true }, bold, w).intent).toBe('board');
    expect(weigh({ ...fair, opening: true }, content.combat.tactics.temperaments.cautious!, w).intent).toBe('stalk');
  });

  it('reasons add up: a rig shot about and a few more men send her in where neither alone would', () => {
    const rig = { ...fair, theirSails: bold.boardBelowSails + 2 };
    const men = { ...fair, menRatio: bold.boardCrewRatio - 0.02 };
    expect(weigh(rig, bold, w).intent).toBe('stalk');
    expect(weigh(men, bold, w).intent).toBe('stalk');
    expect(weigh({ ...rig, menRatio: men.menRatio }, bold, w).intent).toBe('board');
  });

  it('runs when badly hurt, even with an opening: a ship falling apart does not board', () => {
    const mind = weigh({ ...fair, hull: bold.fleeBelowHull - 0.1, opening: true }, bold, w);
    expect(mind.intent).toBe('flee');
    expect(mind.wants.board).toBeLessThan(0.1);
  });

  it('boards only at close quarters: from over the horizon she stalks in, however many more men she has', () => {
    const strong = { ...fair, menRatio: 3, theirSails: 10 };
    expect(weigh({ ...strong, apart: 24 }, bold, w).intent).toBe('stalk');
    expect(weigh({ ...strong, apart: w.close.tiles + 2 }, bold, w).intent).toBe('stalk');
    expect(weigh({ ...strong, apart: w.close.tiles - 2 }, bold, w).intent).toBe('board');
  });

  it('a ship that outguns the other stands and trades broadsides; one outgunned keeps off her bow and stern', () => {
    expect(weigh({ ...fair, firepower: bold.duelOdds + 0.5 }, bold, w).intent).toBe('duel');
    expect(weigh({ ...fair, firepower: 0.5 }, bold, w).intent).toBe('stalk');
    // A gunner stands up to an even match; a bold captain wants better odds before slugging it out.
    const gunner = content.combat.tactics.temperaments.gunner!;
    expect(weigh({ ...fair, firepower: 1.2 }, gunner, w).intent).toBe('duel');
    expect(weigh({ ...fair, firepower: 1.2 }, bold, w).intent).toBe('stalk');
  });

  it('a sure boarding beats a duel; a duel never keeps her from running', () => {
    expect(weigh({ ...fair, firepower: 3, opening: true }, bold, w).intent).toBe('board');
    expect(weigh({ ...fair, firepower: 3, hull: 0.05 }, bold, w).intent).toBe('flee');
  });

  it('a captain who never runs never runs', () => {
    expect(weigh({ ...fair, hull: 0.01, crew: 0.01 }, steadfast, w).intent).not.toBe('flee');
  });

  it('holds to what she is doing until something else is wanted clearly more', () => {
    // Just past her sails threshold she would board; already stalking, a near thing doesn't turn her.
    const near = { ...fair, theirSails: bold.boardBelowSails - 1 };
    expect(weigh(near, bold, w).intent).toBe('board');
    expect(weigh(near, bold, w, 'stalk').intent).toBe('stalk');
    expect(weigh({ ...fair, theirSails: bold.boardBelowSails - 10 }, bold, w, 'stalk').intent).toBe('board');
  });
});
