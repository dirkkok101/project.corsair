# Governor missions

**Slice 1 built 2026-10-23** (hunt and courier; decisions: soft lapse, no penalty; paid into the chest by the
governor who gave it). Code: `packages/systems-traffic/src/missions.ts`, terms in `politics.json` `missions`. Asked for after play: with the brig fitted out to the maximum through trading
and fighting, there was nothing left to do. Missions give the mid-career a reason to sail somewhere and someone to
fight, and they feed the rank ladder that is already built.

Sources: Pirates! 2004 governors give escort and capture missions, untimed, with no penalty for failing, and a
mission can bring "immediate promotion or at least several steps" (`reference/career-progression-in-games.md`
1.4, 1.6). The game-loops doc calls the governor the thinnest service and the most valuable next build for the port
(`reference/corsair-game-loops.md` §6), and says the world's danger falls off a cliff once the player is strong
(cross-loop finding 3). `design/combat-model.md` 8.3 gates missions on the rank ladder.

## 1. The shape

- **One offer at a time, from the governor.** It fills the storyboard's offer slot on the governor screen (2.8): his
  bust says it, the card says what it pays and what it asks, and the buttons are **Accept** and **Not now**. The offer
  is kept in the state per governor so "Not now" doesn't reroll it; a new one comes the next week.
- **Several open at once.** Up to three missions open (Pirates!: three or four threads on screen). No accept beyond
  three; the governor says so.
- **Untimed in feel, with a soft lapse.** No penalty for failing. A mission lapses after ten weeks (the news
  window bounties already use): the target leaves the sea, the letter is no longer wanted, and a log line says so.
- **Pays to the chest, and in merit.** The reward goes into the plunder chest like a bounty, plus merit with the
  governor's nation (several steps at once, so a mission is the quick way up the ladder) and standing.
- **Who gets offers.** Any captain the governor receives (standing above -30). Missions against another nation's
  ships need his letter of marque, so a captain without one is offered only the pirate and courier work, and the
  letter's own offer says "take the letter and I'll have work for you against Spain".

## 2. Mission types

| Type | He says | Done when | Reward (first cut) | Builds on |
|---|---|---|---|---|
| **Hunt** | "The pirate war sloop Adventure has been taking our ships off Puerto Príncipe. Find her, and sink or take her." | Her ship sunk, struck or boarded (`BattleEnded` on her) | 15% of her class's price (at least 400), 4 merit and standing, plus the pirate's bounty | A named pirate tagged `ai.mission`, sailing from the haven nearest her waters, in the class nearest the flagship's strength × 1.1 |
| **Raid** (at war only) | "Spain's trade feeds Santiago. Take three of her ships." | N ships of the enemy nation sunk or taken, anywhere | 300 a ship, 2 merit a ship | A counter on `BattleOver`'s nation; nothing to spawn |
| **Courier** | "Carry this letter to the governor of Bridgetown, and bring me back his reply." | His reply brought home (`CallOnGovernor` there, then back at the giver's) | 0.8 gold a tile each way, at least 200; 1 merit | Nothing new at sea |
| **Escort** (later) | "The fluyt Good Hope sails for Curaçao. See her in." | She docks there while you're in company | By distance and danger | New AI: a ship that keeps company with the player |

The hunt is the mid-career fix: the target is matched to the player's ship, so a fully armed brig is sent after a
pirate in a sloop of war or a frigate, not a periagua. Escort is the biggest build (no AI keeps company with the
player today, and the player's own consorts are off the map), so it is a later slice.

## 3. At sea: what you're doing

Most play is at sea, so the open missions show there, not only in port.

- **The goal pill shows the nearest open mission** when there is one ("Hunt Jan Kuyper · off Isla de Pinos"), and
  the career goal otherwise. One pill, not two.
- **The chart marks it.** A hunt's last-seen area as a ring (like a hoard's), a courier's port as a pin, with
  "Plot a course".
- **Sail ho! names her.** "Sail ho! The pirate Jan Kuyper, the one Port Royal wants."
- **A toast when it's done**: "Jan Kuyper is beaten. The governor of Port Royal will pay 1,200."
- **The log's Goals page** lists the open missions above the career goals, with where, what's left and Plot.

## 4. Build notes

- Home: `packages/systems-traffic/src/missions.ts` beside `goals.ts`; traffic owns spawning and `BattleEnded`.
- State: `WorldState.missions` (open ones) and an offer per governor; `ai.mission` tags a hunt's target. New fields
  optional; no migration.
- The hunt's target is kept from the daily top-up and the staged-ship cleanup, roams near the stated area, and if
  another ship sinks her first the mission ends with a log line (the governor pays nothing; nobody is out of pocket).
- Payment: completed missions are paid when the captain next calls on that governor, like bounties, through the
  existing bounty card ("Bounties and missions owed").

## 5. Slices

1. **Hunt and courier**: offers, accept, open-missions state, the hunt target, completion and payment, the goal
   pill, the chart ring and pin, Sail ho!, the log page.
2. **Raid**, once a war is on (exercises war with Spain, untested in play).
3. **Escort**, with the new keep-company AI.
