# 3D style guide: the sea map and sea battles

Decided 2026-10-08: the sea map and sea battles move to 3D, styled after Sid Meier's Pirates! (Firaxis, 2004), in high
resolution for modern hardware. The minimum target is a GeForce RTX 3070 (developed on an Apple M5). Pixel art is no
longer kept for these views. Harbour and port paintings, the sea chart, the minimap and every menu stay 2D.

**Changed 2026-10-09:** the sea, sky and light now aim for the realism of Assassin's Creed IV: Black Flag
(Ubisoft, 2013), replacing the painterly Pirates! sea: a real, rolling sea whose state follows the weather, gentle
swells in fair weather and big breaking seas in a gale. Ships, islands and towns keep their models, lit to match.
Everything else here (camera, proportions, readability, the battle effects) still follows Pirates!. All assets stay
original.

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
  - An even, soft cerulean (about `#5b8fc2` on screen, measured from the footage) with small whitecap flecks,
    no glitter and no mirrored sun.
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
`?sea=plain` draws the bare water for review; add layers back by name: `?sea=plain,flecks` (also `shadows`,
`ripples`, `surf`, `swell`, `clouds`, `wakes`, `waves`). The ocean lab (`/lab.html` on the dev server) shows the sea on its
own off a real island, at every zoom, hour and wind.

- **Sky:** its own slow day, separate from the game clock (about 20 real minutes: a long bright day, golden
  sunrise and sunset, a short moonlit night); the HUD shows the date only in 3D. A painted dome, deep blue
  overhead and pale at the horizon, with a soft sun glow (a physical sky's glare washed out a low camera).
  Clouds drift downwind and show only from afar.
  The weather sets it too (after Black Flag): by the wind's strength where the camera is, and deepest in and
  near a storm, a lid of drifting grey cloud spreads over the sky, the sun fades behind it, the light flattens
  and dims, the horizon closes in, the clouds darken and the sea turns grey-green. It rolls in and clears over
  some seconds; a fight keeps the weather it began in.
  In heavy weather (`storm.ts`): rain slanting down past the camera with the wind (from a strong blow up, heaviest
  in a storm); lightning in storms, a forked bolt down to the sea toward the horizon and a flash that lights the
  whole scene, more often in the storm's heart, with thunder after it, later the further off it struck; and spray
  thrown off ships' bows as they drive into a heavy sea, most when the bow slams down. The lab's `?storm` puts a
  storm over its stand-in.
- **Sea** (`sea/`; how it is drawn: `ocean-renderer.md`), after Black Flag:
  - A real sea of 24 waves running with the wind (Gerstner, crests sharpened), its size set by the weather: a
    gentle swell in light air, a lively sea in a fresh breeze, big rolling seas in a gale. Ships ride it.
  - Lit physically: deep blue-green water, the sky mirrored at grazing angles, the sun's path across it, light
    glowing through the steep crests, a fine chop on top. No speckled glitter: the highlight is kept broad.
  - Whitecaps where crests are sharpest for that sea: rare in a breeze, widespread in a gale, frayed into streaks
    along the wind, and faded out far off before they'd make a speckled pattern.
  - Turquoise shallows round the islands, sand showing through near the beach, white surf on the shore, and broken
    wave lines rolling in across the shallows (strongest on a windward shore).
  - Cloud shadows dim the sun's light on the water as they drift by.
  - The water ships push (`sea/waves.ts`): a wave simulation round the camera, where each hull heaps water at
    her bow and draws a hollow at her stern, so her bow waves and the V of her wake are real ridges of water
    that light with the sea, run into other ships' and fade within a few seconds. Shot falling in the sea, a
    mast over the side and a ship going down throw rings.
- **Islands:**
  - Levels of detail down to a quarter-tile mesh near the camera, smooth between tiles.
  - Generated rolling hills and ridges inland, with the coastline kept where the map has it.
  - Ground painted by height and slope (beach, jungle, grass, tan rock).
  - Instanced palms along the shore and jungle canopy inland.
- **Ships** (`shipyard.ts`, each class's plan in `rigs.ts`):
  - A lofted hull with painted planking, band, wale, gunports and muzzles, and a stern gallery. Weathered to sit
    on the realistic sea: long planks of varied tone with a grain and staggered butt joints, the paint dulled
    unevenly, grime streaked down from the rail and below each port, salt bleaching, a dark wet band and green
    weed at the waterline, a tarred bottom; a normal map for the seams and grain and a roughness map (dry wood
    matte, the wet waterline glossy).
  - The stern gallery's windows (leaded panes in carved, worn gilt frames) glow with lamplight from dusk to dawn.
  - A weathered deck: planks with tarred seams and trenails, worn paler where the crew walk, stained, in relief;
    hatch gratings fore and aft of amidships. Old gilt dulled by salt rather than mirror-bright.
  - Fittings: a carved figurehead on a scrolled bracket with gilt trailboards; rounded quarter galleries with domed
    roofs and drops; deadeyes and chain plates where the shrouds come down; the ship's boat stowed keel-up on
    chocks amidships, a capstan, and the wheel aft.
  - Rigging as tarred rope with thickness, catching the light, not hairlines.
  - Masts with fighting tops, yards, shrouds and stays.
  - Cloth sails that belly with the wind, luff in irons, reef and furl. The canvas has a weave, cloths of
    slightly different bolts with raised seams, soft creases, reef bands and a bolt rope in relief (a normal map),
    greyed toward the foot and stained; only a faint glow of their own, so the sun gives them form.
  - A jib, spanker, gaff or lateen as the class carries.
  - The nation's ensign and a pennant, streaming.
  - Each ship rides the swell smoothly (her pitch and roll eased, averaged over the hull), heels with the wind
    on her beam, and leans outward in a turn (Pirates!: masts well over in a hard turn, upright as she steadies;
    harder the faster she goes).
  - The water she works, drawn as part of the sea's surface (so the swell can never bury it): churned white
    water just aft of her, opening into a V of fine combed streaks, foam along her sides and a bow wave curling
    back from her stem. All of it is whiter the faster she goes. The wake drifts downwind with the water and
    fades out within a few of her lengths, so it never draws a lasting line on the sea.
  - Decks a weathered, oiled reddish brown (a pale deck reads as a tan slab from the overhead camera).
- **Sea battles** (`battle.ts`): fought on the same 3D sea as the map, its positions being world tiles.
  - The two ships at their true size (the map's 1.6x enlargement would leave no sea between them), so they
    trade broadsides across a couple of lengths of water, as in Pirates!.
  - Sails shot through show it: round holes in more and more of the cloth, then the foot torn into rags.
  - Each broadside streams across as a loose spray of small balls on flat arcs (hits land on her rail or sails,
    misses in the sea); chain whirls, grape scatters.
  - A small white puff at each gunport (the ship is never lost in smoke), dark smoke trailing from a hit,
    splashes, splinters, torn canvas, grape sparks.
  - A hurt hull smokes, and below a quarter she burns.
  - Sunk, she settles by the stern and goes under, leaving barrels and men clinging to spars.
  - Every hit lands where the battle placed it (along her length; her side, her deck or her rigging), and
    rigging hits wear down the nearest mast: one shot away cracks with a burst of splinters and comes down over
    her side with its yards, sails and stay, a long splash where it hits the water, leaving a stump. The HUD
    calls it out ("Her foremast goes by the board!") and her card shows the masts still standing.
  - The player's firing arcs on the water, kept light: a faint edge, filled gold only when a broadside is ready.
  - The compass top-left (the wind's red arrow, heading, knots), as at sea.
  - The camera frames both ships, high and oblique, closer as they close; the wheel zooms, C views from astern.
- **Image:** bloom, SMAA and ACES tone mapping.
- **Compass** (HUD, top-right): a gilt rose on a sea-blue face, turned with the view (north-up overhead, her bow up
  from astern), so it matches the sea on screen; the wind a red arrow through it to where it blows, longer and
  bolder the harder it blows; her hull in the middle pointing her way, outlined green at her best point of sail,
  amber pinching or running, red in irons; the heading a gold mark on the rim; speed in knots beneath, the point of
  sail, and a bar for how well the wind fills her sails. Behind the rose, quietly, the speed for every heading and
  the no-go zone on the ring.
- **Camera:** zoomed with the wheel or a trackpad pinch (which never zooms the page); C for the chase view.
- **Not yet:**
  - crew on deck (Pirates!): figures working the ship, so a fight shows what each shot does at a glance:
    grapeshot cuts down men on her deck (fewer figures as her crew falls), chain shot shreds her sails (built),
    round shot holes her hull and knocks out her guns (a gun visibly dismounted where the battle's `gunLoss`
    takes one);
  - bow spray;
  - real town and fort models;
  - mouse clicks on the 3D view (at sea and in battle: left-click steering aims by the 2D camera);
  - the course line;
  - region names on the sea.
