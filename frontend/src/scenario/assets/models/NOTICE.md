# Bundled traffic car models

“Generic passenger car pack” by **comrade1280**.

- Source: https://sketchfab.com/3d-models/generic-passenger-car-pack-20f9af9b8a404d5cb022ac6fe87f21f5
- License: **Creative Commons Attribution 4.0 International**, https://creativecommons.org/licenses/by/4.0/
- Inventory provenance: `backend/assets/library_manifest.json`, entries `car_sketchfab_sedan` / `car_sketchfab_suv`.
- Local derivatives were normalized and exported through Blender. The desktop renderer fits measured actor dimensions, replaces colors with neutral materials, batches geometry and derives a cheaper distant LOD. These modifications are not endorsed by the creator.
- They are generic sedan/SUV assets, not authentic VinFast models or measured nuScenes body reconstructions.

The files are copies of the exact GLBs used by `backend/scripts/render_tesla_fsd_preview.py`. GLB coordinates were verified from decoded POSITION vertices: +X forward (headlights positive X, rear lights negative X), +Y up, box centered at origin. The loader requires no axis rotation; it normalizes each axis by decoded bounds.

The `.base64` files are byte-identical encodings of the accompanying GLBs. Vite imports them as raw strings so every web build decodes them in memory without extra file/HTTP fetches. Original GLBs remain alongside them for reproducible header/mesh tests.
