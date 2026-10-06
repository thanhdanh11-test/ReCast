"""Load local TOML settings; relative paths are anchored to the config directory."""

import math
import os
import tomllib
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Config:
    nusc_root: Path
    cache_root: Path
    db_path: Path
    cvat_day2_detect_bin: Path | None
    calib_ok_ms: float
    calib_warn_ms: float
    blender_bin: str | None = None


def load_config(path: str | Path = "config.toml") -> Config:
    source = Path(path).expanduser().resolve()
    with source.open("rb") as stream:
        data = tomllib.load(stream)

    def resolve(value: str) -> Path:
        if not isinstance(value, str) or not value.strip():
            raise ValueError("Configured paths must be non-empty strings")
        result = Path(value).expanduser()
        return (source.parent / result).resolve()

    calib = data.get("calib", {})
    ok = float(calib.get("ok_ms", 50.0))
    warn = float(calib.get("warn_ms", 100.0))
    if not (math.isfinite(ok) and math.isfinite(warn) and 0 <= ok <= warn):
        raise ValueError("Calibration thresholds must be finite and 0 <= ok_ms <= warn_ms")
    detector = data.get("cvat_day2_detect_bin", "")
    return Config(
        nusc_root=resolve(os.environ.get("TOPEYE_NUSC_ROOT", data["nusc_root"])),
        cache_root=resolve(data.get("cache_root", "data/cache")),
        db_path=resolve(data.get("db_path", "data/topeye.sqlite3")),
        cvat_day2_detect_bin=resolve(detector) if detector else None,
        calib_ok_ms=ok,
        calib_warn_ms=warn,
        blender_bin=data.get("blender_bin") or None,
    )
