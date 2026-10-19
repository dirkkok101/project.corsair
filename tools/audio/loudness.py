"""Momentary loudness (400 ms, the EBU window) at its loudest, and the true peak, for each recording (takes named
<sound>~<n>.wav are averaged), as battle-mix.mjs records them. Usage: loudness.py <dir> [--describe]"""
import glob, os, sys
import numpy as np
import pyloudnorm as pyln
import soundfile as sf
from scipy.signal import resample_poly

d = sys.argv[1]
describe = '--describe' in sys.argv
rows = []
for f in sorted(glob.glob(os.path.join(d, '*.wav'))):
    x, sr = sf.read(f, always_2d=True)
    meter = pyln.Meter(sr, block_size=0.4)
    hop = int(0.1 * sr)
    win = int(0.4 * sr)
    ms = []
    for s in range(0, max(1, len(x) - win), hop):
        try:
            ms.append(meter.integrated_loudness(x[s:s + win]))
        except Exception:
            pass
    ms = [m for m in ms if np.isfinite(m)]
    top = max(ms) if ms else float('-inf')
    # True peak: 4x oversampled.
    tp = 20 * np.log10(np.max(np.abs(resample_poly(x, 4, 1, axis=0))) + 1e-12)
    rows.append((os.path.basename(f)[:-4], top, tp))
groups = {}
for name, top, tp in rows:
    groups.setdefault(name.split('~')[0], []).append((top, tp))
for name, v in groups.items():
    tops = [t for t, _ in v]
    print(f'{name:16s} momentary max {np.mean(tops):6.1f} LUFS (range {min(tops):6.1f}..{max(tops):6.1f}, {len(v)} takes)   true peak max {max(p for _, p in v):6.1f} dBTP')
if describe:
    import earshot
    for name, _, _ in rows:
        r = earshot.describe(os.path.join(d, name + '.wav'))
        tags = r.get('tags') if isinstance(r, dict) else None
        print(name, '->', (tags or r)[:6] if isinstance(tags or r, list) else str(r)[:300])
