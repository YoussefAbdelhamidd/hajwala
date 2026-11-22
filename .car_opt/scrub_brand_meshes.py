"""Remove badge/logo meshes and rename brand-y material/image labels before re-export."""
from __future__ import annotations

import re
import sys
from pathlib import Path

import bpy

ROOT = Path('/Users/rokaya/Desktop/Saudi-tafheet')
FILES = [
    ROOT / 'public' / 'tray_runner.glb',
    ROOT / 'public' / 'cars' / 'coupe_spirit.glb',
    ROOT / 'public' / 'cars' / 'street_racer.glb',
    ROOT / 'public' / 'cars' / 'night_spec.glb',
    ROOT / 'public' / 'cars' / 'neon_runner.glb',
    ROOT / 'public' / 'cars' / 'gt_wedge.glb',
    ROOT / 'public' / 'cars' / 'classic_wedge.glb',
    ROOT / 'public' / 'cars' / 'tuktuk.glb',
]

BADGE = re.compile(r'(logo|badge|emblem|decal|insignia|crest)', re.I)
BRAND = re.compile(
    r'(nissan|datsun|bmw|mclaren|lamborghini|countach|skyline|gtr|'
    r'mazda|rx.?7|ferrari|porsche|audi|mercedes|honda|toyota)',
    re.I,
)


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def scrub(path: Path):
    reset()
    bpy.ops.import_scene.gltf(filepath=str(path))
    removed = []
    for obj in list(bpy.data.objects):
        if obj.type != 'MESH':
            continue
        name = obj.name
        if BADGE.search(name) or (BRAND.search(name) and BADGE.search(name)):
            removed.append(name)
            bpy.data.objects.remove(obj, do_unlink=True)
            continue
        # Tiny brand-named trims (badge plates) — volume under ~0.002 m³
        dims = obj.dimensions
        volumeish = abs(float(dims.x) * float(dims.y) * float(dims.z))
        if BRAND.search(name) and volumeish < 0.002:
            removed.append(name)
            bpy.data.objects.remove(obj, do_unlink=True)

    for mat in list(bpy.data.materials):
        if BRAND.search(mat.name):
            mat.name = BRAND.sub('part', mat.name)

    for img in list(bpy.data.images):
        if BRAND.search(img.name):
            img.name = BRAND.sub('tex', img.name)

    bpy.ops.export_scene.gltf(
        filepath=str(path),
        export_format='GLB',
        export_apply=True,
        export_animations=False,
    )
    print(f'{path.name}: removed={removed}')


def main():
    for path in FILES:
        if not path.exists():
            print('missing', path)
            continue
        scrub(path)
    print('done')


if __name__ == '__main__':
    main()
    sys.exit(0)
