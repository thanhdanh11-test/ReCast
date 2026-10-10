"""Local S15 visual pilot. Run with Blender -b --python-exit-code 1 -P this_file.

Preserves source layout/procedural and prior runs. Re-run requires a new --name.
"""
import argparse
import importlib.util
import json
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--scene', default='scene-0061')
    parser.add_argument('--name', default='lookdev_s15')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    if any(not value or any(c not in 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-' for c in value)
           for value in (args.scene, args.name)):
        raise ValueError('invalid scene/run name')
    backend = Path(__file__).resolve().parents[1]
    directory = backend / 'data/sim' / args.scene
    out = directory / 'runs' / args.name
    if out.exists():
        raise FileExistsError(f'Preserve prior evidence; choose a new --name: {out}')
    out.mkdir(parents=True)
    layout = json.loads((directory / 'layout.json').read_text())
    data = json.loads((directory / 'procedural.json').read_text())
    data['facade_completion'] = True
    (out / 'procedural.json').write_text(json.dumps(data))
    layout.setdefault('photo', {})['procedural'] = f'runs/{args.name}/procedural.json'
    layout_path = directory / f'layout.{args.name}.json'
    layout_path.write_text(json.dumps(layout))
    scenario = out / 'scenario.toml'
    scenario.write_text(f'''schema = 2
name = "{args.name}"
seed = 0
engine = "cycles"
samples = 32
frames = [0, 20]
cameras = ["CAM_FRONT", "CAM_FRONT_RIGHT"]
resolution_scale = 1.0
environment = "assets"
export_web_env = false
[weather]
preset = "day"
cloudiness = 15.0
sun_azimuth_angle = 30.0
sun_altitude_angle = 45.0
fog_density = 0.0
[traffic]
mode = "replay"
color_randomization = false
''')
    path = backend / 'topeye/sim/blender/build_scene.py'
    spec = importlib.util.spec_from_file_location('scene_builder', path)
    scene = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(scene)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    code = scene.selftest(layout, out / 'selftest')
    if code:
        return code
    bpy.ops.wm.read_factory_settings(use_empty=True)
    code = scene.run(layout_path, scenario, out, True, False, out / 'scene.blend')
    if code:
        return code
    # Independent angle near the first capture; uses the same full 3D scene.
    camera = bpy.context.scene.camera
    scene.apply_camera(camera, layout['frames'][0]['cameras']['CAM_FRONT']['blender'], 1.0)
    origin = camera.location.copy()
    forward = camera.matrix_world.to_quaternion() @ Vector((0, 0, -1))
    right = camera.matrix_world.to_quaternion() @ Vector((1, 0, 0))
    camera.location = origin - forward * 8 + right * 8 + Vector((0, 0, 10))
    target = origin + forward * 20
    camera.rotation_euler = (target - camera.location).to_track_quat('-Z', 'Y').to_euler()
    bpy.context.scene.render.filepath = str(out / 'freeview.png')
    bpy.ops.render.render(write_still=True)
    print('LOOKDEV_COMPLETE ' + str(out), flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
