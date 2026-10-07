"""Geometry contracts and opt-in scenario compatibility for S11."""

import ast
import json
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pytest

from topeye.sim.cli import BUILD_SCENE, InputError, check_scenario
from topeye.sim.procedural_layout import (
    building_footprints,
    classify_static,
    pole_instances,
    road_edges,
    vegetation_instances,
)

BOUNDS = {'xmin': -20, 'ymin': -20, 'xmax': 30, 'ymax': 30}


def geometry():
    y, z = np.meshgrid(np.arange(-5, 5, .2), np.arange(0, 9, .2))
    wall = np.column_stack((np.full(y.size, -10), y.ravel(), z.ravel()))
    rng = np.random.default_rng(22)
    tree = rng.normal(size=(1800, 3)) * [1.4, 1.4, 1.4] + [10, 0, 6]
    pole = np.column_stack((np.full(80, 20), np.full(80, 0), np.linspace(0, 8, 80)))
    return np.vstack((wall, tree, pole)), len(wall), len(tree)


def test_pca_classifies_vertical_plane_canopy_and_upright():
    points, walls, trees = geometry()
    labels = classify_static(points, np.arange(len(points), dtype=int) % 3)
    assert labels.shape == (len(points),)
    assert labels.dtype == np.uint8
    assert (labels[:walls] == 1).sum() > 300
    assert (labels[walls:walls + trees] == 2).sum() > 300
    assert (labels[-80:] == 3).sum() > 20
    assert not (labels[:walls][points[:walls, 2] < 1] == 1).any()


def test_horizontal_plane_is_not_a_building():
    x, y = np.meshgrid(np.arange(0, 8, .2), np.arange(0, 8, .2))
    points = np.column_stack((x.ravel(), y.ravel(), np.full(x.size, 5)))
    assert not classify_static(points, np.zeros(len(points), int)).any()


@pytest.mark.parametrize('points,sweeps', [([[1, 2]], [0]), ([[0, 0, np.nan]], [0]),
                                         ([[0, 0, 1]], []), ([[0, 0, 1]], [.5])])
def test_rejects_invalid_pca_inputs(points, sweeps):
    with pytest.raises(ValueError):
        classify_static(points, sweeps)


def test_empty_geometry():
    points = np.empty((0, 3))
    labels = classify_static(points, np.empty(0, int))
    assert labels.size == 0
    assert building_footprints(points, labels, BOUNDS) == []
    assert vegetation_instances(points, labels) == []
    assert pole_instances(points, labels) == []


def test_footprints_have_deterministic_estimated_height_and_bounds():
    points, wall_count, _ = geometry()
    labels = np.zeros(len(points), np.uint8)
    labels[:wall_count] = 1
    buildings = building_footprints(points, labels, BOUNDS)
    assert buildings
    assert buildings == building_footprints(points[::-1], labels[::-1], BOUNDS)
    for building in buildings:
        polygon = np.asarray(building['polygon'])
        assert len(polygon) >= 3
        assert (polygon >= [-20, -20]).all() and (polygon <= [30, 30]).all()
        assert building['height_source'] == 'estimated'
        extra = building['height'] - max(building['observed_top_z'] - building['base_z'], 3)
        assert any(abs(extra - floors * 3.2) < 1e-8 for floors in range(1, 5))
        json.dumps(building, allow_nan=False)


def test_measured_tree_and_pole_instances():
    points, wall_count, tree_count = geometry()
    labels = np.zeros(len(points), np.uint8)
    labels[wall_count:wall_count + tree_count] = 2
    labels[-80:] = 3
    trees = vegetation_instances(points, labels)
    poles = pole_instances(points, labels)
    assert trees and len(poles) == 1
    assert poles[0]['x'] == 20 and poles[0]['height'] >= 3
    assert all(3 <= t['height'] <= 20 and .8 <= t['crown_radius'] <= 3.5 for t in trees)
    json.dumps(trees + poles, allow_nan=False)


def test_road_edges_preserve_raster_y_direction():
    road = np.zeros((100, 100), np.uint8)
    road[10:30, 20:80] = 255
    edges = road_edges(road, [0, 0, 10, 10])
    assert len(edges) == 1
    xy = np.asarray(edges[0])
    assert edges[0][0] == edges[0][-1]
    assert xy[:, 0].min() == pytest.approx(2.05)
    assert xy[:, 1].max() == pytest.approx(8.95)
    assert xy[:, 1].min() == pytest.approx(7.05)


@pytest.mark.parametrize('bounds', [[0, 0, 0, 1], [0, 0, np.inf, 1]])
def test_invalid_bounds(bounds):
    with pytest.raises(ValueError):
        road_edges(np.ones((2, 2)), bounds)


@pytest.mark.parametrize('environment', ['procedural', 'voxel'])
def test_schema_two_opt_in(tmp_path, environment):
    scenario = tmp_path / 'scenario.toml'
    scenario.write_text(f'schema = 2\nname = "test"\nenvironment = "{environment}"\n')
    assert check_scenario(scenario)['environment'] == environment


@pytest.mark.parametrize('value', ['"unknown"', 'true', '2', '[]'])
def test_invalid_environment(tmp_path, value):
    scenario = tmp_path / 'scenario.toml'
    scenario.write_text(f'schema = 2\nname = "test"\nenvironment = {value}\n')
    with pytest.raises(InputError, match='environment'):
        check_scenario(scenario)


def test_environment_is_schema_two_only_and_default_is_preserved(tmp_path):
    scenario = tmp_path / 'scenario.toml'
    scenario.write_text('name = "legacy"\n')
    assert 'environment' not in check_scenario(scenario)
    scenario.write_text('name = "legacy"\nenvironment = "procedural"\n')
    with pytest.raises(InputError):
        check_scenario(scenario)


def test_pilot_scenarios_cover_full_day_and_single_weather_frames():
    directory = Path(__file__).parents[1] / 'topeye/sim/blender/scenarios'
    for preset in ('day', 'night', 'rain'):
        scenario = check_scenario(directory / f'{preset}_proc.toml')
        assert scenario['schema'] == 2 and scenario['environment'] == 'procedural'
        assert scenario['frames'] == ([] if preset == 'day' else [0])
        assert scenario['cameras'] == []


@pytest.fixture(scope="module")
def blender_contract():
    tree = ast.parse(BUILD_SCENE.read_text())
    tree.body = [n for n in tree.body if not (
        isinstance(n, ast.Import) and any(a.name == "bpy" for a in n.names)
        or isinstance(n, ast.ImportFrom) and n.module.startswith(("bpy", "mathutils"))
        or isinstance(n, ast.If))]
    namespace = {"__name__": "contract_test", "__file__": str(BUILD_SCENE)}
    exec(compile(tree, str(BUILD_SCENE), "exec"), namespace)  # noqa: S102 - trusted repo AST
    return SimpleNamespace(**namespace)


@pytest.mark.parametrize('preset', ['day', 'night', 'rain'])
def test_blender_accepts_procedural_and_preserves_default(blender_contract, preset):
    layout = {'frames': [{'index': i, 'cameras': {'CAM_FRONT': {}}} for i in range(39)]}
    directory = BUILD_SCENE.parent / 'scenarios'
    procedural = blender_contract.load_scenario(directory / f'{preset}_proc.toml', layout)
    legacy = blender_contract.load_scenario(directory / f'{preset}_v2.toml', layout)
    assert procedural['environment'] == 'procedural'
    assert legacy['environment'] == 'voxel'
    assert procedural['weather'] == legacy['weather']


@pytest.mark.parametrize('environment', ['"unknown"', 'true', '[]'])
def test_blender_rejects_invalid_environment(blender_contract, tmp_path, environment):
    path = tmp_path / 'scenario.toml'
    path.write_text(f'schema = 2\nname = "test"\nenvironment = {environment}\n')
    with pytest.raises(blender_contract.InputError):
        blender_contract.load_scenario(path, {'frames': [{'index': 0, 'cameras': {}}]})


@pytest.mark.parametrize('violation', ['license', 'path', 'missing'])
def test_pbr_manifest_trust_boundary(blender_contract, tmp_path, violation):
    root = tmp_path / 'backend'
    fake_script = root / 'topeye/sim/blender/build_scene.py'
    assets = root / 'assets'
    assets.mkdir(parents=True)
    (assets / 'pbr').mkdir()
    (assets / 'pbr/valid.png').write_bytes(b'placeholder')
    file = {'license': 'valid.png', 'path': '../secret.png', 'missing': 'absent.png'}[violation]
    manifest = [{'asset_id': 'wall', 'kind': 'material', 'role': 'wall',
                 'license': 'paid' if violation == 'license' else 'CC0',
                 'files': {'albedo': file}}]
    (assets / 'pbr_manifest.json').write_text(json.dumps(manifest))
    namespace = blender_contract.pbr_assets.__globals__
    original = namespace['__file__']
    namespace['__file__'] = str(fake_script)
    try:
        with pytest.raises(blender_contract.InputError, match='PBR'):
            blender_contract.pbr_assets()
    finally:
        namespace['__file__'] = original


def test_environment_bvh_uses_world_transforms_and_realized_faces(blender_contract):
    cleared = []

    class Translation:
        def __init__(self, offset):
            self.offset = np.asarray(offset)

        def __matmul__(self, vertex):
            return np.asarray(vertex) + self.offset

    def object_with_offset(offset):
        mesh = SimpleNamespace(vertices=[SimpleNamespace(co=np.array(p)) for p in
                                         [(0, 0, 0), (1, 0, 0), (0, 1, 0)]],
                               polygons=[SimpleNamespace(vertices=(0, 1, 2))])
        evaluated = SimpleNamespace(matrix_world=Translation(offset), to_mesh=lambda: mesh,
                                    to_mesh_clear=lambda: cleared.append(offset))
        return SimpleNamespace(evaluated_get=lambda graph: evaluated)

    namespace = blender_contract.environment_tree.__globals__
    previous = namespace.get('BVHTree')
    namespace['BVHTree'] = SimpleNamespace(FromPolygons=lambda vertices, faces:
                                          (np.asarray(vertices), faces))
    try:
        vertices, faces = blender_contract.environment_tree(
            [object_with_offset((10, 0, 3)), object_with_offset((0, 20, 4))], None)
        np.testing.assert_allclose(vertices[0], [10, 0, 3])
        np.testing.assert_allclose(vertices[3], [0, 20, 4])
        assert faces == [(0, 1, 2), (3, 4, 5)]
        assert len(cleared) == 2
        assert blender_contract.environment_tree([], None) is None
    finally:
        if previous is None:
            namespace.pop('BVHTree')
        else:
            namespace['BVHTree'] = previous
