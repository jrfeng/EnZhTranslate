"""生成应用图标源图 icon-src.png（1024×1024）。

设计：浅色底上两个对话气泡——蓝色气泡里是 A，深色气泡里是 中，代表英译中。
先按 2048 画再缩到 1024，边缘更干净。

用法：python icon-gen.py
"""

import pathlib

from PIL import Image, ImageDraw, ImageFont

S = 2048
ROOT = pathlib.Path(__file__).parent

FONT_LATIN = r'C:\Windows\Fonts\segoeuib.ttf'
FONT_CJK = r'C:\Windows\Fonts\msyhbd.ttc'

WHITE = (255, 255, 255, 255)


def px(x: float) -> int:
    return int(S * x)


def vgradient(top: tuple, bottom: tuple) -> Image.Image:
    grad = Image.new('RGB', (1, S))
    for y in range(S):
        t = y / (S - 1)
        grad.putpixel((0, y), tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))
    return grad.resize((S, S))


def centered_text(draw: ImageDraw.ImageDraw, text: str, fnt, center: tuple, fill) -> None:
    left, top, right, bottom = draw.textbbox((0, 0), text, font=fnt)
    x = center[0] - (right - left) / 2 - left
    y = center[1] - (bottom - top) / 2 - top
    draw.text((x, y), text, font=fnt, fill=fill)


def main() -> None:
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))

    # 圆角背景
    mask = Image.new('L', (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle(
        (0, 0, S - 1, S - 1), radius=px(0.235), fill=255
    )
    bg = vgradient((248, 250, 252), (222, 229, 239)).convert('RGBA')
    img = Image.composite(bg, img, mask)

    draw = ImageDraw.Draw(img)

    # 蓝色气泡（A）
    draw.rounded_rectangle(
        (px(0.10), px(0.20), px(0.58), px(0.62)),
        radius=px(0.10),
        fill=(37, 99, 235, 255),
    )
    draw.polygon(
        [(px(0.22), px(0.60)), (px(0.22), px(0.74)), (px(0.36), px(0.60))],
        fill=(37, 99, 235, 255),
    )

    # 深色气泡（中）
    draw.rounded_rectangle(
        (px(0.42), px(0.38), px(0.90), px(0.80)),
        radius=px(0.10),
        fill=(15, 23, 42, 255),
    )
    draw.polygon(
        [(px(0.78), px(0.78)), (px(0.78), px(0.92)), (px(0.64), px(0.78))],
        fill=(15, 23, 42, 255),
    )

    # 文字
    centered_text(
        draw, 'A', ImageFont.truetype(FONT_LATIN, px(0.245)), (px(0.34), px(0.415)), WHITE
    )
    centered_text(
        draw, '中', ImageFont.truetype(FONT_CJK, px(0.245)), (px(0.66), px(0.595)), WHITE
    )

    out = img.resize((1024, 1024), Image.LANCZOS)
    path = ROOT / 'icon-src.png'
    out.save(path)
    print('saved', path, out.size)


if __name__ == '__main__':
    main()
