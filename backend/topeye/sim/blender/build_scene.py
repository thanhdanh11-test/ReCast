"""Build and render a topeye layout in Blender (SPEC-S2, SPEC-S3).

Run inside Blender only:
    Blender -b --factory-startup -P build_scene.py -- --layout L --out DIR
            [--scenario S.toml] [--selftest] [--no-render] [--no-lidar] [--save-blend F]
Uses bpy/mathutils/numpy/stdlib only; never imports topeye (00-ARCHITECTURE §3).
"""

import argparse
import json
import math
import random
import sys
import time
import tomllib
import traceback
import zlib
from pathlib import Path

import bpy
import numpy as np
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

LAYOUT_VERSION = 1
SELFTEST_MAX_PX = 0.5
NEAR_M = 0.5
MIN_FOG_TRANSMITTANCE = 0.2  # exp(-density*d): 0.04/m fog hides labels beyond ~40 m
VEHICLES = {"car", "truck", "bus", "trailer", "construction_vehicle"}
CAR_COLORS = [(0.9, 0.9, 0.9), (0.02, 0.02, 0.02), (0.45, 0.47, 0.5), (0.2, 0.2, 0.22),
              (0.5, 0.03, 0.03), (0.03, 0.1, 0.4), (0.6, 0.6, 0.55), (0.1, 0.25, 0.12),
              (0.55, 0.35, 0.1), (0.75, 0.75, 0.78), (0.3, 0.05, 0.05), (0.05, 0.05, 0.15)]
PRESETS = {
    "day": {"sun": 4.0, "sun_angle": 0.5, "world": (0.55, 0.7, 0.9), "world_strength": 1.0,
            "fog_density": 0.0, "wetness": 0.0, "night": False},
    "night": {"sun": 0.0, "sun_angle": 0.5, "world": (0.01, 0.012, 0.02),
              "world_strength": 1.0, "fog_density": 0.0, "wetness": 0.0, "night": True},
    "rain": {"sun": 1.0, "sun_angle": 30.0, "world": (0.35, 0.37, 0.4), "world_strength": 1.0,
             "fog_density": 0.01, "wetness": 0.8, "night": False},
    "fog": {"sun": 1.5, "sun_angle": 10.0, "world": (0.6, 0.62, 0.65), "world_strength": 1.0,
            "fog_density": 0.04, "wetness": 0.3, "night": False},
}
SCHEMA = {
    "": {"name": str, "seed": int, "engine": str, "samples": int, "frames": list,
         "cameras": list, "resolution_scale": (int, float), "weather": dict, "traffic": dict},
    "weather": {"preset": str, "fog_density": (int, float), "wetness": (int, float),
                "paint_fade": (int, float), "rain_drop_rate": (int, float)},
    "traffic": {"mode": str, "color_randomization": bool},
}


class InputError(Exception):
    """Contract violation in layout or scenario (exit 2)."""


# ---------------------------------------------------------------- inputs

def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(prog="build_scene.py")
    parser.add_argument("--layout", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--scenario", type=Path)
    parser.add_argument("--selftest", action="store_true")
    parser.add_argument("--no-render", action="store_true")
    parser.add_argument("--no-lidar", action="store_true")
    parser.add_argument("--save-blend", type=Path)
    return parser.parse_args(argv)


def load_layout(path):
    try:
        layout = json.loads(path.read_text())
    except (OSError, ValueError) as exc:
        raise InputError(f"Cannot read layout {path}: {exc}") from exc
    if layout.get("version") != LAYOUT_VERSION:
        raise InputError(f"Layout version {layout.get('version')} != {LAYOUT_VERSION}")
    for key in ("mesh", "paint", "drivable"):
        if not (path.parent / layout["ground"][key]).is_file():
            raise InputError(f"Missing ground {key} file")
    if not (path.parent / layout["static"]["mesh"]).is_file():
        raise InputError("Missing static mesh")
    return layout


def load_scenario(path, layout):
    try:
        data = tomllib.loads(path.read_text())
    except (OSError, tomllib.TOMLDecodeError) as exc:
        raise InputError(f"Cannot read scenario {path}: {exc}") from exc
    for section, fields in SCHEMA.items():
        table = data if not section else data.get(section, {})
        for key, value in table.items():
            if key not in fields:
                raise InputError(f"Unknown scenario key [{section or 'root'}].{key}")
            if isinstance(value, bool) and fields[key] is not bool:
                raise InputError(f"Invalid type for {key}")
            if not isinstance(value, fields[key]):
                raise InputError(f"Invalid type for {key}")
    weather = dict(data.get("weather", {}))
    preset = weather.get("preset", "day")
    if preset not in PRESETS:
        raise InputError(f"Unknown weather preset {preset}")
    weather = {"preset": preset, "fog_density": PRESETS[preset]["fog_density"],
               "wetness": PRESETS[preset]["wetness"], "paint_fade": 0.0,
               "rain_drop_rate": 0.0, **weather}
    traffic = {"mode": "replay", "color_randomization": True, **data.get("traffic", {})}
    scenario = {"name": data.get("name", ""), "seed": data.get("seed", 0),
                "engine": data.get("engine", "eevee"), "samples": data.get("samples", 16),
                "frames": data.get("frames", []), "cameras": data.get("cameras", []),
                "resolution_scale": float(data.get("resolution_scale", 1.0)),
                "weather": weather, "traffic": traffic}
    checks = [
        (bool(scenario["name"]) and all(c.isalnum() or c in "_-" for c in scenario["name"]),
         "name"),
        (scenario["engine"] in ("eevee", "cycles"), "engine"),
        (1 <= scenario["samples"] <= 4096, "samples"),
        (0 < scenario["resolution_scale"] <= 1, "resolution_scale"),
        (0 <= weather["fog_density"] <= 0.1, "weather.fog_density"),
        (0 <= weather["wetness"] <= 1, "weather.wetness"),
        (0 <= weather["paint_fade"] <= 1, "weather.paint_fade"),
        (0 <= weather["rain_drop_rate"] <= 1, "weather.rain_drop_rate"),
        (traffic["mode"] == "replay", "traffic.mode"),
    ]
    for ok, key in checks:
        if not ok:
            raise InputError(f"Scenario value out of range: {key}")
    indices = {frame["index"] for frame in layout["frames"]}
    if any(frame not in indices for frame in scenario["frames"]):
        raise InputError("Scenario frames not in layout")
    cameras = set(layout["frames"][0]["cameras"])
    if any(camera not in cameras for camera in scenario["cameras"]):
        raise InputError("Scenario cameras not in layout")
    return scenario


# ---------------------------------------------------------------- geometry helpers

def apply_camera(camera, params, scale=1.0):
    scene = bpy.context.scene
    data = camera.data
    data.type = "PERSP"
    data.sensor_fit = "HORIZONTAL"
    data.sensor_width = params["sensor_width"]
    data.lens = params["lens"]
    data.shift_x = params["shift_x"]
    data.shift_y = params["shift_y"]
    data.clip_start, data.clip_end = 0.1, 300.0
    scene.render.resolution_x = round(params["resolution_x"] * scale)
    scene.render.resolution_y = round(params["resolution_y"] * scale)
    scene.render.resolution_percentage = 100
    scene.render.pixel_aspect_x = scene.render.pixel_aspect_y = 1.0
    camera.matrix_world = Matrix(params["matrix_world"])


def mesh_object(name, vertices, faces, material_indices=None, materials=()):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([tuple(v) for v in vertices], [], [tuple(f) for f in faces])
    for material in materials:
        mesh.materials.append(material)
    if material_indices is not None:
        mesh.polygons.foreach_set("material_index", np.asarray(material_indices, np.int32))
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


class Builder:
    """Accumulates low-poly parts (local coordinates) with a material slot per face."""

    def __init__(self):
        self.vertices, self.faces, self.slots = [], [], []

    def _add(self, vertices, faces, slot):
        start = len(self.vertices)
        self.vertices += [tuple(v) for v in vertices]
        self.faces += [tuple(start + i for i in face) for face in faces]
        self.slots += [slot] * len(faces)

    def box(self, center, size, slot, taper=1.0):
        cx, cy, cz = center
        hx, hy, hz = (s / 2 for s in size)
        top = [(cx - hx * taper, cy - hy, cz + hz), (cx + hx * taper, cy - hy, cz + hz),
               (cx + hx * taper, cy + hy, cz + hz), (cx - hx * taper, cy + hy, cz + hz)]
        bottom = [(cx - hx, cy - hy, cz - hz), (cx + hx, cy - hy, cz - hz),
                  (cx + hx, cy + hy, cz - hz), (cx - hx, cy + hy, cz - hz)]
        faces = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6),
                 (3, 0, 4, 7)]
        self._add(bottom + top, faces, slot)

    def cylinder(self, center, radius, length, axis, slot, segments=12):
        cx, cy, cz = center
        ring = []
        for end in (-0.5, 0.5):
            for k in range(segments):
                a = 2 * math.pi * k / segments
                u, v = radius * math.cos(a), radius * math.sin(a)
                if axis == "y":
                    ring.append((cx + u, cy + end * length, cz + v))
                else:
                    ring.append((cx + u, cy + v, cz + end * length))
        faces = [(k, (k + 1) % segments, segments + (k + 1) % segments, segments + k)
                 for k in range(segments)]
        faces += [tuple(range(segments - 1, -1, -1)), tuple(range(segments, 2 * segments))]
        self._add(ring, faces, slot)

    def cone(self, center, radius, height, slot, segments=12):
        cx, cy, cz = center
        base = [(cx + radius * math.cos(2 * math.pi * k / segments),
                 cy + radius * math.sin(2 * math.pi * k / segments), cz - height / 2)
                for k in range(segments)]
        apex = len(base)
        faces = [(k, (k + 1) % segments, apex) for k in range(segments)]
        faces.append(tuple(range(segments - 1, -1, -1)))
        self._add(base + [(cx, cy, cz + height / 2)], faces, slot)

    def sphere(self, center, radius, slot, rings=6, segments=10):
        cx, cy, cz = center
        vertices = [(cx, cy, cz - radius)]
        for r in range(1, rings):
            phi = math.pi * r / rings - math.pi / 2
            for k in range(segments):
                a = 2 * math.pi * k / segments
                vertices.append((cx + radius * math.cos(phi) * math.cos(a),
                                 cy + radius * math.cos(phi) * math.sin(a),
                                 cz + radius * math.sin(phi)))
        vertices.append((cx, cy, cz + radius))
        top = len(vertices) - 1
        faces = [(0, 1 + (k + 1) % segments, 1 + k) for k in range(segments)]
        for r in range(rings - 2):
            a, b = 1 + r * segments, 1 + (r + 1) * segments
            faces += [(a + k, a + (k + 1) % segments, b + (k + 1) % segments, b + k)
                      for k in range(segments)]
        last = 1 + (rings - 2) * segments
        faces += [(last + k, last + (k + 1) % segments, top) for k in range(segments)]
        self._add(vertices, faces, slot)


# Material slots of every actor mesh.
BODY, GLASS, TYRE, HEAD, TAIL = range(5)


def actor_geometry(label, size):
    """Low-poly proxy filling the box [-l/2,l/2]x[-w/2,w/2]x[-h/2,h/2]; +x is forward."""
    l, w, h = size
    b = Builder()
    if label in VEHICLES:
        wheel = 0.35 * h / 2 if label != "car" else min(0.35, 0.18 * h)
        body_h = 0.6 * h - wheel * 0.6
        body_z = -h / 2 + wheel * 0.6 + body_h / 2
        b.box((0, 0, body_z), (l, w, body_h), BODY)
        cabin_l = 0.75 * l if label == "car" else 0.95 * l
        cabin_x = -0.05 * l if label == "car" else 0.0
        cabin_h = h / 2 - (body_z + body_h / 2)
        b.box((cabin_x, 0, body_z + body_h / 2 + cabin_h / 2), (cabin_l, 0.94 * w, cabin_h),
              GLASS if label == "car" else BODY, taper=0.8 if label == "car" else 1.0)
        for x in (0.32 * l, -0.32 * l):
            for y in (0.5 * w - 0.12, -0.5 * w + 0.12):
                b.cylinder((x, y, -h / 2 + wheel), wheel, 0.22, "y", TYRE)
        for y in (0.3 * w, -0.3 * w):
            b.box((l / 2 + 0.01, y, body_z + 0.15 * body_h), (0.02, 0.2 * w, 0.18 * body_h),
                  HEAD)
            b.box((-l / 2 - 0.01, y, body_z + 0.15 * body_h), (0.02, 0.2 * w, 0.18 * body_h),
                  TAIL)
    elif label == "pedestrian":
        head = min(0.12, h * 0.08)
        b.cylinder((0, 0, -head), min(l, w) * 0.35, h - 2 * head, "z", BODY)
        b.sphere((0, 0, h / 2 - head), head, BODY)
    elif label in ("motorcycle", "bicycle"):
        radius = min(0.33, h * 0.3)
        b.box((0, 0, 0.1 * h), (0.7 * l, 0.25 * w, 0.5 * h), BODY)
        for x in (0.35 * l, -0.35 * l):
            b.cylinder((x, 0, -h / 2 + radius), radius, 0.08, "y", TYRE)
    elif label == "traffic_cone":
        b.cone((0, 0, 0), min(l, w) / 2, h, BODY)
    else:
        b.box((0, 0, 0), (l, w, h), BODY)
    return b


# ---------------------------------------------------------------- materials

def principled(name, color, roughness=0.5, metallic=0.0, emission=None, strength=0.0):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    bsdf = material.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if emission is not None:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1.0)
        bsdf.inputs["Emission Strength"].default_value = strength
    return material


def socket(sockets, name, kind):
    return next(s for s in sockets if s.name == name and s.type == kind)


def mix_rgb(nodes, links, factor, a, b):
    node = nodes.new("ShaderNodeMix")
    node.data_type = "RGBA"
    links.new(factor, socket(node.inputs, "Factor", "VALUE"))
    for name, value in (("A", a), ("B", b)):
        target = socket(node.inputs, name, "RGBA")
        if isinstance(value, tuple):
            target.default_value = (*value, 1.0)
        else:
            links.new(value, target)
    return socket(node.outputs, "Result", "RGBA")


def image_value(nodes, links, path, uv):
    image = bpy.data.images.load(str(path))
    image.colorspace_settings.name = "Non-Color"
    node = nodes.new("ShaderNodeTexImage")
    node.image = image
    node.interpolation = "Linear"
    links.new(uv, node.inputs["Vector"])
    return node.outputs["Color"]


def ground_material(directory, layout, weather):
    material = bpy.data.materials.new("ground")
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    bsdf = nodes["Principled BSDF"]
    uv = nodes.new("ShaderNodeUVMap").outputs["UV"]
    paint = image_value(nodes, links, directory / layout["ground"]["paint"], uv)
    drivable = image_value(nodes, links, directory / layout["ground"]["drivable"], uv)
    ramp = nodes.new("ShaderNodeMapRange")
    links.new(paint, ramp.inputs["Value"])
    ramp.inputs["From Min"].default_value, ramp.inputs["From Max"].default_value = 0.35, 0.6
    ramp.inputs["To Max"].default_value = 1.0 - weather["paint_fade"]
    dark = 1.0 - 0.5 * weather["wetness"]
    asphalt, kerb, white = (0.05 * dark,) * 3, (0.18 * dark,) * 3, (0.75 * dark,) * 3
    noise = nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 0.8
    variation = nodes.new("ShaderNodeMapRange")
    links.new(noise.outputs["Fac"], variation.inputs["Value"])
    variation.inputs["To Min"].default_value, variation.inputs["To Max"].default_value = 0.8, 1.2
    base = mix_rgb(nodes, links, drivable, kerb, asphalt)
    multiply = nodes.new("ShaderNodeMix")
    multiply.data_type, multiply.blend_type = "RGBA", "MULTIPLY"
    socket(multiply.inputs, "Factor", "VALUE").default_value = 1.0
    links.new(base, socket(multiply.inputs, "A", "RGBA"))
    links.new(variation.outputs["Result"], socket(multiply.inputs, "B", "RGBA"))
    color = mix_rgb(nodes, links, ramp.outputs["Result"],
                    socket(multiply.outputs, "Result", "RGBA"), white)
    links.new(color, bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.85 - 0.75 * weather["wetness"]
    return material


def static_material(obj):
    material = bpy.data.materials.new("static")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    bsdf = nodes["Principled BSDF"]
    bsdf.inputs["Roughness"].default_value = 0.9
    if obj.data.color_attributes:
        attribute = nodes.new("ShaderNodeVertexColor")
        attribute.layer_name = obj.data.color_attributes[0].name
        material.node_tree.links.new(attribute.outputs["Color"], bsdf.inputs["Base Color"])
    return material


# ---------------------------------------------------------------- scene

def import_ply(path, name):
    bpy.ops.wm.ply_import(filepath=str(path), forward_axis="Y", up_axis="Z")
    obj = bpy.context.selected_objects[0]
    obj.name = name
    return obj


def set_ground_uv(obj, bounds):
    mesh = obj.data
    coords = np.empty(len(mesh.vertices) * 3)
    mesh.vertices.foreach_get("co", coords)
    coords = coords.reshape(-1, 3)
    loops = np.empty(len(mesh.loops), np.int64)
    mesh.loops.foreach_get("vertex_index", loops)
    u = (coords[loops, 0] - bounds["xmin"]) / (bounds["xmax"] - bounds["xmin"])
    v = (coords[loops, 1] - bounds["ymin"]) / (bounds["ymax"] - bounds["ymin"])
    layer = mesh.uv_layers.new(name="UVMap")
    layer.data.foreach_set("uv", np.column_stack((u, v)).ravel())


def build_actors(layout, scenario):
    night = PRESETS[scenario["weather"]["preset"]]["night"]
    glass = principled("glass", (0.01, 0.01, 0.012), roughness=0.05, metallic=0.2)
    tyre = principled("tyre", (0.015, 0.015, 0.015), roughness=0.8)
    head = principled("headlight", (0.9, 0.9, 0.85), emission=(1.0, 0.95, 0.85),
                      strength=20.0 if night else 0.0)
    tail = principled("taillight", (0.5, 0.02, 0.02), emission=(1.0, 0.02, 0.02),
                      strength=8.0 if night else 0.0)
    grey = principled("body_grey", (0.4, 0.4, 0.4), roughness=0.4)
    actors = []
    for index, actor in enumerate(layout["actors"]):
        rng = random.Random(scenario["seed"] ^ zlib.crc32(actor["track"].encode()))
        if actor["label"] == "pedestrian":
            body = principled(f"ped_{index}", (rng.uniform(0.05, 0.6),) * 3, roughness=0.9)
        elif actor["label"] in ("barrier", "traffic_cone"):
            body = principled(f"obstacle_{index}", (0.8, 0.3, 0.05), roughness=0.6)
        elif scenario["traffic"]["color_randomization"]:
            body = principled(f"paint_{index}", rng.choice(CAR_COLORS), roughness=0.35,
                              metallic=0.3)
        else:
            body = grey
        parts = actor_geometry(actor["label"], actor["size"])
        obj = mesh_object(f"actor_{index:04d}", parts.vertices, parts.faces, parts.slots,
                          (body, glass, tyre, head, tail))
        obj.pass_index = index + 1
        obj["track"] = actor["track"]
        actors.append((obj, actor, {key["frame"]: key for key in actor["keys"]}))
    return actors


def place_actors(actors, frame):
    for obj, _, keys in actors:
        key = keys.get(frame)
        if key is None:
            obj.location = (0.0, 0.0, -1000.0)
            obj.hide_render = True
        else:
            obj.location = key["center"]
            obj.rotation_euler = (0.0, 0.0, key["yaw"])
            obj.hide_render = False
    bpy.context.view_layer.update()


def fog_volume(bounds, density):
    """Fog as an object volume over the layout: EEVEE renders a World volume black."""
    material = bpy.data.materials.new("fog")
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    nodes.remove(nodes["Principled BSDF"])
    volume = nodes.new("ShaderNodeVolumeScatter")
    volume.inputs["Density"].default_value = density
    volume.inputs["Color"].default_value = (0.85, 0.87, 0.9, 1.0)
    links.new(volume.outputs["Volume"], nodes["Material Output"].inputs["Volume"])
    b = Builder()
    b.box(((bounds["xmin"] + bounds["xmax"]) / 2, (bounds["ymin"] + bounds["ymax"]) / 2, 15.0),
          (bounds["xmax"] - bounds["xmin"] + 200, bounds["ymax"] - bounds["ymin"] + 200, 60.0),
          0)
    obj = mesh_object("fog", b.vertices, b.faces, b.slots, (material,))
    obj.hide_select = True
    return obj


def setup_world(layout, scenario):
    weather = scenario["weather"]
    preset = PRESETS[weather["preset"]]
    world = bpy.data.worlds.new("world")
    bpy.context.scene.world = world
    world.use_nodes = True
    nodes = world.node_tree.nodes
    nodes["Background"].inputs["Color"].default_value = (*preset["world"], 1.0)
    nodes["Background"].inputs["Strength"].default_value = preset["world_strength"]
    if weather["fog_density"] > 0:
        fog_volume(layout["bounds"], weather["fog_density"])
    if preset["sun"] > 0:
        sun = bpy.data.lights.new("sun", "SUN")
        sun.energy = preset["sun"]
        sun.angle = math.radians(preset["sun_angle"])
        obj = bpy.data.objects.new("sun", sun)
        obj.rotation_euler = (math.radians(45), 0.0, math.radians(30))
        bpy.context.scene.collection.objects.link(obj)
    if preset["night"]:
        positions = [Vector(np.asarray(f["T_world_lidar"])[:3, 3]) for f in layout["frames"]]
        travelled, last, side = 0.0, None, 1
        for position in positions:
            if last is not None:
                travelled += (position - last).length
            if last is None or travelled >= 25.0:
                direction = (positions[-1] - positions[0]).normalized()
                lateral = Vector((-direction.y, direction.x, 0.0)) * 7.0 * side
                light = bpy.data.lights.new("street", "POINT")
                light.energy = 2500.0
                light.color = (1.0, 0.85, 0.6)
                obj = bpy.data.objects.new("street", light)
                obj.location = position + lateral + Vector((0, 0, 7.0))
                bpy.context.scene.collection.objects.link(obj)
                travelled, side = 0.0, -side
            last = position


def ego_headlight(scenario):
    if not PRESETS[scenario["weather"]["preset"]]["night"]:
        return None
    light = bpy.data.lights.new("ego_headlight", "SPOT")
    light.energy = 3000.0
    light.spot_size = math.radians(70)
    light.spot_blend = 0.6
    obj = bpy.data.objects.new("ego_headlight", light)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def setup_render(scenario):
    scene = bpy.context.scene
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGB"
    if scenario["engine"] == "cycles":
        scene.render.engine = "CYCLES"
        prefs = bpy.context.preferences.addons["cycles"].preferences
        try:
            prefs.compute_device_type = "METAL"
            prefs.get_devices()
            for device in prefs.devices:
                device.use = True
            scene.cycles.device = "GPU"
        except (TypeError, AttributeError):
            scene.cycles.device = "CPU"
        scene.cycles.samples = scenario["samples"]
        scene.cycles.use_denoising = True
    else:
        scene.render.engine = "BLENDER_EEVEE"
        scene.eevee.taa_render_samples = scenario["samples"]
        scene.eevee.volumetric_end = 200.0


# ---------------------------------------------------------------- ray casting

def actor_tree(actors):
    vertices, faces, owner = [], [], []
    for obj, actor, _ in actors:
        if obj.hide_render:
            continue
        matrix = obj.matrix_world
        start = len(vertices)
        vertices += [matrix @ v.co for v in obj.data.vertices]
        for polygon in obj.data.polygons:
            faces.append([start + i for i in polygon.vertices])
            owner.append(actor["track"])
    return (BVHTree.FromPolygons(vertices, faces) if faces else None), owner


def nearest_hit(trees, origin, direction, distance):
    best = None
    for kind, tree in trees.items():
        if tree is None:
            continue
        location, _, index, hit = tree.ray_cast(origin, direction, distance)
        if location is not None and (best is None or hit < best[3]):
            best = (kind, location, index, hit)
    return best


def visibility(camera, actors, trees, owner, fog_density=0.0):
    """Unoccluded box samples whose fog transmittance stays >= MIN_FOG_TRANSMITTANCE."""
    scene = bpy.context.scene
    origin = camera.matrix_world.translation
    grid = [(i, j, k) for i in (-0.4, 0, 0.4) for j in (-0.4, 0, 0.4) for k in (-0.4, 0, 0.4)]
    result = {}
    for obj, actor, _ in actors:
        if obj.hide_render:
            continue
        l, w, h = actor["size"]
        samples = visible = 0
        for i, j, k in grid:
            point = obj.matrix_world @ Vector((i * l, j * w, k * h))
            ndc = world_to_camera_view(scene, camera, point)
            if ndc.z < NEAR_M or not (0 <= ndc.x <= 1 and 0 <= ndc.y <= 1):
                continue
            samples += 1
            delta = point - origin
            hit = nearest_hit(trees, origin, delta.normalized(), delta.length + 0.05)
            clear = math.exp(-fog_density * delta.length) >= MIN_FOG_TRANSMITTANCE
            if clear and hit is not None and hit[0] == "actor" and owner[hit[2]] == actor["track"]:
                visible += 1
        if samples:
            result[actor["track"]] = {"visible": visible, "samples": samples}
    return result


def lidar_scan(frame, layout, scenario, trees, paint, bounds):
    spec = layout["lidar"]
    weather = scenario["weather"]
    T = np.asarray(frame["T_world_lidar"])
    origin = Vector(T[:3, 3])
    elevations = np.radians(np.linspace(spec["elev_min_deg"], spec["elev_max_deg"],
                                         spec["rings"]))
    azimuths = 2 * np.pi * np.arange(spec["azimuth_steps"]) / spec["azimuth_steps"]
    ring, az = np.meshgrid(np.arange(spec["rings"]), azimuths, indexing="ij")
    e = elevations[ring]
    local = np.stack((np.cos(e) * np.cos(az), np.cos(e) * np.sin(az), np.sin(e)), -1).reshape(-1, 3)
    directions = local @ T[:3, :3].T
    rng = np.random.default_rng(scenario["seed"] + frame["index"])
    points = []
    wet = 1.0 - 0.5 * weather["wetness"]
    fade = 1.0 - weather["paint_fade"]
    for n, direction in enumerate(directions):
        hit = nearest_hit(trees, origin, Vector(direction), spec["max_range_m"])
        if hit is None:
            continue
        kind, location, _, distance = hit
        drop = weather["rain_drop_rate"] + (1 - math.exp(-2 * weather["fog_density"] * distance))
        if rng.random() < drop:
            continue
        distance += rng.normal(0, 0.02 + 0.5 * weather["fog_density"])
        world = np.asarray(origin) + direction * distance
        if kind == "ground":
            u = int((location.x - bounds["xmin"]) / layout["ground"]["tex_res_m"])
            v = int((location.y - bounds["ymin"]) / layout["ground"]["tex_res_m"])
            value = paint[v, u] if 0 <= v < paint.shape[0] and 0 <= u < paint.shape[1] else 0
            intensity = (20 + 200 * value * fade) * wet
        else:
            intensity = 40.0 if kind == "actor" else 30.0
        points.append((*world, intensity, n // spec["azimuth_steps"]))
    if not points:
        return np.empty((0, 5), "<f4")
    points = np.asarray(points)
    inverse = np.linalg.inv(T)
    points[:, :3] = points[:, :3] @ inverse[:3, :3].T + inverse[:3, 3]
    return points.astype("<f4")


def load_paint(directory, layout):
    """Paint raster as float 0..1 indexed [row from ymin, column from xmin]."""
    image = bpy.data.images.load(str(directory / layout["ground"]["paint"]))
    width, height = image.size
    pixels = np.empty(width * height * 4, np.float32)
    image.pixels.foreach_get(pixels)
    return pixels.reshape(height, width, 4)[:, :, 0]


# ---------------------------------------------------------------- modes

def selftest(layout, out):
    test = layout["selftest"]
    frame = next(f for f in layout["frames"] if f["index"] == test["frame"])
    camera = bpy.data.objects.new("camera", bpy.data.cameras.new("camera"))
    bpy.context.scene.collection.objects.link(camera)
    params = frame["cameras"][test["camera"]]["blender"]
    apply_camera(camera, params)
    bpy.context.view_layer.update()
    width, height = params["resolution_x"], params["resolution_y"]
    errors = []
    for point, (u, v) in zip(test["points"], test["uv"]):
        ndc = world_to_camera_view(bpy.context.scene, camera, Vector(point))
        errors.append(math.hypot(ndc.x * width - u, (1 - ndc.y) * height - v))
    result = {"camera": test["camera"], "frame": test["frame"], "points": len(errors),
              "max_err_px": max(errors), "mean_err_px": sum(errors) / len(errors)}
    out.mkdir(parents=True, exist_ok=True)
    (out / "selftest.json").write_text(json.dumps(result, indent=2))
    print("SELFTEST", json.dumps(result))
    return 0 if errors and result["max_err_px"] < SELFTEST_MAX_PX else 1


def run(layout_path, scenario_path, out, render, lidar, save_blend):
    directory = layout_path.parent
    layout = load_layout(layout_path)
    scenario = load_scenario(scenario_path, layout)
    frames = [f for f in layout["frames"]
              if not scenario["frames"] or f["index"] in scenario["frames"]]
    names = scenario["cameras"] or sorted(layout["frames"][0]["cameras"])
    out.mkdir(parents=True, exist_ok=True)

    bounds = layout["bounds"]
    ground = import_ply(directory / layout["ground"]["mesh"], "ground")
    set_ground_uv(ground, bounds)
    ground.data.materials.append(ground_material(directory, layout, scenario["weather"]))
    static = import_ply(directory / layout["static"]["mesh"], "static")
    static.data.materials.append(static_material(static))
    actors = build_actors(layout, scenario)
    setup_world(layout, scenario)
    setup_render(scenario)
    headlight = ego_headlight(scenario)
    camera = bpy.data.objects.new("camera", bpy.data.cameras.new("camera"))
    bpy.context.scene.collection.objects.link(camera)
    bpy.context.scene.camera = camera
    depsgraph = bpy.context.evaluated_depsgraph_get()
    static_trees = {"ground": BVHTree.FromObject(ground, depsgraph),
                    "static": BVHTree.FromObject(static, depsgraph)}
    paint = load_paint(directory, layout)

    failed = False
    timings = {"render_s": {}, "lidar_s": {}}
    for frame in frames:
        index = frame["index"]
        place_actors(actors, index)
        tree, owner = actor_tree(actors)
        trees = {**static_trees, "actor": tree}
        if headlight is not None:
            front = Matrix(frame["cameras"].get("CAM_FRONT", frame["cameras"][names[0]])
                           ["blender"]["matrix_world"])
            headlight.matrix_world = front @ Matrix.Translation((0.0, -0.8, 0.0))
        seen, timings["render_s"][str(index)] = {}, {}
        for name in names:
            apply_camera(camera, frame["cameras"][name]["blender"],
                         scenario["resolution_scale"])
            bpy.context.view_layer.update()
            seen[name] = visibility(camera, actors, trees, owner,
                                    scenario["weather"]["fog_density"])
            if not render:
                continue
            path = out / "images" / name / f"{index:06d}.png"
            path.parent.mkdir(parents=True, exist_ok=True)
            bpy.context.scene.render.filepath = str(path)
            started = time.perf_counter()
            try:
                bpy.ops.render.render(write_still=True)
            except RuntimeError:
                traceback.print_exc()
                failed = True
            timings["render_s"][str(index)][name] = round(time.perf_counter() - started, 2)
        visibility_path = out / "visibility" / f"{index:06d}.json"
        visibility_path.parent.mkdir(parents=True, exist_ok=True)
        visibility_path.write_text(json.dumps(seen))
        if lidar:
            started = time.perf_counter()
            points = lidar_scan(frame, layout, scenario, trees, paint, bounds)
            path = out / "lidar" / f"{index:06d}.bin"
            path.parent.mkdir(parents=True, exist_ok=True)
            points.tofile(path)
            timings["lidar_s"][str(index)] = round(time.perf_counter() - started, 2)
        print(f"FRAME {index} done", flush=True)
    if save_blend is not None:
        bpy.ops.wm.save_as_mainfile(filepath=str(save_blend))
    (out / "run.json").write_text(json.dumps({
        "scenario": scenario, "blender_version": bpy.app.version_string,
        "engine": bpy.context.scene.render.engine, "frames": [f["index"] for f in frames],
        "cameras": names, **timings, "status": "failed" if failed else "ok"}, indent=2))
    return 1 if failed else 0


def main():
    args = parse_args()
    try:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        if args.selftest:
            return selftest(load_layout(args.layout), args.out)
        if args.scenario is None:
            raise InputError("--scenario is required unless --selftest")
        return run(args.layout, args.scenario, args.out, not args.no_render, not args.no_lidar,
                   args.save_blend)
    except InputError as exc:
        print(f"INPUT ERROR: {exc}", file=sys.stderr)
        return 2
    except Exception:  # noqa: BLE001 - uncaught errors would make Blender exit 0 (S2 §1)
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())
