# 3D style guide: the sea map and sea battles

Decided 2026-10-08: the sea map and sea battles move to 3D, styled after Sid Meier's Pirates! (Firaxis, 2004), in high
resolution for modern hardware. The minimum target is a GeForce RTX 3070 (developed on an Apple M5). Pixel art is no
longer kept for these views. Harbour and port paintings, the sea chart, the minimap and every menu stay 2D.

The references are the user's Pirates! (2004) screenshots (sea map close and wide, the Straits overview, several
broadsides, an explosion) and the 1987 MicroProse map "The Spanish Main 1560-1700". Save new reference images to
`docs/reference/pirates-2004/` so later work can be compared against them.

## What Pirates! did (research)

- Engine: Gamebryo (PC, November 2004). It was built to run on 2004 hardware, even without shaders.
- Art direction (co-lead artist Marc Hudgins): romantic rather than realistic; Errol Flynn films, illustrated books,
  Technicolor; "painterly, solid and simple"; aqua seas, fluffy white clouds, rocking galleons.
- Sea map:
  - an overhead camera centred on the ship, zoomed with the mouse wheel from close in to a wide stretch of sea, plus a
    chase view;
  - town names over the towns, and forts sized by a town's strength;
  - clouds that drift downwind and show the wind (white is stronger wind, dark is a storm), with an exact wind gauge;
  - AI ships visibly sailing from port to port.
- Sea battles:
  - a high top-down camera that zooms itself to keep both ships in view;
  - the arena is a scaled-up copy of the stretch of map where the fight began, coastline included, with positions and
    wind carried over;
  - torn sails and a smoking hull show damage; barrels and crew float after a sinking; ramming to board cuts to a
    close-up.
- Criticised: slow, "floaty" cannonballs that could be dodged, which made fights repetitive. The best-known mod sped
  them up. Keep our shots fast.

Sources and the full notes are in the research summary in the 3D planning conversation; wiki pages:
<https://sidmeierspirates.fandom.com/wiki/Naval_Combat>, <https://sidmeierspirates.fandom.com/wiki/Sailing_Map>,
<https://sidmeierspirates.fandom.com/wiki/Wind>.

## The look, from the references

- **Sea:**
  - Saturated cerulean (about `#1a6cb5`) with fine sun sparkle all over it, not a mirrored sun.
  - Wide turquoise bands over the shallows (about `#2fd0cf`).
  - White, streaky foam that follows the coast's contours.
  - Long white wind streaks across open water.
- **Islands:**
  - Soft white beaches fading into the turquoise.
  - Lush, rounded green hills with patches of bare tan rock.
  - Palm trees on the beaches and headlands.
  - Red-roofed white towns on the shore.
- **Ships:**
  - Big against the islands; at the default zoom a ship is about a tenth of the screen's width.
  - Glowing white sails (a soft bloom), golden-brown hulls, big flags and long streaming pennants.
  - Long thin wakes.
  - Heeling and pitching with the sea.
- **Camera:** looking down at about 45 to 55 degrees on the sea map and somewhat closer in battle, always north-up
  unless the chase view is on.
- **Lettering:**
  - Region names written faintly across the sea in large serif type ("Straits"): take them from the 1987 map, for
    example the Caribbean Sea, Windward Passage, Old Bahama Strait, the Spanish Main, Florida Channel.
  - Town names in white serif over the towns.
- **Battles:**
  - Black cannonballs visible in flight.
  - White puffs of gun smoke; orange explosions.
  - Debris and crew in the water; smoke trailing from a damaged hull.
  - Sails torn where shot struck, masts that can fall.
- **Light:**
  - Bright and high-key by day, warm at dusk.
  - A moonlit blue night that stays readable.

## Built so far

- **Slice 1, the spike** (`?renderer=3d`, `@corsair/render3d`, Three.js):
  - the sea (swells rolling downwind, depth-tinted shallows, surf along the coasts, sparkle);
  - islands raised from the map's elevation bands;
  - stand-in towns with names;
  - clouds drifting downwind, shown only from afar;
  - the sun's arc and a moonlit night;
  - every ship on the map, using the existing low-poly class models (`tools/art/export_ships_glb.py`), each riding the
    swell, heeling to the wind and showing her sail state;
  - a camera zoomed with the mouse wheel and switched to a chase view with C.
- **Not yet:**
  - HD ships and the battle in 3D;
  - wakes and palms;
  - mouse clicks on the 3D view;
  - the course line;
  - region names on the sea.
