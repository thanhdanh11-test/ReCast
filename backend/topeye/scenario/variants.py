"""Arc-length speed/offset variants with bounded common support."""

import uuid
from copy import deepcopy

import numpy as np

from topeye.scenario.models import interpolate, matrix, require, samples, validate


def make_variant(base, target_actor, speed_factor, gap_offset_m):
    validate(base)
    require(
        np.isfinite([speed_factor, gap_offset_m]).all()
        and 0.5 <= speed_factor <= 1.5
        and -10 <= gap_offset_m <= 10,
        "Speed must be 0.5–1.5; offset −10–10 m",
    )
    actor = next((a for a in base["actors"] if a["id"] == target_actor), None)
    require(actor is not None and actor["role"] == "traffic", "Select a traffic actor")
    data = matrix(actor)
    arc = np.r_[0, np.cumsum(np.linalg.norm(np.diff(data[:, 1:3], axis=0), axis=1))]
    identity = speed_factor == 1 and gap_offset_m == 0
    require(arc[-1] > 0.1 or identity, "Cannot change speed/offset of stationary track")
    result = deepcopy(base)
    if not identity:
        times = np.unique(np.r_[np.arange(0, base["interval_s"][1], 0.05), base["interval_s"][1]])
        desired = speed_factor * np.interp(times, data[:, 0], arc) + gap_offset_m
        valid = (desired >= 0) & (desired <= arc[-1])
        times, desired = times[valid], desired[valid]
        require(
            len(times) >= 3 and times[-1] - times[0] >= 2,
            "Variant has less than 2 seconds of supported path",
            "TRACK_TOO_SHORT",
        )
        unique = np.r_[True, np.diff(arc) > 1e-8]
        path = data[unique].copy()
        path[:, 0] = arc[unique]
        shifted = interpolate(path, desired)
        shifted[:, 0] = times
        for a in result["actors"]:
            values = shifted.copy() if a["id"] == target_actor else interpolate(matrix(a), times)
            values[:, 0] -= times[0]
            a["samples"] = samples(values)
        result["source"]["variant_time_offset_s"] = float(times[0])
        result["interval_s"] = [0, float(times[-1] - times[0])]
    result["id"] = uuid.uuid4().hex
    result["variant"] = {
        "parent_id": base["id"],
        "target_actor": target_actor,
        "speed_factor": speed_factor,
        "gap_offset_m": gap_offset_m,
    }
    return validate(result)
