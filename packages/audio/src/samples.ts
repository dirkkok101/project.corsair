/** Sample library: decoded clips by id, loaded once the AudioContext exists. */

export interface SampleManifest {
  /** Sound-effect id (gull, creak, ...) to clip URLs; one is picked at random per play. */
  sfx: Record<string, string[]>;
  /** Instrument id to its notes: URL and the MIDI note it was recorded at. */
  instruments: Record<string, { url: string; midi: number }[]>;
}

export interface SampleLibrary {
  sfx: Map<string, AudioBuffer[]>;
  instruments: Map<string, { buffer: AudioBuffer; midi: number }[]>;
}

export async function loadSamples(ctx: BaseAudioContext, manifest: SampleManifest): Promise<SampleLibrary> {
  const decode = async (url: string) => ctx.decodeAudioData(await (await fetch(url)).arrayBuffer());
  const sfx = new Map<string, AudioBuffer[]>();
  const instruments = new Map<string, { buffer: AudioBuffer; midi: number }[]>();
  await Promise.all([
    ...Object.entries(manifest.sfx).map(async ([id, urls]) => sfx.set(id, await Promise.all(urls.map(decode)))),
    ...Object.entries(manifest.instruments).map(async ([id, notes]) =>
      instruments.set(
        id,
        await Promise.all(notes.map(async ({ url, midi }) => ({ buffer: await decode(url), midi }))),
      ),
    ),
  ]);
  return { sfx, instruments };
}

/** Plays one clip through a gain (and optional pan and rate); returns nothing, the nodes clean up. */
export function playClip(
  ctx: AudioContext,
  out: AudioNode,
  buffer: AudioBuffer,
  opts: { when?: number; gain?: number; pan?: number; rate?: number; lowpass?: number } = {},
) {
  const when = opts.when ?? ctx.currentTime;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.playbackRate.value = opts.rate ?? 1;
  const g = ctx.createGain();
  g.gain.value = opts.gain ?? 1;
  let node: AudioNode = src;
  if (opts.lowpass) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = opts.lowpass;
    node = node.connect(lp);
  }
  if (opts.pan !== undefined) {
    const p = ctx.createStereoPanner();
    p.pan.value = opts.pan;
    node = node.connect(p);
  }
  node.connect(g).connect(out);
  src.start(when);
}
