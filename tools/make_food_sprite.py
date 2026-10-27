# Режет сетки иконок 4×4 (PNG с прозрачным фоном, нарисованы в ChatGPT) и собирает спрайт web/icons/food.webp.
# Порядок иконок — массив KEYS в web/foodicons.js: сетки идут подряд, по 16 иконок, слева направо и сверху вниз.
# Запуск: python tools/make_food_sprite.py grid1.png grid2.png grid3.png grid4.png [--sheet проверка.png]
import re, sys, os
import numpy as np
from PIL import Image
from scipy import ndimage

CELL, COLS = 128, 8          # одна иконка 128×128, спрайт 8 колонок
PAD = 0.06                   # поле вокруг иконки внутри клетки
root = os.path.join(os.path.dirname(__file__), '..')
js = open(os.path.join(root, 'web', 'foodicons.js'), encoding='utf-8').read()
keys = re.findall(r"'([a-z0-9]+)'", re.search(r'var KEYS = \[(.*?)\];', js, re.S).group(1))
args = sys.argv[1:]
check = args[args.index('--sheet') + 1] if '--sheet' in args else None
grids = [a for a in args if a.endswith('.png') and a != check]


def cut(path):
    """16 иконок из сетки. Предметы иногда заходят за границу клетки, поэтому режем не по сетке,
    а по связным областям: область относится к клетке, где лежит её центр."""
    im = Image.open(path).convert('RGBA'); w, h = im.size
    lab, n = ndimage.label(np.asarray(im.getchannel('A')) > 24)
    cells = [[] for _ in range(16)]
    for i, sl in enumerate(ndimage.find_objects(lab), 1):
        part = lab[sl] == i
        if part.sum() < w * h / 4000: continue        # пылинки и обрывки контура
        cy, cx = ndimage.center_of_mass(part)
        cy += sl[0].start; cx += sl[1].start
        cells[min(3, int(cy * 4 / h)) * 4 + min(3, int(cx * 4 / w))].append(i)
    out = []
    for ids in cells:
        if not ids: out.append(None); continue
        mask = np.isin(lab, ids)
        ys, xs = np.nonzero(mask)
        bb = (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)
        obj = Image.new('RGBA', im.size); obj.paste(im, (0, 0), Image.fromarray(mask.astype('uint8') * 255)); obj = obj.crop(bb)
        s = max(obj.size)
        sq = Image.new('RGBA', (s, s)); sq.paste(obj, ((s - obj.width) // 2, (s - obj.height) // 2))
        inner = round(CELL * (1 - 2 * PAD))
        out.append(sq.resize((inner, inner), Image.LANCZOS))
    return out


icons = [ic for g in grids for ic in cut(g)]
if len(icons) < len(keys): sys.exit('icons %d < keys %d' % (len(icons), len(keys)))
rows = (len(keys) + COLS - 1) // COLS
sprite = Image.new('RGBA', (COLS * CELL, rows * CELL))
off = round(CELL * PAD)
for i, k in enumerate(keys):
    if icons[i] is None: print('empty cell:', k); continue
    sprite.paste(icons[i], ((i % COLS) * CELL + off, (i // COLS) * CELL + off), icons[i])
if check:   # контактный лист на сером фоне — проверить нарезку глазами
    bg = Image.new('RGBA', sprite.size, (200, 200, 200, 255)); bg.alpha_composite(sprite); bg.convert('RGB').save(check)
out = os.path.join(root, 'web', 'icons', 'food.webp')
sprite.save(out, 'WEBP', quality=82, method=6)
print(out, sprite.size, os.path.getsize(out) // 1024, 'KB,', len(keys), 'icons')
