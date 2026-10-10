"""Pinned esmini 3.9.0 C ABI. Runs in a child process, never in the UI worker."""

import ctypes as C
import json
from pathlib import Path

from topeye.scenario.models import require, write_json


class ObjectState(C.Structure):
    _fields_ = (
        [("id", C.c_int), ("model_id", C.c_int), ("ctrl_type", C.c_int)]
        + [(k, C.c_double) for k in ("timestamp", "x", "y", "z", "h", "p", "r")]
        + [("roadId", C.c_uint), ("junctionId", C.c_uint), ("t", C.c_double), ("laneId", C.c_int)]
        + [
            (k, C.c_double)
            for k in (
                "laneOffset",
                "s",
                "speed",
                "centerOffsetX",
                "centerOffsetY",
                "centerOffsetZ",
                "width",
                "length",
                "height",
            )
        ]
        + [
            ("objectType", C.c_int),
            ("objectCategory", C.c_int),
            ("wheel_angle", C.c_double),
            ("wheel_rot", C.c_double),
            ("visibilityMask", C.c_int),
        ]
    )


def execute(bundle, engine, output):
    bundle, engine, output = Path(bundle).resolve(), Path(engine).resolve(), Path(output).resolve()
    require(engine.is_file(), "esmini library is missing", "ENGINE_MISSING")
    lib = C.CDLL(str(engine))
    lib.SE_Init.argtypes = [C.c_char_p, C.c_int, C.c_int, C.c_int, C.c_int]
    lib.SE_Init.restype = C.c_int
    lib.SE_StepDT.argtypes = [C.c_double]
    lib.SE_StepDT.restype = C.c_int
    lib.SE_GetSimulationTime.restype = C.c_double
    lib.SE_GetObjectState.argtypes = [C.c_int, C.POINTER(ObjectState)]
    lib.SE_GetObjectState.restype = C.c_int
    lib.SE_GetObjectName.argtypes = [C.c_int]
    lib.SE_GetObjectName.restype = C.c_char_p
    lib.SE_GetId.argtypes = [C.c_int]
    lib.SE_GetId.restype = C.c_int
    lib.SE_SetLogFilePath.argtypes = [C.c_char_p]
    lib.SE_SetLogFilePath(str(output / "esmini.log").encode())
    reference = json.loads((bundle / "reference.json").read_text())
    require(
        lib.SE_Init(str(bundle / "scenario.xosc").encode(), 1, 0, 0, 0) == 0,
        "esmini failed to initialize",
        "ENGINE_FAILED",
    )
    rows = []
    boxes = []
    try:
        count = lib.SE_GetNumberOfObjects()
        require(
            count == len(reference["actors"]), "Engine actor count mismatch", "ENGINE_INCOMPATIBLE"
        )
        duration = reference["interval_s"][1]
        steps = int((duration + 1e-7) / 0.05)
        for i in range(steps + 1):
            if i:
                require(lib.SE_StepDT(0.05) == 0, "Engine step failed", "ENGINE_FAILED")
            for index in range(count):
                identity = lib.SE_GetId(index)
                state = ObjectState()
                require(
                    lib.SE_GetObjectState(identity, C.byref(state)) == 0,
                    "Cannot read engine object state",
                    "ENGINE_INCOMPATIBLE",
                )
                if i == 0:
                    name = lib.SE_GetObjectName(identity).decode()
                    actor = next(a for a in reference["actors"] if a["id"] == name)
                    measured = {
                        "id": name,
                        "length_m": state.length,
                        "width_m": state.width,
                        "height_m": state.height,
                        "center_offset_m": [
                            state.centerOffsetX,
                            state.centerOffsetY,
                            state.centerOffsetZ,
                        ],
                    }
                    require(
                        all(
                            abs(measured[key] - actor[key]) < 1e-6
                            for key in ("length_m", "width_m", "height_m")
                        )
                        and all(abs(v) < 1e-6 for v in measured["center_offset_m"]),
                        f"Engine bounding-box convention mismatch: {measured}",
                        "ENGINE_INCOMPATIBLE",
                    )
                    boxes.append(measured)
                rows.append(
                    {
                        "id": lib.SE_GetObjectName(identity).decode(),
                        "t_s": float(lib.SE_GetSimulationTime()),
                        "x_m": state.x,
                        "y_m": state.y,
                        "z_m": state.z,
                        "yaw_rad": state.h,
                    }
                )
        write_json(output / "observed.json", rows)
        write_json(
            output / "engine-info.json",
            {"abi": "esmini-3.9.0", "object_state_bytes": C.sizeof(ObjectState), "boxes": boxes},
        )
    finally:
        lib.SE_Close()


def execute_imported(bundle, engine, output):
    """Explicit imported child: reference points retained, centers converted after measurement."""
    import math

    from topeye.scenario.models import finite

    bundle, engine, output = Path(bundle).resolve(), Path(engine).resolve(), Path(output).resolve()
    reference = json.loads((bundle / "scenario.json").read_text())
    lib = C.CDLL(str(engine))
    lib.SE_Init.argtypes = [C.c_char_p, C.c_int, C.c_int, C.c_int, C.c_int]
    lib.SE_Init.restype = C.c_int
    lib.SE_StepDT.argtypes = [C.c_double]
    lib.SE_StepDT.restype = C.c_int
    lib.SE_GetSimulationTime.restype = C.c_double
    lib.SE_GetObjectState.argtypes = [C.c_int, C.POINTER(ObjectState)]
    lib.SE_GetObjectName.argtypes = [C.c_int]
    lib.SE_GetObjectName.restype = C.c_char_p
    lib.SE_GetId.argtypes = [C.c_int]
    lib.SE_SetOptionValue.argtypes = [C.c_char_p, C.c_char_p]
    lib.SE_SetOptionValue.restype = C.c_int
    require(
        lib.SE_SetOptionValue(b"traj_filter", b"0") == 0,
        "Cannot disable imported trajectory filter",
        "ENGINE_INCOMPATIBLE",
    )
    lib.SE_SetLogFilePath.argtypes = [C.c_char_p]
    lib.SE_SetLogFilePath(str(output / "esmini.log").encode())
    require(
        lib.SE_Init(str(bundle / "normalized.xosc").encode(), 1, 0, 0, 0) == 0,
        "Roadless engine init failed",
        "ENGINE_INCOMPATIBLE",
    )
    rows, boxes = [], []
    try:
        count = lib.SE_GetNumberOfObjects()
        require(
            count == len(reference["actors"]),
            "Unexpected engine actor count",
            "ENGINE_INCOMPATIBLE",
        )
        by_id = {a["id"]: a for a in reference["actors"]}
        duration = reference["interval_s"][1]
        times = [i * 0.05 for i in range(int((duration + 1e-9) / 0.05) + 1)]
        if abs(times[-1] - duration) > 1e-9:
            times.append(duration)
        for i, time_s in enumerate(times):
            if i:
                require(
                    lib.SE_StepDT(time_s - times[i - 1]) == 0, "Engine step failed", "ENGINE_FAILED"
                )
            names = set()
            for index in range(count):
                identity = lib.SE_GetId(index)
                state = ObjectState()
                require(
                    lib.SE_GetObjectState(identity, C.byref(state)) == 0,
                    "Object state unavailable",
                    "ENGINE_INCOMPATIBLE",
                )
                name = lib.SE_GetObjectName(identity).decode()
                require(
                    name in by_id and name not in names,
                    "Unknown/duplicate engine name",
                    "ENGINE_INCOMPATIBLE",
                )
                names.add(name)
                actor = by_id[name]
                offset = [state.centerOffsetX, state.centerOffsetY, state.centerOffsetZ]
                measured = {
                    "id": name,
                    "length_m": state.length,
                    "width_m": state.width,
                    "height_m": state.height,
                    "center_offset_m": offset,
                    "object_type": state.objectType,
                }
                require(
                    all(
                        finite(v)
                        for v in [
                            state.x,
                            state.y,
                            state.z,
                            state.h,
                            *offset,
                            state.length,
                            state.width,
                            state.height,
                        ]
                    ),
                    "Nonfinite engine state",
                    "ENGINE_INCOMPATIBLE",
                )
                require(
                    all(
                        abs(measured[k] - actor[k]) < 1e-5
                        for k in ("length_m", "width_m", "height_m")
                    )
                    and all(abs(a - b) < 1e-5 for a, b in zip(offset, actor["center_offset_m"])),
                    "Engine bbox/reference mapping mismatch",
                    "ENGINE_INCOMPATIBLE",
                )
                require(
                    state.objectType == (2 if actor["category"].startswith("human.") else 1),
                    "Engine object type mismatch",
                    "ENGINE_INCOMPATIBLE",
                )
                if i == 0:
                    boxes.append(measured)
                cx, cy, cz = offset
                rows.append(
                    {
                        "id": name,
                        "t_s": float(lib.SE_GetSimulationTime()),
                        "reference_x_m": state.x,
                        "reference_y_m": state.y,
                        "reference_z_m": state.z,
                        "x_m": state.x + cx * math.cos(state.h) - cy * math.sin(state.h),
                        "y_m": state.y + cx * math.sin(state.h) + cy * math.cos(state.h),
                        "z_m": state.z + cz,
                        "yaw_rad": state.h,
                    }
                )
        write_json(output / "observed.json", rows)
        write_json(
            output / "engine-info.json",
            {"abi": "esmini-3.9.0", "object_state_bytes": C.sizeof(ObjectState), "boxes": boxes},
        )
    finally:
        lib.SE_Close()
