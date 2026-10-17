# Scenario workspace — v0.37.0

## Open and navigate
`cd frontend && npm run web:local`; open `http://127.0.0.1:5180/`, sign in and select a dataset. The primary rail contains **Cảnh nguồn · Kịch bản · Cài đặt**. Dataset entry opens **Kịch bản**. Legacy `?unified-demo=1` resolves to the same workspace, with the same selected scene and settings.

Three starting actions share one source, draft, selected result, library and job controller:
- **Thử phản ứng**: intent → choose a feasible traffic vehicle → parameters → compare → export.
- **Tạo từ mẫu**: existing 20-template catalog, quick/full parameters and MapFit scene suggestions.
- **Nạp tệp .xosc**: strict ordinary OpenSCENARIO import. The advanced create dialog also accepts a real2sim directory through its separate parser.

**Có hướng dẫn / Chi tiết** changes presentation and retains current selection, parameters and result. Clicking the active mode is a no-op. Changing authoring method or source scene asks before discarding an unfinished parameter draft. The source picker and MapFit use the same selected scene. Changing a MapFit scene retains that template, invalidates previous results and runs preflight again.

## Ego and traffic
The red ego is selectable on the map; choosing ego opens template design around its recorded route. Yellow outlined actors support actual reaction candidates. Guided suggestions require ego in the follower list; detailed mode also permits other eligible traffic actors. Brake, accelerate, stopline and lane change use offered time windows and feasible parameters. Unsupported directions/durations are disabled; an invalid choice cannot silently become another lane direction.

The engine still simulates its existing supported follower relationships. Full two-way interaction between ego and every vehicle on its lane is a separate requirement and is not implemented by this consolidation. Lane change is not a guarantee of cutting into ego's lane.

## Source, jobs and failures
`ScenarioApp` owns dataset, source scene, preferences and source playback. `workspace/useScenarioSession.ts` owns independently recoverable map preflight, candidates, saved entries and group metadata. Source is reused when navigating; source 3D, measured LiDAR and map remain available in **Cảnh nguồn**.

The server queues read-only requests on its existing single-request bridge. Mutation BUSY gates remain. Candidate/map/library failures each show retry; a candidate error does not erase saved entries. Geometry errors block creation, not source viewing or the library. Current raw nuScenes scenes **0103** and **0655** fail strict map geometry; the original polygons remain unchanged. Do not loosen parsers to make them pass.

Creation, opening, edits, exports and deletion share one job controller. Cancellation invalidates late results and preserves packages already persisted. Only an explicit STALE_CONTEXT retries once after source reload; network/unknown failures do not replay mutations. Successful artifacts remain displayed when a subsequent library refresh fails.

## Baseline and pilot persistence
One frozen event produces two genuine immutable packages: baseline `react:false`, pilot `react:true`. Synchronized maps share one clock; variant/source and 3D views use the selected artifact. Templates/ordinary XOSC never invent a comparison partner.

`workspace/.scenario-groups.json` is a schema1 sidecar with group ID, scene, map hash, frozen event, baseline/pilot IDs and timestamp. It never changes package manifests or payload hashes. Server APIs:
- `scenarioGroups({scene}) → ScenarioGroup[]`
- `recordScenarioGroup({group}) → ScenarioGroup`

Both endpoints use existing authentication, request token and allowlist. The server validates package hashes, raw report, source event binding, map, scene, variant and parameters before atomic write. The reader and writer enforce 4 MiB; corrupt/oversized metadata is rejected without overwrite. A variant cannot belong to another group or be replaced after recording. Raw hashed `source.reactive_event` preserves the exact original actor ID; historical packages lacking this binding remain standalone.

Baseline is recorded before pilot starts. On pilot failure, show the persisted baseline ID and offer **Thử lại pilot đã thiếu**, reusing baseline. A partial group remains recoverable after reload. Missing/deleted partners are identified; filename similarity never pairs entries. Deleting one variant moves only that variant to `.trash`, clears any displayed pair involving it and retains the surviving package/group record.

## Advanced tools
One embedded **Thư viện** retains saved selection, template/XML edit, actual XOSC download, explicit deletion to trash, **Lịch sử** and per-run deletion. Immutable edits validate a new package before retiring the old one. The actor timeline seeks the same player. **Số liệu** loads ordinary scenario metrics; real2sim uses its stored report. **Chỉ số cảnh và phân tích phản ứng** exposes metric1/2, raw/grid/rare analysis, fill-from-cell, sensitivity and manual esmini check. Expensive analyses run only when requested.

Results describe actual ego collisions, finite reported distances and whether ego appears in the reacted list. Minimum gap is not final stopping gap; group validity alone does not prove safety. Missing data is shown as missing. Theme/language/display preferences come from the shared settings.

## Verification and limitations
Plan49 specifications, raw outputs, browser screenshots and independent security assessment: [Plan49](../planning/49_2026-10-16_scenario-unify/plan.md). Audit evidence is historical; implementation evidence is in `evidence/acceptance`, `browser`, `access`, `local-web` and `review`.

The static demo adapter remains source-only. No new framework/dependency, physics equation change, raw-data write, automatic legacy pairing, real AI generation or remote deployment is introduced. Owner visual acceptance is tracked separately from machine verification.
