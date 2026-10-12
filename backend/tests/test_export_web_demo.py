"""Static export contract and failure isolation, without the real dataset/engine."""

import copy
import hashlib
import importlib.util
import json
import subprocess
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/export_web_demo.py"
spec = importlib.util.spec_from_file_location("export_web_demo", SCRIPT)
export = importlib.util.module_from_spec(spec)
spec.loader.exec_module(export)


@pytest.mark.parametrize(
    "scene,tokens,start,end",
    [
        ("scene-0103", [export.PILOT_TOKEN], 8, 13),
        ("scene-0103", [export.PILOT_TOKEN], 8.0, 13.0),
        ("scene-0061", ["b", "a"], 3, 8),
        ("scene-0061", ["a", "b"], 0.8, 2.5),
        ("cảnh", ["é", "a"], 0.0, 8.25),
    ],
)
def test_keys_match_javascript(scene, tokens, start, end):
    vector = [scene, sorted(tokens), start, end]
    js = subprocess.run(
        [
            "node",
            "-e",
            (
                "const c=require('node:crypto');process.stdout.write(c.createHash('sha256')"
                ".update(JSON.stringify(JSON.parse(process.argv[1]))).digest('hex').slice(0,16));"
            ),
            json.dumps(vector),
        ],
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    assert export.extract_key(scene, tokens, start, end) == js
    if scene == "scene-0103":
        assert js == "9d2fcd08469d0aea"


def test_variant_key_stable():
    assert export.variant_key("id", "vehicle_1", 1.0, 2.0) == export.variant_key(
        "id", "vehicle_1", 1, 2
    )
    assert export.variant_key("id", "vehicle_1", 0.8, 0) != export.variant_key(
        "id", "vehicle_1", 1.2, 0
    )


class FakeService:
    def call(self, method, params):
        if method == "list_scenes":
            return [
                {"scene": f"scene-{n:04}", "tracks": [{"token": "track"}]} for n in [103, *range(9)]
            ]
        if method == "source_scene":
            return {
                "id": params["scene"],
                "source": {"dataset_root": params["dataset"]},
                "actors": [{"samples": [{"x_m": 1.125, "z_m": -0.3}]}],
            }
        if method == "extract":
            if params["scene"] != "scene-0103":
                raise export.ScenarioError("UNSUPPORTED_ROAD", "curved clip")
            return {"id": "baseline", "actors": [{"id": "vehicle_1", "role": "traffic"}]}
        if method == "variant":
            return {"id": f"variant-{params['speed_factor']}-{params['gap_offset_m']}"}
        if method == "replay":
            return {
                "path": params["workspace"],
                "report": {"status": "fail"},
                "observed": [{"x_m": 1.125, "z_m": -0.3}],
            }
        raise AssertionError(method)


@pytest.fixture
def setup(tmp_path, monkeypatch):
    dataset = tmp_path / "dataset"
    metadata = dataset / "v1.0-mini"
    metadata.mkdir(parents=True)
    for n in range(13):
        (metadata / f"{n}.json").write_text("[]")
    engine = tmp_path / "engine"
    engine.touch()
    out = tmp_path / "out"
    monkeypatch.setattr(export, "Service", FakeService)
    args = ["--dataset", str(dataset), "--engine", str(engine), "--out", str(out)]
    return dataset, engine, out, args


def test_manifest_and_payload_integrity(setup):
    dataset, _, out, args = setup
    before = export.metadata_hashes(dataset)
    assert export.main(args) == 0
    assert before == export.metadata_hashes(dataset)
    manifest = json.loads((out / "manifest.json").read_bytes())
    assert set(manifest) == {
        "schema",
        "app_version",
        "generated_at",
        "dataset",
        "engine",
        "extracts",
        "variants",
        "replays",
        "skipped",
        "files",
    }
    assert manifest["schema"] == "topeye-web-demo-v1"
    assert (
        manifest["app_version"]
        == json.loads((export.ROOT / "frontend/package.json").read_text())["version"]
    )
    assert manifest["generated_at"].endswith("+07:00")
    assert len(manifest["extracts"]) == 1
    assert len(manifest["variants"]) == 3
    assert len(manifest["replays"]) == 4
    assert len(manifest["skipped"]) == 9
    assert len(list((out / "source").glob("*.json"))) == 10
    assert set(manifest["files"]) == {
        "data/" + str(p.relative_to(out)) for p in out.rglob("*.json") if p.name != "manifest.json"
    }
    for path, digest in manifest["files"].items():
        data = (out / path.removeprefix("data/")).read_bytes()
        assert hashlib.sha256(data).hexdigest() == digest
        assert str(dataset).encode() not in data
    replay = json.loads((out / "replay/baseline.json").read_bytes())
    assert replay == {
        "path": "",
        "report": {"status": "fail"},
        "observed": [{"x_m": 1.125, "z_m": -0.3}],
    }


def test_missing_engine_creates_nothing(setup):
    _, engine, out, args = setup
    engine.unlink()
    assert export.main(args) == 3
    assert not out.exists()


def test_dataset_change_prevents_publish(setup, monkeypatch):
    _, _, out, args = setup
    calls = iter([{"a": "before"}, {"a": "after"}])
    monkeypatch.setattr(export, "metadata_hashes", lambda _: next(calls))
    assert export.main(args) == 2
    assert not out.exists()
    assert not list(out.parent.glob(".web-export-*"))


def test_worker_failure_prevents_partial_output(setup, monkeypatch):
    _, _, out, args = setup

    class Broken(FakeService):
        def call(self, method, params):
            if method == "source_scene":
                raise export.ScenarioError("DATASET_INVALID", "broken source")
            return super().call(method, params)

    monkeypatch.setattr(export, "Service", Broken)
    assert export.main(args) == 1
    assert not out.exists()


def test_reject_dataset_output_and_workspace(setup):
    dataset, _, out, args = setup
    assert export.main([*args[:-1], str(dataset / "bad")]) == 1
    assert export.main([*args, "--workspace", str(dataset / "work")]) == 1
    assert not out.exists()
    assert not (dataset / "bad").exists()
    assert not (dataset / "work").exists()


def test_preserve_existing_output(setup):
    _, _, out, args = setup
    out.mkdir()
    sentinel = out / "keep"
    sentinel.write_text("original")
    assert export.main(args) == 1
    assert sentinel.read_text() == "original"


def test_sanitization_preserves_response():
    original = {
        "source": {"dataset_root": "/Users/private/data"},
        "observed": [{"x_m": 1.234, "yaw_rad": -0.6}],
    }
    saved = copy.deepcopy(original)
    clean = export.public_value(original, [])
    assert clean["source"]["dataset_root"] == ""
    assert clean["observed"] == original["observed"]
    assert original == saved
    with pytest.raises(ValueError, match="absolute path"):
        export.public_value({"unexpected": "/Users/private/file"}, [])


def test_removed_metadata_prevents_publish(setup, monkeypatch):
    dataset, _, out, args = setup
    original = export.generate

    def remove_metadata(*params):
        result = original(*params)
        (dataset / "v1.0-mini/0.json").unlink()
        return result

    monkeypatch.setattr(export, "generate", remove_metadata)
    assert export.main(args) == 2
    assert not out.exists()


def test_missing_engine_cli(tmp_path):
    import sys

    out = tmp_path / "new-parent/out"
    result = subprocess.run(
        [
            sys.executable,
            str(SCRIPT),
            "--dataset",
            str(tmp_path / "absent-dataset"),
            "--engine",
            str(tmp_path / "absent-engine"),
            "--out",
            str(out),
        ],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 3
    assert "ENGINE_MISSING" in result.stderr
    assert not out.parent.exists()
