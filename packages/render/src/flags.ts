// National flags as pixel patterns, at any size: the harbour's flagpole, a ship's masthead and the
// battle view all fly the same colours. Palette colours only, so the day/night filter maps them.

export type FlagNation = 'spain' | 'england' | 'france' | 'netherlands' | 'pirate';

const WHITE = 0xebede9;
const RED = 0xa53030;
const BLUE = 0x253a5e;
const GOLD = 0xe8c170;
const BLACK = 0x090a14;

/** Colour of pixel (x, y) on a w x h flag of a nation. */
export function flagPixel(nation: FlagNation, x: number, y: number, w: number, h: number): number {
  const cx = Math.floor(w / 2);
  const cy = Math.floor(h / 2);
  switch (nation) {
    case 'england': // St George's cross
      return x === cx || (w > 9 && x === cx - 1) || y === cy ? RED : WHITE;
    case 'spain': {
      // Cross of Burgundy: a ragged red saltire on white
      const d = (x / (w - 1)) * (h - 1);
      return Math.abs(y - d) < 0.8 || Math.abs(h - 1 - y - d) < 0.8 ? RED : WHITE;
    }
    case 'france': // Bourbon white with gold lilies (one at small sizes)
      return w > 9 ? (x % 5 === 2 && y % 4 === 2 ? GOLD : WHITE) : x === cx && y === cy ? GOLD : WHITE;
    case 'netherlands': // red, white and blue bands
      return y < h / 3 ? RED : y < (2 * h) / 3 ? WHITE : BLUE;
    case 'pirate': {
      // Black with a white mark: a skull over crossed bones, shrunk to a dot and a bar when small.
      if (w <= 9) return (x === cx && y === cy - 1) || (y === cy + 1 && Math.abs(x - cx) === 1) ? WHITE : BLACK;
      return (x >= cx - 2 && x <= cx && y >= 2 && y <= 4) || (y === h - 3 && (x === cx - 3 || x === cx + 1)) ? WHITE : BLACK;
    }
  }
}

/** The pixels of a flag grouped by colour, so a Graphics can fill each colour once. */
export function flagColours(nation: FlagNation, w: number, h: number): Map<number, [number, number][]> {
  const out = new Map<number, [number, number][]>();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = flagPixel(nation, x, y, w, h);
      if (!out.has(c)) out.set(c, []);
      out.get(c)!.push([x, y]);
    }
  }
  return out;
}
