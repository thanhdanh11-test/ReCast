"""Worker in-memory source-scene cache: revisits skip the LiDAR build but stay independent."""

from types import SimpleNamespace

import pytest

from topeye.scenario.worker import SOURCE_CACHE_SIZE, Service


@pytest.fixture
def service(tmp_path, monkeypatch):
    from topeye.scenario import worker

    calls = []

    def fake_source(adapter, scene, progress):
        calls.append((adapter.root, scene))
        return {
            "id": f"{len(calls):032x}",
            "source": {"scene": scene},
            "environment": {"trees": [{"x": 1.0}]},
            "actors": [],
        }

    roots = {}
    monkeypatch.setattr(
        worker,
        "create_adapter",
        lambda root, version: roots.setdefault(
            (root, version), SimpleNamespace(root=root, version=version)
        ),
    )
    monkeypatch.setattr(worker, "source_scene", fake_source)
    params = {"dataset": str(tmp_path / "dataset"), "workspace": str(tmp_path / "workspace")}
    return Service(), params, calls, tmp_path


def test_revisit_is_cached_with_fresh_id_and_independent_copy(service):
    svc, params, calls, _ = service
    first = svc.call("source_scene", {**params, "scene": "scene-a"})
    first["environment"]["trees"].clear()  # caller mutation must not reach the cache
    second = svc.call("source_scene", {**params, "scene": "scene-a"})
    assert len(calls) == 1
    assert second["id"] != first["id"] and len(second["id"]) == 32
    assert second["environment"]["trees"] == [{"x": 1.0}]
    assert second["source"]["dataset_version"] == "v1.0-mini"
    # Both loads stay addressable by their own id for later map_context / import calls.
    assert first["id"] in svc.sources and second["id"] in svc.sources


def test_cache_is_bounded_and_cleared_when_the_dataset_changes(service):
    svc, params, calls, tmp_path = service
    for i in range(SOURCE_CACHE_SIZE + 1):
        svc.call("source_scene", {**params, "scene": f"scene-{i}"})
    svc.call("source_scene", {**params, "scene": "scene-0"})  # evicted (least recent) → rebuilt
    assert len(calls) == SOURCE_CACHE_SIZE + 2
    svc.call("source_scene", {**params, "scene": f"scene-{SOURCE_CACHE_SIZE}"})  # still cached
    assert len(calls) == SOURCE_CACHE_SIZE + 2
    other = {**params, "dataset": str(tmp_path / "other")}
    svc.call("source_scene", {**other, "scene": "scene-0"})
    assert len(calls) == SOURCE_CACHE_SIZE + 3
