"""Builds low-poly sea life and renders the world-map wildlife sprites, 8 facings each.

Run from the repo root:
  /Applications/Blender.app/Contents/MacOS/Blender -b --python tools/art/render_wildlife.py -- "$PWD" <tmp dir> [animal ...]
"""
import bpy, json, math, os, sys
import numpy as np
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

ARGS = sys.argv[sys.argv.index('--') + 1:]
REPO, TMP = ARGS[0], ARGS[1]
ONLY = set(ARGS[2:])
OUT = os.path.join(REPO, 'art/generated/wildlife')
os.makedirs(OUT, exist_ok=True)
os.makedirs(TMP, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene


def hexrgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def lin(c):
    c /= 255
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


MATS = {}


def mat(h):
    if h not in MATS:
        m = bpy.data.materials.new(h)
        m.diffuse_color = (*[lin(v) for v in hexrgb(h)], 1)
        MATS[h] = m
    return MATS[h]


# Water mask: a flat colour outside the palette, so snap() can tell open water from the animal.
MASK = '00ff00'

root = bpy.data.objects.new('heading', None)
sc.collection.objects.link(root)


class Mesh:
    """Vertices and faces in the animal's straight body frame: head along +Y, up +Z."""

    def __init__(self):
        self.v, self.f, self.m = [], [], []

    def face(self, idx, h):
        self.f.append(idx)
        self.m.append(h)

    def add_verts(self, pts):
        base = len(self.v)
        self.v += [tuple(p) for p in pts]
        return base


def loft(M, sections, matfn, n=10):
    """sections: (y, half width, half height, centre z); w == 0 is a pointed end. matfn(seg, sin_mid) -> hex."""
    rings = []
    for y, w, h, zc in sections:
        if w == 0:
            rings.append([M.add_verts([(0, y, zc)])])
        else:
            b = M.add_verts([(w * math.cos(2 * math.pi * k / n), y, zc + h * math.sin(2 * math.pi * k / n)) for k in range(n)])
            rings.append(list(range(b, b + n)))
    for s in range(len(rings) - 1):
        a, b = rings[s], rings[s + 1]
        for k in range(n):
            sm = math.sin(2 * math.pi * (k + 0.5) / n)
            h = matfn(s, sm)
            k1 = (k + 1) % n
            if len(a) == 1:
                M.face((a[0], b[k1], b[k]), h)
            elif len(b) == 1:
                M.face((a[k], a[k1], b[0]), h)
            else:
                M.face((a[k], a[k1], b[k1], b[k]), h)


def fin(M, y0, y1, zb, yt, zt, t, h):
    """A swept dorsal fin wedge: base from y0 (rear) to y1 (front) at zb, tip at (yt, zt)."""
    b = M.add_verts([(-t, y1, zb), (t, y1, zb), (-t, y0, zb), (t, y0, zb), (0, yt, zt)])
    A, B, C, D, T = range(b, b + 5)
    for f in ((A, C, T), (B, T, D), (A, T, B), (C, D, T), (A, B, D, C)):
        M.face(f, h)


def slab(M, pts, t, top, bottom=None):
    """Extrude a polygon of 3D points (roughly horizontal) by t vertically."""
    n = len(pts)
    b = M.add_verts([(x, y, z - t / 2) for x, y, z in pts] + [(x, y, z + t / 2) for x, y, z in pts])
    M.face(tuple(b + i for i in range(n - 1, -1, -1)), bottom or top)
    M.face(tuple(b + n + i for i in range(n)), top)
    for i in range(n):
        j = (i + 1) % n
        M.face((b + i, b + j, b + n + j, b + n + i), top)


def strip(M, stations, mats, t=0.0):
    """Wing from root to tip: stations (x, y leading, y trailing, z); mats per span segment."""
    le = [(x, yl, z) for x, yl, yt, z in stations]
    te = [(x, yt, z) for x, yl, yt, z in stations]
    n = len(stations)
    for i in range(n - 1):
        slab(M, [te[i], te[i + 1], le[i + 1], le[i]], t or 0.02, mats[i])


def mirror(M):
    """Copy every face to the other side (x -> -x)."""
    n = len(M.v)
    M.v += [(-x, y, z) for x, y, z in M.v]
    M.f += [tuple(n + i for i in reversed(f)) for f in list(M.f)]
    M.m += list(M.m)


def pose(M, bend=0.0, pitch=0.0, ty=0.0, tz=0.0):
    """Bend the spine into an arc (bend > 0 humps up), pitch nose-up by `pitch` degrees, then move."""
    out = []
    p = math.radians(pitch)
    cp, sp = math.cos(p), math.sin(p)
    for x, y, z in M.v:
        if bend:
            R = 1 / bend
            a = y / R
            r = R + z
            y, z = r * math.sin(a), r * math.cos(a) - R
        y, z = y * cp - z * sp, y * sp + z * cp
        out.append((x, y + ty, z + tz))
    return out


def build(name, M, verts):
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], M.f)
    keys = sorted(set(M.m))
    for h in keys:
        me.materials.append(mat(h))
    for poly, h in zip(me.polygons, M.m):
        poly.material_index = keys.index(h)
    o = bpy.data.objects.new(name, me)
    o.parent = root
    sc.collection.objects.link(o)
    return o


# --- dolphin: bottlenose, ~2 units long, beak at +Y ---
D_BACK, D_BELLY = '819796', 'c7cfcc'


def dolphin():
    M = Mesh()
    secs = [(-0.86, 0.03, 0.06, 0.0), (-0.6, 0.06, 0.12, 0.01), (-0.3, 0.14, 0.2, 0.02), (0.05, 0.22, 0.26, 0.02),
            (0.35, 0.23, 0.25, 0.01), (0.6, 0.19, 0.2, 0.0), (0.75, 0.13, 0.15, 0.02), (0.83, 0.07, 0.08, -0.04),
            (0.97, 0.04, 0.035, -0.06), (1.02, 0, 0, -0.06)]
    loft(M, secs, lambda s, sm: D_BELLY if sm < -0.25 else D_BACK)
    fin(M, -0.2, 0.2, 0.2, -0.32, 0.62, 0.08, D_BACK)
    slab(M, [(0, -0.8, 0), (0.08, -0.84, 0), (0.34, -1.02, 0), (0.3, -1.08, 0), (0.06, -0.99, 0), (0, -1.01, 0),
             (-0.06, -0.99, 0), (-0.3, -1.08, 0), (-0.34, -1.02, 0), (-0.08, -0.84, 0)], 0.05, D_BACK)
    for s in (-1, 1):  # pectoral flippers, angled down and back
        slab(M, [(s * 0.15, 0.48, -0.1), (s * 0.15, 0.32, -0.12), (s * 0.4, 0.2, -0.22), (s * 0.38, 0.28, -0.2)][::s], 0.04, D_BACK)
    return M


ANIMALS = {}
DOLPHIN = dolphin()
ANIMALS['dolphin'] = dict(
    cell=(32, 32), ortho=3.9, target=(0, 0, 0.9), mask=True, pivot_at=(0, 0, 0),
    ramps={D_BACK: ['577277', '819796', 'a8b5b2'], D_BELLY: ['a8b5b2', 'c7cfcc', 'ebede9']},
    anims={
        # (bend, pitch, ty, tz) per frame
        'swim': [(DOLPHIN, (0.0, 0, 0, -0.13)), (DOLPHIN, (0.05, -3, 0, -0.17))],
        'leap': [(DOLPHIN, (0.15, 50, -0.6, 0.2)), (DOLPHIN, (0.45, 0, 0.0, 1.7)),
                 (DOLPHIN, (0.15, -45, 0.6, 0.9)), (DOLPHIN, (0.05, -70, 0.95, -0.2))],
    })

# --- flying fish: ~1 unit long, wing-like pectoral fins spread wide ---
F_BACK, F_BELLY, F_FIN = '73bed3', 'ebede9', 'a8b5b2'


def flying_fish(flex):
    M = Mesh()
    secs = [(-0.42, 0.02, 0.03, 0.0), (-0.3, 0.05, 0.06, 0.0), (0.0, 0.09, 0.09, 0.0), (0.25, 0.085, 0.085, 0.0),
            (0.42, 0.05, 0.05, -0.01), (0.5, 0, 0, -0.02)]
    loft(M, secs, lambda s, sm: F_BELLY if sm < -0.2 else F_BACK, n=8)
    W = Mesh()
    strip(W, [(0.05, 0.22, 0.04, 0.0), (0.35, 0.17, -0.16, 0.6 * flex), (0.62, -0.04, -0.22, flex)], [F_FIN, F_FIN])
    strip(W, [(0.04, -0.18, -0.26, 0.0), (0.2, -0.24, -0.34, 0.3 * flex)], [F_FIN])  # pelvic fins
    mirror(W)
    b = len(M.v)
    M.v += W.v
    M.f += [tuple(b + i for i in f) for f in W.f]
    M.m += W.m
    # forked tail, lower lobe longer, as a vertical slab
    for (yt, zt) in ((-0.64, 0.13), (-0.72, -0.17)):
        bb = M.add_verts([(x, y, z) for x in (-0.02, 0.02) for y, z in ((-0.38, 0.03), (-0.38, -0.03), (yt, zt))])
        for f in ((0, 1, 2), (5, 4, 3), (0, 2, 5, 3), (1, 4, 5, 2), (0, 3, 4, 1)):
            M.face(tuple(bb + i for i in f), F_BACK)
    return M


ANIMALS['flying_fish'] = dict(
    cell=(16, 16), ortho=1.75, target=(0, 0, 0), mask=False, pivot_at=(0, 0, 0),
    ramps={F_BACK: ['4f8fba', '73bed3', 'a4dddb'], F_BELLY: ['a8b5b2', 'ebede9', 'ebede9'], F_FIN: ['577277', '819796', 'a8b5b2']},
    anims={'glide': [(flying_fish(0.06), (0, 0, 0, 0)), (flying_fish(0.16), (0, 0, 0, 0))]})

# --- whale: humpback, ~6 units long, chunky; head at +Y ---
W_BACK, W_BELLY = '394a50', '577277'


def whale():
    M = Mesh()
    secs = [(-3.0, 0.08, 0.14, 0.0), (-2.4, 0.16, 0.26, 0.0), (-1.6, 0.36, 0.46, 0.0), (-0.6, 0.62, 0.66, 0.0),
            (0.6, 0.74, 0.7, 0.0), (1.6, 0.66, 0.58, -0.02), (2.4, 0.46, 0.38, -0.06), (2.95, 0.22, 0.18, -0.1),
            (3.08, 0, 0, -0.12)]
    loft(M, secs, lambda s, sm: W_BELLY if sm < -0.3 else W_BACK, n=12)
    fin(M, -1.35, -0.75, 0.48, -1.35, 0.9, 0.16, W_BACK)  # small dorsal hump
    slab(M, [(0, -2.9, 0), (0.25, -3.0, 0), (1.05, -3.45, 0), (0.95, -3.62, 0), (0.25, -3.42, 0), (0, -3.5, 0),
             (-0.25, -3.42, 0), (-0.95, -3.62, 0), (-1.05, -3.45, 0), (-0.25, -3.0, 0)], 0.1, W_BACK, W_BELLY)
    return M


WHALE = whale()
ANIMALS['whale'] = dict(
    cell=(64, 32), ortho=10.5, target=(0, 0, 0.9), mask=True, pivot_at=(0, 0, 0),
    ramps={W_BACK: ['241527', '394a50', '577277'], W_BELLY: ['394a50', '577277', '577277']},
    steps=(0.55, 0.85),
    anims={
        'surface': [(WHALE, (0.06, 2, 0.4, -0.4)), (WHALE, (0.12, -3, -0.3, -0.38))],
        'fluke': [(WHALE, (0.3, -22, 1.2, -0.45)), (WHALE, (0.05, -68, 1.0, -0.9)), (WHALE, (0.05, -72, 1.0, -2.0))],
    })

def join(M, W):
    b = len(M.v)
    M.v += W.v
    M.f += [tuple(b + i for i in f) for f in W.f]
    M.m += W.m


# --- pelican: brown pelican in flight, neck folded, long bill forward; ~1.15 units nose to tail ---
P_BODY, P_TIP, P_HEAD, P_NECK, P_BILL = 'ad7757', '4d2b32', 'e7d5b3', '602c2c', 'de9e41'


def pelican(wings):
    """wings: 'up', 'down' or 'folded'."""
    M = Mesh()
    secs = [(-0.55, 0, 0, 0.0), (-0.45, 0.08, 0.05, 0.0), (-0.25, 0.17, 0.13, 0.0), (0.05, 0.2, 0.15, 0.0),
            (0.28, 0.14, 0.12, 0.03), (0.4, 0.09, 0.09, 0.07), (0.5, 0.1, 0.1, 0.1), (0.6, 0.08, 0.08, 0.1), (0.66, 0, 0, 0.1)]
    loft(M, secs, lambda s, sm: P_NECK if s == 4 else P_HEAD if s >= 5 else P_BODY, n=8)
    # long bill with pouch, angled slightly down
    bb = M.add_verts([(-0.05, 0.6, 0.11), (0.05, 0.6, 0.11), (-0.05, 0.6, 0.0), (0.05, 0.6, 0.0), (0, 1.15, 0.0)])
    for f in ((0, 2, 4), (1, 4, 3), (0, 4, 1), (2, 3, 4), (0, 1, 3, 2)):
        M.face(tuple(bb + i for i in f), P_BILL)
    W = Mesh()
    if wings == 'folded':
        strip(W, [(0.1, 0.18, -0.12, 0.05), (0.2, -0.15, -0.45, 0.08), (0.14, -0.55, -0.8, 0.1)], [P_BODY, P_TIP])
    else:
        z = (0.0, 0.12, 0.3, 0.42) if wings == 'up' else (0.0, -0.06, -0.22, -0.34)
        strip(W, [(0.12, 0.2, -0.2, z[0]), (0.55, 0.22, -0.2, z[1]), (0.95, 0.18, -0.13, z[2]), (1.28, 0.04, -0.1, z[3])],
              [P_BODY, P_BODY, P_TIP])
    mirror(W)
    join(M, W)
    return M


ANIMALS['pelican'] = dict(
    cell=(32, 32), ortho=3.5, target=(0, 0, -0.2), mask=False, pivot_at=(0, 0, 0),
    ramps={P_BODY: ['7a4841', 'ad7757', 'd7b594'], P_TIP: ['341c27', '4d2b32', '7a4841'], P_HEAD: ['d7b594', 'e7d5b3', 'ebede9'],
           P_NECK: ['4d2b32', '602c2c', '7a4841'], P_BILL: ['be772b', 'de9e41', 'e8c170']},
    anims={
        'fly': [(pelican('up'), (0, 0, 0, 0)), (pelican('down'), (0, 0, 0, 0))],
        'dive': [(pelican('folded'), (0, -60, 0.15, -0.3)), (pelican('folded'), (0, -75, 0.3, -1.05))],
    })

# --- frigatebird: soaring, long crooked narrow wings and a deep forked tail ---
G_BODY, G_POUCH = '341c27', 'a53030'


def frigatebird(flex):
    M = Mesh()
    secs = [(-0.32, 0.05, 0.04, 0.0), (-0.15, 0.1, 0.08, 0.0), (0.08, 0.11, 0.09, 0.0), (0.25, 0.07, 0.06, 0.02),
            (0.36, 0.06, 0.06, 0.03), (0.42, 0, 0, 0.03)]
    loft(M, secs, lambda s, sm: G_BODY, n=8)
    bill = [(-0.02, 0.4, 0.04), (0.02, 0.4, 0.04), (0, 0.6, 0.0)]  # long hooked bill, flat wedge
    slab(M, bill, 0.03, G_BODY)
    slab(M, [(-0.04, 0.3, -0.07), (0.04, 0.3, -0.07), (0.05, 0.18, -0.08), (-0.05, 0.18, -0.08)], 0.06, G_POUCH)
    W = Mesh()
    strip(W, [(0.07, 0.1, -0.1, 0.0), (0.45, 0.2, 0.04, 0.1 + flex), (0.6, 0.18, 0.05, 0.08 + flex), (1.25, -0.3, -0.36, flex * 0.5)],
          [G_BODY] * 3)
    # forked tail: one long streamer per side, splayed
    slab(W, [(0.0, -0.28, 0.0), (0.05, -0.28, 0.0), (0.2, -0.95, 0.0), (0.16, -0.95, 0.0)], 0.03, G_BODY)
    mirror(W)
    join(M, W)
    return M


ANIMALS['frigatebird'] = dict(
    cell=(48, 48), ortho=3.1, target=(0, 0, 0), mask=False, pivot_at=(0, 0, 0),
    ramps={G_BODY: ['241527', '341c27', '4d2b32'], G_POUCH: ['752438', 'a53030', 'cf573c']},
    anims={'soar': [(frigatebird(0.0), (0, 0, 0, 0)), (frigatebird(0.2), (0, 0, 0, 0))]})

# --- render setup: workbench, same as render_brig.py ---
sc.render.engine = 'BLENDER_WORKBENCH'
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
cam_data.clip_end = 100
cam = bpy.data.objects.new('cam', cam_data)
sc.collection.objects.link(cam)
sc.camera = cam

# The sea surface: opaque at z = 0 so everything under it is hidden; its pixels become transparent.
bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, 0))
water = bpy.context.active_object
water.data.materials.append(mat(MASK))

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


def snap(flat, lit, whole, ramps, steps=(0.42, 0.66)):
    """flat/lit: passes with the sea; whole: flat pass without it (None when there is no sea)."""
    keys = list(ramps) + [MASK]
    base = np.array([hexrgb(h) for h in keys], dtype=np.float32) / 255
    ramp = np.array([[hexrgb(h) for h in r] for r in ramps.values()] + [[hexrgb(MASK)] * 3], dtype=np.float32) / 255
    f, l = flat[..., :3], lit[..., :3]
    mid = ((f[:, :, None, :] - base[None, None]) ** 2).sum(-1).argmin(-1)
    sea = mid == len(keys) - 1
    mask = (flat[..., 3] > 0.5) & ~sea
    r = (l.sum(-1) + 1e-3) / (f.sum(-1) + 1e-3)
    lo, hi = steps
    step = np.where(r < lo, 0, np.where(r > hi, 2, 1))
    out = np.zeros_like(flat)
    out[..., :3] = ramp[mid, step]
    out[..., 3] = mask
    out[~mask] = 0
    # 1 px outside outline, except along the waterline cut: where the sea hides more of the body.
    n = np.zeros_like(mask)
    n[1:] |= mask[:-1]; n[:-1] |= mask[1:]; n[:, 1:] |= mask[:, :-1]; n[:, :-1] |= mask[:, 1:]
    ring = n & ~mask
    if whole is not None:
        ring &= ~(whole[..., 3] > 0.5)
    out[ring, :3] = OUTLINE
    out[ring, 3] = 1
    return out


FACINGS = 8
tmp = os.path.join(TMP, 'wildlife_pass.png')
manifest_path = os.path.join(OUT, 'wildlife.json')
try:
    with open(manifest_path) as fh:
        MANIFEST = json.load(fh)
except FileNotFoundError:
    MANIFEST = {}

for animal, A in ANIMALS.items():
    if ONLY and animal not in ONLY:
        continue
    cw, ch = A['cell']
    sc.render.resolution_x, sc.render.resolution_y = cw, ch
    cam_data.ortho_scale = A['ortho']
    T = Vector(A['target'])
    e = math.radians(45)
    cam.location = T + Vector((0, -math.cos(e), math.sin(e))) * 20
    cam.rotation_euler = (T - cam.location).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.view_layer.update()
    p = world_to_camera_view(sc, cam, Vector(A['pivot_at']))
    pivot = [round(p.x, 4), round(1 - p.y, 4)]
    water.hide_render = not A['mask']
    for anim, frames in A['anims'].items():
        objs = [build(f'{animal}_{anim}_{i}', M, pose(M, *ps)) for i, (M, ps) in enumerate(frames)]
        for i, o in enumerate(objs):
            for other in objs:
                other.hide_render = other is not o
            for fc in range(FACINGS):
                root.rotation_euler = (0, 0, -math.radians(360 / FACINGS * fc))  # d0 north, clockwise
                passes = []
                for light, sea in (('FLAT', True), ('STUDIO', True), ('FLAT', False)):
                    if sea is False and not A['mask']:
                        passes.append(None)
                        continue
                    water.hide_render = not (sea and A['mask'])
                    sc.display.shading.light = light
                    sc.render.filepath = tmp
                    bpy.ops.render.render(write_still=True)
                    passes.append(load(tmp))
                water.hide_render = not A['mask']
                out = snap(*passes, A['ramps'], A.get('steps', (0.42, 0.66)))
                a = out[..., 3] > 0.5
                if a[0].any() or a[-1].any() or a[:, 0].any() or a[:, -1].any():
                    print(f'WARN clipped {animal}.{anim}.d{fc}.f{i:02d}')
                save(out, os.path.join(OUT, f'wildlife.{animal}.{anim}.d{fc}.f{i:02d}.png'))
        for o in objs:
            o.hide_render = True
        MANIFEST[f'wildlife.{animal}.{anim}'] = {'cell': [cw, ch], 'facings': FACINGS, 'frames': len(frames), 'pivot': pivot}
        print(f'PIVOT wildlife.{animal}.{anim} {pivot}')

with open(manifest_path, 'w') as fh:
    json.dump(dict(sorted(MANIFEST.items())), fh, indent=2)
    fh.write('\n')
print('DONE')
