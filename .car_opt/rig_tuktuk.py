"""Export tuk-tuk with 3 wheel pivots + packed colour map."""
import bpy
import os
import sys
from mathutils import Vector, Matrix

sys.path.insert(0, '/Users/rokaya/Desktop/Saudi-tafheet/.car_opt')
from optimize_car import clear_scene, fix_materials_for_web, normalize_vehicle, export_glb, total_stats
from rig_and_export import world_center, join_objects

BLEND = '/Users/rokaya/Desktop/Saudi-tafheet/.car_opt/src/tuktuk/autorickshaw.blend'
TEX = '/Users/rokaya/Desktop/Saudi-tafheet/.car_opt/src/tuktuk/Material.001-Colour_copy_2.png'
OUT = '/Users/rokaya/Desktop/Saudi-tafheet/public/cars/tuktuk.glb'


def rebind_textures():
    if os.path.isfile(TEX):
        img = bpy.data.images.load(TEX)
        img.pack()
        for mat in bpy.data.materials:
            if not mat.use_nodes:
                continue
            for n in mat.node_tree.nodes:
                if n.type == 'TEX_IMAGE':
                    n.image = img


clear_scene()
bpy.ops.wm.open_mainfile(filepath=BLEND)
# open_mainfile replaces scene — don't clear after
print('loaded', total_stats())

# Pack / rebind colour
rebind_textures()
fix_materials_for_web()

# Unparent + apply
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
bpy.ops.object.select_all(action='DESELECT')
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
try:
    bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
except Exception:
    pass
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

# Combined wheels live on Cylinder.001
wheels_src = bpy.data.objects.get('Cylinder.001')
if not wheels_src:
    raise SystemExit('no Cylinder.001')

bpy.ops.object.select_all(action='DESELECT')
wheels_src.select_set(True)
bpy.context.view_layer.objects.active = wheels_src
before = set(bpy.data.objects)
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.mesh.separate(type='LOOSE')
bpy.ops.object.mode_set(mode='OBJECT')
pieces = [o for o in bpy.data.objects if o.type == 'MESH' and (o in before or o.name.startswith('Cylinder'))]
# Keep only the separated wheel discs (~0.5 diameter)
wheel_pieces = []
for o in list(bpy.data.objects):
    if o.type != 'MESH':
        continue
    c, s = world_center(o)
    dims = sorted([s.x, s.y, s.z])
    # Exact tuk tyre discs from Cylinder.001: ~0.17 thin, ~0.54 diameter
    if 0.12 < dims[0] < 0.22 and 0.48 < dims[1] < 0.60 and 0.48 < dims[2] < 0.60:
        wheel_pieces.append(o)
        print('wheel piece', o.name, [round(v, 3) for v in s], [round(v, 3) for v in c])

if len(wheel_pieces) != 3:
    raise SystemExit(f'expected 3 tuk wheels, got {len(wheel_pieces)}')

# Sort: front = min Y, then left/right by X for the two rears
wheel_pieces = sorted(wheel_pieces, key=lambda o: world_center(o)[0].y)
front = wheel_pieces[0]
rears = sorted(wheel_pieces[1:], key=lambda o: world_center(o)[0].x)
left, right = rears[0], rears[1]
print('front', front.name, 'L', left.name, 'R', right.name)

# Remove false tyre planes from body set — they stay in body
named = {
    'FL': front,
    'RL': left,
    'RR': right,
}

for key, mesh in named.items():
    c, _ = world_center(mesh)
    steer = bpy.data.objects.new(f'{key}_1', None)
    steer.empty_display_size = 0.15
    bpy.context.scene.collection.objects.link(steer)
    steer.location = c
    bpy.ops.object.select_all(action='DESELECT')
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = mesh
    bpy.context.scene.cursor.location = c
    bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
    mesh.location = c
    mesh.parent = steer
    mesh.matrix_parent_inverse = steer.matrix_world.inverted()
    mesh.name = f'{key}_2'

# Join body (everything else mesh)
body = [
    o for o in bpy.data.objects
    if o.type == 'MESH' and o.name not in ('FL_2', 'RL_2', 'RR_2')
]
join_objects(body, 'Car')

# Detach for normalize
pairs = []
for key in ('FL', 'RL', 'RR'):
    steer = bpy.data.objects.get(f'{key}_1')
    mesh = bpy.data.objects.get(f'{key}_2')
    if mesh and steer:
        mw = mesh.matrix_world.copy()
        mesh.parent = None
        mesh.matrix_world = mw
        bpy.data.objects.remove(steer, do_unlink=True)
        pairs.append((key, mesh))

targets = [o for o in bpy.data.objects if o.type == 'MESH']
bpy.ops.object.select_all(action='DESELECT')
for o in targets:
    o.select_set(True)
bpy.context.view_layer.objects.active = targets[0]
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
normalize_vehicle(target_length=3.2)  # tuk is shorter

for key, mesh in pairs:
    mesh = bpy.data.objects.get(f'{key}_2') or mesh
    c, _ = world_center(mesh)
    steer = bpy.data.objects.new(f'{key}_1', None)
    steer.empty_display_size = 0.15
    bpy.context.scene.collection.objects.link(steer)
    steer.location = c
    bpy.ops.object.select_all(action='DESELECT')
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = mesh
    bpy.context.scene.cursor.location = c
    bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
    mesh.location = c
    mesh.parent = steer
    mesh.matrix_parent_inverse = steer.matrix_world.inverted()
    mesh.name = f'{key}_2'

# Alias front as FR too (empty steer + duplicate mesh instance via linked data)
fl = bpy.data.objects['FL_1']
fl2 = bpy.data.objects['FL_2']
fr = bpy.data.objects.new('FR_1', None)
fr.empty_display_size = 0.15
bpy.context.scene.collection.objects.link(fr)
fr.location = fl.location.copy()
# linked duplicate of front wheel for roll (same transform) — hide scale 0 alternative:
# Use empty FR_2 that won't show; PlayerCar will be updated to allow 3 rolls.
# Create FR_2 as a real linked copy offset 0 — would zfight. Skip FR_2 mesh.

fix_materials_for_web()
print('FINAL', total_stats())
for k in ('FL', 'FR', 'RL', 'RR'):
    print(k, bpy.data.objects.get(f'{k}_1'), bpy.data.objects.get(f'{k}_2'))
export_glb(OUT)
print('done', os.path.getsize(OUT))
