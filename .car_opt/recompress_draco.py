"""Re-export garage GLBs with Draco to restore web-friendly sizes."""
from __future__ import annotations

import sys
from pathlib import Path

import bpy

ROOT = Path('/Users/rokaya/Desktop/Saudi-tafheet')
FILES = [
    ROOT / 'public' / 'tray_runner.glb',
    *(ROOT / 'public' / 'cars').glob('*.glb'),
]


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def recompress(path: Path):
    reset()
    before = path.stat().st_size
    bpy.ops.import_scene.gltf(filepath=str(path))
    # Blender 5 GLTF export — Draco when the extension is available.
    kwargs = dict(
        filepath=str(path),
        export_format='GLB',
        export_apply=True,
        export_animations=False,
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=6,
        export_draco_position_quantization=14,
        export_draco_normal_quantization=10,
        export_draco_texcoord_quantization=12,
        export_draco_color_quantization=10,
        export_draco_generic_quantization=12,
    )
    try:
        bpy.ops.export_scene.gltf(**kwargs)
    except TypeError:
        kwargs.pop('export_draco_color_quantization', None)
        kwargs.pop('export_draco_generic_quantization', None)
        bpy.ops.export_scene.gltf(**kwargs)
    after = path.stat().st_size
    print(f'{path.name}: {before/1024/1024:.2f}MB -> {after/1024/1024:.2f}MB')


def main():
    for path in FILES:
        if path.exists():
            recompress(path)
    print('done')


if __name__ == '__main__':
    main()
    sys.exit(0)
