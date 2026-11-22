"""
Re-export web cars with FL_1/FR_1 steer pivots and FL_2/FR_2/RL_2/RR_2 roll meshes.
Keeps body joined; wheels stay separate so Three.js can spin/steer them.
"""
import bpy
import os
import sys
from mathutils import Vector, Matrix

sys.path.insert(0, '/Users/rokaya/Desktop/Saudi-tafheet/.car_opt')
from optimize_car import (  # noqa: E402
    clear_scene, fix_materials_for_web, resize_images, normalize_vehicle,
    export_glb, decimate, mesh_tris, total_stats, is_interior_object,
)


OUT_DIR = '/Users/rokaya/Desktop/Saudi-tafheet/public/cars'

JOBS = [
    {
        'id': 'rx7',
        'src': '/Users/rokaya/Downloads/2002-mazda-rx-7-spirit-r/source/2002 Mazda RX-7 Spirit-R.glb',
        'out': f'{OUT_DIR}/rx7.glb',
        'target_tris': 45000,
        'max_color': 1024,
    },
    {
        'id': 'bmw_m3_gtr',
        'src': '/Users/rokaya/Downloads/bmw-m3-gtr-gt2/source/bmw_m3_gtr.glb',
        'out': f'{OUT_DIR}/bmw_m3_gtr.glb',
        'target_tris': 55000,
        'max_color': 1024,
    },
    {
        'id': 'mclaren',
        'src': '/Users/rokaya/Downloads/2015-mclaren-650s-gt3/source/mclaren_650s_gt3.glb',
        'out': f'{OUT_DIR}/mclaren_650s_gt3.glb',
        'target_tris': 55000,
        'max_color': 1024,
    },
    {
        'id': 'countach',
        'src': '/Users/rokaya/Downloads/2022-lamborghini-countach-lpi-800-4/source/2022_lamborghini_countach_lpi_800-4.glb',
        'out': f'{OUT_DIR}/countach.glb',
        'target_tris': 50000,
        'max_color': 768,
        'gentle': True,
    },
    {
        'id': 'r34_vspec',
        'src': '/Users/rokaya/Downloads/2002-nissan-skyline-gt-r-v-spec-ii-nur-r34/source/2002 Nissan Skyline GT-R V-Spec II Nur.glb',
        'out': f'{OUT_DIR}/r34_vspec.glb',
        'target_tris': 45000,
        'max_color': 768,
        'gentle': True,
    },
    {
        'id': 'r34_brian',
        'src': '/Users/rokaya/Downloads/nissan-r34-brians-fast-furious-wwwvecarzcom/source/brians_r34_from_2_fast_2_furious.glb',
        'out': f'{OUT_DIR}/r34_brian.glb',
        'target_tris': 55000,
        'max_color': 1024,
        'gentle': True,
    },
    {
        'id': 'tuktuk',
        'src': '/Users/rokaya/Desktop/Saudi-tafheet/.car_opt/src/tuktuk/auto Rickshaw.obj',
        'out': f'{OUT_DIR}/tuktuk.glb',
        'target_tris': 25000,
        'max_color': 1024,
        'import_type': 'obj',
    },
]


def world_center(obj):
    mins = Vector((1e9, 1e9, 1e9))
    maxs = Vector((-1e9, -1e9, -1e9))
    for c in obj.bound_box:
        w = obj.matrix_world @ Vector(c)
        mins = Vector((min(mins.x, w.x), min(mins.y, w.y), min(mins.z, w.z)))
        maxs = Vector((max(maxs.x, w.x), max(maxs.y, w.y), max(maxs.z, w.z)))
    return (mins + maxs) * 0.5, (maxs - mins)


def world_bounds(obj):
    mins = Vector((1e9, 1e9, 1e9))
    maxs = Vector((-1e9, -1e9, -1e9))
    for c in obj.bound_box:
        w = obj.matrix_world @ Vector(c)
        mins = Vector((min(mins.x, w.x), min(mins.y, w.y), min(mins.z, w.z)))
        maxs = Vector((max(maxs.x, w.x), max(maxs.y, w.y), max(maxs.z, w.z)))
    return mins, maxs


def mat_blob(obj):
    return ' '.join([(s.material.name if s.material else '') for s in obj.material_slots]).lower()


def is_wheel_candidate(obj):
    if obj.type != 'MESH':
        return False
    name = obj.name.lower()
    mats = mat_blob(obj)
    blob = name + ' ' + mats
    if 'steering' in blob or 'steer_wheel' in blob:
        return False
    if 'rubber_trim' in mats:
        return False
    # Strong hits: tyre / rim / wheel materials (not generic rubber)
    strong = ('tyre', 'tire', 'rim', 'wheel', '3dwheel', 'rotor', 'caliper', 'mm_wheel')
    if not any(k in blob for k in strong):
        return False
    if 'caliper' in blob or 'brake' in name:
        # RX7 packs wheel+brake; skip pure brake-light badges
        if 'light' in mats and not any(k in mats for k in ('wheel', 'tyre', 'tire', 'rim', 'mm_wheel')):
            return False
        return True
    return True


def unparent_apply_all():
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    if not meshes:
        return
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    try:
        bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    except Exception:
        pass
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def separate_loose(obj):
    """Split combined multi-wheel meshes into islands."""
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.separate(type='LOOSE')
    bpy.ops.object.mode_set(mode='OBJECT')


def join_objects(objs, name):
    objs = [o for o in objs if o and o.name in bpy.data.objects]
    if not objs:
        return None
    if len(objs) == 1:
        objs[0].name = name
        return objs[0]
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    joined = bpy.context.view_layer.objects.active
    joined.name = name
    return joined


def cluster_into_four(objs):
    """Assign meshes to FL/FR/RL/RR by XY quadrant relative to overall center."""
    if not objs:
        return {}
    centers = []
    for o in objs:
        c, _ = world_center(o)
        centers.append(c)
    mid = sum(centers, Vector((0, 0, 0))) / len(centers)
    # Determine which horizontal axes are length/width (largest span)
    xs = [c.x for c in centers]
    ys = [c.y for c in centers]
    use_y_as_length = (max(ys) - min(ys)) >= (max(xs) - min(xs))
    buckets = {'FL': [], 'FR': [], 'RL': [], 'RR': []}
    for o, c in zip(objs, centers):
        if use_y_as_length:
            # +Y forward or -Y forward — pick by mean of |y|
            left = c.x < mid.x
            front = c.y < mid.y  # RX7: front has more negative Y
        else:
            left = c.y < mid.y
            front = c.x < mid.x
        # Re-evaluate front using extremes: the two with min length-axis are front
        side = 'L' if left else 'R'
        # We'll fix front/rear with a second pass
        buckets['F' + side if front else 'R' + side].append(o)

    # If any bucket empty, fall back to sorting by position
    if any(len(buckets[k]) == 0 for k in buckets):
        scored = []
        for o in objs:
            c, _ = world_center(o)
            scored.append((c, o))
        if use_y_as_length:
            scored.sort(key=lambda t: (t[0].y, t[0].x))
            # front = smaller y
            scored.sort(key=lambda t: t[0].y)
            front_two = sorted(scored[: max(1, len(scored) // 2)], key=lambda t: t[0].x)
            rear_two = sorted(scored[len(scored) // 2 :], key=lambda t: t[0].x)
        else:
            scored.sort(key=lambda t: t[0].x)
            front_two = sorted(scored[: max(1, len(scored) // 2)], key=lambda t: t[0].y)
            rear_two = sorted(scored[len(scored) // 2 :], key=lambda t: t[0].y)
        buckets = {
            'FL': [front_two[0][1]] if front_two else [],
            'FR': [front_two[-1][1]] if len(front_two) > 1 else [],
            'RL': [rear_two[0][1]] if rear_two else [],
            'RR': [rear_two[-1][1]] if len(rear_two) > 1 else [],
        }
        # dump leftovers into nearest
        assigned = {id(o) for group in buckets.values() for o in group}
        for c, o in scored:
            if id(o) in assigned:
                continue
            # nearest bucket center
            best = None
            best_d = 1e9
            for key, group in buckets.items():
                if not group:
                    continue
                gc, _ = world_center(group[0])
                d = (c - gc).length
                if d < best_d:
                    best_d = d
                    best = key
            if best:
                buckets[best].append(o)
    return buckets


def wheel_spin_center(obj):
    """Pivot on the tyre/rim disc — ignore caliper/misc so spin isn't eccentric."""
    me = obj.data
    mw = obj.matrix_world
    slot_names = [(s.material.name.lower() if s.material else '') for s in obj.material_slots]
    prefer = {
        i for i, n in enumerate(slot_names)
        if any(k in n for k in ('tyre', 'tire', 'mm_wheel', 'rim', 'wheel'))
        and not any(k in n for k in ('rotor', 'caliper', 'misc', 'brake'))
    }
    # If names are too vague (just "wheel"), still ok; if empty, fall back to all verts.
    tyre_ids = set()
    if prefer and me.polygons:
        for poly in me.polygons:
            if poly.material_index in prefer:
                tyre_ids.update(poly.vertices)
    coords = []
    all_coords = []
    for i, v in enumerate(me.vertices):
        w = mw @ v.co
        all_coords.append(w)
        if not prefer or i in tyre_ids:
            coords.append(w)
    use = coords if len(coords) >= 12 else all_coords
    if not use:
        c, _ = world_center(obj)
        return c
    acc = Vector((0.0, 0.0, 0.0))
    for w in use:
        acc += w
    center = acc / len(use)
    # Keep axle position on the thin bbox axis of the full mesh (stable),
    # but use tyre mean on the disc plane so calipers don't pull the pivot.
    bc, size = world_center(obj)
    dims = [(size.x, 0), (size.y, 1), (size.z, 2)]
    dims.sort()  # thinnest first = axle axis
    axle_i = dims[0][1]
    center[axle_i] = bc[axle_i]
    return center


def set_mesh_origin(mesh, world_co):
    bpy.ops.object.select_all(action='DESELECT')
    mesh.select_set(True)
    bpy.context.view_layer.objects.active = mesh
    bpy.context.scene.cursor.location = world_co
    bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
    mesh.location = world_co


def make_wheel_rig(buckets):
    """Create FL_1/FL_2 etc. Empties at centers; mesh children named *_2."""
    labels = [('FL', 'FL'), ('FR', 'FR'), ('RL', 'RL'), ('RR', 'RR')]
    made = {}
    for key, _ in labels:
        parts = buckets.get(key) or []
        if not parts:
            print('MISSING wheel corner', key)
            continue
        mesh = join_objects(parts, f'{key}_2_MESH')
        if not mesh:
            continue
        c = wheel_spin_center(mesh)
        _, size = world_center(mesh)
        # Steer empty
        steer = bpy.data.objects.new(f'{key}_1', None)
        steer.empty_display_size = 0.2
        bpy.context.scene.collection.objects.link(steer)
        steer.location = c
        set_mesh_origin(mesh, c)
        # Parent mesh under steer, keep world
        mesh.parent = steer
        mesh.matrix_parent_inverse = steer.matrix_world.inverted()
        mesh.name = f'{key}_2'
        made[key] = (steer, mesh)
        print(f'rigged {key} at {tuple(round(v, 3) for v in c)} size={tuple(round(v, 3) for v in size)}')
    return made


def gather_wheel_meshes():
    """Collect wheel pieces; separate combined tyre/rim objects into loose parts first."""
    candidates = [o for o in bpy.data.objects if is_wheel_candidate(o)]
    print('wheel candidates', len(candidates), [(o.name, mat_blob(o)[:40]) for o in candidates][:20])
    expanded = []
    for o in list(candidates):
        if o.name not in bpy.data.objects:
            continue
        _, size = world_center(o)
        span = sorted([size.x, size.y, size.z], reverse=True)
        # combined 4-wheel mesh: long + wide
        if span[0] > 2.5 and span[1] > 1.5 and len(o.data.vertices) > 200:
            print('separating loose', o.name, [round(s, 2) for s in span])
            before = set(bpy.data.objects)
            separate_loose(o)
            after = [x for x in bpy.data.objects if x not in before and x.type == 'MESH']
            pieces = [p for p in ([o] + after) if p.name in bpy.data.objects]
            for p in pieces:
                _, ps = world_center(p)
                # Drop dust / micro islands; keep roughly wheel-sized discs
                if len(p.data.vertices) < 20:
                    bpy.data.objects.remove(p, do_unlink=True)
                    continue
                if max(ps.x, ps.y, ps.z) > 2.2:
                    # still body-sized — skip (failed split)
                    print('  drop oversized piece', p.name, [round(v, 2) for v in ps])
                    continue
                expanded.append(p)
        else:
            # Single-corner wheel assemblies (RX7) or forza fragments
            expanded.append(o)
    uniq = []
    seen = set()
    for o in expanded:
        if o.name in seen or o.name not in bpy.data.objects:
            continue
        seen.add(o.name)
        uniq.append(o)
    # If we somehow got hundreds of forza shards, that's fine; if we got body junk, filter by size
    if len(uniq) > 20:
        filtered = []
        for o in uniq:
            _, ps = world_center(o)
            # corner wheel or fragment: not a full-chassis slab
            if max(ps.x, ps.y) > 2.0 and min(ps.x, ps.y) > 1.2:
                continue
            filtered.append(o)
        print('filtered fragments', len(uniq), '->', len(filtered))
        uniq = filtered or uniq
    return uniq


def soft_decimate_body(target_tris, gentle=False):
    meshes = [o for o in bpy.data.objects if o.type == 'MESH' and not o.name.endswith('_2')]
    for o in meshes:
        t = mesh_tris(o)
        if gentle:
            if t > 90000:
                decimate(o, 0.35)
            elif t > 45000:
                decimate(o, 0.45)
            elif t > 20000:
                decimate(o, 0.60)
        else:
            if t > 90000:
                decimate(o, 0.20)
            elif t > 45000:
                decimate(o, 0.25)
            elif t > 18000:
                decimate(o, 0.40)
            elif t > 8000:
                decimate(o, 0.55)
            elif t > 3500:
                decimate(o, 0.70)
    _, _, tris_now = total_stats()
    if not gentle and tris_now > target_tris:
        ranked = sorted(
            [o for o in bpy.data.objects if o.type == 'MESH' and '_2' not in o.name],
            key=lambda o: -mesh_tris(o),
        )
        for o in ranked[:6]:
            if total_stats()[2] <= target_tris:
                break
            if mesh_tris(o) < 2000:
                continue
            need = total_stats()[2] / target_tris
            ratio = max(0.35, min(0.75, 1.0 / need))
            decimate(o, ratio)


def join_body_keep_wheels():
    wheels = {o for o in bpy.data.objects if o.name in ('FL_2', 'FR_2', 'RL_2', 'RR_2')}
    steers = {o for o in bpy.data.objects if o.name in ('FL_1', 'FR_1', 'RL_1', 'RR_1')}
    body = [o for o in bpy.data.objects if o.type == 'MESH' and o not in wheels]
    if len(body) >= 1:
        join_objects(body, 'Car')
    return wheels, steers


def process(job):
    print('\n==== RIG', job['id'], '====')
    clear_scene()
    kind = job.get('import_type', 'gltf')
    if kind == 'obj':
        bpy.ops.wm.obj_import(filepath=job['src'])
    elif kind == 'blend':
        with bpy.data.libraries.load(job['src']) as (data_from, data_to):
            data_to.objects = data_from.objects
        for obj in data_to.objects:
            if obj is not None:
                bpy.context.scene.collection.objects.link(obj)
    else:
        bpy.ops.import_scene.gltf(filepath=job['src'])
    m0, v0, t0 = total_stats()
    print(f'IMPORTED meshes={m0} verts={v0} tris={t0}')

    fix_materials_for_web()
    # Strip interior when safe (name-based)
    removed = 0
    for o in list(bpy.data.objects):
        if is_interior_object(o) and not is_wheel_candidate(o):
            bpy.data.objects.remove(o, do_unlink=True)
            removed += 1
    print('removed interior', removed)

    unparent_apply_all()

    wheels = gather_wheel_meshes()
    # Filter: for forza fragments require wheel mat; drop steering
    wheels = [o for o in wheels if o.name in bpy.data.objects]
    print('wheels after gather', len(wheels))

    if len(wheels) < 4:
        print('WARN few wheels', len(wheels), '— exporting without rig')
        soft_decimate_body(job.get('target_tris', 50000), job.get('gentle', False))
        resize_images(max_color=job.get('max_color', 1024), max_normal=512)
        # join all
        join_objects([o for o in bpy.data.objects if o.type == 'MESH'], 'Car')
        normalize_vehicle(4.6)
        fix_materials_for_web()
        export_glb(job['out'])
        return

    # If many fragments, keep them all for clustering; if few large, use as-is
    buckets = cluster_into_four(wheels)
    for k, v in buckets.items():
        print('bucket', k, len(v), [o.name for o in v][:5])

    # Detach wheel objects from body join set by naming after join
    make_wheel_rig(buckets)

    soft_decimate_body(job.get('target_tris', 50000), job.get('gentle', False))
    # Light-decimate wheels if huge
    for name in ('FL_2', 'FR_2', 'RL_2', 'RR_2'):
        o = bpy.data.objects.get(name)
        if o and mesh_tris(o) > 12000:
            decimate(o, 0.45)

    resize_images(max_color=job.get('max_color', 1024), max_normal=512)
    join_body_keep_wheels()

    # Normalize whole vehicle including empties: scale empties+meshes together
    # Collect all mesh + steer empties
    roots = [o for o in bpy.data.objects if o.name in ('FL_1', 'FR_1', 'RL_1', 'RR_1')]
    car = bpy.data.objects.get('Car')
    # Unparent wheels temporarily for normalize, then reparent
    wheel_meshes = []
    for key in ('FL', 'FR', 'RL', 'RR'):
        steer = bpy.data.objects.get(f'{key}_1')
        mesh = bpy.data.objects.get(f'{key}_2')
        if mesh and steer:
            mesh.parent = None
            mesh.matrix_world = Matrix(mesh.matrix_world)  # keep
            wheel_meshes.append((key, mesh))
            bpy.data.objects.remove(steer, do_unlink=True)

    # Apply mesh transforms before normalize
    targets = [o for o in bpy.data.objects if o.type == 'MESH']
    bpy.ops.object.select_all(action='DESELECT')
    for o in targets:
        o.select_set(True)
    if targets:
        bpy.context.view_layer.objects.active = targets[0]
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    normalize_vehicle(4.6)

    # Rebuild empties at tyre-centered pivots (after normalize)
    for key, mesh in wheel_meshes:
        if mesh.name not in bpy.data.objects:
            mesh = bpy.data.objects.get(f'{key}_2') or mesh
        if mesh.name not in bpy.data.objects:
            continue
        c = wheel_spin_center(mesh)
        steer = bpy.data.objects.new(f'{key}_1', None)
        steer.empty_display_size = 0.15
        bpy.context.scene.collection.objects.link(steer)
        steer.location = c
        set_mesh_origin(mesh, c)
        mesh.parent = steer
        mesh.matrix_parent_inverse = steer.matrix_world.inverted()
        mesh.name = f'{key}_2'

    fix_materials_for_web()
    m1, v1, t1 = total_stats()
    print(f'FINAL meshes={m1} verts={v1} tris={t1}')
    for key in ('FL', 'FR', 'RL', 'RR'):
        print('  has', key, bool(bpy.data.objects.get(f'{key}_1')), bool(bpy.data.objects.get(f'{key}_2')))
    export_glb(job['out'])


def main():
    only = os.environ.get('ONLY')
    for job in JOBS:
        if only and job['id'] != only:
            continue
        try:
            process(job)
        except Exception as e:
            print('FAILED', job['id'], e)
            import traceback
            traceback.print_exc()


if __name__ == '__main__':
    main()
