import numpy as np
import pytest

from topeye.core.geometry import project, quaternion_to_matrix, transform_matrix


def test_rotation_transform_and_projection():
    rotation = quaternion_to_matrix([np.sqrt(0.5), 0, 0, np.sqrt(0.5)])
    np.testing.assert_allclose(rotation @ [1, 0, 0], [0, 1, 0], atol=1e-15)
    np.testing.assert_allclose(rotation.T @ rotation, np.eye(3), atol=1e-15)
    transform = transform_matrix([1, 2, 3], [1, 0, 0, 0])
    uv, depth = project(np.array([[1, 2, 1, 100]]), np.diag([2, 2, 1]), transform)
    np.testing.assert_allclose(uv, [[1, 2]])
    np.testing.assert_allclose(depth, [4])
    assert uv.dtype == depth.dtype == np.float64


def test_projection_preserves_invisible_rows_and_empty_input():
    uv, depth = project([[0, 0, -1], [0, 0, 0], [1, 2, 2]], np.eye(3), np.eye(4))
    assert np.isnan(uv[:2]).all()
    np.testing.assert_allclose(uv[2], [0.5, 1])
    np.testing.assert_array_equal(depth, [-1, 0, 2])
    uv, depth = project(np.empty((0, 4)), np.eye(3), np.eye(4))
    assert uv.shape == (0, 2) and depth.shape == (0,)


@pytest.mark.parametrize("q", [[0, 0, 0, 0], [1, 2], [np.nan, 0, 0, 0]])
def test_invalid_quaternion(q):
    with pytest.raises(ValueError):
        quaternion_to_matrix(q)
