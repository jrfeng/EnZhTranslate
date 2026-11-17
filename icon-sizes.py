"""把 icon-src.png 生成各尺寸 PNG 与 Windows 用的 icons/icon.ico。

用法：python icon-sizes.py
"""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).parent
base = Image.open(ROOT / 'icon-src.png').convert('RGBA')

sizes = {
    '32x32.png': 32,
    '128x128.png': 128,
    '128x128@2x.png': 256,
    'icon.png': 512,
}

for name, size in sizes.items():
    base.resize((size, size), Image.LANCZOS).save(ROOT / 'src-tauri' / 'icons' / name)

ico_sizes = [(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)]
base.resize((256, 256), Image.LANCZOS).save(
    ROOT / 'src-tauri' / 'icons' / 'icon.ico',
    format='ICO',
    sizes=ico_sizes,
)

print('icons written')
