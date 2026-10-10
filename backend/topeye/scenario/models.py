"""Validated JSON domain model shared by CLI and private desktop worker."""

import hashlib
import json
import math
import os
import tempfile
from pathlib import Path

import numpy as np


class ScenarioError(ValueError):
    def __init__(self, code, message):
        self.code = code
        super().__init__(message)


def require(condition, message, code="INVALID_INPUT"):
    if not condition:
        raise ScenarioError(code, message)


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def validate(scenario):
    require(scenario.get("schema_version") == 1, "Unsupported scenario schema")
    actors = scenario.get("actors", [])
    require(2 <= len(actors) <= 4, "Select ego and 1–3 vehicles")
    require(len({a["id"] for a in actors}) == len(actors), "Duplicate actor IDs")
    require(sum(a["role"] == "ego" for a in actors) == 1, "Exactly one ego required")
    interval = scenario["interval_s"]
    require(
        all(finite(v) for v in interval) and interval[0] == 0 and interval[1] >= 2,
        "Common interval must be at least 2 seconds",
    )
    for a in actors:
        require(
            all(finite(a[k]) and a[k] > 0 for k in ("length_m", "width_m", "height_m")),
            "Invalid actor dimensions",
        )
        rows = a["samples"]
        require(len(rows) >= 3, "Track needs at least 3 samples", "TRACK_TOO_SHORT")
        values = matrix(a)
        require(np.isfinite(values).all(), "Non-finite trajectory")
        dt = np.diff(values[:, 0])
        require((dt > 0).all(), "Timestamps must be strictly increasing")
        require((dt <= 1.000001).all(), "Track gap exceeds 1 second", "GAP_IN_TRACK")
        require(
            abs(values[0, 0]) < 1e-6 and abs(values[-1, 0] - interval[1]) < 1e-6,
            "All actors must span the common interval",
        )
    return scenario


def matrix(actor):
    return np.array(
        [[s[k] for k in ("t_s", "x_m", "y_m", "z_m", "yaw_rad")] for s in actor["samples"]],
        dtype=float,
    )


def interpolate(values, times):
    times = np.asarray(times, dtype=float)
    require(
        times.min() >= values[0, 0] - 1e-8 and times.max() <= values[-1, 0] + 1e-8,
        "Trajectory extrapolation is forbidden",
    )
    result = np.column_stack(
        [times]
        + [
            np.interp(times, values[:, 0], np.unwrap(values[:, i]) if i == 4 else values[:, i])
            for i in range(1, 5)
        ]
    )
    result[:, 4] = (result[:, 4] + np.pi) % (2 * np.pi) - np.pi
    return result


def samples(values, observed_times=()):
    keys = ("t_s", "x_m", "y_m", "z_m", "yaw_rad")
    return [
        {
            **dict(zip(keys, map(float, row))),
            "observed": any(abs(row[0] - t) < 1e-6 for t in observed_times),
        }
        for row in values
    ]


def sha256(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def write_json(path, value):
    path = Path(path)
    payload = json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n"
    fd, name = tempfile.mkstemp(prefix="." + path.name + "-", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            stream.write(payload)
        os.replace(name, path)
    finally:
        Path(name).unlink(missing_ok=True)


def guard_output(output, dataset):
    output, dataset = Path(output).resolve(), Path(dataset).resolve()
    require(not output.is_relative_to(dataset), "Output is inside dataset", "PATH_ESCAPE")
    return output
