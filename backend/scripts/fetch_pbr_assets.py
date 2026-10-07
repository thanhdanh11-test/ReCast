#!/usr/bin/env python3
"""Fetch CC0 PBR textures and HDRIs from Poly Haven and ambientCG.

Downloads 1k PBR materials, HDRIs, and vegetation textures for procedural
environment synthesis (SPEC-S11 §3). Validates SHA256 checksums and generates
backend/assets/pbr_manifest.json conforming to the S11 contract.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import urllib.request
import zipfile
from pathlib import Path

# Catalog of CC0 assets with exact file URLs and SHA-256 hashes
ASSET_CATALOG = [
    {
        "asset_id": "polyhaven_asphalt_01",
        "kind": "material",
        "role": "asphalt",
        "resolution": "1k",
        "source_url": "https://polyhaven.com/a/asphalt_01",
        "license": "CC0",
        "author": "Dario Barresi, Charlotte Baglioni",
        "files": {
            "albedo": "materials/asphalt_01/asphalt_01_diff_1k.jpg",
            "normal": "materials/asphalt_01/asphalt_01_nor_gl_1k.jpg",
            "roughness": "materials/asphalt_01/asphalt_01_rough_1k.jpg",
            "ao": "materials/asphalt_01/asphalt_01_ao_1k.jpg",
        },
        "downloads": {
            "materials/asphalt_01/asphalt_01_diff_1k.jpg": {
                "url": "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/asphalt_01/asphalt_01_diff_1k.jpg",
                "sha256": "99b6f6bdfbd09279f3f550ac9593336df541aa2319537566eeb3e737d8512010",
                "size": 739513,
            },
            "materials/asphalt_01/asphalt_01_nor_gl_1k.jpg": {
                "url": "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/asphalt_01/asphalt_01_nor_gl_1k.jpg",
                "sha256": "b745fd20cfb775ae907786ff0ffe200cedf73f3a6ef4e60c637b85b08e0a4f9a",
                "size": 1237059,
            },
            "materials/asphalt_01/asphalt_01_rough_1k.jpg": {
                "url": "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/asphalt_01/asphalt_01_rough_1k.jpg",
                "sha256": "147891957807bb03cc565c9daa8a16a4af7713449a0f475c638f78f833ad0646",
                "size": 344964,
            },
            "materials/asphalt_01/asphalt_01_ao_1k.jpg": {
                "url": "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/asphalt_01/asphalt_01_ao_1k.jpg",
                "sha256": "b151d385dd3c6cfe2f6a53caec2a3e7547ad48d59f84a52c1b7cd07b112d506c",
                "size": 1105060,
            },
        },
    },
    {
        "asset_id": "polyhaven_asphalt_02",
        "kind": "material",
        "role": "asphalt",
        "resolution": "1k",
        "source_url": "https://polyhaven.com/a/asphalt_02",
        "license": "CC0",
        "author": "Dario Barresi, Charlotte Baglioni",
        "files": {
            "albedo": "materials/asphalt_02/asphalt_02_diff_1k.jpg",
            "normal": "materials/asphalt_02/asphalt_02_nor_gl_1k.jpg",
            "roughness": "materials/asphalt_02/asphalt_02_rough_1k.jpg",
            "ao": "materials/asphalt_02/asphalt_02_ao_1k.jpg",
        },
        "downloads": {
            "materials/asphalt_02/asphalt_02_diff_1k.jpg": {
                "url": "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/asphalt_02/asphalt_02_diff_1k.jpg",
                "sha256": "1aa5ce99f58a625c71d48cfc3e68b65ca85ccb00f39e045c0a928608a0ea25ed",
                "size": 731707,
            },
            "materials/asphalt_02/asphalt_02_nor_gl_1k.jpg": {
                "url": "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/asphalt_02/asphalt_02_nor_gl_1k.jpg",
                "sha256": "42a1c381b53204e83a982db2864479a30bc127bbdeebb1006f8ee51bff099df3",
                "size": 1240122,
            },
            "materials/asphalt_02/asphalt_02_rough_1k.jpg": {
                "url": "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/asphalt_02/asphalt_02_rough_1k.jpg",
                "sha256": "70ba3edc65525eb4dc366cf010ca7ae0bd34e0251ff0225c2dad627a873d0712",
                "size": 544032,
            },
            "materials/asphalt_02/asphalt_02_ao_1k.jpg": {
                "url": "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/asphalt_02/asphalt_02_ao_1k.jpg",
                "sha256": "c7397b4187c53203592c68d1d52ce92cc42981c2154b15b9a685f2b5205a260d",
                "size": 533336,
            },
        },
    },
    {
        "asset_id": "polyhaven_brick_pavement_02",
        "kind": "material",
        "role": "sidewalk",
        "resolution": "1k",
        "source_url": "https://polyhaven.com/a/brick_pavement_02",
        "license": "CC0",
        "author": "Rob Tuytel",
        "files": {
            "albedo": "materials/brick_pavement_02/brick_pavement_02_diff_1k.jpg",
            "normal": "materials/brick_pavement_02/brick_pavement_02_nor_gl_1k.jpg",
            "roughness": "materials/brick_pavement_02/brick_pavement_02_rough_1k.jpg",
            "ao": "materials/brick_pavement_02/brick_pavement_02_ao_1k.jpg",
        },
        "downloads": {
            "materials/brick_pavement_02/brick_pavement_02_diff_1k.jpg": {
                "url": "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/brick_pavement_02/brick_pavement_02_diff_1k.jpg",
                "sha256": "fa1ce4c6da38bc75e488557420a03cb94e696c651075d36a7363cdc61c1b3944",
                "size": 961154,
            },
            "materials/brick_pavement_02/brick_pavement_02_nor_gl_1k.jpg": {
                "url": "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/brick_pavement_02/brick_pavement_02_nor_gl_1k.jpg",
                "sha256": "b254abe7a04223339c59bfe3ba0a3eea865b61de8b2561ed56620db2190675e1",
                "size": 1050532,
            },
            "materials/brick_pavement_02/brick_pavement_02_rough_1k.jpg": {
                "url": "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/brick_pavement_02/brick_pavement_02_rough_1k.jpg",
                "sha256": "c0e0446a2067317226b8296b425f2fb6a00390cb895918b8f5cbb14342d92dbf",
                "size": 466345,
            },
            "materials/brick_pavement_02/brick_pavement_02_ao_1k.jpg": {
                "url": "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/brick_pavement_02/brick_pavement_02_ao_1k.jpg",
                "sha256": "ba438059c830e0447ba3954dd8aaf7071ac9d57e853c4dc2ee3bd65667b5a2a4",
                "size": 704813,
            },
        },
    },
    {
        "asset_id": "polyhaven_brick_wall_02",
        "kind": "material",
        "role": "wall",
        "resolution": "1k",
        "source_url": "https://polyhaven.com/a/brick_wall_02",
        "license": "CC0",
        "author": "Rob Tuytel",
        "files": {
            "albedo": "materials/brick_wall_02/brick_wall_02_diff_1k.jpg",
            "normal": "materials/brick_wall_02/brick_wall_02_nor_gl_1k.jpg",
            "roughness": "materials/brick_wall_02/brick_wall_02_rough_1k.jpg",
            "ao": "materials/brick_wall_02/brick_wall_02_ao_1k.jpg",
        },
        "downloads": {
            "materials/brick_wall_02/brick_wall_02_diff_1k.jpg": {
                "url": "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/brick_wall_02/brick_wall_02_diff_1k.jpg",
                "sha256": "e80aad85ff49b70af5e554d28adf1009adca409fe5d89c2647595254f972df9c",
                "size": 1032279,
            },
            "materials/brick_wall_02/brick_wall_02_nor_gl_1k.jpg": {
                "url": "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/brick_wall_02/brick_wall_02_nor_gl_1k.jpg",
                "sha256": "ee1d7b11786a6c26245c02d6041aef0cda03431fc06a7509111575ce12bf422c",
                "size": 1121130,
            },
            "materials/brick_wall_02/brick_wall_02_rough_1k.jpg": {
                "url": "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/brick_wall_02/brick_wall_02_rough_1k.jpg",
                "sha256": "0567ea80ad98578f7160ed7880352b3b84d877afe8abbb538c1bb02586aa6e64",
                "size": 391526,
            },
            "materials/brick_wall_02/brick_wall_02_ao_1k.jpg": {
                "url": "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/brick_wall_02/brick_wall_02_ao_1k.jpg",
                "sha256": "341e32fee24346491e99cbb1ec2b4b2069acf57ef72ed678c9afcc5fad0636eb",
                "size": 843682,
            },
        },
    },
    {
        "asset_id": "polyhaven_concrete_wall_001",
        "kind": "material",
        "role": "wall",
        "resolution": "1k",
        "source_url": "https://polyhaven.com/a/concrete_wall_001",
        "license": "CC0",
        "author": "Dimitrios Savva, Jarod Guest",
        "files": {
            "albedo": "materials/concrete_wall_001/concrete_wall_001_diff_1k.jpg",
            "normal": "materials/concrete_wall_001/concrete_wall_001_nor_gl_1k.jpg",
            "roughness": "materials/concrete_wall_001/concrete_wall_001_rough_1k.jpg",
            "ao": "materials/concrete_wall_001/concrete_wall_001_ao_1k.jpg",
        },
        "downloads": {
            "materials/concrete_wall_001/concrete_wall_001_diff_1k.jpg": {
                "url": "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/concrete_wall_001/concrete_wall_001_diff_1k.jpg",
                "sha256": "c3c936da86d57997d9fc4022371c3798c8d438aeecb8f41546104da6d3947c02",
                "size": 79320,
            },
            "materials/concrete_wall_001/concrete_wall_001_nor_gl_1k.jpg": {
                "url": "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/concrete_wall_001/concrete_wall_001_nor_gl_1k.jpg",
                "sha256": "6f10711d123c8dff26375555196eae9e16d874c137acdacd44d1ba90168b6d46",
                "size": 179270,
            },
            "materials/concrete_wall_001/concrete_wall_001_rough_1k.jpg": {
                "url": "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/concrete_wall_001/concrete_wall_001_rough_1k.jpg",
                "sha256": "d0964c690a8de99fb4f6657e0d3474eea9f9f293d080f4e5c871a55857d9448b",
                "size": 156479,
            },
            "materials/concrete_wall_001/concrete_wall_001_ao_1k.jpg": {
                "url": "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/concrete_wall_001/concrete_wall_001_ao_1k.jpg",
                "sha256": "cdf662b0050a21681bd44a10c093618ca87c4e8017bc7d62c74d32c2b2a052cb",
                "size": 111623,
            },
        },
    },
    {
        "asset_id": "polyhaven_plaster_grey_04",
        "kind": "material",
        "role": "wall",
        "resolution": "1k",
        "source_url": "https://polyhaven.com/a/plaster_grey_04",
        "license": "CC0",
        "author": "Rob Tuytel",
        "files": {
            "albedo": "materials/plaster_grey_04/plaster_grey_04_diff_1k.jpg",
            "normal": "materials/plaster_grey_04/plaster_grey_04_nor_gl_1k.jpg",
            "roughness": "materials/plaster_grey_04/plaster_grey_04_rough_1k.jpg",
            "ao": "materials/plaster_grey_04/plaster_grey_04_ao_1k.jpg",
        },
        "downloads": {
            "materials/plaster_grey_04/plaster_grey_04_diff_1k.jpg": {
                "url": "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/plaster_grey_04/plaster_grey_04_diff_1k.jpg",
                "sha256": "e78df7d6e762fe767634278e14316564e0d4510031986239458994ec9fc5410d",
                "size": 456938,
            },
            "materials/plaster_grey_04/plaster_grey_04_nor_gl_1k.jpg": {
                "url": "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/plaster_grey_04/plaster_grey_04_nor_gl_1k.jpg",
                "sha256": "9d0eb5299f797c07eb841737eb7164755a2c8a2363540e175a76188a2aa5a2dc",
                "size": 983244,
            },
            "materials/plaster_grey_04/plaster_grey_04_rough_1k.jpg": {
                "url": "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/plaster_grey_04/plaster_grey_04_rough_1k.jpg",
                "sha256": "0d8cc6216ac3dc9dc4339cb17a08d249f7341961f432ae1451c35cdff222869b",
                "size": 370366,
            },
            "materials/plaster_grey_04/plaster_grey_04_ao_1k.jpg": {
                "url": "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/plaster_grey_04/plaster_grey_04_ao_1k.jpg",
                "sha256": "0a6900da34512ba91d91d19c0cc90f4775d21eaecf93a858bcb2e028e15e9d8b",
                "size": 435314,
            },
        },
    },
    {
        "asset_id": "polyhaven_bark_brown_01",
        "kind": "material",
        "role": "bark",
        "resolution": "1k",
        "source_url": "https://polyhaven.com/a/bark_brown_01",
        "license": "CC0",
        "author": "Rob Tuytel",
        "files": {
            "albedo": "materials/bark_brown_01/bark_brown_01_diff_1k.jpg",
            "normal": "materials/bark_brown_01/bark_brown_01_nor_gl_1k.jpg",
            "roughness": "materials/bark_brown_01/bark_brown_01_rough_1k.jpg",
            "ao": "materials/bark_brown_01/bark_brown_01_ao_1k.jpg",
        },
        "downloads": {
            "materials/bark_brown_01/bark_brown_01_diff_1k.jpg": {
                "url": "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/bark_brown_01/bark_brown_01_diff_1k.jpg",
                "sha256": "4213441aebcb72b9911f5a860e9ce74a61a8f6ce3b9c23d1f204173e7e7f6066",
                "size": 729893,
            },
            "materials/bark_brown_01/bark_brown_01_nor_gl_1k.jpg": {
                "url": "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/bark_brown_01/bark_brown_01_nor_gl_1k.jpg",
                "sha256": "9d1537b3429579436a62890bb7c5050a0172a15ce768787eacde81c5ccefc9cc",
                "size": 1226534,
            },
            "materials/bark_brown_01/bark_brown_01_rough_1k.jpg": {
                "url": "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/bark_brown_01/bark_brown_01_rough_1k.jpg",
                "sha256": "4e7f62508cf77faebfeee15ffb571ff02c45c18d5174aa19fcb8b98506359c5c",
                "size": 201307,
            },
            "materials/bark_brown_01/bark_brown_01_ao_1k.jpg": {
                "url": "https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/bark_brown_01/bark_brown_01_ao_1k.jpg",
                "sha256": "665069474c3a28d170bbdaf508a8e88c5bfa3fe3823716280038ad2d0c81a198",
                "size": 536964,
            },
        },
    },
    {
        "asset_id": "ambientcg_leaf_set_030",
        "kind": "material",
        "role": "leaf",
        "resolution": "1k",
        "source_url": "https://ambientcg.com/view?id=LeafSet030",
        "license": "CC0",
        "author": "Lennart Demes",
        "files": {
            "albedo": "textures/leaves/LeafSet030_1K-PNG_Color.png",
            "normal": "textures/leaves/LeafSet030_1K-PNG_NormalGL.png",
            "roughness": "textures/leaves/LeafSet030_1K-PNG_Roughness.png",
        },
        "zip_download": {
            "url": "https://ambientcg.com/get?file=LeafSet030_1K-PNG.zip",
            "sha256": "bc129611a1fda1c3eb9268b90a987dedb60cb82b80ccdef755ffac25de4c939e",
            "extract_map": {
                "LeafSet030_1K-PNG_Color.png": "textures/leaves/LeafSet030_1K-PNG_Color.png",
                "LeafSet030_1K-PNG_NormalGL.png": "textures/leaves/LeafSet030_1K-PNG_NormalGL.png",
                "LeafSet030_1K-PNG_Roughness.png": "textures/leaves/LeafSet030_1K-PNG_Roughness.png",
            },
        },
    },
    {
        "asset_id": "polyhaven_abandoned_parking",
        "kind": "hdri",
        "role": "hdri_day",
        "resolution": "1k",
        "source_url": "https://polyhaven.com/a/abandoned_parking",
        "license": "CC0",
        "author": "Andreas Mischok",
        "files": {
            "hdri": "hdri/abandoned_parking_1k.hdr",
        },
        "downloads": {
            "hdri/abandoned_parking_1k.hdr": {
                "url": "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/abandoned_parking_1k.hdr",
                "sha256": "6318a3b1e8c219012d51c25c48aac0de40a41d6e082ac241c9a79a2ddc4b1069",
                "size": 1622097,
            },
        },
    },
    {
        "asset_id": "polyhaven_aarfontein_dusk",
        "kind": "hdri",
        "role": "hdri_dusk",
        "resolution": "1k",
        "source_url": "https://polyhaven.com/a/aarfontein_dusk",
        "license": "CC0",
        "author": "Greg Zaal",
        "files": {
            "hdri": "hdri/aarfontein_dusk_1k.hdr",
        },
        "downloads": {
            "hdri/aarfontein_dusk_1k.hdr": {
                "url": "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/aarfontein_dusk_1k.hdr",
                "sha256": "934313b7ab01271542d51c6ed501d43f2c7b6f342e5e84dc5fbfb7b017b5a519",
                "size": 1597055,
            },
        },
    },
    {
        "asset_id": "polyhaven_blaubeuren_night",
        "kind": "hdri",
        "role": "hdri_night",
        "resolution": "1k",
        "source_url": "https://polyhaven.com/a/blaubeuren_night",
        "license": "CC0",
        "author": "Andreas Mischok",
        "files": {
            "hdri": "hdri/blaubeuren_night_1k.hdr",
        },
        "downloads": {
            "hdri/blaubeuren_night_1k.hdr": {
                "url": "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/blaubeuren_night_1k.hdr",
                "sha256": "1df5631d19df9b1a1eb176b19a1faf6a307c5576f295a0384a51200870c2cb46",
                "size": 1820806,
            },
        },
    },
    {
        "asset_id": "polyhaven_overcast_soil",
        "kind": "hdri",
        "role": "hdri_overcast",
        "resolution": "1k",
        "source_url": "https://polyhaven.com/a/overcast_soil",
        "license": "CC0",
        "author": "Greg Zaal",
        "files": {
            "hdri": "hdri/overcast_soil_1k.hdr",
        },
        "downloads": {
            "hdri/overcast_soil_1k.hdr": {
                "url": "https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/overcast_soil_1k.hdr",
                "sha256": "8e1db1441e64b3b44c21ebcbbbafe607eb3c52c04508e4f3c21180f6f2cef619",
                "size": 1650749,
            },
        },
    },
]


def file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    return h.hexdigest()


def download_file(url: str, dest: Path, expected_sha: str | None = None) -> None:
    dest.parent.mkdir(parents=True, exist_ok=True)
    temp = dest.with_suffix(dest.suffix + ".tmp")
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (topeye/1.0)"})
    with urllib.request.urlopen(req) as resp, temp.open("wb") as out:
        while chunk := resp.read(65536):
            out.write(chunk)
    actual_sha = file_sha256(temp)
    if expected_sha and actual_sha != expected_sha:
        temp.unlink(missing_ok=True)
        raise ValueError(f"Checksum mismatch for {url}: expected {expected_sha}, got {actual_sha}")
    temp.replace(dest)


def fetch_all(pbr_root: Path, force: bool = False, verify_only: bool = False) -> None:
    pbr_root.mkdir(parents=True, exist_ok=True)
    total_files = 0
    downloaded_files = 0
    verified_files = 0

    for item in ASSET_CATALOG:
        # 1. Direct downloads
        downloads = item.get("downloads", {})
        for rel_path, meta in downloads.items():
            dest = pbr_root / rel_path
            expected_sha = meta["sha256"]
            total_files += 1
            if dest.exists() and not force:
                actual_sha = file_sha256(dest)
                if actual_sha == expected_sha:
                    verified_files += 1
                    continue
                print(f"[RETRY] {rel_path}: checksum mismatch on disk", flush=True)

            if verify_only:
                raise FileNotFoundError(f"Missing or invalid file during verify: {rel_path}")

            print(f"[FETCH] Downloading {meta['url']} -> {rel_path}...", flush=True)
            download_file(meta["url"], dest, expected_sha)
            downloaded_files += 1
            verified_files += 1

        # 2. Zip downloads (ambientCG)
        zip_meta = item.get("zip_download")
        if zip_meta:
            extract_map = zip_meta["extract_map"]
            needed = [p for p in extract_map.values() if not (pbr_root / p).exists() or force]
            total_files += len(extract_map)
            if not needed and not force:
                all_ok = True
                for p in extract_map.values():
                    dest = pbr_root / p
                    if not dest.exists():
                        all_ok = False
                        break
                if all_ok:
                    verified_files += len(extract_map)
                    continue

            if verify_only:
                raise FileNotFoundError(f"Missing files for zip asset {item['asset_id']}")

            zip_url = zip_meta["url"]
            zip_dest = pbr_root / ".tmp_download.zip"
            print(f"[FETCH-ZIP] Downloading {zip_url}...", flush=True)
            download_file(zip_url, zip_dest, zip_meta["sha256"])
            with zipfile.ZipFile(zip_dest, "r") as zf:
                for member_name, rel_dest in extract_map.items():
                    out_path = pbr_root / rel_dest
                    out_path.parent.mkdir(parents=True, exist_ok=True)
                    out_path.write_bytes(zf.read(member_name))
                    downloaded_files += 1
                    verified_files += 1
            zip_dest.unlink(missing_ok=True)

    print(
        f"[DONE] PBR Assets: verified={verified_files}/{total_files}, new_downloads={downloaded_files}",
        flush=True,
    )


def generate_manifest(manifest_path: Path, pbr_root: Path) -> list[dict]:
    manifest_entries = []
    for item in ASSET_CATALOG:
        entry = {
            "asset_id": item["asset_id"],
            "kind": item["kind"],
            "role": item["role"],
            "resolution": item["resolution"],
            "source_url": item["source_url"],
            "license": item["license"],
            "author": item["author"],
            "files": dict(item["files"]),
        }
        if "normal_convention" in item:
            entry["normal_convention"] = item["normal_convention"]

        # Validate that all files exist in pbr_root
        for rel_file in entry["files"].values():
            full_path = pbr_root / rel_file
            if not full_path.is_file():
                raise FileNotFoundError(f"Missing referenced asset file: {full_path}")

        manifest_entries.append(entry)

    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest_entries, indent=2) + "\n")
    print(f"[MANIFEST] Wrote {len(manifest_entries)} entries to {manifest_path}", flush=True)
    return manifest_entries


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch and verify CC0 PBR assets.")
    parser.add_argument("--force", action="store_true", help="Force redownload all assets")
    parser.add_argument("--verify-only", action="store_true", help="Verify without downloading")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "assets" / "pbr",
        help="Directory to save PBR assets",
    )
    parser.add_argument(
        "--manifest-path",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "assets" / "pbr_manifest.json",
        help="Path to pbr_manifest.json",
    )
    args = parser.parse_args()

    try:
        fetch_all(args.output_dir, force=args.force, verify_only=args.verify_only)
        generate_manifest(args.manifest_path, args.output_dir)
        return 0
    except Exception as exc:  # noqa: BLE001
        print(f"[ERROR] Failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
