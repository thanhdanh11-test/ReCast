"""P06 machine measurements and measured-point / texture-source debug images."""

import argparse
import json
import re
import shutil
from pathlib import Path

import cv2
import numpy as np

from topeye.core.object_accum import crop_local, rotation
from topeye.core.types import GTBox3D


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', type=Path, required=True)
    parser.add_argument('--cache', type=Path, default=Path('data/cache'))
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)
    frame = 'scene-0061_000010'
    root = args.cache / 'scene-0061' / 'frames' / frame
    boxes = [GTBox3D(**b) for b in json.loads((root / 'gt.json').read_text())]
    atlas = json.loads((root / 'box_atlas.json').read_text())
    dense_meta = json.loads((root / 'objects_dense.json').read_text())
    dense = np.fromfile(root / 'objects_dense.bin', '<f4').reshape(-1, 7)
    points = np.fromfile(root / 'points.bin', '<f4').reshape(-1, 7)
    before = {f'gt:{b.annotation_token}': crop_local(points, b) for b in boxes}
    records = {o['id']: o for o in dense_meta['objects']}
    debug = cv2.imread(str(root / 'box_atlas.png'))
    for record in atlas['boxes'].values():
        for name, face in record['faces'].items():
            x, y, right, bottom = face['uv']
            label = f"{name} dt={face['src_dt']}"
            cv2.rectangle(debug, (x, y), (right, bottom), (0, 220, 255), 1)
            cv2.putText(debug, label, (x + 1, y + 10), cv2.FONT_HERSHEY_SIMPLEX,
                        .27, (0, 0, 0), 2)
            cv2.putText(debug, label, (x + 1, y + 10), cv2.FONT_HERSHEY_SIMPLEX,
                        .27, (255, 255, 255), 1)
    assert cv2.imwrite(str(args.out / 'atlas-debug-frame10.png'), debug)
    shutil.copyfile(root / 'box_atlas.json', args.out / 'atlas-frame10.json')
    canvas = np.full((3 * 340, 4 * 340, 3), 25, np.uint8)
    nearest = sorted(boxes, key=lambda b: b.cx*b.cx+b.cy*b.cy+b.cz*b.cz)[:6]
    for i, box in enumerate(nearest):
        identity = f'gt:{box.annotation_token}'
        rec = records[identity]
        after = dense[rec['start']:rec['start']+rec['count']].copy()
        after[:, :3] = (after[:, :3] - [box.cx, box.cy, box.cz]) @ rotation(box)
        for j, cloud in enumerate((before[identity], after)):
            ox, oy = (i % 2 * 2 + j)*340, (i // 2)*340
            # Same metric scale and object-local xy axes in both panels.
            scale = 250 / max(box.l+.4, box.w+.4)
            for point in cloud:
                x, y = round(ox+170+point[1]*scale), round(oy+195-point[0]*scale)
                color = tuple(int(v) for v in point[4:7][::-1]) if point[4] >= 0 else (170,)*3
                cv2.circle(canvas, (x, y), 1, color, -1)
            label = f"#{i+1} {'before' if j == 0 else 'dense'} n={len(cloud)}"
            cv2.putText(canvas, label, (ox+8, oy+20), cv2.FONT_HERSHEY_SIMPLEX,
                        .5, (235, 235, 235), 1)
            cv2.putText(canvas, identity[3:15], (ox+8, oy+40), cv2.FONT_HERSHEY_SIMPLEX,
                        .4, (180, 180, 180), 1)
    assert cv2.imwrite(str(args.out / 'dense-six-nearest-frame10.png'), canvas)
    log = (args.out / 'prepare-all.txt').read_text()
    times = {kind: {f: float(t) for f, t in re.findall(kind+r'=(\S+) seconds=([\d.]+)', log)}
             for kind in ('atlas', 'dense', 'frame')}
    metas = [json.loads(p.read_text()) for p in args.cache.glob('*/meta.json')]
    combined = {f: t + times['dense'][f] for f, t in times['atlas'].items()}
    sides = [face for b in atlas['boxes'].values() for n, face in b['faces'].items() if n != 'top']
    metrics = {
        'frame': frame, 'side_seen_before': 246, 'side_total_before': 504,
        'side_seen_after': sum(f['seen'] for f in sides), 'side_total_after': len(sides),
        'mean_points_before': float(np.mean([len(p) for p in before.values()])),
        'mean_points_after': float(np.mean([r['count'] for r in records.values()])),
        'dense_rows': len(dense), 'sum_counts': sum(r['count'] for r in records.values()),
        'scenes': len(metas), 'frames': sum(len(m['frames']) for m in metas),
        'failures': sum(len(m['failures']) for m in metas),
        'cache_versions': sorted({m['cache_version'] for m in metas}),
        'atlas_seconds_max': max(times['atlas'].values()),
        'atlas_dense_seconds_max': max(combined.values()),
        'atlas_dense_seconds_mean': float(np.mean(list(combined.values()))),
        'total_seconds': float(re.search(r'total_seconds=([\d.]+)', log)[1]),
        'timing_includes': 'atlas selection/warp/encode/write + dense crop/voxel/encode/write; '
                           'scene depth/gain preprocessing included in total_seconds',
        'objects': [{**r, 'count_before': len(before[r['id']])} for r in records.values()],
        'per_frame': {f: {'atlas': times['atlas'][f], 'dense': times['dense'][f],
                          'sum': t} for f, t in combined.items()}}
    (args.out / 'metrics.txt').write_text(json.dumps(metrics, indent=2)+'\n')
    assert len(times['atlas']) == len(times['dense']) == metrics['frames']
    assert metrics['cache_versions'] == [8] and metrics['failures'] == 0
    assert metrics['atlas_seconds_max'] <= 5 and metrics['atlas_dense_seconds_max'] <= 8
    assert metrics['sum_counts'] == metrics['dense_rows']
    print(json.dumps({k: v for k, v in metrics.items() if k not in ('objects', 'per_frame')}, indent=2))


if __name__ == '__main__':
    main()
