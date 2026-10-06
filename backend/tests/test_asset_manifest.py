"""Check the actual local library: schema and Blender geometry/material invariants."""
import json
import struct
import subprocess
from collections import Counter
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
ASSETS = ROOT / "backend/assets"
MANIFEST = json.loads((ASSETS / "library_manifest.json").read_text())
EVIDENCE = ROOT / "planning/02_2026-10-05_blender-real2sim/evidence/s8"


def test_manifest_contract():
    counts = Counter(e["class"] for e in MANIFEST)
    for label, minimum in {"car": 6, "truck": 2, "bus": 1, "motorcycle": 1,
                           "bicycle": 1, "pedestrian": 8}.items():
        assert counts[label] >= minimum
    assert len({e["asset_id"] for e in MANIFEST}) == len(MANIFEST)
    for entry in MANIFEST:
        assert entry.keys() >= {"asset_id", "class", "file", "source_url", "license",
                                "attribution", "author", "native_size", "forward_axis",
                                "up_axis", "polycount", "paint_material", "animated"}
        assert entry["license"] in {"CC0", "CC-BY"}
        assert entry["source_url"].startswith("https://")
        assert entry["author"]
        if entry["license"] == "CC-BY":
            assert entry["attribution"]
        path = (ASSETS / entry["file"]).resolve()
        assert path.is_relative_to((ASSETS / "library").resolve())
        assert path.is_file() and path.with_suffix(".glb").is_file()
        assert entry["forward_axis"] == "+X" and entry["up_axis"] == "Z"
        assert entry["forward_verified"] is True
        assert len(entry["native_size"]) == 3
        assert all(isinstance(v, (int, float)) and 0 < v < 30 for v in entry["native_size"])
        assert entry["polycount"] > 0
        glb = path.with_suffix(".glb").read_bytes()
        magic, version, total_size = struct.unpack_from("<4sII", glb)
        assert magic == b"glTF" and version == 2 and total_size == len(glb)
        json_size, chunk_type = struct.unpack_from("<I4s", glb, 12)
        assert chunk_type == b"JSON"
        document = json.loads(glb[20:20 + json_size])
        assert document["meshes"]
        assert not document.get("cameras")
        if entry["class"] == "pedestrian":
            assert entry["animated"] and entry["walk_action"]
            assert entry["cycle_frames"] > 0 and entry["fps"] > 0
            assert entry["walk_speed_mps"] > 0
            action_names = {a["name"] for a in document["animations"]}
            assert {entry["walk_action"], entry["idle_action"]} <= action_names


BLENDER_CHECK_SCRIPT = r'''
import json
import os
import runpy
from pathlib import Path
import bpy
from mathutils import Matrix
root = Path.cwd()
module = runpy.run_path(str(root/'backend/topeye/sim/blender/normalize_assets.py'))
rows = {}
for entry in json.loads((root/'backend/assets/library_manifest.json').read_text()):
    bpy.ops.wm.open_mainfile(filepath=str(root/'backend/assets'/entry['file']))
    meshes = [o for o in bpy.data.objects if o.type == 'MESH']
    depsgraph = bpy.context.evaluated_depsgraph_get()
    coords = [o.matrix_world @ v.co for original in meshes for o in [original.evaluated_get(depsgraph)] for v in o.data.vertices]
    size = [max(c[i] for c in coords)-min(c[i] for c in coords) for i in range(3)]
    center = [(max(c[i] for c in coords)+min(c[i] for c in coords))/2 for i in range(3)]
    if os.environ.get('H11_FAULT_FORWARD') == entry['asset_id']:
        for obj in meshes:
            obj.matrix_world = Matrix.Rotation(3.14159265,4,'Z') @ obj.matrix_world
        bpy.context.view_layer.update()
    method, landmarks = module['verify_forward']()
    # A deliberately flipped real model must be rejected by the forward checker.
    old = {o.name:o.matrix_world.copy() for o in meshes}
    for o in meshes: o.matrix_world = Matrix.Rotation(3.14159265,4,'Z') @ old[o.name]
    bpy.context.view_layer.update()
    rejected = False
    try: module['verify_forward']()
    except AssertionError: rejected = True
    for o in meshes: o.matrix_world = old[o.name]
    bpy.context.view_layer.update()
    paint = bpy.data.materials.get(entry['paint_material']) if entry['paint_material'] else None
    materials = {slot.material for o in meshes for slot in o.material_slots if slot.material and slot.material != paint}
    def colors():
        return {m.name: [(n.name,list(n.inputs['Base Color'].default_value)) for n in m.node_tree.nodes if n.type=='BSDF_PRINCIPLED'] if m.use_nodes else list(m.diffuse_color) for m in materials}
    before = colors()
    if paint:
        paint.node_tree.nodes.get('Principled BSDF').inputs['Base Color'].default_value = (1,0,0,1)
        assert any(o.material_slots[p.material_index].material == paint for o in meshes for p in o.data.polygons)
    isolated = before == colors()
    actions_present = True; drift = 0.0; pose_changes = True; idle_stands = True
    if entry['animated']:
        arm = next(o for o in bpy.data.objects if o.type=='ARMATURE')
        legs = [b for b in arm.pose.bones if b.name.startswith(('UpperLeg.', 'LowerLeg.'))]
        idle_stands = len(legs) == 4 and all(b.head.z - b.tail.z > 0.5 for b in legs)
        actions_present = entry['walk_action'] in bpy.data.actions and entry['idle_action'] in bpy.data.actions
        arm.animation_data.action = bpy.data.actions[entry['walk_action']]
        if arm.animation_data.action.slots: arm.animation_data.action_slot = arm.animation_data.action.slots[0]
        roots = [b for b in arm.pose.bones if b.parent is None]
        points=[]; poses=[]
        for frame in range(entry['cycle_frames']+1):
            bpy.context.scene.frame_set(frame)
            points.append([arm.matrix_world @ b.head for b in roots])
            poses.append([b.matrix.copy() for b in arm.pose.bones])
        drift = max((point[k]-points[0][k]).xy.length for point in points for k in range(len(roots)))
        pose_changes = any((poses[12][i].translation - poses[0][i].translation).length > 0.01 for i in range(len(poses[0])))
    rows[entry['asset_id']] = {'size':size,'center':center,'forward':method,'landmarks':landmarks,'flip_rejected':rejected,'paint_isolated':isolated,'actions_present':actions_present,'root_drift_m':drift,'walk_pose_changes':pose_changes,'idle_stands':idle_stands}
(root/'planning/02_2026-10-05_blender-real2sim/evidence/s8/h11_measurements.json').write_text(json.dumps(rows,indent=2))
print('ASSETS_VERIFIED',len(rows))
'''


@pytest.fixture(scope="module")
def measurements():
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    (EVIDENCE / "h11_verify.py").write_text(BLENDER_CHECK_SCRIPT)
    result = subprocess.run(
        ["/Applications/Blender.app/Contents/MacOS/Blender", "-b", "--factory-startup",
         "--python-exit-code", "1", "-P", str(EVIDENCE / "h11_verify.py")],
        cwd=ROOT, capture_output=True, text=True, timeout=120, check=False,
    )
    (EVIDENCE / "h11_blender_checks.txt").write_text(result.stdout + result.stderr)
    assert result.returncode == 0, result.stdout + result.stderr
    return json.loads((EVIDENCE / "h11_measurements.json").read_text())


@pytest.mark.parametrize("entry", MANIFEST, ids=lambda e: e["asset_id"])
def test_exported_geometry_and_materials(entry, measurements):
    row = measurements[entry["asset_id"]]
    assert row["size"] == pytest.approx(entry["native_size"], abs=0.002)
    assert row["center"] == pytest.approx([0, 0, 0], abs=0.002)
    assert row["forward"]
    assert row["flip_rejected"]
    assert row["paint_isolated"]
    if entry["class"] == "pedestrian":
        assert row["actions_present"]
        assert row["root_drift_m"] < 0.001
        assert row["walk_pose_changes"]
        assert row["idle_stands"]
