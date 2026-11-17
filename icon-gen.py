"""生成应用图标主图 icon-src.png（1024×1024）。

方案 S4：深色圆角底 + 蓝色气泡（A）+ 白色气泡（中）。
比例与形状参数都按 512 画布设计，代码里乘 K 放大到 4096 再缩到 1024，
保证圆角、渐变和文字边缘都平滑。
"""

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).parent
OUT = ROOT / 'icon-src.png'

BASE = 512          # 设计基准
K = 8               # 超采样倍数
S = BASE * K

TILE_TOP = '#1a2a46'
TILE_BOTTOM = '#0a1322'
BLUE_TOP = '#5f96f2'
BLUE_BOTTOM = '#2b5fd2'
WHITE = '#ffffff'
INK = '#182742'

FONT_A = r'C:\Windows\Fonts\segoeuib.ttf'
FONT_ZH = r'C:\Windows\Fonts\msyhbd.ttc'


def gradient(size: int, c0: str, c1: str) -> Image.Image:
    """从左上到右下的线性渐变。"""
    rgb0 = np.array([int(c0[i:i + 2], 16) for i in (1, 3, 5)], dtype=np.float32)
    rgb1 = np.array([int(c1[i:i + 2], 16) for i in (1, 3, 5)], dtype=np.float32)
    y, x = np.mgrid[0:size, 0:size]
    t = ((x + y) / (2 * (size - 1)))[:, :, None]
    arr = (rgb0 * (1 - t) + rgb1 * t).astype(np.uint8)
    return Image.fromarray(arr, 'RGB')


def rounded_mask(size: int, box, radius: int) -> Image.Image:
    """圆角矩形蒙版。"""
    mask = Image.new('L', (size, size), 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle(box, radius=radius, fill=255)
    return mask


def bubble(size: int, box, radius: int, tail_points) -> Image.Image:
    """圆角矩形 + 三角尾巴，合成气泡蒙版。"""
    mask = rounded_mask(size, box, radius)
    if tail_points:
        d = ImageDraw.Draw(mask)
        d.polygon(tail_points, fill=255)
    return mask


def draw_text(canvas: Image.Image, text: str, font_path: str, px: int, color: str, center) -> None:
    """按文字实际墨迹居中绘制。"""
    overlay = Image.new('RGBA', canvas.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(overlay)
    font = ImageFont.truetype(font_path, px)
    bbox = d.textbbox((0, 0), text, font=font)
    w = bbox[2] - bbox[0]
    h = bbox[3] - bbox[1]
    x = center[0] - w / 2 - bbox[0]
    y = center[1] - h / 2 - bbox[1]
    d.text((x, y), text, font=font, fill=color)
    canvas.alpha_composite(overlay)


def px(v):
    return int(round(v * K))


def main() -> None:
    canvas = Image.new('RGBA', (S, S), (0, 0, 0, 0))

    # 1. 底色圆角方块
    tile = gradient(S, TILE_TOP, TILE_BOTTOM).convert('RGBA')
    tile.putalpha(rounded_mask(S, (0, 0, S - 1, S - 1), px(112)))
    canvas.alpha_composite(tile)

    # 2. 蓝色气泡（A）：x 54..294，y 84..324，r 58，尾巴左下
    blue_mask = bubble(
        S,
        (px(54), px(84), px(294), px(324)),
        px(58),
        [(px(170), px(324)), (px(112), px(384)), (px(112), px(324))],
    )
    blue = gradient(S, BLUE_TOP, BLUE_BOTTOM).convert('RGBA')
    blue.putalpha(blue_mask)
    canvas.alpha_composite(blue)

    # 3. 白色气泡（中）：x 228..464，y 166..398，r 56，尾巴右下
    white_mask = bubble(
        S,
        (px(228), px(166), px(464), px(398)),
        px(56),
        [(px(388), px(398)), (px(388), px(448)), (px(330), px(398))],
    )
    white = Image.new('RGBA', (S, S), WHITE)
    white.putalpha(white_mask)
    canvas.alpha_composite(white)

    # 4. 文字
    draw_text(canvas, 'A', FONT_A, px(132), WHITE, (px(174), px(204)))
    draw_text(canvas, '中', FONT_ZH, px(124), INK, (px(346), px(284)))

    canvas.resize((1024, 1024), Image.LANCZOS).save(OUT)
    print('written', OUT)


if __name__ == '__main__':
    main()
