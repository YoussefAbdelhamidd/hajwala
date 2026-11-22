import bpy
import os
from mathutils import Vector

SOURCES = [
    ('rx7', '/Users/rokaya/Downloads/2002-mazda-rx-7-spirit-r/source/2002 Mazda RX-7 Spirit-R.glb'),
    ('bmw', '/Users/rokaya/Downloads/bmw-m3-gtr-gt2/source/bmw_m3_gtr.glb'),
    ('mclaren', '/Users/rokaya/Downloads/2015-mclaren-650s-gt3/source/mclaren_650s_gt3.glb'),
    ('countach', '/Users/rokaya/Downloads/2022-lamborghini-countach-lpi-800-4/source/2022_lamborghini_countach_lpi_800-4.glb'),
    ('r34v', '/Users/rokaya/Downloads/2002-nissan-skyline-gt-r-v-spec-ii-nur-r34/source'),
    ('brian', '/Users/rokaya/Downloads/nissan-r34-brians-fast-furious-wwwvecarzcom/source/brians_r34_from_2_fast_2_furious.glb'),
    ('tuktuk', '/Users/rokaya/Downloads/low-poly-autorickshaw-aka-tuktuk'),
]

OUT = '/Users/rokaya/Desktop/Saudi-tafheet/.car_opt/wheel_scan.txt'


def world_bounds(obj):
    mins = Vector((1e9, 1e9, 1e9))
    maxs = Vector((-1e9, -1e9, -1e9))
    for c in obj.bound_box:
        w = obj.matrix_world @ Vector(c)
        mins = Vector((min(mins.x, w.x), min(mins.y, w.y), min(mins.z, w.z)))
        maxs = Vector((max(maxs.x, w.x), max(maxs.y, w.y), max(maxs.z, w.z)))
    return mins, maxs


def is_wheelish(obj):
    name = obj.name.lower()
    mats = ' '.join([(s.material.name if s.material else '') for s in obj.material_slots]).lower()
    blob = name + ' ' + mats
    keys = ('wheel', 'tire', 'tyre', 'rim', 'disc', 'rubber', 'ruota', 'cerchio', 'brake')
    return any(k in blob for k in keys)


def resolve(path):
    if os.path.isfile(path):
        return path
    if not os.path.isdir(path):
        return None
    for root, _, files in os.walk(path):
        for f in files:
            if f.lower().endswith(('.glb', '.gltf', '.fbx', '.obj')):
                return os.path.join(root, f)
    return None


lines = []
for label, path in SOURCES:
    src = resolve(path)
    lines.append(f'\n==== {label} {src}')
    if not src:
        lines.append('MISSING')
        continue
    bpy.ops.wm.read_factory_settings(use_empty=True)
    ext = src.lower().rsplit('.', 1)[-1]
    if ext in ('glb', 'gltf'):
        bpy.ops.import_scene.gltf(filepath=src)
    elif ext == 'obj':
        bpy.ops.wm.obj_import(filepath=src)
    else:
        bpy.ops.import_scene.fbx(filepath=src)

    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    lines.append(f'meshes={len(meshes)} mats={len(bpy.data.materials)}')
    wheelish = [o for o in meshes if is_wheelish(o)]
    lines.append(f'wheelish_count={len(wheelish)}')
    for o in wheelish[:30]:
        mins, maxs = world_bounds(o)
        size = maxs - mins
        center = (mins + maxs) * 0.5
        mats = ','.join([(s.material.name if s.material else '-') for s in o.material_slots][:3])
        lines.append(
            f'  W {o.name} v={len(o.data.vertices)} size=({size.x:.2f},{size.y:.2f},{size.z:.2f}) '
            f'c=({center.x:.2f},{center.y:.2f},{center.z:.2f}) mats={mats}'
        )

    # Also list lowest 12 meshes by center z/y (ground candidates)
    scored = []
    for o in meshes:
        mins, maxs = world_bounds(o)
        size = maxs - mins
        center = (mins + maxs) * 0.5
        scored.append((mins.z, mins.y, o, size, center))
    scored.sort(key=lambda t: (t[0], t[1]))
    lines.append('lowest_meshes:')
    for mins_z, mins_y, o, size, center in scored[:15]:
        lines.append(
            f'  L {o.name} v={len(o.data.vertices)} size=({size.x:.2f},{size.y:.2f},{size.z:.2f}) '
            f'c=({center.x:.2f},{center.y:.2f},{center.z:.2f})'
        )

with open(OUT, 'w') as f:
    f.write('\n'.join(lines))
print('WROTE', OUT)
print('\n'.join(lines[:200]))
