"""Builds the low-poly brig and renders the world-map set: 23 sail sprites x 32 facings at 64 px.

Run from the repo root:
  /Applications/Blender.app/Contents/MacOS/Blender -b --python tools/art/render_brig.py -- "$PWD" <tmp dir>
"""
import bpy, math, os, sys
import numpy as np
from mathutils import Vector

REPO = sys.argv[sys.argv.index('--') + 1]
TMP = sys.argv[sys.argv.index('--') + 2]
OUT = os.path.join(REPO, 'art/generated/ships/brig45/world')
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene


def hexrgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


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


root = bpy.data.objects.new('brig', None)
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
    # Any axis not parallel to the spar works for the cross-section; yards run along X.
    helper = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))
    a = d.cross(helper).normalized() * t
    b = d.cross(a).normalized() * t
    v = [tuple(p + s * a + u * b) for p in (p0, p1) for s, u in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    f = [(0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7), (0, 3, 2, 1), (4, 5, 6, 7)]
    return obj(name, v, f, [m])


# --- hull: lofted sections, stern at -Y (flat transom), bow at +Y ---
L = 2.4
N = 28
hull_dark, band, deck, port = mat('hull', '602c2c'), mat('band', 'de9e41'), mat('deck', 'c09473'), mat('port', '241527')
verts, faces, idx, rails = [], [], [], []
for i in range(N + 1):
    t = i / N
    y = -L / 2 + t * L
    if t < 0.45:
        w = 0.30 + 0.10 * math.sin(math.pi / 2 * t / 0.45)
    else:
        u = (t - 0.45) / 0.55
        w = 0.40 * math.sqrt(max(0.0, 1 - u ** 2.2))
    h = 0.30 + 0.12 * (1 - t) ** 4 + 0.07 * t ** 4
    rails.append((w, y, h))
    verts += [(-0.82 * w, y, 0), (-0.96 * w, y, 0.55 * h), (-w, y, h), (w, y, h), (0.96 * w, y, 0.55 * h), (0.82 * w, y, 0)]
for i in range(N):
    a, b = 6 * i, 6 * (i + 1)
    for k, mi in ((0, 0), (1, 1), (2, 2), (3, 1), (4, 0)):
        faces.append((a + k, b + k, b + k + 1, a + k + 1))
        idx.append(mi)
faces.append((0, 1, 2, 3, 4, 5))  # transom
idx.append(0)
obj('hull', verts, faces, [hull_dark, band, deck], idx)

# bulwarks: a dark rail along the deck edge gives the hull a rim at every facing
rv, rf = [], []
for w, y, h in rails:
    rv += [(-w, y, h), (-w, y, h + 0.07), (w, y, h), (w, y, h + 0.07)]
for i in range(N):
    a, b = 4 * i, 4 * (i + 1)
    rf += [(a, b, b + 1, a + 1), (a + 2, b + 2, b + 3, a + 3)]
w0, y0, h0 = rails[0]
rf.append((0, 1, 3, 2))
obj('bulwark', rv, rf, [hull_dark])

# gunports along the ochre band, 5 per side
for k in range(5):
    y = -0.65 + k * 0.32
    for s in (-1, 1):
        x = s * 0.405
        box(f'port{k}{s}', x - 0.012, x + 0.012, y - 0.05, y + 0.05, 0.20, 0.27, port)

# quarterdeck cabin, hatches, masts
box('cabin', -0.24, 0.24, -1.18, -0.78, 0.40, 0.52, mat('cabin', 'ad7757'))
for k, y in enumerate((0.05, 0.75)):
    box(f'hatch{k}', -0.09, 0.09, y - 0.09, y + 0.09, 0.30, 0.34, mat('grate', '4d2b32'))
mast = mat('mast', '4d2b32')
sail = mat('sail', 'ebede9')
for name, y, top in (('fore', 0.42, 1.62), ('main', -0.28, 1.78)):
    box(name, -0.03, 0.03, y - 0.03, y + 0.03, 0.2, top, mast)


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
            # Head and foot curve too (0.5 at the edges), so a full sail's outline bows, not just its shading.
            y = yc + billow * (1 - (2 * s - 1) ** 2) * (0.5 + 0.5 * math.sin(math.pi * q))
            # Luffing canvas: vertical folds that shade as alternating stripes.
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
    """A sail gathered up under its yard: a thick roll of canvas."""
    return beam(name + '_furl', braced((-wt / 2, yc, zt - 0.055), ym, brace), braced((wt / 2, yc, zt - 0.055), ym, brace), 0.035, sail)


# brig: two square-rigged masts, course (lower) + topsail on each.
SQUARES = {  # name: (mast y, yc, zt, zb, wt, wb, billow)
    'fore_course': (0.42, 0.45, 1.00, 0.48, 0.92, 1.00, 0.10),
    'fore_top': (0.42, 0.45, 1.52, 1.06, 0.62, 0.82, 0.08),
    'main_course': (-0.28, -0.25, 1.08, 0.50, 1.00, 1.08, 0.10),
    'main_top': (-0.28, -0.25, 1.66, 1.14, 0.68, 0.90, 0.08),
}
beam('bowsprit', (0, 1.12, 0.28), (0, 1.72, 0.46), 0.025, mast)
obj('flag', [(0, -0.28, 1.86), (0, -0.28, 1.70), (0, -0.62, 1.74), (0, -0.62, 1.86)], [(0, 1, 2, 3)], [mat('flag', 'a53030')])


def jib(name, lee, m):
    """Tack and head on the centreline; the clew swings `lee` to leeward."""
    return obj(name, [(0, 1.68, 0.45), (0, 0.50, 1.40), (lee, 1.10, 0.33)], [(0, 1, 2)], [m])


def spanker(name, lee, m):
    """Luff on the mainmast; the leech swings `lee` to leeward."""
    return obj(name, [(0, -0.33, 0.52), (0, -0.33, 1.22), (lee, -1.15, 0.92), (lee, -1.22, 0.52)], [(0, 1, 2, 3)], [m])


# Sprite states. The setting (full, half, furled) is the PRD sail state; the rest is render-only and
# follows the wind. Yards are braced round to meet it and the canvas bellies downwind, so wind reads
# as sail angle and shape, not just colour. Each braced point has a port and starboard tack.
# point: (brace deg, belly x base billow, jib lee, spanker lee)
POINTS = {
    'run': (0, 2.8, 0.0, 0.0),
    'broad': (20, 2.8, 0.20, 0.35),
    'beam': (35, 2.4, 0.28, 0.45),
    'close': (45, 1.2, 0.32, 0.50),
    'irons': (45, 0.0, 0.08, 0.10),
}
slack = mat('slack', 'c7cfcc')


def rig(anim, setting, point, side, frame=0):
    """side: +1 wind from starboard (yards rotate anticlockwise, leeward is -x), -1 from port."""
    brace_deg, belly, jib_lee, spanker_lee = POINTS[point]
    brace = side * brace_deg
    luff = point == 'irons'
    objs = []
    for name, (ym, yc, zt, zb, wt, wb, billow) in SQUARES.items():
        objs.append(yard(f'{anim}_{name}', yc, zt, wt, ym, brace))
        if setting == 'half' and name.endswith('course'):
            objs.append(furl(f'{anim}_{name}', yc, zt, wt, ym, brace))
        elif luff:
            # Slack grey canvas with folds; frame 1 flips the folds so two frames flap.
            ripple = 0.07 if frame == 0 else -0.07
            objs.append(square_sail(f'{anim}_{name}', yc, zt, zb + 0.08, wt, wb * 0.92, 0.0, ripple, slack, ym, brace))
        else:
            objs.append(square_sail(f'{anim}_{name}', yc, zt, zb, wt, wb, billow * belly, 0.0, sail, ym, brace))
    canvas = slack if luff else sail
    objs.append(jib(f'{anim}_jib', -side * jib_lee, canvas))
    if setting == 'full':
        objs.append(spanker(f'{anim}_spanker', -side * spanker_lee, canvas))
    return objs


STATES = {'furled': []}
for name, (ym, yc, zt, zb, wt, wb, billow) in SQUARES.items():
    STATES['furled'] += [yard(f'furled_{name}', yc, zt, wt, ym, 0), furl(f'furled_{name}', yc, zt, wt, ym, 0)]
for setting in ('full', 'half'):
    STATES[f'{setting}_run'] = rig(f'{setting}_run', setting, 'run', 0)
    for side, tack in ((1, 's'), (-1, 'p')):
        for point in ('broad', 'beam', 'close'):
            STATES[f'{setting}_{point}_{tack}'] = rig(f'{setting}_{point}_{tack}', setting, point, side)
        for frame in (0, 1):
            STATES[f'{setting}_irons_{tack}{frame}'] = rig(f'{setting}_irons_{tack}{frame}', setting, 'irons', side, frame)

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(REPO, 'art/masters/ships/brig-45.blend'))

# --- render setup: workbench, studio light (view-space, so light stays consistent per facing) ---
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

# Ship sub-palette from corsair.gpl (Apollo); outline colour is the darkest purple-black.
SUB = ['241527', '341c27', '4d2b32', '602c2c', '7a4841', '884b2b', 'ad7757', 'be772b', 'c09473', 'd7b594',
       'de9e41', 'e8c170', 'e7d5b3', 'ebede9', 'c7cfcc', 'a8b5b2', '819796', '752438', 'a53030', 'cf573c']
PAL = np.array([hexrgb(h) for h in SUB], dtype=np.float32) / 255
OUTLINE = np.array(hexrgb('241527'), dtype=np.float32) / 255
WATER = np.array(hexrgb('3c5e8b'), dtype=np.float32) / 255
WAVE = np.array(hexrgb('4f8fba'), dtype=np.float32) / 255


def load(path):
    img = bpy.data.images.load(path)
    w, h = img.size
    a = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(a)
    bpy.data.images.remove(img)
    return a.reshape(h, w, 4)[::-1].copy()  # top-down rows


def save(arr, path):
    h, w = arr.shape[:2]
    img = bpy.data.images.new('tmp', w, h, alpha=True)
    img.pixels.foreach_set(arr[::-1].astype(np.float32).ravel())
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    bpy.data.images.remove(img)


# Per-material 3-step ramps (dark, mid, light) from corsair.gpl. A flat pass identifies the
# material, a studio-lit pass gives the shading step; this keeps sails white instead of mud.
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
    # 1 px outside outline
    n = np.zeros_like(mask)
    n[1:] |= mask[:-1]; n[:-1] |= mask[1:]; n[:, 1:] |= mask[:, :-1]; n[:, :-1] |= mask[:, 1:]
    ring = n & ~mask
    out[ring, :3] = OUTLINE
    out[ring, 3] = 1
    return out


# Locked world-map camera (art pipeline section 4): orthographic, 45 deg, 64 px cell.
FACINGS = 32
cam_data.ortho_scale = 3.7
cam_data.clip_end = 100
T = Vector((0, 0, 0.6))
e = math.radians(45)
cam.location = T + Vector((0, -math.cos(e), math.sin(e))) * 20
cam.rotation_euler = (T - cam.location).to_track_quat('-Z', 'Y').to_euler()
sc.render.resolution_x = sc.render.resolution_y = 64

tmp = os.path.join(TMP, 'brig_pass.png')
for state, objs in STATES.items():
    for other, others in STATES.items():
        for o in others:
            o.hide_render = other != state
    for f in range(FACINGS):
        root.rotation_euler = (0, 0, -math.radians(360 / FACINGS * f))  # f00 north, clockwise
        passes = []
        for light in ('FLAT', 'STUDIO'):
            sc.display.shading.light = light
            sc.render.filepath = tmp
            bpy.ops.render.render(write_still=True)
            passes.append(load(tmp))
        save(snap(*passes), os.path.join(OUT, f'ship.brig.world.sail_{state}.f{f:02d}.png'))
print('DONE')
