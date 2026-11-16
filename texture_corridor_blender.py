import bpy, math, json
from mathutils import Vector
ROOT='/Users/rokaya/Desktop/Saudi-tafheet/'
def newmat(name):
    m=bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes=True;m.node_tree.nodes.clear()
    n=m.node_tree.nodes;l=m.node_tree.links
    out=n.new('ShaderNodeOutputMaterial');bs=n.new('ShaderNodeBsdfPrincipled');l.new(bs.outputs['BSDF'],out.inputs['Surface'])
    return m,n,l,bs
m,n,l,bs=newmat('Alexandria_Weathered_Facades')
def node(kind,**kw):
    a=n.new(kind)
    for k,v in kw.items():setattr(a,k,v)
    return a
def mathnode(op,a,b=None):
    t=node('ShaderNodeMath',operation=op)
    for i,v in enumerate((a,b)):
        if v is None:continue
        if isinstance(v,(float,int)):t.inputs[i].default_value=v
        else:l.new(v,t.inputs[i])
    return t.outputs[0]
def band(v,low,high):return mathnode('MULTIPLY',mathnode('GREATER_THAN',v,low),mathnode('LESS_THAN',v,high))
def mix(a,b,f):
    t=node('ShaderNodeMixRGB',blend_type='MIX')
    for i,v in ((0,f),(1,a),(2,b)):
        if isinstance(v,(tuple,list)):t.inputs[i].default_value=v
        elif isinstance(v,(float,int)):t.inputs[i].default_value=v
        else:l.new(v,t.inputs[i])
    return t.outputs[0]
uv=node('ShaderNodeTexCoord');sep=node('ShaderNodeSeparateXYZ');l.new(uv.outputs['UV'],sep.inputs[0])
x=mathnode('FRACT',mathnode('DIVIDE',sep.outputs['X'],3.0))
y=mathnode('FRACT',mathnode('DIVIDE',sep.outputs['Y'],3.2))
upper=mathnode('GREATER_THAN',sep.outputs['Y'],3.2)
outer=mathnode('MULTIPLY',mathnode('MULTIPLY',band(x,.20,.80),band(y,.22,.83)),upper)
inner=mathnode('MULTIPLY',mathnode('MULTIPLY',band(x,.235,.765),band(y,.255,.795)),upper)
mullion=mathnode('MAXIMUM',band(x,.485,.515),band(y,.51,.535))
inner=mathnode('MULTIPLY',inner,mathnode('SUBTRACT',1,mullion))
shop=mathnode('MULTIPLY',band(sep.outputs['Y'],.45,2.65),band(x,.10,.90))
shopframe=mathnode('MULTIPLY',band(sep.outputs['Y'],.35,2.77),band(x,.075,.925))
outer=mathnode('MAXIMUM',outer,shopframe);inner=mathnode('MAXIMUM',inner,shop)
info=node('ShaderNodeObjectInfo')
palette=node('ShaderNodeValToRGB');l.new(info.outputs['Random'],palette.inputs['Fac'])
colors=[(.66,.57,.42,1),(.77,.71,.59,1),(.54,.49,.40,1),(.69,.54,.46,1),(.56,.61,.53,1),(.76,.74,.67,1),(.49,.35,.26,1),(.65,.63,.58,1)]
r=palette.color_ramp;r.interpolation='CONSTANT'
r.elements.remove(r.elements[1]);r.elements[0].color=colors[0]
for i,c in enumerate(colors[1:],1):r.elements.new(i/len(colors)).color=c
noise=node('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=1.2;noise.inputs['Detail'].default_value=4;noise.inputs['Roughness'].default_value=.78
l.new(uv.outputs['UV'],noise.inputs['Vector'])
streakvec=node('ShaderNodeVectorMath',operation='MULTIPLY');l.new(uv.outputs['UV'],streakvec.inputs[0]);streakvec.inputs[1].default_value=(3,.08,1)
streak=node('ShaderNodeTexNoise');l.new(streakvec.outputs['Vector'],streak.inputs['Vector']);streak.inputs['Scale'].default_value=1.6;streak.inputs['Detail'].default_value=2
dirt=mathnode('MULTIPLY',noise.outputs['Fac'],streak.outputs['Fac'])
wall=mix(palette.outputs['Color'],(.20,.18,.14,1),mathnode('MULTIPLY',dirt,.48))
frame=mix((.24,.22,.19,1),(.48,.46,.39,1),info.outputs['Random'])
window_noise=node('ShaderNodeTexWhiteNoise',noise_dimensions='3D')
grid=node('ShaderNodeCombineXYZ');l.new(mathnode('FLOOR',mathnode('DIVIDE',sep.outputs['X'],3)),grid.inputs['X']);l.new(mathnode('FLOOR',mathnode('DIVIDE',sep.outputs['Y'],3.2)),grid.inputs['Y']);l.new(mathnode('MULTIPLY',info.outputs['Random'],1000),grid.inputs['Z']);l.new(grid.outputs[0],window_noise.inputs['Vector'])
glass=mix((.025,.045,.052,1),(.18,.235,.24,1),window_noise.outputs['Value'])
# A few pale closed shutters break up the window pattern.
glass=mix(glass,(.34,.32,.27,1),mathnode('GREATER_THAN',window_noise.outputs['Value'],.86))
color=mix(mix(wall,frame,outer),glass,inner);l.new(color,bs.inputs['Base Color'])
l.new(mix((.88,.88,.88,1),(.25,.25,.25,1),inner),bs.inputs['Roughness'])
bs.inputs['Metallic'].default_value=.04
bump=node('ShaderNodeBump');bump.inputs['Strength'].default_value=.25;bump.inputs['Distance'].default_value=.065;l.new(noise.outputs['Fac'],bump.inputs['Height']);l.new(bump.outputs['Normal'],bs.inputs['Normal'])
m.diffuse_color=(.66,.58,.46,1)
roof,rn,rl,rbs=newmat('Alexandria_Dusty_Concrete_Roofs')
tex=rn.new('ShaderNodeTexNoise');tex.inputs['Scale'].default_value=2.8;tex.inputs['Detail'].default_value=3
coord=rn.new('ShaderNodeTexCoord');rl.new(coord.outputs['Object'],tex.inputs['Vector'])
ramp=rn.new('ShaderNodeValToRGB');ramp.color_ramp.elements[0].color=(.16,.15,.13,1);ramp.color_ramp.elements[1].color=(.44,.40,.32,1);rl.new(tex.outputs['Fac'],ramp.inputs[0]);rl.new(ramp.outputs['Color'],rbs.inputs['Base Color']);rbs.inputs['Roughness'].default_value=.95
rb=rn.new('ShaderNodeBump');rb.inputs['Distance'].default_value=.05;rb.inputs['Strength'].default_value=.3;rl.new(tex.outputs['Fac'],rb.inputs['Height']);rl.new(rb.outputs['Normal'],rbs.inputs['Normal']);roof.diffuse_color=(.35,.31,.25,1)
c=bpy.data.collections['AbuQir_Buildings']
for o in c.objects:
    me=o.data;me.materials.clear();me.materials.append(m);me.materials.append(roof)
    layer=me.uv_layers.get('Facade_Meters') or me.uv_layers.new(name='Facade_Meters');me.uv_layers.active=layer
    for face in me.polygons:
        face.material_index=1 if abs(face.normal.z)>.5 else 0
        ids=list(face.vertices)
        if face.material_index==0:
            tangent=Vector((-face.normal.y,face.normal.x,0)).normalized()
            coords=[me.vertices[i].co.dot(tangent) for i in ids];minu=min(coords)
            # Center the 3 m window bays within each facade.
            span=max(coords)-minu;offset=(3-span%3)/2
            for li,u in zip(face.loop_indices,coords):layer.data[li].uv=(u-minu+offset,me.vertices[me.loops[li].vertex_index].co.z)
        else:
            for li in face.loop_indices:
                v=me.vertices[me.loops[li].vertex_index].co;layer.data[li].uv=(v.x,v.y)
    me.update()
scene=bpy.context.scene
scene['facade_materials']='Procedural Alexandria-inspired plaster/concrete, weathering, framed windows, shutters, storefront glazing, dusty roofs; illustrative, not surveyed photographic facades.'
for area in bpy.context.screen.areas:
    if area.type=='VIEW_3D':area.spaces.active.shading.type='MATERIAL'
path=ROOT+'AbuQir_Curved_Corridor_Textured.blend'
bpy.ops.wm.save_as_mainfile(filepath=path)
targets=sorted([o for o in c.objects if 8<o.dimensions.x<35 and 8<o.dimensions.y<35 and o.dimensions.z>12],key=lambda o:o.data.vertices[0].co.length)
print('SAVED',path,'BUILDINGS',len(c.objects),'PREVIEW',[o.name for o in targets[:4]])
