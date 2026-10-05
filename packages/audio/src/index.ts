import { ambienceTargets } from './mix';
import type { AmbienceTargets, AudioInputs } from './mix';

export * from './mix';

// Ambience is synthesised from one shared noise buffer shaped by filters, so every layer can follow
// the game smoothly (no loops to crossfade). The engine only listens: it reads what the game passes
// it each frame and never changes the sim.

const GLIDE_S = 0.25; // time constant for layer volumes following their targets
const MASTER = 0.6;
const MUTE_KEY = 'corsair.muted';

type Layer = { gain: GainNode; filter: BiquadFilterNode };

export interface AudioLevels {
  state: AudioContextState | 'locked';
  muted: boolean;
  targets: AmbienceTargets | undefined;
  /** RMS of what the speakers get right now (0 when muted or locked), so tests can tell sound is playing. */
  rms: number;
}

export function createAudio() {
  let ctx: AudioContext | undefined;
  let master: GainNode | undefined;
  let meter: AnalyserNode | undefined;
  let noise: AudioBuffer | undefined;
  let layers: Record<'wavesLow' | 'wavesWash' | 'wind' | 'rush' | 'surf' | 'rain' | 'luff', Layer> | undefined;
  let targets: AmbienceTargets | undefined;
  let wasLuffing = false;
  let nextFlap = 0;
  let muted = false;
  try {
    muted = localStorage.getItem(MUTE_KEY) === '1';
  } catch {
    // Storage can be blocked; sound simply starts unmuted.
  }

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
      if (wasLuffing && t.luff === 0 && inputs.sailsSet) thump();
      wasLuffing = t.luff > 0;

    },
    /** For the debug API and tests: what the mixer is aiming at, and whether sound can play. */
    levels(): AudioLevels {
      let rms = 0;
      if (meter) {
        const buf = new Float32Array(meter.fftSize);
        meter.getFloatTimeDomainData(buf);
        rms = Math.sqrt(buf.reduce((sum, v) => sum + v * v, 0) / buf.length);
      }
      return { state: ctx ? ctx.state : 'locked', muted, targets, rms };
    },
  };
}

export type Audio = ReturnType<typeof createAudio>;
