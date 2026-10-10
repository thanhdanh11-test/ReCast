"""Generate a deterministic local trajectory-profile fixture for desktop acceptance."""

import json
import sys
from pathlib import Path

from topeye.scenario.xosc_import import sample_xosc

if __name__ == "__main__":
    context = json.loads(Path(sys.argv[1]).read_text())
    Path(sys.argv[2]).write_bytes(sample_xosc(context, moving=True))
    print("Generated map-bound ego/vehicle/pedestrian fixture")
