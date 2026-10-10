"""Normalize an owner-authorized CC-BY VF3 GLB with offline Blender.

Run using Blender --background --factory-startup --python this_file --
--source ORIGINAL.glb --output-dir frontend/src/scenario/assets/models
--evidence-dir planning/.../evidence/assets --front-axis +X

Dimensions are a visual proxy fitted by the renderer to source actor bounds;
they are not physical measurements of the real VinFast VF3.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import math
import sys
from pathlib import Path


def main() -> None:
    import bpy
    from mathutils import Matrix, Vector

    parser = argparse.ArgumentParser()
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output-dir', type=Path, required=True)
    parser.add_argument('--evidence-dir', type=Path, required=True)
    parser.add_argument('--front-axis', choices=['+X', '-X', '+Y', '-Y'], required=True)
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:])
    args.output_dir.mkdir(parents=True, exist_ok=True)
    args.evidence_dir.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=str(args.source.resolve()))
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    if not meshes:
        raise ValueError('Source contains no meshes')
    angle = {'+X': 0, '-X': math.pi, '+Y': -math.pi / 2, '-Y': math.pi / 2}[args.front_axis]
    turn = Matrix.Rotation(angle, 4, 'Z')
    # Bake world transforms and source orientation into geometry before fitting.
    for obj in meshes:
        obj.data = obj.data.copy()
        obj.data.transform(turn @ obj.matrix_world)
        obj.parent = None
        obj.matrix_world = Matrix.Identity(4)
    points = [v.co for obj in meshes for v in obj.data.vertices]
    lo = Vector([min(v[i] for v in points) for i in range(3)])
    hi = Vector([max(v[i] for v in points) for i in range(3)])
    extent = hi - lo
    if min(extent) <= 0:
        raise ValueError('Degenerate source bounds')
    center = (lo + hi) / 2
    # Centered unit bounds; renderer applies actor length/height/width.
    for obj in meshes:
        for vertex in obj.data.vertices:
            vertex.co = Vector([(vertex.co[i] - center[i]) / extent[i] for i in range(3)])
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
    materials = {}
    categories = {}
    for obj in meshes:
        for slot in obj.material_slots:
            original = slot.material
            if original is None:
                name = 'body'
            else:
                name = original.name.lower()
            # This source uses numbered materials for windows/lights. Classify
            # the inspected mesh, not only generic material-name heuristics.
            mesh_categories = {
                'Object_4': 'rubber', 'Object_5': 'body', 'Object_6': 'glass',
                'Object_7': 'trim', 'Object_8': 'chrome', 'Object_9': 'chrome',
                'Object_10': 'trim', 'Object_11': 'trim', 'Object_12': 'light',
                'Object_13': 'trim', 'Object_14': 'light', 'Object_15': 'light',
                'Object_16': 'light', 'Object_17': 'chrome', 'Object_18': 'light',
            }
            if obj.name not in mesh_categories:
                raise ValueError(f'Uninspected source mesh: {obj.name}')
            category = mesh_categories[obj.name]
            categories[name] = category
            if category not in materials:
                mat = bpy.data.materials.new('VF3_' + category)
                mat.use_nodes = True
                shader = mat.node_tree.nodes.get('Principled BSDF')
                # Blender node inputs use scene-linear values; convert sRGB paint.
                srgb = {'body': (218 / 255, 41 / 255, 28 / 255),
                        'rubber': (.055, .055, .055), 'glass': (.14, .14, .14),
                        'trim': (.15, .15, .15), 'chrome': (.64, .64, .64),
                        'light': (.87, .87, .87)}[category]
                linear = tuple(c / 12.92 if c <= .04045 else ((c + .055) / 1.055) ** 2.4 for c in srgb)
                shader.inputs['Base Color'].default_value = (*linear, 1)
                mat.diffuse_color = (*linear, 1)
                shader.inputs['Roughness'].default_value = .28 if category == 'body' else .55
                shader.inputs['Metallic'].default_value = .35 if category in ['body', 'trim'] else 0
                materials[category] = mat
            slot.material = materials[category]
    # Discard non-mesh source helpers/cameras/lights before isolated export.
    for obj in list(bpy.context.scene.objects):
        if obj not in meshes:
            bpy.data.objects.remove(obj, do_unlink=True)
    original_triangles = sum(sum(len(p.vertices) - 2 for p in o.data.polygons) for o in meshes)
    base = [(o, o.data.copy()) for o in meshes]
    levels = {}
    for label, budget in [('high', 50000), ('low', 8000)]:
        for obj, pristine in base:
            obj.data = pristine.copy()
        ratio = min(1, (budget - 100) / original_triangles)
        for obj in meshes:
            bpy.context.view_layer.objects.active = obj
            modifier = obj.modifiers.new('Budgeted LOD', 'DECIMATE')
            modifier.ratio = ratio
            bpy.ops.object.modifier_apply(modifier=modifier.name)
            obj.data.calc_loop_triangles()
        # Decimation can remove extremal vertices. Refit each derivative so
        # callers can rely on exact centered unit bounds for either LOD.
        lod_points = [obj.data.vertices[i].co for obj in meshes
                      for polygon in obj.data.polygons for i in polygon.vertices]
        lod_lo = Vector([min(v[i] for v in lod_points) for i in range(3)])
        lod_hi = Vector([max(v[i] for v in lod_points) for i in range(3)])
        lod_center = (lod_lo + lod_hi) / 2
        lod_extent = lod_hi - lod_lo
        for obj in meshes:
            for vertex in obj.data.vertices:
                vertex.co = Vector([(vertex.co[i] - lod_center[i]) / lod_extent[i]
                                    for i in range(3)])
        triangles = sum(len(o.data.loop_triangles) for o in meshes)
        if triangles > budget:
            raise ValueError(f'{label} exceeds budget: {triangles} > {budget}')
        bpy.ops.object.select_all(action='DESELECT')
        for obj in meshes:
            obj.select_set(True)
        destination = args.output_dir / f'vinfast-vf3-{label}.glb'
        bpy.ops.export_scene.gltf(filepath=str(destination.resolve()), export_format='GLB',
                                  use_selection=True, export_yup=True, export_animations=False,
                                  export_cameras=False, export_lights=False)
        destination.with_name(destination.name + '.base64').write_text(
            base64.b64encode(destination.read_bytes()).decode('ascii'), encoding='ascii')
        levels[label] = {'triangles': triangles, 'bytes': destination.stat().st_size,
                         'sha256': hashlib.sha256(destination.read_bytes()).hexdigest()}
    proof = {'source_sha256': hashlib.sha256(args.source.read_bytes()).hexdigest(),
             'source_url': 'https://sketchfab.com/3d-models/vinfast-vf3-plus-2026-aa87e1cd1fdd42ae92e5a397e3d5b125',
             'author': 'Hoàng Huy (@danghoanghuy69)', 'license': 'CC-BY-4.0',
             'license_url': 'https://creativecommons.org/licenses/by/4.0/',
             'changes': 'Centered unit bounds, front +X/up +Y GLTF, decimated two LODs, textures removed, red ego paint and gray trim.',
             'physical_measurements': False, 'source_blender_bounds': [list(lo), list(hi)],
             'source_front_axis_blender': args.front_axis, 'source_triangles': original_triangles,
             'material_categories': categories, 'levels': levels}
    (args.evidence_dir / 'vinfast-normalization.json').write_text(json.dumps(proof, indent=2), encoding='utf-8')
    (args.output_dir / 'vinfast-vf3-attribution.json').write_text(
        json.dumps(proof, indent=2), encoding='utf-8')
    (args.output_dir / 'vinfast-vf3-LICENSE.txt').write_text(
        'Vinfast VF3 Plus 2026 by Hoàng Huy (@danghoanghuy69)\n'
        + proof['source_url'] + '\n'
        'Licensed under Creative Commons Attribution 4.0 International (CC BY 4.0)\n'
        + proof['license_url'] + '\n'
        'Changes: ' + proof['changes'] + '\n'
        'Visual proxy fitted to source actor bounds, not real VF3 measurements.\n',
        encoding='utf-8')
    print(json.dumps(proof, indent=2))


if __name__ == '__main__':
    main()
