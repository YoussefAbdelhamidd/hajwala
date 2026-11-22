import bpy
from mathutils import Vector
import sys
sys.path.insert(0, '/Users/rokaya/Desktop/Saudi-tafheet/.car_opt')
from rig_and_export import wheel_spin_center, world_center

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath='/Users/rokaya/Desktop/Saudi-tafheet/public/cars/rx7.glb')

for name in ('FL_2', 'FR_2', 'RL_2', 'RR_2'):
    o = bpy.data.objects.get(name)
    if not o:
        print('missing', name)
        continue
    # local mesh bounds (object space)
    xs = [v.co.x for v in o.data.vertices]
    ys = [v.co.y for v in o.data.vertices]
    zs = [v.co.z for v in o.data.vertices]
    local_size = (max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs))
    local_mid = ((max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2, (max(zs) + min(zs)) / 2)
    bc, _ = world_center(o)
    sc = wheel_spin_center(o)
    print(name)
    print('  local_size', tuple(round(v, 4) for v in local_size), 'local_mid', tuple(round(v, 4) for v in local_mid))
    print('  world_bbox_c', tuple(round(v, 4) for v in bc), 'tyre_c', tuple(round(v, 4) for v in sc))
    print('  obj.loc', tuple(round(v, 4) for v in o.location), 'parent', o.parent.name if o.parent else None)
