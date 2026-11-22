import bpy
from mathutils import Vector

def wb(o):
    mins = Vector((1e9,) * 3)
    maxs = Vector((-1e9,) * 3)
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        mins = Vector(tuple(min(a, b) for a, b in zip(mins, w)))
        maxs = Vector(tuple(max(a, b) for a, b in zip(maxs, w)))
    return (mins + maxs) * 0.5, maxs - mins

SRC = '/Users/rokaya/Downloads/nissan-r34-brians-fast-furious-wwwvecarzcom/source/brians_r34_from_2_fast_2_furious.glb'
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=SRC)

# Unparent apply like pipeline
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
bpy.ops.object.select_all(action='DESELECT')
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

paint = []
for o in bpy.data.objects:
    if o.type != 'MESH':
        continue
    mats = ' '.join([(s.material.name if s.material else '') for s in o.material_slots])
    low = mats.lower() + ' ' + o.name.lower()
    if 'paint' in low or 'coloured' in low or 'colored' in low or 'base_material' in low.replace(' ', ''):
        c, s = wb(o)
        paint.append((o.name, len(o.data.vertices), mats[:80], tuple(round(v, 3) for v in s), tuple(round(v, 3) for v in c)))

print('paint/body meshes', len(paint))
paint.sort(key=lambda t: -t[1])
for row in paint[:40]:
    print(row)

# Also check if paint mats match wheelish
from rig_and_export import is_wheel_candidate
import sys
sys.path.insert(0, '/Users/rokaya/Desktop/Saudi-tafheet/.car_opt')
# reimport after path
import importlib
import optimize_car  # noqa
import rig_and_export as R
importlib.reload(R)

hits = [o.name for o in bpy.data.objects if o.type == 'MESH' and R.is_wheel_candidate(o)]
print('wheel candidates', len(hits))
paint_as_wheel = []
for o in bpy.data.objects:
    if o.type != 'MESH':
        continue
    mats = ' '.join([(s.material.name if s.material else '') for s in o.material_slots]).lower()
    if 'paint' in mats and R.is_wheel_candidate(o):
        paint_as_wheel.append(o.name)
print('paint wrongly wheel', paint_as_wheel[:20], 'count', len(paint_as_wheel))

# Interior stripped?
from optimize_car import is_interior_object
interior_paint = []
for o in bpy.data.objects:
    if o.type != 'MESH':
        continue
    mats = ' '.join([(s.material.name if s.material else '') for s in o.material_slots]).lower()
    if 'paint' in mats and is_interior_object(o):
        interior_paint.append(o.name)
print('paint as interior', interior_paint[:20], 'count', len(interior_paint))
