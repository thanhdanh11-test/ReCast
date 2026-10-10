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
