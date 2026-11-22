import bpy
import sys
from collections import Counter
from mathutils import Vector

sys.path.insert(0, '/Users/rokaya/Desktop/Saudi-tafheet/.car_opt')
from optimize_car import is_interior_object
from rig_and_export import is_wheel_candidate


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
meshes = [o for o in bpy.data.objects if o.type == 'MESH']
bpy.ops.object.select_all(action='DESELECT')
for o in meshes:
    o.select_set(True)
bpy.context.view_layer.objects.active = meshes[0]
bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

rows = []
for o in bpy.data.objects:
    if o.type != 'MESH':
        continue
    mats = '|'.join([(s.material.name if s.material else '-') for s in o.material_slots])
    c, s = wb(o)
    rows.append((len(o.data.vertices), o.name, mats[:90], tuple(round(v, 3) for v in s)))
rows.sort(reverse=True)
print('TOP MESHES')
for r in rows[:30]:
    print(r)

mc = Counter()
for o in bpy.data.objects:
    if o.type != 'MESH':
        continue
    for s in o.material_slots:
        if s.material:
            mc[s.material.name] += len(o.data.vertices)
print('TOP MATS')
for n, v in mc.most_common(25):
    print(v, n)

pw = []
pi = []
for o in bpy.data.objects:
    if o.type != 'MESH':
        continue
    mats = ' '.join([(s.material.name if s.material else '') for s in o.material_slots]).lower()
    if 'paint' not in mats:
        continue
    if is_wheel_candidate(o):
        pw.append((o.name, len(o.data.vertices)))
    if is_interior_object(o):
        pi.append((o.name, len(o.data.vertices)))
print('paint wheel', len(pw), pw[:15])
print('paint interior', len(pi), pi[:15])
print('wheel candidates', sum(1 for o in bpy.data.objects if o.type == 'MESH' and is_wheel_candidate(o)))
