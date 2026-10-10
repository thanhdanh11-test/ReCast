from pathlib import Path

from topeye.scenario.models import ScenarioError

TABLES = ('scene', 'sample', 'sample_data', 'calibrated_sensor', 'ego_pose',
          'sample_annotation', 'instance', 'category', 'sensor')

def resolve_dataset(path, version=None):
    path = Path(path).expanduser().resolve()
    
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

def inspect_dataset(path):
    root, version = resolve_dataset(path)
    from topeye.core.adapters.nuscenes import NuScenesAdapter
    from topeye.scenario.extract import list_scenes
    
    try:
        adapter = NuScenesAdapter(root, version)
        scenes = list_scenes(adapter)
    except Exception as e:
        if isinstance(e, ScenarioError):
            raise
        raise ScenarioError("DATASET_INVALID", f"Failed to load dataset: {e!s}")
        
    if not scenes:
        raise ScenarioError("DATASET_INVALID", "Dataset không có cảnh nào")
        
    return {
        "root": str(root),
        "version": version,
        "scenes": scenes
    }
