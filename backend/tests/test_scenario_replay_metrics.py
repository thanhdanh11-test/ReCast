"""Replay error reconstruction and holdout regression."""

import numpy as np
import pytest
from test_scenario_reactive import platoon

from topeye.scenario.models import ScenarioError
from topeye.scenario.reactive import scene_model
from topeye.scenario.replay_metrics import _baseline, _holdout, _row, replay_error_metrics


def test_baseline_keeps_path_but_uses_constant_speed():
    track = scene_model(platoon(duration=2)).tracks[1].with_poses(
        np.array([0., 1., 2.]), np.array([[0., 0.], [1., 0.], [4., 0.]]), np.zeros(3))
    baseline = _baseline(track)
    assert np.interp(1, baseline.t, baseline.xy[:, 0]) == pytest.approx(2.)
    assert baseline.xy[-1, 0] == pytest.approx(4.)
    sampled = np.column_stack([track.t, track.xy, track.yaw])
    assert _row(track, sampled)["ade"] == pytest.approx(0.)


def test_holdout_reports_each_method():
    tracks = scene_model(platoon(duration=5)).tracks
    result = _holdout(tracks)
    assert result["n"] >= 1
    assert set(result["ade"]) == {"exact", "baseline", "pilot"}
    assert all(value is not None and value >= 0 for value in result["ade"].values())


def test_missing_engine_is_explicit():
    with pytest.raises(ScenarioError) as error:
        replay_error_metrics(scene_model(platoon(duration=5)), "/missing/esmini")
    assert error.value.code == "ESMINI_MISSING"
