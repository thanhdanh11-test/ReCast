"""Render a high-poly Tesla FSD visual style 3D preview in Blender.

Adheres strictly to LiDAR perception signals:
- Uncolored monochrome environment (like Ver 1 & Tesla FSD, zero fake textures/colors).
- Procedural extruded building footprints (0xe1e1df clay) from LiDAR wall detection.
- Procedural geometric trees (7-sided cylinder trunk 0xa6a6a3 + icosahedron crown 0xc6c6c3) from LiDAR canopy detection.
- Subtle concentric LiDAR ground scan rings and laser point returns.
- Prominent distance HUD badge (39.4 m) and navigation corridor.
"""

import math
import random
import sys
from pathlib import Path

import bpy


def setup_tesla_fsd_scene(output_path: str):
    # Reset scene
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene

    # Renderer: EEVEE with raytracing, soft contact shadows & fast GI
    scene.render.engine = "BLENDER_EEVEE"
    scene.eevee.use_raytracing = True
    scene.eevee.use_fast_gi = True
    scene.eevee.use_shadows = True
    scene.eevee.taa_render_samples = 64
    scene.render.resolution_x = 1920
    scene.render.resolution_y = 1080
    scene.render.resolution_percentage = 100
    scene.render.filepath = str(output_path)
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"

    # World / Fog: Clean light misty Tesla FSD horizon (Monochrome)
    world = bpy.data.worlds.new("TeslaWorld")
    scene.world = world
    world.use_nodes = True
    bg_node = world.node_tree.nodes.get("Background")
    if bg_node:
        bg_node.inputs["Color"].default_value = (0.87, 0.88, 0.90, 1.0)
        bg_node.inputs["Strength"].default_value = 1.0

    # PBR Materials Factory
    def make_mat(name, color, metallic=0.0, roughness=0.5, emission=None, emission_strength=1.0):
        mat = bpy.data.materials.new(name=name)
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        if bsdf:
            bsdf.inputs["Base Color"].default_value = color
            bsdf.inputs["Metallic"].default_value = metallic
            bsdf.inputs["Roughness"].default_value = roughness
            if emission:
                bsdf.inputs["Emission Color"].default_value = emission
                if "Emission Strength" in bsdf.inputs:
                    bsdf.inputs["Emission Strength"].default_value = emission_strength
        return mat

    # 1. Base Environment Materials (100% Uncolored Monochrome like Ver 1)
    mat_asphalt = make_mat("RoadAsphalt", (0.29, 0.30, 0.33, 1.0), metallic=0.0, roughness=0.85)
    mat_ground = make_mat("MistyGround", (0.86, 0.87, 0.89, 1.0), metallic=0.0, roughness=0.95)
    mat_sidewalk = make_mat("SidewalkConcrete", (0.78, 0.79, 0.81, 1.0), metallic=0.0, roughness=0.8)
    mat_lane_yellow = make_mat("LaneYellow", (0.98, 0.74, 0.04, 1.0), metallic=0.0, roughness=0.4, emission=(0.98, 0.74, 0.04, 1.0), emission_strength=1.4)
    mat_lane_white = make_mat("LaneWhite", (0.96, 0.96, 0.98, 1.0), metallic=0.0, roughness=0.4, emission=(0.96, 0.96, 0.98, 1.0), emission_strength=1.1)

    # 2. LiDAR Geometry Materials (Strictly Uncolored Clay matching sourceEnvironment.ts)
    # Building footprint extrusion: 0xe1e1df in sourceEnvironment.ts
    mat_lidar_bldg = make_mat("LiDAR_Building_Clay", (0.88, 0.88, 0.87, 1.0), metallic=0.0, roughness=0.9)
    # Tree trunk: 0xa6a6a3 in sourceEnvironment.ts
    mat_lidar_trunk = make_mat("LiDAR_Tree_Trunk", (0.65, 0.65, 0.64, 1.0), metallic=0.0, roughness=0.88)
    # Tree crown: 0xc6c6c3 in sourceEnvironment.ts
    mat_lidar_crown = make_mat("LiDAR_Tree_Crown", (0.78, 0.78, 0.76, 1.0), metallic=0.0, roughness=0.92)

    # LiDAR Sensor Signals: Concentric scan rings & point returns
    mat_lidar_ring = make_mat("LiDAR_Scan_Ring", (0.35, 0.65, 0.92, 1.0), emission=(0.35, 0.65, 0.92, 1.0), emission_strength=1.8)
    mat_lidar_point = make_mat("LiDAR_Laser_Point", (0.38, 0.72, 0.98, 1.0), emission=(0.38, 0.72, 0.98, 1.0), emission_strength=3.2)

    # 3. Navigation Path Ribbon & HUD
    mat_path_blue = make_mat(
        "FSD_Path_Blue",
        (0.01, 0.45, 0.96, 1.0),
        metallic=0.1,
        roughness=0.22,
        emission=(0.02, 0.54, 1.0, 1.0),
        emission_strength=2.8,
    )
    mat_path_tick = make_mat(
        "FSD_Path_Tick",
        (0.6, 0.85, 1.0, 1.0),
        metallic=0.1,
        roughness=0.2,
        emission=(0.7, 0.9, 1.0, 1.0),
        emission_strength=3.5,
    )

    # Distance HUD Badge Materials
    mat_hud_bg = make_mat("HUD_Badge_BG", (0.04, 0.06, 0.09, 0.94), metallic=0.2, roughness=0.1)
    mat_hud_border = make_mat("HUD_Badge_Border", (0.02, 0.68, 1.0, 1.0), emission=(0.02, 0.68, 1.0, 1.0), emission_strength=4.2)
    mat_hud_text = make_mat("HUD_Badge_Text", (1.0, 1.0, 1.0, 1.0), emission=(1.0, 1.0, 1.0, 1.0), emission_strength=4.5)

    # Car Materials
    mat_ego_blue = make_mat("EgoPaintBlue", (0.012, 0.22, 0.86, 1.0), metallic=0.85, roughness=0.18)
    mat_glass_dark = make_mat("DarkGlass", (0.02, 0.02, 0.025, 1.0), metallic=0.3, roughness=0.04)
    mat_tire = make_mat("TireRubber", (0.05, 0.05, 0.05, 1.0), metallic=0.0, roughness=0.8)
    mat_taillight_red = make_mat("TaillightRed", (0.98, 0.02, 0.02, 1.0), emission=(1.0, 0.02, 0.02, 1.0), emission_strength=5.0)
    mat_headlight_white = make_mat("HeadlightWhite", (0.92, 0.95, 1.0, 1.0), emission=(0.92, 0.95, 1.0, 1.0), emission_strength=2.0)

    # Surrounding Traffic Materials (Monochrome clay / matte silver)
    mat_traffic_silver = make_mat("TrafficSilver", (0.68, 0.70, 0.72, 1.0), metallic=0.15, roughness=0.4)
    mat_traffic_dark_charcoal = make_mat("TrafficDarkCharcoal", (0.20, 0.20, 0.22, 1.0), metallic=0.25, roughness=0.45)
    mat_traffic_white = make_mat("TrafficWhite", (0.85, 0.86, 0.88, 1.0), metallic=0.1, roughness=0.45)
    mat_traffic_glass = make_mat("TrafficGlass", (0.13, 0.14, 0.16, 1.0), metallic=0.2, roughness=0.08)

    # 4. Multi-lane Highway & Infrastructure
    lane_width = 3.65
    num_lanes = 4
    road_width = lane_width * num_lanes
    road_length = 260.0

    # Road Surface (Neutral Asphalt)
    bpy.ops.mesh.primitive_plane_add(size=1.0, location=(0, 85, 0))
    road = bpy.context.active_object
    road.scale = (road_width, road_length, 1.0)
    road.data.materials.append(mat_asphalt)

    # Distant Ground Canvas (Uncolored Mist)
    bpy.ops.mesh.primitive_plane_add(size=1.0, location=(0, 85, -0.02))
    ground = bpy.context.active_object
    ground.scale = (900, 900, 1.0)
    ground.data.materials.append(mat_ground)

    # Left & Right Sidewalks / Curbs (Uncolored Concrete)
    left_edge_x = -road_width / 2.0
    right_edge_x = road_width / 2.0

    for side, center_x in [(-1, left_edge_x - 1.25), (1, right_edge_x + 1.25)]:
        bpy.ops.mesh.primitive_cube_add(size=1.0, location=(center_x, 85, 0.08))
        sw = bpy.context.active_object
        sw.scale = (2.5, road_length, 0.16)
        sw.data.materials.append(mat_sidewalk)

    # Double Yellow Lines (left divider)
    yellow_div_x = left_edge_x + 1.0 * lane_width
    for offset_x in [-0.10, 0.10]:
        bpy.ops.mesh.primitive_plane_add(size=1.0, location=(yellow_div_x + offset_x, 85, 0.005))
        line = bpy.context.active_object
        line.scale = (0.11, road_length, 1.0)
        line.data.materials.append(mat_lane_yellow)

    # Dashed White Lines (dividing lanes 1, 2, 3)
    dash_len = 3.2
    dash_gap = 6.8
    period = dash_len + dash_gap
    num_dashes = int(road_length / period)

    for lane_idx in [2, 3]:
        div_x = left_edge_x + lane_idx * lane_width
        for d in range(num_dashes):
            y_pos = -25.0 + d * period
            bpy.ops.mesh.primitive_plane_add(size=1.0, location=(div_x, y_pos, 0.006))
            dash = bpy.context.active_object
            dash.scale = (0.13, dash_len, 1.0)
            dash.data.materials.append(mat_lane_white)

    # Solid White Line on outer right shoulder
    bpy.ops.mesh.primitive_plane_add(size=1.0, location=(right_edge_x - 0.25, 85, 0.005))
    r_line = bpy.context.active_object
    r_line.scale = (0.15, road_length, 1.0)
    r_line.data.materials.append(mat_lane_white)

    # 5. Ego Car Coordinates & Navigation Corridor
    ego_lane_x = left_edge_x + 1.5 * lane_width  # Lane 1
    ego_y = 0.0
    lead_y = 44.0
    car_len = 4.65
    clearance_m = round(lead_y - ego_y - car_len, 1)  # 39.4 m bumper-to-bumper

    path_start_y = 2.4
    path_end_y = lead_y - car_len / 2.0 - 0.3  # Touches lead car bumper
    path_len = path_end_y - path_start_y
    path_w = lane_width * 0.88

    # Blue ribbon
    bpy.ops.mesh.primitive_plane_add(size=1.0, location=(ego_lane_x, (path_start_y + path_end_y) / 2.0, 0.012))
    path_ribbon = bpy.context.active_object
    path_ribbon.name = "FSD_Navigation_Path"
    path_ribbon.scale = (path_w, path_len, 1.0)
    path_ribbon.data.materials.append(mat_path_blue)

    # Distance tick marks along the path
    for tick_dist in [10.0, 20.0, 30.0]:
        tick_y = path_start_y + tick_dist
        if tick_y < path_end_y:
            bpy.ops.mesh.primitive_plane_add(size=1.0, location=(ego_lane_x, tick_y, 0.014))
            tick = bpy.context.active_object
            tick.scale = (path_w * 0.92, 0.18, 1.0)
            tick.data.materials.append(mat_path_tick)

    # Distance HUD Badge (Floating right above the lead vehicle)
    hud_y = lead_y - 1.0
    hud_z = 2.85
    face_angle_rad = math.radians(91.2)  # Perpendicular to camera ray from (-8.6, 3.8) to (41.5, 2.85)

    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(ego_lane_x, hud_y, hud_z))
    badge_bg = bpy.context.active_object
    badge_bg.scale = (3.6, 0.08, 1.15)
    badge_bg.rotation_euler = (face_angle_rad, 0, 0)
    badge_bg.data.materials.append(mat_hud_bg)

    bpy.ops.mesh.primitive_cube_add(size=1.0, location=(ego_lane_x, hud_y - 0.01, hud_z))
    badge_border = bpy.context.active_object
    badge_border.scale = (3.72, 0.06, 1.25)
    badge_border.rotation_euler = (face_angle_rad, 0, 0)
    badge_border.data.materials.append(mat_hud_border)

    bpy.ops.object.text_add(location=(ego_lane_x, hud_y - 0.05, hud_z - 0.35))
    hud_text = bpy.context.active_object
    hud_text.data.body = f"{clearance_m} m"
    hud_text.data.size = 0.90
    hud_text.data.extrude = 0.05
    hud_text.data.align_x = "CENTER"
    hud_text.data.align_y = "CENTER"
    hud_text.rotation_euler = (face_angle_rad, 0, 0)
    hud_text.data.materials.append(mat_hud_text)

    # Road surface distance text indicator at mid-path (20m mark)
    bpy.ops.object.text_add(location=(ego_lane_x, path_start_y + 19.0, 0.015))
    road_text = bpy.context.active_object
    road_text.data.body = "20 m"
    road_text.data.size = 0.65
    road_text.data.extrude = 0.01
    road_text.data.align_x = "CENTER"
    road_text.data.align_y = "CENTER"
    road_text.rotation_euler = (0, 0, math.radians(-90))
    road_text.data.materials.append(mat_path_tick)

    # 6. LiDAR Sensor Rings (32-beam ground intersection circles from Ego LiDAR)
    for r in [6.0, 12.0, 20.0, 30.0, 42.0, 56.0, 72.0]:
        bpy.ops.curve.primitive_bezier_circle_add(radius=r, location=(ego_lane_x, ego_y, 0.016))
        ring = bpy.context.active_object
        ring.data.bevel_depth = 0.022
        ring.data.materials.append(mat_lidar_ring)

    # 7. LiDAR-Derived Buildings (Extruded Footprint Polygons, 100% Uncolored Clay 0xe1e1df)
    # Strictly non-fabricated: architectural volumes corresponding to LiDAR vertical planar returns
    building_footprints = [
        # Left side (x, y, width, length, height)
        (-18.5, 20.0, 12.0, 26.0, 14.0),
        (-18.5, 54.0, 12.0, 32.0, 18.0),
        (-18.5, 94.0, 12.0, 36.0, 22.0),
        # Right side
        (18.5, 24.0, 12.0, 28.0, 16.0),
        (18.5, 60.0, 12.0, 34.0, 20.0),
        (18.5, 100.0, 12.0, 36.0, 15.0),
    ]
    for i, (bx, by, bw, bl, bh) in enumerate(building_footprints):
        bpy.ops.mesh.primitive_cube_add(size=1.0, location=(bx, by, bh / 2.0))
        b_obj = bpy.context.active_object
        b_obj.name = f"LiDAR_Building_{i}"
        b_obj.scale = (bw, bl, bh)
        b_obj.data.materials.append(mat_lidar_bldg)

    # 8. LiDAR-Derived Trees (Procedural Cylinder Trunk + Icosahedron Crown, 100% Uncolored Clay)
    # Strictly adhering to Topeye's sourceEnvironment.ts geometry
    tree_instances = [
        # (x, y, z, height, crown_radius)
        (left_edge_x - 3.2, 18.0, 0.0, 6.2, 2.1),
        (left_edge_x - 3.2, 38.0, 0.0, 7.0, 2.4),
        (left_edge_x - 3.2, 62.0, 0.0, 6.6, 2.2),
        (left_edge_x - 3.2, 88.0, 0.0, 7.4, 2.5),
        (right_edge_x + 3.2, 16.0, 0.0, 6.0, 2.0),
        (right_edge_x + 3.2, 36.0, 0.0, 6.8, 2.3),
        (right_edge_x + 3.2, 58.0, 0.0, 6.4, 2.1),
        (right_edge_x + 3.2, 82.0, 0.0, 7.2, 2.4),
    ]
    for i, (tx, ty, tz, th, tr) in enumerate(tree_instances):
        # Trunk: 7-segment cylinder (matching CylinderGeometry(..., 7) in sourceEnvironment.ts)
        trunk_h = th * 0.65
        trunk_z = tz + trunk_h / 2.0
        bpy.ops.mesh.primitive_cylinder_add(vertices=7, radius=0.22, depth=trunk_h, location=(tx, ty, trunk_z))
        trunk = bpy.context.active_object
        trunk.name = f"LiDAR_Tree_Trunk_{i}"
        trunk.data.materials.append(mat_lidar_trunk)

        # Crown: Icosahedron (matching IcosahedronGeometry(1, 1) in sourceEnvironment.ts)
        crown_z = tz + th * 0.68
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=1.0, location=(tx, ty, crown_z))
        crown = bpy.context.active_object
        crown.name = f"LiDAR_Tree_Crown_{i}"
        crown.scale = (tr, tr, th * 0.34)
        crown.data.materials.append(mat_lidar_crown)

    # 9. LiDAR Laser Point Returns (Points reflecting on obstacles)
    rng = random.Random(42)
    for bx, by, bw, bl, bh in building_footprints[:4]:
        face_x = bx + (bw / 2.0 if bx < 0 else -bw / 2.0)
        for _ in range(12):
            py = by + rng.uniform(-bl * 0.4, bl * 0.4)
            pz = rng.uniform(1.0, min(bh * 0.7, 8.0))
            bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=0.07, location=(face_x, py, pz))
            pt = bpy.context.active_object
            pt.data.materials.append(mat_lidar_point)

    for tx, ty, tz, th, tr in tree_instances[:4]:
        crown_z = tz + th * 0.68
        for _ in range(8):
            dx = rng.uniform(-tr * 0.7, tr * 0.7)
            dy = rng.uniform(-tr * 0.7, tr * 0.7)
            dz = rng.uniform(-th * 0.15, th * 0.15)
            bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=0.06, location=(tx + dx, ty + dy, crown_z + dz))
            pt = bpy.context.active_object
            pt.data.materials.append(mat_lidar_point)

    # 10. High-Poly Vehicles
    root_dir = Path(__file__).resolve().parents[2]
    sedan_path = root_dir / "backend/assets/library/car_sketchfab_sedan.glb"
    suv_path = root_dir / "backend/assets/library/car_sketchfab_suv.glb"

    def spawn_car(glb_path, x, y, is_suv=False, body_mat=None, glass_mat=None, is_ego=False):
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=str(glb_path))
        imported = [o for o in bpy.data.objects if o not in before and o.type == "MESH"]

        z_offset = 0.85 if is_suv else 0.725
        root = bpy.data.objects.new("CarInstance", None)
        bpy.context.collection.objects.link(root)
        root.location = (x, y, z_offset)
        root.rotation_euler = (0, 0, math.radians(90))

        for obj in imported:
            obj.data = obj.data.copy()
            obj.parent = root

            if "Glass" in obj.name:
                obj.data.materials[0] = glass_mat or mat_traffic_glass
            elif "Optics" in obj.name:
                if len(obj.data.materials) >= 2:
                    obj.data.materials[0] = mat_headlight_white
                    obj.data.materials[1] = mat_taillight_red
                elif len(obj.data.materials) == 1:
                    obj.data.materials[0] = mat_taillight_red
            elif "Wheel" in obj.name:
                obj.data.materials[0] = mat_tire
            elif "Body" in obj.name:
                obj.data.materials[0] = body_mat or mat_traffic_silver
        return root

    # Ego Vehicle (Tesla Metallic Blue with Dark Tinted Glass Roof & Red Taillights)
    spawn_car(
        sedan_path,
        x=ego_lane_x,
        y=ego_y,
        is_suv=False,
        body_mat=mat_ego_blue,
        glass_mat=mat_glass_dark,
        is_ego=True,
    )

    # Surrounding Traffic
    lane_0_x = left_edge_x + 0.5 * lane_width
    lane_2_x = left_edge_x + 2.5 * lane_width
    lane_3_x = left_edge_x + 3.5 * lane_width

    # Adjacent SUV
    spawn_car(
        suv_path,
        x=lane_0_x,
        y=8.5,
        is_suv=True,
        body_mat=mat_traffic_silver,
        glass_mat=mat_traffic_glass,
    )

    # Lead Vehicle
    spawn_car(
        sedan_path,
        x=ego_lane_x,
        y=lead_y,
        is_suv=False,
        body_mat=mat_traffic_dark_charcoal,
        glass_mat=mat_traffic_glass,
    )

    # Other Vehicles
    spawn_car(
        sedan_path,
        x=lane_0_x,
        y=28.0,
        is_suv=False,
        body_mat=mat_traffic_white,
        glass_mat=mat_traffic_glass,
    )
    spawn_car(
        suv_path,
        x=lane_0_x,
        y=42.0,
        is_suv=True,
        body_mat=mat_traffic_silver,
        glass_mat=mat_traffic_glass,
    )
    spawn_car(
        sedan_path,
        x=lane_2_x,
        y=35.0,
        is_suv=False,
        body_mat=mat_traffic_silver,
        glass_mat=mat_traffic_glass,
    )
    spawn_car(
        suv_path,
        x=lane_3_x,
        y=22.0,
        is_suv=True,
        body_mat=mat_traffic_white,
        glass_mat=mat_traffic_glass,
    )

    # 11. Lighting Setup
    bpy.ops.object.light_add(type="SUN", location=(30, -15, 50))
    sun = bpy.context.active_object
    sun.data.energy = 4.0
    sun.data.color = (1.0, 0.98, 0.95)
    sun.data.angle = math.radians(4.0)
    sun.rotation_euler = (math.radians(35), math.radians(12), math.radians(-30))

    bpy.ops.object.light_add(type="SUN", location=(-25, 10, 35))
    fill = bpy.context.active_object
    fill.data.energy = 1.4
    fill.data.color = (0.86, 0.90, 0.98)
    fill.rotation_euler = (math.radians(50), math.radians(-15), math.radians(140))

    # 12. Chase Camera
    cam_data = bpy.data.cameras.new("FSD_Chase_Camera")
    cam_data.lens = 38.0
    cam_data.clip_start = 0.1
    cam_data.clip_end = 600.0

    cam_obj = bpy.data.objects.new("FSD_Chase_Camera", cam_data)
    bpy.context.collection.objects.link(cam_obj)
    scene.camera = cam_obj

    cam_obj.location = (ego_lane_x, -8.6, 3.8)
    cam_obj.rotation_euler = (math.radians(75.8), 0.0, 0.0)

    # Render
    print("Rendering updated preview to:", output_path)
    bpy.ops.render.render(write_still=True)
    print("Render finished successfully!")


if __name__ == "__main__":
    out_file = sys.argv[-1] if len(sys.argv) > 1 and sys.argv[-1].endswith(".png") else "/tmp/tesla_fsd_style_preview.png"
    setup_tesla_fsd_scene(out_file)
