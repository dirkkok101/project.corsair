# The 3D sea: how it is drawn

Rebuilt 2026-10-09 to replace the first 3D ocean. The aim: the sea map and sea battles of Sid Meier's Pirates!
(2004), in HD. Bright, painterly, even, calm water that reads at every zoom. Everything on it moves slowly and
the wind's way.

## What the footage shows (measured)

The frames came from the user's review videos, studied locally and not committed. "On screen" means sRGB.

| Where | On screen | Notes |
|---|---|---|
| Open sea, sailing zoom | hue 208–212, sat 0.52–0.53, val 0.75–0.79 | luminance std-dev only 0.017 over a 500x250 px patch |
| Open sea, battle (overcast) | hue 191–199, sat 0.41–0.54, val 0.56–0.68 | the sea takes the weather's tint |
| Shallows apron | about hue 180, sat 0.41, val 0.84 | sand shows through, getting paler toward the beach |
| Frame-to-frame (1 s, camera following) | mean abs diff 2.3/255 in open water | nothing in the sea moves fast |

- **Open sea:** one soft cerulean. It has a fine, low-contrast "hammered" dimpling at about a third of a tile and
  small pale whitecap flecks drawn out along the wind. A few large, very soft darker blotches drift through it.
  There is no glitter and no sun reflection.
- **Shallows:** a wide turquoise apron round every island, paler and sandier toward the beach. White surf sits
  on the shore, and soft broken lines lie across the shallows, parallel to the coast.
- **Wakes:** white water at the bow and foam along the hull. Behind the ship, fine combed white streaks fan into
  a narrow V (about 15° each side). They thin and fade within a few ship lengths.

## Technique

All the detail lives in one fragment shader on one camera-following mesh. Every pattern finer than the mesh is
either a **mipmapped texture** (the GPU filters it at distance, so nothing aliases into stripes or shimmers) or
is faded out with `fwidth` before it gets finer than about two pixels.

| Layer | How | Cost |
|---|---|---|
| Swell | 3 long sines, 14–40 tiles long, a few hundredths of a tile high, within ±20° of the wind, slow. They are the same function in GLSL and TS (`seaHeight`), so ships ride exactly what is drawn. Their amplitude fades out where the grid gets coarse. | vertex ALU; a polar grid of 256 × 180 vertices |
| Base colour | Authored as on-screen sRGB targets and inverted through the pipeline's ACES and exposure once, on the CPU, so the measured colour is what appears | ALU |
| Shallows | My own coast texture, built on the CPU from the depth texture: a smoothed floor height, a halo, and the direction to the shore. Bicubic sampling, plus a little noise warp so tile texels never show. The ramp runs from cerulean through turquoise to sand. | 1 texture (4 bilinear taps) |
| Hammered texture | A tileable dimple shading baked at startup into a 512² mipmapped texture, two scales, both drifting downwind | 2 taps |
| Flecks | The same texture's fleck channel, stretched along the wind and shown in patches by a slow, large gate, so flecks come and go instead of racing | shares the taps above + 1 |
| Cloud shadows | A large soft gate, a few percent darker, drifting at `CLOUD_SPEED`, as the clouds do | shares the gate tap |
| Surf and wave lines | A white band at the shoreline, and contour lines of depth that drift shoreward on the windward side. They are broken by noise and faded by `fwidth`. | ALU |
| Wakes | Ships stamp their wake ribbons (the V, the stern track, the bow wave and hull foam) into a world-space render target round the camera target. They are redrawn from each ship's trail every frame. The trail points age out (gone in about 8 s) and drift downwind. The ocean shader reads the target and draws the combed streaks from its across-the-wake coordinate. The foam is part of the water surface, so it can never be buried by the swell. | one small offscreen pass + 1 tap |
| Light | The water is painted, not reflective: its colour is scaled by the hour's sun, sky and day level, and has no specular. A mild fog meets the sky at the horizon in the chase view. | ALU |

About 9 texture taps a pixel, with no loops in the fragment shader. One offscreen pass of a few dozen triangles.

## Review

- The lab is `apps/web/lab.html` (dev server). It offers the three zooms (close aboard, sailing, the whole
  region), a battle view, wind and hour controls, layer toggles, and a stand-in ship sailing circles off a real
  island. `window.__lab` drives it from scripts.
- In the game, `?renderer=3d` turns the 3D view on, `?sky=<hour>` sets the time of day, and `?sea=plain[,layer…]`
  shows the layers one at a time: `swell`, `ripples` (the hammered texture), `flecks`, `shadows`, `surf`, `wakes`.
