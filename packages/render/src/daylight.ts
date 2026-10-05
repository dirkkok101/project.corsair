import { Filter, GlProgram, Texture } from 'pixi.js';

// Day/night is a palette swap, not a tint (art pipeline section 6): every pixel is an exact
// corsair.gpl colour, and a filter swaps it for the same index in the dusk or night row. Between
// rows the swap is dithered, so every pixel on screen is still a palette colour.

export const Row = { Day: 0, Dusk: 1, Night: 2 } as const;
export type Row = (typeof Row)[keyof typeof Row];

/** Which two rows to show at a game hour, and how far from the first to the second (0-1). */
export function rowsAt(hour: number): { from: Row; to: Row; t: number } {
  const h = ((hour % 24) + 24) % 24;
  if (h < 5 || h >= 19) return { from: Row.Night, to: Row.Night, t: 0 };
  if (h < 6) return { from: Row.Night, to: Row.Dusk, t: h - 5 };
  if (h < 7) return { from: Row.Dusk, to: Row.Day, t: h - 6 };
  if (h < 17) return { from: Row.Day, to: Row.Day, t: 0 };
  if (h < 18) return { from: Row.Day, to: Row.Dusk, t: h - 17 };
  return { from: Row.Dusk, to: Row.Night, t: h - 18 };
}

/** RGB triples from a GIMP .gpl palette, in file order. */
export function parseGpl(text: string): [number, number, number][] {
  return text
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts.length >= 3 && parts.slice(0, 3).every((p) => /^\d+$/.test(p)))
    .map((parts) => [Number(parts[0]), Number(parts[1]), Number(parts[2])]);
}

const vertex = `in vec2 aPosition;
out vec2 vTextureCoord;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

vec4 filterVertexPosition(void) {
  vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
  return vec4(position, 0.0, 1.0);
}

void main(void) {
  gl_Position = filterVertexPosition();
  vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
}`;

const fragment = (count: number) => `in vec2 vTextureCoord;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform sampler2D uPalette;
uniform float uFrom;
uniform float uTo;
uniform float uMix;

const float COUNT = ${count}.0;

// 4x4 ordered dither built from the 2x2 matrix [0 2; 3 1]. Arithmetic rather than a lookup table,
// because WebGL1 (GLSL ES 1.0) has no array initialisers.
float bayer2(vec2 q) {
  return mod(2.0 * q.x + 3.0 * q.y, 4.0);
}

float bayer(vec2 p) {
  vec2 cell = floor(p);
  return (4.0 * bayer2(mod(cell, 2.0)) + bayer2(mod(floor(cell / 2.0), 2.0)) + 0.5) / 16.0;
}

vec3 rowColour(float index, float row) {
  return texture(uPalette, vec2((index + 0.5) / COUNT, (row + 0.5) / 3.0)).rgb;
}

void main(void) {
  vec4 c = texture(uTexture, vTextureCoord);
  if (c.a < 0.5 || (uFrom == 0.0 && uTo == 0.0)) {
    finalColor = c;
    return;
  }
  vec3 rgb = c.rgb / c.a;
  float found = -1.0;
  for (float i = 0.0; i < COUNT; i += 1.0) {
    vec3 d = abs(rowColour(i, 0.0) - rgb);
    if (max(d.r, max(d.g, d.b)) < 1.5 / 255.0) {
      found = i;
      break;
    }
  }
  // Colours outside the palette pass through untouched.
  if (found < 0.0) {
    finalColor = c;
    return;
  }
  float row = bayer(gl_FragCoord.xy) < uMix ? uTo : uFrom;
  finalColor = vec4(rowColour(found, row) * c.a, c.a);
}`;

/** The palette filter, plus a setter for the game hour. Rows are day, dusk and night, same indices. */
export function createDaylight(rows: [number, number, number][][]) {
  const count = rows[0]!.length;
  if (rows.length !== 3 || rows.some((r) => r.length !== count)) throw new Error('daylight: need day, dusk and night rows of equal length');
  const canvas = document.createElement('canvas');
  canvas.width = count;
  canvas.height = 3;
  const ctx = canvas.getContext('2d')!;
  rows.forEach((row, y) =>
    row.forEach(([r, g, b], x) => {
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(x, y, 1, 1);
    }),
  );
  const filter = new Filter({
    glProgram: new GlProgram({ vertex, fragment: fragment(count), name: 'corsair-daylight' }),
    resources: {
      daylight: {
        uFrom: { value: 0, type: 'f32' },
        uTo: { value: 0, type: 'f32' },
        uMix: { value: 0, type: 'f32' },
      },
      uPalette: Texture.from(canvas).source,
    },
  });
  return {
    filter,
    setHour(hour: number) {
      const { from, to, t } = rowsAt(hour);
      const u = filter.resources.daylight.uniforms;
      u.uFrom = from;
      u.uTo = to;
      u.uMix = t;
    },
  };
}
