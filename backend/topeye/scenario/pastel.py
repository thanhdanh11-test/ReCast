"""Offline display overlays. Authoritative source geometry and actor poses stay untouched."""

import gzip
import hashlib
import json
import math
import re
from pathlib import Path

ASSETS = Path(__file__).resolve().parents[2] / "assets" / "pastel-maps"


def valid_presentation(value):
    """Validate the packaged display boundary before the renderer dereferences it."""

    def number(n):
        return isinstance(n, (int, float)) and not isinstance(n, bool) and math.isfinite(n)

    def rows(items, minimum, width):
        return (
            isinstance(items, list)
            and len(items) >= minimum
            and all(
                isinstance(row, list) and len(row) >= width and all(number(n) for n in row)
                for row in items
            )
        )

    def polygon(item, key):
        return (
            isinstance(item, dict)
            and rows(item.get(key), 3, 2)
            and isinstance(item.get("holes"), list)
            and all(rows(hole, 3, 2) for hole in item["holes"])
        )

    def objects(key, predicate):
        return isinstance(value.get(key), list) and all(predicate(item) for item in value[key])

    if not isinstance(value, dict):
        return False
    bounds, ground = value.get("bounds_m"), value.get("ground")
    return (
        isinstance(bounds, list)
        and len(bounds) == 4
        and all(number(n) for n in bounds)
        and bounds[0] < bounds[2]
        and bounds[1] < bounds[3]
        and isinstance(ground, dict)
        and number(ground.get("cell_m"))
        and ground["cell_m"] > 0
        and rows(ground.get("samples"), 0, 5)
        and objects("surfaces", lambda p: polygon(p, "outer") and isinstance(p.get("kind"), str))
        and objects(
            "buildings",
            lambda p: (
                polygon(p, "polygon")
                and number(p.get("base_z"))
                and number(p.get("height"))
                and p["height"] > 0
            ),
        )
        and objects(
            "lines",
            lambda p: (
                isinstance(p, dict)
                and isinstance(p.get("kind"), str)
                and rows(p.get("points"), 2, 2)
            ),
        )
        and objects("landscape", lambda p: polygon(p, "polygon"))
        and all(
            objects(
                key,
                lambda p, fields=fields: (
                    isinstance(p, dict) and all(number(p.get(k)) for k in fields)
                ),
            )
            for key, fields in (
                ("trees", ("x", "y", "z", "height", "crown_radius")),
                ("poles", ("x", "y", "z", "height")),
            )
        )
        and objects("diagnostics", lambda s: isinstance(s, str))
        and isinstance(value.get("attribution"), str)
    )


def fingerprint(source):
    identity = source.get("source", {})
    value = {
        "source": {k: identity.get(k) for k in ("scene", "dataset_version", "origin_global_m")},
        "actors": source.get("actors", []),
        "environment": {
            k: v
            for k, v in source.get("environment", {}).items()
            if k not in {"presentation", "stats", "warnings", "provenance"}
        },
    }
    return hashlib.sha256(
        json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
    ).hexdigest()


def apply_pastel(source, assets=ASSETS):
    """Fail open to ordinary rendering if the packaged overlay doesn't match this exact source."""
    scene = source.get("source", {}).get("scene", "")
    if not isinstance(scene, str) or not re.fullmatch(r"[a-zA-Z0-9-]{1,80}", scene):
        return source
    try:
        with gzip.open(assets / f"{scene}.json.gz", "rt") as stream:
            overlay = json.loads(stream.read(8 * 1024 * 1024))
        presentation = overlay["presentation"]
        if (
            overlay["schema_version"] != 1
            or overlay["fingerprint"] != fingerprint(source)
            or presentation["style"] != "pastel-v1"
            or presentation["schema_version"] != 1
            or not valid_presentation(presentation)
        ):
            return source
        return {**source, "environment": {**source["environment"], "presentation": presentation}}
    except (OSError, EOFError, ValueError, KeyError, TypeError):
        return source
