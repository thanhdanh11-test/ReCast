import re
from pathlib import Path

from topeye.scenario.models import ScenarioError

TABLES = ('scene', 'sample', 'sample_data', 'calibrated_sensor', 'ego_pose',
          'sample_annotation', 'instance', 'category', 'sensor')

def resolve_dataset(path, version=None):
    path = Path(path).expanduser().resolve()
    if not path.is_dir():
        raise ScenarioError("DATASET_INVALID", "Không tìm thấy thư mục dữ liệu")
    from topeye.core.adapters.argoverse import log_directories
    if version == "av2-sensor" or (version is None and log_directories(path)):
        return path, "av2-sensor"
    
    def check_metadata(dir_path):
        if not dir_path.is_dir():
            return False
        for table in TABLES:
            table_file = dir_path / f"{table}.json"
            if not table_file.exists():
                return False
        return True

    # If it's a metadata folder
    if version is None and path.name in ['v1.0-mini', 'v1.0-trainval'] and check_metadata(path):
        return path.parent, path.name
    
    # If it's a root folder with versions
    supported_versions = ['v1.0-mini', 'v1.0-trainval']
    
    if version is not None:
        if version not in supported_versions:
            raise ScenarioError("DATASET_INVALID", f"Unsupported version: {version}")
        meta_dir = path / version
        if not check_metadata(meta_dir):
            missing = [f"{table}.json" for table in TABLES if not (meta_dir / f"{table}.json").exists()]
            if missing:
                raise ScenarioError("DATASET_INVALID", f"Missing tables in {version}: {missing[0]}")
            else:
                raise ScenarioError("DATASET_INVALID", f"Invalid metadata folder: {version}")
        return path, version

    found_versions = []
    for v in supported_versions:
        if (path / v).is_dir():
            found_versions.append(v)
            
    if len(found_versions) == 1:
        version = found_versions[0]
        meta_dir = path / version
        if not check_metadata(meta_dir):
            missing = [f"{table}.json" for table in TABLES if not (meta_dir / f"{table}.json").exists()]
            raise ScenarioError("DATASET_INVALID", f"Missing tables in {version}: {missing[0]}")
        return path, version
    elif len(found_versions) > 1:
        raise ScenarioError("DATASET_INVALID", f"Ambiguous root directory. Found versions: {', '.join(found_versions)}")
    else:
        # Check if the folder itself has tables but doesn't match version names
        if check_metadata(path):
            return path.parent, path.name
        else:
            missing = [f"{table}.json" for table in TABLES if not (path / f"{table}.json").exists()]
            if len(missing) < len(TABLES):
                raise ScenarioError("DATASET_INVALID", f"Missing tables: {missing[0]}")
            raise ScenarioError("DATASET_INVALID", "No supported dataset version found in directory.")

def inspect_dataset(path, load=None):
    root, version = resolve_dataset(path)
    from topeye.scenario.extract import list_scenes
    
    try:
        adapter = (load or create_adapter)(root, version)
        scenes = list_scenes(adapter)
        for scene in adapter.scenes():
            record = adapter._scenes[scene]
            for data in adapter._data[record["token"]]["LIDAR_TOP"]:
                file = adapter._path(data["filename"])
                if not file.is_file() or not file.stat().st_size:
                    raise ScenarioError("DATASET_INVALID", f"Thiếu file LiDAR: {file.name}")
                if version != "av2-sensor" and file.stat().st_size % 20:
                    raise ScenarioError("DATASET_INVALID", f"File LiDAR không hợp lệ: {file.name}")
            adapter.load_points(adapter.frames(scene)[0])
        regions, preview = dataset_details(adapter)
    except Exception as e:
        if isinstance(e, ScenarioError):
            raise
        raise ScenarioError("DATASET_INVALID", f"Failed to load dataset: {e!s}")
        
    if not scenes:
        raise ScenarioError("DATASET_INVALID", "Dataset không có cảnh nào")
        
    return {
        "root": str(root),
        "version": version,
        "scenes": scenes,
        "regions": regions,
        "previewPath": preview,
    }


def create_adapter(root, version):
    if version == "av2-sensor":
        from topeye.core.adapters.argoverse import ArgoverseAdapter
        return ArgoverseAdapter(root)
    from topeye.core.adapters.nuscenes import NuScenesAdapter
    return NuScenesAdapter(root, version)


def dataset_details(adapter):
    regions = set()
    preview = None
    for scene in adapter.scenes():
        info = adapter.scene_map(scene)
        if adapter.version == "av2-sensor":
            if info:
                city = re.search(r"____([A-Z]+)_city", info[1].name)
                if city:
                    regions.add(city.group(1))
                images = sorted((info[1].parent.parent / "sensors/cameras/ring_front_center").glob("*.jpg"))
                if images and preview is None:
                    preview = str(adapter._path(str(images[0])).relative_to(adapter.root))
        else:
            if info:
                regions.add(info[0])
            if preview is None:
                rows = adapter._data[adapter._scenes[scene]["token"]].get("CAM_FRONT", [])
                if rows and adapter._path(rows[0]["filename"]).is_file():
                    preview = rows[0]["filename"]
    return sorted(regions), preview
