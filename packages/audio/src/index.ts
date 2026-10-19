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
/**
 * The sea battle's mix: each sound's level against its distance gain, measured from the game's own output
 * (momentary loudness at its peak, against the sea's bed in a fresh breeze, about -23 LUFS): the player's broadside
 * about -12, hers and a hull hit about -15, a mast going -14, her balls rushing over -17, the boarders' fight -16, a
 * far-off fight just over the bed. Before this was measured, everything but the player's own guns sat at the bed and
 * was lost in it.
 */
const BATTLE_MIX = {
  gunSynth: 0.7,
  cannon: 0.9,
  cannonFar: 0.4,
  whistle: 0.45,
  hullSynth: 1,
  hull: 1.6,
  sailSynth: 0.75,
  sail: 0.6,
  grape: 0.75,
  mast: 3.5,
  melee: 0.5,
  volley: 0.35,
  explosion: 1.5,
  cheer: 0.7,
  splash: 1.1,
};
/** The master limiter: the loudest moments of a fight (both broadsides, hits and a mast at once) never clip. */
const LIMIT = { thresholdDb: -8, kneeDb: 4, ratio: 20, attack: 0.002, release: 0.2 };
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
  /** The recorded effects loaded, by name (sfx.json groups). */
  sfx: string[];
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
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = LIMIT.thresholdDb;
    limiter.knee.value = LIMIT.kneeDb;
    limiter.ratio.value = LIMIT.ratio;
    limiter.attack.value = LIMIT.attack;
    limiter.release.value = LIMIT.release;
    master.connect(limiter).connect(ctx.destination);
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
     * distance, both worked out by the caller from where it happened. Recorded clips (art/audio/sfx, the
     * combat set) over the synthesised ones, which stand alone until the clips have loaded.
     */
    battle: {
      /**
       * A broadside: its guns go off in a ripple, not all at once, each a recorded cannon (a distant rumble when
       * `far`) over the synthesised boom's low end.
       */
      broadside(guns: number, pan: number, gain: number, far = false) {
        if (ctx?.state !== 'running' || !noise) return;
        const out = placed(ctx.currentTime, pan, gain * 0.5 * BATTLE_MIX.gunSynth);
        const id = far ? 'cannon_far' : 'cannon_close';
        const recorded = sfx?.has(id);
        const n = Math.max(1, Math.min(16, guns));
        let t = ctx.currentTime + 0.01;
        for (let i = 0; i < n; i++) {
          gun(t, out);
          // Every other gun recorded (a full battery of clips at once only muddies): pitched about so no two match.
          if (recorded && (i % 2 === 0 || n <= 3)) {
            sfx!.play(id, { when: t, gain: gain * (far ? BATTLE_MIX.cannonFar : BATTLE_MIX.cannon), pan, rate: 0.8 + Math.random() * 0.3, ...(far ? { lowpass: 900 } : {}) });
          }
          t += recorded ? 0.07 + Math.random() * 0.09 : 0.03 + Math.random() * 0.04;
        }
      },
      /** A ball passing close by her: a rush of air as it goes over, `delayS` from now (its flight). */
      whistle(delayS: number, pan: number, gain: number) {
        if (ctx?.state !== 'running') return;
        sfx?.play('ball_whistle', { when: ctx.currentTime + delayS, gain: gain * BATTLE_MIX.whistle, pan, rate: 0.9 + Math.random() * 0.2 });
      },
      /** A ball striking home: splintering timber, canvas tearing, or grape rattling across her deck. */
      hit(kind: 'hull' | 'sail' | 'grape', pan: number, gain: number) {
        if (ctx?.state !== 'running' || !noise) return;
        const now = ctx.currentTime;
        if (kind === 'grape') {
          if (sfx?.has('musket')) sfx.play('musket', { gain: gain * BATTLE_MIX.grape, pan, rate: 0.9 + Math.random() * 0.25 });
          else strike(now, placed(now, pan, gain * 0.6), 'hull');
          return;
        }
        const synth = kind === 'hull' ? BATTLE_MIX.hullSynth : BATTLE_MIX.sailSynth;
        strike(now, placed(now, pan, gain * synth * (sfx?.has(kind === 'hull' ? 'wood_hit' : 'sail_tear') ? 0.5 : 1)), kind);
        // Pitched down: the clips are light timber; a hull is heavy oak.
        if (kind === 'hull') sfx?.play('wood_hit', { gain: gain * BATTLE_MIX.hull, pan, rate: 0.55 + Math.random() * 0.2, lowpass: 3000 });
        else sfx?.play('sail_tear', { gain: gain * BATTLE_MIX.sail, pan, rate: 0.9 + Math.random() * 0.2 });
      },
      /** A mast going by the board: timber cracking and the spar coming down. */
      mast(pan: number, gain: number) {
        if (ctx?.state !== 'running') return;
        sfx?.play('mast_crack', { gain: gain * BATTLE_MIX.mast, pan, rate: 0.8 + Math.random() * 0.15, lowpass: 4000 });
      },
      /** Hulls grappled: the boarders' fight (blades and shouting) and a ragged volley of small arms. */
      boarding(pan: number, gain: number) {
        if (ctx?.state !== 'running') return;
        sfx?.play('melee', { gain: gain * BATTLE_MIX.melee, pan, rate: 0.95 + Math.random() * 0.1 });
        sfx?.play('musket', { when: ctx.currentTime + 0.2 + Math.random() * 0.6, gain: gain * BATTLE_MIX.volley, pan: pan + 0.2, rate: 0.9 + Math.random() * 0.2 });
      },
      /** She goes down: a deep explosion (her powder, or her back broken). */
      explosion(pan: number, gain: number) {
        if (ctx?.state !== 'running') return;
        sfx?.play('explosion', { gain: gain * BATTLE_MIX.explosion, pan, rate: 0.7 + Math.random() * 0.15, lowpass: 3500 });
      },
      /** The fight won: her crew cheering. */
      cheer() {
        if (ctx?.state !== 'running') return;
        sfx?.play('cheer', { gain: BATTLE_MIX.cheer, pan: 0, rate: 0.95 + Math.random() * 0.1 });
      },
      splash(pan: number, gain: number) {
        if (ctx?.state !== 'running') return;
        sfx?.play(Math.random() < 0.3 ? 'splash_big' : 'splash_small', { gain: gain * BATTLE_MIX.splash, pan, rate: 0.9 + Math.random() * 0.3 });
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
        sfx: sfx?.loaded() ?? [],
      };
    },
  };
}

export type Audio = ReturnType<typeof createAudio>;
