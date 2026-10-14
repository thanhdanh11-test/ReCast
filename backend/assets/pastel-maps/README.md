# Approved offline pastel maps
20 presentation overlays: 10 nuScenes mini and 10 Argoverse 2 Sensor scenes. Gzip JSON schema1, each matched against a canonical source fingerprint before display. Actor models/poses and authoritative map geometry are not replaced.

Building footprints: © OpenStreetMap contributors, ODbL (https://www.openstreetmap.org/copyright). Singapore extract: BBBike; US tiles: OpenFreeMap / OpenMapTiles. Original roads and estimated terrain/structures: nuScenes / Argoverse 2 / LiDAR. Heights may be estimated; landscaping is decorative; building road clearance is cosmetic. See planning/42_2026-10-13_pastel-maps for provenance, raw caches and acceptance evidence in this workspace.

Repackage using backend/scripts/package_pastel_maps.py with the approved preview/public and evidence/cache/sources directories. Runtime needs only these packaged assets, no planning files or network. Missing/mismatched files fall back to the original renderer.
