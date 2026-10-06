"""topeye-sim-view: serve backend/data/sim plus the three.js map viewer on localhost."""

import argparse
import functools
import logging
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from topeye.sim.cli import scene_dir, sim_root

VIEWER = Path(__file__).parent / "viewer" / "index.html"
logger = logging.getLogger(__name__)


class SimHandler(SimpleHTTPRequestHandler):
    """`/` is the viewer page; every other path is resolved inside the sim root only."""

    def translate_path(self, path):
        if path.split("?", 1)[0] in ("/", "/index.html"):
            return str(VIEWER)
        return super().translate_path(path)

    def list_directory(self, path):
        self.send_error(404, "Directory listing disabled")

    def log_message(self, format, *args):
        logger.debug(format, *args)


def make_server(root, host="127.0.0.1", port=8770):
    handler = functools.partial(SimHandler, directory=str(Path(root).resolve()))
    return ThreadingHTTPServer((host, port), handler)


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
        server = make_server(root, port=args.port)
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
