"""Synthesised battle sounds the recordings couldn't give us: heavy canvas tearing, and men shouting in a boarding
fight. Original sounds (CC0), judged with earshot against what they're meant to be.

- sail_tear: a run of fibre snaps (short clicks through a band-pass, bunched as the rip runs and thinning as it
  stops) over a ripping band of noise, and a low flap of the canvas giving way.
- shouts (not shipped): men's voices from a glottal pulse through gliding vowel formants, laid ragged over each
  other. Three passes read to earshot as cows, then a robotic voice; under the sword clashes they added nothing, where
  real recorded crowds read as a sword fight with men shouting. Kept for reference.

The game ships sail_tear_1-3 (art/audio/sfx), judged canvas tearing 78%, 80% and 49% against velcro, paper and fire.
Usage: python3 tools/audio/battle-synth.py <out dir> (numpy, scipy, soundfile)"""
import os, sys
import numpy as np
import soundfile as sf
from scipy.signal import butter, lfilter, sosfilt

SR = 22050
out = sys.argv[1]
os.makedirs(out, exist_ok=True)


def save(name, y):
    y = y / (np.max(np.abs(y)) + 1e-9) * 10 ** (-1 / 20)
    n = len(y)
    # Faded in and out from silence, so neither end clicks.
    fade = int(0.01 * SR)
    y[-fade:] *= np.linspace(1, 0, fade)
    rise = int(0.003 * SR)
    y[:rise] *= np.linspace(0, 1, rise)
    sf.write(os.path.join(out, name + '.wav'), y.astype(np.float32), SR, subtype='PCM_16')


def band(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, hi], btype='band', fs=SR, output='sos'), x)


def tear(seed, dur, snaps, lo, hi, body, rise):
    rng = np.random.default_rng(seed)
    n = int(dur * SR)
    t = np.arange(n) / SR
    y = np.zeros(n)
    # The rip runs fast, then slows and stops: snap times bunched early (a beta draw).
    times = np.sort(rng.beta(1.3, 2.6, snaps)) * dur * 0.85 + 0.01
    for at in times:
        k = int(at * SR)
        m = int(rng.uniform(0.0015, 0.006) * SR)
        click = rng.standard_normal(m) * np.exp(-np.arange(m) / (m / 3))
        y[k:k + m] += click[: max(0, min(m, n - k))] * rng.uniform(0.3, 1)
    y = band(y, lo, hi)
    # The rip itself: noise swelling with the run of snaps, then gone.
    env = np.convolve(np.histogram(times, bins=n // 220, range=(0, dur))[0].astype(float), np.hanning(9), 'same')
    env = np.interp(t, np.linspace(0, dur, len(env)), env)
    env /= env.max() + 1e-9
    # Fibres parting one after another: the rip flutters at their rate (about 40-90 a second, faster as it runs).
    flutter = 0.55 + 0.45 * np.sign(np.sin(2 * np.pi * np.cumsum(rng.uniform(40, 90) * (1.3 - 0.6 * t / dur)) / SR))
    # And it zips up in pitch as it runs (what crackling fire lacks): the rip's band rises across it.
    noise = rng.standard_normal(n)
    rip = np.zeros(n)
    zi = np.zeros(2)
    for k in range(0, n, 128):
        c = (lo + hi) / 2 * (1 + (rise - 1) * k / n)
        w = 2 * np.pi * c / SR
        a = np.sin(w) / (2 * 1.2)
        b = np.array([a, 0, -a]) / (1 + a)
        den = np.array([1, -2 * np.cos(w) / (1 + a), (1 - a) / (1 + a)])
        rip[k:k + 128], zi = lfilter(b, den, noise[k:k + 128], zi=zi)
    rip = rip * env * flutter
    rip /= np.max(np.abs(rip)) + 1e-9
    # The canvas giving way: a low flap at the start.
    flap = band(rng.standard_normal(n), 80, 400) * np.exp(-t / 0.08) * body
    return 0.2 * y / (np.max(np.abs(y)) + 1e-9) + rip + flap


# Vowel formants (Hz, bandwidth) for a man's voice.
VOWELS = {
    'a': [(730, 90), (1090, 110), (2440, 160)],
    'o': [(570, 80), (840, 100), (2410, 160)],
    'e': [(530, 80), (1840, 120), (2480, 160)],
    'u': [(440, 80), (1020, 100), (2240, 160)],
}


def resonator(x, f, bw):
    r = np.exp(-np.pi * bw / SR)
    a = [1, -2 * r * np.cos(2 * np.pi * f / SR), r * r]
    return lfilter([1 - r], a, x)


def shout(rng, dur):
    n = int(dur * SR)
    t = np.arange(n) / SR
    # Pitch: a raised voice (170-280 Hz), up into the shout and falling away at its end, never quite steady.
    f0 = rng.uniform(170, 280)
    contour = f0 * (1.12 - 0.35 * (t / dur) ** 1.8)
    contour *= 1 + 0.015 * band(rng.standard_normal(n), 3, 40) / 0.2 + 0.01 * np.sin(2 * np.pi * rng.uniform(5, 7) * t)
    phase = np.cumsum(contour) / SR
    ph = phase % 1
    # A glottal flow pulse (Rosenberg: opening, closing, shut), and its slope as the source: a voice's own tilt.
    flow = np.where(ph < 0.4, 0.5 * (1 - np.cos(np.pi * ph / 0.4)), np.where(ph < 0.6, np.cos(np.pi * (ph - 0.4) / 0.4), 0))
    src = np.diff(flow, prepend=0) * 20
    # Breathy with effort: noise through the open glottis, and the loudness shimmering cycle to cycle.
    src += band(rng.standard_normal(n), 400, 5000) * (ph < 0.6) * 0.35
    src *= 1 + 0.15 * band(rng.standard_normal(n), 10, 60) / 0.2
    # The vowel, its formants gliding in from the consonant ("h", "y") and, for "hey", on toward "i".
    v = VOWELS[rng.choice(['a', 'a', 'o', 'e'])]
    glide = np.clip(t / 0.06, 0, 1)
    voice = np.zeros(n)
    for j, ((f, bw), g) in enumerate(zip(v, (1, 0.7, 0.4))):
        target = f * (1.15 if j == 0 else 1) * rng.uniform(0.95, 1.08)
        start = target * (0.7 if j == 0 else 1.15)
        fs = start + (target - start) * glide
        # Block-wise moving resonator.
        out_ = np.zeros(n)
        zi = np.zeros(2)
        for k in range(0, n, 64):
            r = np.exp(-np.pi * bw * 1.3 / SR)
            a = [1, -2 * r * np.cos(2 * np.pi * fs[k] / SR), r * r]
            out_[k:k + 64], zi = lfilter([1 - r], a, src[k:k + 64], zi=zi)
        voice += out_ * g
    voice /= np.max(np.abs(voice)) + 1e-9
    voice = np.tanh(voice * 1.6)
    attack = 1 - np.exp(-t / 0.015)
    release = np.clip((dur - t) / (0.3 * dur), 0, 1) ** 1.5
    return sosfilt(butter(2, 4500, fs=SR, output='sos'), voice) * attack * release


def crowd(seed, dur, voices):
    rng = np.random.default_rng(seed)
    n = int(dur * SR)
    y = np.zeros(n)
    for _ in range(voices):
        d = rng.uniform(0.18, 0.45)
        at = rng.uniform(0, dur - d)
        s = shout(rng, d) * rng.uniform(0.35, 1)
        k = int(at * SR)
        y[k:k + len(s)] += s[: n - k]
    # A little room: a few early reflections and a short tail.
    room = np.zeros(int(0.25 * SR))
    for d, g in [(0.013, 0.5), (0.027, 0.35), (0.041, 0.3), (0.063, 0.2)]:
        room[int(d * SR)] = g
    room += rng.standard_normal(len(room)) * np.exp(-np.arange(len(room)) / (0.06 * SR)) * 0.02
    room[0] = 1
    return band(np.convolve(y, room)[:n], 120, 6000)


for i, (seed, dur, snaps, lo, hi, body, rise) in enumerate([(8, 1.2, 900, 800, 4000, 0.4, 1.6), (8, 1.3, 900, 800, 4000, 0.3, 2.0), (21, 1.1, 800, 700, 3600, 0.4, 1.4)], 1):
    save(f'sail_tear_{i}', tear(seed, dur, snaps, lo, hi, body, rise))
for i, (seed, dur, voices) in enumerate([(11, 5.5, 40), (12, 5.5, 48), (13, 5.0, 34)], 1):
    save(f'shouts_{i}', crowd(seed, dur, voices))
