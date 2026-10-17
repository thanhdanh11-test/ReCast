"""Fixed-grid reactive scene metrics contract."""

import pytest
from test_scenario_reactive import platoon

from topeye.scenario.models import ScenarioError
from topeye.scenario.reactive import scene_model
from topeye.scenario.reactive_metrics import DECELS, TARGETS, grid_candidates, reactive_metrics
from topeye.scenario.worker import Service


def test_grid_and_counts_are_deterministic():
    model = scene_model(platoon(duration=20))
    events = grid_candidates(model)
    assert events
    assert all(event.decel in DECELS and (event.target, event.dwell) in TARGETS for event in events)
    assert all(event.t0 % 2 == 1 for event in events)
    first = reactive_metrics(model, [1.0])
    second = reactive_metrics(model, [1.0])
    first.pop("runtime_s")
    second.pop("runtime_s")
    assert first == second
    assert first["tried"] == len(events) == len(first["cells"])
    assert first["esmini_checked"] is False
    assert first["pilot"]["rare"] == len(first["rare"])
    assert all(cell[method]["valid"] or cell[method]["group"] is None
               for cell in first["cells"] for method in ("baseline", "pilot"))


@pytest.mark.parametrize("reactions", [[], [0.2], [3.1], [1.0, 1.0, 1.0, 1.0], [True]])
def test_reject_bad_reactions(reactions):
    with pytest.raises(ScenarioError) as error:
        reactive_metrics(scene_model(platoon(duration=5)), reactions)
    assert error.value.code == "INVALID_INPUT"


def test_metrics_worker_route_is_read_only_and_cached(monkeypatch, tmp_path):
    from topeye.scenario import reactive_metrics as module

    service = Service()
    service.adapter = type("Adapter", (), {"root": tmp_path})()
    monkeypatch.setattr(service, "use_adapter", lambda *_: None)
    monkeypatch.setattr(service, "cached_source", lambda *_: platoon(duration=5))
    calls = []
    monkeypatch.setattr(module, "reactive_metrics", lambda *_: calls.append(1) or {"tried": 0})
    params = {"dataset": str(tmp_path), "scene": "scene-0061", "reactions": [1.0]}
    assert service.call("reactive_metrics", params) == {"tried": 0}
    assert service.call("reactive_metrics", params) == {"tried": 0}
    assert calls == [1]
    assert not list(tmp_path.iterdir())


def test_empty_scene_still_completes_progress():
    updates = []
    result = reactive_metrics(scene_model(platoon(duration=5)), [1.0], lambda *args: updates.append(args))
    assert result["tried"] == 0
    assert updates
    repeated = reactive_metrics(scene_model(platoon(duration=5)), [1.0, 1.0])
    assert len(repeated["sensitivity"]) == 2
