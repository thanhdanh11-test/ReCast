"""Tests for serving 3D library assets and manifest in sim viewer."""
import json
import threading
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import pytest

from topeye.sim import view


@pytest.fixture
def asset_server(tmp_path):
    sim_root = tmp_path / "sim"
    sim_root.mkdir()
    scene_dir = sim_root / "scene-0061"
    scene_dir.mkdir()
    (scene_dir / "layout.json").write_text(json.dumps({"actors": [], "frames": []}))

    assets_root = tmp_path / "assets"
    library_dir = assets_root / "library"
    library_dir.mkdir(parents=True)

    manifest_data = [{"asset_id": "test_car", "class": "car", "file": "library/test_car.blend"}]
    (assets_root / "library_manifest.json").write_text(json.dumps(manifest_data))
    (library_dir / "test_car.glb").write_bytes(b"glTF binary content")
    (library_dir / "secret.txt").write_text("secret")

    server = view.make_server(sim_root, port=0, assets_root=assets_root)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield server, assets_root
    server.shutdown()
    server.server_close()
    thread.join()


def test_serve_manifest(asset_server):
    server, _ = asset_server
    req = Request(f"http://127.0.0.1:{server.server_port}/assets/library_manifest.json")
    with urlopen(req, timeout=3) as res:
        assert res.status == 200
        assert "application/json" in res.headers.get("Content-Type", "")
        data = json.loads(res.read())
        assert data[0]["asset_id"] == "test_car"


def test_serve_glb(asset_server):
    server, _ = asset_server
    req = Request(f"http://127.0.0.1:{server.server_port}/assets/library/test_car.glb")
    with urlopen(req, timeout=3) as res:
        assert res.status == 200
        assert "model/gltf-binary" in res.headers.get("Content-Type", "")
        body = res.read()
        assert body == b"glTF binary content"


@pytest.mark.parametrize("path", [
    "/assets/library_manifest.json/extra",
    "/assets/library/nonexistent.glb",
    "/assets/library/secret.txt",
    "/assets/library/../library_manifest.json",
    "/assets/library/../../secret",
    "/assets/library/..%2fsecret",
    "/assets/secret",
    "/assets/",
    "/assets/library/",
    "/assets/library/test_car.blend",
    "/assets/library/sub/test_car.glb",
])
def test_path_traversal_and_invalid_asset_paths(asset_server, path):
    server, _ = asset_server
    req = Request(f"http://127.0.0.1:{server.server_port}{path}")
    with pytest.raises(HTTPError) as err:
        urlopen(req, timeout=3)
    assert err.value.code == 404
