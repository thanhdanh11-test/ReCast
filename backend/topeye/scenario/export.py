"""Self-contained OpenSCENARIO 1.0 / OpenDRIVE bundles."""

import shutil
import xml.etree.ElementTree as ET
from datetime import UTC, datetime
from pathlib import Path

import numpy as np
from lxml import etree

from topeye.scenario.models import guard_output, matrix, require, sha256, validate, write_json


def node(parent, tag, **attrs):
    return ET.SubElement(parent, tag, {k: str(v) for k, v in attrs.items()})


def position(parent, row):
    pos = node(parent, "Position")
    node(pos, "WorldPosition", x=row["x_m"], y=row["y_m"], z=row["z_m"], h=row["yaw_rad"], p=0, r=0)


def trigger(parent, tag, value):
    tr = node(parent, tag)
    group = node(tr, "ConditionGroup")
    condition = node(group, "Condition", name="time", delay=0, conditionEdge="none")
    by = node(condition, "ByValueCondition")
    node(by, "SimulationTimeCondition", value=value, rule="greaterThan")


def scenario_xml(scenario):
    validate(scenario)
    return trajectory_xml(scenario)


def trajectory_xml(scenario):
    """Timed-polyline storyboard for any actor count; callers own validation of `scenario`."""
    root = ET.Element("OpenSCENARIO")
    node(
        root,
        "FileHeader",
        revMajor=1,
        revMinor=0,
        date="2026-10-09T00:00:00",
        description="Recast N3-09B measured trajectory replay",
        author="Recast",
    )
    node(root, "ParameterDeclarations")
    node(root, "CatalogLocations")
    road = node(root, "RoadNetwork")
    node(road, "LogicFile", filepath="road.xodr")
    entities = node(root, "Entities")
    for actor in scenario["actors"]:
        obj = node(entities, "ScenarioObject", name=actor["id"])
        vehicle = node(
            obj, "Vehicle", name=actor["category"], vehicleCategory=actor["category"].split(".")[1]
        )
        node(vehicle, "ParameterDeclarations")
        box = node(vehicle, "BoundingBox")
        node(box, "Center", x=0, y=0, z=0)
        node(
            box,
            "Dimensions",
            width=actor["width_m"],
            length=actor["length_m"],
            height=actor["height_m"],
        )
        node(vehicle, "Performance", maxSpeed=70, maxAcceleration=20, maxDeceleration=20)
        axles = node(vehicle, "Axles")
        for name, x in [
            ("FrontAxle", actor["length_m"] * 0.3),
            ("RearAxle", 0),
        ]:
            node(
                axles,
                name,
                maxSteering=0.5,
                wheelDiameter=0.6,
                trackWidth=1.5,
                positionX=x,
                positionZ=0.3,
            )
        node(vehicle, "Properties")
    board = node(root, "Storyboard")
    actions = node(node(board, "Init"), "Actions")
    for actor in scenario["actors"]:
        private = node(actions, "Private", entityRef=actor["id"])
        position(node(node(private, "PrivateAction"), "TeleportAction"), actor["samples"][0])
    story = node(board, "Story", name="recorded")
    node(story, "ParameterDeclarations")
    act = node(story, "Act", name="replay")
    for actor in scenario["actors"]:
        group = node(act, "ManeuverGroup", name=actor["id"], maximumExecutionCount=1)
        actors = node(group, "Actors", selectTriggeringEntities="false")
        node(actors, "EntityRef", entityRef=actor["id"])
        maneuver = node(group, "Maneuver", name="trajectory")
        node(maneuver, "ParameterDeclarations")
        event = node(maneuver, "Event", name="follow", priority="overwrite")
        action = node(event, "Action", name="recorded_path")
        follow = node(
            node(node(action, "PrivateAction"), "RoutingAction"), "FollowTrajectoryAction"
        )
        trajectory = node(follow, "Trajectory", name=actor["id"], closed="false")
        node(trajectory, "ParameterDeclarations")
        poly = node(node(trajectory, "Shape"), "Polyline")
        for row in actor["samples"]:
            position(node(poly, "Vertex", time=row["t_s"]), row)
        node(
            node(follow, "TimeReference"),
            "Timing",
            domainAbsoluteRelative="absolute",
            scale=1,
            offset=0,
        )
        node(follow, "TrajectoryFollowingMode", followingMode="position")
        trigger(event, "StartTrigger", 0)
    trigger(act, "StartTrigger", 0)
    node(act, "StopTrigger")
    trigger(board, "StopTrigger", scenario["interval_s"][1] + 0.1)
    return root


def road_xml(scenario):
    heading = scenario["road"]["heading_rad"]
    points = np.concatenate([matrix(a)[:, 1:3] for a in scenario["actors"]])
    axis = np.array([np.cos(heading), np.sin(heading)])
    projected = points @ axis
    start, end = projected.min() - 30, projected.max() + 30
    root = ET.Element("OpenDRIVE")
    node(
        root,
        "header",
        revMajor=1,
        revMinor=4,
        name="Synthetic presentation corridor",
        version="1.0",
        date="2026-10-09",
        north=0,
        south=0,
        east=0,
        west=0,
    )
    road = node(root, "road", name="corridor", length=end - start, id=1, junction=-1)
    node(road, "link")
    geom = node(
        node(road, "planView"),
        "geometry",
        s=0,
        x=start * axis[0],
        y=start * axis[1],
        hdg=heading,
        length=end - start,
    )
    node(geom, "line")
    node(road, "elevationProfile")
    node(road, "lateralProfile")
    lanes = node(road, "lanes")
    section = node(lanes, "laneSection", s=0)
    for side, number in [("left", 1), ("center", 0), ("right", -1)]:
        lane = node(
            node(section, side),
            "lane",
            id=number,
            type="none" if number == 0 else "driving",
            level="false",
        )
        node(lane, "link")
        if number:
            node(lane, "width", sOffset=0, a=10, b=0, c=0, d=0)
        node(
            lane,
            "roadMark",
            sOffset=0,
            type="broken" if number == 0 else "solid",
            weight="standard",
            color="standard",
            width=0.12,
            laneChange="both",
        )
    return root


def validate_xml(path):
    parser = etree.XMLParser(resolve_entities=False, no_network=True)
    schema = etree.XMLSchema(
        etree.parse(str(Path(__file__).parent / "schemas/OpenSCENARIO.xsd"), parser)
    )
    schema.assertValid(etree.parse(str(path), parser))


def export_bundle(scenario, output):
    validate(scenario)
    output = guard_output(output, scenario["source"]["dataset_root"])
    require(not output.exists(), "Output bundle already exists")
    output.mkdir(parents=True)
    try:
        for name, tree in [
            ("scenario.xosc", scenario_xml(scenario)),
            ("road.xodr", road_xml(scenario)),
        ]:
            ET.indent(tree)
            ET.ElementTree(tree).write(output / name, encoding="utf-8", xml_declaration=True)
        validate_xml(output / "scenario.xosc")
        write_json(output / "reference.json", scenario)
        manifest = {
            "schema_version": 1,
            "scenario_id": scenario["id"],
            "created_at": datetime.now(UTC).isoformat(),
            "openscenario": "1.0",
            "road_kind": scenario["road"]["kind"],
            "files": {
                f: sha256(output / f) for f in ("scenario.xosc", "road.xodr", "reference.json")
            },
        }
        write_json(output / "manifest.json", manifest)
        return manifest
    except Exception:
        # Only this function's newly-created incomplete bundle is rolled back.
        shutil.rmtree(output)
        raise
