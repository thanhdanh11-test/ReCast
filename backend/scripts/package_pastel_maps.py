"""Package approved preview presentation data for offline main-web display."""

import argparse
import gzip
import json
from pathlib import Path

from topeye.scenario.pastel import ASSETS, fingerprint


def main():
    parser = argparse.ArgumentParser(__doc__)
    parser.add_argument("--preview", type=Path, required=True)
    parser.add_argument("--sources", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=ASSETS)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((args.preview / "manifest.json").read_text())
    total = 0
    for row in manifest["scenes"]:
        bundle = json.loads((args.preview / "maps" / f"{row['id']}.json").read_text())
        source = json.loads((args.sources / f"{row['id']}.json").read_text())["source"]
        presentation = {
            **bundle["after"]["presentation"],
            "style": "pastel-v1",
            "lines": bundle["after"]["lines"],
            "landscape": bundle["landscape"],
            "attribution": "© OpenStreetMap contributors · ODbL · nuScenes / Argoverse 2 / LiDAR",
        }
        value = {
            "schema_version": 1,
            "fingerprint": fingerprint(source),
            "presentation": presentation,
        }
        data = gzip.compress(
            json.dumps(value, separators=(",", ":"), allow_nan=False).encode(), mtime=0
        )
        (args.output / f"{row['scene']}.json.gz").write_bytes(data)
        total += len(data)
    print(json.dumps({"scenes": len(manifest["scenes"]), "compressed_bytes": total}))


if __name__ == "__main__":
    main()
