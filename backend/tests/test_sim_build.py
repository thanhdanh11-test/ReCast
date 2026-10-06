"""Build budget, failure propagation and publication contracts."""
import json
from types import SimpleNamespace

import pytest

from topeye.sim import cli, gs_data


@pytest.fixture
def build_env(tmp_path, monkeypatch):
    config = tmp_path / "config.toml"
    config.write_text('nusc_root = "unused"\n')
    out = tmp_path / "data/sim/scene-0061"
    is_file = cli.Path.is_file
    monkeypatch.setattr(cli.Path, "is_file", lambda path: (
        True if str(path).endswith(".tools/mpsplat/.venv/bin/python") else is_file(path)))
    monkeypatch.setattr(cli, "load_config", lambda _: SimpleNamespace(nusc_root=tmp_path))
    monkeypatch.setattr(cli, "blender_bin", lambda _: str(config))
    monkeypatch.setattr(cli, "NuScenesAdapter", lambda _: SimpleNamespace(scenes=lambda: ["scene-0061"]))

    def layout(*_):
        out.mkdir(parents=True, exist_ok=True)
        data = {"checks": {"ego_on_drivable": 1, "skipped_sweeps": 0}, "photo": {"other": 1}}
        (out / "layout.json").write_text(json.dumps(data))
        return data

    monkeypatch.setattr(cli, "build_layout", layout)
    monkeypatch.setattr(gs_data, "export_gs_dataset", lambda *a, **kw: {"hz": kw["max_hz"]})

    def run(command, **kwargs):
        target = cli.Path(command[command.index("--out") + 1])
        target.mkdir(parents=True)
        (target / "point_cloud.ply").write_bytes(b"new splat")
        (target / "metrics.json").write_text(json.dumps(
            {"psnr_test_masked": 18, "gaussians": 10, "iters": 5}))
        assert kwargs["timeout"] <= 900
        assert "--time-budget-s" in command and "--sky-model" in command
        assert command[command.index("--data") + 1].endswith("gs12")
        return SimpleNamespace(returncode=0)

    monkeypatch.setattr(cli.subprocess, "run", run)
    return config, out


def test_build_publishes_complete_run_and_timings(build_env):
    config, out = build_env
    assert cli.build_main(["--scene", "scene-0061", "--config", str(config)]) == 0
    report = json.loads((out / "build.json").read_text())
    assert report["budget_ok"] and report["steps"]["total_s"] <= 900
    assert set(report["steps"]) == {"layout_s", "gs_data_s", "splat_s", "total_s"}
    assert json.loads((out / "layout.json").read_text())["photo"] == {
        "other": 1, "trained_splat": "trained_splat.ply"}


@pytest.mark.parametrize("args", [["--hz", "nan"], ["--budget-s", "0"],
                                  ["--splat-budget-s", "900"]])
def test_build_rejects_bad_budget(build_env, args):
    config, _ = build_env
    assert cli.build_main(["--scene", "scene-0061", "--config", str(config), *args]) == 2


def test_failed_trainer_preserves_previous_splat(build_env, monkeypatch):
    config, out = build_env
    out.mkdir(parents=True)
    (out / "trained_splat.ply").write_bytes(b"previous")
    monkeypatch.setattr(cli.subprocess, "run", lambda *a, **kw: SimpleNamespace(returncode=1))
    assert cli.build_main(["--scene", "scene-0061", "--config", str(config)]) == 1
    assert (out / "trained_splat.ply").read_bytes() == b"previous"
    assert json.loads((out / "build.json").read_text())["failed_step"] == "splat_s"


def test_timeout_records_failed_step(build_env, monkeypatch):
    config, out = build_env

    def timeout(command, **kw):
        raise cli.subprocess.TimeoutExpired(command, kw["timeout"])

    monkeypatch.setattr(cli.subprocess, "run", timeout)
    assert cli.build_main(["--scene", "scene-0061", "--config", str(config)]) == 1
    assert not json.loads((out / "build.json").read_text())["budget_ok"]


def test_layout_budget_overrun_stops_before_export(build_env, monkeypatch):
    import time

    config, out = build_env
    ticks = iter([0, 0, 901, 901, 901])
    monkeypatch.setattr(time, "monotonic", lambda: next(ticks))
    monkeypatch.setattr(gs_data, "export_gs_dataset", lambda *a, **kw: pytest.fail("export after deadline"))
    assert cli.build_main(["--scene", "scene-0061", "--config", str(config)]) == 1
    report = json.loads((out / "build.json").read_text())
    assert report["failed_step"] == "layout_s" and report["steps"]["total_s"] == 901


def test_step_validation_failure_is_build_failure(build_env, monkeypatch):
    config, out = build_env

    def broken(*args, **kwargs):
        raise ValueError("invalid data during export")

    monkeypatch.setattr(gs_data, "export_gs_dataset", broken)
    assert cli.build_main(["--scene", "scene-0061", "--config", str(config)]) == 1
    assert json.loads((out / "build.json").read_text())["failed_step"] == "gs_data_s"



def test_missing_trainer_returns_environment_exit(build_env, monkeypatch):
    config, out = build_env
    monkeypatch.setattr(cli.Path, "is_file", lambda _: False)
    assert cli.build_main(["--scene", "scene-0061", "--config", str(config)]) == 3
    assert json.loads((out / "build.json").read_text())["failed_step"] == "preflight"


def test_build_rejects_path_traversal(build_env):
    config, _ = build_env
    assert cli.build_main(["--scene", "../escape", "--config", str(config)]) == 2
    assert not (config.parent / "data/escape").exists()
