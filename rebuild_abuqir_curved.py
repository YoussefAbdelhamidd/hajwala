"""Run inside the connected Blender after the fresh Blosm import/conversion."""
import bpy, bmesh, math, json, sys, time
from mathutils import Matrix, Vector
sys.path.insert(0, '/private/tmp/abuqir-geometry/lib')
import shapely
from shapely.geometry import Polygon, LineString, Point
from shapely.ops import nearest_points
from shapely import affinity
from bl_ext.user_default.blosm.app.blender import app

started = time.time()
scene = bpy.context.scene
for key in list(scene.keys()):
    if key.startswith('AbuQir_'): del scene[key]
scene.unit_settings.system = 'METRIC'
scene.unit_settings.scale_length = 1.0
corners = [(lat,lon) for lat,lon in [(31.2020,29.9180),(31.2020,29.9805),(31.2495,29.9805),(31.2495,29.9180)]]
bounds = Polygon([app.projection.fromGeographic(a,b)[:2] for a,b in corners])

def polygons(g):
    if g.is_empty: return []
    if g.geom_type == 'Polygon': return [g]
    return [p for x in getattr(g,'geoms',[]) for p in polygons(x)]

def lines(g):
    if g.is_empty: return []
    if g.geom_type == 'LineString': return [g]
    return [p for x in getattr(g,'geoms',[]) for p in lines(x)]

def footprint(o):
    vs = [o.matrix_world @ v.co for v in o.data.vertices]
    ps = []
    for face in o.data.polygons:
        p = Polygon([(vs[i].x,vs[i].y) for i in face.vertices])
        if p.area > 0.00001: ps.extend(polygons(shapely.make_valid(p)))
    return shapely.union_all(ps) if ps else Polygon()

def surface_mesh(name, geom, z):
    tris = shapely.constrained_delaunay_triangles(geom)
    verts=[]; faces=[]; lookup={}
    for tri in polygons(tris):
        face=[]
        for x,y in list(tri.exterior.coords)[:-1]:
            key=(round(x,6),round(y,6))
            if key not in lookup:
                lookup[key]=len(verts);verts.append((x,y,z))
            face.append(lookup[key])
        faces.append(face)
    m=bpy.data.meshes.new(name);m.from_pydata(verts,[],faces);m.update()
    return m

def main_road(o):
    return o.get('highway')=='primary' and any(s in str(dict(o.items())).lower() for s in ['abou qir','abu qir','horeya','gamal abd','جمال عبد الناصر'])

center=bpy.data.objects['AbuQir_OSM_Centerline']
raw_lines=[LineString([tuple(center.data.vertices[i].co)[:2] for i in e.vertices]) for e in center.data.edges]
path=shapely.union_all(raw_lines).intersection(bounds)
assert path.length > 12000, ('Main road centerline incomplete',path.length)
corridor=path.buffer(120,quad_segs=12)
old=center.data
verts=[];edges=[]
for line in lines(path):
    start=len(verts); coords=list(line.coords)
    verts.extend([(x,y,0.01) for x,y in coords]);edges.extend([(start+i,start+i+1) for i in range(len(coords)-1)])
m=bpy.data.meshes.new('AbuQir_True_Centerline');m.from_pydata(verts,edges,[]);m.update();center.data=m
if old.users==0:bpy.data.meshes.remove(old)
center['role']='Analysis centerline: actual OSM road spline edges, clipped to requested geographic bounds'
center.hide_render=True;center.hide_set(True)

collections={}
for name in ['AbuQir_Ground','AbuQir_Roads','AbuQir_Buildings']:
    c=bpy.data.collections.new(name);scene.collection.children.link(c);collections[name]=c
def move(o,c):
    for old in list(o.users_collection): old.objects.unlink(o)
    c.objects.link(o)
move(center,collections['AbuQir_Roads'])

road_geoms=[]; road_records=[]; main_count=0; road_count=0
for o in list(bpy.data.objects):
    if o==center or 'highway' not in o:continue
    if o.type!='MESH':bpy.data.objects.remove(o,do_unlink=True);continue
    g=footprint(o).intersection(corridor).intersection(bounds)
    g=shapely.union_all(polygons(g))
    if g.is_empty or g.area<0.02:
        bpy.data.objects.remove(o,do_unlink=True);continue
    ismain=main_road(o)
    old=o.data; mats=list(old.materials)
    o.data=surface_mesh(o.name+'_Flat',g,0.01);o.matrix_world=Matrix.Identity(4)
    for mat in mats:o.data.materials.append(mat)
    if old.users==0:bpy.data.meshes.remove(old)
    o['AbuQir_role']='main_avenue' if ismain else 'local_branch_within_120m'
    move(o,collections['AbuQir_Roads']);road_geoms.append(g)
    road_records.append((o,g,ismain))
    main_count+=int(ismain);road_count+=1
road_surface=shapely.union_all(road_geoms)
main_surface=shapely.union_all([g for o,g,ismain in road_records if ismain])
road_clearance=main_surface.buffer(3.02,quad_segs=8)
print('Roads clipped:',road_count,'main segments:',main_count,'centerline length both carriageways:',round(path.length,2),flush=True)

kept=[]; deleted=0; adjusted=0; max_shift=0; max_shrink=0; original_count=0
for o in list(bpy.data.objects):
    if o==center or 'highway' in o:continue
    if o.type!='MESH' or not any('buildings' in c.name.lower() for c in o.users_collection):
        bpy.data.objects.remove(o,do_unlink=True);continue
    original_count+=1
    fp=footprint(o)
    distance=fp.distance(path)
    if fp.is_empty or distance<3 or distance>120 or not fp.intersects(bounds):
        bpy.data.objects.remove(o,do_unlink=True);deleted+=1;continue
    # A modest uniform footprint inset preserves the original height and roof.
    cx,cy=fp.centroid.coords[0]
    scale=.96
    inset=affinity.scale(fp,xfact=scale,yfact=scale,origin=(cx,cy))
    dx=dy=0.0
    if inset.intersects(road_clearance):
        a,b=nearest_points(path,Point(cx,cy));vx=b.x-a.x;vy=b.y-a.y
        n=math.hypot(vx,vy) or 1;vx/=n;vy/=n
        base_angle=math.atan2(vy,vx)
        found=False
        for radius in [1,2,3,4,5,6,8,10,12,15,20,25,30,40,50,70,100]:
            for angle_offset in [0,15,-15,30,-30,45,-45,60,-60,90,-90,120,-120,180]:
                angle=base_angle+math.radians(angle_offset)
                tx=radius*math.cos(angle);ty=radius*math.sin(angle)
                candidate=affinity.translate(inset,tx,ty)
                if candidate.distance(path)<=120 and not candidate.intersects(road_clearance):
                    dx,dy=tx,ty;inset=candidate;found=True;break
            if found:break
        if not found:
            raise RuntimeError('Cannot resolve building clearance: '+o.name)
        adjusted+=1
    world=[o.matrix_world@v.co for v in o.data.vertices]
    base=min(v.z for v in world)
    for v,p in zip(o.data.vertices,world):
        v.co=((p.x-cx)*scale+cx+dx,(p.y-cy)*scale+cy+dy,p.z-base)
    o.matrix_world=Matrix.Identity(4);o.data.update()
    o['AbuQir_original_distance_m']=distance
    o['AbuQir_footprint_scale']=scale
    o['AbuQir_clearance_shift_m']=math.hypot(dx,dy)
    move(o,collections['AbuQir_Buildings'])
    kept.append((o,inset));max_shift=max(max_shift,math.hypot(dx,dy))

# OSM side paths occasionally cross building polygons. Trim only those branch
# surfaces rather than displacing buildings away from their mapped blocks.
building_clearance=shapely.union_all([fp.buffer(3.03,quad_segs=8) for o,fp in kept])
road_geoms=[];branches_trimmed=0;road_count=0
for o,g,ismain in road_records:
    if not ismain:
        clipped=shapely.union_all(polygons(g.difference(building_clearance)))
        if clipped.area < g.area-.001:branches_trimmed+=1
        g=clipped
        if g.is_empty or g.area<.02:
            bpy.data.objects.remove(o,do_unlink=True);continue
        old=o.data;mats=list(old.materials)
        o.data=surface_mesh(o.name+'_Clearance',g,.01)
        for mat in mats:o.data.materials.append(mat)
        if old.users==0:bpy.data.meshes.remove(old)
    road_geoms.append(g);road_count+=1
road_surface=shapely.union_all(road_geoms)

ground_geom=shapely.union_all([path.buffer(125,quad_segs=16)]+[fp.buffer(3,quad_segs=4) for o,fp in kept])
ground=bpy.data.objects.new('AbuQir_Curved_Ground',surface_mesh('AbuQir_Curved_Ground',ground_geom,-.05))
collections['AbuQir_Ground'].objects.link(ground)
mat=bpy.data.materials.new('AbuQir_Ground_Sidewalk');mat.use_nodes=True
shader=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
shader.inputs['Base Color'].default_value=(.38,.35,.29,1);shader.inputs['Roughness'].default_value=.95
mat.diffuse_color=(.38,.35,.29,1);ground.data.materials.append(mat)

# All output geometry uses world-space mesh coordinates and identity transforms.
for o in bpy.data.objects:
    if o.type!='MESH':continue
    bm=bmesh.new();bm.from_mesh(o.data)
    if bm.faces:bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
    bm.to_mesh(o.data);bm.free();o.data.update()
for c in list(bpy.data.collections):
    if c.name not in collections:bpy.data.collections.remove(c)
for datablocks in [bpy.data.meshes,bpy.data.curves]:
    for d in list(datablocks):
        if d.users==0:datablocks.remove(d)

actual=[(o,footprint(o)) for o,fp in kept]
clearances=[fp.distance(road_surface) for o,fp in actual]
distances=[fp.distance(path) for o,fp in actual]
base_error=max(abs(min(v.co.z for v in o.data.vertices)) for o,fp in actual)
transforms=sum(1 for o in bpy.data.objects if any(abs(o.matrix_world[i][j]-(1 if i==j else 0))>1e-6 for i in range(4) for j in range(4)))
report={'source_osm':'blosm_data/osm/map_6.osm','bounds':[31.2020,31.2495,29.9180,29.9805],
 'main_avenue_segments':main_count,'road_surface_objects':road_count,'centerline_edges':len(center.data.edges),
 'centerline_length_both_carriageways_m':path.length,'imported_buildings':original_count,
 'kept_buildings':len(kept),'deleted_buildings':deleted,'buildings_translated_for_clearance':adjusted,
 'side_branch_objects_trimmed_for_clearance':branches_trimmed,
 'maximum_building_translation_m':max_shift,'footprint_scale_xy':.96,
 'minimum_building_to_any_road_surface_clearance_m':min(clearances),
 'building_to_centerline_distance_range_m':[min(distances),max(distances)],
 'building_base_max_error_m':base_error,'nonidentity_transforms':transforms,
 'ground_z':-.05,'road_z':.01,'elapsed_s':time.time()-started}
assert min(clearances)>=2.999,report
assert min(distances)>=2.999 and max(distances)<=120.001,report
assert transforms==0 and base_error<1e-5,report
scene['AbuQir_Report']=json.dumps(report,ensure_ascii=False)
scene['AbuQir_crop']='Exact footprint distance to actual imported road centerline mesh edges; 3–120m; side roads clipped at 120m'
scene['Elevation source']='No terrain; building bases 0m, road surfaces 0.01m, curved ground -0.05m'
scene['OSM attribution']='© OpenStreetMap contributors, ODbL; https://www.openstreetmap.org/copyright'
scene['AbuQir_clearance']='Measured minimum 3m from every retained building footprint to union of all retained road surfaces'
for screen in bpy.data.screens:
    for area in screen.areas:
        if area.type=='VIEW_3D':
            area.spaces.active.clip_end=30000
            area.spaces.active.region_3d.view_distance=9000
            area.spaces.active.region_3d.view_location=(0,0,0)
            area.spaces.active.shading.color_type='MATERIAL'
bpy.ops.object.select_all(action='DESELECT')
bpy.context.view_layer.objects.active=ground
out='/Users/rokaya/Desktop/Saudi-tafheet/AbuQir_Curved_Corridor.blend'
bpy.ops.wm.save_as_mainfile(filepath=out)
with open(out.replace('.blend','_report.json'),'w') as f:json.dump(report,f,indent=2)
print(json.dumps(report,indent=2),flush=True)
