"""Builds a low-poly ship class and renders its world-map set: 23 sail sprites x 32 facings at 96 px.

Same camera, passes, palette snap, outline, file naming and waterline pivot as tools/art/render_brig.py,
so a class drops into the game under the brig's 23 animation names. Classes: fluyt, sloop, frigate.

Run from the repo root:
  /Applications/Blender.app/Contents/MacOS/Blender -b --python tools/art/render_ships.py -- "$PWD" <tmp dir> <class>
Add --check to verify the class's outputs instead of rendering (use class `all` to check every class).
Add --state <name> to render a single sail state while working on a model.
"""
import bpy, math, os, sys
import numpy as np
from mathutils import Vector

ARGS = sys.argv[sys.argv.index('--') + 1:]
REPO, TMP, CLASS = ARGS[0], ARGS[1], ARGS[2]
CHECK = '--check' in ARGS
ONLY = ARGS[ARGS.index('--state') + 1] if '--state' in ARGS else None
CLASSES = ('fluyt', 'sloop', 'frigate')
OUT = os.path.join(REPO, 'art/sources/renders/ships')
os.makedirs(OUT, exist_ok=True)
os.makedirs(TMP, exist_ok=True)
CELL, FACINGS = 96, 32
STATE_NAMES = ['furled'] + [f'{s}_{p}' for s in ('full', 'half') for p in
                            ['run'] + [f'{pt}_{t}' for t in ('s', 'p') for pt in ('broad', 'beam', 'close')]
                            + [f'irons_{t}{fr}' for t in ('s', 'p') for fr in (0, 1)]]


def hexrgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def check_outputs(classes):
    """Every sprite: present, 96x96 RGBA, alpha 0 or 255, opaque pixels in corsair.gpl, a clear 1 px cell border."""
    pal = set()
    for line in open(os.path.join(REPO, 'art/palette/corsair.gpl')):
        parts = line.split()
        if len(parts) >= 4 and all(p.isdigit() for p in parts[:3]):
            pal.add(tuple(int(p) for p in parts[:3]))
    bad = total = 0
    for cls in classes:
        for state in STATE_NAMES:
            for f in range(FACINGS):
                name = f'ship.{cls}.world.sail_{state}.f{f:02d}.png'
                path = os.path.join(OUT, name)
                total += 1
                if not os.path.exists(path):
                    print('CHECK MISSING', name); bad += 1; continue
                img = bpy.data.images.load(path)
                w, h, ch = img.size[0], img.size[1], img.channels
                a = np.empty(w * h * 4, dtype=np.float32)
                img.pixels.foreach_get(a)
                bpy.data.images.remove(img)
                px = np.rint(a.reshape(h, w, 4) * 255).astype(np.int32)
                alpha_ok = bool(np.isin(px[..., 3], (0, 255)).all())
                op = px[px[..., 3] == 255][:, :3]
                off = {tuple(c) for c in np.unique(op, axis=0)} - pal if len(op) else set()
                edge = int(px[0, :, 3].any() or px[-1, :, 3].any() or px[:, 0, 3].any() or px[:, -1, 3].any())
                ok = (w, h) == (CELL, CELL) and ch == 4 and alpha_ok and not off and not edge and len(op) > 0
                if not ok:
                    bad += 1
                    print('CHECK BAD', name, w, h, ch, 'alpha01' if alpha_ok else 'ALPHA', f'off-palette {sorted(off)[:4]}' if off else '', 'EDGE' if edge else '')
        print('CHECK class', cls, 'done')
    print('CHECK files', total, 'failures', bad)


if CHECK:
    check_outputs(CLASSES if CLASS == 'all' else (CLASS,))
    print('DONE')
    raise SystemExit(0)

assert CLASS in CLASSES, f'unknown class {CLASS}; one of {CLASSES}'

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene


def lin(c):
    c /= 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


MATS = {}


def mat(name, h):
    if name not in MATS:
        m = bpy.data.materials.new(name)
        m.diffuse_color = (*[lin(v) for v in hexrgb(h)], 1)
        MATS[name] = m
    return MATS[name]


root = bpy.data.objects.new(CLASS, None)
sc.collection.objects.link(root)


def obj(name, verts, faces, mats, idx=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    for m in mats:
        me.materials.append(m)
    if idx:
        for p, i in zip(me.polygons, idx):
            p.material_index = i
    o = bpy.data.objects.new(name, me)
    o.parent = root
    sc.collection.objects.link(o)
    return o


def box(name, x0, x1, y0, y1, z0, z1, m):
    v = [(x, y, z) for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)]
    f = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    return obj(name, v, f, [m])


def beam(name, p0, p1, t, m):
    p0, p1 = Vector(p0), Vector(p1)
    d = (p1 - p0).normalized()
    helper = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))
    a = d.cross(helper).normalized() * t
    b = d.cross(a).normalized() * t
    v = [tuple(p + s * a + u * b) for p in (p0, p1) for s, u in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    f = [(0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7), (0, 3, 2, 1), (4, 5, 6, 7)]
    return obj(name, v, f, [m])


hull_dark, band, deck, port = mat('hull', '602c2c'), mat('band', 'de9e41'), mat('deck', 'c09473'), mat('port', '241527')
mast = mat('mast', '4d2b32')
sail = mat('sail', 'ebede9')
slack = mat('slack', 'c7cfcc')
cabin = mat('cabin', 'ad7757')
grate = mat('grate', '4d2b32')


def hull(L, N, wf, hf, sect, smats):
    """Lofted hull, stern at -Y, bow at +Y, waterline at z 0 (the pivot), hull centre at y 0.
    wf(t), hf(t): half-width and rail height along the length (t 0 stern .. 1 bow).
    sect: cross-section (x fraction of wf, z fraction of hf) from the waterline up to the rail;
    smats: material per segment (0 dark hull, 1 ochre band). The deck spans the two rails.
    Returns the rail line [(x, y, z)] for the bulwark and fittings."""
    n = len(sect)
    verts, faces, idx, rails = [], [], [], []
    for i in range(N + 1):
        t = i / N
        y = -L / 2 + t * L
        w, h = wf(t), hf(t)
        rails.append((sect[-1][0] * w, y, h))
        verts += [(-xf * w, y, zf * h) for xf, zf in sect] + [(xf * w, y, zf * h) for xf, zf in reversed(sect)]
    m = 2 * n
    for i in range(N):
        a, b = m * i, m * (i + 1)
        for k in range(m - 1):
            faces.append((a + k, b + k, b + k + 1, a + k + 1))
            idx.append(smats[k] if k < n - 1 else 2 if k == n - 1 else smats[m - 2 - k])
    faces.append(tuple(range(m)))  # transom
    idx.append(0)
    obj('hull', verts, faces, [hull_dark, band, deck], idx)
    # bulwarks: a dark rim along the deck edge, as on the brig
    rv, rf = [], []
    for x, y, z in rails:
        rv += [(-x, y, z), (-x, y, z + 0.07), (x, y, z), (x, y, z + 0.07)]
    for i in range(N):
        a, b = 4 * i, 4 * (i + 1)
        rf += [(a, b, b + 1, a + 1), (a + 2, b + 2, b + 3, a + 3)]
    rf.append((0, 1, 3, 2))
    obj('bulwark', rv, rf, [hull_dark])
    return rails


def ports(L, wf, hf, sect_frac, ys, z0, z1, size=0.05):
    """Gunports on the hull side at the given stations, standing just proud of the planking."""
    for k, y in enumerate(ys):
        t = (y + L / 2) / L
        x = sect_frac * wf(t) + 0.012
        for s in (-1, 1):
            box(f'port{k}{s}', s * x - 0.012, s * x + 0.012, y - size, y + size, z0 * hf(t), z1 * hf(t), port)


def braced(p, ym, brace):
    """Rotate a point about a mast's vertical axis (x = 0, y = ym) by `brace` degrees, anticlockwise from above."""
    x, y, z = p
    c, s = math.cos(math.radians(brace)), math.sin(math.radians(brace))
    return (x * c - (y - ym) * s, ym + x * s + (y - ym) * c, z)


def square_sail(name, yc, zt, zb, wt, wb, billow, ripple=0.0, m=None, ym=0.0, brace=0.0):
    nx, ny = 8, 5
    v, f = [], []
    for j in range(ny + 1):
        for i in range(nx + 1):
            s, q = i / nx, j / ny
            w = wt + (wb - wt) * q
            x = (2 * s - 1) * w / 2
            z = zt + (zb - zt) * q
            y = yc + billow * (1 - (2 * s - 1) ** 2) * (0.5 + 0.5 * math.sin(math.pi * q))
            y += ripple * math.sin(4 * math.pi * s) * math.sin(math.pi * q)
            v.append(braced((x, y, z), ym, brace))
    for j in range(ny):
        for i in range(nx):
            a = j * (nx + 1) + i
            f.append((a, a + 1, a + nx + 2, a + nx + 1))
    return obj(name, v, f, [m or sail])


def yard(name, yc, zt, wt, ym, brace):
    half = wt / 2 + 0.06
    return beam(name + '_yard', braced((-half, yc, zt), ym, brace), braced((half, yc, zt), ym, brace), 0.02, mast)


def furl(name, yc, zt, wt, ym, brace):
    return beam(name + '_furl', braced((-wt / 2, yc, zt - 0.055), ym, brace), braced((wt / 2, yc, zt - 0.055), ym, brace), 0.035, sail)


def fore_aft_sail(name, corners, lee, belly, ripple, m, ym=0.0, swing=0.0):
    """A four-cornered fore-and-aft sail (tack, throat, peak, clew as (y, z) on the centreline), bellied
    `belly` toward x = lee sign, optional luffing folds, then swung about the mast at y = ym."""
    (ty, tz), (hy, hz), (py, pz), (cy, cz) = corners
    nx, ny = 6, 5
    v, f = [], []
    for j in range(ny + 1):
        for i in range(nx + 1):
            s, q = i / nx, j / ny  # s: luff -> leech, q: foot -> head
            fy, fz = ty + (cy - ty) * s, tz + (cz - tz) * s
            hy2, hz2 = hy + (py - hy) * s, hz + (pz - hz) * s
            y, z = fy + (hy2 - fy) * q, fz + (hz2 - fz) * q
            x = lee * belly * math.sin(math.pi * s) * (0.55 + 0.45 * math.sin(math.pi * q))
            x += ripple * math.sin(3 * math.pi * s) * math.sin(math.pi * q)
            v.append(braced((x, y, z), ym, swing))
    for j in range(ny):
        for i in range(nx):
            a = j * (nx + 1) + i
            f.append((a, a + 1, a + nx + 2, a + nx + 1))
    return obj(name, v, f, [m])


def jib(name, tack, head, clew, lee, m):
    """Tack and head on the centreline; the clew swings `lee` to leeward."""
    return obj(name, [(0, *tack), (0, *head), (lee, *clew)], [(0, 1, 2)], [m])


# Points of sail, as on the brig. point: (brace deg, belly x base billow, jib lee, spanker lee)
POINTS = {
    'run': (0, 2.8, 0.0, 0.0),
    'broad': (20, 2.8, 0.20, 0.35),
    'beam': (35, 2.4, 0.28, 0.45),
    'close': (45, 1.2, 0.32, 0.50),
    'irons': (45, 0.0, 0.08, 0.10),
}


def square_rig(squares, anim, setting, point, side, frame, furl_half):
    """Yards, canvas and furls for a square rig; same rules as the brig (half = courses furled)."""
    brace_deg, belly, _, _ = POINTS[point]
    brace = side * brace_deg
    objs = []
    for name, (ym, yc, zt, zb, wt, wb, billow) in squares.items():
        objs.append(yard(f'{anim}_{name}', yc, zt, wt, ym, brace))
        if setting == 'half' and furl_half(name):
            objs.append(furl(f'{anim}_{name}', yc, zt, wt, ym, brace))
        elif point == 'irons':
            ripple = 0.07 if frame == 0 else -0.07
            objs.append(square_sail(f'{anim}_{name}', yc, zt, zb + 0.08, wt, wb * 0.92, 0.0, ripple, slack, ym, brace))
        else:
            objs.append(square_sail(f'{anim}_{name}', yc, zt, zb, wt, wb, billow * belly, 0.0, sail, ym, brace))
    return objs


def furled_squares(squares):
    objs = []
    for name, (ym, yc, zt, zb, wt, wb, billow) in squares.items():
        objs += [yard(f'furled_{name}', yc, zt, wt, ym, 0), furl(f'furled_{name}', yc, zt, wt, ym, 0)]
    return objs


def build_states(rig, furled):
    states = {'furled': furled()}
    for setting in ('full', 'half'):
        states[f'{setting}_run'] = rig(f'{setting}_run', setting, 'run', 0, 0)
        for side, tack in ((1, 's'), (-1, 'p')):
            for point in ('broad', 'beam', 'close'):
                states[f'{setting}_{point}_{tack}'] = rig(f'{setting}_{point}_{tack}', setting, point, side, 0)
            for frame in (0, 1):
                states[f'{setting}_irons_{tack}{frame}'] = rig(f'{setting}_irons_{tack}{frame}', setting, 'irons', side, frame)
    assert sorted(states) == sorted(STATE_NAMES)
    return states


# Each class reports its hull length and main masthead (forward of the pivot, height above the waterline).
INFO = {}


def build_fluyt():
    # Bluff, pear-shaped Dutch merchant: wide at the waterline, strong tumblehome to a narrow deck,
    # a narrow high rounded stern, low freeboard amidships (deep laden). 1.1x the brig (2.4).
    L = 2.64

    def wf(t):
        if t < 0.30:  # rounded stern: narrows hard to a small transom
            return 0.50 * (0.30 + 0.70 * math.sin(math.pi / 2 * t / 0.30) ** 0.7)
        if t < 0.62:
            return 0.50
        u = (t - 0.62) / 0.38
        return 0.50 * math.sqrt(max(0.0, 1 - u ** 3.0))  # full, blunt bow

    def hf(t):
        poop = 0.34 * min(1.0, max(0.0, (0.27 - t) / 0.07))  # stepped high stern
        return 0.28 + poop + 0.10 * t ** 4

    sect = [(0.90, 0.0), (1.00, 0.40), (0.86, 0.80), (0.68, 1.0)]
    rails = hull(L, 32, wf, hf, sect, [0, 0, 1])
    ports(L, wf, hf, 0.93, (-0.35, 0.15, 0.65), 0.52, 0.68, size=0.035)
    box('cabin', -0.17, 0.17, -0.98, -0.80, hf(0.18), hf(0.18) + 0.10, cabin)  # poop house front
    box('hatch0', -0.10, 0.10, -0.15, 0.10, 0.28, 0.33, grate)
    box('hatch1', -0.09, 0.09, 0.45, 0.62, 0.28, 0.33, grate)
    masts = {'fore': (0.70, 1.62), 'main': (0.00, 1.86), 'mizzen': (-0.80, 1.30)}
    for name, (y, top) in masts.items():
        box(name, -0.03, 0.03, y - 0.03, y + 0.03, 0.2, top, mast)
    beam('bowsprit', (0, 1.18, 0.30), (0, 1.70, 0.62), 0.025, mast)
    SQUARES = {
        'fore_course': (0.70, 0.73, 1.00, 0.50, 0.84, 0.94, 0.10),
        'fore_top': (0.70, 0.73, 1.50, 1.06, 0.58, 0.76, 0.08),
        'main_course': (0.00, 0.03, 1.10, 0.52, 0.94, 1.04, 0.10),
        'main_top': (0.00, 0.03, 1.74, 1.16, 0.64, 0.86, 0.08),
    }
    # Spritsail under the bowsprit, braced with the rest; a period fluyt carried one, not a jib.
    SPRIT = {'sprit': (1.46, 1.48, 0.50, 0.24, 0.52, 0.56, 0.06)}
    MZ = -0.80

    def lateen(anim, lee, m, ripple=0.0, belly=0.0):
        # Long yard crossing the mizzen, low forward and high aft; the sail hangs below it.
        swing = math.degrees(math.atan2(lee, 0.8))  # aft end of the yard to leeward
        tack, peak, clew = (MZ + 0.42, 0.62), (MZ - 0.62, 1.42), (MZ - 0.52, 0.58)
        objs = [beam(f'{anim}_lateen_yard', braced((0, MZ + 0.50, 0.56), MZ, swing), braced((0, MZ - 0.70, 1.48), MZ, swing), 0.02, mast)]
        objs.append(fore_aft_sail(f'{anim}_lateen', (tack, tack, peak, clew), 1 if lee >= 0 else -1, belly, ripple, m, MZ, swing))
        return objs

    def rig(anim, setting, point, side, frame):
        _, belly, _, sp_lee = POINTS[point]
        objs = square_rig({**SQUARES, **SPRIT}, anim, setting, point, side, frame, lambda n: n.endswith('course'))
        luff = point == 'irons'
        canvas = slack if luff else sail
        if setting == 'full':
            objs += lateen(anim, -side * sp_lee, canvas, (0.05 if frame == 0 else -0.05) if luff else 0.0, 0.0 if luff else 0.05)
        else:  # half: the lateen is brailed up along its yard, which still swings with the tack
            swing = math.degrees(math.atan2(-side * sp_lee, 0.8))
            objs.append(beam(f'{anim}_lateen_yard', braced((0, MZ + 0.50, 0.56), MZ, swing), braced((0, MZ - 0.70, 1.48), MZ, swing), 0.02, mast))
            objs.append(beam(f'{anim}_lateen_furl', braced((0, MZ + 0.42, 0.56), MZ, swing), braced((0, MZ - 0.62, 1.40), MZ, swing), 0.035, sail))
        return objs

    def furled():
        objs = furled_squares({**SQUARES, **SPRIT})
        objs.append(beam('furled_lateen_yard', (0, MZ + 0.50, 0.56), (0, MZ - 0.70, 1.48), 0.02, mast))
        objs.append(beam('furled_lateen_furl', (0, MZ + 0.42, 0.56), (0, MZ - 0.62, 1.40), 0.035, sail))
        return objs

    INFO.update(hull_length=L, main_masthead=masts['main'])
    return build_states(rig, furled)


def build_sloop():
    # Low, sleek single-master: gaff main on a long boom plus a jib. 0.75x the brig.
    L = 1.80

    def wf(t):
        if t < 0.45:
            return 0.24 + 0.07 * math.sin(math.pi / 2 * t / 0.45)
        u = (t - 0.45) / 0.55
        return 0.31 * math.sqrt(max(0.0, 1 - u ** 2.0))  # fine entry

    def hf(t):
        return 0.21 + 0.05 * (1 - t) ** 3 + 0.07 * t ** 4

    sect = [(0.80, 0.0), (0.96, 0.62), (0.99, 0.82), (1.0, 1.0)]
    hull(L, 28, wf, hf, sect, [0, 1, 0])
    ports(L, wf, hf, 0.98, (-0.42, -0.08, 0.26), 0.58, 0.82, size=0.035)
    box('hatch0', -0.08, 0.08, -0.18, -0.02, 0.22, 0.26, grate)
    box('companion', -0.09, 0.09, -0.62, -0.46, 0.23, 0.30, cabin)
    MY, TOP = 0.22, 1.86
    box('mast', -0.03, 0.03, MY - 0.03, MY + 0.03, 0.2, TOP, mast)
    beam('bowsprit', (0, 0.80, 0.27), (0, 1.48, 0.40), 0.022, mast)
    TACK, THROAT, PEAK, CLEW = (MY - 0.05, 0.42), (MY - 0.05, 1.42), (-0.86, 1.76), (-1.12, 0.46)
    BOOM = (-1.16, 0.42)
    # point: boom swing deg (to leeward), jib clew lee, main belly
    SWING = {'run': (80, 0.42, 0.16), 'broad': (55, 0.36, 0.16), 'beam': (35, 0.28, 0.14),
             'close': (12, 0.14, 0.08), 'irons': (3, 0.03, 0.0)}

    def main(anim, swing, setting, m, lee, belly, ripple):
        objs = [beam(f'{anim}_boom', braced((0, MY, 0.42), MY, swing), braced((0, *BOOM), MY, swing), 0.025, mast)]
        if setting == 'half':  # reefed: gaff lowered, foot bundled along the boom
            drop = 0.36
            throat, peak, tack, clew = (THROAT[0], THROAT[1] - drop), (PEAK[0], PEAK[1] - drop), (TACK[0], TACK[1] + 0.06), (CLEW[0] + 0.02, CLEW[1] + 0.06)
            objs.append(beam(f'{anim}_reef', braced((0, MY - 0.05, 0.48), MY, swing), braced((0, CLEW[0] + 0.02, 0.50), MY, swing), 0.03, sail))
        else:
            throat, peak, tack, clew = THROAT, PEAK, TACK, CLEW
        objs.append(beam(f'{anim}_gaff', braced((0, MY, throat[1]), MY, swing), braced((0, peak[0] - 0.04, peak[1] + 0.02), MY, swing), 0.02, mast))
        objs.append(fore_aft_sail(f'{anim}_main', (tack, throat, peak, clew), lee, belly, ripple, m, MY, swing))
        return objs

    def rig(anim, setting, point, side, frame):
        swing_deg, jib_lee, belly = SWING[point]
        luff = point == 'irons'
        canvas = slack if luff else sail
        lee = -side if side else -1  # run: the boom goes out to port, wind dead aft
        if luff:  # the slack boom also swings a little between the two flap frames
            swing_deg += 0 if frame == 0 else 6
        swing = lee * swing_deg  # braced(): positive is anticlockwise from above, which takes the aft end to +x
        ripple = (0.10 if frame == 0 else -0.10) if luff else 0.0
        objs = main(anim, swing, setting, canvas, lee, belly, ripple)
        jl = lee * jib_lee + (ripple * 0.8 if luff else 0.0)
        objs.append(jib(f'{anim}_jib', (1.44, 0.42), (MY + 0.04, 1.62), (0.46, 0.34), jl, canvas))
        return objs

    def furled():
        return [beam('furled_boom', (0, MY, 0.42), (0, *BOOM), 0.025, mast),
                beam('furled_roll', (0, MY - 0.05, 0.49), (0, -1.08, 0.49), 0.042, sail),
                beam('furled_gaff', (0, MY, 0.58), (0, -0.92, 0.56), 0.02, mast)]

    INFO.update(hull_length=L, main_masthead=(MY, TOP))
    return build_states(rig, furled)


def build_frigate():
    # Long, low naval hull with a continuous gun deck (ochre band, a row of ports), raised quarterdeck,
    # three masts fully square-rigged. 1.35x the brig.
    L = 3.24

    def wf(t):
        if t < 0.40:
            return 0.36 + 0.10 * math.sin(math.pi / 2 * t / 0.40)
        u = (t - 0.40) / 0.60
        return 0.46 * math.sqrt(max(0.0, 1 - u ** 2.2))

    def hf(t):
        qd = 0.08 * min(1.0, max(0.0, (0.34 - t) / 0.03))  # quarterdeck step
        fc = 0.04 * min(1.0, max(0.0, (t - 0.80) / 0.03))  # forecastle
        return 0.33 + qd + fc + 0.03 * (1 - t) ** 4 + 0.06 * t ** 4

    sect = [(0.84, 0.0), (0.97, 0.40), (1.0, 0.76), (0.95, 1.0)]
    hull(L, 40, wf, hf, sect, [0, 1, 0])
    ports(L, wf, hf, 1.0, [-1.12 + k * 0.23 for k in range(11)], 0.48, 0.68, size=0.04)
    box('cabin', -0.26, 0.26, -1.50, -1.30, hf(0.1), hf(0.1) + 0.08, cabin)
    for k, y in enumerate((-0.40, 0.35)):
        box(f'hatch{k}', -0.10, 0.10, y - 0.10, y + 0.10, 0.33, 0.37, grate)
    box('boat', -0.12, 0.12, -0.12, 0.20, 0.34, 0.41, cabin)
    masts = {'fore': (0.75, 2.06), 'main': (0.05, 2.28), 'mizzen': (-0.85, 1.86)}
    for name, (y, top) in masts.items():
        box(name, -0.03, 0.03, y - 0.03, y + 0.03, 0.2, top, mast)
    beam('bowsprit', (0, 1.50, 0.40), (0, 1.73, 0.80), 0.025, mast)
    SQUARES = {
        # The fore topgallant sits a little low: braced yard ends at f00 would otherwise touch the cell top.
        'fore_course': (0.75, 0.78, 1.08, 0.52, 1.14, 1.24, 0.10),
        'fore_top': (0.75, 0.78, 1.62, 1.14, 0.84, 1.06, 0.08),
        'fore_tgallant': (0.75, 0.78, 1.96, 1.68, 0.56, 0.76, 0.06),
        'main_course': (0.05, 0.08, 1.18, 0.56, 1.26, 1.36, 0.10),
        'main_top': (0.05, 0.08, 1.80, 1.24, 0.92, 1.16, 0.08),
        'main_tgallant': (0.05, 0.08, 2.18, 1.86, 0.62, 0.84, 0.06),
        'mizzen_top': (-0.85, -0.82, 1.50, 1.06, 0.70, 0.86, 0.07),
        'mizzen_tgallant': (-0.85, -0.82, 1.78, 1.56, 0.46, 0.62, 0.05),
    }

    def spanker(anim, lee, m):
        return obj(f'{anim}_spanker', [(0, -0.90, 0.66), (0, -0.90, 1.30), (lee, -1.52, 1.14), (lee, -1.62, 0.66)], [(0, 1, 2, 3)], [m])

    def rig(anim, setting, point, side, frame):
        _, _, jib_lee, sp_lee = POINTS[point]
        objs = square_rig(SQUARES, anim, setting, point, side, frame, lambda n: n.endswith('course'))
        canvas = slack if point == 'irons' else sail
        objs.append(jib(f'{anim}_jib', (1.72, 0.78), (0.83, 1.66), (1.20, 0.62), -side * jib_lee, canvas))
        if setting == 'full':
            objs.append(spanker(anim, -side * sp_lee, canvas))
        return objs

    INFO.update(hull_length=L, main_masthead=masts['main'])
    return build_states(rig, lambda: furled_squares(SQUARES))


STATES = {'fluyt': build_fluyt, 'sloop': build_sloop, 'frigate': build_frigate}[CLASS]()
print('INFO', CLASS, INFO)

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(REPO, f'art/sources/blender/{CLASS}-45.blend'))

# --- render setup: identical to render_brig.py ---
sc.render.engine = 'BLENDER_WORKBENCH'
sc.display.shading.light = 'STUDIO'
sc.display.shading.color_type = 'MATERIAL'
sc.display.shading.show_cavity = False
sc.display.render_aa = 'OFF'
sc.view_settings.view_transform = 'Standard'
sc.render.film_transparent = True
sc.render.filter_size = 0
sc.render.resolution_percentage = 100
sc.render.image_settings.file_format = 'PNG'
sc.render.image_settings.color_mode = 'RGBA'

cam_data = bpy.data.cameras.new('cam')
cam_data.type = 'ORTHO'
cam = bpy.data.objects.new('cam', cam_data)
sc.collection.objects.link(cam)
sc.camera = cam

OUTLINE = np.array(hexrgb('241527'), dtype=np.float32) / 255


def load(path):
    img = bpy.data.images.load(path)
    w, h = img.size
    a = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    bpy.data.images.remove(img)
    return a.reshape(h, w, 4)[::-1].copy()


def save(arr, path):
    h, w = arr.shape[:2]
    img = bpy.data.images.new('tmp', w, h, alpha=True)
    img.pixels.foreach_set(arr[::-1].astype(np.float32).ravel())
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    bpy.data.images.remove(img)


RAMPS = {
    '602c2c': ['341c27', '602c2c', '884b2b'],
    'de9e41': ['be772b', 'de9e41', 'e8c170'],
    'c09473': ['7a4841', 'ad7757', 'c09473'],
    '241527': ['241527', '241527', '241527'],
    'ad7757': ['4d2b32', '7a4841', '884b2b'],
    '4d2b32': ['341c27', '4d2b32', '7a4841'],
    'ebede9': ['c7cfcc', 'e7d5b3', 'ebede9'],
    'c7cfcc': ['577277', '819796', 'a8b5b2'],
    'a53030': ['752438', 'a53030', 'cf573c'],
}
BASE = np.array([hexrgb(h) for h in RAMPS], dtype=np.float32) / 255
RAMP = np.array([[hexrgb(h) for h in r] for r in RAMPS.values()], dtype=np.float32) / 255


def snap(flat, lit):
    mask = flat[..., 3] > 0.5
    f, l = flat[..., :3], lit[..., :3]
    mid = ((f[:, :, None, :] - BASE[None, None]) ** 2).sum(-1).argmin(-1)
    r = (l.sum(-1) + 1e-3) / (f.sum(-1) + 1e-3)
    step = np.where(r < 0.42, 0, np.where(r > 0.66, 2, 1))
    out = np.zeros_like(flat)
    out[..., :3] = RAMP[mid, step]
    out[..., 3] = mask
    out[~mask] = 0
    n = np.zeros_like(mask)
    n[1:] |= mask[:-1]; n[:-1] |= mask[1:]; n[:, 1:] |= mask[:, :-1]; n[:, :-1] |= mask[:, 1:]
    ring = n & ~mask
    out[ring, :3] = OUTLINE
    out[ring, 3] = 1
    return out


# Locked world-map camera, as for the brig: ortho 3.7 looking at z 0.6, so the waterline pivot is (0.5, 0.615).
cam_data.ortho_scale = 3.7
cam_data.clip_end = 100
T = Vector((0, 0, 0.6))
e = math.radians(45)
cam.location = T + Vector((0, -math.cos(e), math.sin(e))) * 20
cam.rotation_euler = (T - cam.location).to_track_quat('-Z', 'Y').to_euler()
sc.render.resolution_x = sc.render.resolution_y = CELL

tmp = os.path.join(TMP, f'{CLASS}_pass.png')
for state, objs in STATES.items():
    if ONLY and state != ONLY:
        continue
    for other, others in STATES.items():
        for o in others:
            o.hide_render = other != state
    for f in range(FACINGS):
        root.rotation_euler = (0, 0, -math.radians(360 / FACINGS * f))
        passes = []
        for light in ('FLAT', 'STUDIO'):
            sc.display.shading.light = light
            sc.render.filepath = tmp
            bpy.ops.render.render(write_still=True)
            passes.append(load(tmp))
        save(snap(*passes), os.path.join(OUT, f'ship.{CLASS}.world.sail_{state}.f{f:02d}.png'))
print('DONE')
