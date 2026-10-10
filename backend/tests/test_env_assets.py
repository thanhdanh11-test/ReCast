"""S12 manifest, deterministic placement, physical and opacity regression proof."""
import ast
import json
import os
import re
import subprocess
from pathlib import Path

import numpy as np
import pytest

from topeye.sim import env_assets
from topeye.sim.cli import BUILD_SCENE, check_scenario
from topeye.sim.env_assets import clearance, footprint, plan_environment, validate_asset

BOUNDS = [-20, -20, 20, 20]
BLENDER = '/Applications/Blender.app/Contents/MacOS/Blender'


def asset(kind='building', size=(8, 4, 8), **kw):
    return {'asset_id': kind, 'kind': kind, 'file': f'{kind}.blend', 'native_size': list(size),
            'source_url': 'https://example.org/cc0', 'license': 'CC0', 'author': 'Test',
            'contains_label_classes': [], 'forward_axis': '+X', 'up_axis': '+Z',
            'polycount': 12, **kw}


def procedural(**kw):
    return {'buildings': [{'polygon': [[-4,-2],[4,-2],[4,2],[-4,2]], 'base_z': 0, 'height': 8}],
            'vegetation': [], 'poles': [], 'road_edges': [], **kw}


def plan(data=None, entries=None, road=None, actors=None, seed=7):
    return plan_environment(data or procedural(), entries if entries is not None else [asset()],
                            np.zeros((40,40)) if road is None else road, BOUNDS, actors or [], seed)


@pytest.mark.parametrize('name', ['car_body', 'vehicle', 'bus', 'truck', 'person.001', 'people',
                                  'human', 'CarBody', 'bike', 'bicycle', 'motorbike', 'cone', 'barrier'])
@pytest.mark.parametrize('field', ['mesh_names', 'material_names'])
def test_no_label_mesh_or_material(name, field, monkeypatch):
    if os.environ.get('H19_BREAK') == 'label':
        monkeypatch.setattr(env_assets, 'LABEL_NAMES', re.compile('NEVER_MATCH'))
    result = plan(entries=[asset(**{field:[name]})])
    assert not result['placements']
    assert 'label' in result['rejected'][0]['reason']


@pytest.mark.parametrize('kw', [{'contains_label_classes':['car']}, {'license':'unknown'},
                               {'file':'../outside.blend'}, {'file':'/tmp/out.blend'},
                               {'native_size':[1,0,1]}, {'native_size':[1,float('nan'),1]},
                               {'up_axis':'+Y'}, {'author':''}, {'polycount':0}])
def test_manifest_rejects_invalid(kw):
    with pytest.raises(ValueError):
        validate_asset(asset(**kw))


def test_exact_building_scale_and_nearest_ratio():
    result = plan(entries=[asset(asset_id='wrong', size=(4,4,8)), asset(asset_id='right')])
    p = result['placements'][0]
    assert p['asset_id'] == 'right'
    assert p['scale'] == pytest.approx([1,1,1])
    assert max(p['scale'])/min(p['scale']) <= 1.4


def test_distortion_falls_back_to_procedural():
    result = plan(entries=[asset(size=(8,4,2))])
    assert not result['placements']
    assert result['fallback_buildings'] == procedural()['buildings']
    assert 'distortion' in result['rejected'][0]['reason']


def test_trees_uniform_species_size_and_seed():
    data = procedural(buildings=[], vegetation=[{'x':0,'y':0,'z':0,'height':8,'crown_radius':2}])
    entries = [asset('tree', (4,4,8), asset_id='right'), asset('tree',(1,1,2),asset_id='wrong')]
    a = plan(data, entries)
    assert a == plan(data, entries)
    assert a != plan(data, entries, seed=8)
    assert a['placements'][0]['asset_id'] == 'right'
    assert len(set(a['placements'][0]['scale'])) == 1


def test_lamp_sign_height_contract():
    data = procedural(buildings=[], poles=[{'x':x,'y':0,'z':0,'height':h} for x,h in [(0,8),(5,4),(10,5)]])
    result = plan(data, [asset('lamp',(1,1,8)),asset('sign',(1,1,4))])
    assert [p['kind'] for p in result['placements']] == ['lamp','sign']


def test_props_density_and_determinism():
    data = procedural(buildings=[], road_edges=[[[-15,0],[15,0]]], props_density=.1)
    a = plan(data, [asset('prop',(.5,.5,1))])
    assert len(a['placements']) == 2
    assert a == plan(data,[asset('prop',(.5,.5,1))])


def test_physical_overlap_is_rejected(monkeypatch):
    if os.environ.get('H19_BREAK') == 'physical':
        monkeypatch.setattr(env_assets, 'clearance', lambda *args: True)
    assert not plan(road=np.ones((40,40)))['placements']
    actor = {'size':[2,2,2], 'keys':[{'center':[-10,0,0],'yaw':0},{'center':[10,0,0],'yaw':0}]}
    assert not plan(actors=[actor])['placements']


def test_road_cell_area_threshold_and_north_origin():
    road = np.zeros((40,40))
    road[0,0] = 1
    assert not clearance(np.array([-20,19]),np.array([-19,20]),road,BOUNDS,[])
    assert clearance(np.array([-20,-20]),np.array([-19,-19]),road,BOUNDS,[])
    road = np.zeros((100,100)); road[0,0] = 1
    assert clearance(np.array([-20,-20]),np.array([20,20]),road,BOUNDS,[])


def test_relocate_only_along_road_normal_within_budget():
    road = np.zeros((400,400)); road[200:,:] = 1
    data = procedural(buildings=[], vegetation=[{'x':0,'y':.2,'z':0,'height':1,'crown_radius':.2}], road_edges=[[[-10,0],[10,0]]])
    result = plan(data,[asset('tree',(.4,.4,1))],road)
    assert len(result['placements']) == 1
    p = result['placements'][0]
    assert p['x'] == 0 and .2 < p['y'] <= 1.7
    assert clearance(*footprint(p,[.4,.4,1]),road,BOUNDS,[])


def test_empty_manifest_safe_and_fallback_exclusion():
    assert plan(entries=[])['fallback_buildings']
    assert not plan(entries=[],road=np.ones((40,40)))['fallback_buildings']


def test_facade_completion_preserves_front_and_road_clearance():
    road = np.zeros((400, 400)); road[200:] = 1
    building = {'polygon': [[-4, 1], [4, 1], [4, 2], [-4, 2]], 'base_z': 0, 'height': 8}
    data = procedural(buildings=[building], facade_completion=True)
    result = plan(data, [asset()], road)
    p = result['placements'][0]
    assert p['geometry_source'] == 'facade_completed'
    assert p['completion_depth_m'] == 4
    assert np.asarray(p['observed_facade'])[:, 1] == pytest.approx([1, 1])
    assert p['y'] == 3
    assert clearance(*footprint(p, [8, 4, 8]), road, BOUNDS, [])
    assert max(p['scale']) / min(p['scale']) <= 1.4
    assert not plan({**data, 'facade_completion': False}, [asset()], road)['placements']
    assert not plan(data, [asset()], np.ones((400, 400)))['placements']
    actor = {'size': [2, 2, 2], 'keys': [{'center': [0, 5, 1], 'yaw': 0}]}
    assert not plan(data, [asset()], road, [actor])['placements']


def test_facade_rotated_asset_and_unknown_road():
    road = np.zeros((40, 40)); road[20:] = 1
    data = procedural(buildings=[{'polygon': [[-4, 1], [4, 1], [4, 2], [-4, 2]], 'base_z': 0, 'height': 8}],
                      facade_completion=True)
    p = plan(data, [asset(size=(4, 8, 8))], road)['placements'][0]
    assert abs(p['yaw']) == pytest.approx(np.pi / 2)
    assert not plan(data, [asset()])['placements']


def test_tree_canopy_overhang_and_tall_actor_guard():
    parts = [{'min': [-.2, -.2, 0], 'max': [.2, .2, 6]},
             {'min': [-3, -3, 6], 'max': [3, 3, 8]}]
    entry = asset('tree', (6, 6, 8), collision_parts=parts, canopy_min_z=6)
    data = procedural(buildings=[], vegetation=[{'x': 0, 'y': 1, 'z': 0, 'height': 8, 'crown_radius': 3}])
    road = np.zeros((400, 400)); road[200:] = 1
    actor = {'size': [2, 2, 2], 'keys': [{'center': [0, -1.5, 1], 'yaw': 0}]}
    assert plan(data, [entry], road, [actor])['placements']
    assert not plan(data, [asset('tree', (6, 6, 8))], road, [actor])['placements']
    tall = {'size': [2, 2, 7], 'keys': [{'center': [0, -1.5, 3.5], 'yaw': 0}]}
    assert not plan(data, [entry], road, [tall])['placements']
    low = {**entry, 'collision_parts': [parts[0], {'min': [-3, -3, 4], 'max': [3, 3, 8]}], 'canopy_min_z': 4}
    assert not plan(data, [low], road)['placements']
    trunk_in_road = {**data, 'vegetation': [{**data['vegetation'][0], 'y': -.1}]}
    assert not plan(trunk_in_road, [entry], road)['placements']


def test_collision_slabs_cover_triangle_interiors_and_reject_nan():
    triangles = np.array([[[-1, 0, 0], [1, 0, 8], [0, 1, 8]]], float)
    measured = env_assets.collision_geometry(triangles)
    for z in np.arange(.25, 8, .5):
        p = next(p for p in measured['collision_parts'] if p['min'][2] <= z <= p['max'][2])
        # Interior at this elevation lies inside the conservative slab.
        point = triangles[0, 0] * (1-z/8) + triangles[0, 1:].mean(0) * z/8
        assert np.all(point >= p['min']) and np.all(point <= p['max'])
    broken = asset('tree', (6, 6, 8), collision_parts=[{'min': [0, 0, float('nan')], 'max': [1, 1, 8]}], canopy_min_z=5)
    with pytest.raises(ValueError, match='collision'):
        plan(entries=[broken])


def test_assets_scenario_cli_and_blender(tmp_path):
    file = tmp_path/'assets.toml'; file.write_text('schema = 2\nname = "assets"\nenvironment = "assets"\n')
    assert check_scenario(file)['environment'] == 'assets'
    module = ast.parse(BUILD_SCENE.read_text())
    module.body = [n for n in module.body if not (isinstance(n, ast.Import) and any(a.name=='bpy' for a in n.names)
                   or isinstance(n, ast.ImportFrom) and n.module.startswith(('bpy','mathutils')) or isinstance(n,ast.If))]
    namespace = {'__name__':'test', '__file__':str(BUILD_SCENE)}
    exec(compile(module,str(BUILD_SCENE),'exec'),namespace)  # noqa: S102 - trusted repo AST
    assert namespace['load_scenario'](file,{'frames':[{'index':0,'cameras':{}}]})['environment']=='assets'


def run_blender(tmp_path, source):
    script = tmp_path/'proof.py'; script.write_text(source)
    result = subprocess.run([BLENDER,'-b','--factory-startup','--python-exit-code','1','-P',str(script)],
                            capture_output=True,text=True,timeout=120,check=False)
    assert result.returncode == 0, result.stdout + result.stderr
    print(result.stdout)
    return result.stdout


def test_every_visible_environment_mesh_has_bvh_and_opacity(tmp_path):
    source = f'''
import importlib.util, bpy, json
from mathutils import Vector
spec=importlib.util.spec_from_file_location('scene', {str(BUILD_SCENE)!r})
s=importlib.util.module_from_spec(spec); spec.loader.exec_module(s)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
material=bpy.data.materials.new('leaf'); material.use_nodes=True
material.node_tree.nodes['Principled BSDF'].inputs['Alpha'].default_value=.1
bpy.ops.mesh.primitive_plane_add(size=2, location=(0,0,1)); leaf=bpy.context.object
leaf.data.materials.append(material)
bpy.ops.mesh.primitive_cube_add(size=1, location=(0,0,3)); box=bpy.context.object
objects=[leaf,box]
bpy.context.view_layer.update()
tree=s.environment_tree(objects[1:] if {os.environ.get('H19_BREAK') == 'bvh'} else objects,bpy.context.evaluated_depsgraph_get(),opacity=True)
assert set(tree.contributions)=={{o.name for o in objects}}
assert sorted(tree.contributions.values())==[2,12]
origin,direction=Vector((0,0,0)),Vector((0,0,1))
hit=s.nearest_hit({{'static':tree}},origin,direction,10)
assert abs(hit[3]-2.5)<1e-4, hit
material.node_tree.nodes['Principled BSDF'].inputs['Alpha'].default_value=.8
# UV image opacity, white right / transparent left; sample at actual hit.
nodes=material.node_tree.nodes; links=material.node_tree.links
image=bpy.data.images.new('opacity',width=2,height=1)
image.pixels[:]=[0,0,0,1,1,1,1,1]
texture=nodes.new('ShaderNodeTexImage'); texture.image=image; texture.interpolation='Closest'
links.new(texture.outputs['Color'],nodes['Principled BSDF'].inputs['Alpha'])
bpy.context.view_layer.update()
tree=s.environment_tree(objects,bpy.context.evaluated_depsgraph_get(),opacity=True)
a=s.nearest_hit({{'static':tree}},Vector((-.25,0,0)),direction,10)
b=s.nearest_hit({{'static':tree}},Vector((.25,0,0)),direction,10)
assert abs(a[3]-2.5)<1e-4 and abs(b[3]-1)<1e-4, (a,b)
# Both sensor consumers must use the same transparent/opaque decision.
import numpy as np, math
camera=bpy.data.objects.new('sensor',bpy.data.cameras.new('sensor'))
bpy.context.scene.collection.objects.link(camera); camera.rotation_euler=(math.pi,0,0)
bpy.context.scene.render.resolution_x=bpy.context.scene.render.resolution_y=512
actor={{'track':'box','size':[1,1,1]}}
bpy.context.view_layer.update()
actor_tree,owner=s.actor_tree([(box,actor,None)])
frame={{'index':0,'T_world_lidar':np.eye(4).tolist()}}
layout={{'lidar':{{'elev_min_deg':90,'elev_max_deg':90,'rings':1,'azimuth_steps':1,'max_range_m':10}}}}
scenario={{'seed':0,'weather':{{'wetness':0,'paint_fade':0,'rain_drop_rate':0,'fog_density':0}}}}
measurements=[]
for alpha in (0,1):
    image.pixels[:]=[alpha,alpha,alpha,1]*2
    static=s.environment_tree([leaf],bpy.context.evaluated_depsgraph_get(),opacity=True)
    trees={{'static':static,'actor':actor_tree}}
    visible=s.visibility(camera,[(box,actor,None)],trees,owner)['box']
    lidar=s.lidar_scan(frame,layout,scenario,trees,np.zeros((1,1)),{{}})
    measurements.append((visible['visible'],float(lidar[0,2])))
assert measurements[0][0]>0 and measurements[1][0]==0, measurements
# Schema 1 deliberately includes Gaussian range noise; both runs share seed.
assert abs(measurements[0][1]-2.5)<.05 and abs(measurements[1][1]-1)<.05, measurements
assert abs(measurements[0][1]-measurements[1][1]-1.5)<1e-4, measurements
print('SENSORS_OPACITY',measurements)
print('INVARIANT_BVH_OPACITY '+json.dumps({{'meshes':len(tree.contributions),'triangles':sum(tree.contributions.values()),'transparent_distance':a[3],'opaque_distance':b[3]}}))
'''
    assert 'INVARIANT_BVH_OPACITY' in run_blender(tmp_path,source)


def test_normalizer_empty_and_generated_box(tmp_path):
    script = BUILD_SCENE.parent/'normalize_env_assets.py'
    source = f'''
import importlib.util, bpy, json, sys
from pathlib import Path
spec=importlib.util.spec_from_file_location('normalizer',{str(script)!r})
n=importlib.util.module_from_spec(spec); spec.loader.exec_module(n)
root=Path({str(tmp_path)!r}); catalog=root/'catalog.json'; manifest=root/'manifest.json'
catalog.write_text('[]'); sys.argv=['blender','--','--catalog',str(catalog),'--root',str(root),'--manifest',str(manifest)]
n.main(); assert json.loads(manifest.read_text())==[]
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
bpy.ops.mesh.primitive_cube_add(size=2,location=(4,5,6)); box=bpy.context.object; box.name='test_house'
bpy.data.libraries.write(str(root/'building.blend'),{{box}})
entry={asset(size=(2,2,2))!r}
result=n.normalize(entry,root,n.contracts())
assert result['native_size']==[2,2,2], result
assert result['polycount']==6
assert (root/result['file']).is_file()
# Exercise the production assets builder against the normalized synthetic model.
import shutil
fake=root/'backend'; env=fake/'assets/env'; (env/'normalized').mkdir(parents=True)
shutil.copy2(root/result['file'],env/result['file'])
(fake/'assets/env_manifest.json').write_text(json.dumps([result]))
helper=fake/'topeye/sim/env_assets.py'; helper.parent.mkdir(parents=True)
shutil.copy2({str(BUILD_SCENE.parents[1]/'env_assets.py')!r},helper)
scene_spec=importlib.util.spec_from_file_location('scene',{str(BUILD_SCENE)!r})
s=importlib.util.module_from_spec(scene_spec); scene_spec.loader.exec_module(s)
s.__file__=str(fake/'topeye/sim/blender/build_scene.py')
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
bpy.ops.mesh.primitive_plane_add(size=40); bpy.context.object.name='ground'
image=bpy.data.images.new('road',width=40,height=40)
image.pixels[:]=[0,0,0,1]*1600; image.filepath_raw=str(root/'road.png'); image.file_format='PNG'; image.save()
data={{'version':1,'scene':'test','buildings':[{{'polygon':[[-1,-1],[1,-1],[1,1],[-1,1]],'base_z':0,'height':2}}],
       'vegetation':[],'poles':[],'road_edges':[]}}
(root/'procedural.json').write_text(json.dumps(data))
layout={{'scene':'test','ground':{{'drivable':'road.png'}},'bounds':{{'xmin':-20,'ymin':-20,'xmax':20,'ymax':20}},'actors':[]}}
scenario={{'seed':7,'weather':{{'preset':'day'}}}}
objects=s.build_environment_assets(root,layout,scenario,(root,[]))
assert len(objects)==1, objects
bpy.context.view_layer.update()
tree=s.environment_tree(objects,bpy.context.evaluated_depsgraph_get(),opacity=True)
assert list(tree.contributions.values())==[12]
print('ASSETS_BOX_BVH '+json.dumps(tree.contributions))
print('NORMALIZER_BOX '+json.dumps(result))
'''
    assert 'NORMALIZER_BOX' in run_blender(tmp_path,source)


def test_real_manifest_entries():
    manifest_file = Path(__file__).resolve().parents[1] / 'assets/env_manifest.json'
    assert manifest_file.is_file(), 'env_manifest.json must exist'
    entries = json.loads(manifest_file.read_text())
    assert isinstance(entries, list)
    assert len(entries) >= 30, f'Expected >= 30 real environment assets, got {len(entries)}'

    env_root = Path(__file__).resolve().parents[1] / 'assets/env'
    for entry in entries:
        names = entry.get('mesh_names', []) + entry.get('material_names', [])
        validate_asset(entry, names)

        assert entry['contains_label_classes'] == []
        for n in names:
            assert not env_assets.label_name(n), f"Label breach: {entry['asset_id']} contains '{n}'"

        blend_path = env_root / entry['file']
        assert blend_path.is_file(), f'Missing normalized blend file: {blend_path}'
        assert entry['file'].startswith('normalized/')
        assert entry['file'].endswith('.blend')

        size = np.asarray(entry['native_size'])
        assert size.shape == (3,)
        assert (size > 0).all()
        assert entry['forward_axis'] == '+X'
        assert entry['up_axis'] == '+Z'
        assert entry['polycount'] > 0

        if entry['asset_id'] == 'island_tree_02':
            assert entry['polycount'] <= 300_000, f"Heavy tree not decimated: {entry['polycount']}"


def test_builder_rejects_forged_tree_collision_geometry(tmp_path):
    normalizer = BUILD_SCENE.parent / 'normalize_env_assets.py'
    source = f'''
import importlib.util, bpy, json, shutil
from pathlib import Path
def load(name, path):
    spec=importlib.util.spec_from_file_location(name,path)
    m=importlib.util.module_from_spec(spec); spec.loader.exec_module(m); return m
n=load('normalizer',{str(normalizer)!r}); s=load('scene',{str(BUILD_SCENE)!r})
root=Path({str(tmp_path)!r}); fake=root/'backend'; env=fake/'assets/env'; env.mkdir(parents=True)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
bpy.ops.mesh.primitive_cube_add(size=2,location=(0,0,1)); tree=bpy.context.object; tree.name='tree'
bpy.data.libraries.write(str(env/'tree.blend'),{{tree}})
entry=n.normalize({asset('tree', (2, 2, 2))!r},env,n.contracts())
helper=fake/'topeye/sim/env_assets.py'; helper.parent.mkdir(parents=True)
shutil.copy2({str(BUILD_SCENE.parents[1]/'env_assets.py')!r},helper)
(helper.parent/'blender').mkdir(); shutil.copy2({str(normalizer)!r},helper.parent/'blender/normalize_env_assets.py')
s.__file__=str(helper.parent/'blender/build_scene.py')
data={{'version':1,'scene':'test','buildings':[], 'vegetation':[{{'x':0,'y':0,'z':0,'height':2,'crown_radius':1}}], 'poles':[], 'road_edges':[]}}
(root/'procedural.json').write_text(json.dumps(data))
layout={{'scene':'test','ground':{{'drivable':'road.png'}},'bounds':{{'xmin':-20,'ymin':-20,'xmax':20,'ymax':20}},'actors':[]}}
image=bpy.data.images.new('road',width=40,height=40); image.pixels[:]=[0,0,0,1]*1600
image.filepath_raw=str(root/'road.png'); image.file_format='PNG'; image.save()
scenario={{'seed':7,'weather':{{'preset':'day'}}}}
for forged in (False,True):
    bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
    bpy.ops.mesh.primitive_plane_add(size=40); bpy.context.object.name='ground'
    if forged:
        entry['collision_parts'][0]['min'][0]+=.1
    (fake/'assets/env_manifest.json').write_text(json.dumps([entry]))
    try:
        objects=s.build_environment_assets(root,layout,scenario,(root,[]))
        assert not forged
        bpy.context.view_layer.update()
        tree=s.environment_tree(objects,bpy.context.evaluated_depsgraph_get(),opacity=True)
        assert sum(tree.contributions.values())==12
    except s.InputError as exc:
        assert forged and 'collision metadata' in str(exc), str(exc)
print('FORGED_TREE_REJECTED')
'''
    assert 'FORGED_TREE_REJECTED' in run_blender(tmp_path, source)


def test_instanced_bvh_nonuniform_scale_rotation_and_distance(tmp_path):
    source = f'''
import importlib.util, bpy
from mathutils import Vector
spec=importlib.util.spec_from_file_location('scene',{str(BUILD_SCENE)!r})
s=importlib.util.module_from_spec(spec); spec.loader.exec_module(s)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
bpy.ops.mesh.primitive_cube_add(size=2); first=bpy.context.object
first.location=(0,0,5); first.scale=(2,.5,3); first.rotation_euler.z=.6
second=first.copy(); bpy.context.scene.collection.objects.link(second)
second.location=(10,0,8); second.scale=(.5,2,1); second.rotation_euler.z=-.8
bpy.context.view_layer.update(); deps=bpy.context.evaluated_depsgraph_get()
tree=s.environment_tree([first,second],deps,opacity=True)
assert len(tree.contributions)==2 and sum(tree.contributions.values())==24
assert tree.instances[0][0] is tree.instances[1][0], 'identical mesh data must share local BVH'
reference=s._environment_tree([first,second],deps,opacity=True)
for x,expected in ((0,2),(10,7)):
    o,d=Vector((x,0,0)),Vector((0,0,1))
    hit=tree.ray_cast(o,d,20); old=reference.ray_cast(o,d,20)
    assert abs(hit[3]-expected)<1e-5 and abs(old[3]-hit[3])<1e-5, (hit,old)
    assert (hit[0]-old[0]).length<1e-5 and (hit[1]-old[1]).length<1e-5
    assert tree.ray_cast(o,d,expected-.1)[0] is None
assert tree.ray_cast(Vector((30,0,0)),Vector((0,0,1)),20)[0] is None
print('INSTANCE_SCALE_DISTANCE_MATCH')
'''
    assert 'INSTANCE_SCALE_DISTANCE_MATCH' in run_blender(tmp_path, source)
