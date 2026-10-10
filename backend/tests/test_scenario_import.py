"""Read-only dataset import admission and adapter lifetime."""
from types import SimpleNamespace

import pytest

from topeye.scenario.dataset import inspect_dataset, resolve_dataset
from topeye.scenario.models import ScenarioError
from topeye.scenario.worker import Service

TABLES = ('scene', 'sample', 'sample_data', 'calibrated_sensor', 'ego_pose',
          'sample_annotation', 'instance', 'category', 'sensor')


def metadata(root, version='v1.0-mini'):
    directory = root / version
    directory.mkdir(parents=True)
    for name in TABLES:
        (directory / f'{name}.json').write_text('[]')
    return directory


@pytest.mark.parametrize('version', ['v1.0-mini', 'v1.0-trainval'])
def test_root_and_metadata_folder_resolve(tmp_path, version):
    folder = metadata(tmp_path, version)
    assert resolve_dataset(tmp_path) == (tmp_path, version)
    assert resolve_dataset(folder) == (tmp_path, version)


def test_ambiguous_root_requires_explicit_metadata_folder(tmp_path):
    metadata(tmp_path)
    train = metadata(tmp_path, 'v1.0-trainval')
    with pytest.raises(ScenarioError, match='v1.0-mini.*v1.0-trainval'):
        resolve_dataset(tmp_path)
    assert resolve_dataset(train) == (tmp_path, 'v1.0-trainval')
    assert resolve_dataset(tmp_path, 'v1.0-mini') == (tmp_path, 'v1.0-mini')


def test_missing_tables_actionable_and_empty_rejected(tmp_path):
    folder = metadata(tmp_path)
    with pytest.raises(ScenarioError, match='cảnh'):
        inspect_dataset(tmp_path)
    (folder / 'sample.json').unlink()
    with pytest.raises(ScenarioError, match='sample.json'):
        resolve_dataset(tmp_path)


def test_bad_json_and_unknown_format_are_dataset_errors(tmp_path):
    with pytest.raises(ScenarioError) as error:
        inspect_dataset(tmp_path)
    assert error.value.code == 'DATASET_INVALID'
    folder = metadata(tmp_path)
    (folder / 'scene.json').write_text('{')
    with pytest.raises(ScenarioError) as error:
        inspect_dataset(tmp_path)
    assert error.value.code == 'DATASET_INVALID'


def test_inspection_preserves_active_adapter_cache_and_files(tmp_path):
    service = Service()
    service.adapter = SimpleNamespace(root=tmp_path / 'previous')
    service.scenarios = {'kept': {'id': 'kept'}}
    adapter = service.adapter
    folder = metadata(tmp_path / 'candidate')
    before = {p.name:p.read_bytes() for p in folder.iterdir()}
    with pytest.raises(ScenarioError):
        service.call('inspect_dataset', {'dataset': str(folder), 'workspace': str(tmp_path / 'output')})
    assert service.adapter is adapter
    assert service.scenarios == {'kept': {'id': 'kept'}}
    assert not (tmp_path / 'output').exists()
    assert {p.name:p.read_bytes() for p in folder.iterdir()} == before


def test_switching_versions_invalidates_old_scenarios(tmp_path, monkeypatch):
    from topeye.scenario import worker
    metadata(tmp_path)
    metadata(tmp_path, 'v1.0-trainval')
    monkeypatch.setattr(worker, 'NuScenesAdapter', lambda root, version='v1.0-mini': SimpleNamespace(root=root, version=version))
    monkeypatch.setattr(worker, 'list_scenes', lambda adapter: [{'scene':adapter.version}])
    service=Service()
    params={'dataset':str(tmp_path),'workspace':str(tmp_path.parent / 'output')}
    assert service.call('list_scenes',params)==[{'scene':'v1.0-mini'}]
    service.scenarios['old']={}
    assert service.call('list_scenes',{**params,'dataset_version':'v1.0-trainval'})==[{'scene':'v1.0-trainval'}]
    assert service.scenarios=={}
