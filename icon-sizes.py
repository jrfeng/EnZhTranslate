from PIL import Image

base = Image.open('icon-src.png')

sizes = {
    '32x32.png': 32,
    '128x128.png': 128,
    '128x128@2x.png': 256,
    'icon.png': 512,
}

for name, size in sizes.items():
    base.resize((size, size), Image.LANCZOS).save('src-tauri/icons/' + name)

base.resize((256, 256), Image.LANCZOS).save(
    'src-tauri/icons/icon.ico',
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
)

print('icons written')
