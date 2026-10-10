import { createBand } from './band';
import { ambienceTargets } from './mix';
import type { AmbienceTargets, AudioInputs } from './mix';
import type { TuneData } from './music';
import { loadSamples } from './samples';
import type { SampleManifest } from './samples';
import { createSfx } from './sfx';

export * from './mix';
export * from './music';
export type { SampleManifest } from './samples';

// Ambience is synthesised from one shared noise buffer shaped by filters, so every layer can follow
// the game smoothly (no loops to crossfade). The engine only listens: it reads what the game passes
// it each frame and never changes the sim.

const GLIDE_S = 0.25; // time constant for layer volumes following their targets
const MASTER = 0.6;
const MUTE_KEY = 'corsair.muted';
const MUSIC_KEY = 'corsair.music';
const MUSIC = 0.45; // the band sits under the sea, not on top of it

type Layer = { gain: GainNode; filter: BiquadFilterNode };

export interface AudioLevels {
  state: AudioContextState | 'locked';
  muted: boolean;
  targets: AmbienceTargets | undefined;
  /** RMS of what the speakers get right now (0 when muted or locked), so tests can tell sound is playing. */
  rms: number;
  /** RMS of the band alone (after the music toggle), so tests can tell the music from the sea. */
  musicRms: number;
  music: boolean;
  /** Title of the tune the band is playing, if any. */
  nowPlaying: string | undefined;
  /** Recorded samples are decoded and ready. */
  samplesReady: boolean;
}

export function createAudio(options: { samples?: SampleManifest; tunes?: TuneData[] } = {}) {
  let ctx: AudioContext | undefined;
  let master: GainNode | undefined;
  let meter: AnalyserNode | undefined;
  let musicMeter: AnalyserNode | undefined;
  let noise: AudioBuffer | undefined;
  let layers: Record<'wavesLow' | 'wavesWash' | 'wind' | 'rush' | 'surf' | 'rain' | 'luff', Layer> | undefined;
  let targets: AmbienceTargets | undefined;
  let wasLuffing = false;
  let nextFlap = 0;
  let muted = false;
  let music = true;
  try {
    muted = localStorage.getItem(MUTE_KEY) === '1';
    music = localStorage.getItem(MUSIC_KEY) !== '0';
  } catch {
    // Storage can be blocked; sound simply starts unmuted with music.
  }
  let band: ReturnType<typeof createBand> | undefined;
  let sfx: ReturnType<typeof createSfx> | undefined;
  let samplesReady = false;

  const noiseLayer = (type: BiquadFilterType, frequency: number, q = 0.7, extra?: BiquadFilterNode): Layer => {
    const src = ctx!.createBufferSource();
    src.buffer = noise!;
    src.loop = true;
    const filter = ctx!.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    filter.Q.value = q;
    const gain = ctx!.createGain();
    gain.gain.value = 0;
    if (extra) {
      src.connect(extra).connect(filter);
    } else {
      src.connect(filter);
    }
    filter.connect(gain).connect(master!);
    // Different offsets keep the layers from sharing one audible noise pattern.
    src.start(0, Math.random() * noise!.duration);
    return { gain, filter };
  };

  const build = () => {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : MASTER;
    master.connect(ctx.destination);
    meter = ctx.createAnalyser();
    meter.fftSize = 2048;
    master.connect(meter);
    noise = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
    const data = noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const highpass = (f: number) => {
      const hp = ctx!.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = f;
      return hp;
    };
    layers = {
      wavesLow: noiseLayer('lowpass', 420),
      wavesWash: noiseLayer('bandpass', 900, 0.6),
      wind: noiseLayer('bandpass', 600, 7),
      rush: noiseLayer('lowpass', 500, 0.7, highpass(110)),
      surf: noiseLayer('lowpass', 1100),
      rain: noiseLayer('highpass', 2600),
      luff: noiseLayer('bandpass', 340, 1.3),
    };
    band = createBand(ctx, master, options.tunes ?? []);
    band.setVolume(music ? MUSIC : 0);
    musicMeter = ctx.createAnalyser();
    musicMeter.fftSize = 2048;
    band.bus.connect(musicMeter);
    sfx = createSfx(ctx, master);
    if (options.samples) {
      void loadSamples(ctx, options.samples).then((lib) => {
        band!.setLibrary(lib);
        sfx!.setLibrary(lib);
        samplesReady = true;
      });
    }
  };

  const glide = (param: AudioParam, value: number, tc = GLIDE_S) => param.setTargetAtTime(value, ctx!.currentTime, tc);

  /** A deep canvas "thwump" as the sails fill again after being in irons. */
  const thump = () => {
    const t = ctx!.currentTime;
    const osc = ctx!.createOscillator();
    osc.frequency.setValueAtTime(95, t);
    osc.frequency.exponentialRampToValueAtTime(48, t + 0.3);
    const g = ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    osc.connect(g).connect(master!);
    osc.start(t);
    osc.stop(t + 0.45);
  };

  /** A thunder roll: low-passed noise with a sharp onset and a long, uneven decay. */
  const thunder = (delayS: number) => {
    const t = ctx!.currentTime + delayS;
    const src = ctx!.createBufferSource();
    src.buffer = noise!;
    const lp = ctx!.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(120, t + 1.2);
    const g = ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.9, t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.35, t + 0.6);
    g.gain.exponentialRampToValueAtTime(0.5, t + 1.0);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
    src.connect(lp).connect(g).connect(master!);
    src.start(t, Math.random() * 2);
    src.stop(t + 3.3);
  };

  /** A stereo-placed, faded output for a one-shot: the battle sounds sit where the shot was. */
  const placed = (t: number, pan: number, gain: number) => {
    const g = ctx!.createGain();
    g.gain.value = gain;
    const p = ctx!.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    g.connect(p).connect(master!);
    return g;
  };

  /**
   * One gun: a deep thump (a falling sine) under a crack of noise that dulls into a short rumble,
   * like a muzzle blast heard across water.
   */
  const gun = (t: number, out: GainNode) => {
    const osc = ctx!.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(70 + Math.random() * 20, t);
    osc.frequency.exponentialRampToValueAtTime(32, t + 0.35);
    const og = ctx!.createGain();
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.9, t + 0.008);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    osc.connect(og).connect(out);
    osc.start(t);
    osc.stop(t + 0.55);
    const src = ctx!.createBufferSource();
    src.buffer = noise!;
    const lp = ctx!.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2400, t);
    lp.frequency.exponentialRampToValueAtTime(180, t + 0.6);
    const ng = ctx!.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(0.7, t + 0.005);
    ng.gain.exponentialRampToValueAtTime(0.12, t + 0.15);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    src.connect(lp).connect(ng).connect(out);
    src.start(t, Math.random() * 2);
    src.stop(t + 0.95);
  };

  /** A ball striking home: splintering timber (a cracked band of noise) or canvas tearing (a thin hiss). */
  const strike = (t: number, out: GainNode, kind: 'hull' | 'sail') => {
    const src = ctx!.createBufferSource();
    src.buffer = noise!;
    const bp = ctx!.createBiquadFilter();
    bp.type = kind === 'hull' ? 'bandpass' : 'highpass';
    bp.frequency.value = kind === 'hull' ? 700 + Math.random() * 500 : 2500;
    bp.Q.value = kind === 'hull' ? 1.2 : 0.7;
    const g = ctx!.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(kind === 'hull' ? 0.9 : 0.4, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (kind === 'hull' ? 0.22 : 0.3));
    src.connect(bp).connect(g).connect(out);
    src.start(t, Math.random() * 2);
    src.stop(t + 0.35);
  };

  /** Short, irregular bursts of noise: canvas flogging in the wind. */
  const scheduleFlaps = (level: number) => {
    const g = layers!.luff.gain.gain;
    const now = ctx!.currentTime;
    if (nextFlap < now) nextFlap = now;
    while (nextFlap < now + 0.3) {
      const amp = level * (0.6 + Math.random() * 0.4);
      g.setValueAtTime(0.0001, nextFlap);
      g.exponentialRampToValueAtTime(amp, nextFlap + 0.012);
      g.exponentialRampToValueAtTime(0.0001, nextFlap + 0.07 + Math.random() * 0.05);
      nextFlap += 0.09 + Math.random() * 0.12;
    }
  };

  const onVisibility = () => {
    if (!ctx) return;
    if (document.hidden) void ctx.suspend();
    else void ctx.resume();
  };
  document.addEventListener('visibilitychange', onVisibility);

  return {
    /** Browsers only allow sound after a user gesture; call this from the first key or click. */
    unlock() {
      if (!ctx) build();
      void ctx!.resume();
    },
    get unlocked() {
      return ctx?.state === 'running';
    },
    get muted() {
      return muted;
    },
    toggleMute() {
      muted = !muted;
      try {
        localStorage.setItem(MUTE_KEY, muted ? '1' : '0');
      } catch {
        // Not remembered across reloads, but the toggle still works.
      }
      if (master) glide(master.gain, muted ? 0 : MASTER, 0.05);
    },
    /** Called every frame with the player's situation; `timeS` is real seconds, for the swells and gusts. */
    update(inputs: AudioInputs, timeS: number) {
      targets = ambienceTargets(inputs);
      if (!ctx || !layers || ctx.state !== 'running') return;
      const t = targets;
      // Slow, overlapping swells so the sea breathes instead of hissing.
      const swell = 0.7 + 0.3 * Math.sin(timeS * 0.9) * Math.sin(timeS * 0.37 + 1);
      const wash = 0.6 + 0.4 * Math.max(0, Math.sin(timeS * 0.55 + 2));
      const gust = 0.8 + 0.2 * Math.sin(timeS * 0.8) + 0.1 * Math.sin(timeS * 2.3);
      const crash = 0.2 + 0.8 * Math.max(0, Math.sin(timeS * 1.1)) ** 3;
      glide(layers.wavesLow.gain.gain, t.waves * 0.7 * swell);
      glide(layers.wavesLow.filter.frequency, 250 + 500 * t.wavesBright);
      glide(layers.wavesWash.gain.gain, t.waves * 0.25 * wash * t.wavesBright);
      glide(layers.wind.gain.gain, t.wind * 0.5 * gust);
      glide(layers.wind.filter.frequency, t.windPitch * (0.94 + 0.08 * gust));
      glide(layers.rush.gain.gain, t.rush * 0.6);
      glide(layers.rush.filter.frequency, t.rushTone);
      glide(layers.surf.gain.gain, t.surf * crash, 0.1);
      glide(layers.rain.gain.gain, t.rain);

      if (t.luff > 0) scheduleFlaps(t.luff * 0.6);
      const filled = wasLuffing && t.luff === 0 && inputs.sailsSet;
      if (filled) thump();
      wasLuffing = t.luff > 0;

      band?.update({
        hour: inputs.hour,
        inStorm: inputs.inStorm,
        sailsSet: inputs.sailsSet,
        luffing: inputs.luffing,
        speed: inputs.speed,
      });
      sfx?.update({
        coast: inputs.coast,
        harbour: inputs.harbour,
        wind: Math.min(1, inputs.wind / 1.1),
        hour: inputs.hour,
        sails: inputs.sails,
        filled,
        openSea: inputs.openSea,
        calm: inputs.wind <= 0.5,
      });

    },
    /** Thunder after a lightning flash; the delay stands for the storm's distance. */
    thunder(delayS = 0.4 + Math.random() * 1.2) {
      if (ctx?.state !== 'running') return;
      // A recorded peal when loaded, the synthesised roll until then.
      if (!sfx?.thunder(delayS)) thunder(delayS);
    },
    get music() {
      return music;
    },
    /** Title of the tune the band is playing, if any. */
    get nowPlaying() {
      return band?.nowPlaying;
    },
    /**
     * Sea battle sounds (PRD section 9.1). `pan` is -1 (left) to 1 (right) and `gain` falls off with
     * distance, both worked out by the caller from where it happened. Misses use the splash clips.
     */
    battle: {
      /** A broadside: its guns go off in a ripple, not all at once. */
      broadside(guns: number, pan: number, gain: number) {
        if (ctx?.state !== 'running' || !noise) return;
        const out = placed(ctx.currentTime, pan, gain * 0.5);
        let t = ctx.currentTime + 0.01;
        for (let i = 0; i < Math.max(1, Math.min(16, guns)); i++) {
          gun(t, out);
          t += 0.03 + Math.random() * 0.04;
        }
      },
      hit(kind: 'hull' | 'sail', pan: number, gain: number) {
        if (ctx?.state !== 'running' || !noise) return;
        strike(ctx.currentTime, placed(ctx.currentTime, pan, gain), kind);
      },
      splash(pan: number, gain: number) {
        if (ctx?.state !== 'running') return;
        sfx?.play(Math.random() < 0.3 ? 'splash_big' : 'splash_small', { gain: gain * 0.6, pan, rate: 0.9 + Math.random() * 0.3 });
      },
    },
    /** One-shot clip for game events such as sea life; no-op until sound is unlocked and loaded. */
    playSfx(id: string, opts: { gain: number; pan: number; lowpass?: number; rate?: number }) {
      if (ctx?.state === 'running') sfx?.play(id, opts);
    },
    toggleMusic() {
      music = !music;
      try {
        localStorage.setItem(MUSIC_KEY, music ? '1' : '0');
      } catch {
        // Not remembered across reloads, but the toggle still works.
      }
      band?.setVolume(music ? MUSIC : 0);
    },
    /** For the debug API and tests: what the mixer is aiming at, and whether sound can play. */
    levels(): AudioLevels {
      const rmsOf = (analyser: AnalyserNode | undefined) => {
        if (!analyser) return 0;
        const buf = new Float32Array(analyser.fftSize);
        analyser.getFloatTimeDomainData(buf);
        return Math.sqrt(buf.reduce((sum, v) => sum + v * v, 0) / buf.length);
      };
      return {
        state: ctx ? ctx.state : 'locked',
        muted,
        targets,
        rms: rmsOf(meter),
        musicRms: rmsOf(musicMeter),
        music,
        nowPlaying: band?.nowPlaying,
        samplesReady,
      };
    },
  };
}

export type Audio = ReturnType<typeof createAudio>;
