"""Exports each ship class's Blender model (art/sources/blender/{class}-45.blend, built by render_brig.py and
render_ships.py) as one binary glTF for the 3D renderer: art/game/models/ship.{class}.glb.

The model holds every sail state at once, its parts named `{state}_{part}` (full_beam_s_fore_course,
furled_main_course_furl); the hull, masts and fittings have no state prefix. The game shows one state's parts
at a time, as the 2D renderer picks a sprite row.

Run from the repo root:
  /Applications/Blender.app/Contents/MacOS/Blender -b --python tools/art/export_ships_glb.py -- "$PWD" [class ...]
With no class, exports every class that has a .blend.
"""
import bpy, os, sys

ARGS = sys.argv[sys.argv.index('--') + 1:]
REPO = ARGS[0]
SRC = os.path.join(REPO, 'art/sources/blender')
OUT = os.path.join(REPO, 'art/game/models')
os.makedirs(OUT, exist_ok=True)
classes = ARGS[1:] or sorted(f[:-len('-45.blend')] for f in os.listdir(SRC) if f.endswith('-45.blend'))

for cls in classes:
    bpy.ops.wm.open_mainfile(filepath=os.path.join(SRC, f'{cls}-45.blend'))
    # The render scripts hide other states' parts per frame; every part is exported, and shown by the game.
    for o in bpy.data.objects:
        o.hide_render = False
        o.hide_set(False)
    # Each flat material's colour as its base colour (the render scripts set only the viewport colour).
    for m in bpy.data.materials:
        m.use_nodes = True
        bsdf = m.node_tree.nodes.get('Principled BSDF')
        if bsdf:
            bsdf.inputs['Base Color'].default_value = m.diffuse_color
            bsdf.inputs['Roughness'].default_value = 0.8
    for o in [o for o in bpy.data.objects if o.type == 'CAMERA']:
        bpy.data.objects.remove(o)
    path = os.path.join(OUT, f'ship.{cls}.glb')
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', export_apply=True, export_yup=True)
    print('EXPORTED', cls, os.path.getsize(path))
print('DONE')
