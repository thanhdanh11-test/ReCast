"""Display overlays must never change map contracts or source actors."""

import copy
import gzip
import json

import pytest
from test_scenario_map_context import source_fixture

from topeye.scenario.map_context import build_map_context
from topeye.scenario.pastel import apply_pastel, fingerprint


def package(tmp_path, source):
    value = {
        "schema_version": 1,
        "fingerprint": fingerprint(source),
        "presentation": {
            "schema_version": 1,
            "style": "pastel-v1",
            "bounds_m": [-210, -210, 210, 210],
            "ground": {"cell_m": 2, "samples": []},
            "surfaces": [],
            "buildings": [],
            "landscape": [],
            "diagnostics": [],
            "lines": [],
            "trees": [],
            "poles": [],
            "attribution": "OSM",
        },
    }
    path = tmp_path / f"{source['source']['scene']}.json.gz"
    path.write_bytes(gzip.compress(json.dumps(value).encode()))
    return path


def test_display_only_preserves_hash_and_source(tmp_path):
    source = source_fixture()
    before = copy.deepcopy(source)
    package(tmp_path, source)
    shown = apply_pastel(source, tmp_path)
    assert shown["environment"]["presentation"]["style"] == "pastel-v1"
    assert source == before
    assert shown["actors"] == source["actors"]
    assert build_map_context(shown) == build_map_context(source)
    assert {k: v for k, v in shown["environment"].items() if k != "presentation"} == source[
        "environment"
    ]


@pytest.mark.parametrize("field", ["origin", "version", "actors", "geometry"])
def test_stale_or_other_dataset_never_uses_overlay(tmp_path, field):
    source = source_fixture()
    package(tmp_path, source)
    if field == "origin":
        source["source"]["origin_global_m"][0] += 1
    if field == "version":
        source["source"]["dataset_version"] = "v1.0-trainval"
    if field == "actors":
        source["actors"][0]["samples"][0]["x_m"] += 1
    if field == "geometry":
        source["environment"]["polygons"][0]["outer"][0][0] -= 1
    assert apply_pastel(source, tmp_path) is source


def test_missing_corrupt_and_unsafe_are_ordinary_source(tmp_path):
    source = source_fixture()
    assert apply_pastel(source, tmp_path) is source
    path = package(tmp_path, source)
    path.write_bytes(b"broken gzip")
    assert apply_pastel(source, tmp_path) is source
    source["source"]["scene"] = "../scene-test"
    assert apply_pastel(source, tmp_path) is source


@pytest.mark.parametrize(
    "corruption", ["missing_ground", "invalid_samples", "invalid_polygon", "nonfinite"]
)
def test_corrupt_schema_falls_back(tmp_path, corruption):
    source = source_fixture()
    path = package(tmp_path, source)
    value = json.loads(gzip.decompress(path.read_bytes()))
    p = value["presentation"]
    if corruption == "missing_ground":
        del p["ground"]
    elif corruption == "invalid_samples":
        p["ground"]["samples"] = [None]
    elif corruption == "invalid_polygon":
        p["surfaces"] = [{"kind": "road", "outer": [], "holes": []}]
    else:
        p["bounds_m"][0] = float("nan")
    path.write_bytes(gzip.compress(json.dumps(value).encode()))
    assert apply_pastel(source, tmp_path) is source
