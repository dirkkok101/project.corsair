"""Builds low-poly settlements and renders the world-map town sprites: 4 nations x 3 sizes + pirate haven, 96 px.

Run from the repo root:
  /Applications/Blender.app/Contents/MacOS/Blender -b --python tools/art/render_towns.py -- "$PWD" <tmp dir>
"""
import bpy, math, os, random, sys
import numpy as np
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

REPO = sys.argv[sys.argv.index('--') + 1]
TMP = sys.argv[sys.argv.index('--') + 2]
OUT = os.path.join(REPO, 'art/generated/settlements')
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


def set_colour(m, h):
    m.diffuse_color = (*[lin(v) for v in hexrgb(h)], 1)


# Every object built is appended to the current settlement's list so each settlement renders alone.
CUR = []


def obj(name, verts, faces, mats, idx=None):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    for m in mats:
        me.materials.append(m)
    if idx:
        for p, i in zip(me.polygons, idx):
            p.material_index = i
    o = bpy.data.objects.new(name, me)
    sc.collection.objects.link(o)
    CUR.append(o)
    return o


def beam(name, p0, p1, t, m):
    p0, p1 = Vector(p0), Vector(p1)
    d = (p1 - p0).normalized()
    helper = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((1, 0, 0))
    a = d.cross(helper).normalized() * t
    b = d.cross(a).normalized() * t
    v = [tuple(p + s * a + u * b) for p in (p0, p1) for s, u in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    f = [(0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7), (0, 3, 2, 1), (4, 5, 6, 7)]
    return obj(name, v, f, [m])


def box(name, x0, x1, y0, y1, z0, z1, m):
    v = [(x, y, z) for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)]
    f = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    return obj(name, v, f, [m])


def prism(name, pts, z0, z1, m):
    """Extrude a counter-clockwise 2D polygon from z0 to z1."""
    n = len(pts)
    v = [(x, y, z0) for x, y in pts] + [(x, y, z1) for x, y in pts]
    f = [tuple(range(n - 1, -1, -1)), tuple(range(n, 2 * n))]
    f += [(i, (i + 1) % n, n + (i + 1) % n, n + i) for i in range(n)]
    return obj(name, v, f, [m])


def pyramid(name, cx, cy, half, z0, z1, m):
    v = [(cx - half, cy - half, z0), (cx + half, cy - half, z0), (cx + half, cy + half, z0), (cx - half, cy + half, z0), (cx, cy, z1)]
    return obj(name, v, [(0, 1, 4), (1, 2, 4), (2, 3, 4), (3, 0, 4), (3, 2, 1, 0)], [m])


def gabled(name, x0, x1, y0, y1, h, rise, along_x, wall, roof, over=0.08):
    """Walls box plus a pitched roof; ridge runs along X or Y. Gable ends are wall-coloured."""
    box(name + '_w', x0, x1, y0, y1, 0, h, wall)
    if along_x:
        a0, a1, b0, b1 = x0 - over, x1 + over, y0 - over, y1 + over
        ym = (y0 + y1) / 2
        v = [(a0, b0, h), (a1, b0, h), (a1, b1, h), (a0, b1, h), (a0, ym, h + rise), (a1, ym, h + rise)]
        f = [(0, 1, 5, 4), (2, 3, 4, 5), (0, 4, 3), (1, 2, 5), (3, 2, 1, 0)]
    else:
        a0, a1, b0, b1 = x0 - over, x1 + over, y0 - over, y1 + over
        xm = (x0 + x1) / 2
        v = [(a0, b0, h), (a1, b0, h), (a1, b1, h), (a0, b1, h), (xm, b0, h + rise), (xm, b1, h + rise)]
        f = [(1, 2, 5, 4), (3, 0, 4, 5), (0, 1, 4), (2, 3, 5), (3, 2, 1, 0)]
    # The gable triangles sit on the overhang plane; colour them as wall so the ends read as plaster.
    obj(name + '_r', v, f, [roof, wall], [0, 0, 1, 1, 0])


def ground(name, rx, ry, seed, m, cx=0.0, cy=0.0, n=20):
    """An irregular low pad of earth under the buildings, so the cluster reads as one place."""
    rnd = random.Random(seed)
    pts = []
    for i in range(n):
        a = 2 * math.pi * i / n
        k = 1 + rnd.uniform(-0.07, 0.07)
        pts.append((cx + rx * k * math.cos(a), cy + ry * k * math.sin(a)))
    return prism(name, pts, 0, 0.08, m)


# --- materials (keys are the flat-pass colours snap() matches against) ---
WALL = mat('wall', 'e7d5b3')      # whitewashed plaster
ROOF = mat('roof', 'cf573c')      # recoloured per nation before rendering
EARTH = mat('earth', 'c09473')
STONE = mat('stone', '819796')
YARD = mat('yard', 'ad7757')
GUN = mat('gun', '241527')
POLE = mat('pole', '4d2b32')
WOOD = mat('wood', '7a4841')      # haven shacks, jetties
PLANK = mat('plank', 'be772b')    # haven roofs, decking
SAND = mat('sand', 'e8c170')
HULL = mat('hull', '602c2c')
STAKE = mat('stake', '884b2b')
THATCH = mat('thatch', 'de9e41')  # haven shack roofs: weathered boards
MARK = mat('flagmark', 'ff00ff')  # flag anchor; replaced by a painted flag after snapping

NATION_ROOF = {'spain': 'cf573c', 'england': '577277', 'france': '3c5e8b', 'netherlands': '752438'}


def flagpole(name, x, y, z0, z1):
    box(name, x - 0.07, x + 0.07, y - 0.07, y + 0.07, z0, z1, POLE)
    box(name + '_mark', x + 0.07, x + 0.2, y - 0.07, y + 0.07, z1 - 0.13, z1, MARK)


def church(cx, cy, s=1.0):
    """Nave runs north from a square tower on the south (camera) side."""
    gabled('nave', cx - 0.55 * s, cx + 0.55 * s, cy, cy + 2.0 * s, 0.95 * s, 0.6 * s, False, WALL, ROOF, 0.1)
    tw = 0.42 * s
    ty = cy - 0.1
    box('tower', cx - tw, cx + tw, ty - 2 * tw, ty, 0, 2.3 * s, WALL)
    box('belfry', cx - tw - 0.05, cx + tw + 0.05, ty - 2 * tw - 0.05, ty + 0.05, 2.3 * s, 2.42 * s, WALL)
    pyramid('spire', cx, ty - tw, tw + 0.08, 2.42 * s, 3.2 * s, ROOF)
    box('door', cx - 0.12, cx + 0.12, ty - 2 * tw - 0.02, ty - 2 * tw, 0, 0.45, GUN)
    box('bell', cx - 0.12, cx + 0.12, ty - 2 * tw - 0.02, ty - 2 * tw, 1.75 * s, 2.05 * s, GUN)


def bastion_fort(cx, cy, half, h, guns):
    """Square curtain with diamond bastions at the corners and a raised inner yard."""
    box('curtain', cx - half, cx + half, cy - half, cy + half, 0, h, STONE)
    b = half * 0.55
    for sx in (-1, 1):
        for sy in (-1, 1):
            px, py = cx + sx * half, cy + sy * half
            prism(f'bastion{sx}{sy}', [(px, py - b), (px + b, py), (px, py + b), (px - b, py)], 0, h, STONE)
    t = 0.38
    box('yard', cx - half + t, cx + half - t, cy - half + t, cy + half - t, 0, h + 0.01, YARD)
    # gun pips along the south curtain and the faces of the south bastions
    for k in range(guns):
        x = cx - half + b + (2 * half - 2 * b) * (k + 0.5) / guns
        box(f'gun{k}', x - 0.09, x + 0.09, cy - half - 0.02, cy - half, h * 0.45, h * 0.8, GUN)
    for sx in (-1, 1):
        px, py = cx + sx * half, cy - half
        gx, gy = px + sx * b * 0.5, py - b * 0.5
        box(f'bgun{sx}', gx - 0.09, gx + 0.09, gy - 0.02, gy, h * 0.45, h * 0.8, GUN)
    # keep / magazine with the flag
    gabled('keep', cx - 0.4, cx + 0.4, cy - 0.1, cy + 0.6, h + 0.55, 0.35, True, STONE, ROOF, 0.06)
    flagpole('fort_pole', cx, cy + 0.25, h + 0.8, h + 2.0)


def battery(cx, cy, w, h, guns):
    """A low angular gun platform: a wedge pointing south with pips on its faces."""
    pts = [(cx - w, cy + 0.7), (cx - w, cy - 0.2), (cx, cy - 0.9), (cx + w, cy - 0.2), (cx + w, cy + 0.7)]
    prism('battery', pts, 0, h, STONE)
    prism('battery_yard', [(x * 0.78 + cx * 0.22, y * 0.78 + cy * 0.22 + 0.05) for x, y in pts], 0, h + 0.01, YARD)
    for k in range(guns):
        t = (k + 0.5) / guns
        if t < 0.5:
            x0, y0, x1, y1 = cx - w, cy - 0.2, cx, cy - 0.9
            u = t * 2
        else:
            x0, y0, x1, y1 = cx, cy - 0.9, cx + w, cy - 0.2
            u = (t - 0.5) * 2
        x, y = x0 + (x1 - x0) * u, y0 + (y1 - y0) * u
        box(f'bgun{k}', x - 0.09, x + 0.09, y - 0.12, y - 0.02, h * 0.4, h * 0.8, GUN)
    flagpole('battery_pole', cx, cy + 0.3, h, h + 1.6)


def houses(seed, n, rx, ry, cx, cy, avoid, size=(0.75, 1.25), height=(0.5, 0.9)):
    """Seeded rejection sampling inside an ellipse; houses keep a small street gap from each other."""
    rnd = random.Random(seed)
    placed = list(avoid)
    count, tries = 0, 0
    while count < n and tries < 4000:
        tries += 1
        w, d = rnd.uniform(*size), rnd.uniform(size[0] * 0.8, size[1] * 0.85)
        x, y = cx + rnd.uniform(-rx, rx), cy + rnd.uniform(-ry, ry)
        if ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 > 1:
            continue
        r = (x - w / 2 - 0.12, x + w / 2 + 0.12, y - d / 2 - 0.12, y + d / 2 + 0.12)
        if any(r[0] < a[1] and r[1] > a[0] and r[2] < a[3] and r[3] > a[2] for a in placed):
            continue
        placed.append(r)
        along_x = rnd.random() < 0.6
        h = rnd.uniform(*height)
        span = d if along_x else w
        gabled(f'house{seed}_{count}', x - w / 2, x + w / 2, y - d / 2, y + d / 2, h, span * 0.6, along_x, WALL, ROOF)
        count += 1


def build_city():
    ground('city_ground', 5.0, 2.9, 11, EARTH, 0.0, 0.0)
    bastion_fort(2.7, -0.3, 1.25, 0.75, 3)
    church(-1.2, 0.2, 1.0)
    fort = (2.7 - 2.0, 2.7 + 2.0, -0.3 - 2.0, -0.3 + 2.0)
    ch = (-1.2 - 0.75, -1.2 + 0.75, 0.2 - 1.1, 0.2 + 2.2)
    houses(101, 16, 4.6, 2.6, -0.4, 0.0, [fort, ch], height=(0.75, 1.25))


def build_town():
    ground('town_ground', 3.8, 2.3, 21, EARTH, 0.0, 0.0)
    battery(2.3, -0.6, 0.9, 0.55, 3)
    church(-0.6, 0.1, 0.85)
    bat = (2.3 - 1.2, 2.3 + 1.2, -0.6 - 1.1, -0.6 + 1.0)
    ch = (-0.6 - 0.65, -0.6 + 0.65, 0.1 - 1.0, 0.1 + 1.9)
    houses(202, 9, 3.5, 2.0, -0.2, 0.0, [bat, ch], height=(0.7, 1.1))


def build_hamlet():
    ground('hamlet_ground', 2.2, 1.5, 31, EARTH, 0.0, 0.2)
    # jetty stub running out to the south-east
    box('jetty', 0.9, 1.35, -2.2, -0.6, 0.12, 0.22, WOOD)
    for k, y in enumerate((-2.1, -1.5)):
        for x in (0.95, 1.3):
            box(f'pile{k}{x}', x - 0.06, x + 0.06, y - 0.06, y + 0.06, 0, 0.3, POLE)
    flagpole('hamlet_pole', -0.2, -0.5, 0, 1.6)
    houses(303, 5, 2.0, 1.3, -0.1, 0.35, [(-0.45, 0.05, -0.8, -0.2), (0.8, 1.45, -2.3, -0.5)],
           size=(0.75, 1.1), height=(0.55, 0.8))


def hull(cx, cy, length, width, heel):
    """A small hull lying heeled over on the beach (careened), stern to the west."""
    n = 14
    v, f = [], []
    c, s = math.cos(math.radians(heel)), math.sin(math.radians(heel))
    for i in range(n + 1):
        t = i / n
        x = cx - length / 2 + t * length
        w = width / 2 * (math.sqrt(max(0.0, 1 - (2 * t - 1) ** 2)) if t > 0.5 else 1 - (1 - 2 * t) ** 3) + 0.02
        for yy, zz in ((-0.8 * w, 0), (-w, 0.45), (w, 0.45), (0.8 * w, 0)):
            # heel about the keel line: roll the section towards -y (the camera)
            v.append((x, cy + yy * c - zz * s, yy * s + zz * c + 0.25 * s))
    for i in range(n):
        a, b = 4 * i, 4 * (i + 1)
        f += [(a, b, b + 1, a + 1), (a + 1, b + 1, b + 2, a + 2), (a + 2, b + 2, b + 3, a + 3), (a + 3, b + 3, b, a)]
    obj('hull', v, f, [HULL, PLANK], [0, 1, 0, 0] * n)


def shack(name, x0, x1, y0, y1, h, along_x, sag):
    """Dark plank walls under a brown roof; `sag` drops one end of the ridge so no two roofs line up."""
    gabled(name, x0, x1, y0, y1, h, 0.45, along_x, WOOD, THATCH, 0.1)
    roof = bpy.data.objects[name + '_r'].data
    roof.vertices[4].co.z -= sag
    box(name + '_door', (x0 + x1) / 2 - 0.1, (x0 + x1) / 2 + 0.1, y0 - 0.02, y0, 0, 0.4, GUN)


def build_haven():
    ground('haven_ground', 2.9, 1.8, 41, SAND, 0.0, 0.1)
    # palisade of stakes across the landward (north) side
    rnd = random.Random(42)
    for k in range(21):
        a = math.pi * (-0.1 + 1.2 * k / 20)
        x, y = 2.6 * math.cos(a), 0.3 + 1.45 * math.sin(a)
        top = 1.05 + rnd.uniform(-0.15, 0.15)
        box(f'stake{k}', x - 0.13, x + 0.13, y - 0.13, y + 0.13, 0, top, STAKE)
        pyramid(f'stakept{k}', x, y, 0.13, top, top + 0.22, STAKE)
    shack('shack0', -2.1, -1.1, 0.35, 1.15, 0.75, True, 0.15)
    shack('shack1', -0.7, 0.4, 0.6, 1.4, 0.9, True, -0.1)
    shack('shack2', 0.9, 1.7, 0.2, 1.1, 0.7, False, 0.12)
    shack('shack3', -1.9, -1.05, -0.9, -0.15, 0.65, False, 0.1)
    # careened hull on the beach, keel towards the town
    hull(1.4, -1.35, 3.0, 1.2, -30)
    beam('stump', (1.3, -1.3, 0.3), (2.3, -1.5, 1.5), 0.08, POLE)
    flagpole('haven_pole', -0.1, -0.1, 0, 2.2)
    box('crate0', -0.45, -0.15, -0.9, -0.6, 0, 0.3, PLANK)
    box('crate1', -0.25, 0.05, -1.3, -1.0, 0, 0.25, PLANK)


BUILD = {'city': build_city, 'town': build_town, 'hamlet': build_hamlet, 'haven': build_haven}
SETS = {}
for key, fn in BUILD.items():
    CUR = []
    fn()
    SETS[key] = CUR

# --- render setup: workbench, studio light, same as render_brig.py ---
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
    return a.reshape(h, w, 4)[::-1].copy()  # top-down rows


def save(arr, path):
    h, w = arr.shape[:2]
    img = bpy.data.images.new('tmp', w, h, alpha=True)
    img.pixels.foreach_set(arr[::-1].astype(np.float32).ravel())
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    bpy.data.images.remove(img)


# Per-material 3-step ramps (dark, mid, light) from corsair.gpl, keyed by flat-pass base colour.
RAMPS = {
    'e7d5b3': ['c09473', 'e7d5b3', 'ebede9'],  # whitewash
    'c09473': ['4d2b32', '7a4841', 'ad7757'],  # earth pad
    '819796': ['394a50', '577277', '819796'],  # fort stone
    'ad7757': ['819796', 'a8b5b2', 'a8b5b2'],  # fort yard, paved
    '241527': ['241527', '241527', '241527'],  # gun pips, doors
    '4d2b32': ['341c27', '4d2b32', '4d2b32'],  # poles, piles
    '7a4841': ['341c27', '4d2b32', '7a4841'],  # weathered wood
    'be772b': ['602c2c', '884b2b', 'be772b'],  # planks
    'e8c170': ['be772b', 'de9e41', 'e8c170'],  # sand
    'de9e41': ['602c2c', '884b2b', 'be772b'],  # shack roofs
    '602c2c': ['341c27', '602c2c', '884b2b'],  # hull
    '884b2b': ['4d2b32', '884b2b', 'ad7757'],  # palisade
    'ff00ff': ['4d2b32', '4d2b32', '4d2b32'],  # flag marker -> pole colour
    # nation roofs
    'cf573c': ['752438', 'a53030', 'cf573c'],  # spain terracotta
    '577277': ['202e37', '394a50', '577277'],  # england slate
    '3c5e8b': ['172038', '253a5e', '253a5e'],  # france blue slate, darker than water
    '752438': ['341c27', '602c2c', '752438'],  # netherlands brick
}
KEYS = list(RAMPS)
BASE = np.array([hexrgb(h) for h in KEYS], dtype=np.float32) / 255
RAMP = np.array([[hexrgb(h) for h in r] for r in RAMPS.values()], dtype=np.float32) / 255
MARK_I = KEYS.index('ff00ff')

W, R, B, K, S = 'ebede9', 'a53030', '253a5e', '10141f', 'c7cfcc'
FLAGS = {
    'spain': [[W, W, W, W, W, W, W], [W, R, W, W, W, R, W], [W, W, R, W, R, W, W], [W, W, W, R, W, W, W],
              [W, W, R, W, R, W, W], [W, R, W, W, W, R, W]],
    'england': [[W, W, W, R, W, W, W], [W, W, W, R, W, W, W], [R, R, R, R, R, R, R], [W, W, W, R, W, W, W],
                [W, W, W, R, W, W, W]],
    'france': [[W] * 7] * 5,
    'netherlands': [[R] * 7, [R] * 7, [W] * 7, [W] * 7, [B] * 7, [B] * 7],
    'pirate': [[K, K, K, K, K, K, K], [K, K, W, W, W, K, K], [K, K, W, K, W, K, K], [K, K, K, W, K, K, K],
               [K, W, K, K, K, W, K], [K, K, K, K, K, K, K]],
}


def snap(flat, lit, flag):
    mask = flat[..., 3] > 0.5
    f, l = flat[..., :3], lit[..., :3]
    mid = ((f[:, :, None, :] - BASE[None, None]) ** 2).sum(-1).argmin(-1)
    r = (l.sum(-1) + 1e-3) / (f.sum(-1) + 1e-3)
    step = np.where(r < 0.42, 0, np.where(r > 0.66, 2, 1))
    out = np.zeros_like(flat)
    out[..., :3] = RAMP[mid, step]
    out[..., 3] = mask
    out[~mask] = 0
    # Paint the flag pixel-exact, flying east from the top of the marker; a 3D quad this small rasterises unevenly.
    ys, xs = np.nonzero(mask & (mid == MARK_I))
    if len(ys):
        top, left = ys.min(), xs.min()
        for j, row in enumerate(flag):
            for i, h in enumerate(row):
                out[top + j, left + i, :3] = np.array(hexrgb(h)) / 255
                out[top + j, left + i, 3] = 1
        mask = out[..., 3] > 0.5
    # 1 px outside outline
    n = np.zeros_like(mask)
    n[1:] |= mask[:-1]; n[:-1] |= mask[1:]; n[:, 1:] |= mask[:, :-1]; n[:, :-1] |= mask[:, 1:]
    ring = n & ~mask
    out[ring, :3] = OUTLINE
    out[ring, 3] = 1
    return out


# Same 45 deg orthographic camera as the brig, looking north from the south. 8 px per unit at 96 px.
CELL = 96
cam_data.ortho_scale = 12
cam_data.clip_end = 100
T = Vector((0, 0, 1.9))
e = math.radians(45)
cam.location = T + Vector((0, -math.cos(e), math.sin(e))) * 20
cam.rotation_euler = (T - cam.location).to_track_quat('-Z', 'Y').to_euler()
sc.render.resolution_x = sc.render.resolution_y = CELL
bpy.context.view_layer.update()
p = world_to_camera_view(sc, cam, Vector((0, 0, 0)))
print(f'PIVOT ground origin at x={p.x:.3f} y={1 - p.y:.3f} (fractions of the cell from top-left)')

JOBS = [(f'settlement.{n}.{s}.png', s, n) for n in NATION_ROOF for s in ('hamlet', 'town', 'city')]
JOBS.append(('settlement.pirate.haven.png', 'haven', 'pirate'))
tmp = os.path.join(TMP, 'town_pass.png')
for fname, key, nation in JOBS:
    for other, objs in SETS.items():
        for o in objs:
            o.hide_render = other != key
    set_colour(ROOF, NATION_ROOF.get(nation, 'cf573c'))
    passes = []
    for light in ('FLAT', 'STUDIO'):
        sc.display.shading.light = light
        sc.render.filepath = tmp
        bpy.ops.render.render(write_still=True)
        passes.append(load(tmp))
    save(snap(*passes, FLAGS[nation]), os.path.join(OUT, fname))
print('DONE')
