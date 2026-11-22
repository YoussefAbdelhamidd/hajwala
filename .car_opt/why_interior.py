import bpy, sys
sys.path.insert(0, '/Users/rokaya/Desktop/Saudi-tafheet/.car_opt')
from optimize_car import is_interior_object

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(
    filepath='/Users/rokaya/Downloads/nissan-r34-brians-fast-furious-wwwvecarzcom/source/brians_r34_from_2_fast_2_furious.glb'
)
o = bpy.data.objects.get('Object_4168')
mats = ' '.join([(s.material.name if s.material else '') for s in o.material_slots]).lower()
name = o.name.lower()
print('mats', repr(mats))
print('name', repr(name))
print('slots', len(o.material_slots))
for s in o.material_slots:
    print(' slot', s.material.name if s.material else None)
keys = (
    'int_', 'interior', 'cockpit', 'cabin', 'sedile', 'seat', 'display',
    'leather', 'fabric', 'cintura', 'belt', 'steering_wheel', 'steer',
    'dashboard', 'dash', 'pedal', 'gear', 'impugnatura', 'velluto',
    'pistoni', 'door_mech', 'gauge',
)
for k in keys:
    if k in mats or k in name:
        print('OLD MATCH', repr(k))
print('new is_interior', is_interior_object(o))
