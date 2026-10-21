// The flags ships fly, drawn as their makers painted and sewed them about 1660. Each device is a vector path of our own
// (studied from the period flags and the pirate flags of the early 1700s, copied from none), painted onto wool bunting:
// the paint catches the light at its top and dulls below, the bunting shows its weave and the seams between its
// strips, the linen tape at the hoist holds the toggles, and the fly frays (a pirate's into tatters).

/** The flag's cloth, in canvas pixels: half again as long as it is deep, near enough the period's 3:2 to 2:1. */
export const FLAG_W = 512;
export const FLAG_H = 320;

/** A famous pirate's own flag (pirates.json): a field, and a device in a colour. */
export interface FlagDesign {
  field: string;
  colour: string;
  device: 'skull' | 'swords' | 'hourglass' | 'heart' | 'spear' | 'bones';
}

/** A small seeded random, so a flag is drawn the same each time (its fraying, its weave). */
export function flagRandom(key: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

// --- the devices, as paths ---------------------------------------------------------------------------------
// Each is drawn in its own box and placed with a transform; holes (eyes, the gaps between teeth) are subpaths filled
// even-odd, so the field shows through them.

/** A skull, full face, in a 100 x 100 box: the dome, the cheekbones, the upper jaw and its teeth, the jaw below. */
const SKULL = new Path2D(
  [
    // The dome and the face, narrowing at the temples to the cheekbones, then the upper jaw.
    'M50 3 C74 3 89 19 89 40 C89 51 85 58 79 62 C81 66 80 71 76 73 L72 74 L71 80 L29 80 L28 74 L24 73 C20 71 19 66 21 62 C15 58 11 51 11 40 C11 19 26 3 50 3 Z',
    // The jaw: a separate bone, its teeth meeting the upper set.
    'M31 83 L69 83 L68 90 C66 96 59 99 50 99 C41 99 34 96 32 90 Z',
    // The eye sockets, deep and a little heavy-browed.
    'M24 44 C24 35 32 31 40 34 C46 37 47 46 43 53 C39 59 30 59 26 53 C24 50 24 47 24 44 Z',
    'M76 44 C76 35 68 31 60 34 C54 37 53 46 57 53 C61 59 70 59 74 53 C76 50 76 47 76 44 Z',
    // The nose: an upturned heart.
    'M50 56 C47 60 43 66 45 69 C47 71 49 69 50 66 C51 69 53 71 55 69 C57 66 53 60 50 56 Z',
  ].join(' '),
);
/** The gaps between the teeth, upper and lower: thin slots cut through the bone. */
const TEETH = new Path2D(
  Array.from({ length: 8 }, (_, i) => {
    const x = 33.5 + i * 4.75;
    return `M${x - 0.7} 74.5 L${x + 0.7} 74.5 L${x + 0.6} 80 L${x - 0.6} 80 Z M${x - 0.7} 83 L${x + 0.7} 83 L${x + 0.6} 88 L${x - 0.6} 88 Z`;
  }).join(' '),
);
/** A thigh bone, 100 long and 16 deep, its ends swelling into two knobs each. */
const BONE = new Path2D(
  'M11 5.5 L89 5.5 C91 1.5 97 0 99 3 C100.5 5.5 98.5 7.2 96.5 8 C98.5 8.8 100.5 10.5 99 13 C97 16 91 14.5 89 10.5 L11 10.5 C9 14.5 3 16 1 13 C-0.5 10.5 1.5 8.8 3.5 8 C1.5 7.2 -0.5 5.5 1 3 C3 0 9 1.5 11 5.5 Z',
);
/**
 * A cutlass, hilt at the origin and blade rising 100 to its point: broad and curved, the back sweeping to a clipped
 * point; a shell guard and quillon, the grip, and a knuckle bow down to the pommel.
 */
const CUTLASS = new Path2D(
  [
    'M-4 0 C-7 -38 4 -72 34 -99 C36 -96 37 -92 35 -88 C14 -66 6 -36 6 0 Z',
    // The shell and the quillon, curling back.
    'M-8 -1.5 C-7 -5 7 -5 8 -1.5 C7 1.5 -7 1.5 -8 -1.5 Z',
    'M8 -1.5 C11 -3 13 -6 12 -9 C11 -7 10 -5 7.5 -4.5 Z',
    // The grip and the pommel.
    'M-2.4 1 L2.4 1 L2.8 13 L-2.8 13 Z',
    'M0 12.5 C2.8 12.5 4 14.5 4 16 C4 18 2 19 0 19 C-2 19 -4 18 -4 16 C-4 14.5 -2.8 12.5 0 12.5 Z',
  ].join(' '),
);
/** The knuckle bow, from the guard round the grip to the pommel: stroked. */
const KNUCKLE_BOW = new Path2D('M-7.5 0 C-12 5 -10 13 -3.5 16');
/** A heart, 100 wide. */
const HEART = new Path2D('M50 92 C38 80 4 58 4 32 C4 14 18 4 32 4 C41 4 47 9 50 15 C53 9 59 4 68 4 C82 4 96 14 96 32 C96 58 62 80 50 92 Z');
/** A drop of blood, 10 wide and 16 deep, its point up. */
const DROP = new Path2D('M5 0 C7 5 10 8 10 11 C10 14 8 16 5 16 C2 16 0 14 0 11 C0 8 3 5 5 0 Z');
/** A spear, its point at the top of a 100-long shaft: a leaf-shaped head, a socket, and a tassel bound below it. */
const SPEAR = new Path2D(
  [
    'M0 0 C5 8 9 16 8 24 C7 29 4 32 2 33 L-2 33 C-4 32 -7 29 -8 24 C-9 16 -5 8 0 0 Z',
    'M-3 33 L3 33 L3 40 L-3 40 Z',
    'M-1.6 40 L1.6 40 L1.6 100 L-1.6 100 Z',
  ].join(' '),
);
/** A dart's flights at the end of its shaft (the origin, its point toward -y): two feathers swept back along it. */
const FLIGHTS = new Path2D('M-1.6 0 L-7 -7 L-7 -26 L-1.6 -20 Z M1.6 0 L7 -7 L7 -26 L1.6 -20 Z M-1.6 -22 L1.6 -22 L1.6 2 L-1.6 2 Z');
/** An hourglass, 60 wide and 100 deep: its frame's two plates and posts, and the glass, the sand run half through. */
const HOURGLASS = new Path2D(
  [
    'M2 0 L58 0 L58 7 L2 7 Z',
    'M2 93 L58 93 L58 100 L2 100 Z',
    'M4 7 L9 7 L9 93 L4 93 Z',
    'M51 7 L56 7 L56 93 L51 93 Z',
    // The glass's two bulbs, as one outline with its inside cut away.
    'M13 9 L47 9 C47 30 34 42 32 50 C34 58 47 70 47 91 L13 91 C13 70 26 58 28 50 C26 42 13 30 13 9 Z',
    'M17 12 L43 12 C42 30 31 41 30 50 C31 59 42 70 43 88 L17 88 C18 70 29 59 30 50 C29 41 18 30 17 12 Z',
    // The sand: what is left above, the thread falling, the heap below.
    'M20 24 L40 24 C38 33 33 40 30 46 C27 40 22 33 20 24 Z',
    'M29.4 46 L30.6 46 L30.6 76 L29.4 76 Z',
    'M18 88 C21 78 26 74 30 73 C34 74 39 78 42 88 Z',
  ].join(' '),
);
/** A bird's wing, 70 long, its feathers fanning back from the shoulder at the origin. */
function wing(): Path2D {
  const p = new Path2D();
  p.moveTo(0, 0);
  p.bezierCurveTo(20, -14, 48, -20, 70, -16);
  // The primaries: long feathers, each tip a little lower and shorter.
  for (let i = 0; i < 6; i++) {
    const x = 70 - i * 9;
    const y = -16 + i * 7;
    p.quadraticCurveTo(x - 2, y + 6, x - 9 + i * 0.6, y + 6);
  }
  p.quadraticCurveTo(12, 30, 0, 12);
  p.closePath();
  return p;
}
const WING = wing();
/** A fleur-de-lis, 100 tall: the middle petal, the two curling out, the band, and the foot. */
const FLEUR = new Path2D(
  [
    // The middle petal, swelling and drawing to a point.
    'M50 0 C60 12 66 28 62 44 C60 52 56 57 54 60 L46 60 C44 57 40 52 38 44 C34 28 40 12 50 0 Z',
    // The side petals: up from the band, out, and curling over and down to a point.
    'M45 60 C40 44 30 32 18 32 C8 32 2 40 4 48 C6 55 13 57 17 52 C13 54 9 50 10 45 C12 39 22 40 28 48 C32 53 34 58 36 62 Z',
    'M55 60 C60 44 70 32 82 32 C92 32 98 40 96 48 C94 55 87 57 83 52 C87 54 91 50 90 45 C88 39 78 40 72 48 C68 53 66 58 64 62 Z',
    // The band.
    'M30 61 L70 61 C71 64 71 67 70 70 L30 70 C29 67 29 64 30 61 Z',
    // The foot: the middle drawn down to a point, and two small curls.
    'M45 70 L55 70 C55 80 53 90 50 98 C47 90 45 80 45 70 Z',
    'M44 70 C38 72 30 78 31 86 C34 82 38 78 44 76 Z',
    'M56 70 C62 72 70 78 69 86 C66 82 62 78 56 76 Z',
  ].join(' '),
);

/** Fills `path` drawn in its own box at (x, y), scaled by `s` and turned by `angle` (radians). */
function place(g: CanvasRenderingContext2D, path: Path2D, x: number, y: number, s: number, angle = 0, flip = false) {
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  g.scale(flip ? -s : s, s);
  g.fill(path, 'evenodd');
  g.restore();
}

/** A skull and crossed bones, the skull `s` across, centred on (x, y). */
function skullAndBones(g: CanvasRenderingContext2D, x: number, y: number, s: number) {
  crossbones(g, x, y + s * 0.62, s * 1.75);
  skull(g, x, y - s * 0.12, s);
}

/** A skull `s` across, centred on (x, y). */
export function skull(g: CanvasRenderingContext2D, x: number, y: number, s: number) {
  g.save();
  g.translate(x - s / 2, y - s / 2);
  g.scale(s / 100, s / 100);
  const both = new Path2D();
  both.addPath(SKULL);
  both.addPath(TEETH);
  g.fill(both, 'evenodd');
  g.restore();
}

/** Two thigh bones crossed in a saltire, each `len` long, centred on (x, y). */
export function crossbones(g: CanvasRenderingContext2D, x: number, y: number, len: number) {
  for (const a of [0.48, -0.48]) {
    g.save();
    g.translate(x, y);
    g.rotate(a);
    g.scale(len / 100, len / 100);
    g.translate(-50, -8);
    g.fill(BONE);
    g.restore();
  }
}

/** A cutlass with its hilt at (x, y), the blade `len` long, leaning `angle` (radians), curving to the right (or left, flipped). */
function cutlass(g: CanvasRenderingContext2D, x: number, y: number, len: number, angle: number, flip: boolean) {
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  g.scale(flip ? -len / 100 : len / 100, len / 100);
  g.fill(CUTLASS);
  g.lineWidth = 2.4;
  g.lineCap = 'round';
  g.strokeStyle = g.fillStyle;
  g.stroke(KNUCKLE_BOW);
  g.restore();
}

/** Drops of blood falling from (x, y), `s` the size of one. */
function drops(g: CanvasRenderingContext2D, x: number, y: number, s: number) {
  for (const [dx, dy, k] of [[0, 0, 1], [-1.4, 1.9, 0.8], [1.2, 2.6, 0.9]] as const) place(g, DROP, x + dx * s - 5 * s * k / 10, y + dy * s, (s * k) / 10);
}

/** A famous pirate's device on her flag, a little toward the hoist from the middle (the fly frays). */
function drawDevice(g: CanvasRenderingContext2D, design: FlagDesign) {
  const [cx, cy] = [FLAG_W * 0.47, FLAG_H * 0.5];
  if (design.device === 'skull') {
    skullAndBones(g, cx, cy - 10, 120);
  } else if (design.device === 'bones') {
    // Crossed bones alone, large.
    crossbones(g, cx, cy, 260);
  } else if (design.device === 'swords') {
    // A skull over two cutlasses crossed below it, their points up and out.
    // Hilts low and wide, the blades crossing under the skull and sweeping up past it.
    cutlass(g, cx - 96, cy + 100, 222, 0.6, false);
    cutlass(g, cx + 96, cy + 100, 222, -0.6, true);
    skull(g, cx, cy - 66, 98);
  } else if (design.device === 'hourglass') {
    // Time flying: the glass, winged.
    place(g, WING, cx - 40, cy - 30, 1.7, 0, true);
    place(g, WING, cx + 40, cy - 30, 1.7);
    place(g, HOURGLASS, cx - 51, cy - 85, 1.7);
  } else if (design.device === 'heart') {
    // A heart run through with a dart, its point out above and its flights below, bleeding.
    place(g, SPEAR, cx + 92, cy - 104, 2.35, 0.72);
    place(g, FLIGHTS, cx - 64, cy + 74, 2.35, 0.72);
    place(g, HEART, cx - 64, cy - 60, 1.28);
    drops(g, cx + 6, cy + 76, 13);
  } else {
    // A skull with a spear raised beside it, blood running from its point.
    place(g, SPEAR, cx - 98, cy - 128, 2.4, 0.12);
    skull(g, cx + 26, cy - 8, 132);
    drops(g, cx - 76, cy - 62, 11);
  }
}

// --- the nations -------------------------------------------------------------------------------------------

/** One staff of the Cross of Burgundy, end to end: a rough branch, its side shoots lopped short in saw-teeth. */
export function burgundyStaff(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, w: number, rnd: () => number) {
  const len = Math.hypot(x1 - x0, y1 - y0);
  const [dx, dy] = [(x1 - x0) / len, (y1 - y0) / len];
  const [nx, ny] = [-dy, dx];
  const at = (t: number, side: number, out: number): [number, number] => [x0 + dx * len * t + nx * side * out, y0 + dy * len * t + ny * side * out];
  g.beginPath();
  // Down one side, with a lopped shoot (a tooth, slanting toward the top end) every so far, and back up the other.
  for (const side of [1, -1]) {
    const ts: number[] = [];
    for (let t = side > 0 ? 0.04 : 0.065; t < 0.97; t += 0.05 + rnd() * 0.012) ts.push(t);
    if (side < 0) ts.reverse();
    const half = w / 2;
    const start = side > 0 ? 0 : 1;
    g[side > 0 ? 'moveTo' : 'lineTo'](...at(start, side, half));
    for (const t of ts) {
      const o = (side > 0 ? 1 : -1) * 0.013;
      const tooth = half * (1.45 + rnd() * 0.25);
      g.lineTo(...at(t - o, side, half * (0.94 + rnd() * 0.1)));
      g.lineTo(...at(t + o * 0.6, side, tooth));
      g.lineTo(...at(t + o * 1.5, side, half * (0.94 + rnd() * 0.1)));
    }
    g.lineTo(...at(side > 0 ? 1 : 0, side, half));
  }
  g.closePath();
  g.fill();
}

/** A field powdered with fleurs-de-lis, each `s` tall, in staggered rows. */
function semeDeLis(g: CanvasRenderingContext2D, s: number) {
  const [dx, dy] = [s * 1.45, s * 1.3];
  for (let row = 0, y = s * 0.15; y < FLAG_H; row++, y += dy) {
    for (let x = (row % 2) * (dx / 2) - s * 0.15; x < FLAG_W; x += dx) place(g, FLEUR, x, y, s / 100);
  }
}

// --- the paint and the cloth -------------------------------------------------------------------------------

/**
 * Paints a device in `colour` as it is painted on the cloth: lit from the top and dulled toward the bottom, the paint
 * a little uneven, its edge soft where it soaked in.
 */
function painted(g: CanvasRenderingContext2D, colour: string, draw: (p: CanvasRenderingContext2D) => void, rnd: () => number) {
  const layer = document.createElement('canvas');
  layer.width = FLAG_W;
  layer.height = FLAG_H;
  const p = layer.getContext('2d')!;
  p.fillStyle = colour;
  p.strokeStyle = colour;
  draw(p);
  p.globalCompositeOperation = 'source-atop';
  const light = p.createLinearGradient(0, 0, 0, FLAG_H);
  light.addColorStop(0, 'rgba(255,255,255,0.10)');
  light.addColorStop(0.5, 'rgba(255,255,255,0)');
  light.addColorStop(1, 'rgba(0,0,0,0.16)');
  p.fillStyle = light;
  p.fillRect(0, 0, FLAG_W, FLAG_H);
  // The paint's unevenness: soft blotches, a shade lighter or darker.
  for (let i = 0; i < 160; i++) {
    p.fillStyle = rnd() < 0.5 ? `rgba(0,0,0,${0.015 + rnd() * 0.02})` : `rgba(255,255,255,${0.015 + rnd() * 0.02})`;
    p.beginPath();
    p.ellipse(rnd() * FLAG_W, rnd() * FLAG_H, 2 + rnd() * 7, 1.5 + rnd() * 4, rnd() * 3, 0, Math.PI * 2);
    p.fill();
  }
  g.save();
  // Soaked in at its edge: a faint bleed under the crisp paint.
  g.filter = 'blur(1.2px)';
  g.globalAlpha = 0.5;
  g.drawImage(layer, 0, 0);
  g.filter = 'none';
  g.globalAlpha = 1;
  g.drawImage(layer, 0, 0);
  g.restore();
}

/**
 * The cloth: the seams between the strips of bunting, a weave, the colours fading toward the fly, the linen tape at the
 * hoist, and the fly frayed (`wear` 0..1: a pirate's flag flies till it is in tatters).
 */
function cloth(g: CanvasRenderingContext2D, rnd: () => number, wear: number) {
  const [w, h] = [g.canvas.width, g.canvas.height];
  // Seams: each strip of bunting turned under and stitched, a fine shadow and a highlight beside it.
  const strips = Math.max(1, Math.round(h / 53));
  for (let i = 1; i < strips; i++) {
    const y = Math.round((i * h) / strips);
    g.fillStyle = 'rgba(0,0,0,0.055)';
    g.fillRect(0, y, w, 2);
    g.fillStyle = 'rgba(255,255,255,0.04)';
    g.fillRect(0, y + 2, w, 1);
    // The stitches, a dotted line along it.
    g.fillStyle = 'rgba(0,0,0,0.05)';
    for (let x = 2; x < w; x += 7) g.fillRect(x, y - 3, 3, 1);
  }
  // Long soft creases where it was folded away, running the length.
  for (let i = 0; i < 3; i++) {
    const y = rnd() * h;
    const grad = g.createLinearGradient(0, y - 14, 0, y + 14);
    const shade = rnd() < 0.5 ? '0,0,0' : '255,255,255';
    grad.addColorStop(0, `rgba(${shade},0)`);
    grad.addColorStop(0.5, `rgba(${shade},0.025)`);
    grad.addColorStop(1, `rgba(${shade},0)`);
    g.fillStyle = grad;
    g.fillRect(0, y - 14, w, 28);
  }
  // The hoist: a linen tape sewn along the edge at the staff.
  const tape = Math.round(Math.min(w * 0.035, 18));
  g.fillStyle = '#e4dcc6';
  g.fillRect(0, 0, tape, h);
  g.fillStyle = 'rgba(0,0,0,0.18)';
  g.fillRect(tape, 0, 2, h);
  g.fillStyle = 'rgba(90,70,40,0.35)';
  for (let y = 6; y < h; y += 9) g.fillRect(tape - 4, y, 1.5, 4);

  const img = g.getImageData(0, 0, w, h);
  const px = img.data;
  // The fly's ragged edge: how far in it is eaten, row by row (with a few deeper tears on a worn flag).
  const fray: number[] = [];
  let run = 0;
  const tears = Array.from({ length: Math.round(wear * 6) }, () => ({ at: rnd() * h, depth: (0.05 + rnd() * 0.12) * w * wear, span: 5 + rnd() * 14 }));
  for (let y = 0; y < h; y++) {
    run = run * 0.82 + (rnd() - 0.5) * 7;
    let cut = Math.max(0, 2 + wear * 10 + run * (0.4 + wear));
    for (const t of tears) cut = Math.max(cut, t.depth * Math.max(0, 1 - Math.abs(y - t.at) / t.span));
    fray.push(cut);
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const edge = w - fray[y]!;
      if (x > edge) {
        px[i + 3] = 0;
        continue;
      }
      // Loose threads hang at the frayed edge: lighter, thinner.
      const loose = x > edge - 3 ? 10 : 0;
      // The weave: warp and weft, and the wool's own unevenness; the sun's fading toward the fly.
      const weave = (x % 3 === 0 ? -5 : 0) + (y % 3 === 0 ? -4 : 0) + (rnd() - 0.5) * 8 + loose;
      const fade = (x / w) * 0.08;
      for (let c = 0; c < 3; c++) px[i + c] = Math.max(0, Math.min(255, px[i + c]! + weave + (255 - px[i + c]!) * fade));
    }
  }
  g.putImageData(img, 0, 0);
}

/** A pennant's cloth: long and narrow, about as long as ten times its depth at the hoist. */
export const PENNANT_W = 512;
export const PENNANT_H = 56;

/**
 * A pennant (or streamer) for the main masthead, in the nation's colours as the period flew them: St George's cross at
 * the hoist and a red tail for England, the Cross of Burgundy at the hoist of a white one for Spain, the King's lilies
 * on blue at the hoist of a white one for France, the States' three colours down its length, a pirate's black (a famous
 * one's in her own colours, her device's colour at the hoist). It tapers to a swallow-tail, frayed.
 */
export function drawPennant(nation: string, design?: FlagDesign): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = PENNANT_W;
  c.height = PENNANT_H;
  const g = c.getContext('2d')!;
  const [w, h] = [PENNANT_W, PENNANT_H];
  const key = `pennant:${design ? `${design.field}|${design.colour}|${design.device}` : nation}`;
  const rnd = flagRandom(key);
  // The hoist's square of colours, and the tail beyond it.
  const hoist = Math.round(h * 1.4);
  if (design) {
    g.fillStyle = design.field;
    g.fillRect(0, 0, w, h);
    g.fillStyle = design.colour;
    g.fillRect(0, 0, hoist * 0.3, h);
    skull(g, hoist * 0.75, h * 0.5, h * 0.78);
  } else if (nation === 'england' || nation === 'player') {
    g.fillStyle = '#b5142a';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#f1ebdd';
    g.fillRect(0, 0, hoist, h);
    g.fillStyle = '#b5142a';
    g.fillRect(hoist / 2 - h * 0.11, 0, h * 0.22, h);
    g.fillRect(0, h * 0.39, hoist, h * 0.22);
  } else if (nation === 'spain') {
    g.fillStyle = '#f1ebdd';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#b0162a';
    burgundyStaff(g, 4, 2, hoist - 4, h - 2, 9, rnd);
    burgundyStaff(g, hoist - 4, 2, 4, h - 2, 9, rnd);
    // A red edge down the tail.
    g.fillRect(hoist, 0, w, h * 0.12);
    g.fillRect(hoist, h * 0.88, w, h * 0.12);
  } else if (nation === 'france') {
    g.fillStyle = '#f3eee2';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#20356e';
    g.fillRect(0, 0, hoist, h);
    g.fillStyle = '#c8962a';
    place(g, FLEUR, hoist / 2 - h * 0.36, h * 0.12, (h * 0.76) / 100);
  } else if (nation === 'netherlands') {
    for (const [i, col] of ['#ae1c28', '#f1ebdd', '#21468b'].entries()) {
      g.fillStyle = col;
      g.fillRect(0, Math.round((i * h) / 3), w, Math.ceil(h / 3) + 1);
    }
  } else {
    g.fillStyle = '#121214';
    g.fillRect(0, 0, w, h);
  }
  const worn = design || !NATIONS.has(nation);
  cloth(g, rnd, worn ? 0.6 : 0.15);
  // The shape: tapering from the hoist toward the fly, the end cut into a swallow-tail.
  g.globalCompositeOperation = 'destination-in';
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(w, h * 0.3);
  g.lineTo(w * 0.86, h * 0.5);
  g.lineTo(w, h * 0.7);
  g.lineTo(0, h);
  g.closePath();
  g.fillStyle = '#000';
  g.fill();
  g.globalCompositeOperation = 'source-over';
  return c;
}

/** Every nation the game draws its own flag for; anything else flies a pirate's black. */
const NATIONS = new Set(['spain', 'england', 'player', 'france', 'netherlands']);

/**
 * A nation's flag (or a famous pirate's own, `design`), drawn on a canvas FLAG_W x FLAG_H: Spain's Cross of Burgundy,
 * England's red ensign, France's white powdered with fleurs-de-lis, the States' red, white and blue, a pirate's black
 * with skull and crossed bones.
 */
export function drawFlag(nation: string, design?: FlagDesign): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = FLAG_W;
  c.height = FLAG_H;
  const g = c.getContext('2d')!;
  const rnd = flagRandom(design ? `${design.field}|${design.colour}|${design.device}` : nation);
  flagField(g, nation, design, rnd, painted, false);
  cloth(g, rnd, design || !NATIONS.has(nation) ? 0.75 : 0.2);
  return c;
}

/**
 * The same flag as a small picture for a name's banner (`w` x `h`): flat colours drawn straight at that size, no cloth,
 * wear or fraying, its devices bolder so they still read.
 */
export function drawFlagIcon(nation: string, design: FlagDesign | undefined, w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  g.scale(w / FLAG_W, h / FLAG_H);
  const flat = (q: CanvasRenderingContext2D, colour: string, draw: (p: CanvasRenderingContext2D) => void) => {
    q.save();
    q.fillStyle = colour;
    q.strokeStyle = colour;
    draw(q);
    q.restore();
  };
  flagField(g, nation, design, flagRandom(`icon:${nation}`), flat, true);
  return c;
}

/** A flag's colours and devices on a FLAG_W x FLAG_H canvas, each device laid on by `painted` (flat, for an icon). */
function flagField(
  g: CanvasRenderingContext2D,
  nation: string,
  design: FlagDesign | undefined,
  rnd: () => number,
  painted: (g: CanvasRenderingContext2D, colour: string, draw: (p: CanvasRenderingContext2D) => void, rnd: () => number) => void,
  icon: boolean,
) {
  const [w, h] = [FLAG_W, FLAG_H];
  if (design) {
    g.fillStyle = design.field;
    g.fillRect(0, 0, w, h);
    painted(g, design.colour, (p) => drawDevice(p, design), rnd);
  } else if (nation === 'spain') {
    // The Cross of Burgundy: red, ragged, corner to corner on white.
    g.fillStyle = '#f1ebdd';
    g.fillRect(0, 0, w, h);
    painted(
      g,
      '#b0162a',
      (p) => {
        burgundyStaff(p, -10, -6, w + 10, h + 6, icon ? 64 : 36, rnd);
        burgundyStaff(p, w + 10, -6, -10, h + 6, icon ? 64 : 36, rnd);
      },
      rnd,
    );
  } else if (nation === 'england' || nation === 'player') {
    // The red ensign: St George's cross in the canton, on a red field.
    g.fillStyle = '#b5142a';
    g.fillRect(0, 0, w, h);
    const [cw, ch] = [Math.round(w * 0.36), Math.round(h * 0.5)];
    g.fillStyle = '#f1ebdd';
    g.fillRect(0, 0, cw, ch);
    painted(
      g,
      '#b5142a',
      (p) => {
        p.fillRect(Math.round(cw / 2 - ch * 0.11), 0, Math.round(ch * 0.22), ch);
        p.fillRect(0, Math.round(ch * 0.39), cw, Math.round(ch * 0.22));
      },
      rnd,
    );
  } else if (nation === 'france') {
    // The King's white, powdered with gold fleurs-de-lis.
    g.fillStyle = '#f3eee2';
    g.fillRect(0, 0, w, h);
    painted(g, '#c8962a', (p) => semeDeLis(p, icon ? 120 : 52), rnd);
  } else if (nation === 'netherlands') {
    // The States' flag: red, white and blue (the Prince's orange had given way to red at sea by the 1660s).
    for (const [i, col] of ['#ae1c28', '#f1ebdd', '#21468b'].entries()) {
      g.fillStyle = col;
      g.fillRect(0, Math.round((i * h) / 3), w, Math.ceil(h / 3) + 1);
    }
  } else {
    // A pirate's black, with the skull and crossed bones.
    g.fillStyle = '#121214';
    g.fillRect(0, 0, w, h);
    painted(g, '#ebe4d0', (p) => skullAndBones(p, w * (icon ? 0.5 : 0.47), h * 0.5 - (icon ? 22 : 10), icon ? 150 : 120), rnd);
  }
}
