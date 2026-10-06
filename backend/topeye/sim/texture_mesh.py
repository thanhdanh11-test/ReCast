"""Train-view triangle atlas and unlit CPU rendering for the S9 mesh experiment."""

import io
import json
import struct
from pathlib import Path

import cv2
import numpy as np
from scipy.sparse import coo_matrix
from scipy.spatial import cKDTree

from topeye.core.cache import atomic_write
from topeye.sim.layout import voxel_mesh


def triangulate(faces):
    faces = np.asarray(faces, np.int64)
    return np.concatenate([faces[:, [0, i, i + 1]] for i in range(1, faces.shape[1] - 1)])


def build_static_mesh(xyz, normals_hint=None, method="voxel_smooth", **kw):
    """Reconstruct, then remove unsupported triangles beyond 0.5 m from input points."""
    xyz = np.asarray(xyz, float)
    if xyz.ndim != 2 or xyz.shape[1] != 3 or not len(xyz) or not np.isfinite(xyz).all():
        raise ValueError("xyz must be nonempty finite (N,3)")
    if method == "voxel_smooth":
        keys = np.unique(np.floor(xyz / .2).astype(np.int64), axis=0)
        V, quads, _ = voxel_mesh(keys, np.zeros_like(keys), .2)
        V, inverse = np.unique(V, axis=0, return_inverse=True)
        F = triangulate(inverse[quads])
        edges = np.concatenate((F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]))
        edges = np.unique(np.concatenate((edges, edges[:, ::-1])), axis=0)
        degree = np.bincount(edges[:, 0], minlength=len(V))
        adjacency = coo_matrix((1 / degree[edges[:, 0]], edges.T),
                               shape=(len(V), len(V))).tocsr()
        for _ in range(kw.get("iterations", 5)):
            for weight in (.5, -.53):
                V += weight * (adjacency @ V - V)
    elif method == "poisson":
        import open3d as o3d
        cloud = o3d.geometry.PointCloud(o3d.utility.Vector3dVector(xyz))
        if normals_hint is None:
            cloud = cloud.voxel_down_sample(.2)
        if normals_hint is None:
            cloud.estimate_normals(o3d.geometry.KDTreeSearchParamHybrid(radius=.8, max_nn=30))
            cloud.orient_normals_consistent_tangent_plane(20)
        else:
            cloud.normals = o3d.utility.Vector3dVector(normals_hint)
        mesh, _ = o3d.geometry.TriangleMesh.create_from_point_cloud_poisson(
            cloud, depth=kw.get("depth", 10), n_threads=1)
        V, F = np.asarray(mesh.vertices).copy(), np.asarray(mesh.triangles).copy()
    else:
        raise ValueError("method must be poisson or voxel_smooth")
    before = len(F)
    if before > kw.get("max_triangles", 250_000):
        import open3d as o3d
        mesh = o3d.geometry.TriangleMesh(o3d.utility.Vector3dVector(V),
                                         o3d.utility.Vector3iVector(F))
        mesh = mesh.simplify_quadric_decimation(kw.get("max_triangles", 250_000))
        V, F = np.asarray(mesh.vertices).copy(), np.asarray(mesh.triangles).copy()
    if "stats" in kw:
        kw["stats"]["triangles_before_decimation"] = before
        kw["stats"]["triangles_after_decimation"] = len(F)
    # Check corners AND interior samples: do not bridge empty LiDAR regions.
    triangles = V[F]
    midpoints = (triangles + np.roll(triangles, -1, axis=1)) / 2
    samples = np.concatenate((triangles, midpoints, triangles.mean(axis=1)[:, None]), axis=1)
    distance = cKDTree(xyz).query(samples.reshape(-1, 3), workers=4)[0].reshape(-1, 7)
    supported = (distance <= .5).all(axis=1)
    if "stats" in kw:
        kw["stats"]["triangle_support_max_m"] = float(distance[supported].max()) if supported.any() else None
        kw["stats"]["support_samples_per_triangle"] = 7
    F = F[supported]
    if not len(F):
        raise ValueError("No supported triangles")
    used, inverse = np.unique(F, return_inverse=True)
    V, F = V[used], inverse.reshape(-1, 3)
    if "stats" in kw:
        import open3d as o3d
        scene = _ray_scene(V, F)
        distance = scene.compute_distance(o3d.core.Tensor(xyz.astype(np.float32))).numpy()
        kw["stats"].update(lidar_to_mesh_mean_m=float(distance.mean()),
                           lidar_to_mesh_p95_m=float(np.percentile(distance, 95)),
                           triangles_after_support_cut=len(F))
    return V, F


def _camera(V, view):
    inverse = np.linalg.inv(np.asarray(view["c2w"]))
    return V @ inverse[:3, :3].T + inverse[:3, 3]


def _fragments(camera, F, K, width, height):
    """Yield perspective-correct barycentrics; clip triangles against the near plane."""
    projected = camera @ K.T
    uv = projected[:, :2] / np.maximum(projected[:, 2:], 1e-12)
    triangles = camera[F]
    screen = uv[F]
    possible = ((triangles[:, :, 2].max(axis=1) > .05)
                & ~((screen[:, :, 0].max(axis=1) < 0)
                    | (screen[:, :, 0].min(axis=1) >= width)
                    | (screen[:, :, 1].max(axis=1) < 0)
                    | (screen[:, :, 1].min(axis=1) >= height)))
    possible |= ((triangles[:, :, 2].min(axis=1) < .05)
                 & (triangles[:, :, 2].max(axis=1) > .05))
    for index in np.flatnonzero(possible):
        poly = list(zip(triangles[index], np.eye(3)))
        clipped = []
        for i, (point, basis) in enumerate(poly):
            previous, pb = poly[i - 1]
            if (point[2] >= .05) != (previous[2] >= .05):
                t = (.05 - previous[2]) / (point[2] - previous[2])
                clipped.append((previous + t * (point - previous), pb + t * (basis - pb)))
            if point[2] >= .05:
                clipped.append((point, basis))
        for j in range(1, len(clipped) - 1):
            pts, basis = map(np.asarray, zip(clipped[0], clipped[j], clipped[j + 1]))
            p = pts @ K.T
            p = p[:, :2] / p[:, 2:]
            low = np.maximum(np.ceil(p.min(axis=0)), 0).astype(int)
            high = np.minimum(np.floor(p.max(axis=0)), [width - 1, height - 1]).astype(int)
            if (high < low).any():
                continue
            a, b = p[1] - p[0], p[2] - p[0]
            determinant = a[0] * b[1] - a[1] * b[0]
            if abs(determinant) < 1e-9:
                continue
            yy, xx = np.mgrid[low[1]:high[1] + 1, low[0]:high[0] + 1]
            dx, dy = xx - p[0, 0], yy - p[0, 1]
            w1 = (dx * b[1] - dy * b[0]) / determinant
            w2 = (a[0] * dy - a[1] * dx) / determinant
            w = np.stack((1 - w1 - w2, w1, w2), axis=-1)
            inside = (w >= -1e-7).all(axis=-1)
            if not inside.any():
                continue
            w = w[inside] / pts[:, 2]
            reciprocal = w.sum(axis=1)
            weights = (w / reciprocal[:, None]) @ basis
            yield index, yy[inside], xx[inside], 1 / reciprocal, weights


_SCENE_CACHE = []


def _ray_scene(V, F):
    """Cache the static and ground acceleration structures for the current method."""
    import open3d as o3d
    global _SCENE_CACHE
    for old_V, old_F, scene in _SCENE_CACHE:
        if old_V is V and old_F is F:
            return scene
    scene = o3d.t.geometry.RaycastingScene(nthreads=4)
    scene.add_triangles(o3d.core.Tensor(np.asarray(V, np.float32)),
                        o3d.core.Tensor(np.asarray(F, np.uint32)))
    _SCENE_CACHE.append((V, F, scene))
    _SCENE_CACHE = _SCENE_CACHE[-2:]
    return scene


def _render_rays(V, F, UV, atlas_rgb, view):
    import open3d as o3d
    width, height = view["width"], view["height"]
    yy, xx = np.mgrid[:height, :width]
    camera = np.stack((xx, yy, np.ones_like(xx)), axis=-1) @ np.linalg.inv(view["K"]).T
    pose = np.asarray(view["c2w"])
    directions = camera @ pose[:3, :3].T
    origins = np.broadcast_to(pose[:3, 3], directions.shape)
    rays = np.concatenate((origins, directions), axis=-1).astype(np.float32)
    hit = _ray_scene(V, F).cast_rays(o3d.core.Tensor(rays), nthreads=4)
    depth = hit["t_hit"].numpy()
    coverage = np.isfinite(depth)
    output = np.zeros((height, width, 3), np.uint8)
    if UV is not None:
        ids = hit["primitive_ids"].numpy()[coverage]
        w12 = hit["primitive_uvs"].numpy()[coverage]
        weights = np.column_stack((1 - w12.sum(axis=1), w12))
        coords = np.einsum("ni,nij->nj", weights, UV[F[ids]])
        u = np.clip(np.rint(coords[:, 0] * atlas_rgb.shape[1] - .5).astype(int),
                    0, atlas_rgb.shape[1] - 1)
        v = np.clip(np.rint((1 - coords[:, 1]) * atlas_rgb.shape[0] - .5).astype(int),
                    0, atlas_rgb.shape[0] - 1)
        output[coverage] = atlas_rgb[v, u]
    return output, coverage, depth


def render_mesh(V, F, UV, atlas_rgb, view):
    """Unlit RGB render and coverage, with a perspective-correct z-buffer."""
    try:
        import open3d  # noqa: F401
    except ImportError:
        pass
    else:
        return _render_rays(V, F, UV, atlas_rgb, view)
    width, height = view["width"], view["height"]
    depth = np.full((height, width), np.inf)
    output = np.zeros((height, width, 3), np.uint8)
    for index, y, x, z, weights in _fragments(
            _camera(V, view), F, np.asarray(view["K"]), width, height):
        take = z < depth[y, x]
        y, x, z, weights = y[take], x[take], z[take], weights[take]
        depth[y, x] = z
        if UV is not None:
            coordinates = weights @ UV[F[index]]
            u = np.clip(np.rint(coordinates[:, 0] * atlas_rgb.shape[1] - .5).astype(int),
                        0, atlas_rgb.shape[1] - 1)
            v = np.clip(np.rint((1 - coordinates[:, 1]) * atlas_rgb.shape[0] - .5).astype(int),
                        0, atlas_rgb.shape[0] - 1)
            output[y, x] = atlas_rgb[v, u]
    return output, np.isfinite(depth), depth


def texture_mesh(V, F, views, images, masks, depth_test=True, atlas_px=4096):
    """Select one visible train image per triangle; grid-pack disjoint padded patches.

    images are RGB uint8; masks use 255 for background. UVs use glTF's lower-left
    convention internally (the exporter converts to glTF image coordinates).
    """
    V, F = np.asarray(V, float), np.asarray(F, int)
    if (V.ndim != 2 or V.shape[1] != 3 or F.ndim != 2 or F.shape[1] != 3
            or not len(F) or not np.isfinite(V).all() or F.min() < 0 or F.max() >= len(V)):
        raise ValueError("A finite triangle mesh is required")
    if type(atlas_px) is not int or not 8 <= atlas_px <= 8192:
        raise ValueError("atlas_px must be in [8,8192]")
    if len(views) != len(images) or len(views) != len(masks):
        raise ValueError("views/images/masks must have equal lengths")
    if any(v.get("split", "train") != "train" for v in views):
        raise ValueError("Test images cannot texture the mesh")
    tri = V[F]
    centers = tri.mean(axis=1)
    normals = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    normals /= np.maximum(np.linalg.norm(normals, axis=1)[:, None], 1e-12)
    chosen = np.full(len(F), -1, int)
    best = np.zeros(len(F))
    samples = np.concatenate((centers[:, None],
                              centers[:, None] * .2 + tri * .8), axis=1)
    for k, (view, image, mask) in enumerate(zip(views, images, masks)):
        if image.shape != (view["height"], view["width"], 3) or mask.shape != image.shape[:2]:
            raise ValueError("Image/mask dimensions disagree with camera")
        ray_backend = None
        depth = None
        if depth_test:
            try:
                import open3d as ray_backend
            except ImportError:
                # Full-resolution fallback preserves thin occluders.
                depth = render_mesh(V, F, None, None, view)[2]
        camera = _camera(samples.reshape(-1, 3), view).reshape(-1, 4, 3)
        p = camera @ np.asarray(view["K"]).T
        uv = p[:, :, :2] / np.maximum(p[:, :, 2:], 1e-12)
        valid = ((camera[:, :, 2] > .05).all(axis=1)
                 & (uv >= 0).all(axis=(1, 2))
                 & (uv[:, :, 0] < view["width"]).all(axis=1)
                 & (uv[:, :, 1] < view["height"]).all(axis=1))
        ids = np.flatnonzero(valid)
        pixels = uv[ids].astype(int)
        visible = (mask[pixels[:, :, 1], pixels[:, :, 0]] == 255).all(axis=1)
        # A conservative integral-image footprint rejects dynamic pixels even between samples.
        corners = _camera(tri[ids].reshape(-1, 3), view).reshape(-1, 3, 3)
        projected = corners @ np.asarray(view["K"]).T
        projected = projected[:, :, :2] / np.maximum(projected[:, :, 2:], 1e-12)
        visible &= ((corners[:, :, 2] > .05).all(axis=1)
                    & (projected >= 0).all(axis=(1, 2))
                    & (projected[:, :, 0] < view["width"]).all(axis=1)
                    & (projected[:, :, 1] < view["height"]).all(axis=1))
        low = np.clip(np.floor(projected.min(axis=1)), [0, 0],
                      [view["width"] - 1, view["height"] - 1]).astype(int)
        high = np.clip(np.ceil(projected.max(axis=1)) + 1, [0, 0],
                       [view["width"], view["height"]]).astype(int)
        integral = cv2.integral((mask != 255).astype(np.uint8))
        excluded = (integral[high[:, 1], high[:, 0]] - integral[low[:, 1], high[:, 0]]
                    - integral[high[:, 1], low[:, 0]] + integral[low[:, 1], low[:, 0]])
        visible &= excluded == 0
        if depth_test and len(ids):
            if ray_backend is not None:
                origin = np.asarray(view["c2w"])[:3, 3]
                directions = samples[ids] - origin
                distance = np.linalg.norm(directions, axis=2)
                rays = np.concatenate((np.broadcast_to(origin, directions.shape),
                                       directions), axis=2).astype(np.float32)
                hit = _ray_scene(V, F).cast_rays(ray_backend.core.Tensor(rays), nthreads=4)
                hit_distance = hit["t_hit"].numpy() * distance
                visible &= (hit_distance >= distance - .02).all(axis=1)
            else:
                visible &= (camera[ids, :, 2] <= depth[pixels[:, :, 1], pixels[:, :, 0]]
                            + .02).all(axis=1)
        ray = np.asarray(view["c2w"])[:3, 3] - centers[ids]
        distance = np.linalg.norm(ray, axis=1)
        score = np.maximum((normals[ids] * ray).sum(axis=1), 0) / np.maximum(distance ** 2, 1e-12)
        take = visible & (score > best[ids])
        chosen[ids[take]], best[ids[take]] = k, score[take]
    columns = int(np.ceil(np.sqrt(len(F))))
    cell = atlas_px // columns
    if cell < 7:
        raise ValueError("Too many triangles for atlas with 2px padding")
    size = columns * cell
    atlas = np.zeros((size, size, 3), np.uint8)
    UV = np.empty((len(F), 3, 2))
    colors = np.full((len(F), 3), 128, np.uint8)
    destination = np.array([[2, 2], [cell - 3, 2], [2, cell - 3]], np.float32)
    for i in np.flatnonzero(chosen >= 0):
        view, image = views[chosen[i]], images[chosen[i]]
        p = _camera(tri[i], view) @ np.asarray(view["K"]).T
        yy, xx = np.mgrid[:cell, :cell]
        w1, w2 = (xx - 2) / (cell - 5), (yy - 2) / (cell - 5)
        weights = np.stack((1 - w1 - w2, w1, w2), axis=-1)
        projected = weights @ p
        coords = projected[:, :, :2] / np.maximum(projected[:, :, 2:], 1e-12)
        patch = cv2.remap(image, coords[:, :, 0].astype(np.float32),
                          coords[:, :, 1].astype(np.float32), cv2.INTER_LINEAR,
                          borderMode=cv2.BORDER_REPLICATE)
        # Replicate the 2px external border so adjacent patches cannot bleed.
        patch = cv2.copyMakeBorder(patch[2:-2, 2:-2], 2, 2, 2, 2, cv2.BORDER_REPLICATE)
        y, x = divmod(i, columns)
        atlas[y * cell:(y + 1) * cell, x * cell:(x + 1) * cell] = patch
        inside = (w1 >= 0) & (w2 >= 0) & (w1 + w2 <= 1)
        colors[i] = np.median(patch[inside], axis=0)
    seen = chosen >= 0
    unseen = np.flatnonzero(~seen)
    if seen.any() and len(unseen):
        _, neighbors = cKDTree(centers[seen]).query(centers[unseen], k=min(8, seen.sum()))
        colors[unseen] = np.median(colors[seen][neighbors.reshape(len(unseen), -1)], axis=1)
    for i in range(len(F)):
        y, x = divmod(i, columns)
        if not seen[i]:
            atlas[y * cell:(y + 1) * cell, x * cell:(x + 1) * cell] = colors[i]
        coords = destination + [x * cell, y * cell] + .5
        UV[i] = np.column_stack((coords[:, 0] / size, 1 - coords[:, 1] / size))
    return (tri.reshape(-1, 3), np.arange(len(F) * 3).reshape(-1, 3),
            UV.reshape(-1, 2), atlas,
            {"unseen_ratio": float((~seen).mean()), "triangles": len(F),
             "atlas_px": size, "patch_px": cell, "chosen_views": chosen.tolist()})


def export_textured(path_glb, V, F, UV, atlas_rgb):
    """Write an embedded PNG glTF 2.0 binary with KHR_materials_unlit."""
    buffers, accessors, views = [], [], []

    def add(data, component=None, kind=None, bounds=None):
        offset = sum(len(b) for b in buffers)
        views.append({"buffer": 0, "byteOffset": offset, "byteLength": len(data)})
        buffers.append(data + b"\0" * (-len(data) % 4))
        if component is None:
            return len(views) - 1
        count = len(data) // ({5126: 4, 5125: 4}[component] * {"SCALAR": 1, "VEC2": 2,
                                                                          "VEC3": 3}[kind])
        entry = {"bufferView": len(views) - 1, "componentType": component,
                 "count": count, "type": kind}
        if bounds:
            entry.update(min=bounds[0], max=bounds[1])
        accessors.append(entry)
        return len(accessors) - 1

    position = add(np.asarray(V, "<f4").tobytes(), 5126, "VEC3",
                   (np.min(V, axis=0).tolist(), np.max(V, axis=0).tolist()))
    gltf_uv = np.asarray(UV, "<f4").copy()
    gltf_uv[:, 1] = 1 - gltf_uv[:, 1]
    texcoord = add(gltf_uv.tobytes(), 5126, "VEC2")
    indices = add(np.asarray(F, "<u4").tobytes(), 5125, "SCALAR")
    ok, png = cv2.imencode(".png", atlas_rgb[:, :, ::-1])
    if not ok:
        raise ValueError("Cannot encode atlas")
    image = add(png.tobytes())
    document = {"asset": {"version": "2.0"}, "extensionsUsed": ["KHR_materials_unlit"],
                "buffers": [{"byteLength": sum(len(b) for b in buffers)}],
                "bufferViews": views, "accessors": accessors,
                "images": [{"bufferView": image, "mimeType": "image/png"}],
                "samplers": [{"magFilter": 9728, "minFilter": 9728,
                              "wrapS": 33071, "wrapT": 33071}],
                "textures": [{"source": 0, "sampler": 0}],
                "materials": [{"doubleSided": True, "extensions": {"KHR_materials_unlit": {}},
                               "pbrMetallicRoughness": {"baseColorTexture": {"index": 0},
                                                        "metallicFactor": 0}}],
                "meshes": [{"primitives": [{"attributes": {"POSITION": position,
                                                               "TEXCOORD_0": texcoord},
                                           "indices": indices, "material": 0}]}],
                "nodes": [{"mesh": 0}], "scenes": [{"nodes": [0]}], "scene": 0}
    encoded = json.dumps(document, allow_nan=False).encode()
    encoded += b" " * (-len(encoded) % 4)
    binary = b"".join(buffers)
    payload = (struct.pack("<III", 0x46546C67, 2, 28 + len(encoded) + len(binary))
               + struct.pack("<II", len(encoded), 0x4E4F534A) + encoded
               + struct.pack("<II", len(binary), 0x004E4942) + binary)
    atomic_write(Path(path_glb), payload)


def save_mesh(path, V, F, UV, atlas):
    buffer = io.BytesIO()
    np.savez_compressed(buffer, V=V, F=F, UV=UV, atlas=atlas)
    atomic_write(path, buffer.getvalue())
