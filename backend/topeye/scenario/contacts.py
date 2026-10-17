"""Sampled 2D oriented-box contacts; not a continuous collision guarantee."""

from itertools import combinations

import numpy as np


def corners(actor, row):
    half = np.array([actor["length_m"], actor["width_m"]]) / 2
    rectangle = np.array([[-1, -1], [1, -1], [1, 1], [-1, 1]]) * half
    c, s = np.cos(row["yaw_rad"]), np.sin(row["yaw_rad"])
    return rectangle @ np.array([[c, s], [-s, c]]) + [row["x_m"], row["y_m"]]


def clearance(a, b):
    separated = False
    for polygon in (a, b):
        for edge in np.roll(polygon, -1, axis=0) - polygon:
            axis = np.array([-edge[1], edge[0]])
            x, y = a @ axis, b @ axis
            separated |= x.max() < y.min() or y.max() < x.min()
    if not separated:
        return 0.0
    distances = []
    for points, polygon in ((a, b), (b, a)):
        for start, end in zip(polygon, np.roll(polygon, -1, axis=0), strict=True):
            edge = end - start
            progress = np.clip((points - start) @ edge / (edge @ edge), 0, 1)
            distances.extend(np.linalg.norm(points - start - progress[:, None] * edge, axis=1))
    return float(min(distances))


def contact_events(actors, observed):
    indexed = {a["id"]: {} for a in actors}
    for row in observed:
        if row["id"] in indexed and all(
            np.isfinite(row[k]) for k in ("t_s", "x_m", "y_m", "yaw_rad")
        ):
            indexed[row["id"]][round(row["t_s"], 6)] = row
    events = []
    for a, b in combinations(actors, 2):
        left, right = indexed[a["id"]], indexed[b["id"]]
        common = sorted(left.keys() & right.keys())
        if not common:
            continue
        gaps = [clearance(corners(a, left[t]), corners(b, right[t])) for t in common]
        contacts = [t for t, gap in zip(common, gaps, strict=True) if gap <= 1e-8]
        events.append(
            {
                "actors": [a["id"], b["id"]],
                "minimum_clearance_xy_m": min(gaps),
                "contact_samples": len(contacts),
                "first_contact_s": contacts[0] if contacts else None,
                "last_contact_s": contacts[-1] if contacts else None,
                "method": "sampled 2D oriented boxes; ignores height; not continuous collision detection",
            }
        )
    return events


EGO_CONTACT_STEP = 0.05  # s, sampling of the ego-contact gate (the XOSC import grid)


def first_ego_contact(actors, step=EGO_CONTACT_STEP):
    """(other id, t) of the earliest sampled moment the ego's box touches another actor's box, or None (plan51).
    Boxes are the actors' displayed geometric centres; sampled, not continuous — like contact_events."""
    from topeye.scenario.models import interpolate, matrix

    ego = next((a for a in actors if a.get("role") == "ego"), None)
    if ego is None or len(ego["samples"]) < 2:
        return None
    path = matrix(ego)
    first = None
    for other in actors:
        if other is ego or len(other["samples"]) < 2:
            continue
        track = matrix(other)
        lo, hi = max(path[0, 0], track[0, 0]), min(path[-1, 0], track[-1, 0])
        if first is not None:
            hi = min(hi, first[1])
        if hi < lo:
            continue
        times = np.arange(lo, hi + 1e-9, step)
        a, b = interpolate(path, times), interpolate(track, times)
        for k, t in enumerate(times):
            pa = {"x_m": a[k, 1], "y_m": a[k, 2], "yaw_rad": a[k, 4]}
            pb = {"x_m": b[k, 1], "y_m": b[k, 2], "yaw_rad": b[k, 4]}
            if clearance(corners(ego, pa), corners(other, pb)) <= 1e-8:
                if first is None or t < first[1]:
                    first = (other["id"], round(float(t), 2))
                break
    return first
