"""Build the pinned headless esmini library for local Scenario Studio packaging."""

import hashlib
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / ".tools" / "esmini"
SOURCE_SHA = "dbf409d228087ef71e3077498aad181974a1adc222823e7ebcf9cd981b6ceaf8"
TOOLS.mkdir(parents=True, exist_ok=True)
archive = TOOLS / "source.zip"
if not archive.exists():
    subprocess.run(
        [
            "curl",
            "-fLsS",
            "--retry",
            "3",
            "-o",
            str(archive),
            "https://github.com/esmini/esmini/releases/download/v3.9.0/esmini-fullsrc.zip",
        ],
        check=True,
    )
if hashlib.sha256(archive.read_bytes()).hexdigest() != SOURCE_SHA:
    raise SystemExit("esmini source SHA256 mismatch; remove incomplete archive and retry")
source = TOOLS / "source"
if not (source / "esmini" / "CMakeLists.txt").exists():
    source.mkdir(exist_ok=True)
    with zipfile.ZipFile(archive) as z:
        if any(
            not (source / name).resolve().is_relative_to(source.resolve()) for name in z.namelist()
        ):
            raise SystemExit("Unsafe source archive path")
        z.extractall(source)
cmake = str(Path(sys.executable).parent / "cmake")
if not Path(cmake).exists():
    cmake = shutil.which("cmake")
if not cmake:
    raise SystemExit("Install the scenario-build Python extra first")
options = [
    "USE_OSG",
    "USE_OSI",
    "USE_SUMO",
    "USE_GTEST",
    "USE_IMPLOT",
    "USE_PROJ",
    "DOWNLOAD_EXTERNALS",
    "BUILD_EXAMPLES",
    "BUILD_REPLAYER",
    "BUILD_ODRPLOT",
]
subprocess.run(
    [
        cmake,
        "-S",
        str(source / "esmini"),
        "-B",
        str(TOOLS / "build"),
        "-DCMAKE_BUILD_TYPE=Release",
        "-DESMINI_BUILD_VERSION=3.9.0",
        *[f"-D{name}=OFF" for name in options],
    ],
    check=True,
)
subprocess.run([cmake, "--build", str(TOOLS / "build"), "--target", "esminiLib", "-j4"], check=True)
