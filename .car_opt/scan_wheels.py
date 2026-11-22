import bpy
import os
import glob

bpy.ops.wm.read_factory_settings(use_empty=True)

def list_mesh_names(path, kind):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    if kind == 'gltf':
        bpy.ops.import_scene.gltf(filepath=path)
    elif kind == 'obj':
        bpy.ops.wm.obj_import(filepath=path)
    elif kind == 'fbx':
        bpy.ops.import_scene.fbx(filepath=path)
    names = []
    for o in bpy.data.objects:
        if o.type != 'MESH':
            continue
        n = o.name.lower()
        wheelish = any(k in n for k in ('wheel', 'tire', 'tyre', 'rim', 'disc', 'cerchio', 'ruota'))
        names.append((o.name, len(o.data.vertices), wheelish))
    print('FILE', path)
    print('MESH_COUNT', len(names))
    print('WHEELISH', [n for n, _, w in names if w][:50])
    print('ALL', [n for n, _, _ in names][:80])


roots = [
    '/Users/rokaya/Downloads/2015-mclaren-650s-gt3',
    '/Users/rokaya/Downloads/bmw-m3-gtr-gt2',
    '/Users/rokaya/Downloads/2002-nissan-skyline-gt-r-v-spec-ii-nur-r34',
    '/Users/rokaya/Downloads/2022-lamborghini-countach-lpi-800-4',
    '/Users/rokaya/Downloads/low-poly-autorickshaw-aka-tuktuk',
    '/Users/rokaya/Downloads/2002-mazda-rx-7-spirit-r',
    '/Users/rokaya/Downloads/nissan-r34-brians-fast-furious-wwwvecarzcom',
]

for root in roots:
    print('====', root, 'exists', os.path.isdir(root))
    if not os.path.isdir(root):
        continue
    files = []
    for pat in ('**/*.glb', '**/*.gltf', '**/*.fbx', '**/*.obj'):
        files.extend(glob.glob(os.path.join(root, pat), recursive=True))
    files = sorted(files)[:3]
    for f in files:
        ext = f.lower().rsplit('.', 1)[-1]
        kind = 'obj' if ext == 'obj' else ('fbx' if ext == 'fbx' else 'gltf')
        try:
            list_mesh_names(f, kind)
        except Exception as e:
            print('ERR', f, e)
