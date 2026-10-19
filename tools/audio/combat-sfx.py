"""Render the combat SFX set (sea battles) into art/audio/sfx and print stats.

Each output is cut from one source (or several clips of one pack), mixed to mono 22.05 kHz (as
prepare.ts's SFX), leading silence trimmed, faded, peak-normalised to -1 dBFS and written as
16-bit WAV. Where each comes from, and its licence, is in combat-sfx.json (merged into
art/audio/CREDITS.json by prepare.ts); download those sources into the download directory first
(archives unpacked with bsdtar, which also opens 7z).

Run from the repo root: python3 tools/audio/combat-sfx.py art/audio/sfx <download dir>"""
import array, math, os, subprocess, sys, wave

OUT = sys.argv[1]  # art/audio/sfx
DL = sys.argv[2]  # where the sources were downloaded
FF = 'ffmpeg'
SR = 22050
PEAK = 10 ** (-1 / 20)


def load(src, start=0.0, dur=None, af=None):
    cmd = [FF, '-v', 'error', '-ss', str(start)]
    if dur:
        cmd += ['-t', str(dur)]
    cmd += ['-i', os.path.join(DL, src)]
    chain = ['aresample=22050'] + ([af] if af else [])
    cmd += ['-af', ','.join(chain), '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-']
    r = subprocess.run(cmd, capture_output=True, check=True)
    a = array.array('f'); a.frombytes(r.stdout)
    return list(a)


def mix(parts):
    """parts: list of (offset_s, samples)."""
    n = max(int(o * SR) + len(s) for o, s in parts)
    out = [0.0] * n
    for o, s in parts:
        k = int(o * SR)
        for i, v in enumerate(s):
            out[k + i] += v
    return out


def finish(x, trim=True, fade_in=0.004, fade_out=None):
    pk = max(abs(v) for v in x)
    if trim:
        first = next(i for i, v in enumerate(x) if abs(v) > pk * 0.05)
        x = x[max(0, first - int(0.005 * SR)):]
    n = len(x)
    fi = int(fade_in * SR)
    fo = int((fade_out if fade_out is not None else min(0.3, max(0.02, n / SR * 0.15))) * SR)
    for i in range(min(fi, n)):
        x[i] *= i / fi
    for i in range(min(fo, n)):
        x[n - 1 - i] *= i / fo
    pk = max(abs(v) for v in x)
    g = PEAK / pk
    return [v * g for v in x]


def write(name, x):
    path = os.path.join(OUT, name)
    pcm = array.array('h', (max(-32767, min(32767, int(round(v * 32767)))) for v in x))
    with wave.open(path, 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    rms = math.sqrt(sum(v * v for v in x) / len(x))
    print(f'{name:22} {len(x)/SR:5.2f}s  {os.path.getsize(path)/1024:6.0f} KB  rms {20*math.log10(rms):6.1f} dBFS')


PITCH_06 = 'asetrate=13230,aresample=22050'  # play 0.6x: slower and lower
LOOP = dict(trim=False, fade_in=0.08, fade_out=0.25)

JOBS = {
    'cannon_close_1.wav': lambda: finish(load('c_01_Salute_Cannon_Reveille.ogg', 0.40, 2.45), fade_out=0.45),
    'cannon_close_2.wav': lambda: finish(load('x_qubodup-NavalBattleSoundSet-cc0_0/qubodup-NavalBattleSoundSet-cc0/GunShotGverb.wav')),
    'cannon_close_3.wav': lambda: finish(load('x_25-CC0-bang-sfx/cannon_02.ogg')),
    'cannon_far_1.wav': lambda: finish(load('c_Fireworks_in_distance_1.ogg', 4.90, 1.7), fade_out=0.7),
    'cannon_far_2.wav': lambda: finish(load('c_Fireworks_in_distance_1.ogg', 8.20, 2.3), fade_out=0.4),
    'cannon_far_3.wav': lambda: finish(load('c_Fireworks_in_distance_5.ogg', 19.50, 1.2), fade_out=0.3),
    'ball_whistle_1.wav': lambda: finish(load('x_swoshes/swosh-31.flac', af=PITCH_06)),
    'ball_whistle_2.wav': lambda: finish(load('x_swoshes/swosh-28.flac', af=PITCH_06)),
    'ball_whistle_3.wav': lambda: finish(load('x_swoshes/swosh-41.flac', af=PITCH_06)),
    'wood_hit_1.wav': lambda: finish(load('x_100-CC0-wood-metal-SFX/wood_breaking_01.ogg')),
    'wood_hit_2.wav': lambda: finish(load('x_100-CC0-wood-metal-SFX/wood_breaking_02.ogg')),
    'wood_hit_3.wav': lambda: finish(load('x_sfx_breaking_and_falling/bfh1_wood_breaking_03.ogg')),
    'sail_tear_1.wav': lambda: finish(load('x_MoreSounds/Velcro/Velcro_01.wav')),
    'sail_tear_2.wav': lambda: finish(load('x_MoreSounds/Velcro/Velcro_02.wav')),
    'sail_tear_3.wav': lambda: finish(load('paper_ripped_-_1.mp3')),
    'mast_crack_1.wav': lambda: finish(load('chop-tree-fall.ogg', 0.95)),
    'mast_crack_2.wav': lambda: finish(mix([
        (0.00, load('x_100-CC0-wood-metal-SFX/wood_cracking_04.ogg')),
        (0.30, load('x_100-CC0-wood-metal-SFX/wood_cracking_02.ogg')),
        (0.62, load('x_100-CC0-wood-metal-SFX/wood_cracking_03.ogg')),
        (1.05, load('x_100-CC0-wood-metal-SFX/wood_falling_05.ogg')),
    ])),
    'musket_1.wav': lambda: finish(load('Black%20Powder.wav', 0.05, 0.70)),
    'musket_2.wav': lambda: finish(load('Black%20Powder.wav', 1.50, 0.70)),
    'musket_3.wav': lambda: finish(load('c_3_Volley_Salute_-_US_Army_Funeral.ogg', 18.85, 2.0), fade_out=0.3),
    'melee_1.wav': lambda: finish(load('crowd_shouting_0.ogg', 0.5, 5.5), **LOOP),
    'melee_2.wav': lambda: finish(load('crowd_shouting_0.ogg', 12.0, 5.5), **LOOP),
    'melee_3.wav': lambda: finish(mix([
        (0.00, load('x_sword_clash_-_starninjas_0/sword_clash.1.ogg')),
        (0.85, load('x_sword_clash_-_starninjas_0/sword_clash.3.ogg')),
        (1.40, load('x_sword_clash_-_starninjas_0/sword_clash.5.ogg')),
        (2.55, load('x_sword_clash_-_starninjas_0/sword_clash.8.ogg')),
        (3.20, load('x_sword_clash_-_starninjas_0/sword_clash.2.ogg')),
        (4.30, load('x_sword_clash_-_starninjas_0/sword_clash.6.ogg')),
    ])),
    'cheer_1.wav': lambda: finish(load('c_Clapping_hurray.ogg', 0.3, 6.0), **LOOP),
    'cheer_2.wav': lambda: finish(load('c_Clapping_hurray.ogg', 6.0, 5.6), **LOOP),
    'cheer_3.wav': lambda: finish(load('c_Hurray.ogg', 0.3)),
    'explosion_1.wav': lambda: finish(load('x_qubodup-NavalBattleSoundSet-cc0_0/qubodup-NavalBattleSoundSet-cc0/ExplosionMetal.wav')),
    'explosion_2.wav': lambda: finish(load('c_Explosion-LS100155.ogg', 0.80)),
    'explosion_3.wav': lambda: finish(load('c_Explosions-LS100152.ogg', 0.50, 5.7), fade_out=0.6),
}

only = sys.argv[2:]
for name, job in JOBS.items():
    if only and name not in only:
        continue
    write(name, job())
