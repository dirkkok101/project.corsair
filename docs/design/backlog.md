# Backlog

Player-raised items waiting for a slice, newest first. Each line says what was asked and why.

## From play, 2026-10-23

Dirk had upgraded the brig to the max through trading and fighting and then had nothing left to do. Governor
missions came first (slice 1, hunt and courier, built 2026-10-23: `governor-missions.md`), and they show on the
sea HUD's goal pill, the log and the chart. Still to come:

- **The ocean view says what is happening.** Most play time is at sea, so the open objectives, missions and news
  belong on the sea HUD, not only in the log or in port.
- **Ship against port.** Attack a town's fort from the sea (PRD §8, §9.3; scene S4).
- **Try war with Spain as England.** Play has mostly been pirate hunting; war against a nation is untested in play.

## Done

- **Show the whole fleet at sea** (2026-10-23). Each captain's consorts sail with him on the ocean view, the player's included,
  instead of only the flagship. Drawn in line astern on the flagship's track (`render3d/src/consorts.ts`): the player's fleet and a pirate's prizes in tow.
- **A bigger chart** (2026-10-23). The chart opens close about her ship, zooms (wheel, pinch, + and -) and pans (drag).
- **Routes with days at sea and food** (2026-10-23). A port's card and the course on the sea say the days at sea by
  the lanes and whether the food aboard lasts them.
