# The 3D sea: how it is drawn

Rebuilt 2026-10-09 (the second time that day): the painterly Pirates! sea gave way to a realistic one after
Assassin's Creed IV: Black Flag. The sea's state follows the weather; everything on it still moves coherently with
the wind, and nothing finer than a few pixels is drawn (no shimmer).

## Technique

All on one camera-following polar mesh (`sea/ocean.ts`) and its shaders, lit in linear light like the rest of the
scene.

| Layer | How | Cost |
|---|---|---|
| Waves | 24 Gerstner waves, lengths spread on a log scale from 1.4 times the peak down to a twelfth of it, within ±55° of the wind, alternating sides so no two run parallel (their crests would line up into stripes). Height in proportion to length up to the peak (each about as steep as the next, as in a real sea), falling off above it. The sea state by wind strength `s`: peak length 3.5 + 10 s² tiles, significant height 0.04 + 0.62 s³ tiles, choppiness 0.45 + 0.35 s. Phase speed from deep-water dispersion (g ≈ 0.98 tiles/s², a tile about ten metres) at 0.75 pace. The mesh rolls a wave only where its grid has six points to the wavelength; the fragment shader lights every wave, each fading before it spans too few pixels. `ocean.heightAt` inverts the horizontal push (two refinement steps), so ships ride what is drawn. The sea eases toward a new wind and turns about the camera's target, so the water there never jolts. | vertex ALU; 24 waves |
| Fine chop | A tiling normal map baked at startup (`chopTexture`: 96 small waves with whole-number wavevectors, mostly near the wind), read at two scales drifting downwind, stronger in a blow; mipmapped, so it flattens with distance instead of sparkling | 2 taps |
| Lighting | Fresnel (Schlick, F0 0.02) mirrors a horizon-to-zenith sky; the water's body is a deep blue-green lit by the sky's ambient and the sun by the slope's tilt to it; a green-turquoise glow through the steep crests, most looking toward the sun; a broad, energy-normalised sun highlight (kept broad: a sharp one breaks into flickering specks) | ALU |
| Whitecaps | Where a crest's sharpness (the Gerstner Jacobian) stands far above the local spread of the waves (measured in standard deviations, so it holds at every zoom): about 2.6σ in a fresh breeze, 1.5σ in a gale. Frayed by two fine noise scales into streaks along the wind; faded out once a pixel spans over about a tenth of a tile | 3 taps |
| Cloud shadows | Large soft patches that dim the sun's light on the water, drifting at `CLOUD_SPEED` as the clouds do | 1 tap |
| Shallows and surf | Only where the floor is shallow: turquoise water, sand showing through, a breathing white surf band, broken wave lines on depth contours that roll shoreward, strongest on a windward shore. The game's depth texture is redone on the CPU (`coastTexture`) into the floor height, a smoothed shallowness and the direction to the shore | +2 taps there |
| Wakes | Ships stamp trail ribbons and hull quads into a world-space target round the camera's target (`sea/wakes.ts`). The ocean reads it: wavelets on the V's arms, churned foam fixed in the water where she left it, breaking crests, white water at the hull | one small offscreen pass; +1 tap, +4 inside a wake |
| Water ships push | A wave-equation heightfield (256², an eighth of a tile a cell, 32 tiles round the camera's target) stepped on the GPU at 45 Hz (`sea/waves.ts`, after Crest's dynamic waves and Evan Wallace's WebGL Water). Each hull holds a hump at her bow and a hollow at her stern; moving on, the shape runs off as waves, so bow waves and the wake's V come from the water itself. Shot falling in the sea, a mast over the side and a ship going down throw rings. The mesh is lifted by the heights and lit by their slopes. Ships ride the Gerstner sea only | 1–4 small passes a frame; +5 vertex and +4 fragment taps |
| Foam | Simulated in the same grid as the water ships push (after Sea of Thieves' and Crest's foam buffers): each step a hull churns white water at her waterline (most at the bow) and just astern, and steep crests of the pushed water break white; it spreads a little and fades where it was left, its freshness fading faster. Drawn as white lace from two fine noise scales: fresh foam dense and finely broken, old foam a thin net, never a solid slab. Beyond the grid (far zooms) the painted wake stands in | +1 tap, +2 inside foam |
| Haze | A squared-exponential fog toward the horizon in the sky's colour | ALU |

## Known approximation

`heightAt` gives every wave everywhere. The mesh fades the shorter waves out where its grid gets coarse, and all
of them on the beach itself. Ships that far off are drawn too small for the difference to show, and no ship sails
on the beach. Ships don't rock on the water other ships push.

## Review

- The lab is `apps/web/lab.html` (dev server). It offers the three zooms (close aboard, sailing, the whole
  region), a battle view, wind and hour controls, layer toggles, and a stand-in ship sailing circles off a real
  island (`?course=straight` sails her in a line). `window.__lab` drives it from scripts.
- In the game (always 3D), `?sky=<hour>` sets the time of day, and `?sea=plain[,layer…]`
  shows the layers one at a time: `swell` (the waves), `ripples` (the fine chop), `flecks` (whitecaps), `shadows`,
  `surf`, `wakes` (the foam), `waves` (the water ships push).
