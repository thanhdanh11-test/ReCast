from pathlib import Path

import pytest

from topeye.config import load_config


def test_config_paths_and_environment(tmp_path, monkeypatch):
    path = tmp_path / "config.toml"
    path.write_text('nusc_root="source"\n[calib]\nok_ms=20\nwarn_ms=30\n')
    config = load_config(path)
    assert config.nusc_root == tmp_path / "source"
    assert config.cache_root == tmp_path / "data/cache"
    assert config.db_path == tmp_path / "data/topeye.sqlite3"
    assert config.cvat_day2_detect_bin is None
    assert (config.calib_ok_ms, config.calib_warn_ms) == (20, 30)
    monkeypatch.setenv("TOPEYE_NUSC_ROOT", "~/dataset")
    assert load_config(path).nusc_root == Path.home() / "dataset"


def test_invalid_threshold_order(tmp_path):
    path = tmp_path / "config.toml"
    path.write_text('nusc_root="source"\n[calib]\nok_ms=101\nwarn_ms=100\n')
    with pytest.raises(ValueError, match="thresholds"):
        load_config(path)
