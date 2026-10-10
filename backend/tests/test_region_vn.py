"""SPEC-S13 preset compatibility, distribution, safety and regional selection."""

import hashlib
import json
from collections import Counter
from copy import deepcopy
from pathlib import Path

import numpy as np
import pytest
from test_sim_library_actors import blender  # noqa: F401 - shared Blender AST fixture
from test_sim_traffic import scene  # noqa: F401 - existing deterministic road fixture

from topeye.sim import cli, traffic

EVIDENCE = Path(__file__).resolve().parents[2] / "planning/02_2026-10-05_blender-real2sim/evidence/s13"


def test_default_hash_unchanged():
    path = Path(__file__).resolve().parents[1] / "data/sim/scene-0061/layout.json"
    layout = json.loads(path.read_text())
    actors = traffic.generate_traffic(layout, {"mode": "generated", "seed": 21}, scene_dir=path.parent)
    digest = hashlib.sha256(json.dumps(actors, sort_keys=True).encode()).hexdigest()
    assert digest == "782858b47987c9a1b24fb943ab41925c41232dac835c18d05afa5c613d6a0105"
    explicit = traffic.generate_traffic(json.loads(path.read_text()), {"mode": "generated", "seed": 21, "preset": "default"}, scene_dir=path.parent)
    assert actors == explicit


def test_vn_distribution_and_safety(scene):  # noqa: F811 - imported pytest fixture
    layout, _ = scene
    before = deepcopy(layout)
    counts, offsets = Counter(), []
    maxima = Counter()
    for seed in range(40):
        actors = traffic.generate_traffic(layout, {"mode": "generated", "preset": "vn", "seed": seed})
        checks = traffic.check_traffic(layout, actors)
        assert checks["overlaps"] == checks["ego_conflicts"] == 0
        assert checks["off_road_ratio"] == 0
        assert checks["max_long_accel"] <= 3
        assert checks["max_lat_accel"] <= 4
        for k, v in checks.items():
            maxima[k] = max(maxima[k], v)
        for actor in actors:
            counts[actor["label"]] += 1
            if actor["label"] in ("motorcycle", "bicycle"):
                assert actor["rider"] is True
                base = traffic.VN_SIZES[actor["label"]]
                np.testing.assert_array_less(np.array(actor["size"]) / [base[1], base[0], base[2]], 1.08001)
                assert np.all(np.array(actor["size"]) / [base[1], base[0], base[2]] >= 0.92)
                y = actor["keys"][0]["center"][1]
                offsets.append(min((y - lane for lane in (-13.5, -10, -6.5, -3.5, 0, 3.5, 6.5, 10, 13.5, 36.5, 40, 43.5)), key=abs))
    total = sum(counts.values())
    assert total >= 200
    assert all(abs(counts[label] / total - ratio) <= 0.05 for label, ratio in traffic.VN_CLASS_MIX.items()), counts
    assert np.std(offsets) >= 0.4
    assert before == layout
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    (EVIDENCE / "traffic_metrics.json").write_text(json.dumps({"total": total, "counts": counts, "ratios": {k: v / total for k, v in counts.items()}, "offset_std_m": float(np.std(offsets)), "maxima": maxima}, indent=2))


def test_region_filter_fallback_and_preference(blender):  # noqa: F811 - imported pytest fixture
    manifest = [{"asset_id": "sg", "class": "car", "native_size": [4, 2, 1.5], "region": ["sg"]},
                {"asset_id": "vn", "class": "car", "native_size": [4, 2, 1.4], "region": ["vn"], "quality": "detailed"}]
    actor = {"track": "a", "label": "car", "size": [4, 2, 1.5]}
    assert blender.select_library_asset(manifest, actor, 0)[0]["asset_id"] == "sg"
    assert blender.select_library_asset(manifest, actor, 0, "vn")[0]["asset_id"] == "vn"
    fallback = []
    assert blender.select_library_asset(manifest[:1], actor, 0, "vn", fallback)[0]["asset_id"] == "sg"
    assert fallback == ["car"]
    shared = {**manifest[0], "asset_id": "shared"}
    shared.pop("region")
    assert blender.select_library_asset([shared, manifest[1]], actor, 0, "vn")[0]["asset_id"] == "vn"
    assert blender.region_assets([{"kind": "tree", "region": ["sg"]}], "vn", "kind", fallback)
    assert fallback == ["car", "tree"]


@pytest.mark.parametrize("text", ['region_style="bad"', 'region_style=2', '[traffic]\npreset="bad"'])
def test_invalid_region_and_preset(tmp_path, text):
    path = tmp_path / "scenario.toml"
    path.write_text('schema=2\nname="vn"\n' + text)
    with pytest.raises(cli.InputError):
        cli.check_scenario(path)


def test_rider_geometry_and_bvh_owner_without_downloads(tmp_path):
    import subprocess

    script = tmp_path / "rider_check.py"
    script.write_text(r'''
import json,runpy
from pathlib import Path
import bpy
import numpy as np
root=Path.cwd()
module=runpy.run_path(str(root/'backend/topeye/sim/blender/build_scene.py'))
ns=module['build_actors'].__globals__
ns['load_library_manifest']=lambda:([],root/'backend/assets')
bpy.ops.wm.read_factory_settings(use_empty=True)
rows=[]
for index, label in enumerate(('motorcycle','bicycle')):
 size=[1.96,.70,1.71] if label=='motorcycle' else [1.77,.69,1.71]
 actor={'track':f'gen:0:{index}','origin':'generated','label':label,'size':size,'rider':True,'keys':[{'frame':0,'center':[index*5,0,size[2]/2],'yaw':0}]}
 layout={'actors':[actor],'frames':[{'index':0,'timestamp_us':0}]}
 scenario={'seed':0,'region_style':'vn','weather':{'preset':'day'},'traffic':{'color_randomization':True}}
 actors=module['build_actors'](layout,scenario)
 module['place_actors'](actors,0)
 obj=actors[0][0]
 assert any('helmet' in o.name for o in obj.children_recursive)
 vertices=[]
 for mesh in [obj,*obj.children_recursive]:
  if mesh.type=='MESH':
   vertices.extend([obj.matrix_world.inverted() @ mesh.matrix_world @ v.co for v in mesh.data.vertices])
 coords=np.array([tuple(v) for v in vertices])
 print("BOUNDS",label,coords.min(0).tolist(),coords.max(0).tolist(),size)
 assert np.all(coords.max(0)<=np.array(size)/2+.00001)
 assert np.all(coords.min(0)>=-np.array(size)/2-.00001)
 tree,owner=module['actor_tree'](actors)
 assert tree and set(owner)=={actor['track']}
 rows.append({'label':label,'max_z':float(coords[:,2].max()),'box_top':size[2]/2,'triangles':len(owner)})
print('RIDER_BOUNDS',json.dumps(rows))
''')
    result = subprocess.run(["/Applications/Blender.app/Contents/MacOS/Blender", "-b", "--factory-startup", "--python-exit-code", "1", "-P", str(script)], cwd=Path(__file__).resolve().parents[2], capture_output=True, text=True, timeout=90, check=False)
    assert result.returncode == 0, result.stdout + result.stderr
    EVIDENCE.mkdir(parents=True, exist_ok=True)
    (EVIDENCE / "rider_bounds.txt").write_text(result.stdout + result.stderr)


@pytest.mark.parametrize("header,expected", [(b"glTF", True), (b"BAD!", False), (b"glTF" + b"x", False)])
def test_complete_glb_guard(tmp_path, header, expected):
    import ast
    import struct

    path = Path(__file__).resolve().parents[1] / "topeye/sim/blender/normalize_assets.py"
    tree = ast.parse(path.read_text())
    tree.body = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == "complete_glb"]
    namespace = {"struct": struct}
    exec(compile(tree, str(path), "exec"), namespace)  # noqa: S102 - trusted repository function
    raw = tmp_path / "sample.glb"
    assert namespace["complete_glb"](raw) is False
    raw.write_bytes(header + struct.pack("<II", 2, 12))
    assert namespace["complete_glb"](raw) is expected
    raw.write_bytes(b"glTF" + struct.pack("<II", 2, 13))
    assert namespace["complete_glb"](raw) is False


def test_kid_refuses_writing_private_reference(tmp_path):
    import subprocess
    import sys

    script = Path(__file__).resolve().parents[1] / "scripts/s13_kid_vn.py"
    result = subprocess.run([sys.executable, str(script), "--real-root", str(tmp_path),
                             "--calibration", str(tmp_path / "calibration.json"),
                             "--sim-vn", str(tmp_path / "vn"), "--sim-sg", str(tmp_path / "sg"),
                             "--out", str(tmp_path / "reference.jpg")], capture_output=True, text=True, check=False)
    assert result.returncode == 2
    assert "read-only private" in result.stderr
    assert not (tmp_path / "reference.jpg").exists()


@pytest.mark.parametrize("field,value", [("samples", 16), ("environment", "voxel"), ("frames", [1])])
def test_kid_rejects_unmatched_controls(tmp_path, field, value):
    import subprocess
    import sys

    run = {"scenario": {"samples": 8, "engine": "eevee", "environment": "procedural", "resolution_scale": 1, "weather": {"preset": "day"}}, "frames": [0], "cameras": ["CAM_FRONT"], "status": "ok"}
    vn, sg = tmp_path / "vn", tmp_path / "sg"
    vn.mkdir()
    sg.mkdir()
    (vn / "run.json").write_text(json.dumps(run))
    altered = deepcopy(run)
    if field == "frames":
        altered[field] = value
    else:
        altered["scenario"][field] = value
    (sg / "run.json").write_text(json.dumps(altered))
    script = Path(__file__).resolve().parents[1] / "scripts/s13_kid_vn.py"
    output = tmp_path / "scores.json"
    result = subprocess.run([sys.executable, str(script), "--real-root", str(tmp_path / "private_real"),
                             "--calibration", str(tmp_path / "private_cal/calibration.json"),
                             "--sim-vn", str(vn), "--sim-sg", str(sg), "--out", str(output)],
                            capture_output=True, text=True, check=False)
    assert result.returncode == 2
    assert "requires identical" in result.stderr
    assert not output.exists()
