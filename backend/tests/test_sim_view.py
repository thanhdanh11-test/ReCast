"""HTTP boundary and serialized render jobs for the local sim viewer."""
import json
import sys
import threading
import time
from types import SimpleNamespace
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import pytest

from topeye.sim import view


@pytest.fixture
def server(tmp_path):
    directory = tmp_path / 'scene-0061'
    directory.mkdir()
    (directory / 'layout.json').write_text(json.dumps({'actors': [], 'frames': []}))
    server = view.make_server(tmp_path, port=0)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield server
    server.shutdown()
    server.server_close()
    thread.join()


def request(server, path, body=None, raw=None, headers=None):
    data = raw if raw is not None else json.dumps(body).encode() if body is not None else None
    req = Request(f'http://127.0.0.1:{server.server_port}{path}', data=data,
                  headers={'Content-Type': 'application/json', **(headers or {})})
    try:
        response = urlopen(req, timeout=3)
    except HTTPError as exc:
        response = exc
    return response.status, json.loads(response.read())


@pytest.mark.parametrize('path', ['/api/scene/bad.name', '/api/scene/../secret',
                                  '/api/jobs/BAD', '/api/jobs/bad.name'])
def test_invalid_get_names(server, path):
    assert request(server, path)[0] == 400


@pytest.mark.parametrize('body', [None, [], {'scene': '../bad'}, {'scene': 3},
                                 {'scene': 'scene-0061', 'scenario': {'name': '../bad'}}])
def test_invalid_post(server, body):
    assert request(server, '/api/render', raw=json.dumps(body).encode())[0] == 400


def test_json_boundary(server):
    assert request(server, '/api/render', raw=b'{')[0] == 400
    assert request(server, '/api/render', raw=b'x', headers={'Content-Length': '1000001'})[0] == 400
    assert request(server, '/api/render', body={'scene': 'scene-0061'},
                   headers={'Origin': 'https://example.com'})[0] == 400
    assert request(server, '/api/render', raw=b'{"scene":NaN}')[0] == 400
    assert request(server, '/api/render', body={'scene': 'scene-0061'},
                   headers={'Host': 'attacker.example', 'Origin': 'http://attacker.example'})[0] == 400


def test_scene_metadata(server):
    directory = server.root / 'scene-0061'
    (directory / 'static_splat.ply').touch()
    run = directory / 'runs' / 'custom'
    run.mkdir(parents=True)
    (run / 'run.json').write_text('{"frames":[0],"cameras":["CAM_FRONT"]}')
    code, data = request(server, '/api/scene/scene-0061')
    assert code == 200
    assert data['layout']['actors'] == []
    assert data['files'] == ['static_splat.ply']
    assert data['runs'][0]['name'] == 'custom'
    assert request(server, '/api/scene/missing')[0] == 404
    assert request(server, '/api/jobs/unknown')[0] == 404


def test_traffic_calls_public_functions(server, monkeypatch):
    calls = []
    actors = [{'track': 'gen:0:0'}]
    def generate(layout, params):
        calls.append((layout, params))
        return actors
    def check(layout, generated):
        assert generated is actors
        return {'overlaps': 0}
    monkeypatch.setitem(sys.modules, 'topeye.sim.traffic',
                        SimpleNamespace(generate_traffic=generate, check_traffic=check))
    code, data = request(server, '/api/traffic', {'scene': 'scene-0061', 'params': {'seed': 7}})
    assert code == 200
    assert calls == [({'actors': [], 'frames': []}, {'seed': 7})]
    assert data == {'actors': actors, 'checks': {'overlaps': 0}}
    assert request(server, '/api/traffic', {'scene': 'scene-0061', 'params': []})[0] == 400


def test_render_command_and_single_job(server, monkeypatch):
    started = threading.Event()
    release = threading.Event()
    commands = []
    class Process:
        def __init__(self, command, stdout, stderr):
            commands.append(command)
            stdout.write(b'render test log\n')
            started.set()
        def wait(self, timeout):
            release.wait(2)
            return 0
    monkeypatch.setattr(view.subprocess, 'Popen', Process)
    body = {'scene': 'scene-0061', 'scenario': {'name': 'custom', 'frames': [0],
            'weather': {'preset': 'day'}, 'traffic': {'mode': 'replay'}}}
    code, data = request(server, '/api/render', body)
    assert code == 202
    assert started.wait(2)
    assert request(server, '/api/render', body)[0] == 409
    command = commands[0]
    assert command[0].endswith('/topeye-sim-render')
    assert command[1:3] == ['--scene', 'scene-0061']
    assert command[3] == '--scenario'
    assert command[4] == str(server.root / 'scene-0061/scenarios/custom.toml')
    assert command[5:] == ['--config', str(server.config_path)]
    release.set()
    deadline = time.monotonic() + 2
    while time.monotonic() < deadline:
        _, result = request(server, '/api/jobs/' + data['job'])
        if result['status'] == 'ok':
            break
        time.sleep(.01)
    assert result == {'status': 'ok', 'exit_code': 0, 'log_tail': 'render test log\n'}


def test_invalid_scenario_never_launches(server, monkeypatch):
    monkeypatch.setattr(view.subprocess, 'Popen', lambda *a, **k: pytest.fail('must not launch'))
    assert request(server, '/api/render', {'scene': 'scene-0061',
                   'scenario': {'name': 'valid', 'unknown': 1}})[0] == 400
    assert server.jobs == {}


def test_bind_and_symlink_boundary(server, tmp_path):
    with pytest.raises(ValueError):
        view.make_server(tmp_path, host='0.0.0.0', port=0)
    outside = tmp_path.parent / 'outside-view.json'
    outside.write_text('{"private":true}')
    (server.root / 'escape').symlink_to(outside)
    req = Request(f'http://127.0.0.1:{server.server_port}/escape')
    with pytest.raises(HTTPError) as error:
        urlopen(req)
    assert error.value.code == 404


@pytest.mark.parametrize('code', [1, 3])
def test_render_failures(server, monkeypatch, code):
    class Process:
        def __init__(self, *args, **kwargs):
            pass
        def wait(self, timeout):
            return code
    monkeypatch.setattr(view.subprocess, 'Popen', Process)
    body = {'scene': 'scene-0061', 'scenario': {'name': 'failed'}}
    _, data = request(server, '/api/render', body)
    deadline = time.monotonic() + 2
    while time.monotonic() < deadline:
        _, result = request(server, '/api/jobs/' + data['job'])
        if result['status'] == 'failed':
            break
        time.sleep(.01)
    assert result['status'] == 'failed'
    assert result['exit_code'] == code
