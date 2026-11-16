from PIL import Image, ImageDraw

S = 2048
img = Image.new('RGBA', (S, S), (0, 0, 0, 0))

# 渐变底色
top = (59, 130, 246)
bottom = (29, 78, 216)
grad = Image.new('RGB', (1, S))
for y in range(S):
    t = y / (S - 1)
    grad.putpixel((0, y), tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))
grad = grad.resize((S, S))

mask = Image.new('L', (S, S), 0)
ImageDraw.Draw(mask).rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.22), fill=255)
img = Image.composite(grad.convert('RGBA'), img, mask)

d = ImageDraw.Draw(img)
WHITE = (255, 255, 255, 255)
W = int(S * 0.055)
R = W // 2


def stroke(p0, p1):
    d.line([p0, p1], fill=WHITE, width=W)
    for p in (p0, p1):
        d.ellipse([p[0] - R, p[1] - R, p[0] + R, p[1] + R], fill=WHITE)


def pt(x, y):
    return (int(S * x), int(S * y))


# A
stroke(pt(0.165, 0.725), pt(0.335, 0.275))
stroke(pt(0.335, 0.275), pt(0.505, 0.725))
stroke(pt(0.225, 0.565), pt(0.445, 0.565))

# 中
d.rounded_rectangle(
    [pt(0.60, 0.405)[0], pt(0.60, 0.405)[1], pt(0.855, 0.685)[0], pt(0.855, 0.685)[1]],
    radius=int(S * 0.012),
    outline=WHITE,
    width=W,
)
stroke(pt(0.7275, 0.285), pt(0.7275, 0.795))

img = img.resize((1024, 1024), Image.LANCZOS)
img.save('icon-src.png')
print('saved icon-src.png', img.size)
