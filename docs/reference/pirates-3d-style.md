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

All behind `?renderer=3d` (`@corsair/render3d`, Three.js); `?sky=<hour>` sets the sky for review.

- **Sky:** its own slow day, separate from the game clock (about 20 real minutes: a long bright day, golden
  sunrise and sunset, a short moonlit night); the HUD shows the date only in 3D. A painted dome, deep blue
  overhead and pale at the horizon, with a soft sun glow (a physical sky's glare washed out a low camera).
  Clouds drift downwind and show only from afar.
- **Sea:**
  - Calm and painterly: low, long swells, with the fine chop only in the shading.
  - Ripple normals that also show as a soft, low-contrast hammered texture in the water's colour.
  - Flecks of whitecap lying along the wind, coming and going, more in a blow, gathered in gusty patches; three
    sizes so they stay about the same on screen at every zoom (Pirates! has no long wind streaks). Slow and
    faint: each lives about 9 seconds and barely drifts, so the sea shows the wind without flickering or racing.
    Pirates! puts the wind's direction on the compass (a red arrow through the rose) and keeps the sea calm.
  - Cloud shadows: big soft darker patches drifting downwind with the clouds, slowly (half a tile a second).
  - Sun sparkle that fades before it would shimmer; only a faint sheen, so the sea is one even soft blue.
  - Surf bands rolling in along the depth contours, and sand showing through the shallows.
  - The water takes the light's colour; a moonlit sea is greyed a little toward navy, its flecks only a glimmer.
  - Measured against the reference's open sea (hue about 209, saturation 0.52, value 0.76 on screen).
- **Islands:**
  - Levels of detail down to a quarter-tile mesh near the camera, smooth between tiles.
  - Generated rolling hills and ridges inland, with the coastline kept where the map has it.
  - Ground painted by height and slope (beach, jungle, grass, tan rock).
  - Instanced palms along the shore and jungle canopy inland.
- **Ships** (`shipyard.ts`, each class's plan in `rigs.ts`):
  - A lofted hull with painted planking, band, wale, gunports and muzzles, and a stern gallery.
  - Masts with fighting tops, yards, shrouds and stays.
  - Cloth sails that belly with the wind, luff in irons, reef and furl, with a soft glow of their own.
  - A jib, spanker, gaff or lateen as the class carries.
  - The nation's ensign and a pennant, streaming.
  - Each ship rides the swell smoothly (her pitch and roll eased, averaged over the hull) and leaves a wake.
- **Sea battles** (`battle.ts`): fought on the same 3D sea as the map, its positions being world tiles.
  - The two ships, built like any other; sails shot to rags show as less canvas set.
  - Balls in flight on flat arcs (hits land on her rail or sails, misses in the sea); chain whirls, grape scatters.
  - Gunsmoke banks rolling downwind, muzzle flashes, splashes, splinters, torn canvas, grape sparks.
  - A hurt hull smokes, and below a quarter she burns.
  - Sunk, she settles by the stern and goes under, leaving barrels and men clinging to spars.
  - The player's firing arcs on the water, gold when a broadside bears and is loaded.
  - The camera frames both ships, high and oblique, closer as they close; the wheel zooms, C views from astern.
- **Image:** bloom, SMAA and ACES tone mapping.
- **Compass** (HUD, top-right): a gilt rose on a sea-blue face, north-up; the wind a red arrow through it to where
  it blows, longer and bolder the harder it blows; the heading a gold mark on the rim; speed in knots beneath, with
  the point of sail. Behind the rose, quietly, the speed for every heading and the no-go zone on the ring.
- **Camera:** zoomed with the wheel or a trackpad pinch (which never zooms the page); C for the chase view.
- **Not yet:**
  - shot holes in sails and falling masts (the battle doesn't track masts or where a ball struck);
  - bow spray;
  - real town and fort models;
  - mouse clicks on the 3D view (at sea and in battle: left-click steering aims by the 2D camera);
  - the course line;
  - region names on the sea.
