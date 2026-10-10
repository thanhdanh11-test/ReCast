"""Local StreetGS 30k background export and TSDF quality experiment (S14)."""

import argparse
import json
from pathlib import Path
from time import perf_counter

import cv2
import numpy as np


def adjusted_pose(anchor, camera, delta):
    """DriveStudio uses front-camera world and a right-multiplied 6D pose delta."""
    delta = np.asarray(delta, dtype=float)
    if delta.shape != (9,) or not np.isfinite(delta).all():
        raise ValueError("Expected finite CamPose delta (9,)")
    a, b = (delta[3:] + [1, 0, 0, 0, 1, 0]).reshape(2, 3)
    if np.linalg.norm(a) < 1e-8:
        raise ValueError("Invalid camera rotation")
    a = a / np.linalg.norm(a)
    b = b - a * np.dot(a, b)
    if np.linalg.norm(b) < 1e-8:
        raise ValueError("Invalid camera rotation")
    b = b / np.linalg.norm(b)
    transform = np.eye(4)
    transform[:3, :3] = np.stack([a, b, np.cross(a, b)])
    transform[:3, 3] = delta[:3]
    result = np.linalg.inv(anchor) @ camera @ transform
    if not np.isfinite(result).all():
        raise ValueError("Invalid camera rotation")
    return result


def valid_depth(weighted_z, alpha):
    """Recover expected axial depth, reject transparent/invalid/far pixels."""
    depth = weighted_z / np.maximum(alpha, 1e-8)
    valid = np.isfinite(depth) & np.isfinite(alpha) & (alpha >= .8)
    valid &= (depth > .5) & (depth < 60)
    return np.where(valid, depth, 0).astype(np.float32)


def load_checkpoint(path):
    import torch

    # The user's own PyTorch 2.1 checkpoint contains NumPy training-step scalars.
    # Keep weights_only enabled and allow only the specific scalar types it needs.
    scalar = np._core.multiarray.scalar
    allowed = [(scalar, "numpy.core.multiarray.scalar"), np.dtype,
               type(np.dtype("float64")), type(np.dtype("int64"))]
    with torch.serialization.safe_globals(allowed):
        checkpoint = torch.load(path, map_location="cpu", weights_only=True)
    if int(checkpoint["step"]) != 30000:
        raise ValueError("Expected completed 30000-step checkpoint")
    return checkpoint


def export(args):
    import torch
    from gsplat import rasterization

    start = perf_counter()
    checkpoint = load_checkpoint(args.source / "out/topeye/s0061/checkpoint_final.pth")
    background = checkpoint["models"]["Background"]
    arrays = {k: v.numpy() for k, v in background.items()}
    if not all(np.isfinite(v).all() for v in arrays.values()):
        raise ValueError("Non-finite checkpoint")
    means = arrays["_means"]
    count = len(means)
    quats = arrays["_quats"]
    norms = np.linalg.norm(quats, axis=1, keepdims=True)
    if (norms < 1e-8).any():
        raise ValueError("Zero quaternion")
    quats = quats / norms
    rest = arrays["_features_rest"].transpose(0, 2, 1).reshape(count, -1)
    names = ["x", "y", "z", "nx", "ny", "nz", "f_dc_0", "f_dc_1", "f_dc_2"]
    names += [f"f_rest_{i}" for i in range(rest.shape[1])]
    names += ["opacity", "scale_0", "scale_1", "scale_2", "rot_0", "rot_1", "rot_2", "rot_3"]
    data = np.concatenate([means, np.zeros((count, 3)), arrays["_features_dc"], rest,
                           arrays["_opacities"], arrays["_scales"], quats], axis=1)
    args.out.mkdir(parents=True, exist_ok=True)
    ply = args.out / "background.ply"
    header = f"ply\nformat binary_little_endian 1.0\nelement vertex {count}\n"
    header += "".join(f"property float {name}\n" for name in names) + "end_header\n"
    temporary = ply.with_suffix(".tmp")
    with temporary.open("wb") as stream:
        stream.write(header.encode())
        stream.write(data.astype("<f4").tobytes())
    temporary.replace(ply)
    del data, rest
    print(json.dumps({"stage": "ply", "gaussians": count, "bytes": ply.stat().st_size}),
          flush=True)

    meta = args.source / "scene_meta"
    anchor = np.loadtxt(meta / "extrinsics/000_0.txt")
    deltas = checkpoint["models"]["CamPose"]["embeds.weight"].numpy()
    poses = sorted((meta / "extrinsics").glob("*_0.txt"))
    if not poses or len(deltas) != len(poses) * 6:
        raise ValueError("Incomplete camera metadata")
    width, height = 400, 225
    views = []
    device = "mps"
    tensors = {
        "means": torch.tensor(means, device=device),
        "quats": torch.tensor(quats, device=device),
        "scales": torch.tensor(np.exp(arrays["_scales"]), device=device),
        "opacities": torch.tensor(arrays["_opacities"].reshape(-1), device=device).sigmoid(),
    }
    sh = torch.tensor(np.concatenate([arrays["_features_dc"][:, None],
                                      arrays["_features_rest"]], axis=1), device=device)
    rgbd_dir = args.out / "rgbd"
    rgbd_dir.mkdir(exist_ok=True)
    indices = range(0, len(poses), args.stride)
    for frame in indices:
        for camera in range(6):
            identifier = f"{frame:03d}_{camera}"
            c2w = adjusted_pose(anchor, np.loadtxt(meta / f"extrinsics/{identifier}.txt"),
                               deltas[frame * 6 + camera])
            fx, fy, cx, cy = np.loadtxt(meta / f"intrinsics/{camera}.txt")[:4] / 4
            intrinsic = np.array([[fx, 0, cx], [0, fy, cy], [0, 0, 1]], np.float32)
            w2c = torch.tensor(np.linalg.inv(c2w), dtype=torch.float32, device=device)
            params = dict(**tensors, viewmats=w2c[None],
                          Ks=torch.tensor(intrinsic[None], device=device),
                          width=width, height=height, packed=False,
                          near_plane=.1, far_plane=120, render_mode="RGB")
            with torch.no_grad():
                rgb, alpha, _ = rasterization(**params, colors=sh, sh_degree=3)
                # Three-channel depth pass avoids the slow multi-channel MPS path.
                z = tensors["means"] @ w2c[2, :3] + w2c[2, 3]
                weighted, _, _ = rasterization(**params, colors=z[:, None].expand(-1, 3).contiguous())
                a = alpha[0, ..., 0].cpu().numpy()
                depth = valid_depth(weighted[0, ..., 0].cpu().numpy(), a)
                color = (rgb[0].clamp(0, 1).cpu().numpy() * 255).astype(np.uint8)
            np.savez_compressed(rgbd_dir / f"{identifier}.npz", rgb=color, depth=depth,
                                K=intrinsic, c2w=c2w, alpha=a)
            if frame == 0:
                cv2.imwrite(str(args.out / f"splat_{camera}.jpg"), color[..., ::-1])
            views.append({"id": identifier, "valid_pixels": int((depth > 0).sum())})
        print(json.dumps({"stage": "rgbd", "frame": frame, "views": len(views),
                          "elapsed_s": round(perf_counter() - start, 1)}), flush=True)
    if not any(v["valid_pixels"] for v in views):
        raise ValueError("All depth maps are empty")
    metrics = {"step": 30000, "gaussians": count, "ply_bytes": ply.stat().st_size,
               "views": views, "anchor": anchor.tolist(),
               "export_s": perf_counter() - start,
               "scope": "background only; excludes sky, actors and affine color correction"}
    (args.out / "export.json").write_text(json.dumps(metrics, indent=2) + "\n")
    (args.out / "index.html").write_text(
        Path(__file__).with_name("streetgs_viewer.html").read_text())


def lidar_depth(points, c2w, intrinsic, width, height):
    inverse = np.linalg.inv(c2w)
    xyz = points @ inverse[:3, :3].T + inverse[:3, 3]
    xyz = xyz[(xyz[:, 2] > .5) & (xyz[:, 2] < 60)]
    uvz = xyz @ intrinsic.T
    uv = np.floor(uvz[:, :2] / uvz[:, 2:]).astype(int)
    keep = (uv[:, 0] >= 0) & (uv[:, 0] < width) & (uv[:, 1] >= 0) & (uv[:, 1] < height)
    pixels = uv[keep, 1] * width + uv[keep, 0]
    depths = np.full(width * height, np.inf, np.float32)
    np.minimum.at(depths, pixels, xyz[keep, 2])
    return depths.reshape(height, width)


def tsdf_volume(voxel_size=.15, block_count=10000):
    import open3d as o3d

    # The legacy ScalableTSDFVolume in the installed macOS 0.20 wheel silently
    # yields zero voxels even for a synthetic plane. Tensor TSDF passes that test.
    return o3d.t.geometry.VoxelBlockGrid(
        attr_names=("tsdf", "weight", "color"),
        attr_dtypes=(o3d.core.float32, o3d.core.float32, o3d.core.float32),
        attr_channels=(1, 1, 3), voxel_size=voxel_size, block_resolution=16,
        block_count=block_count)


def integrate_depth(volume, rgb, depth, intrinsic, c2w):
    import open3d as o3d

    depth = np.where(np.isfinite(depth) & (depth > .5) & (depth < 60), depth, 0)
    depth = o3d.t.geometry.Image(o3d.core.Tensor(np.rint(depth * 1000).astype(np.uint16)))
    color = o3d.t.geometry.Image(o3d.core.Tensor(np.ascontiguousarray(rgb, dtype=np.uint8)))
    k = o3d.core.Tensor(np.asarray(intrinsic, np.float64))
    extrinsic = o3d.core.Tensor(np.linalg.inv(c2w).astype(np.float64))
    blocks = volume.compute_unique_block_coordinates(depth, k, extrinsic, 1000., 60., 3.)
    if len(blocks):
        volume.integrate(blocks, depth, color, k, k, extrinsic, 1000., 60., 3.)


def fuse(args):
    import open3d as o3d

    from topeye.sim.texture_mesh import export_textured, render_mesh, texture_mesh

    start = perf_counter()
    summary = json.loads((args.out / "export.json").read_text())
    layout = json.loads(args.layout.read_text())
    anchor = np.array(summary["anchor"])
    splat_to_topeye = anchor.copy()
    splat_to_topeye[:3, 3] -= np.array(layout["origin_global"])
    inverse = np.linalg.inv(splat_to_topeye)
    cloud = o3d.io.read_point_cloud(str(args.lidar))
    xyz = np.asarray(cloud.points)
    if not len(xyz) or not np.isfinite(xyz).all():
        raise ValueError("Missing/invalid static LiDAR")
    points = xyz @ inverse[:3, :3].T + inverse[:3, 3]
    volume = tsdf_volume()
    views, images, masks = [], [], []
    lidar_pixels = 0
    for entry in summary["views"]:
        with np.load(args.out / "rgbd" / f"{entry['id']}.npz") as frame:
            rgb, depth = frame["rgb"].copy(), frame["depth"].copy()
            intrinsic, c2w = frame["K"].copy(), frame["c2w"].copy()
        height, width = depth.shape
        measured = lidar_depth(points, c2w, intrinsic, width, height)
        supported = np.isfinite(measured)
        lidar_pixels += int(supported.sum())
        # LiDAR supplies sparse metric observations; never interpolate across holes.
        depth[supported] = measured[supported]
        integrate_depth(volume, rgb, depth, intrinsic, c2w)
        views.append({"id": entry["id"], "K": intrinsic, "c2w": c2w,
                      "height": height, "width": width, "split": "train"})
        images.append(rgb)
        masks.append(((depth > 0) * 255).astype(np.uint8))
    mesh = volume.extract_triangle_mesh(weight_threshold=1.).to_legacy()
    before = len(mesh.triangles)
    if not before:
        raise ValueError("TSDF produced an empty mesh")
    clusters, counts, _ = mesh.cluster_connected_triangles()
    mesh.remove_triangles_by_mask(np.asarray(counts)[np.asarray(clusters)] < 50)
    mesh.remove_unreferenced_vertices()
    mesh = mesh.simplify_quadric_decimation(150000)
    mesh.remove_degenerate_triangles()
    mesh.remove_unreferenced_vertices()
    mesh.compute_vertex_normals()
    vertices, faces = np.asarray(mesh.vertices), np.asarray(mesh.triangles)
    if not len(faces) or not np.isfinite(vertices).all():
        raise ValueError("Invalid mesh after simplification")
    o3d.io.write_triangle_mesh(str(args.out / "lowpoly.ply"), mesh)
    print(json.dumps({"stage": "mesh", "triangles_before": before,
                      "triangles": len(faces), "lidar_pixels": lidar_pixels}), flush=True)
    # Existing visibility-aware triangle atlas also records unseen triangles.
    textured = texture_mesh(vertices, faces, views, images, masks, atlas_px=4096)
    V, F, UV, atlas, stats = textured
    stats.pop("chosen_views", None)
    export_textured(args.out / "lowpoly.glb", V, F, UV, atlas)
    preview_metrics = []
    for view, image in zip(views[:6], images[:6]):
        render, coverage, _ = render_mesh(V, F, UV, atlas, view)
        cv2.imwrite(str(args.out / f"mesh_{view['id']}.jpg"), render[..., ::-1])
        compare = np.hstack([image, render])
        cv2.imwrite(str(args.out / f"compare_{view['id']}.jpg"), compare[..., ::-1])
        preview_metrics.append({"view": view["id"], "coverage": float(coverage.mean())})
    result = {"triangles_before": before, "triangles": len(F), "vertices": len(V),
              "lidar_pixels": lidar_pixels, "texture": stats, "previews": preview_metrics,
              "glb_bytes": (args.out / "lowpoly.glb").stat().st_size,
              "splat_to_topeye": splat_to_topeye.tolist(),
              "fuse_s": perf_counter() - start, "quality": "experimental; needs visual review"}
    (args.out / "mesh.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    exp = commands.add_parser("export")
    exp.add_argument("--source", type=Path, required=True)
    exp.add_argument("--out", type=Path, required=True)
    exp.add_argument("--stride", type=int, default=20)
    fusion = commands.add_parser("fuse")
    fusion.add_argument("--out", type=Path, required=True)
    fusion.add_argument("--layout", type=Path, required=True)
    fusion.add_argument("--lidar", type=Path, required=True)
    args = parser.parse_args()
    if args.command == "export":
        if args.stride <= 0:
            parser.error("stride must be positive")
        export(args)
    else:
        fuse(args)


if __name__ == "__main__":
    main()
