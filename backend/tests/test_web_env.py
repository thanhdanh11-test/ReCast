"""Web environment transport and scenario boundary regression tests."""
import json
import threading
from urllib.error import HTTPError
from urllib.request import urlopen

import pytest

from topeye.sim.cli import InputError, check_scenario
from topeye.sim.view import make_server


@pytest.mark.parametrize('value', ['true', 'false'])
def test_web_export_flag(tmp_path, value):
    path = tmp_path / 'scenario.toml'
    path.write_text(f'schema=2\nname="test"\nenvironment="procedural"\nexport_web_env={value}\n')
    assert check_scenario(path)['export_web_env'] is (value == 'true')


@pytest.mark.parametrize('value', ['1', '0', '"true"', '[]'])
def test_web_export_flag_rejects_non_boolean(tmp_path, value):
    path = tmp_path / 'scenario.toml'
    path.write_text(f'schema=2\nname="test"\nexport_web_env={value}\n')
    with pytest.raises(InputError, match='export_web_env'):
        check_scenario(path)


def test_environment_transport_and_missing_fallback(tmp_path):
    root = tmp_path / 'sim'
    directory = root / 'scene-0061'
    run = directory / 'runs' / 'day_proc'
    run.mkdir(parents=True)
    (directory / 'layout.json').write_text('{}')
    (run / 'run.json').write_text(json.dumps({'frames': [0], 'environment_glb': True}))
    server = make_server(root, port=0)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f'http://127.0.0.1:{server.server_port}'
    try:
        with urlopen(base + '/api/scene/scene-0061') as response:
            assert json.load(response)['runs'][0]['environment_glb'] is False
        data = b'glTF-test'
        (run / 'environment.glb').write_bytes(data)
        with urlopen(base + '/api/scene/scene-0061') as response:
            assert json.load(response)['runs'][0]['environment_glb'] is True
        with urlopen(base + '/scene-0061/runs/day_proc/environment.glb') as response:
            assert response.headers['Content-Type'] == 'model/gltf-binary'
            assert response.read() == data
        outside = tmp_path / 'private.glb'
        outside.write_bytes(b'private')
        (run / 'escape.glb').symlink_to(outside)
        with pytest.raises(HTTPError) as error:
            urlopen(base + '/scene-0061/runs/day_proc/escape.glb')
        assert error.value.code == 404
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


def test_blender_export_isolated_evaluated_geometry(tmp_path):
    import os
    import struct
    import subprocess

    from topeye.sim.cli import BUILD_SCENE

    script = tmp_path / 'export_probe.py'
    script.write_text('''import bpy, json, runpy
from pathlib import Path
from mathutils import Vector
module = runpy.run_path(BUILD_SCENE)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.mesh.primitive_cube_add(location=(10, 20, 30))
source = bpy.context.object
source.name = "environment_building"
source.modifiers.new("subdivision", "SUBSURF").levels = 1
material = bpy.data.materials.new("web_material")
material.use_nodes = True
image = bpy.data.images.new("large", width=2048, height=1024)
image.generated_color = (.2, .5, .1, 1)
node = material.node_tree.nodes.new("ShaderNodeTexImage")
node.image = image
material.node_tree.links.new(node.outputs["Color"], material.node_tree.nodes["Principled BSDF"].inputs["Base Color"])
source.data.materials.append(material)
bpy.ops.mesh.primitive_cube_add()
actor = bpy.context.object
actor.name = "actor_car"
bpy.ops.object.camera_add()
bpy.ops.object.light_add(type="POINT")
collection = bpy.data.collections.new("tree_collection")
tree = bpy.data.objects.new("tree_instance", actor.data.copy())
collection.objects.link(tree)
instancer = bpy.data.objects.new("environment_instance", None)
instancer.instance_type = "COLLECTION"
instancer.instance_collection = collection
instancer.location = (40, 50, 60)
bpy.context.scene.collection.objects.link(instancer)
bpy.context.view_layer.update()
original_scene = bpy.context.scene
stats = module["export_web_environment"]([source, instancer], Path(OUT))
assert bpy.context.scene == original_scene
assert len(source.data.vertices) == 8 and len(source.modifiers) == 1
assert tuple(image.size) == (2048, 1024)
assert source.data.materials[0] == material
assert actor.name in bpy.context.scene.objects
assert stats["environment_triangles"] > 12
Path(OUT, "stats.json").write_text(json.dumps(stats))
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(Path(OUT, "environment.glb")))
objects = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
assert len(objects) == 2
obj = next(obj for obj in objects if "building" in obj.name)
center = sum((obj.matrix_world @ Vector(v) for v in obj.bound_box), Vector()) / 8
assert (center - Vector((10,20,30))).length < .001
'''.replace('BUILD_SCENE', repr(str(BUILD_SCENE))).replace('OUT', repr(str(tmp_path))))
    if os.environ.get('H23_BREAK') == 'actor':
        script.write_text(script.read_text().replace('[source, instancer], Path(', '[source, instancer, actor], Path('))
    result = subprocess.run(['/Applications/Blender.app/Contents/MacOS/Blender', '-b',
                             '--python-exit-code', '1', '--python', str(script)],
                            capture_output=True, text=True, timeout=120, check=False)
    assert result.returncode == 0, result.stdout + result.stderr
    data = (tmp_path / 'environment.glb').read_bytes()
    length = struct.unpack_from('<I', data, 12)[0]
    document = json.loads(data[20:20 + length])
    names = [node.get('name', '') for node in document['nodes']]
    assert not any('actor' in name or 'Camera' in name or 'Light' in name for name in names)
    triangles = sum(document['accessors'][p['indices']]['count'] // 3
                    for mesh in document['meshes'] for p in mesh['primitives'])
    assert 12 < triangles <= 1_500_000
    import cv2
    import numpy as np

    binary = data[28 + length:]
    for image in document.get('images', []):
        view = document['bufferViews'][image['bufferView']]
        start = view.get('byteOffset', 0)
        decoded = cv2.imdecode(np.frombuffer(binary[start:start + view['byteLength']], dtype=np.uint8),
                               cv2.IMREAD_UNCHANGED)
        assert decoded is not None and max(decoded.shape[:2]) <= 1024
    assert len(data) <= 150_000_000
