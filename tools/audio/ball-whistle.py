"""A cannonball going over: air shrieking past it, its pitch falling as it passes (Doppler), loudest as it goes by.
Noise through a resonant band-pass whose centre falls, with a faint tone riding the same glide.
The game ships shriek_a, shriek_c and shriek_b as art/audio/sfx/ball_whistle_1, _2 and _3 (credited in combat-sfx.json).
Usage: python3 tools/audio/ball-whistle.py <out dir> (numpy, scipy, soundfile)"""
import os, sys
import numpy as np
import soundfile as sf
from scipy.signal import lfilter

SR = 22050
out = sys.argv[1]
os.makedirs(out, exist_ok=True)
rng = np.random.default_rng(7)


def bandpass(x, f, q):
    # Time-varying RBJ band-pass, block by block (64 samples).
    y = np.zeros_like(x)
    zi = np.zeros(2)
    for s in range(0, len(x), 64):
        w = 2 * np.pi * f[s] / SR
        a = np.sin(w) / (2 * q)
        b = np.array([a, 0, -a]) / (1 + a)
        den = np.array([1, -2 * np.cos(w) / (1 + a), (1 - a) / (1 + a)])
        y[s:s + 64], zi = lfilter(b, den, x[s:s + 64], zi=zi)
    return y


def ball(dur, f0, f1, q, tone, apex, name):
    n = int(dur * SR)
    t = np.arange(n) / SR
    # Pitch falls through the pass, fastest as it goes by (a Doppler curve).
    k = 1 / (1 + np.exp(-(t - apex * dur) * 9 / dur))
    f = f0 + (f1 - f0) * k
    air = bandpass(rng.standard_normal(n), f, q)
    phase = 2 * np.pi * np.cumsum(f) / SR
    sig = air / (np.max(np.abs(air)) + 1e-9) + tone * np.sin(phase)
    # Swells in, loudest just after it passes overhead, dies away.
    env = np.exp(-((t - apex * dur) / (0.22 * dur)) ** 2) * np.where(t < apex * dur, 1, 1)
    env = env * (1 - np.exp(-t * 40))
    y = sig * env
    y = y / np.max(np.abs(y)) * 10 ** (-1 / 20)
    sf.write(os.path.join(out, name + '.wav'), y.astype(np.float32), SR, subtype='PCM_16')


ball(1.4, 1500, 520, 9, 0.15, 0.55, 'shriek_a')
ball(1.2, 1100, 380, 6, 0.08, 0.5, 'shriek_b')
ball(1.6, 1900, 700, 12, 0.25, 0.6, 'shriek_c')
ball(1.0, 900, 300, 4, 0.0, 0.45, 'shriek_d')
