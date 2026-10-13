import type { ContentPack, Settlement } from './index';

/** A small seeded stream of its own (data has no core dependency): the draw moves nothing else in the world. */
function stream(seed: number) {
  let a = (seed ^ 0x6a09e667) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * A career's ports: every port but the classic pirate havens, the havens that always stand (havens.json keep), and
 * one cove drawn from each region's sites, each under a name drawn from the list. Deterministic from the seed, so a
 * resumed career places the same coves; the classic list (content.settlements) stays for the tests.
 */
export function careerSettlements(content: ContentPack, seed: number): Settlement[] {
  const h = content.havens;
  const draw = stream(seed);
  const kept = content.settlements.filter((s) => s.nation !== 'pirate' || h.keep.includes(s.id));
  const regions = [...new Set(h.sites.map((s) => s.region))].sort();
  const names = [...h.names];
  const coves = regions.map((region) => {
    const sites = h.sites.filter((s) => s.region === region);
    const site = sites[Math.floor(draw() * sites.length)]!;
    const name = names.splice(Math.floor(draw() * names.length), 1)[0]!;
    return { id: `haven.${site.id}`, name, nation: 'pirate' as const, type: 'haven' as const, size: 'hamlet' as const, lon: site.lon, lat: site.lat };
  });
  return [...kept, ...coves];
}
