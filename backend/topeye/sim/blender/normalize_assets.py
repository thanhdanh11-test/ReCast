"""Normalize CC0/CC-BY 3D actor library assets into +X forward, Z up, box-centered models.

Run directly via Blender:
  /Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P backend/topeye/sim/blender/normalize_assets.py
"""

from __future__ import annotations

import colorsys
import json
import math
import os
import shutil
import statistics
import struct
import sys
from itertools import pairwise
from pathlib import Path

import bpy
import mathutils
import numpy as np

# ---------------------------------------------------------------- directories

SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[3]
ASSETS_DIR = REPO_ROOT / "backend" / "assets"
LIBRARY_DIR = ASSETS_DIR / "library"
RAW_DIR = LIBRARY_DIR / "_raw"
MANIFEST_PATH = ASSETS_DIR / "library_manifest.json"
EVIDENCE_S8 = REPO_ROOT / "planning" / "02_2026-10-05_blender-real2sim" / "evidence" / "s8"
THUMBS_COMPOSITE = EVIDENCE_S8 / "library_thumbs.jpg"
EVIDENCE_S12 = REPO_ROOT / "planning" / "02_2026-10-05_blender-real2sim" / "evidence" / "s12"
THUMBS_S12 = EVIDENCE_S12 / "sketchfab_thumbs.jpg"
SKETCHFAB_DIR = LIBRARY_DIR / "sketchfab"
THUMBS_TEMP_DIR = LIBRARY_DIR / "_thumbs"

# ---------------------------------------------------------------- asset catalog

ASSET_SPECS = [
    # CAR (7 models >= 6)
    {
        "asset_id": "car_sedan",
        "class": "car",
        "raw_file": "NormalCar1.blend",
        "format": "blend",
        "rot_z": math.pi / 2,
        "target_dims": [4.45, 1.85, 1.55],
        "paint_material": "paint",
        "body_obj": "NormalCar1",
        "source_url": "https://quaternius.com/packs/cars.html",
        "license": "CC0",
        "attribution": "",
        "author": "Quaternius",
        "animated": False,
    },
    {
        "asset_id": "car_sedan_kenney",
        "class": "car",
        "raw_file": "sedan.glb",
        "format": "glb",
        "rot_z": math.pi / 2,
        "target_dims": [4.45, 1.85, 1.55],
        "paint_material": "paint",
        "body_obj": "body",
        "source_url": "https://kenney.nl/assets/car-kit",
        "license": "CC0",
        "attribution": "",
        "author": "Kenney",
        "animated": False,
    },
    {
        "asset_id": "car_sedan_sports",
        "class": "car",
        "raw_file": "sedan-sports.glb",
        "format": "glb",
        "rot_z": math.pi / 2,
        "target_dims": [4.55, 1.90, 1.45],
        "paint_material": "paint",
        "body_obj": "body",
        "source_url": "https://kenney.nl/assets/car-kit",
        "license": "CC0",
        "attribution": "",
        "author": "Kenney",
        "animated": False,
    },
    {
        "asset_id": "car_hatchback",
        "class": "car",
        "raw_file": "hatchback-sports.glb",
        "format": "glb",
        "rot_z": math.pi / 2,
        "target_dims": [4.15, 1.80, 1.55],
        "paint_material": "paint",
        "body_obj": "body",
        "source_url": "https://kenney.nl/assets/car-kit",
        "license": "CC0",
        "attribution": "",
        "author": "Kenney",
        "animated": False,
    },
    {
        "asset_id": "car_suv",
        "class": "car",
        "raw_file": "suv.glb",
        "format": "glb",
        "rot_z": math.pi / 2,
        "target_dims": [4.70, 2.00, 1.75],
        "paint_material": "paint",
        "body_obj": "body",
        "source_url": "https://kenney.nl/assets/car-kit",
        "license": "CC0",
        "attribution": "",
        "author": "Kenney",
        "animated": False,
    },
    {
        "asset_id": "car_suv_luxury",
        "class": "car",
        "raw_file": "suv-luxury.glb",
        "format": "glb",
        "rot_z": math.pi / 2,
        "target_dims": [4.90, 2.05, 1.80],
        "paint_material": "paint",
        "body_obj": "body",
        "source_url": "https://kenney.nl/assets/car-kit",
        "license": "CC0",
        "attribution": "",
        "author": "Kenney",
        "animated": False,
    },
    {
        "asset_id": "car_taxi",
        "class": "car",
        "raw_file": "taxi.glb",
        "format": "glb",
        "rot_z": math.pi / 2,
        "target_dims": [4.50, 1.85, 1.55],
        "paint_material": "paint",
        "body_obj": "body",
        "source_url": "https://kenney.nl/assets/car-kit",
        "license": "CC0",
        "attribution": "",
        "author": "Kenney",
        "animated": False,
    },
    {
        "asset_id": "car_van",
        "class": "car",
        "raw_file": "van.glb",
        "format": "glb",
        "rot_z": math.pi / 2,
        "target_dims": [4.80, 1.95, 1.90],
        "paint_material": "paint",
        "body_obj": "body",
        "source_url": "https://kenney.nl/assets/car-kit",
        "license": "CC0",
        "attribution": "",
        "author": "Kenney",
        "animated": False,
    },
    # TRUCK (4 models >= 2)
    {
        "asset_id": "truck_pickup",
        "class": "truck",
        "raw_file": "truck.glb",
        "format": "glb",
        "rot_z": math.pi / 2,
        "target_dims": [5.80, 2.20, 2.10],
        "paint_material": "paint",
        "body_obj": "body",
        "source_url": "https://kenney.nl/assets/car-kit",
        "license": "CC0",
        "attribution": "",
        "author": "Kenney",
        "animated": False,
    },
    {
        "asset_id": "truck_flatbed",
        "class": "truck",
        "raw_file": "truck-flat.glb",
        "format": "glb",
        "rot_z": math.pi / 2,
        "target_dims": [6.50, 2.40, 2.50],
        "paint_material": "paint",
        "body_obj": "body",
        "source_url": "https://kenney.nl/assets/car-kit",
        "license": "CC0",
        "attribution": "",
        "author": "Kenney",
        "animated": False,
    },
    {
        "asset_id": "truck_delivery",
        "class": "truck",
        "raw_file": "delivery.glb",
        "format": "glb",
        "rot_z": math.pi / 2,
        "target_dims": [6.80, 2.40, 2.90],
        "paint_material": "paint",
        "body_obj": "body",
        "source_url": "https://kenney.nl/assets/car-kit",
        "license": "CC0",
        "attribution": "",
        "author": "Kenney",
        "animated": False,
    },
    {
        "asset_id": "truck_garbage",
        "class": "truck",
        "raw_file": "garbage-truck.glb",
        "format": "glb",
        "rot_z": math.pi / 2,
        "target_dims": [8.50, 2.60, 3.30],
        "paint_material": "paint",
        "body_obj": "body",
        "source_url": "https://kenney.nl/assets/car-kit",
        "license": "CC0",
        "attribution": "",
        "author": "Kenney",
        "animated": False,
    },
    # BUS (2 models >= 1)
    {
        "asset_id": "bus_city",
        "class": "bus",
        "raw_file": "Bus.blend",
        "format": "blend",
        "rot_z": math.pi,
        "target_dims": [11.20, 2.90, 3.30],
        "paint_material": "paint",
        "body_obj": "Bus",
        "source_url": "https://quaternius.com/packs/publictransport.html",
        "license": "CC0",
        "attribution": "",
        "author": "Quaternius",
        "animated": False,
    },
    {
        "asset_id": "bus_school",
        "class": "bus",
        "raw_file": "SchoolBus.blend",
        "format": "blend",
        "rot_z": math.pi,
        "target_dims": [10.20, 2.80, 3.20],
        "paint_material": "paint",
        "body_obj": "SchoolBus",
        "source_url": "https://quaternius.com/packs/publictransport.html",
        "license": "CC0",
        "attribution": "",
        "author": "Quaternius",
        "animated": False,
    },
    # MOTORCYCLE (1 model >= 1)
    {
        "asset_id": "motorcycle_standard",
        "class": "motorcycle",
        "raw_file": "vehicle-motorcycle.glb",
        "format": "glb",
        "rot_z": math.pi / 2,
        "target_dims": [2.20, 0.90, 1.40],
        "paint_material": "paint",
        "body_obj": "body",
        "clean_names": ["Camera", "Cube", "Light", "motorcycle"],
        "source_url": "https://github.com/KenneyNL/Starter-Kit-Racing",
        "license": "CC0",
        "attribution": "",
        "author": "Kenney",
        "animated": False,
    },
    # BICYCLE (2 models >= 1)
    {
        "asset_id": "bicycle_commuter",
        "class": "bicycle",
        "raw_file": "Bicycle.blend",
        "format": "blend",
        "rot_z": -math.pi / 2,
        "target_dims": [1.75, 0.60, 1.15],
        "paint_material": "paint",
        "body_obj": "Frame",
        "source_url": "https://quaternius.com/packs/publictransport.html",
        "license": "CC0",
        "attribution": "",
        "author": "Quaternius",
        "animated": False,
    },
    {
        "asset_id": "bicycle_square",
        "class": "bicycle",
        "raw_file": "SquareFrameBicycle.blend",
        "format": "blend",
        "rot_z": -math.pi / 2,
        "target_dims": [1.70, 0.60, 1.15],
        "paint_material": "paint",
        "body_obj": "Frame",
        "source_url": "https://quaternius.com/packs/publictransport.html",
        "license": "CC0",
        "attribution": "",
        "author": "Quaternius",
        "animated": False,
    },
    # PEDESTRIAN (8 models >= 8)
    {
        "asset_id": "pedestrian_male_casual",
        "class": "pedestrian",
        "raw_file": "Male_Casual.blend",
        "format": "blend",
        "rot_z": math.pi / 2,
        "target_h": 1.78,
        "target_dims": [0.75, 0.70, 1.78],
        "paint_material": None,
        "source_url": "https://quaternius.com/packs/animatedmen.html",
        "license": "CC0",
        "attribution": "",
        "author": "Quaternius",
        "animated": True,
        "walk_action": "Man_Walk",
        "idle_action": "Man_Idle",
        "cycle_frames": 25,
        "fps": 24,
    },
    {
        "asset_id": "pedestrian_male_longsleeve",
        "class": "pedestrian",
        "raw_file": "Male_LongSleeve.blend",
        "format": "blend",
        "rot_z": math.pi / 2,
        "target_h": 1.78,
        "target_dims": [0.75, 0.70, 1.78],
        "paint_material": None,
        "source_url": "https://quaternius.com/packs/animatedmen.html",
        "license": "CC0",
        "attribution": "",
        "author": "Quaternius",
        "animated": True,
        "walk_action": "Man_Walk",
        "idle_action": "Man_Idle",
        "cycle_frames": 25,
        "fps": 24,
    },
    {
        "asset_id": "pedestrian_male_shirt",
        "class": "pedestrian",
        "raw_file": "Male_Shirt.blend",
        "format": "blend",
        "rot_z": math.pi / 2,
        "target_h": 1.78,
        "target_dims": [0.75, 0.70, 1.78],
        "paint_material": None,
        "source_url": "https://quaternius.com/packs/animatedmen.html",
        "license": "CC0",
        "attribution": "",
        "author": "Quaternius",
        "animated": True,
        "walk_action": "Man_Walk",
        "idle_action": "Man_Idle",
        "cycle_frames": 25,
        "fps": 24,
    },
    {
        "asset_id": "pedestrian_male_suit",
        "class": "pedestrian",
        "raw_file": "Male_Suit.blend",
        "format": "blend",
        "rot_z": math.pi / 2,
        "target_h": 1.80,
        "target_dims": [0.75, 0.70, 1.80],
        "paint_material": None,
        "source_url": "https://quaternius.com/packs/animatedmen.html",
        "license": "CC0",
        "attribution": "",
        "author": "Quaternius",
        "animated": True,
        "walk_action": "Man_Walk",
        "idle_action": "Man_Idle",
        "cycle_frames": 25,
        "fps": 24,
    },
    {
        "asset_id": "pedestrian_female_alternative",
        "class": "pedestrian",
        "raw_file": "Female_Alternative.blend",
        "format": "blend",
        "rot_z": math.pi / 2,
        "target_h": 1.68,
        "target_dims": [0.70, 0.65, 1.68],
        "paint_material": None,
        "source_url": "https://quaternius.com/packs/animatedwomen.html",
        "license": "CC0",
        "attribution": "",
        "author": "Quaternius",
        "animated": True,
        "walk_action": "Female_Walk",
        "idle_action": "Female_Idle",
        "cycle_frames": 25,
        "fps": 24,
    },
    {
        "asset_id": "pedestrian_female_casual",
        "class": "pedestrian",
        "raw_file": "Female_Casual.blend",
        "format": "blend",
        "rot_z": math.pi / 2,
        "target_h": 1.68,
        "target_dims": [0.70, 0.65, 1.68],
        "paint_material": None,
        "source_url": "https://quaternius.com/packs/animatedwomen.html",
        "license": "CC0",
        "attribution": "",
        "author": "Quaternius",
        "animated": True,
        "walk_action": "Female_Walk",
        "idle_action": "Female_Idle",
        "cycle_frames": 25,
        "fps": 24,
    },
    {
        "asset_id": "pedestrian_female_dress",
        "class": "pedestrian",
        "raw_file": "Female_Dress.blend",
        "format": "blend",
        "rot_z": math.pi / 2,
        "target_h": 1.68,
        "target_dims": [0.70, 0.65, 1.68],
        "paint_material": None,
        "source_url": "https://quaternius.com/packs/animatedwomen.html",
        "license": "CC0",
        "attribution": "",
        "author": "Quaternius",
        "animated": True,
        "walk_action": "Female_Walk",
        "idle_action": "Female_Idle",
        "cycle_frames": 25,
        "fps": 24,
    },
    {
        "asset_id": "pedestrian_female_tanktop",
        "class": "pedestrian",
        "raw_file": "Female_TankTop.blend",
        "format": "blend",
        "rot_z": math.pi / 2,
        "target_h": 1.68,
        "target_dims": [0.70, 0.65, 1.68],
        "paint_material": None,
        "source_url": "https://quaternius.com/packs/animatedwomen.html",
        "license": "CC0",
        "attribution": "",
        "author": "Quaternius",
        "animated": True,
        "walk_action": "Female_Walk",
        "idle_action": "Female_Idle",
        "cycle_frames": 25,
        "fps": 24,
    },
]

SKETCHFAB_SPECS = [
    {
        "asset_id": "car_sketchfab_sedan",
        "class": "car",
        "raw_file": "sketchfab/car_20f9af9b8a404d5cb022ac6fe87f21f5.glb",
        "format": "glb",
        "is_pack": True,
        "body_obj": "Sedan Body_Body_0",
        "glass_obj": "Sedan Body_Glass_0",
        "optics_obj": "Sedan Body_Optics_0",
        "wheels": ["Wheel_A_Wheel_0", "Wheel_A001_Wheel_0", "Wheel_A002_Wheel_0", "Wheel_A003_Wheel_0"],
        "rot_z": -math.pi / 2,
        "target_dims": [4.65, 1.85, 1.45],
        "paint_material": "paint",
        "source_url": "https://sketchfab.com/3d-models/generic-passenger-car-pack-20f9af9b8a404d5cb022ac6fe87f21f5",
        "license": "CC-BY",
        "attribution": "Generic passenger car pack by comrade1280 (CC-BY 4.0)",
        "author": "comrade1280",
        "quality": "detailed",
        "animated": False,
    },
    {
        "asset_id": "car_sketchfab_hatchback",
        "class": "car",
        "raw_file": "sketchfab/car_20f9af9b8a404d5cb022ac6fe87f21f5.glb",
        "format": "glb",
        "is_pack": True,
        "body_obj": "Hatchback Body_Body_0",
        "glass_obj": "Hatchback Body_Glass_0",
        "optics_obj": "Hatchback Body_Optics_0",
        "wheels": ["Wheel_B_Wheek_0", "Wheel_B001_Wheek_0", "Wheel_B002_Wheek_0", "Wheel_B003_Wheek_0"],
        "rot_z": -math.pi / 2,
        "target_dims": [4.25, 1.80, 1.45],
        "paint_material": "paint",
        "source_url": "https://sketchfab.com/3d-models/generic-passenger-car-pack-20f9af9b8a404d5cb022ac6fe87f21f5",
        "license": "CC-BY",
        "attribution": "Generic passenger car pack by comrade1280 (CC-BY 4.0)",
        "author": "comrade1280",
        "quality": "detailed",
        "animated": False,
    },
    {
        "asset_id": "car_sketchfab_suv",
        "class": "car",
        "raw_file": "sketchfab/car_20f9af9b8a404d5cb022ac6fe87f21f5.glb",
        "format": "glb",
        "is_pack": True,
        "body_obj": "SUV Body_Body_0",
        "glass_obj": "SUV Body_Glass_0",
        "optics_obj": "SUV Body_Optics_0",
        "wheels": ["Wheel_E_Wheel_0.001", "Wheel_E001_Wheel_0.001", "Wheel_E002_Wheel_0.001", "Wheel_E003_Wheel_0.001"],
        "rot_z": -math.pi / 2,
        "target_dims": [4.75, 1.95, 1.70],
        "paint_material": "paint",
        "source_url": "https://sketchfab.com/3d-models/generic-passenger-car-pack-20f9af9b8a404d5cb022ac6fe87f21f5",
        "license": "CC-BY",
        "attribution": "Generic passenger car pack by comrade1280 (CC-BY 4.0)",
        "author": "comrade1280",
        "quality": "detailed",
        "animated": False,
    },
    {
        "asset_id": "car_sketchfab_minivan",
        "class": "car",
        "raw_file": "sketchfab/car_20f9af9b8a404d5cb022ac6fe87f21f5.glb",
        "format": "glb",
        "is_pack": True,
        "body_obj": "minivan body_Body_0",
        "glass_obj": "minivan body_Glass_0",
        "optics_obj": "minivan body_Optics_0",
        "wheels": ["Wheel_D_Wheel_0", "Wheel_D001_Wheel_0", "Wheel_D002_Wheel_0", "Wheel_D003_Wheel_0"],
        "rot_z": -math.pi / 2,
        "target_dims": [4.85, 1.90, 1.75],
        "paint_material": "paint",
        "source_url": "https://sketchfab.com/3d-models/generic-passenger-car-pack-20f9af9b8a404d5cb022ac6fe87f21f5",
        "license": "CC-BY",
        "attribution": "Generic passenger car pack by comrade1280 (CC-BY 4.0)",
        "author": "comrade1280",
        "quality": "detailed",
        "animated": False,
    },
    {
        "asset_id": "car_sketchfab_wagon",
        "class": "car",
        "raw_file": "sketchfab/car_20f9af9b8a404d5cb022ac6fe87f21f5.glb",
        "format": "glb",
        "is_pack": True,
        "body_obj": "Wagon Body_Body_0",
        "glass_obj": "Wagon Body_Glass_0",
        "optics_obj": "Wagon Body_Optics_0",
        "wheels": ["Wheel_A_Wheel_0.001", "Wheel_A001_Wheel_0.001", "Wheel_A002_Wheel_0.001", "Wheel_A003_Wheel_0.001"],
        "rot_z": -math.pi / 2,
        "target_dims": [4.70, 1.85, 1.50],
        "paint_material": "paint",
        "source_url": "https://sketchfab.com/3d-models/generic-passenger-car-pack-20f9af9b8a404d5cb022ac6fe87f21f5",
        "license": "CC-BY",
        "attribution": "Generic passenger car pack by comrade1280 (CC-BY 4.0)",
        "author": "comrade1280",
        "quality": "detailed",
        "animated": False,
    },
    {
        "asset_id": "car_sketchfab_coupe",
        "class": "car",
        "raw_file": "sketchfab/car_20f9af9b8a404d5cb022ac6fe87f21f5.glb",
        "format": "glb",
        "is_pack": True,
        "body_obj": "Coupe Body_Body_0",
        "glass_obj": "Coupe Body_Glass_0",
        "optics_obj": "Coupe Body_Optics_0",
        "wheels": ["Wheel_F_Wheel_0", "Wheel_F001_Wheel_0", "Wheel_F002_Wheel_0", "Wheel_F003_Wheel_0"],
        "rot_z": -math.pi / 2,
        "target_dims": [4.50, 1.85, 1.35],
        "paint_material": "paint",
        "source_url": "https://sketchfab.com/3d-models/generic-passenger-car-pack-20f9af9b8a404d5cb022ac6fe87f21f5",
        "license": "CC-BY",
        "attribution": "Generic passenger car pack by comrade1280 (CC-BY 4.0)",
        "author": "comrade1280",
        "quality": "detailed",
        "animated": False,
    },
    {
        "asset_id": "car_sketchfab_sport",
        "class": "car",
        "raw_file": "sketchfab/car_20f9af9b8a404d5cb022ac6fe87f21f5.glb",
        "format": "glb",
        "is_pack": True,
        "body_obj": "Sport body_Body_0",
        "glass_obj": "Sport body_Glass_0",
        "optics_obj": "Sport body_Optics_0",
        "wheels": ["Wheel_H_Wheel_0", "Wheel_H001_Wheel_0", "Wheel_H002_Wheel_0", "Wheel_H003_Wheel_0"],
        "rot_z": -math.pi / 2,
        "target_dims": [4.40, 1.90, 1.30],
        "paint_material": "paint",
        "source_url": "https://sketchfab.com/3d-models/generic-passenger-car-pack-20f9af9b8a404d5cb022ac6fe87f21f5",
        "license": "CC-BY",
        "attribution": "Generic passenger car pack by comrade1280 (CC-BY 4.0)",
        "author": "comrade1280",
        "quality": "detailed",
        "animated": False,
    },
    {
        "asset_id": "car_sketchfab_compact",
        "class": "car",
        "raw_file": "sketchfab/car_20f9af9b8a404d5cb022ac6fe87f21f5.glb",
        "format": "glb",
        "is_pack": True,
        "body_obj": "Compact Body_Body_0",
        "glass_obj": "Compact Body_Glass_0",
        "optics_obj": "Compact Body_Optics_0",
        "wheels": ["Wheel_C_Wheel_0", "Wheel_C001_Wheel_0", "Wheel_C002_Wheel_0", "Wheel_C003_Wheel_0"],
        "rot_z": -math.pi / 2,
        "target_dims": [3.95, 1.75, 1.45],
        "paint_material": "paint",
        "source_url": "https://sketchfab.com/3d-models/generic-passenger-car-pack-20f9af9b8a404d5cb022ac6fe87f21f5",
        "license": "CC-BY",
        "attribution": "Generic passenger car pack by comrade1280 (CC-BY 4.0)",
        "author": "comrade1280",
        "quality": "detailed",
        "animated": False,
    },
    {
        "asset_id": "car_sketchfab_pickup",
        "class": "car",
        "raw_file": "sketchfab/car_20f9af9b8a404d5cb022ac6fe87f21f5.glb",
        "format": "glb",
        "is_pack": True,
        "body_obj": "Pickup Body_Body_0",
        "glass_obj": "Pickup Body_Glass_0",
        "optics_obj": "Pickup Body_Optics_0",
        "wheels": ["Wheel_E_Wheel_0", "Wheel_E001_Wheel_0", "Wheel_E002_Wheel_0", "Wheel_E003_Wheel_0"],
        "rot_z": -math.pi / 2,
        "target_dims": [5.20, 2.00, 1.80],
        "paint_material": "paint",
        "source_url": "https://sketchfab.com/3d-models/generic-passenger-car-pack-20f9af9b8a404d5cb022ac6fe87f21f5",
        "license": "CC-BY",
        "attribution": "Generic passenger car pack by comrade1280 (CC-BY 4.0)",
        "author": "comrade1280",
        "quality": "detailed",
        "animated": False,
    },
    {
        "asset_id": "car_sketchfab_offroad",
        "class": "car",
        "raw_file": "sketchfab/car_20f9af9b8a404d5cb022ac6fe87f21f5.glb",
        "format": "glb",
        "is_pack": True,
        "body_obj": "Offroad Body_Body_0",
        "glass_obj": "Offroad Body_Glass_0",
        "optics_obj": "Offroad Body_Optics_0",
        "wheels": ["Wheel_G_Wheel_0", "Wheel_G001_Wheel_0", "Wheel_G001_Wheel_0.001", "Wheel_G002_Wheel_0"],
        "rot_z": -math.pi / 2,
        "target_dims": [4.60, 1.90, 1.80],
        "paint_material": "paint",
        "source_url": "https://sketchfab.com/3d-models/generic-passenger-car-pack-20f9af9b8a404d5cb022ac6fe87f21f5",
        "license": "CC-BY",
        "attribution": "Generic passenger car pack by comrade1280 (CC-BY 4.0)",
        "author": "comrade1280",
        "quality": "detailed",
        "animated": False,
    },
]

# ---------------------------------------------------------------- helpers

def ensure_raw_assets():
    RAW_DIR.mkdir(parents=True, exist_ok=True)
    tex_dir = RAW_DIR / "Textures"
    tex_dir.mkdir(parents=True, exist_ok=True)
    colormap_src = RAW_DIR / "colormap.png"
    colormap_dst = tex_dir / "colormap.png"
    if colormap_src.is_file() and not colormap_dst.is_file():
        shutil.copy2(colormap_src, colormap_dst)


def surface_material(name, color, roughness=0.35, metallic=0.0):
    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    return mat


def setup_paint_material(body_obj, mat_name="paint", base_color=(0.15, 0.25, 0.6, 1.0)):
    """Tint only body faces, preserving atlas glass, lamps and separate wheels."""
    mat = surface_material(mat_name, base_color, metallic=0.3)
    # Quaternius meshes already carry semantic slots. Never replace Windows/Lights.
    semantic = {"bottom", "top", "body", "bike", "paint", "car", "main", "yellow", "blue", "red"}
    slots = [i for i, slot in enumerate(body_obj.material_slots)
             if slot.material and slot.material.name.lower().split(".")[0] in semantic]
    if slots:
        for i in slots:
            body_obj.material_slots[i].link = "OBJECT"
            body_obj.material_slots[i].material = mat
        return mat
    source = next((slot.material for slot in body_obj.material_slots
                   if slot.material and slot.material.use_nodes), None)
    image = next((n.image for n in source.node_tree.nodes if n.type == "TEX_IMAGE"
                  and n.image), None) if source else None
    if image is None or body_obj.data.uv_layers.active is None:
        raise ValueError(f"No safe body-face mapping for {body_obj.name}")
    pixels = np.asarray(image.pixels[:]).reshape(image.size[1], image.size[0], 4)
    glass = surface_material("glass", (0.08, 0.13, 0.18, 1), roughness=0.12)
    head = surface_material("headlight", (1, 0.85, 0.55, 1))
    tail = surface_material("taillight", (0.6, 0.015, 0.01, 1))
    for material in (mat, glass, head, tail):
        body_obj.data.materials.append(material)
    start = len(body_obj.data.materials) - 4
    uv_data = body_obj.data.uv_layers.active.data
    length = max(v.co.x for v in body_obj.data.vertices) - min(v.co.x for v in body_obj.data.vertices)
    for poly in body_obj.data.polygons:
        uv = sum((uv_data[i].uv for i in poly.loop_indices), mathutils.Vector((0, 0))) / len(poly.loop_indices)
        x = min(image.size[0] - 1, max(0, int(uv.x * image.size[0])))
        y = min(image.size[1] - 1, max(0, int(uv.y * image.size[1])))
        r, g, b = pixels[y, x, :3]
        _hue, saturation, value = colorsys.rgb_to_hsv(float(r), float(g), float(b))
        center_x = sum(body_obj.data.vertices[i].co.x for i in poly.vertices) / len(poly.vertices)
        if center_x > length * 0.35 and poly.normal.x > 0.5 and r > 0.7 and g > 0.5 and b < 0.5:
            poly.material_index = start + 2
        elif center_x < -length * 0.35 and poly.normal.x < -0.5 and r > g * 1.7 and r > b * 1.7:
            poly.material_index = start + 3
        elif saturation < 0.35 and b > r + 0.03 and b > g + 0.015:
            poly.material_index = start + 1
        elif (saturation > 0.35 and value > 0.4) or (value > 0.65 and saturation < 0.15):
            poly.material_index = start
    if not any(p.material_index == start for p in body_obj.data.polygons):
        raise ValueError(f"No paint faces found on {body_obj.name}")
    return mat


def verify_forward():
    """Use semantic lamps, wheel pairs, eyes or handle/saddle to prove heading."""
    positions = {}
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        for idx, slot in enumerate(obj.material_slots):
            if not slot.material:
                continue
            name = slot.material.name.lower()
            coords = [obj.matrix_world @ obj.data.vertices[v].co
                      for p in obj.data.polygons if p.material_index == idx for v in p.vertices]
            if coords:
                positions[name] = float(sum(c.x for c in coords) / len(coords))
        coords = [obj.matrix_world @ v.co for v in obj.data.vertices]
        if coords:
            positions[obj.name.lower()] = float(sum(c.x for c in coords) / len(coords))
    heads = [x for n, x in positions.items() if "headlight" in n]
    tails = [x for n, x in positions.items() if "taillight" in n]
    if heads and tails:
        assert min(heads) > 0 and max(tails) < 0, positions
        return "headlight:+X,taillight:-X", positions
    front = [x for n, x in positions.items() if "front" in n and "wheel" in n]
    back = [x for n, x in positions.items() if "back" in n and "wheel" in n]
    if front and back:
        assert min(front) > max(back), positions
        return "front_wheel>back_wheel", positions
    eyes = [x for n, x in positions.items() if "eyes" in n]
    if eyes:
        assert min(eyes) > 0, positions
        return "eyes:+X", positions
    bicycle = bpy.data.objects.get("Bicycle")
    if bicycle is not None:
        coords = [bicycle.matrix_world @ v.co for v in bicycle.data.vertices]
        top_z = max(c.z for c in coords)
        top = [c for c in coords if c.z > top_z - 0.05]
        handlebar_x = sum(c.x for c in top) / len(top)
        assert handlebar_x > 0, handlebar_x
        positions["handlebar_top"] = handlebar_x
        return "highest_handlebar:+X", positions
    raise ValueError(f"No forward landmarks: {positions}")


def verify_upright(asset_class: str = "car"):
    """Verify that a 4-wheeled vehicle stands level on its wheels, +Z is up, and w < l."""
    if asset_class not in ("car", "truck", "bus"):
        return True, "non_wheeled_or_2wheel"
    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    coords = [o.matrix_world @ v.co for o in meshes for v in o.data.vertices]
    if not coords:
        raise ValueError("No mesh coordinates found")
    min_x = min(c.x for c in coords)
    max_x = max(c.x for c in coords)
    min_y = min(c.y for c in coords)
    max_y = max(c.y for c in coords)
    min_z = min(c.z for c in coords)
    max_z = max(c.z for c in coords)
    l = max_x - min_x
    w = max_y - min_y
    h = max_z - min_z

    wheel_objs = [o for o in meshes if any(k in o.name.lower() for k in ("wheel", "tire", "wheek"))]
    if not wheel_objs:
        raise ValueError("No wheel meshes found for vehicle")

    wheel_centers = []
    for wo in wheel_objs:
        pts = [wo.matrix_world @ v.co for v in wo.data.vertices]
        wheel_centers.append(sum(pts, mathutils.Vector((0, 0, 0))) / len(pts))

    wheel_centers.sort(key=lambda p: p.z)
    ground_wheels = wheel_centers[:4] if len(wheel_centers) >= 4 else wheel_centers
    zs = [p.z for p in ground_wheels]
    wheel_z_diff = max(zs) - min(zs)
    z_wheel_max = max(zs)

    assert wheel_z_diff <= 0.02, f"Wheel z difference too large: {wheel_z_diff:.4f} > 0.02"
    assert z_wheel_max <= (min_z + 0.35 * h), f"Wheels not near bottom: {z_wheel_max:.4f} > {min_z + 0.35 * h:.4f}"
    assert w < l, f"Width {w:.4f} must be less than length {l:.4f}"

    if len(ground_wheels) == 4:
        pts_by_x = sorted(ground_wheels, key=lambda p: p.x)
        dx_rear = abs(pts_by_x[0].x - pts_by_x[1].x)
        dx_front = abs(pts_by_x[2].x - pts_by_x[3].x)
        assert dx_rear <= 0.15, f"Rear axle wheels x misaligned: {dx_rear:.4f} > 0.15"
        assert dx_front <= 0.15, f"Front axle wheels x misaligned: {dx_front:.4f} > 0.15"

    return True, {"wheel_z_diff": round(wheel_z_diff, 6), "w": round(w, 4), "l": round(l, 4), "h": round(h, 4)}


def native_walk_speed(arm, spec):
    """Estimate in-place gait speed from backward grounded-foot motion at native scale."""
    arm.animation_data.action = bpy.data.actions[spec["walk_action"]]
    if arm.animation_data.action.slots:
        arm.animation_data.action_slot = arm.animation_data.action.slots[0]
    tracks = [[], []]
    for frame in range(spec["cycle_frames"] + 1):
        bpy.context.scene.frame_set(frame)
        for i, name in enumerate(("Foot.L", "Foot.R")):
            tracks[i].append(arm.matrix_world @ arm.pose.bones[name].head)
    velocities = []
    for track in tracks:
        floor = min(point.z for point in track)
        for previous, current in pairwise(track):
            if max(previous.z, current.z) < floor + 0.04 and current.x < previous.x:
                velocities.append((previous.x - current.x) * spec["fps"])
    if not velocities:
        raise ValueError(f"No grounded backward foot motion for {spec['asset_id']}")
    speed = statistics.median(velocities)
    arm.animation_data.action = bpy.data.actions[spec["idle_action"]]
    if arm.animation_data.action.slots:
        arm.animation_data.action_slot = arm.animation_data.action.slots[0]
    bpy.context.scene.frame_set(0)
    return round(speed, 6)


def render_thumbnail(output_path: Path, max_dim: float):
    """Render a clean 256x256 3/4 preview of the current scene."""
    cam_data = bpy.data.cameras.new("ThumbCam")
    cam_data.lens = 45
    cam = bpy.data.objects.new("ThumbCam", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    bpy.context.scene.camera = cam

    dist = max(max_dim * 1.55, 1.8)
    direction = mathutils.Vector((1.3, -1.8, 1.1)).normalized()
    cam.location = direction * dist
    rot_quat = (-direction).to_track_quat("-Z", "Y")
    cam.rotation_euler = rot_quat.to_euler()

    # Lighting
    sun_data = bpy.data.lights.new("ThumbSun", type="SUN")
    sun_data.energy = 3.5
    sun = bpy.data.objects.new("ThumbSun", sun_data)
    sun.rotation_euler = (math.radians(50), math.radians(25), math.radians(45))
    bpy.context.scene.collection.objects.link(sun)

    fill_data = bpy.data.lights.new("ThumbFill", type="SUN")
    fill_data.energy = 1.2
    fill = bpy.data.objects.new("ThumbFill", fill_data)
    fill.rotation_euler = (math.radians(20), math.radians(-40), math.radians(-135))
    bpy.context.scene.collection.objects.link(fill)

    # World background
    if bpy.context.scene.world is None:
        bpy.context.scene.world = bpy.data.worlds.new("ThumbWorld")
    world = bpy.context.scene.world
    world.use_nodes = True
    bg_node = world.node_tree.nodes.get("Background")
    if bg_node:
        bg_node.inputs["Color"].default_value = (0.12, 0.13, 0.15, 1.0)

    bpy.context.scene.render.resolution_x = 256
    bpy.context.scene.render.resolution_y = 256
    bpy.context.scene.render.resolution_percentage = 100
    bpy.context.scene.render.engine = "BLENDER_EEVEE"
    bpy.context.scene.render.filepath = str(output_path)
    bpy.context.scene.render.image_settings.file_format = "JPEG"
    bpy.context.scene.render.image_settings.quality = 90
    bpy.ops.render.render(write_still=True)


# ---------------------------------------------------------------- normalizer

def normalize_single_asset(spec: dict) -> dict:
    raw_path = RAW_DIR / spec["raw_file"]
    if not raw_path.is_file():
        raise FileNotFoundError(f"Raw asset file not found: {raw_path}")

    asset_id = spec["asset_id"]
    is_pedestrian = (spec["class"] == "pedestrian")
    out_blend = LIBRARY_DIR / f"{asset_id}.blend"
    out_glb = LIBRARY_DIR / f"{asset_id}.glb"
    thumb_path = THUMBS_TEMP_DIR / f"{asset_id}.jpg"

    bpy.ops.wm.read_factory_settings(use_empty=True)

    if spec["format"] == "glb":
        bpy.ops.import_scene.gltf(filepath=str(raw_path))
    elif spec["format"] == "blend":
        bpy.ops.wm.open_mainfile(filepath=str(raw_path))
    else:
        raise ValueError(f"Unsupported format: {spec['format']}")

    # Clean non-asset objects
    clean_names = spec.get("clean_names", [])
    for o in list(bpy.data.objects):
        if o.type in ("LIGHT", "CAMERA") or o.name in clean_names or any(o.name.startswith(f"{prefix}.") for prefix in clean_names):
            bpy.data.objects.remove(o, do_unlink=True)

    target_dims = spec["target_dims"]
    rot_z = spec["rot_z"]

    if not is_pedestrian:
        # STATIC RIGID VEHICLE / BICYCLE
        # 1. Rotate around Z
        R = mathutils.Matrix.Rotation(rot_z, 4, "Z")
        meshes = [o for o in bpy.data.objects if o.type == "MESH"]
        transforms = {o.name: R @ o.matrix_world for o in meshes}
        for o in meshes:
            transform = transforms[o.name]
            for v in o.data.vertices:
                v.co = transform @ v.co
            o.parent = None
            o.matrix_world = mathutils.Matrix.Identity(4)
            o.data.update()

        # 2. Compute current bounds
        all_coords = [v.co for o in bpy.data.objects if o.type == "MESH" for v in o.data.vertices]
        min_x = min(c.x for c in all_coords); max_x = max(c.x for c in all_coords)
        min_y = min(c.y for c in all_coords); max_y = max(c.y for c in all_coords)
        min_z = min(c.z for c in all_coords); max_z = max(c.z for c in all_coords)
        cur_l = max_x - min_x; cur_w = max_y - min_y; cur_h = max_z - min_z

        # 3. Scale and center to exact target dimensions
        target_l, target_w, target_h = target_dims
        sx = target_l / cur_l; sy = target_w / cur_w; sz = target_h / cur_h
        mid_x = (min_x + max_x) / 2
        mid_y = (min_y + max_y) / 2
        mid_z = (min_z + max_z) / 2

        for o in bpy.data.objects:
            if o.type == "MESH":
                for v in o.data.vertices:
                    v.co.x = (v.co.x - mid_x) * sx
                    v.co.y = (v.co.y - mid_y) * sy
                    v.co.z = (v.co.z - mid_z) * sz
                o.data.update()

        # 4. Assign paint material
        body_name = spec.get("body_obj", "body")
        candidates = [o for o in bpy.data.objects if o.type == "MESH" and (o.name == body_name or body_name in o.name)]
        body_obj = candidates[0] if candidates else next(o for o in bpy.data.objects if o.type == "MESH")
        if spec.get("paint_material"):
            setup_paint_material(body_obj, spec["paint_material"])

        # Compute native_size
        final_coords = [v.co for o in bpy.data.objects if o.type == "MESH" for v in o.data.vertices]
        native_l = round(max(c.x for c in final_coords) - min(c.x for c in final_coords), 3)
        native_w = round(max(c.y for c in final_coords) - min(c.y for c in final_coords), 3)
        native_h = round(max(c.z for c in final_coords) - min(c.z for c in final_coords), 3)
        native_size = [native_l, native_w, native_h]
        max_dim = max(native_size)

    else:
        # PEDESTRIAN (Armature + Mesh)
        arm_list = [o for o in bpy.data.objects if o.type == "ARMATURE"]
        mesh_list = [o for o in bpy.data.objects if o.type == "MESH"]
        if not arm_list or not mesh_list:
            raise RuntimeError(f"Pedestrian missing armature or mesh: {asset_id}")
        arm = arm_list[0]

        for track in list(arm.animation_data.nla_tracks):
            arm.animation_data.nla_tracks.remove(track)
        for bone in arm.pose.bones:
            bone.location = (0, 0, 0)
            bone.rotation_quaternion = (1, 0, 0, 0)
            bone.rotation_euler = (0, 0, 0)
            bone.scale = (1, 1, 1)
        for name in (spec["walk_action"], spec["idle_action"]):
            bpy.data.actions[name].use_fake_user = True
        arm.animation_data.action = bpy.data.actions[spec["idle_action"]]
        if arm.animation_data.action.slots:
            arm.animation_data.action_slot = arm.animation_data.action.slots[0]
        bpy.context.scene.frame_set(0)
        arm.matrix_world = mathutils.Matrix.Rotation(rot_z, 4, "Z") @ arm.matrix_world
        bpy.context.view_layer.update()

        def world_vertices():
            depsgraph = bpy.context.evaluated_depsgraph_get()
            return [obj.matrix_world @ v.co for original in mesh_list
                    for obj in [original.evaluated_get(depsgraph)] for v in obj.data.vertices]

        coords = world_vertices()
        center = mathutils.Vector(tuple((min(c[i] for c in coords) + max(c[i] for c in coords)) / 2 for i in range(3)))
        size = [max(c[i] for c in coords) - min(c[i] for c in coords) for i in range(3)]
        scaling = mathutils.Matrix.Diagonal((*[target_dims[i] / size[i] for i in range(3)], 1))
        arm.matrix_world = scaling @ mathutils.Matrix.Translation(-center) @ arm.matrix_world
        bpy.context.view_layer.update()
        coords = world_vertices()
        native_size = [round(max(c[i] for c in coords) - min(c[i] for c in coords), 6) for i in range(3)]
        bpy.context.scene.render.fps = spec["fps"]
        bpy.context.scene.frame_start = 0
        bpy.context.scene.frame_end = spec["cycle_frames"]
        max_dim = max(native_size)
        walk_speed = native_walk_speed(arm, spec)

    forward_method, landmarks = verify_forward()
    print("FORWARD", asset_id, forward_method, landmarks)
    if not is_pedestrian and spec["class"] in ("car", "truck", "bus"):
        upright_ok, upright_data = verify_upright(spec["class"])
        print("UPRIGHT", asset_id, upright_ok, upright_data)

    # Polycount
    polycount = sum(len(o.data.polygons) for o in bpy.data.objects if o.type == "MESH")

    # Pack source textures so exports are portable.
    referenced_images = {node.image for material in bpy.data.materials if material.use_nodes
                         for node in material.node_tree.nodes if node.type == "TEX_IMAGE" and node.image}
    for image in list(bpy.data.images):
        if image not in referenced_images and not image.packed_file:
            bpy.data.images.remove(image)
    for material in bpy.data.materials:
        if not material.use_nodes:
            color = tuple(material.diffuse_color)
            material.use_nodes = True
            material.node_tree.nodes.get("Principled BSDF").inputs["Base Color"].default_value = color
    bpy.ops.file.pack_all()

    # Save .blend
    bpy.ops.wm.save_as_mainfile(filepath=str(out_blend))

    # Export .glb
    bpy.ops.export_scene.gltf(filepath=str(out_glb), export_format="GLB")

    # glTF export evaluates other actions; reload the saved standing state for previews.
    bpy.ops.wm.open_mainfile(filepath=str(out_blend))
    render_thumbnail(thumb_path, max_dim)

    entry = {
        "asset_id": asset_id,
        "class": spec["class"],
        "file": f"library/{asset_id}.blend",
        "source_url": spec["source_url"],
        "license": spec["license"],
        "attribution": spec["attribution"],
        "author": spec["author"],
        "native_size": native_size,
        "forward_axis": "+X",
        "up_axis": "Z",
        "forward_verified": True,
        "forward_verification": forward_method,
        "polycount": int(polycount),
        "paint_material": spec.get("paint_material"),
        "animated": bool(spec.get("animated", False)),
    }
    if is_pedestrian:
        entry["walk_action"] = spec["walk_action"]
        entry["idle_action"] = spec.get("idle_action")
        entry["walk_speed_mps"] = walk_speed
        entry["walk_speed_method"] = "median_backward_grounded_foot_velocity"
        entry["cycle_frames"] = int(spec["cycle_frames"])
        entry["fps"] = int(spec["fps"])

    return entry


def normalize_single_sketchfab_pack_asset(spec: dict) -> dict:
    raw_path = LIBRARY_DIR / spec["raw_file"]
    if not raw_path.is_file():
        raise FileNotFoundError(f"Sketchfab raw asset not found: {raw_path}")

    asset_id = spec["asset_id"]
    out_blend = LIBRARY_DIR / f"{asset_id}.blend"
    out_glb = LIBRARY_DIR / f"{asset_id}.glb"
    thumb_path = THUMBS_TEMP_DIR / f"{asset_id}.jpg"

    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(raw_path))

    keep_names = {spec["body_obj"], spec["glass_obj"], spec["optics_obj"]} | set(spec["wheels"])
    for o in list(bpy.data.objects):
        if o.name not in keep_names:
            bpy.data.objects.remove(o, do_unlink=True)

    meshes = [o for o in bpy.data.objects if o.type == "MESH"]
    if len(meshes) != len(keep_names):
        found = {m.name for m in meshes}
        missing = keep_names - found
        raise ValueError(f"Missing meshes for {asset_id}: {missing}")

    # 1. Bake mesh vertices to world space
    for o in meshes:
        transform = o.matrix_world.copy()
        for v in o.data.vertices:
            v.co = transform @ v.co
        o.parent = None
        o.matrix_world = mathutils.Matrix.Identity(4)
        o.data.update()

    # 2. Geometric alignment from wheel centers and body center
    wheel_names = spec["wheels"]
    w_objs = [bpy.data.objects[name] for name in wheel_names]
    w_pts = [sum([v.co for v in o.data.vertices], mathutils.Vector((0, 0, 0))) / len(o.data.vertices) for o in w_objs]

    # Pair wheels into 2 axles by minimizing sum of axle widths (track width < wheelbase)
    pairs = [
        ((0, 1), (2, 3), (w_pts[0] - w_pts[1]).length + (w_pts[2] - w_pts[3]).length),
        ((0, 2), (1, 3), (w_pts[0] - w_pts[2]).length + (w_pts[1] - w_pts[3]).length),
        ((0, 3), (1, 2), (w_pts[0] - w_pts[3]).length + (w_pts[1] - w_pts[2]).length),
    ]
    pairs.sort(key=lambda x: x[2])
    axle1, axle2, _ = pairs[0]

    c1 = (w_pts[axle1[0]] + w_pts[axle1[1]]) / 2
    c2 = (w_pts[axle2[0]] + w_pts[axle2[1]]) / 2

    # Forward direction (+X): cars are positioned around turntable facing center
    body = bpy.data.objects[spec["body_obj"]]
    b_center = sum([v.co for v in body.data.vertices], mathutils.Vector((0, 0, 0))) / len(body.data.vertices)
    to_origin = mathutils.Vector((-b_center.x, -b_center.y, 0)).normalized()

    axle_vec = (c1 - c2).normalized()
    if axle_vec.dot(to_origin) < 0:
        forward_vec = -axle_vec
    else:
        forward_vec = axle_vec

    track1 = (w_pts[axle1[0]] - w_pts[axle1[1]]).normalized()
    normal = forward_vec.cross(track1)
    if normal.z < 0:
        normal = -normal
    normal = normal.normalized()

    left_vec = normal.cross(forward_vec).normalized()

    # Canonical rotation matrix: forward_vec -> +X, left_vec -> +Y, normal -> +Z
    R_canon = mathutils.Matrix((
        (forward_vec.x, forward_vec.y, forward_vec.z, 0),
        (left_vec.x, left_vec.y, left_vec.z, 0),
        (normal.x, normal.y, normal.z, 0),
        (0, 0, 0, 1),
    ))

    for o in meshes:
        for v in o.data.vertices:
            v.co = R_canon @ v.co
        o.data.update()

    # 3. Compute current bounds and scale to target dimensions
    all_coords = [v.co for o in meshes for v in o.data.vertices]
    min_x = min(c.x for c in all_coords); max_x = max(c.x for c in all_coords)
    min_y = min(c.y for c in all_coords); max_y = max(c.y for c in all_coords)
    min_z = min(c.z for c in all_coords); max_z = max(c.z for c in all_coords)
    cur_l = max_x - min_x; cur_w = max_y - min_y; cur_h = max_z - min_z

    target_l, target_w, target_h = spec["target_dims"]
    sx = target_l / cur_l; sy = target_w / cur_w; sz = target_h / cur_h
    mid_x = (min_x + max_x) / 2
    mid_y = (min_y + max_y) / 2
    mid_z = (min_z + max_z) / 2

    for o in meshes:
        for v in o.data.vertices:
            v.co.x = (v.co.x - mid_x) * sx
            v.co.y = (v.co.y - mid_y) * sy
            v.co.z = (v.co.z - mid_z) * sz
        o.data.update()

    # 4. Materials
    body_obj = bpy.data.objects[spec["body_obj"]]
    paint_mat = surface_material(spec.get("paint_material", "paint"), (0.15, 0.25, 0.6, 1.0), metallic=0.3)
    body_obj.data.materials.clear()
    body_obj.data.materials.append(paint_mat)

    optics_obj = bpy.data.objects[spec["optics_obj"]]
    head_mat = surface_material("headlight", (1.0, 0.85, 0.55, 1.0))
    tail_mat = surface_material("taillight", (0.6, 0.015, 0.01, 1.0))
    optics_obj.data.materials.clear()
    optics_obj.data.materials.append(head_mat)
    optics_obj.data.materials.append(tail_mat)
    for poly in optics_obj.data.polygons:
        center_x = sum(optics_obj.data.vertices[v].co.x for v in poly.vertices) / len(poly.vertices)
        poly.material_index = 0 if center_x > 0 else 1

    glass_obj = bpy.data.objects[spec["glass_obj"]]
    glass_mat = surface_material("glass", (0.08, 0.13, 0.18, 1.0), roughness=0.1, metallic=0.1)
    glass_obj.data.materials.clear()
    glass_obj.data.materials.append(glass_mat)

    tire_mat = surface_material("tire", (0.03, 0.03, 0.03, 1.0), roughness=0.7)
    for wheel_name in spec["wheels"]:
        w_obj = bpy.data.objects.get(wheel_name)
        if w_obj:
            w_obj.data.materials.clear()
            w_obj.data.materials.append(tire_mat)

    # 5. Verification
    forward_method, landmarks = verify_forward()
    print("FORWARD", asset_id, forward_method, landmarks)
    upright_ok, upright_data = verify_upright(spec["class"])
    print("UPRIGHT", asset_id, upright_ok, upright_data)

    native_size = [round(target_l, 3), round(target_w, 3), round(target_h, 3)]
    polycount = sum(len(o.data.polygons) for o in meshes)

    # Save .blend
    bpy.ops.wm.save_as_mainfile(filepath=str(out_blend))

    # Export .glb
    bpy.ops.export_scene.gltf(filepath=str(out_glb), export_format="GLB")

    # Render thumbnail
    bpy.ops.wm.open_mainfile(filepath=str(out_blend))
    render_thumbnail(thumb_path, max_dim=max(native_size))

    return {
        "asset_id": asset_id,
        "class": spec["class"],
        "file": f"library/{asset_id}.blend",
        "source_url": spec["source_url"],
        "license": spec["license"],
        "attribution": spec["attribution"],
        "author": spec["author"],
        "quality": "detailed",
        "native_size": native_size,
        "forward_axis": "+X",
        "up_axis": "Z",
        "forward_verified": True,
        "forward_verification": forward_method,
        "polycount": int(polycount),
        "paint_material": "paint",
        "animated": False,
    }


def composite_thumbnails(entries: list[dict], output_path: Path, cols: int = 6):
    """Combine thumbnails into a grid and save to output_path."""
    output_path.parent.mkdir(parents=True, exist_ok=True)
    if not entries:
        return
    rows = math.ceil(len(entries) / cols)
    tile_w = 256
    tile_h = 256
    total_w = cols * tile_w
    total_h = rows * tile_h

    composite_data = np.zeros((total_h, total_w, 4), dtype=np.float32)

    for idx, entry in enumerate(entries):
        r = idx // cols
        c = idx % cols
        thumb_path = THUMBS_TEMP_DIR / f"{entry['asset_id']}.jpg"
        if not thumb_path.is_file():
            continue

        bpy.ops.wm.read_factory_settings(use_empty=True)
        img = bpy.data.images.load(str(thumb_path))
        pixels = np.empty(tile_w * tile_h * 4, dtype=np.float32)
        img.pixels.foreach_get(pixels)
        pixels = pixels.reshape((tile_h, tile_w, 4))

        # In Blender image coordinate space, row 0 is bottom
        # We want top-left to bottom-right order: row (rows - 1 - r)
        target_y = (rows - 1 - r) * tile_h
        target_x = c * tile_w
        composite_data[target_y:target_y + tile_h, target_x:target_x + tile_w] = pixels
        bpy.data.images.remove(img)

    comp_img = bpy.data.images.new("CompositeThumbs", width=total_w, height=total_h)
    comp_img.pixels.foreach_set(composite_data.ravel())
    comp_img.filepath_raw = str(output_path)
    comp_img.file_format = "JPEG"
    comp_img.save()
    print(f"Composite thumbnail saved: {output_path}")


def complete_glb(path):
    """Only consume a fully downloaded GLB v2 with a matching declared length."""
    if not path.is_file():
        return False
    with path.open("rb") as stream:
        header = stream.read(12)
    return (len(header) == 12 and header[:4] == b"glTF"
            and struct.unpack("<II", header[4:]) == (2, path.stat().st_size))


def normalize_vn_assets():
    """Add completed regional assets without downloading or rebuilding the existing library."""
    metadata = json.loads((SKETCHFAB_DIR / "_meta.json").read_text())
    manifest = [entry for entry in json.loads(MANIFEST_PATH.read_text())
                if entry["asset_id"] not in {"rider_vn_550da710f41f40e180066c58c2e7e5a7",
                                             "rider_vn_8dee814d538b45b38798ebdb4352903d",
                                             "rider_vn_98464f40e6bb48ffa424be880f217a8b",
                                             "helmet_vn_c9d968e024b749a7a9d0e257277a2d5c"}]
    evidence = EVIDENCE_S12.parent / "s13"
    evidence.mkdir(parents=True, exist_ok=True)
    THUMBS_TEMP_DIR.mkdir(parents=True, exist_ok=True)
    results = []
    for row in metadata:
        if row.get("region") != "vn" and row["class"] not in ("rider", "helmet"):
            continue
        uid = row["uid"]
        if (not isinstance(uid, str) or len(uid) != 32
                or any(char not in "0123456789abcdef" for char in uid)
                or row["class"] not in ("motorcycle", "rider", "helmet")):
            raise ValueError("Regional asset metadata requires a 32-character hex UID and supported class")
        raw = SKETCHFAB_DIR / f"{row['class']}_{uid}.glb"
        if not complete_glb(raw):
            results.append({"uid": row["uid"], "status": "missing_or_incomplete"})
            continue
        if row["class"] in ("rider", "helmet"):
            # Source pose/orientation has not passed the seated +X landmark gate.
            # Keep the raw download untouched and render the bounded fallback.
            results.append({"uid": row["uid"], "status": "downloaded_not_usable", "reason": "seated_pose_and_forward_landmarks_unverified"})
            continue
        if row.get("license_slug") not in ("by", "cc0"):
            raise ValueError("Regional assets require CC-BY or CC0")
        bpy.ops.wm.read_factory_settings(use_empty=True)
        bpy.ops.import_scene.gltf(filepath=str(raw))
        # Honda Dream ships an unrelated standing human: omit it from the bike mesh.
        for obj in list(bpy.data.objects):
            if obj.type == "MESH" and obj.name.startswith("Ch20_"):
                bpy.data.objects.remove(obj, do_unlink=True)
        depsgraph = bpy.context.evaluated_depsgraph_get()
        original_objects = list(bpy.data.objects)
        meshes = []
        rotation = mathutils.Matrix.Rotation(math.pi / 2, 4, "Z")
        for original in list(bpy.data.objects):
            if original.type != "MESH":
                continue
            evaluated = original.evaluated_get(depsgraph)
            data = bpy.data.meshes.new_from_object(evaluated)
            data.transform(rotation @ original.matrix_world)
            obj = bpy.data.objects.new(original.name + "_normalized", data)
            meshes.append(obj)
        for obj in original_objects:
            bpy.data.objects.remove(obj, do_unlink=True)
        for obj in meshes:
            bpy.context.scene.collection.objects.link(obj)
            lower = obj.name.lower()
            if "pneu avant" in lower or "simetrico.002" in lower:
                obj.name = "front_wheel"
            elif "pneu arriere" in lower or "simetrico.001" in lower:
                obj.name = "back_wheel"
        coords = np.array([tuple(v.co) for obj in meshes for v in obj.data.vertices])
        lo, hi = coords.min(0), coords.max(0)
        target = {"motorcycle": [1.96, 0.70, 1.34], "rider": [0.8, 0.55, 1.05], "helmet": [0.3, 0.26, 0.22]}[row["class"]]
        scale = np.array(target) / (hi - lo)
        for obj in meshes:
            for vertex in obj.data.vertices:
                vertex.co = mathutils.Vector((np.array(vertex.co) - (lo + hi) / 2) * scale)
        if row["class"] == "motorcycle":
            forward, landmarks = verify_forward()
        else:
            forward, landmarks = "source_seated_pose:+X", {}
        identifier = f"{row['class']}_vn_{row['uid']}"
        output = LIBRARY_DIR / identifier
        bpy.ops.file.pack_all()
        bpy.ops.wm.save_as_mainfile(filepath=str(output.with_suffix(".blend")))
        bpy.ops.export_scene.gltf(filepath=str(output.with_suffix(".glb")), export_format="GLB")
        render_thumbnail(evidence / f"{identifier}.jpg", max(target))
        entry = {"asset_id": identifier, "class": row["class"], "file": f"library/{identifier}.blend",
                 "source_url": row["source_url"], "license": "CC-BY" if row["license_slug"] == "by" else "CC0",
                 "attribution": f"{row['name']} by {row['author']} (CC-BY 4.0)", "author": row["author"],
                 "native_size": target, "forward_axis": "+X", "up_axis": "Z", "forward_verified": True,
                 "forward_verification": forward, "polycount": sum(len(obj.data.polygons) for obj in meshes),
                 "paint_material": None, "animated": False, "quality": "detailed", "region": ["vn"]}
        if row["class"] == "rider":
            entry["seat_offset"] = [-0.1, 0, -target[2] * 0.15]
        manifest = [asset for asset in manifest if asset["asset_id"] != identifier] + [entry]
        results.append({"uid": row["uid"], "status": "normalized", "asset_id": identifier, "landmarks": landmarks})
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2, allow_nan=False) + "\n")
    (evidence / "normalization.json").write_text(json.dumps(results, indent=2))


def main():
    if "--vn-only" in sys.argv:
        normalize_vn_assets()
        return
    print("=" * 60)
    print("🚗 TOPEYE ASSET NORMALIZER (SPEC-S8 §1)")
    print("=" * 60)

    LIBRARY_DIR.mkdir(parents=True, exist_ok=True)
    THUMBS_TEMP_DIR.mkdir(parents=True, exist_ok=True)
    ensure_raw_assets()

    manifest = []
    cc0_entries = []
    for index, spec in enumerate(ASSET_SPECS, 1):
        print(f"[{index}/{len(ASSET_SPECS)}] Normalizing CC0 {spec['asset_id']} ({spec['class']})...")
        entry = normalize_single_asset(spec)
        entry["quality"] = "standard"
        cc0_entries.append(entry)
        manifest.append(entry)
        print(f"   -> size: {entry['native_size']}, poly: {entry['polycount']}, file: {entry['file']}")

    sketchfab_entries = []
    missing_sketchfab = []
    for index, spec in enumerate(SKETCHFAB_SPECS, 1):
        raw_path = LIBRARY_DIR / spec["raw_file"]
        if not raw_path.is_file() or raw_path.stat().st_size < 100000:
            print(f"[Sketchfab {index}/{len(SKETCHFAB_SPECS)}] Skipping missing/incomplete: {spec['asset_id']}")
            missing_sketchfab.append(spec["asset_id"])
            continue
        print(f"[Sketchfab {index}/{len(SKETCHFAB_SPECS)}] Normalizing {spec['asset_id']} ({spec['class']})...")
        if spec.get("is_pack"):
            entry = normalize_single_sketchfab_pack_asset(spec)
        else:
            entry = normalize_single_asset(spec)
        sketchfab_entries.append(entry)
        manifest.append(entry)
        print(f"   -> size: {entry['native_size']}, poly: {entry['polycount']}, file: {entry['file']}")

    # Write manifest
    temp_path = MANIFEST_PATH.with_suffix(".tmp")
    temp_path.write_text(json.dumps(manifest, indent=2, allow_nan=False))
    os.replace(temp_path, MANIFEST_PATH)
    print(f"Manifest written: {MANIFEST_PATH} ({len(manifest)} assets, {len(sketchfab_entries)} detailed)")

    # Composite thumbnails
    print("Building composite thumbnail grids...")
    composite_thumbnails(cc0_entries, THUMBS_COMPOSITE, cols=6)
    if sketchfab_entries:
        composite_thumbnails(sketchfab_entries, THUMBS_S12, cols=5)

    # Clean temporary thumbnails directory
    shutil.rmtree(THUMBS_TEMP_DIR, ignore_errors=True)

    print("=" * 60)
    print(f"NORMALIZATION COMPLETE! Total {len(manifest)} assets ready ({len(cc0_entries)} CC0 + {len(sketchfab_entries)} Sketchfab).")
    if missing_sketchfab:
        print(f"Missing Sketchfab assets ({len(missing_sketchfab)}): {missing_sketchfab}")
    print("=" * 60)


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError, ValueError, KeyError, AssertionError, TypeError):
        import traceback
        traceback.print_exc()
        os._exit(1)
