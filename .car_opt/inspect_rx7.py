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

for label, path in [
    ('out', '/Users/rokaya/Desktop/Saudi-tafheet/public/cars/rx7.glb'),
    ('src', '/Users/rokaya/Downloads/2002-mazda-rx-7-spirit-r/source/2002 Mazda RX-7 Spirit-R.glb'),
]:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    print('====', label)
    for o in sorted(bpy.data.objects, key=lambda x: x.name):
        if o.type != 'MESH':
            print(' NODE', o.name, o.type, 'loc', tuple(round(v, 3) for v in o.location))
            continue
        c, s = wb(o)
        mats = [m.material.name if m.material else '-' for m in o.material_slots]
        print(f' MESH {o.name} v={len(o.data.vertices)} c={tuple(round(v,3) for v in c)} s={tuple(round(v,3) for v in s)} mats={mats[:4]}')
