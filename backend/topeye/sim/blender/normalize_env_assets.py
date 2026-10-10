"""Normalize local S12 environment assets; Blender -b -P this_file -- [--catalog JSON]."""
import argparse
import importlib.util
import json
import math
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix, Vector


def contracts():
    path = Path(__file__).resolve().parents[1] / 'env_assets.py'
    spec = importlib.util.spec_from_file_location('env_contracts', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def import_model(path):
    before = set(bpy.data.objects)
    if path.suffix.lower() == '.blend':
        with bpy.data.libraries.load(str(path), link=False) as (source, target):
            target.objects = source.objects
        for obj in target.objects:
            if obj is not None:
                bpy.context.scene.collection.objects.link(obj)
    elif path.suffix.lower() in ('.glb', '.gltf'):
        bpy.ops.import_scene.gltf(filepath=str(path))
    elif path.suffix.lower() == '.obj':
        bpy.ops.wm.obj_import(filepath=str(path))
    elif path.suffix.lower() == '.fbx':
        bpy.ops.import_scene.fbx(filepath=str(path))
    else:
        raise ValueError('unsupported environment format')
    return list(set(bpy.data.objects) - before)


def collision_metadata(objects, rules):
    """Measure evaluated geometry, including modifiers, in normalized space."""
    triangles = []
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    for obj in objects:
        if obj.type != 'MESH':
            continue
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        try:
            mesh.calc_loop_triangles()
            points = np.asarray([(evaluated.matrix_world @ v.co)[:] for v in mesh.vertices])
            indices = np.asarray([t.vertices[:] for t in mesh.loop_triangles], dtype=int)
            if len(indices):
                triangles.append(points[indices])
        finally:
            evaluated.to_mesh_clear()
    if not triangles:
        raise ValueError('tree has no evaluated triangles')
    return rules.collision_geometry(np.concatenate(triangles))


def assemble_facade_building(objects, kind='factory'):
    """Assemble modular facade pieces into a complete 4-walled building."""
    meshes = [o for o in objects if o.type == 'MESH']
    if kind == 'factory':
        # Select standard facade bay between X=1 and X=23
        wall_objs = []
        for o in meshes:
            pts = [o.matrix_world @ v.co for v in o.data.vertices]
            if pts and min(p.x for p in pts) >= 0.5 and max(p.x for p in pts) <= 23.5:
                wall_objs.append(o)
    else:  # apartments
        wall_objs = []
        for o in meshes:
            pts = [o.matrix_world @ v.co for v in o.data.vertices]
            if pts and min(p.x for p in pts) >= 0.0 and max(p.x for p in pts) <= 22.5:
                wall_objs.append(o)

    if not wall_objs:
        return objects

    for o in list(objects):
        if o not in wall_objs:
            bpy.data.objects.remove(o, do_unlink=True)

    pts = np.asarray([(o.matrix_world @ v.co)[:] for o in wall_objs for v in o.data.vertices])
    min_x, max_x = pts[:, 0].min(), pts[:, 0].max()
    min_z = pts[:, 2].min()
    w = max_x - min_x
    center_x = (min_x + max_x) / 2
    half_w = w / 2

    walls = [wall_objs]
    for _ in range(3):
        dup_objs = []
        for orig in wall_objs:
            dup = orig.copy()
            dup.data = orig.data.copy()
            bpy.context.scene.collection.objects.link(dup)
            dup_objs.append(dup)
        walls.append(dup_objs)

    offsets = [
        (0, -half_w, 0),
        (-half_w, 0, np.pi / 2),
        (0, half_w, np.pi),
        (half_w, 0, 3 * np.pi / 2),
    ]

    for wall_idx, (dx, dy, yaw) in enumerate(offsets):
        rot = Matrix.Rotation(yaw, 4, 'Z')
        for o in walls[wall_idx]:
            pts_local = [(o.matrix_world @ v.co) for v in o.data.vertices]
            o.parent = None
            o.matrix_world = Matrix.Identity(4)
            for v, p in zip(o.data.vertices, pts_local):
                local = Vector((p.x - center_x, p.y, p.z - min_z))
                v.co = rot @ local + Vector((dx, dy, 0))

    return [o for o in bpy.data.objects if o.type == 'MESH']


def assemble_apartment_block(objects, bays_x, bays_y, floors):
    """Tile the existing CC0 three-metre bays, preserving doors/window scale."""
    by_name = {o.name: o for o in objects if o.type == 'MESH'}
    names = ('wall_window_centered_large_02', 'window_centered_large_02',
             'wall_door_centered_large_01', 'door_centered_large_01',
             'cornice_standard_standard_01', 'crown_standard_standard_01')
    if any(name not in by_name for name in names):
        raise ValueError('apartment facade kit is incomplete')
    output = []
    width, depth = bays_x * 3., bays_y * 3.

    def tile(name, offset, yaw, shift):
        original = by_name[name]
        obj = original.copy(); obj.data = original.data.copy()
        obj.parent = None
        obj.matrix_world = Matrix.Identity(4)
        rotation = Matrix.Rotation(yaw, 4, 'Z')
        for v, source in zip(obj.data.vertices, original.data.vertices):
            point = original.matrix_world @ source.co - Vector(offset)
            v.co = rotation @ point + Vector(shift)
        bpy.context.scene.collection.objects.link(obj)
        output.append(obj)

    sides = ((bays_x, 0., (-width/2, -depth/2)),
             (bays_y, math.pi/2, (width/2, -depth/2)),
             (bays_x, math.pi, (width/2, depth/2)),
             (bays_y, -math.pi/2, (-width/2, depth/2)))
    for count, yaw, (x, y) in sides:
        for bay in range(count):
            shift = (x + (bay+1)*3*math.cos(yaw), y + (bay+1)*3*math.sin(yaw))
            for floor in range(floors):
                pair = names[2:4] if floor == 0 and bay == count//2 else names[:2]
                for name in pair:
                    tile(name, (11, 0, 0 if name in names[2:4] else 8), yaw, (*shift, floor*3))
                tile(names[4], (0, 0, 3.4), yaw, (*shift, (floor+1)*3-.2))
            tile(names[5], (0, 0, 4), yaw, (*shift, floors*3))
    # Close the roof; facade bays are deliberately open on their backs.
    bpy.ops.mesh.primitive_cube_add(size=1, location=(0, 0, floors*3-.1))
    roof = bpy.context.object; roof.name = 'apartment_roof'
    roof.dimensions = (width, depth, .2)
    material = bpy.data.materials.new('apartment_roof_concrete'); material.use_nodes = True
    shader = material.node_tree.nodes.get('Principled BSDF')
    shader.inputs['Base Color'].default_value = (.18, .19, .20, 1)
    shader.inputs['Roughness'].default_value = .85
    roof.data.materials.append(material)
    output.append(roof)
    for obj in objects:
        bpy.data.objects.remove(obj, do_unlink=True)
    bpy.context.view_layer.update()
    return output


def normalize(entry, root, rules):
    path = (root / entry['file']).resolve()
    if not path.is_relative_to(root.resolve()) or not path.is_file():
        raise ValueError('missing/unsafe environment file')
    objects = import_model(path)

    if 'mesh_filter' in entry:
        allowed = set(entry['mesh_filter'])
        for o in list(objects):
            if o.name not in allowed:
                bpy.data.objects.remove(o, do_unlink=True)
                objects.remove(o)
    elif 'prefix_filter' in entry:
        prefix = entry['prefix_filter']
        for o in list(objects):
            if not o.name.startswith(prefix):
                bpy.data.objects.remove(o, do_unlink=True)
                objects.remove(o)

    if entry.get('assembly') in ('facade_factory', 'facade_apartments'):
        objects = assemble_facade_building(objects, 'factory' if 'factory' in entry['assembly'] else 'apartments')
    elif entry.get('assembly') == 'apartment_block':
        objects = assemble_apartment_block(objects, *entry['block_bays_floors'])

    meshes = [o for o in objects if o.type == 'MESH']

    ratio = float(entry.get('decimate_ratio', 1.0))
    if 0 < ratio < 1.0:
        for o in meshes:
            mod = o.modifiers.new(name='Decimate', type='DECIMATE')
            mod.ratio = ratio
            bpy.context.view_layer.objects.active = o
            bpy.ops.object.modifier_apply(modifier=mod.name)

    names = [o.name for o in meshes] + [m.name for o in meshes for m in o.data.materials if m]
    if entry.get('contains_label_classes') != [] or any(rules.label_name(n) for n in names):
        raise ValueError('environment contains label classes')

    axes = {'+X': Vector((1, 0, 0)), '-X': Vector((-1, 0, 0)),
            '+Y': Vector((0, 1, 0)), '-Y': Vector((0, -1, 0)),
            '+Z': Vector((0, 0, 1)), '-Z': Vector((0, 0, -1))}
    up = axes[entry.get('up_axis', '+Z')]
    forward = axes[entry.get('forward_axis', '+X')]
    if abs(up.dot(forward)) > .01:
        raise ValueError('parallel asset axes')
    rotation = Matrix((forward, up.cross(forward), up)).to_4x4()
    factor = float(entry.get('unit_scale_m', 1))
    if not np.isfinite(factor) or factor <= 0:
        raise ValueError('invalid unit_scale_m')

    transforms = {obj: obj.matrix_world.copy() for obj in meshes}
    for obj in objects:
        if obj.type != 'MESH':
            bpy.data.objects.remove(obj, do_unlink=True)

    bottom = min((rotation @ (transforms[o] @ v.co) * factor).z for o in meshes for v in o.data.vertices)
    kept = []
    for obj in meshes:
        points = [rotation @ (transforms[obj] @ v.co) * factor for v in obj.data.vertices]
        if not points:
            bpy.data.objects.remove(obj, do_unlink=True)
            continue
        size = np.ptp(np.asarray([p[:] for p in points]), axis=0)
        if (size[2] < .02 and min(p.z for p in points) <= bottom + .02
                and any(n in obj.name.lower() for n in ('ground', 'floor', 'plane'))):
            bpy.data.objects.remove(obj, do_unlink=True)
            continue
        obj.parent = None
        obj.matrix_world = Matrix.Identity(4)
        for vertex, point in zip(obj.data.vertices, points):
            vertex.co = point
        kept.append(obj)

    if not kept:
        raise ValueError('environment has no geometry')

    points = np.asarray([v.co[:] for o in kept for v in o.data.vertices])
    low, high = points.min(0), points.max(0)
    center = Vector(((low[0] + high[0]) / 2, (low[1] + high[1]) / 2, low[2]))
    for obj in kept:
        for vertex in obj.data.vertices:
            vertex.co -= center

    result = {k: entry[k] for k in rules.REQUIRED if k in entry}
    result.update(native_size=(high - low).tolist(), forward_axis='+X', up_axis='+Z',
                  polycount=sum(len(o.data.polygons) for o in kept), mesh_names=[o.name for o in kept],
                  material_names=[m.name for o in kept for m in o.data.materials if m])
    if 'contains_label_classes' not in result:
        result['contains_label_classes'] = []
    if result['kind'] == 'tree':
        result.update(collision_metadata(kept, rules))

    destination = root / 'normalized' / f"{entry['asset_id']}.blend"
    if not destination.resolve().is_relative_to((root / 'normalized').resolve()):
        raise ValueError('unsafe asset_id')
    destination.parent.mkdir(parents=True, exist_ok=True)
    result['file'] = destination.relative_to(root).as_posix()
    rules.validate_asset(result, result['mesh_names'] + result['material_names'])
    bpy.ops.file.pack_all()
    bpy.data.libraries.write(str(destination), set(kept), fake_user=True)
    return result


def render_thumbnail(objects, out_path, size=256):
    """Render a 256x256 thumbnail of normalized objects."""
    pts = np.asarray([v.co[:] for o in objects for v in o.data.vertices])
    if not len(pts):
        return
    low, high = pts.min(0), pts.max(0)
    center = (low + high) / 2
    extent = float(np.max(high - low))
    dist = max(extent * 1.8, 1.5)

    cam_data = bpy.data.cameras.new("ThumbCam")
    cam_obj = bpy.data.objects.new("ThumbCam", cam_data)
    bpy.context.scene.collection.objects.link(cam_obj)
    bpy.context.scene.camera = cam_obj

    elev = math.radians(25)
    azim = math.radians(45)
    cx = center[0] + dist * math.cos(elev) * math.cos(azim)
    cy = center[1] - dist * math.cos(elev) * math.sin(azim)
    cz = center[2] + dist * math.sin(elev)
    cam_obj.location = Vector((cx, cy, cz))

    direction = Vector(center) - cam_obj.location
    cam_obj.rotation_euler = direction.to_track_quat('-Z', 'Y').to_euler()

    light_data = bpy.data.lights.new("Sun", type='SUN')
    light_data.energy = 3.5
    light_obj = bpy.data.objects.new("Sun", light_data)
    light_obj.rotation_euler = (math.radians(45), math.radians(30), math.radians(45))
    bpy.context.scene.collection.objects.link(light_obj)

    fill_data = bpy.data.lights.new("Fill", type='SUN')
    fill_data.energy = 1.5
    fill_obj = bpy.data.objects.new("Fill", fill_data)
    fill_obj.rotation_euler = (math.radians(-30), math.radians(-45), math.radians(120))
    bpy.context.scene.collection.objects.link(fill_obj)

    bpy.context.scene.render.engine = 'BLENDER_EEVEE'
    bpy.context.scene.render.resolution_x = size
    bpy.context.scene.render.resolution_y = size
    bpy.context.scene.render.filepath = str(out_path)

    bpy.ops.render.render(write_still=True)

    bpy.data.objects.remove(cam_obj, do_unlink=True)
    bpy.data.objects.remove(light_obj, do_unlink=True)
    bpy.data.objects.remove(fill_obj, do_unlink=True)
    bpy.data.cameras.remove(cam_data)
    bpy.data.lights.remove(light_data)
    bpy.data.lights.remove(fill_data)


def build_default_catalog():
    """Return catalog specifications for all 36 local S12 environment models."""
    entries = [
        # Polyhaven (17 items)
        {
            "asset_id": "fire_hydrant",
            "kind": "prop",
            "file": "polyhaven/fire_hydrant/fire_hydrant_1k.gltf",
            "author": "Gonçalo Felício",
            "license": "CC0",
            "source_url": "https://polyhaven.com/a/fire_hydrant",
            "unit_scale_m": 1.0,
        },
        {
            "asset_id": "metal_trash_can",
            "kind": "prop",
            "file": "polyhaven/metal_trash_can/metal_trash_can_1k.gltf",
            "author": "GurJas Studios",
            "license": "CC0",
            "source_url": "https://polyhaven.com/a/metal_trash_can",
            "unit_scale_m": 1.0,
        },
        {
            "asset_id": "planter_box_01",
            "kind": "prop",
            "file": "polyhaven/planter_box_01/planter_box_01_1k.gltf",
            "author": "James Ray Cock",
            "license": "CC0",
            "source_url": "https://polyhaven.com/a/planter_box_01",
            "unit_scale_m": 1.0,
        },
        {
            "asset_id": "utility_box_01",
            "kind": "prop",
            "file": "polyhaven/utility_box_01/utility_box_01_1k.gltf",
            "author": "James Ray Cock",
            "license": "CC0",
            "source_url": "https://polyhaven.com/a/utility_box_01",
            "unit_scale_m": 1.0,
        },
        {
            "asset_id": "utility_box_02",
            "kind": "prop",
            "file": "polyhaven/utility_box_02/utility_box_02_1k.gltf",
            "author": "James Ray Cock",
            "license": "CC0",
            "source_url": "https://polyhaven.com/a/utility_box_02",
            "unit_scale_m": 1.0,
        },
        {
            "asset_id": "street_lamp_01",
            "kind": "lamp",
            "file": "polyhaven/street_lamp_01/street_lamp_01_1k.gltf",
            "author": "Josh Dean",
            "license": "CC0",
            "source_url": "https://polyhaven.com/a/street_lamp_01",
            "unit_scale_m": 1.0,
        },
        {
            "asset_id": "street_lamp_02",
            "kind": "lamp",
            "file": "polyhaven/street_lamp_02/street_lamp_02_1k.gltf",
            "author": "Josh Dean",
            "license": "CC0",
            "source_url": "https://polyhaven.com/a/street_lamp_02",
            "unit_scale_m": 1.0,
        },
        {
            "asset_id": "shrub_02",
            "kind": "tree",
            "file": "polyhaven/shrub_02/shrub_02_1k.gltf",
            "author": "Rico Cilliers",
            "license": "CC0",
            "source_url": "https://polyhaven.com/a/shrub_02",
            "unit_scale_m": 1.0,
        },
        {
            "asset_id": "shrub_03",
            "kind": "tree",
            "file": "polyhaven/shrub_03/shrub_03_1k.gltf",
            "author": "Rico Cilliers",
            "license": "CC0",
            "source_url": "https://polyhaven.com/a/shrub_03",
            "unit_scale_m": 1.0,
        },
        {
            "asset_id": "shrub_04",
            "kind": "tree",
            "file": "polyhaven/shrub_04/shrub_04_1k.gltf",
            "author": "Rico Cilliers",
            "license": "CC0",
            "source_url": "https://polyhaven.com/a/shrub_04",
            "unit_scale_m": 1.0,
        },
        {
            "asset_id": "island_tree_02",
            "kind": "tree",
            "file": "polyhaven/island_tree_02/island_tree_02_1k.gltf",
            "author": "Rob Tuytel, Rico Cilliers",
            "license": "CC0",
            "source_url": "https://polyhaven.com/a/island_tree_02",
            "unit_scale_m": 1.0,
            "decimate_ratio": 0.25,
        },
        {
            "asset_id": "modular_street_seating",
            "kind": "prop",
            "file": "polyhaven/modular_street_seating/modular_street_seating_1k.gltf",
            "author": "Stuart Attenborrow",
            "license": "CC0",
            "source_url": "https://polyhaven.com/a/modular_street_seating",
            "mesh_filter": [
                "seat", "seat_back", "back_support_l", "back_support_r",
                "arm_rest_01", "arm_rest_02", "legs_single", "legs_double",
                "crossbar", "suspended_support_01",
            ],
            "unit_scale_m": 1.0,
        },
        {
            "asset_id": "modular_electricity_poles_preset_01",
            "kind": "prop",
            "file": "polyhaven/modular_electricity_poles/modular_electricity_poles_1k.gltf",
            "author": "James Ray Cock",
            "license": "CC0",
            "source_url": "https://polyhaven.com/a/modular_electricity_poles",
            "prefix_filter": "preset_01_",
            "unit_scale_m": 1.0,
        },
        {
            "asset_id": "modular_electricity_poles_preset_02",
            "kind": "prop",
            "file": "polyhaven/modular_electricity_poles/modular_electricity_poles_1k.gltf",
            "author": "James Ray Cock",
            "license": "CC0",
            "source_url": "https://polyhaven.com/a/modular_electricity_poles",
            "prefix_filter": "preset_02_",
            "unit_scale_m": 1.0,
        },
        {
            "asset_id": "modular_electricity_poles_preset_03",
            "kind": "prop",
            "file": "polyhaven/modular_electricity_poles/modular_electricity_poles_1k.gltf",
            "author": "James Ray Cock",
            "license": "CC0",
            "source_url": "https://polyhaven.com/a/modular_electricity_poles",
            "prefix_filter": "preset_03_",
            "unit_scale_m": 1.0,
        },
        {
            "asset_id": "modular_factory_facade",
            "kind": "building",
            "file": "polyhaven/modular_factory_facade/modular_factory_facade_1k.gltf",
            "author": "James Ray Cock",
            "license": "CC0",
            "source_url": "https://polyhaven.com/a/modular_factory_facade",
            "assembly": "facade_factory",
            "unit_scale_m": 1.0,
        },
        {
            "asset_id": "modular_urban_apartments_facade",
            "kind": "building",
            "file": "polyhaven/modular_urban_apartments_facade/modular_urban_apartments_facade_1k.gltf",
            "author": "James Ray Cock",
            "license": "CC0",
            "source_url": "https://polyhaven.com/a/modular_urban_apartments_facade",
            "assembly": "facade_apartments",
            "unit_scale_m": 1.0,
        },
        # Sketchfab (19 items)
        {
            "asset_id": "building_582936c8eac641a885343e91766e71b1",
            "kind": "building",
            "file": "sketchfab/building_582936c8eac641a885343e91766e71b1.glb",
            "author": "ngdkh",
            "license": "CC-BY",
            "source_url": "https://sketchfab.com/3d-models/vietnamese-house-in-2000s-582936c8eac641a885343e91766e71b1",
            "unit_scale_m": 1.0,
        },
        {
            "asset_id": "building_7bbb52c44c13460eaa0892b44955c87f",
            "kind": "building",
            "file": "sketchfab/building_7bbb52c44c13460eaa0892b44955c87f.glb",
            "author": "nguyenhoanglam20100609",
            "license": "CC-BY",
            "source_url": "https://sketchfab.com/3d-models/vietnamese-house-7bbb52c44c13460eaa0892b44955c87f",
            "unit_scale_m": 100.0,
        },
        {
            "asset_id": "building_56fed4ab37084fbfaaff6beaddf71a15",
            "kind": "building",
            "file": "sketchfab/building_56fed4ab37084fbfaaff6beaddf71a15.glb",
            "author": "Tyler_Dave",
            "license": "CC-BY",
            "source_url": "https://sketchfab.com/3d-models/chung-cu-bau-cat-2-bau-cat-2-apartment-56fed4ab37084fbfaaff6beaddf71a15",
            "unit_scale_m": 0.1,
        },
        {
            "asset_id": "building_335732e069d64197b22cf1093900430e",
            "kind": "building",
            "file": "sketchfab/building_335732e069d64197b22cf1093900430e.glb",
            "author": "WandShD",
            "license": "CC-BY",
            "source_url": "https://sketchfab.com/3d-models/small-house-in-denhung-cantho-vietnam-335732e069d64197b22cf1093900430e",
            "unit_scale_m": 0.01,
        },
        {
            "asset_id": "building_1f341f8261af4fb6a0dc910c2aae37a6",
            "kind": "building",
            "file": "sketchfab/building_1f341f8261af4fb6a0dc910c2aae37a6.glb",
            "author": "aitortilla01",
            "license": "CC-BY",
            "source_url": "https://sketchfab.com/3d-models/low-rise-wall-to-wall-office-building-1f341f8261af4fb6a0dc910c2aae37a6",
            "unit_scale_m": 0.01,
        },
        {
            "asset_id": "building_dcf171dca9174000a0fa8d44660253d0",
            "kind": "building",
            "file": "sketchfab/building_dcf171dca9174000a0fa8d44660253d0.glb",
            "author": "aitortilla01",
            "license": "CC-BY",
            "source_url": "https://sketchfab.com/3d-models/low-rise-wall-to-wall-office-building-dcf171dca9174000a0fa8d44660253d0",
            "unit_scale_m": 0.01,
        },
        {
            "asset_id": "building_de108d40c0694250911352bbcb662c33",
            "kind": "building",
            "file": "sketchfab/building_de108d40c0694250911352bbcb662c33.glb",
            "author": "jeremy1983",
            "license": "CC-BY",
            "source_url": "https://sketchfab.com/3d-models/60-spore-shophouse-de108d40c0694250911352bbcb662c33",
            "unit_scale_m": 10.0,
        },
        {
            "asset_id": "building_d961a0b9700a4ffca37d281e74113694",
            "kind": "building",
            "file": "sketchfab/building_d961a0b9700a4ffca37d281e74113694.glb",
            "author": "clatrence",
            "license": "CC-BY",
            "source_url": "https://sketchfab.com/3d-models/colonial-crossroads1800s-shophouse-game-asset-d961a0b9700a4ffca37d281e74113694",
            "unit_scale_m": 1.0,
        },
        {
            "asset_id": "building_c4a3993ef1e84e6d9d5a15c78da88aae",
            "kind": "building",
            "file": "sketchfab/building_c4a3993ef1e84e6d9d5a15c78da88aae.glb",
            "author": "99.Miles",
            "license": "CC-BY",
            "source_url": "https://sketchfab.com/3d-models/realistic-chicago-buildings-c4a3993ef1e84e6d9d5a15c78da88aae",
            "unit_scale_m": 1.0,
        },
        {
            "asset_id": "building_75876ad5f6bf4a30baa71673c303213d",
            "kind": "building",
            "file": "sketchfab/building_75876ad5f6bf4a30baa71673c303213d.glb",
            "author": "Zambur",
            "license": "CC-BY",
            "source_url": "https://sketchfab.com/3d-models/buildings-front-75876ad5f6bf4a30baa71673c303213d",
            "unit_scale_m": 1.0,
        },
        {
            "asset_id": "building_d96380fb001345cca9a9be121f3e43d5",
            "kind": "building",
            "file": "sketchfab/building_d96380fb001345cca9a9be121f3e43d5.glb",
            "author": "99.Miles",
            "license": "CC-BY",
            "source_url": "https://sketchfab.com/3d-models/free-atlanta-corperate-office-building-d96380fb001345cca9a9be121f3e43d5",
            "unit_scale_m": 1.0,
        },
        {
            "asset_id": "prop_862dec14911845679e3dd0298efbeec3",
            "kind": "prop",
            "file": "sketchfab/prop_862dec14911845679e3dd0298efbeec3.glb",
            "author": "ngdkh",
            "license": "CC-BY",
            "source_url": "https://sketchfab.com/3d-models/electric-pole-862dec14911845679e3dd0298efbeec3",
            "unit_scale_m": 1.0,
        },
        {
            "asset_id": "prop_838358343f2a4a7e82cff10326207902",
            "kind": "prop",
            "file": "sketchfab/prop_838358343f2a4a7e82cff10326207902.glb",
            "author": "ngdkh",
            "license": "CC-BY",
            "source_url": "https://sketchfab.com/3d-models/vietnam-electric-pole-838358343f2a4a7e82cff10326207902",
            "unit_scale_m": 10.0,
        },
        {
            "asset_id": "prop_f45b8dfd3a874779ac18323399a10258",
            "kind": "prop",
            "file": "sketchfab/prop_f45b8dfd3a874779ac18323399a10258.glb",
            "author": "ngdkh",
            "license": "CC-BY",
            "source_url": "https://sketchfab.com/3d-models/banhmi-cart-f45b8dfd3a874779ac18323399a10258",
            "unit_scale_m": 0.5,
        },
        {
            "asset_id": "prop_367bdb5ca8c745978410c6e3ffd9b910",
            "kind": "prop",
            "file": "sketchfab/prop_367bdb5ca8c745978410c6e3ffd9b910.glb",
            "author": "bloooob",
            "license": "CC-BY",
            "source_url": "https://sketchfab.com/3d-models/bus-stop-367bdb5ca8c745978410c6e3ffd9b910",
            "unit_scale_m": 1.0,
        },
        {
            "asset_id": "tree_2a0dbcdf8f5d48f5ad79987c7a8170ce",
            "kind": "tree",
            "file": "sketchfab/tree_2a0dbcdf8f5d48f5ad79987c7a8170ce.glb",
            "author": "Valery.Li",
            "license": "CC-BY",
            "source_url": "https://sketchfab.com/3d-models/chinese-banyan-ficus-microcarpa-2a0dbcdf8f5d48f5ad79987c7a8170ce",
            "unit_scale_m": 1.0,
        },
        {
            "asset_id": "tree_26e787f2ff2e4c0fb004c3b0210805a3",
            "kind": "tree",
            "file": "sketchfab/tree_26e787f2ff2e4c0fb004c3b0210805a3.glb",
            "author": "evolveduk",
            "license": "CC-BY",
            "source_url": "https://sketchfab.com/3d-models/coconut-palm-26e787f2ff2e4c0fb004c3b0210805a3",
            "unit_scale_m": 1.0,
        },
        {
            "asset_id": "tree_d05c8ffb6ec64a7184c4b673e21f7224",
            "kind": "tree",
            "file": "sketchfab/tree_d05c8ffb6ec64a7184c4b673e21f7224.glb",
            "author": "NextSpring",
            "license": "CC-BY",
            "source_url": "https://sketchfab.com/3d-models/realistic-palm-tree-2-free-d05c8ffb6ec64a7184c4b673e21f7224",
            "mesh_filter": ["M_Palm_P2_4_Trunk_0", "M_Palm_P2_4_Leaf_0"],
            "unit_scale_m": 1.0,
        },
        {
            "asset_id": "tree_46f83ec5f6c04abf9d509c1070f67d1e",
            "kind": "tree",
            "file": "sketchfab/tree_46f83ec5f6c04abf9d509c1070f67d1e.glb",
            "author": "kobaltsecond6c7d6150917a4267",
            "license": "CC-BY",
            "source_url": "https://sketchfab.com/3d-models/jungle-tree-46f83ec5f6c04abf9d509c1070f67d1e",
            "unit_scale_m": 1.0,
        },
    ]
    for e in entries:
        e.setdefault('contains_label_classes', [])
    return entries


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    assets = Path(__file__).resolve().parents[3] / 'assets'
    evidence = Path(__file__).resolve().parents[4] / 'planning/02_2026-10-05_blender-real2sim/evidence/s12'
    parser.add_argument('--catalog', type=Path, default=None)
    parser.add_argument('--root', type=Path, default=assets / 'env')
    parser.add_argument('--manifest', type=Path, default=assets / 'env_manifest.json')
    parser.add_argument('--thumbs', type=Path, default=evidence / 'env_thumbs.jpg')
    parser.add_argument('--render-thumbs', action='store_true', default=True)
    parser.add_argument('--refresh-collision', action='store_true', help='Measure existing normalized trees without rewriting assets')
    parser.add_argument('--assemble-blocks', action='store_true', help='Assemble metric apartment blocks from the existing CC0 facade kit')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])

    if args.assemble_blocks:
        entries = json.loads(args.manifest.read_text())
        kit = next(e for e in build_default_catalog() if e['asset_id'] == 'modular_urban_apartments_facade')
        for bx, by, floors in ((2, 2, 6), (3, 2, 4), (4, 2, 6), (6, 2, 5)):
            bpy.ops.wm.read_factory_settings(use_empty=True)
            entry = {**kit, 'asset_id': f'apartment_block_{bx}_{by}_{floors}',
                     'assembly': 'apartment_block', 'block_bays_floors': [bx, by, floors]}
            result = normalize(entry, args.root, contracts())
            result['assembly_source'] = 'modular_urban_apartments_facade'
            entries = [e for e in entries if e['asset_id'] != result['asset_id']]
            entries.append(result)
            print('APARTMENT_BLOCK ' + json.dumps(result), flush=True)
        temporary = args.manifest.with_suffix('.tmp.json')
        temporary.write_text(json.dumps(entries, indent=2) + '\n')
        temporary.replace(args.manifest)
        return

    if args.refresh_collision:
        entries = json.loads(args.manifest.read_text())
        rules = contracts()
        for entry in entries:
            rules.validate_asset(entry)
            if entry['kind'] != 'tree':
                continue
            path = (args.root / entry['file']).resolve()
            if not path.is_relative_to(args.root.resolve()) or path.suffix != '.blend':
                raise ValueError('unsafe normalized tree path')
            bpy.ops.wm.read_factory_settings(use_empty=True)
            objects = import_model(path)
            entry.update(collision_metadata(objects, rules))
            rules.validate_asset(entry)
            print('TREE_COLLISION ' + json.dumps({'asset_id': entry['asset_id'], 'parts': len(entry['collision_parts'])}), flush=True)
        temporary = args.manifest.with_suffix('.tmp.json')
        temporary.write_text(json.dumps(entries, indent=2) + '\n')
        temporary.replace(args.manifest)
        return

    if args.catalog is not None:
        entries = json.loads(args.catalog.read_text()) if args.catalog.exists() else []
    else:
        entries = build_default_catalog()

    if not isinstance(entries, list):
        raise TypeError('catalog must be a list')

    thumb_dir = args.root / 'thumbs'
    if args.render_thumbs and entries:
        thumb_dir.mkdir(parents=True, exist_ok=True)

    results = []
    thumb_paths = []
    for entry in entries:
        bpy.ops.object.select_all(action='SELECT')
        bpy.ops.object.delete(use_global=False)
        res = normalize(entry, args.root, contracts())
        results.append(res)
        if args.render_thumbs:
            t_path = thumb_dir / f"{entry['asset_id']}.png"
            kept = [o for o in bpy.data.objects if o.type == 'MESH']
            render_thumbnail(kept, t_path, size=256)
            thumb_paths.append((entry['asset_id'], t_path))

    args.manifest.parent.mkdir(parents=True, exist_ok=True)
    args.manifest.write_text(json.dumps(results, indent=2) + '\n')
    print('ENV_NORMALIZED ' + json.dumps({'assets': len(results)}))

    # Composite thumbnail grid
    if args.render_thumbs and thumb_paths:
        try:
            try:
                from PIL import Image, ImageDraw
            except ImportError:
                eval_py = Path(__file__).resolve().parents[3] / '.tools/eval/.venv/bin/python'
                if eval_py.is_file():
                    import subprocess
                    sub_script = (
                        "import math, json\n"
                        "from pathlib import Path\n"
                        "from PIL import Image, ImageDraw\n"
                        "cols = 6\n"
                        f"paths = {[(aid, str(p)) for aid, p in thumb_paths]!r}\n"
                        "rows = math.ceil(len(paths) / cols)\n"
                        "canvas = Image.new('RGB', (cols * 256, rows * 256), (25, 25, 30))\n"
                        "draw = ImageDraw.Draw(canvas)\n"
                        "for idx, (aid, p_str) in enumerate(paths):\n"
                        "    p = Path(p_str)\n"
                        "    if p.is_file():\n"
                        "        im = Image.open(p).convert('RGB')\n"
                        "        r, c = divmod(idx, cols)\n"
                        "        x, y = c * 256, r * 256\n"
                        "        canvas.paste(im, (x, y))\n"
                        "        draw.rectangle([x, y + 234, x + 256, y + 256], fill=(15, 15, 20))\n"
                        "        draw.text((x + 6, y + 238), aid[:28], fill=(220, 230, 245))\n"
                        "        draw.rectangle([x, y, x + 256, y + 256], outline=(50, 55, 65), width=1)\n"
                        f"out = Path({str(args.thumbs)!r})\n"
                        "out.parent.mkdir(parents=True, exist_ok=True)\n"
                        "canvas.save(out, quality=90)\n"
                    )
                    subprocess.run([str(eval_py), '-c', sub_script], check=True)
                    print(f"ENV_THUMBS_SAVED {args.thumbs}")
                    return
                raise
            cols = 6
            rows = math.ceil(len(thumb_paths) / cols)
            grid_w, grid_h = cols * 256, rows * 256
            canvas = Image.new('RGB', (grid_w, grid_h), (25, 25, 30))
            draw = ImageDraw.Draw(canvas)
            for idx, (aid, p) in enumerate(thumb_paths):
                if p.is_file():
                    im = Image.open(p).convert('RGB')
                    r, c = divmod(idx, cols)
                    x, y = c * 256, r * 256
                    canvas.paste(im, (x, y))
                    # Draw label banner at bottom
                    draw.rectangle([x, y + 234, x + 256, y + 256], fill=(15, 15, 20, 200))
                    draw.text((x + 6, y + 238), aid[:28], fill=(220, 230, 245))
                    draw.rectangle([x, y, x + 256, y + 256], outline=(50, 55, 65), width=1)
            args.thumbs.parent.mkdir(parents=True, exist_ok=True)
            canvas.save(args.thumbs, quality=90)
            print(f"ENV_THUMBS_SAVED {args.thumbs}")
        except Exception as exc:  # noqa: BLE001
            print(f"[WARN] Failed to composite thumbs grid: {exc}", file=sys.stderr)


if __name__ == '__main__':
    main()
