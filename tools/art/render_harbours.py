"""Builds low-poly harbours and renders the layered 960x540 harbour scenes (S8): sky, backdrop, town, fort, wharf, sea.

Run from the repo root (optionally name jobs to render only those, e.g. sky backdrop wharf.quay town.england.large):
  /Applications/Blender.app/Contents/MacOS/Blender -b --python tools/art/render_harbours.py -- "$PWD" <tmp dir> [job ...]
Add --check to verify every output instead of rendering. harbours.json is rewritten on every run.
"""
import bpy, bmesh, json, math, os, random, sys
import numpy as np
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

ARGS = sys.argv[sys.argv.index('--') + 1:]
REPO, TMP = ARGS[0], ARGS[1]
CHECK = '--check' in ARGS
ONLY = set(a for a in ARGS[2:] if not a.startswith('--'))
REL = 'art/game/harbours'
OUT = os.path.join(REPO, REL)
os.makedirs(OUT, exist_ok=True)
os.makedirs(TMP, exist_ok=True)
W, H = 960, 540

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene


def hexrgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def lin(c):
    c /= 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


# Per-material 3-step ramps (dark, mid, light) from corsair.gpl. The key is the flat-pass colour snap() matches against,
# so every live material needs its own key.
RAMPS = {
    'water': ('3c5e8b', ['3c5e8b', '3c5e8b', '3c5e8b']),
    'sand': ('e8c170', ['be772b', 'de9e41', 'e8c170']),
    'grass': ('75a743', ['25562e', '468232', '75a743']),
    'jungle': ('25562e', ['19332d', '25562e', '468232']),
    'canopy': ('468232', ['25562e', '468232', '75a743']),
    'haze': ('577277', ['394a50', '577277', '577277']),
    'farhaze': ('819796', ['577277', '819796', '819796']),
    'rock': ('394a50', ['4d2b32', '7a4841', 'ad7757']),
    'stone': ('a8b5b2', ['577277', '819796', 'a8b5b2']),
    'paving': ('c7cfcc', ['819796', 'a8b5b2', 'c7cfcc']),
    'road': ('d7b594', ['ad7757', 'c09473', 'd7b594']),
    'dark': ('241527', ['241527', '241527', '241527']),
    'pole': ('4d2b32', ['341c27', '4d2b32', '4d2b32']),
    'wood': ('7a4841', ['341c27', '4d2b32', '7a4841']),
    'plank': ('be772b', ['602c2c', '884b2b', 'be772b']),
    'crate': ('da863e', ['884b2b', 'be772b', 'de9e41']),
    'barrel': ('ad7757', ['4d2b32', '7a4841', 'ad7757']),
    'hull': ('602c2c', ['341c27', '602c2c', '884b2b']),
    'stake': ('884b2b', ['4d2b32', '884b2b', 'ad7757']),
    'thatch': ('de9e41', ['602c2c', '884b2b', 'be772b']),
    'trunk': ('c09473', ['7a4841', 'ad7757', 'c09473']),
    'lamp': ('e8c171', ['de9e41', 'e8c170', 'e8c170']),
    'cloth': ('ebede9', ['a8b5b2', 'c7cfcc', 'ebede9']),
    'gold': ('d0da91', ['de9e41', 'e8c170', 'e8c170']),
    # nation walls (recoloured per nation)
    'wall.spain': ('e7d5b3', ['d7b594', 'e7d5b3', 'ebede9']),
    'wall.england': ('ae7858', ['4d2b32', '7a4841', 'ad7757']),
    'wall.france': ('a8b5b3', ['819796', 'a8b5b2', 'c7cfcc']),
    'wall.netherlands': ('a53030', ['602c2c', '884b2b', 'a53030']),
    # nation roofs, same keys and ramps as render_towns.py
    'roof.spain': ('cf573c', ['752438', 'a53030', 'cf573c']),
    'roof.england': ('577278', ['202e37', '394a50', '577277']),
    'roof.france': ('3c5e8c', ['172038', '253a5e', '253a5e']),
    'roof.netherlands': ('752438', ['341c27', '602c2c', '752438']),
}
NATIONS = ['spain', 'england', 'france', 'netherlands']
KEYS = list(RAMPS)
BASE = np.array([hexrgb(RAMPS[k][0]) for k in KEYS], dtype=np.float32) / 255
RAMP = np.array([[hexrgb(h) for h in RAMPS[k][1]] for k in KEYS], dtype=np.float32) / 255

MATS = {}


def mat(name):
    if name not in MATS:
        m = bpy.data.materials.new(name)
        m.diffuse_color = (*[lin(v) for v in hexrgb(RAMPS[name][0])], 1)
        MATS[name] = m
    return MATS[name]


WALL = bpy.data.materials.new('wall')
ROOF = bpy.data.materials.new('roof')


def set_nation(n):
    for m, k in ((WALL, 'wall.'), (ROOF, 'roof.')):
        m.diffuse_color = (*[lin(v) for v in hexrgb(RAMPS[k + n][0])], 1)


# --- geometry helpers; every object goes into CUR so each layer renders alone ---
CUR = []


def obj(name, verts, faces, mats, idx=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    for m in mats:
        me.materials.append(m if not isinstance(m, str) else mat(m))
    if idx:
        for p, i in zip(me.polygons, idx):
            p.material_index = i
    o = bpy.data.objects.new(name, me)
    sc.collection.objects.link(o)
    CUR.append(o)
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


def prism(name, pts, z0, z1, m):
    """Extrude a 2D polygon in the ground plane from z0 to z1."""
    n = len(pts)
    v = [(x, y, z0) for x, y in pts] + [(x, y, z1) for x, y in pts]
    f = [tuple(range(n - 1, -1, -1)), tuple(range(n, 2 * n))] + [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    return obj(name, v, f, [m])


def xz_prism(name, pts, y0, y1, m):
    """Extrude a 2D profile in the x-z plane (a facade outline) from y0 to y1."""
    n = len(pts)
    v = [(x, y0, z) for x, z in pts] + [(x, y1, z) for x, z in pts]
    f = [tuple(range(n - 1, -1, -1)), tuple(range(n, 2 * n))] + [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    return obj(name, v, f, [m])


def cyl(name, cx, cy, r, z0, z1, m, n=8):
    return prism(name, [(cx + r * math.cos(2 * math.pi * (i + 0.5) / n), cy + r * math.sin(2 * math.pi * (i + 0.5) / n)) for i in range(n)], z0, z1, m)


def cone(name, cx, cy, r, z0, z1, m, n=8):
    v = [(cx + r * math.cos(2 * math.pi * (i + 0.5) / n), cy + r * math.sin(2 * math.pi * (i + 0.5) / n), z0) for i in range(n)]
    v.append((cx, cy, z1))
    f = [(i, (i + 1) % n, n) for i in range(n)] + [tuple(range(n - 1, -1, -1))]
    return obj(name, v, f, [m])


def blob(name, cx, cy, cz, r, rz, m, rot=0.0):
    """Octahedron-ish tree crown: 6 points round the middle, a top and a bottom."""
    v = [(cx + r * math.cos(rot + k * math.pi / 3), cy + r * math.sin(rot + k * math.pi / 3), cz) for k in range(6)]
    v += [(cx, cy, cz + rz), (cx, cy, cz - rz * 0.6)]
    f = [(k, (k + 1) % 6, 6) for k in range(6)] + [((k + 1) % 6, k, 7) for k in range(6)]
    return obj(name, v, f, [m])


def gabled(name, x0, x1, y0, y1, z0, h, rise, along_x, wall, roof, over=0.12):
    """Walls box from z0 up h plus a pitched roof; ridge runs along X (eaves to camera) or Y (gable to camera)."""
    box(name + '_w', x0, x1, y0, y1, z0, z0 + h, wall)
    t = z0 + h
    a0, a1, b0, b1 = x0 - over, x1 + over, y0 - over, y1 + over
    if along_x:
        ym = (y0 + y1) / 2
        v = [(a0, b0, t), (a1, b0, t), (a1, b1, t), (a0, b1, t), (a0, ym, t + rise), (a1, ym, t + rise)]
        f = [(0, 1, 5, 4), (2, 3, 4, 5), (0, 4, 3), (1, 2, 5), (3, 2, 1, 0)]
    else:
        xm = (x0 + x1) / 2
        v = [(a0, b0, t), (a1, b0, t), (a1, b1, t), (a0, b1, t), (xm, b0, t + rise), (xm, b1, t + rise)]
        f = [(1, 2, 5, 4), (3, 0, 4, 5), (0, 1, 4), (2, 3, 5), (3, 2, 1, 0)]
    # Gable triangles are wall-coloured so the ends read as plaster/brick, not roof.
    obj(name + '_r', v, f, [roof, wall], [0, 0, 1, 1, 0])


def hipped(name, x0, x1, y0, y1, z0, h, rise, wall, roof, over=0.12):
    box(name + '_w', x0, x1, y0, y1, z0, z0 + h, wall)
    t = z0 + h
    a0, a1, b0, b1 = x0 - over, x1 + over, y0 - over, y1 + over
    ym, inset = (y0 + y1) / 2, (y1 - y0) / 2
    v = [(a0, b0, t), (a1, b0, t), (a1, b1, t), (a0, b1, t), (a0 + inset, ym, t + rise), (a1 - inset, ym, t + rise)]
    obj(name + '_r', v, [(0, 1, 5, 4), (2, 3, 4, 5), (0, 4, 3), (1, 2, 5), (3, 2, 1, 0)], [roof])


def windows(name, x0, x1, y, z0, h, n, rows=1, door=True):
    """Dark window pips on a camera-facing wall at y; a door in the middle of the ground row."""
    w = (x1 - x0)
    for r in range(rows):
        zc = z0 + h * (r + 0.55) / rows
        for k in range(n):
            xc = x0 + w * (k + 0.5) / n
            if door and r == 0 and k == n // 2:
                box(f'{name}_d', xc - 0.2, xc + 0.2, y - 0.04, y, z0, z0 + min(0.85, h / rows * 0.75), 'dark')
                continue
            box(f'{name}_win{r}{k}', xc - 0.15, xc + 0.15, y - 0.04, y, zc - 0.2, zc + 0.15, 'dark')


def flagpole(name, x, y, z0, z1):
    box(name, x - 0.07, x + 0.07, y - 0.07, y + 0.07, z0, z1, 'pole')
    return (x, y, z1)


# --- shared pieces ---
SHORE_Z = 0.3  # level of the coastal plain behind the beach


def build_backdrop():
    # beach slope from the waterline up to the plain, then the plain, then jungle hills and a far hazy ridge
    obj('beach', [(-80, 0, 0), (80, 0, 0), (80, 2.5, SHORE_Z), (-80, 2.5, SHORE_Z)], [(0, 1, 2, 3)], ['sand'])
    obj('plain', [(-80, 2.5, SHORE_Z), (80, 2.5, SHORE_Z), (80, 26, SHORE_Z), (-80, 26, SHORE_Z)], [(0, 1, 2, 3)], ['grass'])
    rnd = random.Random(7)

    def hills(name, y0, y1, step, base, amp, m, seed):
        r = random.Random(seed)
        xs = [x for x in range(-90, 91, step)]
        ys = [y0 + i * step for i in range(int((y1 - y0) / step) + 1)]
        jit = {(i, j): r.uniform(-0.5, 0.5) for i in range(len(xs)) for j in range(len(ys))}
        verts, faces = [], []
        for j, y in enumerate(ys):
            t = j / (len(ys) - 1)
            for i, x in enumerate(xs):
                bump = 0.6 + 0.4 * math.sin(x * 0.09 + seed) * math.cos(x * 0.031 + seed * 2)
                z = base + amp * min(1.0, t * 1.6) * bump * (1 + jit[(i, j)] * 0.5)
                if j == 0:
                    z = base
                verts.append((x + jit[(i, j)] * step * 0.4, y, z))
        nx = len(xs)
        for j in range(len(ys) - 1):
            for i in range(nx - 1):
                a = j * nx + i
                faces.append((a, a + 1, a + nx + 1, a + nx))
        return obj(name, verts, faces, [m]), verts

    _, near = hills('jungle_hills', 24, 60, 6, SHORE_Z, 9.0, 'jungle', 3)
    hills('far_ridge', 70, 120, 10, 2.0, 16.0, 'haze', 5)
    # tree crowns over the near hills and along the back of the plain
    for k, (x, y, z) in enumerate(near):
        if rnd.random() < 0.55:
            r = rnd.uniform(1.6, 2.6)
            blob(f'tree{k}', x + rnd.uniform(-2, 2), y + rnd.uniform(-1, 1), z + r * 0.5, r, r * 1.1,
                 'canopy' if rnd.random() < 0.5 else 'jungle', rnd.uniform(0, 1))
    for k in range(40):
        x = -70 + k * 3.6 + rnd.uniform(-1, 1)
        r = rnd.uniform(1.2, 2.0)
        blob(f'edge{k}', x, 24 + rnd.uniform(-1, 1), SHORE_Z + r * 0.6, r, r * 1.2, 'canopy', rnd.uniform(0, 1))


def palm(name, x, y, z, height, lean, seed):
    """A curved trunk in three segments and drooping fronds."""
    rnd = random.Random(seed)
    pts = []
    for k in range(4):
        t = k / 3
        pts.append((x + lean * t * t, y, z + height * t))
    for k in range(3):
        beam(f'{name}_t{k}', pts[k], pts[k + 1], 0.13 - k * 0.02, 'trunk')
    tx, ty, tz = pts[-1]
    for k in range(7):
        a = 2 * math.pi * k / 7 + rnd.uniform(-0.2, 0.2)
        L = rnd.uniform(1.4, 1.9)
        mid = (tx + math.cos(a) * L * 0.55, ty + math.sin(a) * L * 0.55, tz + 0.25)
        end = (tx + math.cos(a) * L, ty + math.sin(a) * L, tz - 0.55)
        beam(f'{name}_f{k}a', (tx, ty, tz), mid, 0.14, 'canopy')
        beam(f'{name}_f{k}b', mid, end, 0.11, 'jungle')


def barrel(name, x, y, z, r=0.28, h=0.6):
    cyl(name, x, y, r, z, z + h, 'barrel', 8)
    cyl(name + '_hoop', x, y, r + 0.02, z + h * 0.45, z + h * 0.55, 'pole', 8)


def crate(name, x, y, z, s=0.55):
    box(name, x - s / 2, x + s / 2, y - s / 2, y + s / 2, z, z + s, 'crate')


def rowboat(name, cx, cy, length, width, ang=0.0):
    """Open boat with a pointed bow, sitting on the water at z=0."""
    n = 8
    c, s = math.cos(ang), math.sin(ang)
    v, f = [], []
    for i in range(n + 1):
        t = i / n
        w = width / 2 * (1 - max(0.0, 2 * t - 1) ** 2.2) * (0.75 + 0.25 * min(1.0, t * 4)) + 0.02
        x = -length / 2 + t * length
        for yy, zz in ((-w * 0.6, 0.0), (-w, 0.4), (w, 0.4), (w * 0.6, 0.0)):
            v.append((cx + x * c - yy * s, cy + x * s + yy * c, zz))
    for i in range(n):
        a, b = 4 * i, 4 * (i + 1)
        f += [(a, b, b + 1, a + 1), (a + 1, b + 1, b + 2, a + 2), (a + 2, b + 2, b + 3, a + 3), (a + 3, b + 3, b, a)]
    f += [(0, 1, 2, 3)]
    obj(name, v, f, ['plank', 'hull'], [0, 1, 0, 0] * n + [0])
    # thwart and oar
    beam(name + '_oar', (cx - 0.6 * c, cy - 0.6 * s + 0.6, 0.45), (cx + 0.9 * c, cy + 0.9 * s - 0.5, 0.2), 0.05, 'wood')


def lamp(name, x, y, z):
    box(name, x - 0.06, x + 0.06, y - 0.06, y + 0.06, z, z + 2.0, 'pole')
    box(name + '_l', x - 0.16, x + 0.16, y - 0.16, y + 0.16, z + 1.8, z + 2.15, 'lamp')


QUAY_Z = 0.8


def build_wharf_quay():
    # stone quay along the middle of the shore, a timber pier on piles, a shipwright's shed and slip on the west beach
    box('quay', -15.5, 7.0, -0.2, 3.2, 0, QUAY_Z, 'stone')
    obj('quay_top', [(-15.5, -0.2, QUAY_Z + 0.01), (7.0, -0.2, QUAY_Z + 0.01), (7.0, 3.2, QUAY_Z + 0.01), (-15.5, 3.2, QUAY_Z + 0.01)],
        [(0, 1, 2, 3)], ['paving'])
    for k in range(12):
        x = -14.8 + k * 1.95
        box(f'bollard{k}', x - 0.12, x + 0.12, 0.0, 0.24, QUAY_Z, QUAY_Z + 0.35, 'pole')
    # pier
    px0, px1 = -9.2, -6.8
    box('pier', px0, px1, -7.0, -0.2, 0.62, 0.78, 'plank')
    for k in range(5):
        y = -6.8 + k * 1.6
        for x in (px0 + 0.12, px1 - 0.12):
            box(f'pile{k}{x:.0f}', x - 0.14, x + 0.14, y - 0.14, y + 0.14, 0, 1.2, 'wood')
    rowboat('boat', -11.2, -4.6, 3.0, 1.2, 0.25)
    # props along the quay
    for k, (x, y) in enumerate([(-5.4, 1.4), (-4.8, 1.0), (-5.1, 2.0), (2.5, 1.6)]):
        crate(f'crate{k}', x, y, QUAY_Z, 0.6)
    crate('crate_top', -5.1, 1.3, QUAY_Z + 0.6, 0.5)
    for k, (x, y) in enumerate([(-3.2, 1.2), (-2.6, 1.5), (-2.9, 0.8), (3.4, 1.0), (-8.2, -6.2)]):
        barrel(f'barrel{k}', x, y, QUAY_Z if y > 0 else 0.78)
    cyl('coil', -7.7, -1.5, 0.3, 0.78, 0.9, 'pole')
    lamp('lamp0', -10.4, 0.5, QUAY_Z)
    lamp('lamp1', 0.6, 0.5, QUAY_Z)
    palm('palm0', -13.8, 2.4, QUAY_Z, 4.6, 1.1, 1)
    palm('palm1', 5.6, 2.6, QUAY_Z, 4.2, -0.9, 2)
    palm('palm2', -17.2, 3.0, SHORE_Z, 3.8, 0.8, 3)
    shipwright_yard(-19.6, 0.6)


def shipwright_yard(cx, y0):
    """Open-fronted shed on the beach with a hull in frames on the slip in front of it."""
    gabled('shed', cx - 1.8, cx + 1.8, y0 + 1.8, y0 + 4.2, SHORE_Z, 1.5, 1.0, True, 'wood', 'thatch')
    box('shed_open', cx - 1.3, cx + 1.3, y0 + 1.76, y0 + 1.8, SHORE_Z, SHORE_Z + 1.2, 'dark')
    obj('slip', [(cx - 0.9, -0.3, 0.0), (cx + 0.9, -0.3, 0.0), (cx + 0.9, y0 + 1.6, SHORE_Z + 0.05), (cx - 0.9, y0 + 1.6, SHORE_Z + 0.05)],
        [(0, 1, 2, 3)], ['plank'])
    for k in range(5):
        x = cx - 1.0 + k * 0.5
        beam(f'rib{k}', (x, -0.1 + 0.25 * k, 0.2), (x, -0.1 + 0.25 * k, 1.3 - abs(k - 2) * 0.15), 0.07, 'hull')
    beam('keel', (cx - 1.4, 0.0, 0.25), (cx + 1.4, 0.8, 0.35), 0.1, 'hull')
    REG['shipwright'] = ['shed_w', 'shed_r', 'rib0', 'rib4', 'slip']


# --- render setup: workbench, flat + studio passes like render_towns.py ---
sc.render.engine = 'BLENDER_WORKBENCH'
sc.display.shading.color_type = 'MATERIAL'
sc.display.shading.show_cavity = False
sc.display.shading.show_specular_highlight = False
sc.display.render_aa = 'OFF'
sc.view_settings.view_transform = 'Standard'
sc.render.film_transparent = True
sc.render.filter_size = 0
sc.render.dither_intensity = 0  # Blender's output dither speckles the ramp steps
sc.render.resolution_percentage = 100
sc.render.resolution_x, sc.render.resolution_y = W, H
sc.render.image_settings.file_format = 'PNG'
sc.render.image_settings.color_mode = 'RGBA'

cam_data = bpy.data.cameras.new('cam')
cam_data.type = 'PERSP'
cam_data.lens = 30
cam_data.sensor_fit = 'HORIZONTAL'
cam_data.sensor_width = 36
cam_data.clip_end = 400
cam = bpy.data.objects.new('cam', cam_data)
sc.collection.objects.link(cam)
sc.camera = cam
cam.location = Vector((-2.0, -30.0, 10.5))
TARGET = Vector((-2.0, 14.0, 1.0))
cam.rotation_euler = (TARGET - cam.location).to_track_quat('-Z', 'Y').to_euler()
bpy.context.view_layer.update()


def proj(p):
    q = world_to_camera_view(sc, cam, Vector(p))
    return q.x * W, (1 - q.y) * H


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


def render_passes():
    out = []
    tmp = os.path.join(TMP, 'harbour_pass.png')
    for light in ('FLAT', 'STUDIO'):
        sc.display.shading.light = light
        sc.render.filepath = tmp
        bpy.ops.render.render(write_still=True)
        out.append(load(tmp))
    return out


STATS = {}


def snap(flat, lit, tag=''):
    mask = flat[..., 3] > 0.5
    f, l = flat[..., :3], lit[..., :3]
    mid = ((f[:, :, None, :] - BASE[None, None]) ** 2).sum(-1).argmin(-1)
    r = (l.sum(-1) + 1e-3) / (f.sum(-1) + 1e-3)
    if mask.any():
        STATS[tag] = np.percentile(r[mask], [5, 25, 50, 75, 95]).round(2).tolist()
    step = np.where(r < 0.5, 0, np.where(r > 0.665, 2, 1))
    out = np.zeros_like(flat)
    out[..., :3] = RAMP[mid, step]
    out[..., 3] = mask
    out[~mask] = 0
    return out, mid


def rect(names):
    """Screen rectangle around the named objects' bounding boxes (live objects only)."""
    xs, ys = [], []
    for n in names:
        o = bpy.data.objects.get(n)
        if o is None:
            continue
        for c in o.bound_box:
            px, py = proj(o.matrix_world @ Vector(c))
            xs.append(px); ys.append(py)
    x0, y0 = max(0, int(min(xs))), max(0, int(min(ys)))
    return [x0, y0, min(W, int(math.ceil(max(xs)))) - x0, min(H, int(math.ceil(max(ys)))) - y0]


# --- sky and sea are painted in numpy ---
BAYER = np.array([[0, 8, 2, 10], [12, 4, 14, 6], [3, 11, 1, 9], [15, 7, 13, 5]], dtype=np.float32) / 16 + 1 / 32


def rgb(h):
    return np.array(hexrgb(h), dtype=np.float32) / 255


def dither_bands(rows, cols, stops):
    """stops: list of (row, colour). Between neighbouring stops, ordered dither from one colour to the next."""
    out = np.zeros((rows, cols, 3), dtype=np.float32)
    yy, xx = np.mgrid[0:rows, 0:cols]
    th = BAYER[yy % 4, xx % 4]
    for (r0, c0), (r1, c1) in zip(stops, stops[1:]):
        sel = (yy >= r0) & (yy < r1)
        t = (yy - r0) / max(1, r1 - r0)
        out[sel] = np.where((t > th)[..., None], rgb(c1), rgb(c0))[sel]
    out[yy >= stops[-1][0]] = rgb(stops[-1][1])
    out[yy < stops[0][0]] = rgb(stops[0][1])
    return out


def paint_sky():
    img = np.ones((H, W, 4), dtype=np.float32)
    img[..., :3] = dither_bands(H, W, [(0, '3c5e8b'), (60, '4f8fba'), (150, '73bed3'), (215, 'a4dddb'), (250, 'a4dddb')])
    yy, xx = np.mgrid[0:H, 0:W]
    th = BAYER[yy % 4, xx % 4]
    rnd = random.Random(11)
    for cx, cy, sx in [(140, 58, 1.0), (420, 34, 0.8), (700, 72, 1.2), (900, 30, 0.7), (560, 120, 0.6)]:
        d = np.zeros((H, W), dtype=np.float32)
        for k in range(6):
            ex = cx + rnd.uniform(-60, 60) * sx
            ey = cy + rnd.uniform(-6, 6)
            rx, ry = rnd.uniform(26, 46) * sx, rnd.uniform(9, 15) * sx
            d = np.maximum(d, 1 - ((xx - ex) / rx) ** 2 - ((yy - ey) / ry) ** 2)
        d[yy > cy + 10 * sx] = np.minimum(d, 0)[yy > cy + 10 * sx]  # flat cloud bottoms
        body = d > 0.25
        edge = (d > 0) & ~body & (d > th * 0.25)
        under = body & (yy > cy + 2)
        img[edge, :3] = rgb('c7cfcc')
        img[body, :3] = rgb('ebede9')
        img[under & (th > 0.5), :3] = rgb('c7cfcc')
    return img


def paint_sea(wharf_alpha, frame):
    """The water band below the shoreline, minus whatever the wharf puts in front of it, with a 4-frame shimmer."""
    top = int(math.ceil(proj((0, 0, 0))[1]))
    img = np.zeros((H, W, 4), dtype=np.float32)
    band = dither_bands(H - top, W, [(0, '4f8fba'), (10, '3c5e8b'), (70, '3c5e8b'), (H - top, '253a5e')])
    img[top:, :, :3] = band
    img[top:, :, 3] = 1
    rnd = random.Random(23)
    for _ in range(420):
        r = rnd.randint(top + 2, H - 2)
        depth = (r - top) / (H - top)
        L = int(3 + depth * 14 * rnd.uniform(0.6, 1.2))
        c = rnd.randint(0, W - 1)
        ph = rnd.randint(0, 3)
        # each dash is lit for two of the four frames and drifts one pixel per frame, so the loop is seamless
        on = (frame - ph) % 4
        if on > 1:
            continue
        x0 = c + on * (1 if rnd.random() < 0.5 else -1)
        col = '73bed3' if depth > 0.15 else 'a4dddb'
        img[r, max(0, x0):min(W, x0 + L), :3] = rgb(col)
    # waterline foam: the sea pixel directly under each wharf pixel that stands in the water
    a = wharf_alpha > 0.5
    below = np.zeros_like(a)
    below[1:] = a[:-1] & ~a[1:]
    below[:top] = False
    foam = below.copy()
    if frame % 2:
        foam[:, 1:] |= below[:, :-1]
    img[foam, :3] = rgb('a4dddb')
    img[a] = 0
    return img


# --- colonial town kit; one geometry call per tier, nation only changes style ---
NATION = 'england'
STYLE = {  # roof pitch as a fraction of span, and whether gables face the quay
    'spain': dict(pitch=0.34, gable=0.3, spire=0.9),
    'england': dict(pitch=0.62, gable=0.3, spire=3.4),
    'france': dict(pitch=0.75, gable=0.2, spire=3.0),
    'netherlands': dict(pitch=0.8, gable=1.0, spire=3.6),
}
REG = {}  # hotspot id -> object names, plus 'flag' -> pole top


def stepped_gable(name, x0, x1, y, t, rise):
    """Dutch stepped gable: a wall-coloured stair-step facade standing proud of the roof at the front."""
    half = (x1 - x0) / 2
    d, s = half / 3.6, rise * 1.08 / 3
    left = [(x0, t)]
    for i in range(3):
        left += [(x0 + i * d, t + (i + 1) * s), (x0 + (i + 1) * d, t + (i + 1) * s)]
    right = [(x1 - (px - x0), pz) for px, pz in reversed(left)]
    xz_prism(name, left + right, y - 0.06, y + 0.3, WALL)


def house(name, x0, x1, y0, y1, z0, h, along_x, rows=2):
    st = STYLE[NATION]
    span = (y1 - y0) if along_x else (x1 - x0)
    gabled(name, x0, x1, y0, y1, z0, h, span * st['pitch'], along_x, WALL, ROOF)
    if NATION == 'netherlands' and not along_x:
        stepped_gable(name + '_sg', x0, x1, y0, z0 + h, span * st['pitch'])
    n = max(2, int((x1 - x0) / 0.75))
    windows(name, x0, x1, y0, z0, h, n, rows)


def row_houses(seed, x0, x1, y0, depth, z0, skip, hrange=(1.7, 2.5)):
    """Fill a terrace row with houses, leaving the skip intervals free for landmark buildings."""
    rnd = random.Random(seed)
    st = STYLE[NATION]
    x, k = x0, 0
    while x < x1 - 1.6:
        w = rnd.uniform(1.8, 2.8)
        if any(x < b and x + w > a for a, b in skip):
            x = max(b for a, b in skip if x < b and x + w > a) + rnd.uniform(0.2, 0.4)
            continue
        if x + w > x1:
            break
        dy = rnd.uniform(-0.3, 0.3)
        d = rnd.uniform(depth * 0.8, depth)
        gable = rnd.random() < st['gable']
        house(f'h{seed}_{k}', x, x + w, y0 + dy + 0.3, y0 + dy + 0.3 + d, z0, rnd.uniform(*hrange), not gable,
              2 if rnd.random() < 0.7 else 1)
        rnd.random()
        x += w + rnd.uniform(0.25, 0.55)
        k += 1


def terraces(rows, x0, x1):
    """Stepped town ground: each row a level platform with a stone retaining wall facing the water."""
    for k, (ya, yb, z, shrink) in enumerate(rows):
        box(f'terrace{k}', x0 + shrink, x1 - shrink * 0.5, ya, yb + 4, 0, z, 'road')
        box(f'terrace{k}_wall', x0 + shrink, x1 - shrink * 0.5, ya - 0.02, ya + 0.05, 0, z, 'stone')
        # steps up the middle of each retaining wall
        for i in range(4):
            box(f'stair{k}_{i}', -3.6 - 0.1 * i, -2.8 + 0.1 * i, ya - 0.6 + i * 0.15, ya, 0, z - (3 - i) * z / 4 * 0.3, 'stone')


def church(cx, y0, z0, s=1.0):
    st = STYLE[NATION]
    gabled('nave', cx - 1.4 * s, cx + 1.4 * s, y0 + 0.8, y0 + 5.0, z0, 3.0 * s, 1.5 * s, False, WALL, ROOF)
    if NATION == 'netherlands':
        stepped_gable('nave_sg', cx - 1.4 * s, cx + 1.4 * s, y0 + 0.8, z0 + 3.0 * s, 1.5 * s)
    tw = 0.85 * s
    top = z0 + 6.4 * s
    box('tower', cx - tw, cx + tw, y0, y0 + 2 * tw, z0, top, WALL)
    box('belfry', cx - tw - 0.08, cx + tw + 0.08, y0 - 0.08, y0 + 2 * tw + 0.08, top - 0.15, top + 0.1, WALL)
    box('bell_hole', cx - 0.32, cx + 0.32, y0 - 0.04, y0, top - 1.4 * s, top - 0.45 * s, 'dark')
    box('rose', cx - 0.25, cx + 0.25, y0 - 0.04, y0, z0 + 3.4 * s, z0 + 3.9 * s, 'dark')
    box('church_door', cx - 0.35, cx + 0.35, y0 - 0.04, y0, z0, z0 + 1.2, 'dark')
    v = [(cx - tw - 0.12, y0 - 0.12, top + 0.1), (cx + tw + 0.12, y0 - 0.12, top + 0.1), (cx + tw + 0.12, y0 + 2 * tw + 0.12, top + 0.1),
         (cx - tw - 0.12, y0 + 2 * tw + 0.12, top + 0.1), (cx, y0 + tw, top + 0.1 + st['spire'] * s)]
    obj('spire', v, [(0, 1, 4), (1, 2, 4), (2, 3, 4), (3, 0, 4), (3, 2, 1, 0)], [ROOF])
    box('cross_v', cx - 0.05, cx + 0.05, y0 + tw - 0.05, y0 + tw + 0.05, top + st['spire'] * s, top + st['spire'] * s + 0.6, 'pole')
    box('cross_h', cx - 0.22, cx + 0.22, y0 + tw - 0.05, y0 + tw + 0.05, top + st['spire'] * s + 0.32, top + st['spire'] * s + 0.42, 'pole')
    return ['nave_w', 'nave_r', 'tower', 'spire']


def governor(x0, x1, y0, z0):
    hipped('gov', x0, x1, y0, y0 + 3.2, z0, 3.8, 1.4, WALL, ROOF)
    windows('gov', x0 + 0.3, x1 - 0.3, y0, z0, 3.8, 7, 2, door=True)
    xm = (x0 + x1) / 2
    # portico: two pairs of pale columns and a pediment over the door
    for k, dx in enumerate((-1.1, -0.6, 0.6, 1.1)):
        box(f'gov_col{k}', xm + dx - 0.1, xm + dx + 0.1, y0 - 0.9, y0 - 0.7, z0, z0 + 2.0, 'cloth')
    xz_prism('gov_ped', [(xm - 1.4, z0 + 2.0), (xm + 1.4, z0 + 2.0), (xm, z0 + 2.7)], y0 - 1.0, y0, 'cloth')
    box('gov_steps', xm - 1.5, xm + 1.5, y0 - 1.1, y0, z0, z0 + 0.2, 'stone')
    REG['governor'] = ['gov_w', 'gov_r', 'gov_ped', 'gov_steps']


def warehouse(x0, x1, y0, z0):
    gabled('wh', x0, x1, y0, y0 + 3.2, z0, 2.8, 1.5, True, WALL, ROOF)
    n = 3
    for k in range(n):
        xc = x0 + (x1 - x0) * (k + 0.5) / n
        box(f'wh_door{k}', xc - 0.55, xc + 0.55, y0 - 0.04, y0, z0, z0 + 1.6, 'dark')
        box(f'wh_loft{k}', xc - 0.3, xc + 0.3, y0 - 0.04, y0, z0 + 2.0, z0 + 2.5, 'dark')
    beam('wh_hoist', ((x0 + x1) / 2, y0 + 0.2, z0 + 3.2), ((x0 + x1) / 2, y0 - 0.9, z0 + 3.2), 0.08, 'wood')
    beam('wh_rope', ((x0 + x1) / 2, y0 - 0.8, z0 + 3.2), ((x0 + x1) / 2, y0 - 0.8, z0 + 1.9), 0.03, 'pole')
    crate('wh_bale', (x0 + x1) / 2, y0 - 0.8, z0 + 1.4, 0.5)
    REG['merchant'] = ['wh_w', 'wh_r']


def tavern(x0, x1, y0, z0):
    house('tav', x0, x1, y0, y0 + 2.8, z0, 2.2, True, 2)
    beam('tav_arm', (x1 - 0.4, y0, z0 + 2.0), (x1 - 0.4, y0 - 1.0, z0 + 2.0), 0.05, 'pole')
    box('tav_sign', x1 - 0.48, x1 - 0.32, y0 - 0.95, y0 - 0.35, z0 + 1.3, z0 + 1.95, 'plank')
    barrel('tav_barrel', x0 + 0.4, y0 - 0.5, z0)
    REG['tavern'] = ['tav_w', 'tav_r', 'tav_sign']


def city_walls(x0, x1, y, z0):
    box('cwall', x0, x1, y, y + 0.8, 0, z0 + 2.0, 'stone')
    n = int((x1 - x0) / 0.8)
    for k in range(n):
        x = x0 + k * (x1 - x0) / n
        box(f'merlon{k}', x, x + 0.4, y - 0.02, y + 0.3, z0 + 2.0, z0 + 2.45, 'stone')
    for k, x in enumerate((x0 + 1.0, (x0 + x1) / 2 + 3.0, x1 - 1.0)):
        box(f'ctower{k}', x - 0.9, x + 0.9, y - 0.4, y + 1.2, 0, z0 + 3.2, 'stone')
        box(f'ctower{k}_slit', x - 0.12, x + 0.12, y - 0.44, y - 0.4, z0 + 2.0, z0 + 2.7, 'dark')
        for i, dx in enumerate((-0.9, -0.2, 0.5)):
            box(f'ctower{k}_m{i}', x + dx, x + dx + 0.4, y - 0.42, y - 0.1, z0 + 3.2, z0 + 3.6, 'stone')


TIER_Z = [QUAY_Z, 2.6, 4.4, 6.2]


def town_large():
    terraces([(3.2, 7.2, TIER_Z[0], 0), (7.2, 11.2, TIER_Z[1], 0.5), (11.2, 15.2, TIER_Z[2], 1.2), (15.2, 19.2, TIER_Z[3], 2.0)], -17.5, 8.0)
    city_walls(-15.5, 7.0, 19.0, TIER_Z[3])
    warehouse(-13.6, -7.8, 3.7, TIER_Z[0])
    tavern(-2.2, 0.8, 3.9, TIER_Z[0])
    row_houses(11, -7.2, 6.8, 3.6, 2.6, TIER_Z[0], [(-2.4, 1.0)])
    row_houses(12, -16.8, 7.5, 7.6, 3.0, TIER_Z[1], [(0.6, 7.5)])
    palm('plaza_palm0', 1.6, 8.6, TIER_Z[1], 3.4, 0.5, 5)
    palm('plaza_palm1', 6.4, 8.4, TIER_Z[1], 3.0, -0.6, 6)
    church(-5.0, 11.6, TIER_Z[2])
    governor(0.8, 6.8, 11.9, TIER_Z[2])
    row_houses(13, -16.2, 7.0, 11.6, 3.0, TIER_Z[2], [(-6.8, -3.0), (0.5, 7.2)])
    row_houses(14, -15.4, 6.6, 15.6, 2.8, TIER_Z[3], [(-6.5, -3.4)], (1.6, 2.2))


def headland(name, x0, x1, y1, z, seed):
    """Rocky outcrop under a fort: an irregular low slab plus boulders tumbling into the water at its foot."""
    rnd = random.Random(seed)
    n = 14
    front = [(x0 + (x1 - x0) * k / n, 0.3 + rnd.uniform(-0.2, 0.6)) for k in range(n + 1)]
    pts = front + [(x1 + 1.5, y1), (x0 + 0.6, y1)]
    prism(name, pts, 0, z, 'rock')
    for k in range(9):
        x = x0 + 0.5 + (x1 - x0 - 1) * (k + rnd.uniform(0.1, 0.9)) / 9
        r = rnd.uniform(0.5, 0.95)
        blob(f'{name}_b{k}', x, 0.55 + rnd.uniform(-0.1, 0.3), r * 0.35, r, r * 0.9, 'rock', rnd.uniform(0, 1))


def fort_large():
    headland('headland', 7.6, 22.0, 9.0, 1.2, 51)
    z0, z1 = 1.2, 4.4
    # curtain wall facing the water with a pointed bastion towards the camera on its west end
    box('curtain', 10.4, 20.5, 1.8, 7.5, z0, z1, 'stone')
    bx, by = 10.8, 2.6
    prism('bastion', [(bx, by - 2.0), (bx + 2.1, by), (bx, by + 2.0), (bx - 2.1, by)], z0, z1, 'stone')
    box('yard', 10.8, 20.1, 2.2, 7.2, z0, z1 + 0.02, 'road')
    for k in range(9):
        x = 12.4 + k * 0.9
        box(f'fmerlon{k}', x, x + 0.45, 1.78, 2.2, z1, z1 + 0.5, 'stone')
    for k in range(4):
        x = 13.2 + k * 1.8
        box(f'emb{k}', x - 0.3, x + 0.3, 1.74, 1.8, z1 - 1.1, z1 - 0.5, 'dark')
        beam(f'fgun{k}', (x, 2.2, z1 - 0.8), (x, 1.2, z1 - 0.8), 0.13, 'dark')
    # sentry box on the bastion point
    cyl('garita', bx, by - 1.8, 0.45, z1 - 0.3, z1 + 0.9, 'stone', 8)
    cone('garita_cap', bx, by - 1.8, 0.6, z1 + 0.9, z1 + 1.7, 'stone', 8)
    box('garita_slit', bx - 0.1, bx + 0.1, by - 2.27, by - 2.2, z1 + 0.2, z1 + 0.6, 'dark')
    # keep with the flag
    box('keep', 14.3, 17.8, 3.6, 6.8, z0, z1 + 3.8, 'stone')
    for k in range(5):
        x = 14.3 + k * 0.78
        box(f'kmerlon{k}', x, x + 0.4, 3.56, 3.9, z1 + 3.8, z1 + 4.3, 'stone')
    for k in range(2):
        box(f'kslit{k}', 15.2 + k * 1.6 - 0.12, 15.2 + k * 1.6 + 0.12, 3.56, 3.6, z1 + 1.6, z1 + 2.6, 'dark')
    REG['flag'] = flagpole('keep_pole', 16.0, 5.2, z1 + 3.8, z1 + 7.6)


def town_medium():
    terraces([(3.2, 7.2, TIER_Z[0], 2.0), (7.2, 11.2, TIER_Z[1], 2.6), (11.2, 15.2, TIER_Z[2], 3.6)], -15.0, 7.0)
    warehouse(-11.6, -7.4, 3.7, TIER_Z[0])
    tavern(-2.2, 0.8, 3.9, TIER_Z[0])
    row_houses(21, -7.0, 5.8, 3.6, 2.6, TIER_Z[0], [(-2.4, 1.0)])
    row_houses(22, -11.8, 5.6, 7.6, 3.0, TIER_Z[1], [(-6.2, -1.6)])
    church(-4.0, 7.8, TIER_Z[1], 0.85)
    governor(-1.2, 3.8, 11.9, TIER_Z[2])
    row_houses(23, -11.0, 4.8, 11.6, 3.0, TIER_Z[2], [(-1.4, 4.0)], (1.6, 2.2))


def town_small():
    """A few houses on the coastal plain behind the beach; a trading house and a tavern either side of the jetty head."""
    z = SHORE_Z
    gabled('trade', -8.2, -4.6, 3.6, 6.4, z, 2.2, 1.1, True, WALL, ROOF)
    windows('trade', -8.2, -4.6, 3.6, z, 2.2, 3, 1)
    box('trade_awning', -8.0, -4.8, 2.7, 3.6, z + 1.5, z + 1.62, 'cloth')
    for k, x in enumerate((-7.9, -4.9)):
        box(f'trade_post{k}', x - 0.06, x + 0.06, 2.7, 2.82, z, z + 1.5, 'pole')
    crate('trade_crate0', -7.4, 3.1, z, 0.5)
    barrel('trade_barrel', -5.6, 3.1, z)
    REG['merchant'] = ['trade_w', 'trade_r', 'trade_awning']
    REG['flag'] = flagpole('small_pole', -3.6, 3.4, z, z + 4.6)
    tavern(0.2, 3.0, 3.9, z)
    rnd = random.Random(31)
    for k, (x0, y0, w) in enumerate([(-11.6, 4.8, 2.4), (-6.0, 8.0, 2.2), (-2.6, 7.6, 2.4), (1.0, 8.4, 2.0), (4.0, 5.0, 2.2), (-9.8, 8.6, 2.0)]):
        house(f's{k}', x0, x0 + w, y0, y0 + rnd.uniform(2.0, 2.6), z, rnd.uniform(1.4, 1.9), rnd.random() > STYLE[NATION]['gable'], 1)
    palm('spalm0', -1.2, 6.5, z, 3.6, 0.7, 8)
    palm('spalm1', 6.8, 7.4, z, 3.2, -0.6, 9)


def fort_medium():
    headland('battery_rock', 8.0, 18.5, 7.0, 0.9, 52)
    z0, z1 = 0.9, 2.5
    box('battery', 10.2, 18.0, 1.6, 6.0, z0, z1, 'stone')
    bx, by = 10.4, 2.4
    prism('bbastion', [(bx, by - 1.6), (bx + 1.7, by), (bx, by + 1.6), (bx - 1.7, by)], z0, z1, 'stone')
    box('battery_yard', 10.6, 17.6, 2.0, 5.8, z0, z1 + 0.02, 'road')
    for k in range(8):
        x = 11.9 + k * 0.78
        box(f'bmerlon{k}', x, x + 0.42, 1.58, 1.95, z1, z1 + 0.45, 'stone')
    for k in range(3):
        x = 12.7 + k * 1.6
        box(f'bemb{k}', x - 0.25, x + 0.25, 1.54, 1.6, z1 - 0.8, z1 - 0.35, 'dark')
        beam(f'bgun{k}', (x, 2.0, z1 + 0.25), (x, 1.2, z1 + 0.25), 0.12, 'dark')
    hipped('magazine', 14.4, 16.8, 3.8, 5.6, z1, 1.3, 0.7, 'stone', 'stone')
    box('mag_door', 15.4, 15.8, 3.76, 3.8, z1, z1 + 0.9, 'dark')
    cyl('bgarita', bx, by - 1.4, 0.4, z1 - 0.2, z1 + 0.8, 'stone', 8)
    cone('bgarita_cap', bx, by - 1.4, 0.55, z1 + 0.8, z1 + 1.5, 'stone', 8)
    REG['flag'] = flagpole('battery_pole', 13.0, 4.6, z1, z1 + 4.4)


def build_wharf_jetty():
    """Small tier: no quay, just the beach, a timber jetty on piles, a boat and the shipwright's shed."""
    jx0, jx1 = -3.4, -1.6
    box('jetty', jx0, jx1, -7.0, 3.0, 0.55, 0.7, 'plank')
    for k in range(6):
        y = -6.8 + k * 1.7
        for x in (jx0 + 0.12, jx1 - 0.12):
            box(f'jpile{k}{x:.0f}', x - 0.13, x + 0.13, y - 0.13, y + 0.13, 0, 1.05, 'wood')
    rowboat('jboat', -5.6, -4.0, 2.8, 1.1, -0.2)
    barrel('jbarrel0', -2.9, -5.8, 0.7)
    barrel('jbarrel1', -2.2, 1.0, 0.7)
    crate('jcrate', -2.5, 1.9, 0.7, 0.5)
    palm('jpalm0', -6.8, 2.2, SHORE_Z, 4.0, 1.0, 11)
    palm('jpalm1', 2.8, 2.0, SHORE_Z, 4.4, -1.1, 12)
    palm('jpalm2', 9.6, 2.8, SHORE_Z, 3.6, 0.6, 13)
    shipwright_yard(-14.0, 0.6)


def shack(name, x0, x1, y0, y1, h, along_x, sag, z=SHORE_Z):
    """Dark plank walls under a weathered board roof; `sag` drops one end of the ridge so no two roofs line up."""
    gabled(name, x0, x1, y0, y1, z, h, 0.9 if along_x else 0.8, along_x, 'wood', 'thatch', 0.15)
    bpy.data.objects[name + '_r'].data.vertices[4].co.z -= sag
    box(name + '_door', (x0 + x1) / 2 - 0.25, (x0 + x1) / 2 + 0.25, y0 - 0.04, y0, z, z + 1.0, 'dark')
    box(name + '_win', x0 + 0.3, x0 + 0.7, y0 - 0.04, y0, z + 0.8, z + 1.2, 'dark')


def stakes(name, pts, seed, height=2.2, z=SHORE_Z):
    rnd = random.Random(seed)
    k = 0
    for (ax, ay), (bx, by) in zip(pts, pts[1:]):
        n = max(1, int(math.hypot(bx - ax, by - ay) / 0.42))
        for i in range(n):
            t = i / n
            x, y = ax + (bx - ax) * t, ay + (by - ay) * t
            top = z + height + rnd.uniform(-0.3, 0.3)
            box(f'{name}{k}', x - 0.2, x + 0.2, y - 0.2, y + 0.2, z, top, 'stake')
            cone(f'{name}{k}p', x, y, 0.24, top, top + 0.4, 'stake', 4)
            k += 1


def town_haven():
    z = SHORE_Z
    # tavern front: the biggest building, two floors, a balcony and a hanging sign
    gabled('tav', -2.6, 2.6, 4.2, 7.4, z, 2.8, 1.3, True, 'wood', 'thatch', 0.2)
    windows('tav', -2.6, 2.6, 4.2, z, 2.8, 5, 2)
    box('tav_balcony', -2.6, 2.6, 3.4, 4.2, z + 1.45, z + 1.6, 'plank')
    for k, x in enumerate((-2.4, 0.0, 2.4)):
        box(f'tav_post{k}', x - 0.08, x + 0.08, 3.42, 3.58, z, z + 1.45, 'pole')
    box('tav_rail', -2.6, 2.6, 3.4, 3.5, z + 1.6, z + 1.95, 'wood')
    box('tav_board', -1.6, 1.6, 4.1, 4.2, z + 2.85, z + 3.5, 'plank')
    box('tav_board_mark', -0.9, 0.9, 4.06, 4.1, z + 3.05, z + 3.3, 'dark')
    lamp('tav_lamp', 3.0, 3.6, z)
    for k, (x, y) in enumerate([(-3.2, 3.6), (-3.6, 4.2), (3.6, 4.6)]):
        barrel(f'tav_barrel{k}', x, y, z)
    REG['tavern'] = ['tav_w', 'tav_r', 'tav_board', 'tav_balcony']
    # trading stall under an awning, for the merchant
    box('stall', -7.8, -4.6, 3.6, 4.6, z, z + 0.9, 'plank')
    box('stall_awning', -8.0, -4.4, 3.2, 4.8, z + 2.0, z + 2.12, 'cloth')
    for k, x in enumerate((-7.9, -4.5)):
        box(f'stall_post{k}', x - 0.07, x + 0.07, 3.25, 3.39, z, z + 2.0, 'pole')
    crate('stall_crate', -6.0, 3.0, z, 0.55)
    barrel('stall_barrel', -5.2, 2.9, z)
    REG['merchant'] = ['stall', 'stall_awning', 'stall_post0', 'stall_post1']
    shack('shack0', -11.4, -9.4, 5.0, 6.8, 1.6, True, 0.2)
    shack('shack1', -8.4, -6.4, 6.8, 8.6, 1.8, False, 0.15)
    shack('shack2', -5.2, -3.4, 7.8, 9.4, 1.5, True, -0.15)
    shack('shack3', 3.6, 5.6, 6.6, 8.4, 1.7, False, 0.2)
    shack('shack4', 6.4, 8.2, 4.4, 6.0, 1.4, True, 0.15)
    shack('shack5', -13.8, -12.0, 7.4, 9.0, 1.5, False, -0.1)
    # gallows by the beach
    beam('gal_post0', (5.2, 3.0, z), (5.2, 3.0, z + 3.0), 0.1, 'wood')
    beam('gal_post1', (7.0, 3.0, z), (7.0, 3.0, z + 3.0), 0.1, 'wood')
    beam('gal_bar', (5.0, 3.0, z + 3.0), (7.2, 3.0, z + 3.0), 0.1, 'wood')
    beam('gal_rope', (6.1, 3.0, z + 3.0), (6.1, 3.0, z + 2.1), 0.03, 'trunk')
    box('gal_noose', 6.0, 6.2, 2.95, 3.05, z + 1.85, z + 2.1, 'trunk')
    # palisade along the landward side, behind the shacks
    stakes('pal', [(-16.0, 10.4), (-6.0, 11.0), (4.0, 10.6), (10.0, 9.6)], 61)
    for k, (x, y) in enumerate([(-0.6, 9.6), (9.2, 7.8), (-15.0, 6.0)]):
        palm(f'hpalm{k}', x, y, z, 4.0 + 0.3 * k, (-1) ** k * 0.8, 20 + k)


def fort_haven():
    """Lookout tower and a stretch of stockade with two old guns on the eastern point."""
    z = SHORE_Z
    headland('haven_rock', 10.5, 19.0, 6.0, 0.6, 53)
    z0 = 0.6
    stakes('sp', [(11.2, 7.0), (11.2, 1.6), (18.5, 1.2)], 62, 2.0, z0)
    for k, (x0, y0) in enumerate([(11.2, 3.4), (12.8, 3.4), (11.2, 5.0), (12.8, 5.0)]):
        beam(f'lk_leg{k}', (x0 + 1.0, y0 - 0.2, z0), (x0 + 1.0 + (0.3 if k % 2 == 0 else -0.3), y0 - 0.2, z0 + 5.4), 0.12, 'wood')
    box('lk_floor', 11.9, 14.3, 2.9, 5.1, z0 + 5.4, z0 + 5.6, 'plank')
    box('lk_rail', 11.9, 14.3, 2.9, 3.05, z0 + 5.6, z0 + 6.3, 'wood')
    gabled('lk_roof_post', 12.0, 14.2, 3.0, 5.0, z0 + 6.3, 0.0, 0.7, True, 'wood', 'thatch', 0.25)
    for k, x in enumerate((14.8, 16.8)):
        box(f'hgun_carr{k}', x - 0.35, x + 0.35, 2.0, 2.8, z0, z0 + 0.4, 'wood')
        beam(f'hgun{k}', (x, 2.6, z0 + 0.55), (x, 0.9, z0 + 0.7), 0.14, 'dark')
    REG['flag'] = flagpole('haven_pole', 13.1, 4.0, z0 + 6.3, z0 + 9.6)


def careened(cx, cy, length, width, heel):
    """A sloop hull lying heeled over on the beach for scraping, keel towards the town."""
    n = 14
    v, f = [], []
    c, s_ = math.cos(math.radians(heel)), math.sin(math.radians(heel))
    for i in range(n + 1):
        t = i / n
        x = cx - length / 2 + t * length
        w = width / 2 * (math.sqrt(max(0.0, 1 - (2 * t - 1) ** 2)) if t > 0.5 else 1 - (1 - 2 * t) ** 3) + 0.03
        for yy, zz in ((-0.7 * w, 0), (-w, 1.4), (w, 1.4), (0.7 * w, 0)):
            v.append((x, cy + yy * c - zz * s_, SHORE_Z * 0.5 + yy * s_ + zz * c + 0.6 * abs(s_)))
    for i in range(n):
        a, b = 4 * i, 4 * (i + 1)
        f += [(a, b, b + 1, a + 1), (a + 1, b + 1, b + 2, a + 2), (a + 2, b + 2, b + 3, a + 3), (a + 3, b + 3, b, a)]
    obj('careened', v, f, ['hull', 'plank'], [0, 1, 0, 0] * n)


def build_wharf_haven():
    careened(-13.0, 1.8, 6.4, 2.4, -34)
    beam('mast_stump', (-12.8, 1.4, 1.2), (-11.4, 4.6, 4.4), 0.14, 'wood')
    for k, (x, y) in enumerate([(-16.6, 0.6), (-9.4, 0.6)]):
        beam(f'prop{k}', (x, y, SHORE_Z * 0.5), (x + (1.2 if k == 0 else -1.4), y + 0.6, 1.6), 0.09, 'wood')
    for k, (x, y) in enumerate([(-9.6, 2.2), (-9.0, 2.6), (-17.6, 1.6)]):
        barrel(f'hbarrel{k}', x, y, SHORE_Z * 0.6)
    cyl('pitch_pot', -10.4, 3.2, 0.4, SHORE_Z * 0.6, SHORE_Z + 0.5, 'dark')
    cone('fire', -10.4, 3.2, 0.3, SHORE_Z + 0.5, SHORE_Z + 1.1, 'lamp', 5)
    REG['shipwright'] = ['careened', 'mast_stump']
    # rickety jetty: piles lean a little, the deck steps down part-way
    rnd = random.Random(71)
    jx0, jx1 = 0.8, 2.6
    box('hjetty0', jx0, jx1, -2.4, 2.6, 0.55, 0.7, 'plank')
    box('hjetty1', jx0 + 0.1, jx1 - 0.1, -6.2, -2.4, 0.45, 0.6, 'plank')
    for k in range(5):
        y = -6.0 + k * 1.9
        for x in (jx0 + 0.15, jx1 - 0.15):
            lean = rnd.uniform(-0.25, 0.25)
            beam(f'hpile{k}{x:.0f}', (x, y, 0), (x + lean, y, 1.1 + rnd.uniform(-0.2, 0.3)), 0.13, 'wood')
    rowboat('hboat', -1.6, -3.6, 2.8, 1.1, 0.4)
    palm('wpalm0', -17.0, 2.8, SHORE_Z, 4.4, 1.0, 31)
    palm('wpalm1', 4.6, 2.2, SHORE_Z, 3.8, -0.8, 32)
    crate('hcrate0', 1.6, 1.8, 0.7, 0.5)


ANCHOR_QUAY = (1.5, -9.0, 0)
ANCHOR_HAVEN = (6.5, -9.0, 0)
ANCHOR_JETTY = (4.0, -9.0, 0)
TIERS = {
    'small': dict(town=town_small, fort=None, wharf='jetty'),
    'medium': dict(town=town_medium, fort=fort_medium, wharf='quay'),
    'large': dict(town=town_large, fort=fort_large, wharf='quay'),
}

ANCHOR = {'quay': ANCHOR_QUAY, 'jetty': ANCHOR_JETTY}
COMPOSITIONS = {}


def write_png(arr, name):
    save(arr, os.path.join(OUT, name))
    print('WROTE', name)


def want(job):
    return not ONLY or job in ONLY


def run_layer(job, build, fname):
    """Render one layer if asked for; always rebuilds the geometry so hotspots and flag points stay current."""
    global CUR
    REG.clear()
    CUR = []
    build()
    bpy.context.view_layer.update()
    rects = {k: rect(v) for k, v in REG.items() if k != 'flag'}
    flag = [int(round(c)) for c in proj(REG['flag'])] if 'flag' in REG else None
    img = None
    if want(job):
        passes = render_passes()
        img, _ = snap(*passes, job)
        write_png(img, fname)
    for o in CUR:
        bpy.data.objects.remove(o, do_unlink=True)
    CUR = []
    return img, rects, flag


def L(name):
    return f'{REL}/{name}'


if want('sky'):
    write_png(paint_sky(), 'harbour.shared.sky.png')
run_layer('backdrop', build_backdrop, 'harbour.shared.backdrop.png')
WHARF = {}
for kind, build in (('quay', build_wharf_quay), ('jetty', build_wharf_jetty)):
    img, WHARF[kind], _ = run_layer(f'wharf.{kind}', build, f'harbour.shared.wharf.{kind}.png')
    if img is not None:
        for fr in range(4):
            write_png(paint_sea(img[..., 3], fr), f'harbour.shared.sea.{kind}.f{fr:02d}.png')

for tier, cfg in TIERS.items():
    fort_flag = None
    if cfg['fort']:
        _, _, fort_flag = run_layer(f'fort.{tier}', cfg['fort'], f'harbour.shared.fort.{tier}.png')
    kind = cfg['wharf']
    for nation in NATIONS:
        NATION = nation
        set_nation(nation)
        cid = f'harbour.{nation}.{tier}'
        _, town_rects, town_flag = run_layer(f'town.{nation}.{tier}', cfg['town'], f'{cid}.town.png')
        hot = {**town_rects, **WHARF[kind]}
        layers = [{'id': 'sky', 'file': L('harbour.shared.sky.png')},
                  {'id': 'backdrop', 'file': L('harbour.shared.backdrop.png')},
                  {'id': 'town', 'file': L(f'{cid}.town.png')}]
        if cfg['fort']:
            layers.append({'id': 'fort', 'file': L(f'harbour.shared.fort.{tier}.png')})
        layers += [{'id': 'wharf', 'file': L(f'harbour.shared.wharf.{kind}.png')},
                   {'id': 'sea', 'frames': [L(f'harbour.shared.sea.{kind}.f{k:02d}.png') for k in range(4)]}]
        COMPOSITIONS[cid] = {
            'layers': layers,
            'hotspots': {k: hot[k] for k in ('merchant', 'tavern', 'governor', 'shipwright') if k in hot},
            'flag': fort_flag or town_flag,
            'anchor': [int(round(c)) for c in proj(ANCHOR[kind])],
        }
# pirate haven: its own wharf (beach, careened hull, rickety jetty) and therefore its own sea cut-out
img, hw, _ = run_layer('wharf.haven', build_wharf_haven, 'harbour.pirate.haven.wharf.png')
if img is not None:
    for fr in range(4):
        write_png(paint_sea(img[..., 3], fr), f'harbour.pirate.haven.sea.f{fr:02d}.png')
_, _, hflag = run_layer('fort.haven', fort_haven, 'harbour.pirate.haven.fort.png')
_, ht, _ = run_layer('town.haven', town_haven, 'harbour.pirate.haven.town.png')
hot = {**ht, **hw}
COMPOSITIONS['harbour.pirate.haven'] = {
    'layers': [{'id': 'sky', 'file': L('harbour.shared.sky.png')},
               {'id': 'backdrop', 'file': L('harbour.shared.backdrop.png')},
               {'id': 'town', 'file': L('harbour.pirate.haven.town.png')},
               {'id': 'fort', 'file': L('harbour.pirate.haven.fort.png')},
               {'id': 'wharf', 'file': L('harbour.pirate.haven.wharf.png')},
               {'id': 'sea', 'frames': [L(f'harbour.pirate.haven.sea.f{k:02d}.png') for k in range(4)]}],
    'hotspots': {k: hot[k] for k in ('merchant', 'tavern', 'shipwright') if k in hot},
    'flag': hflag,
    'anchor': [int(round(c)) for c in proj(ANCHOR_HAVEN)],
}
with open(os.path.join(OUT, 'harbours.json'), 'w') as fh:
    json.dump(COMPOSITIONS, fh, indent=1)
for cid, c in COMPOSITIONS.items():
    if 'england' in cid or 'pirate' in cid:
        print('HOT', cid, json.dumps(c['hotspots']), 'flag', c['flag'], 'anchor', c['anchor'])
def check_outputs():
    """Every layer file: 960x540 RGBA, alpha 0 or 255 only, every opaque pixel a corsair.gpl colour."""
    pal = set()
    for line in open(os.path.join(REPO, 'art/palette/corsair.gpl')):
        parts = line.split()
        if len(parts) >= 4 and all(p.isdigit() for p in parts[:3]):
            pal.add(tuple(int(p) for p in parts[:3]))
    lay = json.load(open(os.path.join(OUT, 'harbours.json')))
    files = sorted({f for c in lay.values() for l in c['layers'] for f in ([l['file']] if 'file' in l else l['frames'])})
    on_disk = sorted(f'{REL}/{n}' for n in os.listdir(OUT) if n.endswith('.png'))
    bad = 0
    for f in files:
        path = os.path.join(REPO, f)
        if not os.path.exists(path):
            print('CHECK MISSING', f); bad += 1; continue
        img = bpy.data.images.load(path)
        w, h, ch = img.size[0], img.size[1], img.channels
        a = np.empty(w * h * 4, dtype=np.float32)
        img.pixels.foreach_get(a)
        bpy.data.images.remove(img)
        px = np.rint(a.reshape(-1, 4) * 255).astype(np.int32)
        alpha_ok = bool(np.isin(px[:, 3], (0, 255)).all())
        op = px[px[:, 3] == 255][:, :3]
        cols = {tuple(c) for c in np.unique(op, axis=0)} if len(op) else set()
        off = cols - pal
        ok = (w, h) == (W, H) and ch == 4 and alpha_ok and not off
        bad += not ok
        print('CHECK', 'ok ' if ok else 'BAD', f, w, h, ch, 'alpha01' if alpha_ok else 'ALPHA', len(cols), 'colours', f'off-palette {sorted(off)[:4]}' if off else '')
    print('CHECK files', len(files), 'on disk', len(on_disk), 'unreferenced', sorted(set(on_disk) - set(files)), 'failures', bad)


if CHECK:
    check_outputs()
print('STATS', json.dumps(STATS))
print('DONE')
