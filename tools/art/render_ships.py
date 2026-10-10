"""Builds a low-poly ship class and renders its world-map set: 23 sail sprites x 32 facings at 96 px.

Same camera, passes, palette snap, outline, file naming and waterline pivot as tools/art/render_brig.py,
so a class drops into the game under the brig's 23 animation names. Classes: fluyt, sloop, frigate, and
war_sloop, royal_sloop, barque, merchantman, brigantine, ship_of_the_line, galleon, treasure_galleon.

Run from the repo root:
  /Applications/Blender.app/Contents/MacOS/Blender -b --python tools/art/render_ships.py -- "$PWD" <tmp dir> <class>
Add --check to verify the class's outputs instead of rendering (use class `all` to check every class).
Add --state <name> to render a single sail state while working on a model.
The sea is drawn in 3D now; the game uses only the furled frames, for the player's ship at anchor in a harbour scene.
"""
import bpy, math, os, sys
import numpy as np
from mathutils import Vector

ARGS = sys.argv[sys.argv.index('--') + 1:]
REPO, TMP, CLASS = ARGS[0], ARGS[1], ARGS[2]
CHECK = '--check' in ARGS
ONLY = ARGS[ARGS.index('--state') + 1] if '--state' in ARGS else None
CLASSES = ('fluyt', 'sloop', 'frigate', 'war_sloop', 'royal_sloop', 'barque', 'merchantman', 'brigantine', 'ship_of_the_line',
           'galleon', 'treasure_galleon')
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
    """Every sprite: present, CELLxCELL RGBA, alpha 0 or 255, opaque pixels in corsair.gpl, a clear 1 px cell border."""
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
royal = mat('royal', '3c5e8b')  # a navy-blue hull (the royal sloop)


def hull(L, N, wf, hf, sect, smats, mats=None):
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
    obj('hull', verts, faces, mats or [hull_dark, band, deck], idx)
    # bulwarks: a dark rim along the deck edge, as on the brig
    rv, rf = [], []
    for x, y, z in rails:
        rv += [(-x, y, z), (-x, y, z + 0.07), (x, y, z), (x, y, z + 0.07)]
    for i in range(N):
        a, b = 4 * i, 4 * (i + 1)
        rf += [(a, b, b + 1, a + 1), (a + 2, b + 2, b + 3, a + 3)]
    rf.append((0, 1, 3, 2))
    obj('bulwark', rv, rf, [(mats or [hull_dark])[0]])
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


def clamp01(v):
    return min(1.0, max(0.0, v))


# Gaff sloops bigger than the sloop: her lines stretched by k along and kw across, a square topsail above
# the gaff, more gunports; the royal sloop in navy blue with a second jib.
SLOOP_SWING = {'run': (80, 0.42, 0.16), 'broad': (55, 0.36, 0.16), 'beam': (35, 0.28, 0.14),
               'close': (12, 0.14, 0.08), 'irons': (3, 0.03, 0.0)}


def gaff_main(anim, MY, TACK, THROAT, PEAK, CLEW, BOOM, swing, setting, m, lee, belly, ripple):
    """A gaff mainsail on its boom and gaff, swung `swing` deg about the mast at y = MY; half is reefed."""
    objs = [beam(f'{anim}_boom', braced((0, MY, TACK[1]), MY, swing), braced((0, *BOOM), MY, swing), 0.025, mast)]
    if setting == 'half':
        drop = 0.36
        throat, peak, tack, clew = (THROAT[0], THROAT[1] - drop), (PEAK[0], PEAK[1] - drop), (TACK[0], TACK[1] + 0.06), (CLEW[0] + 0.02, CLEW[1] + 0.06)
        objs.append(beam(f'{anim}_reef', braced((0, MY - 0.05, TACK[1] + 0.06), MY, swing), braced((0, CLEW[0] + 0.02, CLEW[1] + 0.04), MY, swing), 0.03, sail))
    else:
        throat, peak, tack, clew = THROAT, PEAK, TACK, CLEW
    objs.append(beam(f'{anim}_gaff', braced((0, MY, throat[1]), MY, swing), braced((0, peak[0] - 0.04, peak[1] + 0.02), MY, swing), 0.02, mast))
    objs.append(fore_aft_sail(f'{anim}_main', (tack, throat, peak, clew), lee, belly, ripple, m, MY, swing))
    return objs


def gaff_furled(MY, TACK, BOOM, CLEW):
    return [beam('furled_boom', (0, MY, TACK[1]), (0, *BOOM), 0.025, mast),
            beam('furled_roll', (0, MY - 0.05, TACK[1] + 0.07), (0, CLEW[0] + 0.04, TACK[1] + 0.07), 0.042, sail),
            beam('furled_gaff', (0, MY, TACK[1] + 0.16), (0, CLEW[0] + 0.24, TACK[1] + 0.14), 0.02, mast)]


def build_big_sloop(k, kw, top, nports, mats, second_jib):
    L = 1.80 * k

    def wf(t):
        if t < 0.45:
            return kw * (0.24 + 0.07 * math.sin(math.pi / 2 * t / 0.45))
        u = (t - 0.45) / 0.55
        return kw * 0.31 * math.sqrt(max(0.0, 1 - u ** 2.0))

    def hf(t):
        return 0.23 + 0.05 * (1 - t) ** 3 + 0.07 * t ** 4

    sect = [(0.80, 0.0), (0.96, 0.62), (0.99, 0.82), (1.0, 1.0)]
    hull(L, 28, wf, hf, sect, [0, 1, 0], mats)
    ports(L, wf, hf, 0.98, [k * (-0.52 + i * 0.86 / (nports - 1)) for i in range(nports)], 0.58, 0.82, size=0.035)
    box('hatch0', -0.08, 0.08, -0.18 * k, -0.02 * k, 0.24, 0.28, grate)
    box('companion', -0.09, 0.09, -0.62 * k, -0.46 * k, 0.25, 0.32, cabin)
    MY, TOP = 0.22 * k, top
    box('mast', -0.03, 0.03, MY - 0.03, MY + 0.03, 0.2, TOP, mast)
    beam('bowsprit', (0, 0.80 * k, 0.29), (0, 1.48 * k, 0.42), 0.022, mast)
    TACK, THROAT, PEAK, CLEW = (MY - 0.05, 0.44), (MY - 0.05, 1.42), (-0.86 * k, 1.70), (-1.12 * k, 0.48)
    BOOM = (-1.16 * k, 0.44)
    # The square topsail, above the gaff's jaws; kept set when the main is reefed.
    TOPSAIL = {'topsail': (MY, MY + 0.03, TOP - 0.10, 1.50, 0.52, 0.70, 0.06)}

    def rig(anim, setting, point, side, frame):
        swing_deg, jib_lee, belly = SLOOP_SWING[point]
        luff = point == 'irons'
        canvas = slack if luff else sail
        lee = -side if side else -1
        if luff:
            swing_deg += 0 if frame == 0 else 6
        swing = lee * swing_deg
        ripple = (0.10 if frame == 0 else -0.10) if luff else 0.0
        objs = gaff_main(anim, MY, TACK, THROAT, PEAK, CLEW, BOOM, swing, setting, canvas, lee, belly, ripple)
        objs += square_rig(TOPSAIL, anim, setting, point, side, frame, lambda n: False)
        jl = lee * jib_lee + (ripple * 0.8 if luff else 0.0)
        objs.append(jib(f'{anim}_jib', (1.44 * k, 0.44), (MY + 0.04, 1.62), (0.46 * k, 0.36), jl, canvas))
        if second_jib and setting == 'full':
            objs.append(jib(f'{anim}_jib2', (1.12 * k, 0.40), (MY + 0.06, 1.30), (0.52 * k, 0.40), jl * 0.9, canvas))
        return objs

    def furled():
        return gaff_furled(MY, TACK, BOOM, CLEW) + furled_squares(TOPSAIL)

    INFO.update(hull_length=L, main_masthead=(MY, TOP))
    return build_states(rig, furled)


def build_war_sloop():
    # A heavier sloop: 1.12x the sloop's length, five ports a side, a square topsail.
    return build_big_sloop(1.12, 1.08, 2.02, 5, None, False)


def build_royal_sloop():
    # A navy sloop: longer still, a blue hull with a gold band, six ports a side, a topsail and two jibs.
    return build_big_sloop(1.20, 1.10, 2.10, 6, [royal, band, deck], True)


def build_rigged(L, wf, hf, sect, smats, port_rows, boxes, masts, squares, bowsprit, head, mizzen, mats=None):
    """A square-rigged ship: hull, rows of ports (sect fraction, stations, z0, z1, size), deck boxes, masts,
    her square sails (courses furled at half sail), a jib or a spritsail at the head, and a spanker or a
    lateen on the mizzen (or neither)."""
    hull(L, 40, wf, hf, sect, smats, mats)
    for frac, ys, z0, z1, size in port_rows:
        ports(L, wf, hf, frac, ys, z0, z1, size)
    for b in boxes:
        box(*b)
    for name, (y, top) in masts.items():
        box(name, -0.03, 0.03, y - 0.03, y + 0.03, 0.2, top, mast)
    beam('bowsprit', *bowsprit, 0.025, mast)
    sprit = head if isinstance(head, dict) else {}

    def lateen(anim, lee, m, MZ, yard0, yard1, tack, peak, clew, ripple=0.0, belly=0.0, furl_it=False):
        swing = math.degrees(math.atan2(lee, 0.8))
        objs = [beam(f'{anim}_lateen_yard', braced((0, *yard0), MZ, swing), braced((0, *yard1), MZ, swing), 0.02, mast)]
        if furl_it:
            objs.append(beam(f'{anim}_lateen_furl', braced((0, tack[0], yard0[1]), MZ, swing), braced((0, peak[0], peak[1] - 0.08), MZ, swing), 0.035, sail))
        else:
            objs.append(fore_aft_sail(f'{anim}_lateen', (tack, tack, peak, clew), 1 if lee >= 0 else -1, belly, ripple, m, MZ, swing))
        return objs

    def rig(anim, setting, point, side, frame):
        _, belly, jib_lee, sp_lee = POINTS[point]
        luff = point == 'irons'
        canvas = slack if luff else sail
        objs = square_rig({**squares, **sprit}, anim, setting, point, side, frame, lambda n: n.endswith('course'))
        if not sprit:
            objs.append(jib(f'{anim}_jib', head[0], head[1], head[2], -side * jib_lee, canvas))
        if mizzen and mizzen[0] == 'spanker' and setting == 'full':
            (a, b, c, d) = mizzen[1]
            lee = -side * sp_lee
            objs.append(obj(f'{anim}_spanker', [(0, *a), (0, *b), (lee, *c), (lee, *d)], [(0, 1, 2, 3)], [canvas]))
        if mizzen and mizzen[0] == 'lateen':
            MZ, yard0, yard1, tack, peak, clew = mizzen[1]
            lee = -side * sp_lee
            ripple = (0.05 if frame == 0 else -0.05) if luff else 0.0
            objs += lateen(anim, lee, canvas, MZ, yard0, yard1, tack, peak, clew, ripple, 0.0 if luff else 0.05, setting == 'half')
        return objs

    def furled():
        objs = furled_squares({**squares, **sprit})
        if mizzen and mizzen[0] == 'lateen':
            objs += lateen('furled', 0.0, sail, *mizzen[1], furl_it=True)
        return objs

    INFO.update(hull_length=L, main_masthead=masts['main'])
    return build_states(rig, furled)


def build_barque():
    # A small three-master: a plain, broad merchant hull, square sails on fore and main, a gaff spanker on
    # the mizzen. 1.0x the brig.
    L = 2.40

    def wf(t):
        if t < 0.25:
            return 0.42 * (0.55 + 0.45 * math.sin(math.pi / 2 * t / 0.25))
        if t < 0.60:
            return 0.42
        return 0.42 * math.sqrt(max(0.0, 1 - ((t - 0.60) / 0.40) ** 2.4))

    def hf(t):
        return 0.27 + 0.10 * clamp01((0.20 - t) / 0.05) + 0.06 * t ** 4

    sect = [(0.86, 0.0), (1.00, 0.45), (0.92, 0.82), (0.84, 1.0)]
    squares = {
        'fore_course': (0.68, 0.71, 1.00, 0.50, 0.80, 0.90, 0.10),
        'fore_top': (0.68, 0.71, 1.52, 1.06, 0.56, 0.74, 0.08),
        'main_course': (0.00, 0.03, 1.08, 0.52, 0.90, 1.00, 0.10),
        'main_top': (0.00, 0.03, 1.66, 1.14, 0.62, 0.82, 0.08),
    }
    return build_rigged(
        L, wf, hf, sect, [0, 0, 1],
        [(0.93, (-0.30, 0.20, 0.60), 0.50, 0.68, 0.035)],
        [('cabin', -0.16, 0.16, -0.95, -0.80, hf(0.1), hf(0.1) + 0.09, cabin),
         ('hatch0', -0.10, 0.10, -0.20, 0.05, 0.27, 0.32, grate), ('hatch1', -0.09, 0.09, 0.32, 0.48, 0.27, 0.32, grate)],
        {'fore': (0.68, 1.62), 'main': (0.00, 1.84), 'mizzen': (-0.72, 1.40)},
        squares,
        ((0, 1.12, 0.32), (0, 1.62, 0.58)),
        ((1.58, 0.58), (0.74, 1.50), (1.10, 0.48)),
        ('spanker', ((-0.76, 0.56), (-0.76, 1.22), (-1.28, 1.08), (-1.36, 0.56))),
    )


def build_merchantman():
    # A big armed merchantman: deep and full-bellied, one row of ports, a raised stern castle, three masts
    # square-rigged with a spanker. 1.25x the brig.
    L = 3.00

    def wf(t):
        if t < 0.30:
            return 0.42 + 0.10 * math.sin(math.pi / 2 * t / 0.30)
        if t < 0.62:
            return 0.52
        return 0.52 * math.sqrt(max(0.0, 1 - ((t - 0.62) / 0.38) ** 2.2))

    def hf(t):
        return 0.36 + 0.16 * clamp01((0.22 - t) / 0.04) + 0.05 * clamp01((t - 0.85) / 0.03) + 0.05 * t ** 4

    sect = [(0.86, 0.0), (1.00, 0.42), (0.96, 0.80), (0.86, 1.0)]
    squares = {
        'fore_course': (0.80, 0.83, 1.10, 0.56, 1.10, 1.20, 0.10),
        'fore_top': (0.80, 0.83, 1.66, 1.18, 0.80, 1.02, 0.08),
        'main_course': (0.05, 0.08, 1.20, 0.60, 1.22, 1.32, 0.10),
        'main_top': (0.05, 0.08, 1.86, 1.28, 0.88, 1.12, 0.08),
        'mizzen_top': (-0.82, -0.79, 1.52, 1.10, 0.66, 0.82, 0.07),
    }
    return build_rigged(
        L, wf, hf, sect, [0, 1, 0],
        [(0.98, [-0.95 + k * 0.26 for k in range(8)], 0.50, 0.68, 0.04)],
        [('cabin', -0.24, 0.24, -1.40, -1.18, hf(0.08), hf(0.08) + 0.08, cabin),
         ('hatch0', -0.12, 0.12, -0.45, -0.20, 0.36, 0.41, grate), ('hatch1', -0.12, 0.12, 0.30, 0.55, 0.36, 0.41, grate)],
        {'fore': (0.80, 1.96), 'main': (0.05, 2.18), 'mizzen': (-0.82, 1.74)},
        squares,
        ((0, 1.40, 0.42), (0, 1.72, 0.78)),
        ((1.70, 0.78), (0.86, 1.70), (1.22, 0.62)),
        ('spanker', ((-0.88, 0.70), (-0.88, 1.30), (-1.42, 1.14), (-1.52, 0.70))),
    )


def build_brigantine():
    # A two-master: square sails on the foremast, a big gaff mainsail aft and a jib. 0.95x the brig.
    L = 2.28

    def wf(t):
        if t < 0.40:
            return 0.32 + 0.08 * math.sin(math.pi / 2 * t / 0.40)
        return 0.40 * math.sqrt(max(0.0, 1 - ((t - 0.40) / 0.60) ** 2.0))

    def hf(t):
        return 0.26 + 0.04 * (1 - t) ** 3 + 0.06 * t ** 4

    sect = [(0.82, 0.0), (0.97, 0.55), (1.0, 0.82), (0.97, 1.0)]
    hull(L, 32, wf, hf, sect, [0, 1, 0])
    ports(L, wf, hf, 0.99, (-0.66, -0.36, -0.06, 0.24, 0.54), 0.56, 0.80, size=0.035)
    box('companion', -0.10, 0.10, -0.86, -0.70, 0.27, 0.34, cabin)
    box('hatch0', -0.09, 0.09, -0.02, 0.18, 0.27, 0.31, grate)
    FY, FTOP, MY, MTOP = 0.56, 1.80, -0.28, 1.96
    box('fore', -0.03, 0.03, FY - 0.03, FY + 0.03, 0.2, FTOP, mast)
    box('main', -0.03, 0.03, MY - 0.03, MY + 0.03, 0.2, MTOP, mast)
    beam('bowsprit', (0, 1.02, 0.32), (0, 1.60, 0.54), 0.024, mast)
    FORE = {
        'fore_course': (FY, FY + 0.03, 1.00, 0.50, 0.86, 0.96, 0.10),
        'fore_top': (FY, FY + 0.03, 1.56, 1.08, 0.60, 0.78, 0.08),
    }
    TACK, THROAT, PEAK, CLEW = (MY - 0.05, 0.42), (MY - 0.05, 1.46), (MY - 0.88, 1.84), (MY - 1.00, 0.46)
    BOOM = (MY - 1.04, 0.42)

    def rig(anim, setting, point, side, frame):
        swing_deg, jib_lee, belly = SLOOP_SWING[point]
        luff = point == 'irons'
        canvas = slack if luff else sail
        lee = -side if side else -1
        if luff:
            swing_deg += 0 if frame == 0 else 6
        ripple = (0.10 if frame == 0 else -0.10) if luff else 0.0
        objs = square_rig(FORE, anim, setting, point, side, frame, lambda n: n.endswith('course'))
        # The main's boom swings less than a sloop's: the foremast's square sails take the run.
        objs += gaff_main(anim, MY, TACK, THROAT, PEAK, CLEW, BOOM, lee * swing_deg * 0.8, setting, canvas, lee, belly, ripple)
        objs.append(jib(f'{anim}_jib', (1.56, 0.54), (FY + 0.04, 1.66), (1.02, 0.42), lee * jib_lee + (ripple * 0.8 if luff else 0.0), canvas))
        return objs

    def furled():
        return furled_squares(FORE) + gaff_furled(MY, TACK, BOOM, CLEW)

    INFO.update(hull_length=L, main_masthead=(MY, MTOP))
    return build_states(rig, furled)


def build_ship_of_the_line():
    # The great ship: a towering hull with three rows of ports, gilded stern, frigate rig made bigger.
    # As long as the cell allows (1.38x the brig); her bulk is in her beam and her height.
    L = 3.30

    def wf(t):
        if t < 0.36:
            return 0.42 + 0.12 * math.sin(math.pi / 2 * t / 0.36)
        u = (t - 0.36) / 0.64
        return 0.54 * math.sqrt(max(0.0, 1 - u ** 2.4))

    def hf(t):
        qd = 0.10 * clamp01((0.32 - t) / 0.03)
        fc = 0.05 * clamp01((t - 0.82) / 0.03)
        return 0.46 + qd + fc + 0.03 * (1 - t) ** 4 + 0.05 * t ** 4

    sect = [(0.84, 0.0), (0.98, 0.32), (1.0, 0.62), (0.94, 0.84), (0.88, 1.0)]
    ys = [-1.12 + k * 0.215 for k in range(11)]
    squares = {
        'fore_course': (0.75, 0.78, 1.14, 0.60, 1.20, 1.30, 0.10),
        'fore_top': (0.75, 0.78, 1.66, 1.20, 0.88, 1.10, 0.08),
        'fore_tgallant': (0.75, 0.78, 1.96, 1.72, 0.58, 0.78, 0.06),
        'main_course': (0.05, 0.08, 1.24, 0.64, 1.32, 1.42, 0.10),
        'main_top': (0.05, 0.08, 1.84, 1.30, 0.96, 1.20, 0.08),
        'main_tgallant': (0.05, 0.08, 2.18, 1.90, 0.64, 0.86, 0.06),
        'mizzen_top': (-0.85, -0.82, 1.56, 1.14, 0.72, 0.88, 0.07),
        'mizzen_tgallant': (-0.85, -0.82, 1.80, 1.60, 0.48, 0.64, 0.05),
    }
    return build_rigged(
        L, wf, hf, sect, [0, 1, 0, 1],
        [(1.0, ys, 0.26, 0.38, 0.04), (1.0, ys, 0.50, 0.62, 0.04), (0.96, ys[1:-1], 0.72, 0.84, 0.035)],
        [('cabin', -0.30, 0.30, -1.52, -1.30, hf(0.1), hf(0.1) + 0.09, band),
         ('hatch0', -0.12, 0.12, -0.50, -0.26, 0.46, 0.50, grate), ('hatch1', -0.12, 0.12, 0.30, 0.54, 0.46, 0.50, grate),
         ('boat', -0.13, 0.13, -0.12, 0.20, 0.47, 0.54, cabin)],
        {'fore': (0.75, 2.04), 'main': (0.05, 2.26), 'mizzen': (-0.85, 1.86)},
        squares,
        ((0, 1.52, 0.50), (0, 1.74, 0.86)),
        ((1.73, 0.84), (0.83, 1.70), (1.20, 0.70)),
        ('spanker', ((-0.90, 0.76), (-0.90, 1.34), (-1.50, 1.18), (-1.60, 0.76))),
    )


def galleon(L, castle, gilt):
    """A galleon: high castled stern, raised forecastle, two rows of ports, square sails on fore and main,
    a lateen on the mizzen and a spritsail under the bowsprit. `castle` is the stern castle's height;
    `gilt` paints the castles and upper hull gold (the treasure galleon)."""

    def wf(t):
        if t < 0.30:
            return 0.36 + 0.12 * math.sin(math.pi / 2 * t / 0.30)
        if t < 0.60:
            return 0.48
        return 0.48 * math.sqrt(max(0.0, 1 - ((t - 0.60) / 0.40) ** 2.6))

    def hf(t):
        return 0.36 + castle * clamp01((0.24 - t) / 0.05) + 0.18 * clamp01((t - 0.82) / 0.05) + 0.04 * t ** 4

    sect = [(0.84, 0.0), (1.0, 0.40), (0.96, 0.72), (0.86, 1.0)]
    ys = [-0.62 + k * 0.20 for k in range(7)]
    MZ = -0.80
    squares = {
        'fore_course': (0.85, 0.88, 1.10, 0.62, 1.04, 1.14, 0.10),
        'fore_top': (0.85, 0.88, 1.64, 1.18, 0.72, 0.92, 0.08),
        'main_course': (0.10, 0.13, 1.22, 0.64, 1.20, 1.30, 0.10),
        'main_top': (0.10, 0.13, 1.88, 1.30, 0.84, 1.08, 0.08),
    }
    top = hf(0.1)
    return build_rigged(
        L, wf, hf, sect, [0, 1, 1] if gilt else [0, 1, 0],
        [(1.0, ys, 0.40, 0.54, 0.04), (0.97, ys, 0.62, 0.76, 0.035)],
        [('gallery', -0.26, 0.26, -L / 2 - 0.02, -L / 2 + 0.10, top - 0.18, top + 0.04, band),
         ('hatch0', -0.12, 0.12, -0.25, 0.0, 0.36, 0.41, grate), ('hatch1', -0.12, 0.12, 0.30, 0.52, 0.36, 0.41, grate)],
        {'fore': (0.85, 1.92), 'main': (0.10, 2.18), 'mizzen': (MZ, 1.74)},
        squares,
        # Bowsprit, spritsail and lateen kept in from the cell's edges: braced close-hauled, the spritsail
        # yard reaches forward, and the lateen's peak stands over the high stern.
        ((0, 1.38, 0.56), (0, 1.62, 0.84)),
        {'sprit': (1.44, 1.46, 0.70, 0.44, 0.42, 0.46, 0.06)},
        ('lateen', (MZ, (MZ + 0.46, 0.42 + castle), (MZ - 0.56, 1.54), (MZ + 0.40, 0.48 + castle), (MZ - 0.50, 1.48), (MZ - 0.44, 0.44 + castle))),
        [hull_dark, band, deck],
    )


def build_galleon():
    return galleon(3.10, 0.36, False)


def build_treasure_galleon():
    return galleon(3.16, 0.42, True)


STATES = {'fluyt': build_fluyt, 'sloop': build_sloop, 'frigate': build_frigate, 'war_sloop': build_war_sloop,
          'royal_sloop': build_royal_sloop, 'barque': build_barque, 'merchantman': build_merchantman,
          'brigantine': build_brigantine, 'ship_of_the_line': build_ship_of_the_line, 'galleon': build_galleon,
          'treasure_galleon': build_treasure_galleon}[CLASS]()
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
    '3c5e8b': ['253a5e', '3c5e8b', '4f8fba'],
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
# Combat uses the same framing at 192 px, rendered directly, so the pivot fraction is unchanged.
cam_data.ortho_scale = 3.7
cam_data.clip_end = 100
T = Vector((0, 0, 0.6))
e = math.radians(45)
cam.location = T + Vector((0, -math.cos(e), math.sin(e))) * 20
cam.rotation_euler = (T - cam.location).to_track_quat('-Z', 'Y').to_euler()
sc.render.resolution_x = sc.render.resolution_y = CELL

tmp = os.path.join(TMP, f'{CLASS}_pass.png')
JOBS = {s: (s, f'ship.{CLASS}.world.sail_{s}') for s in STATES}
for state, (rig_state, prefix) in JOBS.items():
    if ONLY and state != ONLY:
        continue
    for other, others in STATES.items():
        for o in others:
            o.hide_render = other != rig_state
    for f in range(FACINGS):
        root.rotation_euler = (0, 0, -math.radians(360 / FACINGS * f))
        passes = []
        for light in ('FLAT', 'STUDIO'):
            sc.display.shading.light = light
            sc.render.filepath = tmp
            bpy.ops.render.render(write_still=True)
            passes.append(load(tmp))
        save(snap(*passes), os.path.join(OUT, f'{prefix}.f{f:02d}.png'))
print('DONE')
