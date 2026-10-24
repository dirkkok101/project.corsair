# The First Voyage: onboarding and the rewards layer (design)

Approved 2026-10-24 from the mockups (Design canvas "Corsair First Voyage", 17 artboards). Grounded in
`../reference/onboarding/` (teach through play: one idea at a time, introduce safely, few words, a reward for every
deed, short / mid / long goals, no cliff where guidance ends).

## 1. What a new captain gets

A new career's third step asks "How well do you know the sea?": **New to these waters** (the First Voyage,
preselected) or **I know these waters** (as the game played before: everything open, no guidance). The voyage is four
short chapters within sight of the home capital, about 25 minutes, taught by one in-world voice, **Ned Tully,
quartermaster** (bust.oldsalt).

| Chapter | Where | Teaches | Ends with |
|---|---|---|---|
| 1 Take the helm | Out of the capital to a nearby cay where a storm wrecked a sloop | steer (A D), more sail (W), the wind (only if she points into it) | Salvage: the good and 4 castaways; deed "First salvage" |
| 2 First prize | A pirate periagua (no great guns) harrying a fishing boat off the cay | the gold arc, a broadside, she strikes, the plunder chest | Deed "First prize taken" (+340 into the chest, +6 men) |
| 3 Home with a prize | The capital: Merchant, Shipwright, Tavern lit, each tagged with its need | sell a cargo, mount a full battery, share out the plunder | Deed "First cargo sold"; the battery full |
| 4 The governor | The governor's office | rank and merit; his commissions | A letter of marque (ceremony); three matters on his desk: carry a letter, run a cargo, hunt a pirate |

Rules: one prompt at a time, 8 words or fewer; buildings not yet needed stand shuttered with a one-line reason;
the first fight can't be lost; everything the player achieves is said out loud by a deed card.

## 2. Architecture

- **The sim owns the voyage** (`Captain.voyage`, saved and deterministic): step machine, the cay, salvage, the
  periagua's spawn and traits, port gating (commands refused too), the free marque, the commission. Systems:
  `systems-economy/src/voyage.ts` (pure helpers: services, orders, salvage units) and
  `systems-traffic/src/voyage.ts` (the system: commands Salvage / ChooseCommission / SkipVoyage, per-tick lessons
  and arrival, event observation). Absent `voyage` = the veteran's game, unchanged.
- **The UI presents it** (`apps/web/src/voyage.tsx`): Ned's lines, prompts and their timing, the orders card, the
  staged port's look, the merchant's focus.
- **Honours** (`Captain.honours`, written by `systems-traffic/src/honours.ts`, an observer): one record per deed
  (kind, past-tense title, the one figure and where it went, up to two lines, progress, next). The UI's `DeedCard`
  draws them in three weights (small at sea, 6 s; standard in port or after a fight, until dismissed; ceremony stays
  the promotion moment), queues new ones, and the log's Deeds page lists them all.
- `?seed=` runs leave the voyage off (every existing test keeps its world); `&voyage=1` turns it on.

## 3. The numbers

Start: 1,000 gold, 10 of 18 guns at 150 each (1,200 to fill). The salvage is sugar, `salvageUnits` the least
amount (at least 20) whose sale at home covers 1.25 x what the battery lacks; 20 casks at Port Royal, Santo
Domingo and Willemstad, a few more at Basse-Terre, which grows it. The periagua: crew 24 (6 volunteers), purse 340,
green, resolve 0, "meek" in battle (strikes the moment she is beaten, never sinks, boards or escapes). Rewards live
in `content/rewards.json` (goal rewards, the big-trade threshold) and the voyage's numbers in `content/voyage.json`.

## 4. The rewards layer (every career, not just the voyage)

- Deed cards for: firsts (salvage, sale, prize), goals done (the first five pay a little gold), mission legs,
  bounties paid, a trade of 500+ profit.
- Courier: a quarter of the reward at delivery (acknowledged there), the rest on return; mission pay goes into the
  **purse** (bounties stay the crew's chest); both legs marked on the chart.
- The HUD: gold changes rise off the purse; notes show in port; a coin's ring on every payment.
- The first goal shown is the first one the purse can pay for.

## 5. Decisions taken

- Start in port (a cold open at sea is a later option). Shutter buildings on the voyage only.
- A peace-time letter of marque for the graduate (French and Dutch careers start at peace in 1660): it covers
  pirates while at peace.
- The governor's first hunt is a sloop, lighter than her match.

## 6. Slices

S1 notes visible in port · S2 mission pay to the purse, the courier advance · S3 courier marked on the chart ·
S4 the reachable first goal · S5 coin sound and gold delta · S6 honours and the deed card, the Deeds page ·
S7 career step 3, the voyage state and the cay, the new letter · S8 chapter 1 harbour and lessons · S9 the cay's
salvage · S10 chapter 2 the first prize · S11 chapter 3 home · S12 chapter 4 the governor and his commissions ·
S13 skip, polish, balance, playtests.

Each slice: vitest for the sim, e2e for what the player sees, and a playtest (screenshots of every new screen,
read as a newcomer would) before the next.

## 7. As built (2026-10-24)

- The cay lies 35 to 50 tiles off (12 to 20 proved a six-second sail: no time for a lesson), off a small island
  where the home waters have one; a wrecked sloop smokes on it. A newcomer steering by eye reaches it in about 20 s
  at the playtest pace, having been shown to steer and set more sail.
- The first prize is a gunless periagua (the Salt Rat) circling a fishing ketch; no one else hunts her until the
  governor has seen her. In battle the lesson follows the aim: steer for her, put your side to her, fire. She strikes
  once hurt (voyage.json meek), in about 20 s of a newcomer's fighting; she can't be kept (she'd only slow the brig).
- Home: each open building tagged with its chore; the merchant opens on one good and one button; the tavern on the
  sailors and their share. The governor gives his letter (the promotion moment at its first rung), then his three
  commissions; the trade run is bought and plotted in one click.
- The first five goals done pay 100 gold each (rewards.json). Every voyage chapter has a vitest and an e2e, and the
  playtests in apps/web/e2e/voyage.spec.ts sail chapters 1 and 2 on the real clock with keys alone.
- The quartermaster can be sent ashore from the log at any time (SkipVoyage): every port opens, his ships leave.

