import copy
import xml.etree.ElementTree as E

import pytest
from test_scenario_map_context import source_fixture

from topeye.scenario.export import node, scenario_xml
from topeye.scenario.map_context import build_map_context
from topeye.scenario.models import ScenarioError
from topeye.scenario.xosc_import import validate_xosc


def fixture_xml(context, moving=True, center=(0.3, 0.2, 0.1)):
    actors = []
    for i, name in enumerate(["ego", "car", "person"]):
        actors.append(
            {
                "id": name,
                "role": "ego" if i == 0 else "traffic",
                "category": "vehicle.car",
                "length_m": 4.5 if i < 2 else 0.5,
                "width_m": 1.8 if i < 2 else 0.5,
                "height_m": 1.6,
                "samples": [
                    {"t_s": t, "x_m": t if moving else 0, "y_m": i * 5, "z_m": 0, "yaw_rad": 0}
                    for t in [0, 1, 2]
                ],
            }
        )
    s = {"schema_version": 1, "actors": actors, "interval_s": [0, 2]}
    root = scenario_xml(s)
    root.find("RoadNetwork").clear()
    root.find(
        "Storyboard/StopTrigger/ConditionGroup/Condition/ByValueCondition/SimulationTimeCondition"
    ).set("value", "2")
    for i, obj in enumerate(root.find("Entities")):
        model = obj[0]
        if i == 2:
            box = copy.deepcopy(model.find("BoundingBox"))
            obj.remove(model)
            model = node(
                obj, "Pedestrian", name="person", model="", mass=70, pedestrianCategory="pedestrian"
            )
            node(model, "ParameterDeclarations")
            model.append(box)
            node(model, "Properties")
        box = model.find("BoundingBox/Center")
        for k, v in zip(("x", "y", "z"), center):
            box.set(k, str(v))
        for name, value in [
            ("topeye.map_id", context["map_id"]),
            ("topeye.profile", context["profile"]),
            ("topeye.role", "ego" if i == 0 else "traffic"),
        ]:
            node(model.find("Properties"), "Property", name=name, value=value)
    return E.tostring(root)


def test_positive_and_center():
    c = build_map_context(source_fixture())
    s = validate_xosc(fixture_xml(c), c)
    assert len(s["actors"]) == 3 and s["actors"][2]["category"] == "human.pedestrian"
    assert s["actors"][0]["samples"][0]["x_m"] == 0.3


@pytest.mark.parametrize(
    "mutation",
    [
        "dtd",
        "pi",
        "controller",
        "attribute",
        "nan",
        "gap",
        "map",
        "duplicate",
        "init",
        "speed",
        "time",
        "property",
    ],
)
def test_reject_bad_profile(mutation):
    c = build_map_context(source_fixture())
    xml = fixture_xml(c)
    if mutation == "dtd":
        xml = b'<!DOCTYPE OpenSCENARIO [<!ENTITY x SYSTEM "file:///etc/passwd">]>' + xml
    elif mutation == "pi":
        xml = b"<?bad test?>" + xml
    elif mutation == "controller":
        xml = xml.replace(b"<Properties>", b'<Controller name="bad"/><Properties>', 1)
    elif mutation == "attribute":
        xml = xml.replace(b"<WorldPosition ", b'<WorldPosition unknown="yes" ', 1)
    elif mutation == "nan":
        xml = xml.replace(b'x="0"', b'x="NaN"', 1)
    elif mutation == "gap":
        xml = xml.replace(b'time="1"', b'time="1.5"', 1)
    elif mutation == "map":
        xml = xml.replace(c["map_id"].encode(), b"sha256:" + b"0" * 64)
    elif mutation == "duplicate":
        xml = xml.replace(b'ScenarioObject name="car"', b'ScenarioObject name="ego"')
    elif mutation == "init":
        xml = xml.replace(b"<TeleportAction>", b"<TeleportAction/><TeleportAction>", 1)
    elif mutation == "speed":
        xml = xml.replace(b'x="1"', b'x="10000"')
    elif mutation == "time":
        xml = xml.replace(b'time="1"', b'time="0"')
    elif mutation == "property":
        xml = xml.replace(b"topeye.role", b"custom.bad", 1)
    with pytest.raises(ScenarioError):
        validate_xosc(xml, c)


def test_utf16_dtd_and_namespace_rejected():
    c = build_map_context(source_fixture())
    xml = (
        '<!DOCTYPE OpenSCENARIO [<!ENTITY x SYSTEM "file:///etc/passwd">]>'
        + fixture_xml(c).decode()
    )
    with pytest.raises(ScenarioError):
        validate_xosc(xml.encode("utf-16"), c)
    xml = fixture_xml(c).replace(b"<OpenSCENARIO>", b'<OpenSCENARIO xmlns="evil">')
    with pytest.raises(ScenarioError):
        validate_xosc(xml, c)


def test_32_stationary_actors_resource_limit():
    c = build_map_context(source_fixture())
    root = E.fromstring(fixture_xml(c, moving=False, center=(0, 0, 0)))
    entities = root.find("Entities")
    init = root.find("Storyboard/Init/Actions")
    act = root.find("Storyboard/Story/Act")
    base_group = copy.deepcopy(act.findall("ManeuverGroup")[1])
    for i in range(29):
        name = f"car{i}"
        entity = copy.deepcopy(entities[1])
        entity.set("name", name)
        entities.append(entity)
        private = copy.deepcopy(init[1])
        private.set("entityRef", name)
        init.append(private)
        group = copy.deepcopy(base_group)
        group.set("name", name)
        group.find("Actors/EntityRef").set("entityRef", name)
        act.insert(0, group)
    assert len(validate_xosc(E.tostring(root), c)["actors"]) == 32
    entities.append(copy.deepcopy(entities[1]))
    with pytest.raises(ScenarioError) as exc:
        validate_xosc(E.tostring(root), c)
    assert exc.value.code == "RESOURCE_LIMIT"


def rotated_offset_xml(context, offset, headings):
    root = E.fromstring(fixture_xml(context, moving=False, center=(offset, 0, 0)))
    for group in root.findall("Storyboard/Story/Act/ManeuverGroup"):
        for vertex, h in zip(group.findall(".//Vertex"), headings):
            vertex.find("Position/WorldPosition").set("h", str(h))
    for private in root.findall("Storyboard/Init/Actions/Private"):
        private.find(".//WorldPosition").set("h", str(headings[0]))
    return root


def test_center_rotation_speed_bypass_rejected():
    source = source_fixture()
    source["source"]["bounds_m"] = [-100, -100, 100, 100]
    source["environment"]["polygons"][0]["outer"] = [
        [-100, -100],
        [100, -100],
        [100, 100],
        [-100, 100],
    ]
    c = build_map_context(source)
    xml = E.tostring(rotated_offset_xml(c, 30, [0, 3.141592653589793, 6.283185307179586]))
    with pytest.raises(ScenarioError) as exc:
        validate_xosc(xml, c)
    assert exc.value.code == "DYNAMIC_LIMIT"


def test_center_rotation_arc_surface_escape_rejected():
    source = source_fixture()
    source["environment"]["polygons"][0]["outer"] = [[-30, -1.8], [30, -1.8], [30, 1.8], [-30, 1.8]]
    c = build_map_context(source)
    root = rotated_offset_xml(c, 2, [-0.7853981633974483, 0.7853981633974483, 2.356194490192345])
    for dim in root.findall(".//Dimensions"):
        dim.set("length", ".1")
        dim.set("width", ".1")
    for world in root.findall(".//WorldPosition"):
        world.set("y", "0")
    with pytest.raises(ScenarioError) as exc:
        validate_xosc(E.tostring(root), c)
    assert exc.value.code == "OUTSIDE_SURFACE"
