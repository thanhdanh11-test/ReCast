"""Fixed-budget Brush v0.3.0 POC, with a hard three-hour process deadline."""
import json
import os
import re
import resource
import signal
import subprocess
import sys
import time
from pathlib import Path

from splat_evaluate import evaluate
from splat_projection import measure


def main(scene):
    if re.fullmatch(r"[A-Za-z0-9_-]+", scene) is None:
        raise ValueError("Invalid scene")
    root = Path("data/splat") / scene
    evidence = Path("../planning/01_2026-10-03_topeye-web-mvp/evidence/p07/backend")
    evidence.mkdir(parents=True, exist_ok=True)
    proof = measure(scene)
    (evidence / "projection.txt").write_text(json.dumps(proof, indent=2))
    if not proof["pass"]:
        return 1
    output = root / "training"
    if output.exists():
        raise ValueError("Existing training run; POC never silently reruns a failed gate")
    output.mkdir()
    command = [str(Path(".tools/brush-app-aarch64-apple-darwin/brush_app").resolve()),
               str(root.resolve()), "--total-steps", "6000", "--max-splats", "1000000",
               "--sh-degree", "2", "--eval-every", "6000", "--export-every", "6000",
               "--eval-save-to-disk", "--export-path", str(output.resolve()),
               "--export-name", "scene.ply", "--seed", "42"]
    started = time.monotonic()
    status = "finished"
    with (evidence / "train.txt").open("w") as log:
        log.write(json.dumps({"command": command}) + "\n")
        log.flush()
        process = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT,
                                   start_new_session=True, env={**os.environ, "RUST_LOG": "info"})
        try:
            code = process.wait(timeout=10800)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGTERM)
            try:
                process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                os.killpg(process.pid, signal.SIGKILL)
                process.wait()
            code, status = 124, "stop_P07_0_b_over_3h"
    metrics = {"scene": scene, "command": command, "steps": 6000,
               "wall_seconds": time.monotonic() - started,
               "peak_rss_bytes": resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss,
               "exit_code": code, "status": status}
    (evidence / "train-metrics.txt").write_text(json.dumps(metrics, indent=2))
    print(json.dumps(metrics, indent=2))
    if code:
        return code
    artifact = output / "scene.ply"
    if not artifact.is_file():
        raise ValueError("Trainer did not export scene.ply")
    # SH degree 2 and 1M cap keep the binary PLY below 300 MB.
    if artifact.stat().st_size > 300_000_000:
        raise ValueError("Splat exceeds 300 MB: reduced artifact required before publication")
    artifact.replace(root / "scene.ply")
    return evaluate(scene)


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit("Usage: train_splat.sh <scene>")
    raise SystemExit(main(sys.argv[1]))
