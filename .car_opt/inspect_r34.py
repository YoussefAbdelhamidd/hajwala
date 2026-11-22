import bpy
from mathutils import Vector

def wb(o):
    mins = Vector((1e9,) * 3)
    maxs = Vector((-1e9,) * 3)
    for c in o.bound_box:
        w = o.matrix_world @ Vector(c)
        mins = Vector(tuple(min(a, b) for a, b in zip(mins, w)))
        maxs = Vector(tuple(max(a, b) for a, b in zip(maxs, w)))
    return mins, maxs

def dump(label, path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    print('====', label)
    for o in bpy.data.objects:
        if o.type != 'MESH':
            continue
        mins, maxs = wb(o)
        size = maxs - mins
        mats = [s.material.name if s.material else '-' for s in o.material_slots]
        print(f' MESH {o.name} v={len(o.data.vertices)} size=({size.x:.2f},{size.y:.2f},{size.z:.2f}) nmat={len(mats)}')
        for m in mats[:25]:
            print('   mat', m[:70])
        if len(mats) > 25:
            print('   ...', len(mats) - 25, 'more')
    keys = ('paint', 'colour', 'colored', 'coloured', 'body', 'base', 'carbon', 'exterior')
    hit = [m.name for m in bpy.data.materials if any(k in m.name.lower() for k in keys)]
    print(' bodyish materials present:', hit[:30])

dump('brian_out', '/Users/rokaya/Desktop/Saudi-tafheet/public/cars/r34_brian.glb')
dump('vspec_out', '/Users/rokaya/Desktop/Saudi-tafheet/public/cars/r34_vspec.glb')
dump('brian_src', '/Users/rokaya/Downloads/nissan-r34-brians-fast-furious-wwwvecarzcom/source/brians_r34_from_2_fast_2_furious.glb')
