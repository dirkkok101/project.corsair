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
is faded out with `fwidth` before it gets finer than about two pixels. The sea is **painted in screen colours**:
the shader mixes the measured on-screen colours, then inverts the OutputPass (ACES at the renderer's exposure,
then sRGB) per pixel. So what is painted is what shows, and foam never needs the huge linear values that would
make it flare in the bloom.

| Layer | How | Cost |
|---|---|---|
| Swell | 3 long sines, 9.5, 15 and 26 tiles long and a few hundredths of a tile high, within ±21° of the wind, moving slowly. The same function runs in GLSL and in `ocean.heightAt`, so ships ride what is drawn. It eases toward a new wind and turns about the camera's target, so the water under the camera never jolts. | vertex ALU; a polar grid, 256 segments by about 180 rings |
| Base colour | Cerulean, a brighter shelf and the turquoise apron, by a smoothed shallowness. My own coast texture is built on the CPU from the game's depth texture: the floor height, a smoothed shallowness and the direction to the shore. Its lookups are warped by noise so the one-texel-a-tile grid never shows. | 2 coast taps + 1 noise tap |
| Hammered texture | A tileable dent shading baked at startup into a 512² mipmapped texture, read at two scales, drifting downwind | 2 taps |
| Flecks | The detail texture's fleck channel, stretched about 2.7× along the wind. They show in patches that drift a little slower than the water, so each fleck fades in and out instead of racing. There are more in a blow. | 2 taps |
| Cloud shadows | A large soft gate, at most 6% darker, drifting at `CLOUD_SPEED` as the clouds do | 1 tap |
| Swell light | The swells' slope toward the sun, per pixel. Each swell fades out before its wavelength spans fewer than about 150 px (shorter, and a swell reads as stripes). | ALU |
| Shallows and surf | Only where the floor is shallow: sand showing through, ribbed sand at the beach, a breathing white surf band, and broken wave lines on depth contours that roll shoreward, strongest on a windward shore | +2 taps there |
| Wakes | Ships stamp their trail ribbons and hull quads into a 512² world-space target round the camera's target, sized to the view. The ocean reads it: churned water astern, a V of combed streaks, the bow wave and foam along the hull. Each trail point keeps the pace she passed at, ages out in 4.5 s and drifts downwind. The foam is part of the water surface, so the swell can never bury it. | one small offscreen pass; +1 tap, and +4 inside a wake |
| Water ships push | A wave-equation heightfield (256², an eighth of a tile a cell, 32 tiles round the camera's target) stepped on the GPU at 45 Hz (`sea/waves.ts`, after Crest's dynamic waves and Evan Wallace's WebGL Water). Each hull holds the water to a hump under her bow and a hollow under her stern, higher the faster she goes; moving on, the shape runs off as waves slower than she sails, so the V and her bow waves come out of the water itself and run into other ships' and each other. Shot falling in the sea, a mast over the side and a ship going down throw rings. The grid follows the target in whole cells (the waves stay put in the water), swallows waves at its edges and damps them out within a few seconds. The mesh is lifted by the heights (smoothed, as it's coarser than the grid) and the water lit by their slopes. Ships ride the swell only. | 1–4 small passes a frame; +5 vertex and +4 fragment taps |
| Light | Painted, not reflective, with no specular. The water keeps its hues, takes 20% of the hour's colour and dims to a moonlit blue at night. A little sky colour creeps in toward the horizon, then a mild haze. | ALU |

On open water that is 9 texture reads a pixel, branching for more only over shallows and wakes, with no loops
beyond the three swells.

## Known approximation

`heightAt` gives the full swell everywhere. The mesh fades each swell out where its grid gets coarse (from about
25, 45 and 80 tiles from the camera's target) and on the beach itself. Ships that far off are drawn too small for
the difference to show, and no ship sails on the beach.

## Review

- The lab is `apps/web/lab.html` (dev server). It offers the three zooms (close aboard, sailing, the whole
  region), a battle view, wind and hour controls, layer toggles, and a stand-in ship sailing circles off a real
  island (`?course=straight` sails her in a line). `window.__lab` drives it from scripts.
- In the game, `?renderer=3d` turns the 3D view on, `?sky=<hour>` sets the time of day, and `?sea=plain[,layer…]`
  shows the layers one at a time: `swell`, `ripples` (the hammered texture), `flecks`, `shadows`, `surf`, `wakes` (the painted
  foam), `waves` (the water ships push).
