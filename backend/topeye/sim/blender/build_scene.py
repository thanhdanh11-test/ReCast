"""Build and render a topeye layout in Blender (SPEC-S2, SPEC-S3).

Run inside Blender only:
    Blender -b --factory-startup -P build_scene.py -- --layout L --out DIR
            [--scenario S.toml] [--selftest] [--no-render] [--no-lidar] [--save-blend F]
Uses bpy/mathutils/numpy/stdlib only; never imports topeye (00-ARCHITECTURE §3).
"""

import argparse
import copy
import importlib.util
import json
import math
import random
import sys
import time
import tomllib
import traceback
import zlib
from itertools import pairwise
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
    "traffic": {"mode": str, "color_randomization": bool, "density": (int, float),
                "speed_scale": (int, float), "speed_jitter": (int, float),
                "lane_change_rate": (int, float), "aggressiveness": (int, float),
                "pedestrians": (int, float), "keep_parked": bool, "seed": int},
}


# Schema 2 uses CARLA units at the file boundary, then the existing render units.
WEATHER_RANGES = {"cloudiness": (0, 100), "precipitation": (0, 100),
    "precipitation_deposits": (0, 100), "wind_intensity": (0, 100),
    "sun_azimuth_angle": (0, 360), "sun_altitude_angle": (-90, 90),
    "fog_density": (0, 100), "fog_distance": (0, math.inf),
    "wetness": (0, 100), "paint_fade": (0, 1)}
WEATHER_BASE = {"cloudiness": 0.0, "precipitation": 0.0, "precipitation_deposits": 0.0,
    "wind_intensity": 0.0, "sun_azimuth_angle": 30.0, "sun_altitude_angle": 45.0,
    "fog_density": 0.0, "fog_distance": 0.0, "wetness": 0.0, "paint_fade": 0.0}
WEATHER_PRESETS = {
    "day": dict(WEATHER_BASE),
    "night": {**WEATHER_BASE, "sun_altitude_angle": -30.0},
    "rain": {**WEATHER_BASE, "cloudiness": 80.0, "precipitation": 60.0,
             "precipitation_deposits": 40.0, "wind_intensity": 30.0, "wetness": 80.0,
             "fog_density": 10.0},
    "fog": {**WEATHER_BASE, "cloudiness": 70.0, "fog_density": 40.0, "wetness": 30.0},
    "dusk": {**WEATHER_BASE, "sun_altitude_angle": 5.0, "sun_azimuth_angle": 270.0},
}
LIDAR_DEFAULTS = {"atmosphere_attenuation_rate": 0.004, "dropoff_general_rate": 0.13,
    "dropoff_intensity_limit": 0.8, "dropoff_zero_intensity": 0.4, "noise_stddev": 0.0}
LIDAR_RANGES = {key: (0, math.inf if key in ("atmosphere_attenuation_rate", "noise_stddev")
                       else 1) for key in LIDAR_DEFAULTS}
TRAFFIC_RANGES_V2 = {"distance_to_leading": (0.5, 10), "speed_difference_percent": (-50, 80),
    "random_lanechange_percent": (0, 100), "max_accel": (0.5, 6),
    "max_decel": (1, 9), "max_lateral_accel": (1, 8)}


def numeric_ranges(table, ranges, section):
    for key, value in table.items():
        if key not in ranges:
            raise InputError(f"Unknown {section} key {key}")
        low, high = ranges[key]
        if (isinstance(value, bool) or not isinstance(value, (int, float))
                or not math.isfinite(value) or not low <= value <= high):
            raise InputError(f"{section}.{key} must be finite in [{low}, {high}]")


def normalize_weather(weather):
    preset = weather.get("preset", "day")
    if preset not in WEATHER_PRESETS:
        raise InputError(f"Unknown weather preset {preset}")
    numeric_ranges({k: v for k, v in weather.items() if k != "preset"}, WEATHER_RANGES, "weather")
    w = {**WEATHER_PRESETS[preset], **weather, "preset": preset}
    return {**w, "fog_density": 0.001 * w["fog_density"],
            "wetness": max(w["wetness"], w["precipitation"]) / 100,
            "rain_drop_rate": 0.0015 * w["precipitation"]}


def is_night(scenario):
    weather = scenario["weather"]
    return (weather["sun_altitude_angle"] < 0 if scenario.get("schema", 1) == 2
            else PRESETS[weather["preset"]]["night"])


def puddle_threshold(coverage):
    return float(np.interp(coverage, np.linspace(0, 1, 11),
        [0, 0.14497, 0.26715, 0.36759, 0.4467, 0.5, 0.5533, 0.63241, 0.73285, 0.85503, 1]))


def puddle_value(x, y):
    # Smooth deterministic noise, shared by render shader and ray-hit mask.
    return (math.sin(0.37 * x) * math.sin(0.53 * y) + 1) / 2


def lidar_return(reflectivity, distance, lidar, weather, rng, *, ground=False, puddle=False):
    intensity = reflectivity * math.exp(-lidar["atmosphere_attenuation_rate"] * distance)
    probability = (lidar["dropoff_zero_intensity"] if intensity == 0 else
                   0.0 if intensity > lidar["dropoff_intensity_limit"] else
                   lidar["dropoff_general_rate"])
    if rng.random() < probability:
        return None
    if rng.random() < weather["rain_drop_rate"]:
        return None
    if rng.random() > math.exp(-2 * weather["fog_density"] * distance):
        return None
    if puddle and rng.random() < 0.8:
        return None
    if ground:
        intensity *= 1 - 0.5 * weather["wetness"]
    return distance + rng.normal(0, lidar["noise_stddev"]), 255 * intensity


class InputError(Exception):
    """Contract violation in layout or scenario (exit 2)."""


# ---------------------------------------------------------------- inputs

def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser(prog="build_scene.py")
    parser.add_argument("--layout", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--scenario", type=Path)
    parser.add_argument("--actors", type=Path)
    parser.add_argument("--selftest", action="store_true")
    parser.add_argument("--no-render", action="store_true")
    parser.add_argument("--export-env-only", action="store_true")
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
    schema = data.get("schema", 1)
    if type(schema) is not int or schema not in (1, 2):
        raise InputError("schema must be 1 or 2")
    fields_by_section = {key: dict(value) for key, value in SCHEMA.items()}
    fields_by_section[""]["schema"] = int
    if schema == 2:
        fields_by_section[""]["lidar"] = dict
        fields_by_section[""]["environment"] = str
        fields_by_section[""]["export_web_env"] = bool
        fields_by_section[""]["region_style"] = str
        fields_by_section["weather"] = {"preset": str, **{key: (int, float) for key in WEATHER_RANGES}}
        fields_by_section["lidar"] = {key: (int, float) for key in LIDAR_DEFAULTS}
    fields_by_section["traffic"]["preset"] = str
    fields_by_section["traffic"].update({key: (int, float) for key in TRAFFIC_RANGES_V2})
    for section, fields in fields_by_section.items():
        table = data if not section else data.get(section, {})
        if not isinstance(table, dict):
            raise InputError(f"Scenario [{section}] must be a table")
        for key, value in table.items():
            if key not in fields:
                raise InputError(f"Unknown scenario key [{section or 'root'}].{key}")
            if isinstance(value, bool) and fields[key] is not bool:
                raise InputError(f"Invalid type for {key}")
            if not isinstance(value, fields[key]):
                raise InputError(f"Invalid type for {key}")
    weather = dict(data.get("weather", {}))
    preset = weather.get("preset", "day")
    if preset not in (WEATHER_PRESETS if schema == 2 else PRESETS):
        raise InputError(f"Unknown weather preset {preset}")
    weather = {"preset": preset, "fog_density": PRESETS.get(preset, PRESETS["day"])["fog_density"],
               "wetness": PRESETS.get(preset, PRESETS["day"])["wetness"], "paint_fade": 0.0,
               "rain_drop_rate": 0.0, **weather}
    if schema == 2:
        weather = normalize_weather(data.get("weather", {}))
        numeric_ranges(data.get("lidar", {}), LIDAR_RANGES, "lidar")
    numeric_ranges({k: v for k, v in data.get("traffic", {}).items()
                    if k in TRAFFIC_RANGES_V2}, TRAFFIC_RANGES_V2, "traffic")
    if data.get("traffic", {}).get("preset", "default") not in ("default", "vn"):
        raise InputError("traffic.preset must be default or vn")
    traffic = {"mode": "replay", "color_randomization": True, **data.get("traffic", {})}
    scenario = {"name": data.get("name", ""), "seed": data.get("seed", 0),
                "engine": data.get("engine", "eevee"), "samples": data.get("samples", 16),
                "frames": data.get("frames", []), "cameras": data.get("cameras", []),
                "resolution_scale": float(data.get("resolution_scale", 1.0)),
                "weather": weather, "traffic": traffic}
    if schema == 2:
        scenario["schema"] = 2
        scenario["region_style"] = data.get("region_style", "sg")
        if scenario["region_style"] not in ("sg", "vn"):
            raise InputError("region_style must be sg or vn")
        scenario["export_web_env"] = data.get("export_web_env", True)
        scenario["environment"] = data.get("environment", "voxel")
        if scenario["environment"] not in ("voxel", "procedural", "assets"):
            raise InputError("environment must be voxel, procedural or assets")
        scenario["lidar"] = {**LIDAR_DEFAULTS, **data.get("lidar", {})}
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
        (traffic["mode"] in ("replay", "generated"), "traffic.mode"),
    ]
    for key, (low, high) in {"density": (0, 3), "speed_scale": (0.5, 2),
                             "speed_jitter": (0, 0.5), "lane_change_rate": (0, 1),
                             "aggressiveness": (0, 1), "pedestrians": (0, 3)}.items():
        if key in traffic:
            checks.append((low <= traffic[key] <= high, f"traffic.{key}"))
    for ok, key in checks:
        if not ok:
            raise InputError(f"Scenario value out of range: {key}")
    if any(type(frame) is not int for frame in scenario["frames"]):
        raise InputError("Scenario frames must contain integers")
    if any(type(camera) is not str for camera in scenario["cameras"]):
        raise InputError("Scenario cameras must contain strings")
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
    deposits = weather.get("precipitation_deposits", 0) / 100
    if deposits > 0:
        geometry = nodes.new("ShaderNodeNewGeometry")
        separate = nodes.new("ShaderNodeSeparateXYZ")
        links.new(geometry.outputs["Position"], separate.inputs["Vector"])
        def math_node(operation, a, b=None):
            node = nodes.new("ShaderNodeMath")
            node.operation = operation
            for index, item in enumerate((a, b) if b is not None else (a,)):
                if isinstance(item, (int, float)):
                    node.inputs[index].default_value = item
                else:
                    links.new(item, node.inputs[index])
            return node.outputs[0]
        sx = math_node("SINE", math_node("MULTIPLY", separate.outputs["X"], 0.37))
        sy = math_node("SINE", math_node("MULTIPLY", separate.outputs["Y"], 0.53))
        noise = math_node("MULTIPLY", math_node("ADD", math_node("MULTIPLY", sx, sy), 1), 0.5)
        mask = math_node("MULTIPLY", math_node("LESS_THAN", noise, puddle_threshold(deposits)), drivable)
        roughness = math_node("ADD", math_node("MULTIPLY", mask,
                              0.03 - bsdf.inputs["Roughness"].default_value),
                              bsdf.inputs["Roughness"].default_value)
        links.new(roughness, bsdf.inputs["Roughness"])
        bsdf.inputs["Metallic"].default_value = 0.15
    return material


# ---------------------------------------------------------------- procedural environment (S11)

def pbr_assets():
    root = Path(__file__).resolve().parents[3] / "assets"
    manifest = root / "pbr_manifest.json"
    if not manifest.exists():
        print("PBR_FALLBACK manifest missing", flush=True)
        return root / "pbr", []
    try:
        entries = json.loads(manifest.read_text())
        if not isinstance(entries, list):
            raise TypeError("manifest must be a list")
        roles = {"asphalt", "sidewalk", "curb", "wall", "roof", "hdri_day", "hdri_dusk",
                 "hdri_night", "hdri_overcast", "leaf", "bark", "pole"}
        for entry in entries:
            if (not isinstance(entry, dict) or not isinstance(entry.get("files"), dict)
                    or not entry["files"] or entry.get("role") not in roles):
                raise TypeError("PBR entry requires role and nonempty files table")
            if entry.get("kind") not in ("material", "hdri", "texture"):
                raise ValueError("invalid PBR asset kind")
            if entry.get("normal_convention", "opengl") not in ("opengl", "directx"):
                raise ValueError("invalid normal convention")
            if entry["kind"] == "hdri" and "hdri" not in entry["files"]:
                raise ValueError("HDRI asset requires files.hdri")
            if entry.get("license") != "CC0":
                raise ValueError("only CC0 assets allowed")
            for file in entry["files"].values():
                path = (root / "pbr" / file).resolve()
                if not path.is_relative_to((root / "pbr").resolve()) or not path.is_file():
                    raise ValueError(f"missing or unsafe PBR file: {file}")
        return root / "pbr", entries
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise InputError(f"Invalid PBR manifest: {exc}") from exc


def texture_socket(material, path, vector, *, color=False):
    nodes, links = material.node_tree.nodes, material.node_tree.links
    texture = nodes.new("ShaderNodeTexImage")
    texture.image = bpy.data.images.load(str(path), check_existing=True)
    texture.image.colorspace_settings.name = "sRGB" if color else "Non-Color"
    links.new(vector, texture.inputs["Vector"])
    return texture.outputs["Color"]


def apply_pbr(material, role, assets, seed=0):
    root, entries = assets
    available = [a for a in entries if a["role"] == role]
    nodes, links = material.node_tree.nodes, material.node_tree.links
    bsdf = nodes["Principled BSDF"]
    position = nodes.new("ShaderNodeTexCoord").outputs["UV" if role == "wall" else "Object"]
    scale = nodes.new("ShaderNodeVectorMath")
    scale.operation = "SCALE"
    scale.inputs[3].default_value = 0.5
    links.new(position, scale.inputs[0])
    vector = scale.outputs["Vector"]
    sockets = {}
    if available:
        entry = available[seed % len(available)]
        files = dict(entry["files"])
        if "image" in files:
            files.setdefault("albedo", files["image"])
        for kind in ("albedo", "roughness", "normal"):
            if kind in files:
                sockets[kind] = texture_socket(material, root / files[kind], vector,
                                               color=kind == "albedo")
        if "roughness" in sockets and role != "asphalt":
            links.new(sockets["roughness"], bsdf.inputs["Roughness"])
        if "normal" in sockets:
            normal_color = sockets["normal"]
            if entry.get("normal_convention") == "directx":
                split = nodes.new("ShaderNodeSeparateColor")
                links.new(normal_color, split.inputs["Color"])
                invert = nodes.new("ShaderNodeMath")
                invert.operation = "SUBTRACT"
                invert.inputs[0].default_value = 1
                links.new(split.outputs["Green"], invert.inputs[1])
                combine = nodes.new("ShaderNodeCombineColor")
                links.new(split.outputs["Red"], combine.inputs["Red"])
                links.new(invert.outputs[0], combine.inputs["Green"])
                links.new(split.outputs["Blue"], combine.inputs["Blue"])
                normal_color = combine.outputs["Color"]
            normal = nodes.new("ShaderNodeNormalMap")
            links.new(normal_color, normal.inputs["Color"])
            links.new(normal.outputs["Normal"], bsdf.inputs["Normal"])
    else:
        noise = nodes.new("ShaderNodeTexNoise")
        noise.inputs["Scale"].default_value = 18
        links.new(vector, noise.inputs["Vector"])
        bump = nodes.new("ShaderNodeBump")
        bump.inputs["Strength"].default_value = .25
        bump.inputs["Distance"].default_value = .035
        links.new(noise.outputs["Fac"], bump.inputs["Height"])
        links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return sockets


def procedural_ground(directory, layout, weather, assets):
    material = ground_material(directory, layout, weather)
    sockets = apply_pbr(material, "asphalt", assets)
    nodes, links = material.node_tree.nodes, material.node_tree.links
    bsdf = nodes["Principled BSDF"]
    if "albedo" in sockets:
        uv = nodes.new("ShaderNodeUVMap").outputs["UV"]
        road = image_value(nodes, links, directory / layout["ground"]["drivable"], uv)
        paint = image_value(nodes, links, directory / layout["ground"]["paint"], uv)
        threshold = nodes.new("ShaderNodeMath")
        threshold.operation = "GREATER_THAN"
        threshold.inputs[1].default_value = .45
        links.new(paint, threshold.inputs[0])
        fade = nodes.new("ShaderNodeMath")
        fade.operation = "MULTIPLY"
        fade.inputs[1].default_value = 1 - weather["paint_fade"]
        links.new(threshold.outputs[0], fade.inputs[0])
        base = mix_rgb(nodes, links, road, (.22, .23, .21), sockets["albedo"])
        color = mix_rgb(nodes, links, fade.outputs[0], base, (.82, .81, .73))
        darken = nodes.new("ShaderNodeMix")
        darken.data_type, darken.blend_type = "RGBA", "MULTIPLY"
        socket(darken.inputs, "Factor", "VALUE").default_value = 1
        socket(darken.inputs, "B", "RGBA").default_value = (1 - .5 * weather["wetness"],) * 3 + (1,)
        links.new(color, socket(darken.inputs, "A", "RGBA"))
        links.new(socket(darken.outputs, "Result", "RGBA"), bsdf.inputs["Base Color"])
    # Preserve S7 puddle roughness; dry PBR roughness and paint have separate response.
    if "roughness" in sockets and weather["wetness"] == 0:
        links.new(sockets["roughness"], bsdf.inputs["Roughness"])
    return material


def facade_material(seed, assets, night):
    palette = [(.55, .49, .38), (.68, .65, .56), (.36, .39, .41), (.65, .47, .34), (.8, .77, .69)]
    material = principled(f"facade_{seed}", palette[seed % len(palette)], .8)
    textures = apply_pbr(material, "wall", assets, seed)
    nodes, links = material.node_tree.nodes, material.node_tree.links
    bsdf = nodes["Principled BSDF"]
    uv = nodes.new("ShaderNodeUVMap").outputs["UV"]
    split = nodes.new("ShaderNodeSeparateXYZ")
    links.new(uv, split.inputs[0])
    masks = []
    for axis, spacing, low, high in (("X", 2.4, .16, .83), ("Y", 3.2, .24, .83)):
        scale = nodes.new("ShaderNodeMath")
        scale.operation = "DIVIDE"
        scale.inputs[1].default_value = spacing
        links.new(split.outputs[axis], scale.inputs[0])
        fract = nodes.new("ShaderNodeMath")
        fract.operation = "FRACT"
        links.new(scale.outputs[0], fract.inputs[0])
        lower = nodes.new("ShaderNodeMath")
        lower.operation = "GREATER_THAN"
        lower.inputs[1].default_value = low
        links.new(fract.outputs[0], lower.inputs[0])
        upper = nodes.new("ShaderNodeMath")
        upper.operation = "LESS_THAN"
        upper.inputs[1].default_value = high
        links.new(fract.outputs[0], upper.inputs[0])
        mask = nodes.new("ShaderNodeMath")
        mask.operation = "MULTIPLY"
        links.new(lower.outputs[0], mask.inputs[0])
        links.new(upper.outputs[0], mask.inputs[1])
        masks.append(mask.outputs[0])
    window = nodes.new("ShaderNodeMath")
    window.operation = "MULTIPLY"
    for i, value in enumerate(masks):
        links.new(value, window.inputs[i])
    wall = textures.get("albedo", palette[seed % len(palette)])
    color = mix_rgb(nodes, links, window.outputs[0], wall, (.035, .075, .095))
    links.new(color, bsdf.inputs["Base Color"])
    rough = nodes.new("ShaderNodeMix")
    rough.data_type = "FLOAT"
    links.new(window.outputs[0], socket(rough.inputs, "Factor", "VALUE"))
    if "roughness" in textures:
        links.new(textures["roughness"], socket(rough.inputs, "A", "VALUE"))
    else:
        socket(rough.inputs, "A", "VALUE").default_value = .8
    socket(rough.inputs, "B", "VALUE").default_value = .13
    links.new(socket(rough.outputs, "Result", "VALUE"), bsdf.inputs["Roughness"])
    if night:
        links.new(window.outputs[0], bsdf.inputs["Emission Strength"])
        bsdf.inputs["Emission Color"].default_value = (.9, .62, .27, 1)
    return material


def environment_uv(obj):
    """Metric planar UVs for generated concrete and bark normal-map tangents."""
    uv = obj.data.uv_layers.new(name="SurfaceMeters")
    for face in obj.data.polygons:
        normal_axis = max(range(3), key=lambda i: abs(face.normal[i]))
        axes = [i for i in range(3) if i != normal_axis]
        for loop in face.loop_indices:
            co = obj.data.vertices[obj.data.loops[loop].vertex_index].co
            uv.data[loop].uv = (co[axes[0]], co[axes[1]])


def leaf_geometry(obj, leaf_material, seed):
    """GN distributes alpha-cut leaf cards on a measured crown mesh."""
    group = bpy.data.node_groups.new(f"canopy_{seed}", "GeometryNodeTree")
    group.interface.new_socket(name="Geometry", in_out="INPUT", socket_type="NodeSocketGeometry")
    group.interface.new_socket(name="Geometry", in_out="OUTPUT", socket_type="NodeSocketGeometry")
    nodes, links = group.nodes, group.links
    source = nodes.new("NodeGroupInput")
    output = nodes.new("NodeGroupOutput")
    distribute = nodes.new("GeometryNodeDistributePointsOnFaces")
    distribute.inputs["Density"].default_value = 24
    distribute.inputs["Seed"].default_value = seed
    links.new(source.outputs["Geometry"], distribute.inputs["Mesh"])
    grid = nodes.new("GeometryNodeMeshGrid")
    # 4x4 leaf atlas: a 70 cm card gives ~17 cm individual leaves.
    # Its measured 16% opacity preserves crown coverage at 24 cards/m².
    grid.inputs["Size X"].default_value = .7
    grid.inputs["Size Y"].default_value = .7
    material = nodes.new("GeometryNodeSetMaterial")
    material.inputs["Material"].default_value = leaf_material
    attribute = nodes.new("GeometryNodeStoreNamedAttribute")
    attribute.data_type, attribute.domain = "FLOAT2", "CORNER"
    attribute.inputs["Name"].default_value = "leaf_uv"
    links.new(grid.outputs["Mesh"], attribute.inputs["Geometry"])
    links.new(grid.outputs["UV Map"], attribute.inputs["Value"])
    links.new(attribute.outputs["Geometry"], material.inputs["Geometry"])
    instance = nodes.new("GeometryNodeInstanceOnPoints")
    links.new(distribute.outputs["Points"], instance.inputs["Points"])
    links.new(distribute.outputs["Rotation"], instance.inputs["Rotation"])
    links.new(material.outputs["Geometry"], instance.inputs["Instance"])
    scales = nodes.new("FunctionNodeRandomValue")
    scales.data_type = "FLOAT"
    socket(scales.inputs, "Min", "VALUE").default_value = .65
    socket(scales.inputs, "Max", "VALUE").default_value = 1.4
    scales.inputs["Seed"].default_value = seed
    links.new(socket(scales.outputs, "Value", "VALUE"), instance.inputs["Scale"])
    rotations = nodes.new("FunctionNodeRandomValue")
    rotations.data_type = "FLOAT_VECTOR"
    socket(rotations.inputs, "Min", "VECTOR").default_value = (-.7, -.7, -math.pi)
    socket(rotations.inputs, "Max", "VECTOR").default_value = (.7, .7, math.pi)
    rotations.inputs["Seed"].default_value = seed + 41
    rotate = nodes.new("GeometryNodeRotateInstances")
    links.new(instance.outputs["Instances"], rotate.inputs["Instances"])
    links.new(socket(rotations.outputs, "Value", "VECTOR"), rotate.inputs["Rotation"])
    realize = nodes.new("GeometryNodeRealizeInstances")
    links.new(rotate.outputs["Instances"], realize.inputs["Geometry"])
    links.new(realize.outputs["Geometry"], output.inputs["Geometry"])
    modifier = obj.modifiers.new("leaf_cards", "NODES")
    modifier.node_group = group


def build_procedural(directory, layout, scenario, assets, data_override=None):
    path = (directory / layout.get("photo", {}).get("procedural", "procedural.json")).resolve()
    if not path.is_relative_to(directory.resolve()):
        raise InputError("unsafe photo.procedural path")
    try:
        data = data_override if data_override is not None else json.loads(path.read_text())
        if data["version"] != 1 or data["scene"] != layout["scene"]:
            raise ValueError("procedural version/scene mismatch")
        for key in ("buildings", "vegetation", "poles", "road_edges"):
            if not isinstance(data[key], list):
                raise TypeError(f"{key} must be a list")
        def finite(values):
            if not np.isfinite(np.asarray(values, dtype=float)).all():
                raise ValueError("non-finite procedural geometry")
        for item in data["buildings"]:
            polygon = np.asarray(item["polygon"], float)
            finite([item["base_z"], item["height"]])
            finite(polygon)
            if polygon.ndim != 2 or polygon.shape[1] != 2 or len(polygon) < 3 or item["height"] <= 0:
                raise ValueError("invalid footprint")
        for kind in ("vegetation", "poles"):
            for item in data[kind]:
                finite([item[k] for k in ("x", "y", "z", "height")])
                if item["height"] <= 0:
                    raise ValueError("invalid height")
                if kind == "vegetation":
                    finite(item["crown_radius"])
                    if item["crown_radius"] <= 0:
                        raise ValueError("invalid crown radius")
        for edge in data["road_edges"]:
            finite(edge)
            if np.asarray(edge).ndim != 2 or np.asarray(edge).shape[1] != 2 or len(edge) < 2:
                raise ValueError("invalid road edge")
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise InputError(f"Invalid procedural layout: {exc}") from exc
    objects = []
    night = is_night(scenario)
    roof = principled("flat_roof", (.22, .24, .25), .8)
    apply_pbr(roof, "roof", assets)
    for i, building in enumerate(data["buildings"]):
        polygon = building["polygon"]
        n, z, height = len(polygon), building["base_z"], building["height"]
        vertices = [(x, y, z + dz) for dz in (0, height) for x, y in polygon]
        faces = [tuple(range(n - 1, -1, -1)), tuple(range(n, 2 * n))]
        faces += [(j, (j + 1) % n, (j + 1) % n + n, j + n) for j in range(n)]
        obj = mesh_object(f"building_{i}", vertices, faces, [1, 1] + [0] * n,
                          [facade_material(i + scenario["seed"], assets, night), roof])
        uv = obj.data.uv_layers.new(name="FacadeMeters")
        for face in obj.data.polygons:
            if face.index < 2:
                for loop in face.loop_indices:
                    co = obj.data.vertices[obj.data.loops[loop].vertex_index].co
                    uv.data[loop].uv = (co.x, co.y)
                continue
            a, b = polygon[face.index - 2], polygon[(face.index - 1) % n]
            width = math.dist(a, b)
            for loop, coords in zip(face.loop_indices, ((0, 0), (width, 0), (width, height), (0, height))):
                uv.data[loop].uv = coords
        objects.append(obj)
    bark = principled("bark", (.12, .085, .045), .9)
    bark_tex = apply_pbr(bark, "bark", assets)
    if "albedo" in bark_tex:
        bark.node_tree.links.new(bark_tex["albedo"], bark.node_tree.nodes["Principled BSDF"].inputs["Base Color"])
    leaf = principled("leaves", (.10, .23, .045), .85)
    leaf_nodes, leaf_links = leaf.node_tree.nodes, leaf.node_tree.links
    leaf_bsdf = leaf_nodes["Principled BSDF"]
    attribute = leaf_nodes.new("ShaderNodeAttribute")
    attribute.attribute_name = "leaf_uv"
    offset = leaf_nodes.new("ShaderNodeVectorMath")
    offset.operation = "SUBTRACT"
    offset.inputs[1].default_value = (.5, .5, 0)
    leaf_links.new(attribute.outputs["Vector"], offset.inputs[0])
    length = leaf_nodes.new("ShaderNodeVectorMath")
    length.operation = "LENGTH"
    leaf_links.new(offset.outputs[0], length.inputs[0])
    cutout = leaf_nodes.new("ShaderNodeMath")
    cutout.operation = "LESS_THAN"
    cutout.inputs[1].default_value = .48
    leaf_links.new(length.outputs["Value"], cutout.inputs[0])
    leaf_links.new(cutout.outputs[0], leaf_bsdf.inputs["Alpha"])
    root, entries = assets
    leaves = [a for a in entries if a["role"] == "leaf"]
    if leaves:
        entry = leaves[0]
        texture = leaf.node_tree.nodes.new("ShaderNodeTexImage")
        texture.image = bpy.data.images.load(str(root / entry["files"].get("image", entry["files"].get("albedo"))), check_existing=True)
        leaf_links.new(attribute.outputs["Vector"], texture.inputs["Vector"])
        tint = leaf_nodes.new("ShaderNodeHueSaturation")
        tint.inputs["Hue"].default_value = .7
        tint.inputs["Saturation"].default_value = .8
        tint.inputs["Value"].default_value = .65
        leaf_links.new(texture.outputs["Color"], tint.inputs["Color"])
        leaf_links.new(tint.outputs["Color"], leaf_bsdf.inputs["Base Color"])
        for kind in ("normal", "roughness"):
            if kind not in entry["files"]:
                continue
            value = texture_socket(leaf, root / entry["files"][kind], attribute.outputs["Vector"])
            if kind == "normal":
                normal = leaf_nodes.new("ShaderNodeNormalMap")
                normal.inputs["Strength"].default_value = .5
                normal.uv_map = "leaf_uv"
                leaf_links.new(value, normal.inputs["Color"])
                leaf_links.new(normal.outputs["Normal"], leaf_bsdf.inputs["Normal"])
            else:
                leaf_links.new(value, leaf_bsdf.inputs["Roughness"])
        alpha = leaf_nodes.new("ShaderNodeMath")
        alpha.operation = "MULTIPLY"
        leaf_links.new(texture.outputs["Alpha"], alpha.inputs[0])
        leaf_links.new(cutout.outputs[0], alpha.inputs[1])
        leaf_links.new(alpha.outputs[0], leaf_bsdf.inputs["Alpha"])
        if "opacity" in entry["files"]:
            opacity = texture_socket(leaf, root / entry["files"]["opacity"], attribute.outputs["Vector"])
            leaf_links.new(opacity, leaf_bsdf.inputs["Alpha"])
    for i, item in enumerate(data["vegetation"]):
        x, y, z, h, radius = (item[k] for k in ("x", "y", "z", "height", "crown_radius"))
        trunk = Builder()
        trunk.cylinder((x, y, z + h * .3), .12 + radius * .045, h * .6, "z", 0)
        trunk_obj = mesh_object(f"trunk_{i}", trunk.vertices, trunk.faces, trunk.slots, [bark])
        environment_uv(trunk_obj)
        objects.append(trunk_obj)
        crown = Builder()
        crown.sphere((0, 0, 0), 1, 0, rings=8, segments=12)
        obj = mesh_object(f"crown_{i}", crown.vertices, crown.faces, crown.slots, [leaf])
        obj.location = (x, y, z + h * .72)
        obj.scale = (radius, radius, h * .28)
        # Applying measured scale makes GN density use world square metres.
        for vertex in obj.data.vertices:
            vertex.co.x *= radius
            vertex.co.y *= radius
            vertex.co.z *= h * .28
        rng = random.Random(i + scenario["seed"])
        for vertex in obj.data.vertices:
            vertex.co += Vector(tuple(rng.uniform(-.18, .18) * radius for _ in range(3)))
        obj.scale = (1, 1, 1)
        leaf_geometry(obj, leaf, i + scenario["seed"])
        objects.append(obj)
    metal = principled("street_metal", (.14, .16, .17), .35, .65)
    lamp = principled("street_lamp", (.7, .68, .56), .3, emission=(1, .75, .4), strength=8 if night else 0)
    for i, item in enumerate(data["poles"]):
        x, y, z, h = (item[k] for k in ("x", "y", "z", "height"))
        pole = Builder()
        pole.cylinder((x, y, z + h / 2), .09, h, "z", 0)
        pole.box((x + .45, y, z + h), (.9, .12, .12), 0)
        pole.box((x + .8, y, z + h - .08), (.35, .22, .08), 1)
        objects.append(mesh_object(f"pole_{i}", pole.vertices, pole.faces, pole.slots, [metal, lamp]))
        if night:
            light = bpy.data.lights.new(f"pole_light_{i}", "AREA")
            light.energy, light.color, light.shape, light.size = 750, (1, .82, .57), "DISK", 1.5
            light.use_shadow = False
            obj = bpy.data.objects.new(light.name, light)
            obj.location = (x + .8, y, z + h - .15)
            bpy.context.scene.collection.objects.link(obj)
    sidewalk = principled("sidewalk", (.4, .39, .36), .85)
    tex = apply_pbr(sidewalk, "sidewalk", assets)
    if "albedo" in tex:
        sidewalk.node_tree.links.new(tex["albedo"], sidewalk.node_tree.nodes["Principled BSDF"].inputs["Base Color"])
    ground_vertices = np.array([v.co[:] for v in bpy.data.objects["ground"].data.vertices])
    def ground_z(x, y):
        idx = np.argmin(np.sum((ground_vertices[:, :2] - (x, y)) ** 2, axis=1))
        return float(ground_vertices[idx, 2])
    strip = Builder()
    raster_path = directory / layout["ground"]["drivable"]
    road_image = bpy.data.images.load(str(raster_path), check_existing=True)
    w, h = road_image.size
    pixels = np.asarray(road_image.pixels[:]).reshape(h, w, 4)[..., 0]
    bounds = layout["bounds"]
    def is_road(x, y):
        u = int((x - bounds["xmin"]) / (bounds["xmax"] - bounds["xmin"]) * w)
        v = int((y - bounds["ymin"]) / (bounds["ymax"] - bounds["ymin"]) * h)
        return 0 <= u < w and 0 <= v < h and pixels[v, u] > .5
    for edge in data["road_edges"]:
        for a, b in pairwise(edge):
            delta = np.asarray(b) - a
            length = np.linalg.norm(delta)
            if length < .2:
                continue
            normal = np.array([-delta[1], delta[0]]) / length
            mid = (np.asarray(a) + b) / 2
            if is_road(*(mid + normal * .8)):
                normal *= -1
            # Do not add curbs along the raster's artificial outer border.
            if not is_road(*(mid - normal * .8)):
                continue
            outer_a, outer_b = np.asarray(a) + normal * 1.5, np.asarray(b) + normal * 1.5
            z = ground_z(*mid)
            verts = [(float(x), float(y), z + dz) for dz in (0, .15)
                     for x, y in (a, b, outer_b, outer_a)]
            strip._add(verts, [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4),
                               (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)], 0)
    if strip.faces:
        curb_obj = mesh_object("curbs_sidewalk", strip.vertices, strip.faces, strip.slots, [sidewalk])
        environment_uv(curb_obj)
        objects.append(curb_obj)
    print("PROCEDURAL_COUNTS " + json.dumps({"buildings": len(data["buildings"]),
          "trees": len(data["vegetation"]), "poles": len(data["poles"])}), flush=True)
    return objects


def alpha_sampler(material, mesh, polygon, loops, image_cache):
    """Compile the actual Alpha socket and interpolate its UVs at a ray hit.

    Unsupported linked opacity graphs fail closed at build time rather than
    silently producing labels which disagree with the visible material.
    """
    if material is None or not material.use_nodes:
        return None
    bsdfs = [n for n in material.node_tree.nodes if n.type == 'BSDF_PRINCIPLED']
    if not bsdfs:
        raise InputError(f'Unsupported environment shader: {material.name}')
    alpha = bsdfs[0].inputs['Alpha']
    if not alpha.is_linked and alpha.default_value >= .5:
        return None

    def uv_values(name):
        layer = mesh.uv_layers.get(name) if name else mesh.uv_layers.active
        if layer:
            return np.asarray([layer.data[i].uv[:] for i in loops])
        attribute = mesh.attributes.get(name)
        if attribute and attribute.domain == 'CORNER':
            return np.asarray([attribute.data[i].vector[:] for i in loops])[:, :2]
        raise InputError(f'Missing opacity UV {name} on {material.name}')

    def compile_socket(value, depth=0):
        if depth > 20:
            raise InputError('Cyclic environment opacity graph')
        if not value.is_linked:
            constant = value.default_value
            if hasattr(constant, '__len__'):
                constant = np.asarray(constant[:], float)
            return lambda weights: constant
        link = value.links[0]
        node, output = link.from_node, link.from_socket
        if node.type in ('ATTRIBUTE', 'UVMAP', 'TEX_COORD'):
            name = getattr(node, 'attribute_name', getattr(node, 'uv_map', ''))
            if node.type == 'TEX_COORD' and output.name != 'UV':
                raise InputError('Opacity requires UV coordinates')
            coords = uv_values(name)
            return lambda weights: np.append(weights @ coords, 0)
        if node.type == 'VALUE':
            return lambda weights: node.outputs[0].default_value
        if node.type == 'TEX_IMAGE':
            image = node.image
            if image is None:
                raise InputError('Missing opacity image')
            key = image.as_pointer()
            if key not in image_cache:
                w, h = image.size
                pixels = np.empty(w*h*4, np.float32)
                image.pixels.foreach_get(pixels)
                image_cache[key] = pixels.reshape(h, w, 4)
            pixels = image_cache[key]
            if node.inputs['Vector'].is_linked:
                coordinates = compile_socket(node.inputs['Vector'], depth+1)
            else:
                coords = uv_values('')
                coordinates = lambda weights: np.append(weights @ coords, 0)
            def sample(weights):
                uv = np.asarray(coordinates(weights))[:2]
                if node.extension == 'REPEAT':
                    uv = uv % 1
                elif node.extension == 'CLIP' and np.any((uv < 0) | (uv > 1)):
                    return 0.0
                h, w = pixels.shape[:2]
                xy = np.clip(uv, 0, 1) * [w, h] - .5
                if node.interpolation == 'Closest':
                    x, y = np.floor(xy+.5).astype(int)
                    color = pixels[y % h, x % w]
                else:
                    x, y = np.floor(xy).astype(int)
                    fx, fy = xy-[x, y]
                    def pixel(i, j):
                        return pixels[j % h, i % w] if node.extension == 'REPEAT' else pixels[np.clip(j, 0, h-1), np.clip(i, 0, w-1)]
                    color = ((1-fx)*(1-fy)*pixel(x,y) + fx*(1-fy)*pixel(x+1,y)
                             + (1-fx)*fy*pixel(x,y+1) + fx*fy*pixel(x+1,y+1))
                return float(color[3] if output.name == 'Alpha' else np.dot(color[:3], [.2126, .7152, .0722]))
            return sample
        if node.type in ('MATH', 'VECT_MATH'):
            args = [compile_socket(v, depth+1) for v in node.inputs[:2]]
            operation = node.operation
            def calculate(weights):
                a, b = (f(weights) for f in args)
                if operation == 'MULTIPLY':
                    return a*b
                if operation == 'ADD':
                    return a+b
                if operation == 'SUBTRACT':
                    return a-b
                if operation == 'LENGTH':
                    return float(np.linalg.norm(a))
                if operation == 'LESS_THAN':
                    return float(a < b)
                if operation == 'GREATER_THAN':
                    return float(a > b)
                raise InputError(f'Unsupported opacity operation {operation}')
            if operation not in ('MULTIPLY', 'ADD', 'SUBTRACT', 'LENGTH', 'LESS_THAN', 'GREATER_THAN'):
                raise InputError(f'Unsupported opacity operation {operation}')
            return calculate
        raise InputError(f'Unsupported opacity node {node.type}')
    return compile_socket(alpha)


class EnvironmentBVH:
    """World triangles plus opacity-aware casting, shared by both sensor paths."""
    def __init__(self, tree, records, contributions):
        self.tree, self.records, self.contributions = tree, records, contributions

    def ray_cast(self, origin, direction, distance):
        traveled = 0.0
        while traveled < distance:
            location, normal, index, hit = self.tree.ray_cast(origin + direction*traveled, direction, distance-traveled)
            if location is None:
                return None, None, None, None
            record = self.records[index]
            if record is None:
                return location, normal, index, traveled+hit
            a, u, v, gram, sample = record
            delta = np.asarray(location[:])-a
            dot = np.array([delta @ u, delta @ v])
            w1, w2 = gram @ dot
            if sample(np.array([1-w1-w2, w1, w2])) >= .5:
                return location, normal, index, traveled+hit
            traveled += hit + 1e-5
        return None, None, None, None


class InstancedEnvironmentBVH:
    """Exact mesh BVHs shared across instances, with world-space broad phase."""
    def __init__(self, instances, contributions):
        self.instances, self.contributions = instances, contributions
        self.low = np.asarray([i[3] for i in instances])
        self.high = np.asarray([i[4] for i in instances])

    def ray_cast(self, origin, direction, distance):
        o, d = np.asarray(origin), np.asarray(direction)
        parallel = np.abs(d) < 1e-15
        safe_d = np.where(parallel, 1., d)
        a, b = (self.low-o)/safe_d, (self.high-o)/safe_d
        near, far = np.minimum(a, b), np.maximum(a, b)
        near[:, parallel], far[:, parallel] = -np.inf, np.inf
        outside = np.any(parallel & ((o < self.low) | (o > self.high)), axis=1)
        enter, leave = np.maximum(0., near.max(1)), far.min(1)
        candidates = np.flatnonzero(~outside & (leave >= enter) & (enter <= distance))
        best = (None, None, None, None)
        for i in candidates[np.argsort(enter[candidates])]:
            if enter[i] > distance:
                break
            tree, matrix, inverse, _, _ = self.instances[i]
            local_origin = inverse @ origin
            local_direction = inverse.to_3x3() @ direction
            scale = local_direction.length
            if scale <= 1e-15:
                continue
            hit, normal, index, length = tree.ray_cast(local_origin, local_direction / scale, distance * scale)
            if hit is not None:
                distance = length / scale
                best = (matrix @ hit, (inverse.transposed().to_3x3() @ normal).normalized(), index, distance)
        return best


def environment_tree(objects, depsgraph, *, opacity=False):
    if not opacity:
        return _environment_tree(objects, depsgraph)
    instances, contributions, cache, image_cache = [], {}, {}, {}
    for obj in objects:
        evaluated = obj.evaluated_get(depsgraph)
        # Modifiers may depend on object position; only plain shared meshes cache.
        key = ((obj.data.as_pointer(), tuple(s.material.as_pointer() if s.material else 0 for s in obj.material_slots))
               if not obj.modifiers else ('object', obj.as_pointer()))
        if key not in cache:
            cache[key] = _environment_tree([obj], depsgraph, opacity=True, local=True, image_cache=image_cache)
        tree = cache[key]
        if tree is None:
            raise InputError(f'Environment mesh contributes no triangles: {obj.name}')
        matrix = evaluated.matrix_world.copy()
        if abs(matrix.determinant()) < 1e-12:
            raise InputError(f'Singular environment transform: {obj.name}')
        corners = np.asarray([(matrix @ Vector(p))[:] for p in evaluated.bound_box])
        instances.append((tree, matrix, matrix.inverted(), corners.min(0)-1e-5, corners.max(0)+1e-5))
        contributions[obj.name] = len(tree.records)
    return InstancedEnvironmentBVH(instances, contributions) if instances else None


def _environment_tree(objects, depsgraph, *, opacity=False, local=False, image_cache=None):
    """Every evaluated environment triangle contributes in world space."""
    vertices, faces, records, contributions = [], [], [], {}
    image_cache = {} if image_cache is None else image_cache
    for obj in objects:
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        try:
            offset = len(vertices)
            matrix = Matrix.Identity(4) if local else evaluated.matrix_world
            vertices.extend(matrix @ vertex.co for vertex in mesh.vertices)
            if not opacity:
                faces.extend(tuple(offset + index for index in polygon.vertices) for polygon in mesh.polygons)
                continue
            mesh.calc_loop_triangles()
            contributions[obj.name] = len(mesh.loop_triangles)
            if not mesh.loop_triangles:
                raise InputError(f'Environment mesh contributes no triangles: {obj.name}')
            for tri in mesh.loop_triangles:
                faces.append(tuple(offset+i for i in tri.vertices))
                polygon = mesh.polygons[tri.polygon_index]
                material = mesh.materials[polygon.material_index] if polygon.material_index < len(mesh.materials) else None
                sample = alpha_sampler(material, mesh, polygon, tri.loops, image_cache)
                record = None
                if sample:
                    a, b, c = (np.asarray(vertices[offset+i][:]) for i in tri.vertices)
                    u, v = b-a, c-a
                    gram = np.array([[u@u, u@v], [u@v, v@v]])
                    if abs(np.linalg.det(gram)) > 1e-16:
                        record = (a, u, v, np.linalg.inv(gram), sample)
                records.append(record)
        finally:
            evaluated.to_mesh_clear()
    tree = BVHTree.FromPolygons(vertices, faces, all_triangles=opacity) if opacity and faces else (BVHTree.FromPolygons(vertices, faces) if faces else None)
    return EnvironmentBVH(tree, records, contributions) if opacity and tree else tree


def build_environment_assets(directory, layout, scenario, pbr):
    path = Path(__file__).resolve().parents[1] / 'env_assets.py'
    spec = importlib.util.spec_from_file_location('env_contracts', path)
    rules = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(rules)
    root = Path(__file__).resolve().parents[3] / 'assets'
    manifest = json.loads((root/'env_manifest.json').read_text())
    if not isinstance(manifest, list):
        raise InputError('Environment manifest must be a list')
    procedural_path = (directory/layout.get('photo', {}).get('procedural', 'procedural.json')).resolve()
    if not procedural_path.is_relative_to(directory.resolve()):
        raise InputError('unsafe photo.procedural path')
    data = json.loads(procedural_path.read_text())
    drivable = load_paint(directory, {'ground': {'paint': layout['ground']['drivable']}})[::-1]
    manifest = region_assets(manifest, scenario.get('region_style', 'sg'), 'kind', scenario.setdefault('region_fallback', []))
    try:
        plan = rules.plan_environment(data, manifest, drivable, layout['bounds'], layout['actors'], scenario['seed'])
    except (ValueError, TypeError, KeyError) as exc:
        raise InputError(f'Invalid environment placement input: {exc}') from exc
    fallback = {**data, 'buildings': plan['fallback_buildings'], 'vegetation': [], 'poles': [], 'road_edges': []}
    objects = build_procedural(directory, layout, scenario, pbr, data_override=fallback)
    selected = {p['asset_id'] for p in plan['placements']}
    entries = {}
    for entry in manifest:
        try:
            rules.validate_asset(entry, entry.get('mesh_names', []) + entry.get('material_names', []))
        except (ValueError, TypeError, KeyError, AttributeError):
            continue
        if entry['asset_id'] in selected:
            entries.setdefault(entry['asset_id'], entry)
    templates = {}
    for i, placement in enumerate(plan['placements']):
        entry = entries[placement['asset_id']]
        if entry['asset_id'] not in templates:
            asset_path = (root/'env'/entry['file']).resolve()
            if not asset_path.is_relative_to((root/'env').resolve()) or not asset_path.is_file() or asset_path.suffix != '.blend':
                raise InputError('Environment requires normalized local .blend assets')
            with bpy.data.libraries.load(str(asset_path), link=False) as (source, target):
                target.objects = source.objects
            imported = [o for o in target.objects if o is not None]
            meshes = [o for o in imported if o.type == 'MESH']
            for obj in imported:
                if obj.type != 'MESH':
                    bpy.data.objects.remove(obj, do_unlink=True)
            try:
                rules.validate_asset(entry, [o.name for o in meshes] + [m.name for o in meshes for m in o.data.materials if m])
            except ValueError as exc:
                raise InputError(f'Invalid environment geometry: {exc}') from exc
            if not meshes:
                raise InputError('Environment asset has no meshes')
            points = np.asarray([(o.matrix_world @ v.co)[:] for o in meshes for v in o.data.vertices])
            if not len(points):
                raise InputError('Environment asset has no vertices')
            low, high = points.min(0), points.max(0)
            native = np.asarray(entry['native_size'])
            if (not np.isfinite(points).all() or not np.allclose(high-low, native, rtol=.01, atol=.01)
                    or not np.allclose((low+high)[:2]/2, 0, atol=.01) or abs(low[2]) > .01):
                raise InputError('Environment asset geometry disagrees with normalized manifest bounds')
            if 'collision_parts' in entry:
                normalizer_spec = importlib.util.spec_from_file_location('env_normalizer', Path(__file__).with_name('normalize_env_assets.py'))
                normalizer = importlib.util.module_from_spec(normalizer_spec)
                normalizer_spec.loader.exec_module(normalizer)
                for obj in meshes:
                    bpy.context.scene.collection.objects.link(obj)
                measured = normalizer.collision_metadata(meshes, rules)
                for obj in meshes:
                    bpy.context.scene.collection.objects.unlink(obj)
                expected = np.asarray([[p['min'], p['max']] for p in entry['collision_parts']])
                actual = np.asarray([[p['min'], p['max']] for p in measured['collision_parts']])
                if (actual.shape != expected.shape or not np.allclose(actual, expected, rtol=0, atol=1e-5)
                        or abs(measured['canopy_min_z'] - entry['canopy_min_z']) > 1e-5):
                    raise InputError('Tree collision metadata disagrees with evaluated geometry')
            # Reuse verified mesh/material data; each placement remains a real BVH mesh.
            templates[entry['asset_id']] = [(o, o.matrix_world.copy()) for o in meshes]
        imported = []
        for template, matrix in templates[entry['asset_id']]:
            obj = template.copy()
            obj.matrix_world = matrix.copy()
            imported.append(obj)
        transform = Matrix.Translation((placement['x'], placement['y'], placement['z'])) @ Matrix.Rotation(placement['yaw'], 4, 'Z') @ Matrix.Diagonal((*placement['scale'], 1))
        for obj in imported:
            if obj.type != 'MESH':
                bpy.data.objects.remove(obj, do_unlink=True)
                continue
            obj.name = f'env_{i}_{obj.name}'
            obj.parent = None
            obj.matrix_world = transform @ obj.matrix_world
            bpy.context.scene.collection.objects.link(obj)
            objects.append(obj)
        if placement['kind'] == 'lamp' and is_night(scenario):
            light = bpy.data.lights.new(f'pole_light_asset_{i}', 'AREA')
            light.energy, light.size, light.use_shadow = 750, 1.5, False
            obj = bpy.data.objects.new(light.name, light)
            obj.location = (placement['x'], placement['y'], placement['z']+entry['native_size'][2]*placement['scale'][2])
            bpy.context.scene.collection.objects.link(obj)
    for group in templates.values():
        for obj, _ in group:
            bpy.data.objects.remove(obj, do_unlink=True)
    print('ENV_ASSET_PLAN ' + json.dumps(plan), flush=True)
    return objects


def procedural_hdri(scenario, assets):
    root, entries = assets
    w = scenario["weather"]
    night = is_night(scenario)
    role = ("hdri_night" if night else "hdri_dusk" if w["sun_altitude_angle"] < 10 else
            "hdri_overcast" if w["cloudiness"] > 50 else "hdri_day")
    choices = [a for a in entries if a["role"] == role]
    world = bpy.context.scene.world
    nodes, links = world.node_tree.nodes, world.node_tree.links
    if choices:
        texture = nodes.new("ShaderNodeTexEnvironment")
        texture.image = bpy.data.images.load(str(root / choices[0]["files"]["hdri"]), check_existing=True)
        links.new(texture.outputs["Color"], nodes["Background"].inputs["Color"])
        nodes["Background"].inputs["Strength"].default_value = .12 if night else .7
    # S11 amendment: photographed HDRI foreground must not become oversized scenery.
    # Camera rays see an analytic sky; HDRI illumination and reflections are preserved.
    camera_sky = nodes.new("ShaderNodeBackground")
    if night:
        camera_sky.inputs["Color"].default_value = (.005, .007, .013, 1)
    else:
        sky = nodes.new("ShaderNodeTexSky")
        sky.sky_type = "MULTIPLE_SCATTERING"
        sky.sun_elevation = math.radians(max(w["sun_altitude_angle"], .1))
        sky.sun_rotation = math.radians(w["sun_azimuth_angle"])
        sky.sun_disc = False
        clouds = nodes.new("ShaderNodeMixRGB")
        clouds.inputs[0].default_value = w["cloudiness"] / 100
        clouds.inputs[2].default_value = (.55, .57, .6, 1)
        links.new(sky.outputs["Color"], clouds.inputs[1])
        links.new(clouds.outputs[0], camera_sky.inputs["Color"])
        camera_sky.inputs["Strength"].default_value = .25
    path = nodes.new("ShaderNodeLightPath")
    mix = nodes.new("ShaderNodeMixShader")
    links.new(path.outputs["Is Camera Ray"], mix.inputs[0])
    links.new(nodes["Background"].outputs[0], mix.inputs[1])
    links.new(camera_sky.outputs[0], mix.inputs[2])
    links.new(mix.outputs[0], nodes["World Output"].inputs["Surface"])
    if hasattr(bpy.context.scene.eevee, "shadow_pool_size"):
        bpy.context.scene.eevee.shadow_pool_size = "512"
    if hasattr(bpy.context.scene.eevee, "use_raytracing"):
        bpy.context.scene.eevee.use_raytracing = True



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


def region_assets(manifest, region, field="class", fallback=None):
    """Filter independently per class/kind, preserving legacy manifest order."""
    result = []
    for kind in dict.fromkeys(entry[field] for entry in manifest):
        entries = [entry for entry in manifest if entry[field] == kind]
        selected = [entry for entry in entries if region in entry.get("region", ["sg", "vn"])]
        if not selected:
            selected = entries
            if fallback is not None and kind not in fallback:
                fallback.append(kind)
        result.extend(selected)
    return result


def select_library_asset(manifest, actor, seed, region="sg", fallback=None):
    """Closest shape among same-class assets respecting the 1.3 distortion cap."""
    target = np.asarray(actor["size"], dtype=float)
    if target.shape != (3,) or not np.isfinite(target).all() or (target <= 0).any():
        raise InputError(f"Invalid actor size: {actor['track']}")
    candidates = []
    for asset in region_assets(manifest, region, fallback=fallback):
        if asset["class"] != actor["label"]:
            continue
        native = np.asarray(asset["native_size"], dtype=float)
        if native.shape != (3,) or not np.isfinite(native).all() or (native <= 0).any():
            raise InputError(f"Invalid native_size for {asset['asset_id']}")
        scale = target / native
        if scale.max() / scale.min() <= 1.3 + 1e-9:
            shape = np.log(scale)
            candidates.append((float(np.linalg.norm(shape - shape.mean())), asset, scale))
    if not candidates:
        return None, None
    if region == "vn":
        preferred = [item for item in candidates if item[1].get("quality") == "detailed"
                     and "vn" in item[1].get("region", [])]
        candidates = preferred or candidates
    best = min(item[0] for item in candidates)
    tied = sorted((item for item in candidates if abs(item[0] - best) < 1e-9),
                  key=lambda item: item[1]["asset_id"])
    rng = random.Random(seed ^ zlib.crc32(actor["track"].encode()))
    _, asset, scale = rng.choice(tied)
    return asset, scale


def load_library_manifest():
    directory = Path(__file__).resolve().parents[3] / "assets"
    path = directory / "library_manifest.json"
    if not path.is_file():
        return [], directory
    try:
        manifest = json.loads(path.read_text())
        if not isinstance(manifest, list):
            raise TypeError("manifest must be a list")
        ids = set()
        for asset in manifest:
            if not isinstance(asset["asset_id"], str) or not asset["asset_id"]:
                raise ValueError("asset_id must be a non-empty string")
            native = np.asarray(asset["native_size"], dtype=float)
            if native.shape != (3,) or not np.isfinite(native).all() or (native <= 0).any():
                raise ValueError("native_size must contain three positive finite dimensions")
            if not isinstance(asset["file"], str):
                raise TypeError("file must be a string")
            if asset["asset_id"] in ids:
                raise ValueError("duplicate asset_id")
            ids.add(asset["asset_id"])
            if asset["license"] not in ("CC0", "CC-BY"):
                raise ValueError("license must be CC0 or CC-BY")
            if asset["license"] == "CC-BY" and not asset.get("attribution"):
                raise ValueError("CC-BY requires attribution")
            if asset["forward_axis"] != "+X" or asset["up_axis"] not in ("Z", "+Z"):
                raise ValueError("assets must be normalized to +X forward, Z up")
            if type(asset.get("animated", False)) is not bool:
                raise TypeError("animated must be bool")
            if asset.get("paint_material") is not None and not isinstance(asset["paint_material"], str):
                raise TypeError("paint_material must be a name or null")
            region = asset.get("region", ["sg", "vn"])
            if (not isinstance(region, list) or not region or len(set(region)) != len(region)
                    or any(value not in ("sg", "vn") for value in region)):
                raise ValueError("region must be a nonempty list of sg/vn")
            if asset["class"] == "rider":
                seat = np.asarray(asset["seat_offset"], dtype=float)
                if seat.shape != (3,) or not np.isfinite(seat).all():
                    raise ValueError("seat_offset must contain three finite values")
            if asset["class"] == "pedestrian" and asset.get("animated"):
                for key in ("walk_speed_mps", "cycle_frames", "fps"):
                    value = asset[key]
                    if (isinstance(value, bool) or not isinstance(value, (int, float))
                            or not math.isfinite(value) or value <= 0):
                        raise ValueError(f"{key} must be positive and finite")
                if not isinstance(asset["walk_action"], str) or not asset["walk_action"]:
                    raise ValueError("walk_action must name a Blender action")
                if asset.get("idle_action") is not None and not isinstance(asset["idle_action"], str):
                    raise TypeError("idle_action must be a name or null")
        return manifest, directory
    except (OSError, ValueError, KeyError, TypeError) as exc:
        raise InputError(f"Invalid library manifest: {exc}") from exc


def import_library_actor(asset, scale, directory, name, color, night):
    """Preserve rigs and local transforms under an unscaled box-coordinate root."""
    relative = Path(asset["file"])
    path = (directory / relative).resolve()
    library = (directory / "library").resolve()
    if not path.is_file():
        path = (library / relative).resolve()
    if relative.is_absolute() or not path.is_relative_to(library):
        raise InputError(f"Asset path outside library: {asset['file']}")
    if not path.is_file():
        raise InputError(f"Missing library asset: {path}")
    if path.suffix == ".blend":
        with bpy.data.libraries.load(str(path), link=False) as (source, loaded):
            action_names = list(source.actions)
            loaded.objects = source.objects
            loaded.actions = source.actions
        objects = [obj for obj in loaded.objects if obj is not None]
        actions = {name: action for name, action in zip(action_names, loaded.actions, strict=True)
                   if action}
        for obj in objects:
            bpy.context.scene.collection.objects.link(obj)
    elif path.suffix == ".glb":
        previous = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=str(path))
        objects = list(set(bpy.data.objects) - previous)
        actions = {}
    else:
        raise InputError(f"Unsupported library asset: {path.suffix}")
    root = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(root)
    scaled = bpy.data.objects.new(name + "_scale", None)
    bpy.context.scene.collection.objects.link(scaled)
    scaled.parent = root
    scaled.scale = scale
    for obj in objects:
        if obj.parent not in objects:
            obj.parent = scaled
        if obj.type == "LIGHT":
            obj.data = obj.data.copy()
            if not night:
                obj.data.energy = 0
        if obj.type != "MESH":
            continue
        for slot in obj.material_slots:
            if slot.material is None:
                continue
            material = slot.material.copy()
            slot.link = "OBJECT"
            slot.material = material
            for node in material.node_tree.nodes if material.use_nodes else ():
                if node.type != "BSDF_PRINCIPLED":
                    continue
                paint_name = asset.get("paint_material")
                if color is not None and paint_name and (material.name == paint_name
                        or (material.name.startswith(paint_name + ".")
                            and material.name.rsplit(".", 1)[-1].isdigit())):
                    socket = node.inputs.get("Base Color")
                    for link in list(socket.links):
                        material.node_tree.links.remove(link)
                    socket.default_value = (*color, 1.0)
                lower = material.name.lower()
                strength = node.inputs.get("Emission Strength")
                if strength and ("headlight" in lower or "taillight" in lower):
                    strength.default_value = (20.0 if "headlight" in lower else 8.0) if night else 0.0
    if not any(obj.type == "MESH" for obj in objects):
        raise InputError(f"Library asset has no mesh: {asset['asset_id']}")
    if asset["class"] == "pedestrian" and asset.get("animated"):
        if path.suffix == ".glb":
            actions = {obj.animation_data.action.name: obj.animation_data.action
                       for obj in objects if obj.animation_data and obj.animation_data.action}
            for key in ("walk_action", "idle_action"):
                name = asset.get(key)
                if name and name not in actions:
                    matches = [action for original, action in actions.items()
                               if original.startswith(name + ".")
                               and original.rsplit(".", 1)[-1].isdigit()]
                    if len(matches) == 1:
                        actions[name] = matches[0]
        walk = actions.get(asset["walk_action"])
        idle = actions.get(asset.get("idle_action"))
        if walk is None:
            raise InputError(f"Missing walk action: {asset['asset_id']}")
        if asset.get("idle_action") and idle is None:
            raise InputError(f"Missing idle action: {asset['asset_id']}")
        # Each imported rig gets its own actions and evaluation time.
        for obj in objects:
            if obj.type == "ARMATURE" or (obj.animation_data and obj.animation_data.action):
                obj.animation_data_create()
                obj.animation_data.action = walk.copy()
                obj["library_walk_action"] = obj.animation_data.action.name
                obj["library_idle_action"] = idle.copy().name if idle else ""
                obj["library_walk_speed"] = asset["walk_speed_mps"] * float(scale[2])
                obj["library_cycle_frames"] = asset["cycle_frames"]
                obj["library_fps"] = asset["fps"]
    return root


def attach_rider(root, actor, manifest, directory, scenario):
    """Attach seated geometry in box coordinates; actor_tree inherits the vehicle owner."""
    length, width, height = actor["size"]
    region = scenario.get("region_style", "sg")
    fallbacks = scenario.setdefault("region_fallback", [])
    rider_size = [min(0.8, length * 0.5), width * 0.65, height * 0.63]
    rider_actor = {"track": actor["track"], "label": "rider", "size": rider_size}
    asset, scale = select_library_asset(manifest, rider_actor, scenario["seed"], region, fallbacks)
    if asset:
        rider = import_library_actor(asset, scale, directory, root.name + "_rider", None, is_night(scenario))
        # Normalized seat landmark anchors the seated pose to the vehicle saddle.
        seat = np.asarray(asset["seat_offset"]) * scale
        rider.location = Vector((-0.1 * length, 0, 0.0)) - Vector(seat)
        rider.parent = root
        top = rider.location.z + rider_size[2] / 2
        cap = height / 2 - (0.14 if region == "vn" and not asset.get("has_helmet") else 0)
        rider.location.z -= max(0, top - cap)
        actor["rider_asset_id"] = asset["asset_id"]
    else:
        parts = Builder()
        # Bent legs straddle the saddle; torso and head stay within the actor box.
        parts.box((-0.1 * length, 0, height * 0.15), (length * 0.17, width * 0.55, height * 0.32), 0)
        parts.box((-0.03 * length, 0, -height * 0.03), (length * 0.30, width * 0.58, height * 0.10), 1)
        for side in (-1, 1):
            parts.box((length * 0.08, side * width * 0.26, -height * 0.15),
                      (length * 0.09, width * 0.14, height * 0.28), 1)
            parts.box((length * 0.04, side * width * 0.22, height * 0.18),
                      (length * 0.30, width * 0.12, height * 0.08), 0)
        parts.box((-0.08 * length, 0, height * 0.37), (height * 0.15, width * 0.36, height * 0.13), 2)
        rider = mesh_object(root.name + "_rider", parts.vertices, parts.faces, parts.slots,
                            (principled("rider_jacket", (0.02, 0.35, 0.1)),
                             principled("rider_trousers", (0.02, 0.03, 0.05)),
                             principled("rider_skin", (0.45, 0.25, 0.15))))
        rider.parent = root
        actor["rider_appearance"] = "procedural"
    if region == "vn" and not (asset and asset.get("has_helmet")):
        helmet_actor = {"track": actor["track"], "label": "helmet", "size": [height * 0.18, width * 0.42, height * 0.13]}
        helmet_asset, helmet_scale = select_library_asset(manifest, helmet_actor, scenario["seed"], region, fallbacks)
        if helmet_asset:
            helmet = import_library_actor(helmet_asset, helmet_scale, directory, root.name + "_helmet", None, False)
            actor["helmet_asset_id"] = helmet_asset["asset_id"]
        else:
            parts = Builder()
            parts.box((0, 0, 0), helmet_actor["size"], 0)
            helmet = mesh_object(root.name + "_helmet", parts.vertices, parts.faces, parts.slots,
                                 (principled("rider_helmet", (0.015, 0.45, 0.07)),))
        helmet.parent = root
        helmet.location = (-0.08 * length, 0, height / 2 - helmet_actor["size"][2] / 2)


def build_actors(layout, scenario, observed_colors=None):
    night = is_night(scenario)
    glass = principled("glass", (0.01, 0.01, 0.012), roughness=0.05, metallic=0.2)
    tyre = principled("tyre", (0.015, 0.015, 0.015), roughness=0.8)
    head = principled("headlight", (0.9, 0.9, 0.85), emission=(1.0, 0.95, 0.85),
                      strength=20.0 if night else 0.0)
    tail = principled("taillight", (0.5, 0.02, 0.02), emission=(1.0, 0.02, 0.02),
                      strength=8.0 if night else 0.0)
    grey = principled("body_grey", (0.4, 0.4, 0.4), roughness=0.4)
    manifest, library_dir = load_library_manifest()
    if scenario.get("region_style", "sg") == "vn":
        # Median paint RGB from locally inspected VN reference body ROIs (S13 §6).
        observed_colors = [[158, 254, 253], [225, 228, 235], [222, 184, 199]]
    if observed_colors is None:
        observed_colors = [a["color"] for a in layout["actors"] if "color" in a
                           and a.get("origin", "recorded") != "generated"]
    actors = []
    for index, actor in enumerate(layout["actors"]):
        rng = random.Random(scenario["seed"] ^ zlib.crc32(actor["track"].encode()))
        actor.setdefault("origin", "generated" if actor["track"].startswith("gen:") else "recorded")
        for flag in ("rider", "with_rider"):
            if actor.get(flag) is not None and type(actor[flag]) is not bool:
                raise InputError(f"{flag} must be bool or null")
        has_rider = (actor["label"] in ("motorcycle", "bicycle")
                     and (actor.get("rider") is True or actor.get("with_rider") is True))
        body_actor = {**actor, "size": [*actor["size"][:2], actor["size"][2] * 0.72]} if has_rider else actor
        asset, scale = select_library_asset(manifest, body_actor, scenario["seed"],
                                            scenario.get("region_style", "sg"), scenario.setdefault("region_fallback", []))
        color = actor.get("color")
        if actor["origin"] == "generated" and observed_colors and actor["label"] != "pedestrian":
            color = rng.choice(observed_colors)
            actor["color"] = list(color)
        if color is not None and (not isinstance(color, list) or len(color) != 3
                or any(type(v) is not int or not 0 <= v <= 255 for v in color)):
            raise InputError(f"Invalid actor color: {actor['track']}")
        rgb = None if color is None else tuple((v / 255 / 12.92 if v / 255 <= 0.04045
                  else ((v / 255 + 0.055) / 1.055) ** 2.4) for v in color)
        if asset is not None and actor["label"] not in ("barrier", "traffic_cone"):
            obj = import_library_actor(asset, scale, library_dir, f"actor_{index:04d}",
                                       rgb if actor["label"] != "pedestrian" else None, night)
            actor.update(appearance="library", asset_id=asset["asset_id"])
            if has_rider:
                # Align the shorter vehicle body to the original box floor.
                for child in obj.children:
                    child.location.z -= (actor["size"][2] - body_actor["size"][2]) / 2
                attach_rider(obj, actor, manifest, library_dir, scenario)
            for child in [obj, *obj.children_recursive]:
                if child.type == "MESH":
                    child.pass_index = index + 1
            obj["track"] = actor["track"]
            timestamps = {f["index"]: f["timestamp_us"] / 1e6 for f in layout["frames"]}
            for key in actor["keys"]:
                obj[f"time_{key['frame']}"] = timestamps[key["frame"]]
            actors.append((obj, actor, {key["frame"]: key for key in actor["keys"]}))
            continue
        actor["appearance"] = "procedural"
        actor.pop("asset_id", None)
        if actor["label"] == "pedestrian":
            body = principled(f"ped_{index}", (rng.uniform(0.05, 0.6),) * 3, roughness=0.9)
        elif actor["label"] in ("barrier", "traffic_cone"):
            body = principled(f"obstacle_{index}", (0.8, 0.3, 0.05), roughness=0.6)
        elif rgb is not None:
            body = principled(f"paint_{index}", rgb, roughness=0.35, metallic=0.3)
        elif scenario["traffic"]["color_randomization"]:
            body = principled(f"paint_{index}", rng.choice(CAR_COLORS), roughness=0.35,
                              metallic=0.3)
        else:
            body = grey
        parts = actor_geometry(actor["label"], body_actor["size"])
        if has_rider:
            dz = (actor["size"][2] - body_actor["size"][2]) / 2
            extent_x = max(abs(v[0]) for v in parts.vertices)
            fit_x = min(1.0, actor["size"][0] / (2 * extent_x))
            parts.vertices = [(x * fit_x, y, z - dz) for x, y, z in parts.vertices]
        obj = mesh_object(f"actor_{index:04d}", parts.vertices, parts.faces, parts.slots,
                          (body, glass, tyre, head, tail))
        if has_rider:
            attach_rider(obj, actor, manifest, library_dir, scenario)
        for child in [obj, *obj.children_recursive]:
            if child.type == "MESH":
                child.pass_index = index + 1
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
        for child in obj.children_recursive:
            child.hide_render = obj.hide_render
            if key is not None and "library_walk_action" in child:
                timeline = sorted(keys.values(), key=lambda item: obj[f"time_{item['frame']}"])
                distance = 0.0
                speed = 0.0
                for previous, current in pairwise(timeline):
                    dt = obj[f"time_{current['frame']}"] - obj[f"time_{previous['frame']}"]
                    step = float(np.linalg.norm(np.asarray(current["center"][:2])
                                                - previous["center"][:2]))
                    if current["frame"] <= frame:
                        distance += step
                    if current["frame"] == frame or (previous is timeline[0]
                                                      and previous["frame"] == frame):
                        speed = step / max(dt, 1e-6)
                walking = speed >= 0.2
                name = child["library_walk_action"] if walking else child["library_idle_action"]
                for track in list(child.animation_data.nla_tracks):
                    child.animation_data.nla_tracks.remove(track)
                child.animation_data.action = bpy.data.actions.get(name) if name else None
                action = child.animation_data.action
                if action is None and child.type == "ARMATURE":
                    for bone in child.pose.bones:
                        bone.matrix_basis = Matrix.Identity(4)
                if action:
                    start = float(action.frame_range[0])
                    phase = distance / child["library_walk_speed"] * child["library_fps"]
                    evaluation_frame = start + phase % child["library_cycle_frames"] if walking else start
                    # NLA time remapping permits independent actor phases in one scene.
                    child.animation_data.action = None
                    track = child.animation_data.nla_tracks.new()
                    strip = track.strips.new("library_pose", 0, action)
                    strip.use_animated_time = True
                    strip.strip_time = evaluation_frame
    bpy.context.view_layer.update()


def actor_heading_checks(actors, frame):
    """Compare the placed native +X axis to the recorded/generated box yaw."""
    checks = {}
    for obj, actor, keys in actors:
        key = keys.get(frame)
        if (key is None or obj.hide_render
                or actor["label"] not in VEHICLES | {"motorcycle", "bicycle"}):
            continue
        forward = np.asarray(obj.matrix_world)[:2, 0]
        placed = math.atan2(float(forward[1]), float(forward[0]))
        difference = placed - key["yaw"]
        error = math.degrees(math.atan2(math.sin(difference), math.cos(difference)))
        checks[actor["track"]] = {"asset_id": actor.get("asset_id"),
                                  "box_yaw_rad": key["yaw"],
                                  "placed_forward_rad": placed,
                                  "error_deg": round(error, 6)}
    return checks


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
    preset = dict(PRESETS.get(weather["preset"], PRESETS["day"]))
    if scenario.get("schema", 1) == 2:
        cloud = max(weather["cloudiness"], weather["precipitation"]) / 100
        night = is_night(scenario)
        preset["night"] = night
        preset["sun"] = 0 if night else 4 * (1 - 0.8 * weather["cloudiness"] / 100)
        preset["world"] = ((0.01, 0.012, 0.02) if night else
                           tuple((1 - cloud) * c + cloud * 0.4 for c in (0.55, 0.7, 0.9)))
        # fog_distance is a web preview control; Blender's volume is homogeneous.
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
        if scenario.get("schema", 1) == 2:
            altitude, azimuth = map(math.radians, (weather["sun_altitude_angle"],
                                                  weather["sun_azimuth_angle"]))
            direction = Vector((math.cos(altitude) * math.cos(azimuth),
                                math.cos(altitude) * math.sin(azimuth), math.sin(altitude)))
            obj.rotation_euler = (-direction).to_track_quat('-Z', 'Y').to_euler()
        else:
            obj.rotation_euler = (math.radians(45), 0.0, math.radians(30))
        bpy.context.scene.collection.objects.link(obj)
    if preset["night"] and scenario.get("environment", "voxel") not in ("procedural", "assets"):
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
    if not is_night(scenario):
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
        for mesh in [obj, *obj.children_recursive]:
            if mesh.type != "MESH":
                continue
            evaluated = mesh.evaluated_get(bpy.context.evaluated_depsgraph_get())
            data = evaluated.to_mesh()
            try:
                start = len(vertices)
                vertices += [evaluated.matrix_world @ v.co for v in data.vertices]
                for polygon in data.polygons:
                    faces.append([start + i for i in polygon.vertices])
                    owner.append(actor["track"])
            finally:
                evaluated.to_mesh_clear()
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


def lidar_scan(frame, layout, scenario, trees, paint, bounds, *, drivable=None):
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
        value = 0.0
        if kind == "ground":
            u = int((location.x - bounds["xmin"]) / layout["ground"]["tex_res_m"])
            v = int((location.y - bounds["ymin"]) / layout["ground"]["tex_res_m"])
            value = paint[v, u] if 0 <= v < paint.shape[0] and 0 <= u < paint.shape[1] else 0
        if scenario.get("schema", 1) == 2:
            reflectivity = 0.1 + 0.8 * value * fade if kind == "ground" else (
                0.5 if kind == "actor" else 0.3)
            puddle = (kind == "ground" and (drivable is None or
                      (0 <= v < drivable.shape[0] and 0 <= u < drivable.shape[1] and drivable[v, u] > 0))
                      and puddle_value(location.x, location.y)
                      < puddle_threshold(weather["precipitation_deposits"] / 100))
            returned = lidar_return(reflectivity, distance, scenario["lidar"], weather, rng,
                                    ground=kind == "ground", puddle=puddle)
            if returned is None:
                continue
            distance, intensity = returned
        else:
            drop = weather["rain_drop_rate"] + (1 - math.exp(-2 * weather["fog_density"] * distance))
            if rng.random() < drop:
                continue
            distance += rng.normal(0, 0.02 + 0.5 * weather["fog_density"])
            intensity = ((20 + 200 * value * fade) * wet if kind == "ground" else
                         40.0 if kind == "actor" else 30.0)
        world = np.asarray(origin) + direction * distance
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


def export_web_environment(objects, out):
    """Export isolated evaluated copies; never modify render/BVH source geometry."""
    started = time.perf_counter()
    source_scene = bpy.context.window.scene
    depsgraph = bpy.context.evaluated_depsgraph_get()
    allowed = {obj for root in objects for obj in (root, *root.children_recursive)}
    copies, meshes, materials, images, node_groups = [], [], {}, {}, {}

    def copy_textures(tree):
        for node in tree.nodes:
            if node.type == "GROUP" and node.node_tree is not None:
                original_tree = node.node_tree
                if original_tree not in node_groups:
                    node_groups[original_tree] = original_tree.copy()
                    copy_textures(node_groups[original_tree])
                node.node_tree = node_groups[original_tree]
            if node.type != "TEX_IMAGE" or node.image is None:
                continue
            original = node.image
            if original not in images:
                image = original.copy()
                images[original] = image
                width, height = image.size
                if max(width, height) > 1024:
                    ratio = 1024 / max(width, height)
                    image.scale(max(1, round(width * ratio)), max(1, round(height * ratio)))
                image.pack()
            node.image = images[original]

    export_scene = bpy.data.scenes.new("web_environment_export")
    temporary = out / "environment.tmp.glb"
    try:
        for instance in depsgraph.object_instances:
            obj = instance.object
            owner = instance.parent.original if instance.is_instance and instance.parent else obj.original
            if owner not in allowed or obj.type != "MESH" or owner.hide_render:
                continue
            mesh = bpy.data.meshes.new_from_object(obj, preserve_all_data_layers=True, depsgraph=depsgraph)
            meshes.append(mesh)
            copy = bpy.data.objects.new(obj.name, mesh)
            export_scene.collection.objects.link(copy)
            copy.matrix_world = instance.matrix_world.copy()
            copies.append(copy)
            for slot, material in enumerate(mesh.materials):
                if material is None:
                    continue
                if material not in materials:
                    clone = material.copy()
                    materials[material] = clone
                    if clone.use_nodes:
                        copy_textures(clone.node_tree)
                mesh.materials[slot] = materials[material]
        bpy.context.window.scene = export_scene
        def triangles():
            total = 0
            for obj in copies:
                obj.data.calc_loop_triangles()
                total += len(obj.data.loop_triangles)
            return total
        total = triangles()
        for _ in range(4):
            if total <= 1_500_000:
                break
            for obj in copies:
                if len(obj.data.loop_triangles) < 20:
                    continue
                bpy.context.view_layer.objects.active = obj
                modifier = obj.modifiers.new("Web budget", "DECIMATE")
                modifier.ratio = min(.95, 1_400_000 / total)
                bpy.ops.object.modifier_apply(modifier=modifier.name)
            total = triangles()
        if not total or total > 1_500_000:
            raise InputError(f"Web environment triangle budget exceeded or empty: {total}")
        bpy.ops.export_scene.gltf(filepath=str(temporary), export_format="GLB",
                                  use_active_scene=True, export_yup=True,
                                  export_animations=False, export_cameras=False,
                                  export_lights=False)
        size = temporary.stat().st_size
        if size > 150_000_000:
            raise InputError(f"Web environment exceeds 150 MB: {size}")
        temporary.replace(out / "environment.glb")
        result = {"environment_export_s": round(time.perf_counter() - started, 3),
                  "environment_triangles": total, "environment_bytes": size}
        print("WEB_ENV " + json.dumps(result), flush=True)
        return result
    finally:
        bpy.context.window.scene = source_scene
        bpy.data.scenes.remove(export_scene)
        for obj in copies:
            bpy.data.objects.remove(obj, do_unlink=True)
        for mesh in meshes:
            if mesh.users == 0:
                bpy.data.meshes.remove(mesh)
        for material in materials.values():
            bpy.data.materials.remove(material)
        for group in node_groups.values():
            bpy.data.node_groups.remove(group)
        for image in images.values():
            bpy.data.images.remove(image)
        temporary.unlink(missing_ok=True)


def run(layout_path, scenario_path, out, render, lidar, save_blend, actors_path=None, export_env_only=False):
    directory = layout_path.parent
    layout = load_layout(layout_path)
    observed_colors = [a["color"] for a in layout["actors"] if "color" in a
                       and a.get("origin", "recorded") != "generated"]
    previous_run = None
    if export_env_only:
        previous_run = json.loads((out / "run.json").read_text())
        scenario = copy.deepcopy(previous_run["scenario"])
        if (out / "actors.json").is_file():
            actors_path = out / "actors.json"
        if scenario.get("environment") not in ("procedural", "assets"):
            raise InputError("Export-only requires a procedural/assets run")
    else:
        scenario = load_scenario(scenario_path, layout)
    if actors_path is not None:
        try:
            actors = json.loads(actors_path.read_text())
        except (OSError, ValueError) as exc:
            raise InputError(f"Cannot read actors {actors_path}: {exc}") from exc
        if not isinstance(actors, list):
            raise InputError("Actors must be a list")
        tracks = set()
        indices = {frame["index"] for frame in layout["frames"]}
        try:
            for actor in actors:
                track = actor["track"]
                if not isinstance(track, str) or not track or track in tracks:
                    raise ValueError("track must be unique and nonempty")
                tracks.add(track)
                if actor["label"] not in {"car", "truck", "bus", "trailer", "construction_vehicle",
                                          "pedestrian", "motorcycle", "bicycle", "barrier",
                                          "traffic_cone"}:
                    raise ValueError("unsupported actor label")
                size = np.asarray(actor["size"], dtype=float)
                if size.shape != (3,) or not np.isfinite(size).all() or (size <= 0).any():
                    raise ValueError("size must contain three positive finite values")
                keyed = set()
                for key in actor["keys"]:
                    if key["frame"] not in indices or key["frame"] in keyed:
                        raise ValueError("actor frame must be unique and in layout")
                    keyed.add(key["frame"])
                    center = np.asarray(key["center"], dtype=float)
                    if center.shape != (3,) or not np.isfinite(center).all():
                        raise ValueError("center must contain three finite values")
                    if not np.isfinite(float(key["yaw"])):
                        raise ValueError("yaw must be finite")
        except (KeyError, TypeError, ValueError) as exc:
            raise InputError(f"Invalid actors: {exc}") from exc
        layout["actors"] = actors
    elif scenario["traffic"]["mode"] == "generated":
        raise InputError("Generated traffic requires --actors")
    frames = [f for f in layout["frames"]
              if not scenario["frames"] or f["index"] in scenario["frames"]]
    names = scenario["cameras"] or sorted(layout["frames"][0]["cameras"])
    out.mkdir(parents=True, exist_ok=True)

    build_started = time.perf_counter()
    asset_environment = scenario.get("environment", "voxel") == "assets"
    procedural = scenario.get("environment", "voxel") in ("procedural", "assets")
    assets = pbr_assets() if procedural else None
    bounds = layout["bounds"]
    ground = import_ply(directory / layout["ground"]["mesh"], "ground")
    set_ground_uv(ground, bounds)
    ground.data.materials.append(procedural_ground(directory, layout, scenario["weather"], assets)
                                 if procedural else ground_material(directory, layout, scenario["weather"]))
    if procedural:
        environment_objects = (build_environment_assets(directory, layout, scenario, assets) if asset_environment
                               else build_procedural(directory, layout, scenario, assets))
    else:
        static = import_ply(directory / layout["static"]["mesh"], "static")
        static.data.materials.append(static_material(static))
        environment_objects = [static]
    export_timings = {}
    if procedural and (export_env_only or scenario.get("export_web_env", True)):
        export_timings = export_web_environment(environment_objects, out)
    elif not export_env_only:
        (out / "environment.glb").unlink(missing_ok=True)
    if export_env_only:
        previous_export = previous_run.get("environment_export_s", 0)
        previous_run.update(export_timings)
        if "total_s" in previous_run:
            previous_run["total_s"] += export_timings["environment_export_s"] - previous_export
        else:
            previous_run["total_s"] = (previous_run.get("environment_build_s", 0)
                + sum(sum(v.values()) for v in previous_run.get("render_s", {}).values())
                + sum(previous_run.get("lidar_s", {}).values()) + export_timings["environment_export_s"])
        (out / "run.json").write_text(json.dumps(previous_run, indent=2))
        return 0
    actors = build_actors(layout, scenario, observed_colors)
    (out / "actors.json").write_text(json.dumps(layout["actors"], allow_nan=False))
    setup_world(layout, scenario)
    setup_render(scenario)
    if procedural:
        procedural_hdri(scenario, assets)
    headlight = ego_headlight(scenario)
    camera = bpy.data.objects.new("camera", bpy.data.cameras.new("camera"))
    bpy.context.scene.collection.objects.link(camera)
    bpy.context.scene.camera = camera
    depsgraph = bpy.context.evaluated_depsgraph_get()
    static_trees = {"ground": BVHTree.FromObject(ground, depsgraph)}
    static_trees["static"] = (environment_tree([ground, *environment_objects], depsgraph, opacity=True) if procedural
                              else BVHTree.FromObject(static, depsgraph))
    if procedural:
        actor_meshes = {mesh for obj, _, _ in actors for mesh in [obj, *obj.children_recursive] if mesh.type == 'MESH'}
        expected = {obj.name for obj in bpy.context.scene.objects if obj.type == 'MESH' and not obj.hide_render and obj not in actor_meshes}
        contributions = static_trees['static'].contributions if static_trees['static'] else {}
        missing = sorted(expected - contributions.keys())
        if missing:
            raise InputError(f'Environment meshes absent from static BVH: {missing}')
        audit = {'meshes': len(expected), 'triangles': sum(contributions.values()), 'missing': missing, 'contributions': contributions}
        (out/'environment_bvh.json').write_text(json.dumps(audit, indent=2))
        print('ENV_BVH ' + json.dumps({k: audit[k] for k in ('meshes', 'triangles', 'missing')}), flush=True)
    build_s = time.perf_counter() - build_started
    paint = load_paint(directory, layout)
    drivable = load_paint(directory, {"ground": {"paint": layout["ground"]["drivable"]}})

    failed = False
    timings = {"render_s": {}, "lidar_s": {}, **export_timings}
    if procedural:
        timings["environment_build_s"] = round(build_s, 3)
    for frame in frames:
        index = frame["index"]
        if procedural and is_night(scenario):
            # Bound EEVEE shadow pages by casting from the nearest eight lamps;
            # every measured pole still emits light and distant lamps stay lit.
            ego = Vector(np.asarray(frame["T_world_lidar"])[:3, 3])
            lamps = [obj for obj in bpy.context.scene.objects
                     if obj.type == "LIGHT" and obj.name.startswith("pole_light_")]
            ordered = sorted(lamps, key=lambda obj: (obj.location - ego).length_squared)
            for i, lamp in enumerate(ordered):
                lamp.data.use_shadow = i < 8
        place_actors(actors, index)
        print(f"HEADING_CHECK frame={index} {json.dumps(actor_heading_checks(actors, index))}",
              flush=True)
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
            points = lidar_scan(frame, layout, scenario, trees, paint, bounds, drivable=drivable)
            path = out / "lidar" / f"{index:06d}.bin"
            path.parent.mkdir(parents=True, exist_ok=True)
            points.tofile(path)
            timings["lidar_s"][str(index)] = round(time.perf_counter() - started, 2)
        print(f"FRAME {index} done", flush=True)
    if save_blend is not None:
        bpy.ops.wm.save_as_mainfile(filepath=str(save_blend))
    timings["total_s"] = round(time.perf_counter() - build_started, 3)
    (out / "run.json").write_text(json.dumps({
        "scenario": scenario, "blender_version": bpy.app.version_string,
        "engine": bpy.context.scene.render.engine, "frames": [f["index"] for f in frames],
        "cameras": names, "region_fallback": scenario.pop("region_fallback", []), **timings, "status": "failed" if failed else "ok"}, indent=2))
    return 1 if failed else 0


def main():
    args = parse_args()
    try:
        bpy.ops.wm.read_factory_settings(use_empty=True)
        if args.selftest:
            return selftest(load_layout(args.layout), args.out)
        if args.scenario is None and not args.export_env_only:
            raise InputError("--scenario is required unless --selftest")
        return run(args.layout, args.scenario, args.out, not args.no_render, not args.no_lidar,
                   args.save_blend, args.actors, args.export_env_only)
    except InputError as exc:
        print(f"INPUT ERROR: {exc}", file=sys.stderr)
        return 2
    except Exception:  # noqa: BLE001 - uncaught errors would make Blender exit 0 (S2 §1)
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())
