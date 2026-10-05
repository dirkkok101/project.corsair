import bpy, math, os, sys
import numpy as np
from mathutils import Vector

OUT = sys.argv[sys.argv.index('--') + 1]
GROK = sys.argv[sys.argv.index('--') + 2]
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
    a = d.cross(Vector((1, 0, 0))).normalized() * t
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


def square_sail(name, yc, zt, zb, wt, wb, billow):
    nx, ny = 8, 5
    v, f = [], []
    for j in range(ny + 1):
        for i in range(nx + 1):
            s, q = i / nx, j / ny
            w = wt + (wb - wt) * q
            x = (2 * s - 1) * w / 2
            z = zt + (zb - zt) * q
            y = yc + billow * (1 - (2 * s - 1) ** 2) * (0.3 + 0.7 * math.sin(math.pi * q))
            v.append((x, y, z))
    for j in range(ny):
        for i in range(nx):
            a = j * (nx + 1) + i
            f.append((a, a + 1, a + nx + 2, a + nx + 1))
    obj(name, v, f, [sail])
    box(name + '_yard', -(wt / 2 + 0.06), wt / 2 + 0.06, yc - 0.02, yc + 0.02, zt - 0.02, zt + 0.02, mast)


# brig: two square-rigged masts, course + topsail each, billowing forward
square_sail('fore_course', 0.45, 1.00, 0.48, 0.92, 1.00, 0.10)
square_sail('fore_top', 0.45, 1.52, 1.06, 0.62, 0.82, 0.08)
square_sail('main_course', -0.25, 1.08, 0.50, 1.00, 1.08, 0.10)
square_sail('main_top', -0.25, 1.66, 1.14, 0.68, 0.90, 0.08)
obj('spanker', [(0, -0.33, 0.52), (0, -0.33, 1.22), (0, -1.15, 0.92), (0, -1.22, 0.52)], [(0, 1, 2, 3)], [sail])
beam('bowsprit', (0, 1.12, 0.28), (0, 1.72, 0.46), 0.025, mast)
obj('jib', [(0, 1.68, 0.45), (0, 0.50, 1.40), (0, 1.10, 0.33)], [(0, 1, 2)], [sail])
obj('flag', [(0, -0.28, 1.86), (0, -0.28, 1.70), (0, -0.62, 1.74), (0, -0.62, 1.86)], [(0, 1, 2, 3)], [mat('flag', 'a53030')])

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT, 'brig-3d.blend'))

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


ELEV = {90: (3.1, 0.0), 60: (3.7, 0.55), 45: (3.7, 0.6)}  # elevation: (ortho scale, look-at z)
frames = {}
tmp = os.path.join(OUT, '_tmp.png')
for e, (scale, tz) in ELEV.items():
    cam_data.ortho_scale = scale
    T = Vector((0, 0, tz))
    d = Vector((0, -math.cos(math.radians(e)), math.sin(math.radians(e))))
    cam.location = T + d * 20
    cam.rotation_euler = (T - cam.location).to_track_quat('-Z', 'Y').to_euler()
    cam_data.clip_end = 100
    for size in (64, 128):
        sc.render.resolution_x = sc.render.resolution_y = size
        for f in range(16):
            root.rotation_euler = (0, 0, -math.radians(22.5 * f))  # f00 north, clockwise
            passes = []
            for light in ('FLAT', 'STUDIO'):
                sc.display.shading.light = light
                sc.render.filepath = tmp
                bpy.ops.render.render(write_still=True)
                passes.append(load(tmp))
            fr = snap(*passes)
            frames[(e, size, f)] = fr
            d_ = os.path.join(OUT, f'elev{e}', str(size))
            os.makedirs(d_, exist_ok=True)
            save(fr, os.path.join(d_, f'ship.brig.{"world" if size == 64 else "combat"}.sail_full.f{f:02d}.png'))
os.remove(tmp)

for f in range(16):
    frames[('grok', 64, f)] = load(os.path.join(GROK, 'world', f'ship.brig.world.sail_full.f{f:02d}.png'))
    frames[('grok', 128, f)] = load(os.path.join(GROK, 'combat', f'ship.brig.combat.sail_full.f{f:02d}.png'))


def comp(bg, spr, x, y):
    h, w = spr.shape[:2]
    m = spr[..., 3] > 0.5
    bg[y:y + h, x:x + w][m] = spr[..., :3][m]


def water(w, h, seed=1):
    bg = np.ones((h, w, 3), dtype=np.float32) * WATER
    rng = np.random.default_rng(seed)
    for _ in range(w * h // 400):
        x, y = rng.integers(0, w - 4), rng.integers(0, h)
        bg[y, x:x + 3] = WAVE
    return bg


def finish(bg, k):
    a = np.concatenate([bg, np.ones(bg.shape[:2] + (1,), np.float32)], -1)
    return np.repeat(np.repeat(a, k, 0), k, 1)


ROWS = ['grok', 90, 60, 45]
for size, facings, k in ((64, range(16), 3), (128, range(0, 16, 2), 2)):
    cols = len(facings)
    bg = water(cols * size, len(ROWS) * size, seed=size)
    for r, key in enumerate(ROWS):
        for c, f in enumerate(facings):
            comp(bg, frames[(key, size, f)], c * size, r * size)
    save(finish(bg, k), os.path.join(OUT, f'compare-{size}-x{k}.png'))

# true-size 480x270 sea panels: same fleet layout per variant, stacked vertically
spots = [(40, 30, 2), (170, 60, 5), (300, 20, 9), (380, 140, 13), (90, 160, 0), (230, 170, 7)]
panels = []
for key in ROWS:
    bg = water(480, 270, seed=7)
    for x, y, f in spots:
        comp(bg, frames[(key, 64, f)], x, y)
    panels.append(bg)
    panels.append(np.zeros((4, 480, 3), np.float32))
sea = np.concatenate(panels[:-1], 0)
save(finish(sea, 1), os.path.join(OUT, 'sea-480x270-x1.png'))
save(finish(sea, 2), os.path.join(OUT, 'sea-480x270-x2.png'))
print('DONE')
