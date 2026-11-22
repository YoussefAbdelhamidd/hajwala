"""
Blender car optimizer for web GLBs.
Usage inside Blender: exec(open(path).read()); optimize_and_export(src, out, **opts)
"""
import bpy
import os
from mathutils import Vector, Euler


def clear_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for coll in (
        bpy.data.meshes, bpy.data.materials, bpy.data.images,
        bpy.data.armatures, bpy.data.actions, bpy.data.cameras, bpy.data.lights,
    ):
        for b in list(coll):
            try:
                coll.remove(b)
            except Exception:
                pass


def mesh_tris(obj):
    me = obj.data
    me.calc_loop_triangles()
    return len(me.loop_triangles)


def is_interior_object(obj):
    """Strip only small cabin clutter — keep cabin tubs so windows aren't see-through."""
    if obj.type != 'MESH':
        return False
    mats = ' '.join([(s.material.name if s.material else '') for s in obj.material_slots]).lower()
    name = obj.name.lower()
    blob = mats + ' ' + name
    # Keep body paint / exterior shells (and cabin tubs like INTERIOR_mm_cab).
    exterior = (
        'paint', 'coloured', 'colored', 'carbon', 'base_material', 'exterior',
        'body_paint', 'carpaint', 'car_paint', 'mm_ext', 'mm_cab', 'mm_chassis',
    )
    if any(k in mats for k in exterior):
        return False
    # Keep large cabin shell meshes (block see-through); drop only small clutter.
    if 'interior' in name or name.endswith('_cab') or '_cab_' in name:
        return False
    keys = (
        'steering_wheel', 'dashboard', 'pedal', 'impugnatura', 'velluto',
        'pistoni', 'door_mech', 'gauge', 'cintura', 'seatbelt', 'seat_belt',
        'sedile',
    )
    if any(k in blob for k in keys):
        return True
    if 'seat' in blob and 'paint' not in mats and len(obj.data.vertices) < 8000:
        return True
    return False


def decimate(obj, ratio):
    t = mesh_tris(obj)
    if t < 1200:
        return t, t
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    mod = obj.modifiers.new(name='WebDecimate', type='DECIMATE')
    mod.decimate_type = 'COLLAPSE'
    mod.ratio = float(ratio)
    mod.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=mod.name)
    after = mesh_tris(obj)
    print(f'  decimate {obj.name}: {t} -> {after} (r={ratio})')
    return t, after


def fix_materials_for_web():
    """HASHED/BLENDED body paints look see-through in Eevee — force opaque except glass."""
    for m in bpy.data.materials:
        low = m.name.lower()
        is_glass = any(k in low for k in ('glass', 'window', 'ambar', 'windshield', 'windscreen'))
        if hasattr(m, 'surface_render_method'):
            m.surface_render_method = 'BLENDED' if is_glass else 'DITHERED'
        if hasattr(m, 'blend_method'):
            m.blend_method = 'BLEND' if is_glass else 'OPAQUE'
        if m.use_nodes:
            bsdf = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
            if not bsdf:
                continue
            if is_glass:
                if not bsdf.inputs['Alpha'].is_linked and bsdf.inputs['Alpha'].default_value >= 0.99:
                    bsdf.inputs['Alpha'].default_value = 0.35
            else:
                if not bsdf.inputs['Alpha'].is_linked:
                    bsdf.inputs['Alpha'].default_value = 1.0
                # Disconnect accidental alpha maps that punch holes in paint
                alpha_in = bsdf.inputs['Alpha']
                if alpha_in.is_linked and not is_glass:
                    # Only disconnect if linked from a non-glass image
                    m.node_tree.links.remove(alpha_in.links[0])
                    alpha_in.default_value = 1.0
    print('materials web-fixed')


def resize_images(max_color=1024, max_normal=512):
    for img in list(bpy.data.images):
        if img.name in ('Render Result', 'Viewer Node'):
            continue
        w, h = img.size
        if w == 0 or h == 0:
            continue
        n = img.name.lower()
        is_data = any(k in n for k in ('_n', 'nm', 'normal', 'occlusion', 'rough', 'metal', 'spec', 'ao'))
        max_dim = max_normal if is_data else max_color
        m = max(w, h)
        if m <= max_dim:
            continue
        scale = max_dim / m
        nw = max(2, int(w * scale) // 2 * 2)
        nh = max(2, int(h * scale) // 2 * 2)
        img.scale(nw, nh)
        print(f'  resize {img.name}: {w}x{h} -> {nw}x{nh}')


def total_stats():
    tris = verts = 0
    meshes = 0
    for o in bpy.data.objects:
        if o.type != 'MESH':
            continue
        meshes += 1
        tris += mesh_tris(o)
        verts += len(o.data.vertices)
    return meshes, verts, tris


def join_all_meshes():
    """Collapse draw calls — keep materials via slots."""
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    if len(meshes) <= 1:
        return
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.join()
    joined = bpy.context.view_layer.objects.active
    if joined:
        joined.name = 'Car'
    print('joined meshes ->', len([o for o in bpy.data.objects if o.type == 'MESH']))


def normalize_vehicle(target_length=4.6):
    """Scale longest horizontal axis to ~car length (meters) and plant on Z=0."""
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    if not meshes:
        return
    # Unparent keeping world transform so scale isn't trapped on empties/armatures
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    try:
        bpy.ops.object.parent_clear(type='CLEAR_KEEP_TRANSFORM')
    except Exception:
        pass
    # Apply existing transforms first
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)

    mins = Vector((1e9, 1e9, 1e9))
    maxs = Vector((-1e9, -1e9, -1e9))
    for o in meshes:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            mins = Vector((min(mins.x, w.x), min(mins.y, w.y), min(mins.z, w.z)))
            maxs = Vector((max(maxs.x, w.x), max(maxs.y, w.y), max(maxs.z, w.z)))
    size = maxs - mins
    length = max(size.x, size.y)
    if length < 1e-6:
        return
    scale = target_length / length
    # If already roughly car-sized, only tiny adjust
    if 3.2 <= length <= 6.5:
        scale = 1.0
    print(f'normalize length {length:.3f} -> scale {scale:.4f}')
    for o in meshes:
        o.scale *= scale
    bpy.ops.object.select_all(action='DESELECT')
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)

    # Recompute and center / ground
    mins = Vector((1e9, 1e9, 1e9))
    maxs = Vector((-1e9, -1e9, -1e9))
    for o in [o for o in bpy.data.objects if o.type == 'MESH']:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            mins = Vector((min(mins.x, w.x), min(mins.y, w.y), min(mins.z, w.z)))
            maxs = Vector((max(maxs.x, w.x), max(maxs.y, w.y), max(maxs.z, w.z)))
    center_xy = Vector(((mins.x + maxs.x) / 2, (mins.y + maxs.y) / 2, 0))
    for o in [o for o in bpy.data.objects if o.type == 'MESH']:
        o.location.x -= center_xy.x
        o.location.y -= center_xy.y
        o.location.z -= mins.z
    bpy.ops.object.select_all(action='DESELECT')
    for o in [o for o in bpy.data.objects if o.type == 'MESH']:
        o.select_set(True)
    bpy.context.view_layer.objects.active = [o for o in bpy.data.objects if o.type == 'MESH'][0]
    bpy.ops.object.transform_apply(location=True, rotation=False, scale=False)
    print('planted on ground, centered')


def setup_preview_camera():
    for o in list(bpy.data.objects):
        if o.type in {'LIGHT', 'CAMERA'}:
            bpy.data.objects.remove(o, do_unlink=True)

    world = bpy.data.worlds.get('World') or bpy.data.worlds.new('World')
    bpy.context.scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    nt.nodes.clear()
    bg = nt.nodes.new('ShaderNodeBackground')
    bg.inputs[0].default_value = (0.5, 0.55, 0.65, 1)
    bg.inputs[1].default_value = 0.7
    out = nt.nodes.new('ShaderNodeOutputWorld')
    nt.links.new(bg.outputs[0], out.inputs[0])

    sun = bpy.data.lights.new('Sun', 'SUN')
    sun.energy = 4.0
    sun_o = bpy.data.objects.new('Sun', sun)
    bpy.context.scene.collection.objects.link(sun_o)
    sun_o.rotation_euler = Euler((0.95, 0.15, 0.7))

    fill = bpy.data.lights.new('Fill', 'AREA')
    fill.energy = 250
    fill.size = 10
    fill_o = bpy.data.objects.new('Fill', fill)
    bpy.context.scene.collection.objects.link(fill_o)
    fill_o.location = (-5, -4, 3.5)

    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    if not meshes:
        return
    mins = Vector((1e9, 1e9, 1e9))
    maxs = Vector((-1e9, -1e9, -1e9))
    for o in meshes:
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            mins = Vector((min(mins.x, w.x), min(mins.y, w.y), min(mins.z, w.z)))
            maxs = Vector((max(maxs.x, w.x), max(maxs.y, w.y), max(maxs.z, w.z)))
    center = (mins + maxs) / 2
    size = max((maxs - mins).length, 0.5)
    cam_d = bpy.data.cameras.new('Cam')
    cam = bpy.data.objects.new('Cam', cam_d)
    bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam
    cam.location = center + Vector((size * 0.75, -size * 1.15, size * 0.38))
    cam.rotation_euler = (center - cam.location).to_track_quat('-Z', 'Y').to_euler()


def export_glb(path, use_draco=True):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    kwargs = dict(
        filepath=path,
        export_format='GLB',
        use_selection=False,
        export_apply=True,
        export_texcoords=True,
        export_normals=True,
        export_materials='EXPORT',
        export_image_format='AUTO',
    )
    if use_draco:
        kwargs.update(
            export_draco_mesh_compression_enable=True,
            export_draco_mesh_compression_level=6,
            export_draco_position_quantization=14,
            export_draco_normal_quantization=10,
            export_draco_texcoord_quantization=12,
        )
    try:
        bpy.ops.export_scene.gltf(**kwargs)
    except TypeError:
        # Fallback for kw differences
        bpy.ops.export_scene.gltf(
            filepath=path,
            export_format='GLB',
            export_texcoords=True,
            export_normals=True,
            export_materials='EXPORT',
        )
    mb = os.path.getsize(path) / 1024 / 1024
    print(f'EXPORTED {path} ({mb:.2f} MB)')
    return mb


def optimize_and_export(
    src,
    out,
    strip_interior=True,
    max_color=1024,
    max_normal=512,
    target_tris=55000,
    import_type='gltf',
    join_meshes=True,
    gentle=False,
):
    print('\\n==== OPTIMIZE', src, '====')
    clear_scene()

    if import_type == 'gltf':
        bpy.ops.import_scene.gltf(filepath=src)
    elif import_type == 'obj':
        bpy.ops.wm.obj_import(filepath=src)
    elif import_type == 'blend':
        with bpy.data.libraries.load(src) as (data_from, data_to):
            data_to.objects = data_from.objects
        for obj in data_to.objects:
            if obj is not None:
                bpy.context.scene.collection.objects.link(obj)
    else:
        raise ValueError(import_type)

    m0, v0, t0 = total_stats()
    print(f'IMPORTED meshes={m0} verts={v0} tris={t0} images={len(bpy.data.images)}')

    fix_materials_for_web()

    if strip_interior:
        removed = 0
        for o in list(bpy.data.objects):
            if is_interior_object(o):
                bpy.data.objects.remove(o, do_unlink=True)
                removed += 1
        print('removed interior-ish meshes', removed)

    # Soft decimate pass toward target
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    # Per-mesh ratios based on size
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
    # If still heavy, second pass on largest meshes
    if not gentle and tris_now > target_tris:
        ranked = sorted(
            [o for o in bpy.data.objects if o.type == 'MESH'],
            key=lambda o: -mesh_tris(o),
        )
        for o in ranked[:6]:
            if total_stats()[2] <= target_tris:
                break
            t = mesh_tris(o)
            if t < 2000:
                continue
            need = total_stats()[2] / target_tris
            ratio = max(0.35, min(0.75, 1.0 / need))
            decimate(o, ratio)

    resize_images(max_color=max_color, max_normal=max_normal)
    if join_meshes:
        join_all_meshes()
        # Recalc normals after join
        car = next((o for o in bpy.data.objects if o.type == 'MESH'), None)
        if car:
            bpy.ops.object.select_all(action='DESELECT')
            car.select_set(True)
            bpy.context.view_layer.objects.active = car
            bpy.ops.object.mode_set(mode='EDIT')
            bpy.ops.mesh.select_all(action='SELECT')
            bpy.ops.mesh.normals_make_consistent(inside=False)
            bpy.ops.object.mode_set(mode='OBJECT')
    normalize_vehicle(target_length=4.6)
    fix_materials_for_web()

    m1, v1, t1 = total_stats()
    print(f'FINAL meshes={m1} verts={v1} tris={t1}')
    setup_preview_camera()
    mb = export_glb(out)
    return {'src': src, 'out': out, 'tris_in': t0, 'tris_out': t1, 'mb': mb}
