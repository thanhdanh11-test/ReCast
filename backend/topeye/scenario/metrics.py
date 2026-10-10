"""Score timestamped simulator output against a separately retained reference."""

import numpy as np

from topeye.scenario.contacts import contact_events
from topeye.scenario.models import interpolate, matrix, validate


def score_replay(reference, observed):
    validate(reference)
    duration = reference["interval_s"][1]
    expected = np.arange(0, duration + 1e-7, 0.05)
    per_actor = []
    all_valid = True
    for actor in reference["actors"]:
        rows = [r for r in observed if r["id"] == actor["id"]]
        data = np.array(
            [[r[k] for k in ("t_s", "x_m", "y_m", "z_m", "yaw_rad")] for r in rows], dtype=float
        ).reshape(-1, 5)
        valid = len(data) > 1 and np.isfinite(data).all()
        valid = valid and bool((np.diff(data[:, 0]) > 0).all())
        if not valid:
            per_actor.append(
                {
                    "id": actor["id"],
                    "n": len(data),
                    "coverage": 0,
                    "status": "fail",
                    "reason": "missing/nonfinite/duplicate poses",
                }
            )
            all_valid = False
            continue
        data = data[(data[:, 0] >= 0) & (data[:, 0] <= duration + 1e-8)]
        coverage = float(np.mean([np.any(np.abs(data[:, 0] - t) < 1e-5) for t in expected]))
        if len(data) < 2:
            per_actor.append(
                {
                    "id": actor["id"],
                    "n": len(data),
                    "coverage": coverage,
                    "status": "fail",
                    "reason": "no overlap",
                }
            )
            all_valid = False
            continue
        target = interpolate(matrix(actor), data[:, 0])
        errors = np.linalg.norm(data[:, 1:3] - target[:, 1:3], axis=1)
        heading = (data[:, 4] - target[:, 4] + np.pi) % (2 * np.pi) - np.pi
        velocity = np.diff(data[:, 1:3], axis=0) / np.diff(data[:, 0])[:, None]
        speed = np.linalg.norm(velocity, axis=1)
        acceleration = np.linalg.norm(np.diff(velocity, axis=0), axis=1) / np.diff(data[1:, 0])
        result = {
            "id": actor["id"],
            "n": len(data),
            "coverage": coverage,
            "ade_xy_m": float(errors.mean()),
            "fde_xy_m": float(errors[-1]),
            "max_xy_m": float(errors.max()),
            "yaw_rmse_rad": float(np.sqrt(np.mean(heading**2))),
            "max_speed_mps": float(speed.max()),
            "max_acceleration_mps2": float(acceleration.max()) if len(acceleration) else 0,
        }
        result["tracking_pass"] = (
            coverage >= 0.99
            and result["ade_xy_m"] <= 0.25
            and result["fde_xy_m"] <= 0.5
            and result["max_xy_m"] <= 0.5
            and result["yaw_rmse_rad"] <= 0.05
        )
        result["dynamics_pass"] = (
            result["max_speed_mps"] <= 40 and result["max_acceleration_mps2"] <= 10
        )
        result["status"] = "pass" if result["tracking_pass"] and result["dynamics_pass"] else "fail"
        all_valid &= result["status"] == "pass"
        per_actor.append(result)
    return {
        "coverage": min(r["coverage"] for r in per_actor),
        "per_actor": per_actor,
        "validity": {
            "schema": True,
            "engine_completed": False,
            "coverage": all(r["coverage"] >= 0.99 for r in per_actor),
            "dynamic_checks": all(r.get("dynamics_pass", False) for r in per_actor),
        },
        "thresholds": {
            "version": 1,
            "ade_m": 0.25,
            "max_xy_m": 0.5,
            "fde_m": 0.5,
            "yaw_rmse_rad": 0.05,
            "max_speed_mps": 40,
            "max_acceleration_mps2": 10,
        },
        "events": contact_events(reference["actors"], observed),
        "status": "pass" if all_valid else "fail",
    }
