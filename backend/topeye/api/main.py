"""Local-only viewer API; instantiate with an injected adapter for isolated tests."""

import json
import re
from functools import lru_cache
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse

from topeye.config import load_config
from topeye.core.adapters.nuscenes import NuScenesAdapter
from topeye.core.cache import CACHE_VERSION, read_meta


def create_app(adapter=None, cache_root=None, splat_root=None):
    app = FastAPI()

    @lru_cache
    def resources():
        config = load_config() if adapter is None or cache_root is None else None
        return (
            adapter or NuScenesAdapter(config.nusc_root),
            Path(cache_root or config.cache_root).resolve(),
        )

    def checked(*parts):
        if any(re.fullmatch(r"[A-Za-z0-9_\-]+", part) is None for part in parts):
            raise HTTPException(404, "Invalid identifier")

    def contained(path):
        root = resources()[1]
        path = path.resolve()
        if not path.is_relative_to(root):
            raise HTTPException(404, "Path outside cache")
        return path

    def scene_meta(scene):
        checked(scene)
        source, root = resources()
        if scene not in source.scenes():
            raise HTTPException(404, "Unknown scene")
        directory = contained(root / scene)
        contained(directory / "meta.json")
        meta = read_meta(directory)
        if meta is None:
            raise HTTPException(425, "Run topeye-prepare for this scene")
        return directory, meta

    def frame_root(scene, frame_id):
        checked(scene, frame_id)
        directory, meta = scene_meta(scene)
        if frame_id not in meta["frames"]:
            raise HTTPException(404, "Unknown frame")
        if any(f["frame_id"] == frame_id for f in meta.get("failures", [])):
            raise HTTPException(425, "Frame preparation failed; run topeye-prepare")
        return contained(directory / "frames" / frame_id)

    def file(path, media_type):
        path = contained(path)
        if not path.is_file():
            raise HTTPException(404, "No data")
        stat = path.stat()
        return FileResponse(
            path,
            media_type=media_type,
            headers={
                "Cache-Control": "max-age=3600",
                "ETag": f'"{CACHE_VERSION}-{stat.st_mtime_ns}"',
            },
        )

    @app.get("/api/scenes")
    def scenes():
        source, root = resources()
        return [
            {
                "scene": scene,
                "n_frames": len(source.frames(scene)),
                "cached": read_meta(contained(root / scene / "meta.json").parent) is not None,
            }
            for scene in source.scenes()
        ]

    @app.get("/api/scenes/{scene}/meta")
    def meta(scene: str):
        directory, value = scene_meta(scene)
        report = contained(directory / "calib_report.json")
        if not report.is_file():
            raise HTTPException(425, "Calibration report not ready")
        return {**value, "calib_report": json.loads(report.read_text())}

    @app.get("/api/scenes/{scene}/splat.ply")
    def splat(scene: str):
        checked(scene)
        source, cache = resources()
        if scene not in source.scenes():
            raise HTTPException(404, "Unknown scene")
        root = Path(splat_root).resolve() if splat_root else cache.parent / "splat"
        path = (root / scene / "scene.ply").resolve()
        if not path.is_relative_to(root) or not path.is_file():
            raise HTTPException(404, "No splat")
        return FileResponse(path, media_type="application/octet-stream",
                            headers={"Cache-Control": "max-age=3600",
                                     "ETag": f'"splat-{path.stat().st_mtime_ns}"'})

    @app.get("/api/scenes/{scene}/frames/{frame_id}/pose")
    def pose(scene: str, frame_id: str):
        frame_root(scene, frame_id)
        frame = next((f for f in resources()[0].frames(scene) if f.frame_id == frame_id), None)
        if frame is None:
            raise HTTPException(404, "Unknown frame")
        return {"T_world_lidar": frame.T_world_lidar.tolist()}

    @app.get("/api/scenes/{scene}/frames/{frame_id}/points")
    def points(scene: str, frame_id: str):
        return file(frame_root(scene, frame_id) / "points.bin", "application/octet-stream")

    @app.get("/api/scenes/{scene}/frames/{frame_id}/bev.png")
    def bev(scene: str, frame_id: str):
        return file(frame_root(scene, frame_id) / "bev.png", "image/png")

    @app.get("/api/scenes/{scene}/frames/{frame_id}/objects_dense.bin")
    def objects_dense_bin(scene: str, frame_id: str):
        return file(frame_root(scene, frame_id) / "objects_dense.bin", "application/octet-stream")

    @app.get("/api/scenes/{scene}/frames/{frame_id}/objects_dense.json")
    def objects_dense_json(scene: str, frame_id: str):
        return file(frame_root(scene, frame_id) / "objects_dense.json", "application/json")

    @app.get("/api/scenes/{scene}/frames/{frame_id}/box_atlas.png")
    def box_atlas_png(scene: str, frame_id: str):
        return file(frame_root(scene, frame_id) / "box_atlas.png", "image/png")

    @app.get("/api/scenes/{scene}/frames/{frame_id}/box_atlas.json")
    def box_atlas_json(scene: str, frame_id: str):
        return file(frame_root(scene, frame_id) / "box_atlas.json", "application/json")

    @app.get("/api/scenes/{scene}/frames/{frame_id}/pano.json")
    def pano_json(scene: str, frame_id: str):
        return file(frame_root(scene, frame_id) / "pano.json", "application/json")

    @app.get("/api/scenes/{scene}/frames/{frame_id}/pano_rgb.jpg")
    def pano_rgb(scene: str, frame_id: str):
        return file(frame_root(scene, frame_id) / "pano_rgb.jpg", "image/jpeg")

    @app.get("/api/scenes/{scene}/frames/{frame_id}/pano_alpha.png")
    def pano_alpha(scene: str, frame_id: str):
        return file(frame_root(scene, frame_id) / "pano_alpha.png", "image/png")

    @app.get("/api/scenes/{scene}/frames/{frame_id}/pano_depth.bin")
    def pano_depth(scene: str, frame_id: str):
        return file(frame_root(scene, frame_id) / "pano_depth.bin", "application/octet-stream")

    @app.get("/api/scenes/{scene}/frames/{frame_id}/cams/{cam}.jpg")
    def camera(scene: str, frame_id: str, cam: str):
        checked(cam)
        return file(frame_root(scene, frame_id) / "cams" / f"{cam}.jpg", "image/jpeg")

    @app.get("/api/scenes/{scene}/frames/{frame_id}/calib")
    def calib(scene: str, frame_id: str):
        frame_root(scene, frame_id)
        frame = next((f for f in resources()[0].frames(scene) if f.frame_id == frame_id), None)
        if frame is None:
            raise HTTPException(404, "Unknown frame")
        return {
            name: {
                "K": c.K.tolist(),
                "T_lidar_cam": c.T_lidar_cam.tolist(),
                "width": c.width,
                "height": c.height,
            }
            for name, (_, _, c, _) in frame.cameras.items()
        }

    @app.get("/api/scenes/{scene}/frames/{frame_id}/boxes")
    def boxes(scene: str, frame_id: str, source: str = Query("gt")):
        target = frame_root(scene, frame_id)
        if source != "gt":
            raise HTTPException(404, "Only GT is available in P02")
        path = contained(target / "gt.json")
        if not path.is_file():
            return []
        result = []
        for box in json.loads(path.read_text()):
            annotation_token = box.pop("annotation_token")
            instance_token = box.pop("instance_token")
            result.append({
                **box,
                "id": f"gt:{annotation_token}",
                "source": "gt",
                "track_key": instance_token,
                "score": None,
                "version": None,
                "attributes": {},
            })
        return result

    return app


app = create_app()

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=8800)
