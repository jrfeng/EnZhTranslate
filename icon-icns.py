"""把 icon-src.png 生成 macOS 需要的 icons/icon.icns。

用法：python icon-icns.py
"""

import io
import pathlib
import struct

from PIL import Image

ROOT = pathlib.Path(__file__).parent
SRC = ROOT / 'icon-src.png'
OUT = ROOT / 'src-tauri' / 'icons' / 'icon.icns'

# ICNS 里每个尺寸的槽位：16 32 64 128 256 512 1024
SLOTS = [
    (b'icp4', 16),
    (b'icp5', 32),
    (b'icp6', 64),
    (b'ic07', 128),
    (b'ic08', 256),
    (b'ic09', 512),
    (b'ic10', 1024),
]


def main() -> None:
    image = Image.open(SRC).convert('RGBA')

    chunks = []
    for kind, size in SLOTS:
        buffer = io.BytesIO()
        image.resize((size, size), Image.LANCZOS).save(buffer, format='PNG')
        data = buffer.getvalue()
        chunks.append(kind + struct.pack('>I', len(data) + 8) + data)

    body = b''.join(chunks)
    payload = b'icns' + struct.pack('>I', len(body) + 8) + body
    OUT.write_bytes(payload)
    print(f'{OUT}  ({len(payload)} bytes)')


if __name__ == '__main__':
    main()
