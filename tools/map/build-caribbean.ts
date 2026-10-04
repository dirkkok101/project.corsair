// Builds the Caribbean map layers (PRD section 3) from real elevation and bathymetry.
//
// Source: AWS Terrain Tiles, Terrarium encoding (https://registry.opendata.aws/terrain-tiles/),
// which merge NOAA ETOPO1, NASA SRTM, USGS GMTED and other public datasets. Tiles are cached in
// tools/map/.cache, so reruns are offline.
//
// Run from the repo root: node tools/map/build-caribbean.ts
import { decode, encode } from 'fast-png';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..');
const OUT = join(ROOT, 'packages/data/content/maps/caribbean');
const CACHE = join(import.meta.dirname, '.cache', 'terrarium');
const map = JSON.parse(readFileSync(join(OUT, 'map.json'), 'utf8'));
const { width: W, height: H, bounds } = map as {
  width: number;
  height: number;
  bounds: { lonMin: number; lonMax: number; latMin: number; latMax: number };
};

// Classification thresholds, metres. Tuned so the Bahama Banks read as shallows while the
// Campeche Bank (30-200 m) stays open water for deep-draft ships.
const CONFIG = {
  zoom: 7,
  samplesPerAxis: 3,
  landFraction: 5 / 9,
  shallowsAboveDepth: -15,
  hillsAbove: 250,
  mountainAbove: 800,
  elevationBands: [0, 50, 150, 300, 600, 1000, 1500, 2200], // band i starts at this height
};

// Indices must match `Tile` in packages/data/src/tilemap.ts; colours are corsair.gpl, for viewing only.
const TERRAIN = [
  { id: 'deep', rgb: [60, 94, 139] },
  { id: 'shallow', rgb: [79, 143, 186] },
  { id: 'beach', rgb: [215, 181, 148] },
  { id: 'jungle', rgb: [70, 130, 50] },
  { id: 'hills', rgb: [117, 167, 67] },
  { id: 'mountain', rgb: [129, 151, 150] },
] as const;
const T = Object.fromEntries(TERRAIN.map((t, i) => [t.id, i])) as Record<(typeof TERRAIN)[number]['id'], number>;

const n = 2 ** CONFIG.zoom;
const mercX = (lon: number) => ((lon + 180) / 360) * 256 * n;
const mercY = (lat: number) => ((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * 256 * n;

async function fetchTile(x: number, y: number): Promise<Uint8Array> {
  const file = join(CACHE, String(CONFIG.zoom), String(x), `${y}.png`);
  if (!existsSync(file)) {
    const url = `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${CONFIG.zoom}/${x}/${y}.png`;
    for (let attempt = 1; ; attempt++) {
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`${res.status} ${url}`);
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, new Uint8Array(await res.arrayBuffer()));
        break;
      } catch (err) {
        if (attempt >= 4) throw err;
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }
  }
  return decode(readFileSync(file)).data as Uint8Array;
}

// Download every source tile the map covers, a few at a time.
const x0 = Math.floor(mercX(bounds.lonMin) / 256);
const x1 = Math.floor(mercX(bounds.lonMax) / 256);
const y0 = Math.floor(mercY(bounds.latMax) / 256);
const y1 = Math.floor(mercY(bounds.latMin) / 256);
const tiles = new Map<string, Uint8Array>();
const jobs: [number, number][] = [];
for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) jobs.push([x, y]);
console.log(`source tiles: ${jobs.length} at z${CONFIG.zoom}`);
for (let i = 0; i < jobs.length; i += 8) {
  await Promise.all(jobs.slice(i, i + 8).map(async ([x, y]) => tiles.set(`${x},${y}`, await fetchTile(x, y))));
}

function heightAt(lon: number, lat: number): number {
  const px = Math.floor(mercX(lon));
  const py = Math.floor(mercY(lat));
  const data = tiles.get(`${px >> 8},${py >> 8}`)!;
  const i = ((py & 255) * 256 + (px & 255)) * 3;
  return data[i]! * 256 + data[i + 1]! + data[i + 2]! / 256 - 32768;
}

// Sample each map tile on a small grid: land/water by majority, depth and height by mean.
const dLon = (bounds.lonMax - bounds.lonMin) / W;
const dLat = (bounds.latMax - bounds.latMin) / H;
const land = new Uint8Array(W * H);
const depth = new Float32Array(W * H);
const height = new Float32Array(W * H);
const s = CONFIG.samplesPerAxis;
for (let ty = 0; ty < H; ty++) {
  for (let tx = 0; tx < W; tx++) {
    let landCount = 0;
    let landSum = 0;
    let waterSum = 0;
    for (let sy = 0; sy < s; sy++) {
      for (let sx = 0; sx < s; sx++) {
        const h = heightAt(bounds.lonMin + (tx + (sx + 0.5) / s) * dLon, bounds.latMax - (ty + (sy + 0.5) / s) * dLat);
        if (h > 0) {
          landCount++;
          landSum += h;
        } else waterSum += h;
      }
    }
    const i = ty * W + tx;
    land[i] = landCount / (s * s) >= CONFIG.landFraction ? 1 : 0;
    height[i] = landCount ? landSum / landCount : 0;
    depth[i] = landCount < s * s ? waterSum / (s * s - landCount) : 0;
  }
}

const isLand = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && land[y * W + x] === 1;
const touches = (x: number, y: number, want: boolean) =>
  [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ].some(([dx, dy]) => {
    const nx = x + dx!;
    const ny = y + dy!;
    return nx >= 0 && ny >= 0 && nx < W && ny < H && isLand(nx, ny) === want;
  });

const terrain = new Uint8Array(W * H);
const elevation = new Uint8Array(W * H);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = y * W + x;
    if (!land[i]) {
      terrain[i] = depth[i]! > CONFIG.shallowsAboveDepth || touches(x, y, true) ? T.shallow : T.deep;
      continue;
    }
    const h = height[i]!;
    elevation[i] = CONFIG.elevationBands.filter((b) => h >= b).length - 1;
    if (touches(x, y, false)) terrain[i] = T.beach;
    else if (h >= CONFIG.mountainAbove) terrain[i] = T.mountain;
    else if (h >= CONFIG.hillsAbove) terrain[i] = T.hills;
    else terrain[i] = T.jungle;
  }
}

const palette = TERRAIN.map((t) => [...t.rgb]);
writeFileSync(join(OUT, 'terrain.png'), encode({ width: W, height: H, data: terrain, depth: 8, channels: 1, palette }));
writeFileSync(join(OUT, 'elevation.png'), encode({ width: W, height: H, data: elevation, depth: 8, channels: 1 }));

// Wind zones: index 0 is the default zone, i + 1 is zones[i]; the first listed zone wins overlaps.
const zonesFile = join(OUT, 'wind_zones.json');
if (existsSync(zonesFile)) {
  const { zones } = JSON.parse(readFileSync(zonesFile, 'utf8')) as { zones: { polygon: [number, number][] }[] };
  const inside = (poly: [number, number][], lon: number, lat: number) => {
    let hit = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i]!;
      const [xj, yj] = poly[j]!;
      if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
  };
  const zoneGrid = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const lon = bounds.lonMin + (x + 0.5) * dLon;
      const lat = bounds.latMax - (y + 0.5) * dLat;
      const z = zones.findIndex((zone) => inside(zone.polygon, lon, lat));
      zoneGrid[y * W + x] = z + 1;
    }
  }
  writeFileSync(join(OUT, 'zones.png'), encode({ width: W, height: H, data: zoneGrid, depth: 8, channels: 1 }));
}

const counts = TERRAIN.map((t, i) => `${t.id} ${terrain.filter((v) => v === i).length}`);
console.log(`terrain ${W}x${H}: ${counts.join(', ')}${existsSync(zonesFile) ? '; zones written' : '; no wind_zones.json yet'}`);
