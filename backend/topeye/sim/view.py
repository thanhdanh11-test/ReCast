"""topeye-sim-view: serve backend/data/sim plus the three.js map viewer on localhost."""

import argparse
import functools
import json
import logging
import mimetypes
import re
import subprocess
import sys
import tempfile
import threading
import uuid
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlsplit

from topeye.sim.cli import check_scenario, scene_dir, sim_root

VIEWER = Path(__file__).parent / "viewer" / "index.html"
ASSETS_DIR = (Path(__file__).resolve().parents[2] / "assets").resolve()
mimetypes.add_type("model/gltf-binary", ".glb")
mimetypes.add_type("application/json", ".json")
logger = logging.getLogger(__name__)


class SimHandler(SimpleHTTPRequestHandler):
    """`/` is the viewer page; every other path is resolved inside the sim root only."""

    def translate_path(self, path):
        route = unquote(urlsplit(path).path)
        if route in ("/", "/index.html"):
            return str(VIEWER)
        assets_root = getattr(self.server, "assets_root", ASSETS_DIR)
        if route == "/assets/library_manifest.json":
            manifest = (assets_root / "library_manifest.json").resolve()
            if manifest.is_file() and manifest.is_relative_to(assets_root):
                return str(manifest)
            return str(self.server.root / ".missing")
        if route.startswith("/assets/library/"):
            filename = route.removeprefix("/assets/library/")
            if re.fullmatch(r"[a-zA-Z0-9_-]+\.glb", filename):
                target = (assets_root / "library" / filename).resolve()
                if target.is_file() and target.is_relative_to(assets_root / "library"):
                    return str(target)
            return str(self.server.root / ".missing")
        if route.startswith("/assets/"):
            return str(self.server.root / ".missing")
        resolved = Path(super().translate_path(path)).resolve()
        if not resolved.is_relative_to(self.server.root):
            return str(self.server.root / ".missing")
        return str(resolved)

    def reply(self, code, data):
        body = json.dumps(data, allow_nan=False).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        route = unquote(urlsplit(self.path).path)
        try:
            if route.startswith("/api/scene/"):
                name = route.removeprefix("/api/scene/")
                directory = scene_dir(self.server.root, name)
                layout = json.loads((directory / "layout.json").read_text())
                runs = []
                for path in sorted((directory / "runs").glob("*/run.json")):
                    if re.fullmatch(r"[a-z0-9_-]+", path.parent.name):
                        runs.append({"name": path.parent.name, **json.loads(path.read_text())})
                files = [name for name in ("static_splat.ply", "ground_photo.png")
                         if (directory / name).is_file()]
                self.reply(200, {"layout": layout, "runs": runs, "files": files})
            elif route.startswith("/api/jobs/"):
                job = route.removeprefix("/api/jobs/")
                valid_name(job)
                with self.server.job_lock:
                    info = self.server.jobs.get(job)
                    snapshot = dict(info) if info else None
                self.reply(200 if snapshot else 404, snapshot or {"error": "Unknown job"})
            elif route.startswith("/api/"):
                self.reply(404, {"error": "Unknown endpoint"})
            else:
                super().do_GET()
        except ValueError as exc:
            self.reply(400, {"error": str(exc)})
        except FileNotFoundError:
            self.reply(404, {"error": "Scene not found"})

    def do_POST(self):
        try:
            # Local browser mutations cannot be triggered by another website.
            host = self.headers.get("Host")
            if host not in (f"127.0.0.1:{self.server.server_port}",
                            f"localhost:{self.server.server_port}"):
                raise ValueError("Invalid host")
            origin = self.headers.get("Origin")
            if origin and origin != f"http://{self.headers.get('Host')}":
                raise ValueError("Invalid origin")
            if self.headers.get("Content-Type", "").split(";", 1)[0] != "application/json":
                raise ValueError("Expected application/json")
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= 1_000_000:
                raise ValueError("JSON body must be between 1 and 1000000 bytes")
            body = json.loads(self.rfile.read(length),
                              parse_constant=lambda _: (_ for _ in ()).throw(ValueError("Nonfinite JSON")))
            if not isinstance(body, dict) or not isinstance(body.get("scene"), str):
                raise TypeError("Expected scene and parameters")
            directory = scene_dir(self.server.root, body["scene"])
            layout = json.loads((directory / "layout.json").read_text())
            route = urlsplit(self.path).path
            if route == "/api/traffic":
                from topeye.sim.traffic import check_traffic, generate_traffic
                params = body.get("params")
                if not isinstance(params, dict):
                    raise ValueError("Expected params object")
                actors = generate_traffic(layout, params)
                self.reply(200, {"actors": actors, "checks": check_traffic(layout, actors)})
            elif route == "/api/render":
                scenario = body.get("scenario")
                if not isinstance(scenario, dict):
                    raise ValueError("Expected scenario object")
                valid_name(scenario.get("name"))
                text = scenario_toml(scenario)
                with tempfile.NamedTemporaryFile(mode="w", suffix=".toml") as temporary:
                    temporary.write(text)
                    temporary.flush()
                    check_scenario(temporary.name)
                with self.server.job_lock:
                    if any(job["status"] in ("queued", "running") for job in self.server.jobs.values()):
                        self.reply(409, {"error": "A render job is already active"})
                        return
                    target = (directory / "scenarios" / (scenario["name"] + ".toml")).resolve()
                    if not target.is_relative_to(self.server.root):
                        raise ValueError("Scenario path escapes sim root")
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_text(text)
                    job = uuid.uuid4().hex
                    self.server.jobs[job] = {"status": "queued", "exit_code": None, "log_tail": ""}
                    threading.Thread(target=render_job, args=(self.server, job, body["scene"], target),
                                     daemon=True).start()
                self.reply(202, {"job": job})
            else:
                self.reply(404, {"error": "Unknown endpoint"})
        except (ValueError, TypeError) as exc:
            self.reply(400, {"error": str(exc)})
        except FileNotFoundError:
            self.reply(404, {"error": "Scene not found"})
        except ImportError:
            self.reply(503, {"error": "Traffic module unavailable"})

    def list_directory(self, path):
        self.send_error(404, "Directory listing disabled")

    def log_message(self, format, *args):
        logger.debug(format, *args)


def valid_name(name):
    if not isinstance(name, str) or not re.fullmatch(r"[a-z0-9_-]+", name):
        raise ValueError("Name must match [a-z0-9_-]+")


def scenario_toml(data):
    def value(item):
        if isinstance(item, bool):
            return str(item).lower()
        if isinstance(item, (str, int, float, list)):
            return json.dumps(item, allow_nan=False)
        raise ValueError("Unsupported scenario value")

    lines = []
    for key, item in data.items():
        if not re.fullmatch(r"[a-z_]+", key):
            raise ValueError("Invalid scenario key")
        if not isinstance(item, dict):
            lines.append(f"{key} = {value(item)}")
    for section, table in data.items():
        if isinstance(table, dict):
            lines.append(f"[{section}]")
            for key, item in table.items():
                if not re.fullmatch(r"[a-z_]+", key):
                    raise ValueError("Invalid scenario key")
                lines.append(f"{key} = {value(item)}")
    return "\n".join(lines) + "\n"


def render_job(server, job, scene, scenario):
    def update(**fields):
        with server.job_lock:
            server.jobs[job].update(fields)

    update(status="running")
    command = [str(Path(sys.executable).parent / "topeye-sim-render"),
               "--scene", scene, "--scenario", str(scenario), "--config", str(server.config_path)]
    try:
        with tempfile.TemporaryFile(mode="a+b") as log:
            process = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT)
            while True:
                try:
                    code = process.wait(timeout=0.5)
                except subprocess.TimeoutExpired:
                    code = None
                log.flush()
                log.seek(0, 2)
                end = log.tell()
                log.seek(max(0, end - 8192))
                update(log_tail=log.read().decode("utf-8", errors="replace"))
                if code is not None:
                    break
        update(status="ok" if code == 0 else "failed", exit_code=code)
    except OSError as exc:
        update(status="failed", exit_code=3, log_tail=str(exc))


def make_server(root, host="127.0.0.1", port=8770, config_path="config.toml", assets_root=None):
    if host != "127.0.0.1":
        raise ValueError("Viewer must bind 127.0.0.1")
    root = Path(root).resolve()
    handler = functools.partial(SimHandler, directory=str(root))
    server = ThreadingHTTPServer((host, port), handler)
    server.root = root
    server.assets_root = Path(assets_root).resolve() if assets_root else ASSETS_DIR
    server.config_path = Path(config_path).resolve()
    server.job_lock = threading.Lock()
    server.jobs = {}
    return server


def main(argv=None):
    parser = argparse.ArgumentParser(description="View a sim layout in the browser")
    parser.add_argument("--scene", required=True)
    parser.add_argument("--port", type=int, default=8770)
    parser.add_argument("--no-browser", action="store_true")
    parser.add_argument("--config", default="config.toml")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    root = sim_root(args.config)
    try:
        if not (scene_dir(root, args.scene) / "layout.json").is_file():
            logger.error("Missing layout for %s; run topeye-sim-layout first", args.scene)
            return 2
    except ValueError as exc:
        logger.error("%s", exc)
        return 2
    try:
        server = make_server(root, port=args.port, config_path=args.config)
    except OSError as exc:
        logger.error("Cannot listen on port %d (%s); pass --port", args.port, exc)
        return 3
    url = f"http://127.0.0.1:{server.server_address[1]}/?scene={args.scene}"
    logger.info("Serving %s (Ctrl+C to stop)", url)
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0
