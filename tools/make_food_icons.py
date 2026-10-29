# Отдельные иконки продуктов и блюд: PNG 1024×1024 с прозрачным фоном (нарисованы в ChatGPT по tools/food-icons/prompts*.md)
# → web/icons/food/<латиница>.webp 160×160 и список web/foodlist.js (имя файла = название продукта или блюда).
# Запуск: python tools/make_food_icons.py "Иконки еды" "Иконки ВкусВилл" [--sheet проверка.png]
import os, re, sys, json
from PIL import Image

SIZE, PAD = 160, 0.06
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
out = os.path.join(root, 'web', 'icons', 'food')
args = sys.argv[1:]
sheet = args[args.index('--sheet') + 1] if '--sheet' in args else None
dirs = [a for a in args if a != sheet and a != '--sheet']

TR = dict(zip('абвгдеёжзийклмнопрстуфхцчшщъыьэюя', ['a', 'b', 'v', 'g', 'd', 'e', 'e', 'zh', 'z', 'i', 'y', 'k', 'l', 'm', 'n', 'o', 'p', 'r', 's', 't', 'u', 'f', 'h', 'ts', 'ch', 'sh', 'sch', '', 'y', '', 'e', 'yu', 'ya']))
def slug(name):
    s = ''.join(TR.get(c, c) for c in name.lower())
    return re.sub(r'[^a-z0-9]+', '-', s).strip('-')

os.makedirs(out, exist_ok=True)
items, seen = [], {}
for d in dirs:
    for f in sorted(os.listdir(d)):
        if not f.lower().endswith('.png'): continue
        name = f[:-4].strip()
        k = slug(name)
        if k in seen: raise SystemExit('повтор: ' + name + ' и ' + seen[k])
        seen[k] = name
        im = Image.open(os.path.join(d, f)).convert('RGBA')
        bb = im.getchannel('A').point(lambda v: 255 if v > 24 else 0).getbbox()
        if not bb: raise SystemExit('пустая картинка: ' + f)
        obj = im.crop(bb); s = max(obj.size)
        sq = Image.new('RGBA', (s, s)); sq.paste(obj, ((s - obj.width) // 2, (s - obj.height) // 2))
        inner = round(SIZE * (1 - 2 * PAD))
        cell = Image.new('RGBA', (SIZE, SIZE)); cell.paste(sq.resize((inner, inner), Image.LANCZOS), ((SIZE - inner) // 2, (SIZE - inner) // 2))
        cell.save(os.path.join(out, k + '.webp'), 'WEBP', quality=82, method=6)
        items.append([k, name])

items.sort(key=lambda x: x[1])
js = ('/* Отдельные иконки продуктов и блюд (web/icons/food/<ключ>.webp). Собирается tools/make_food_icons.py — руками не править.\n'
      '   [ключ, название]: по названию foodicons.js строит правило, какому тексту какая иконка. */\n'
      '(function (root) { var L = ' + json.dumps(items, ensure_ascii=False) + ';\n'
      "  if (typeof module !== 'undefined') module.exports = L; else root.MFoodList = L; })(this);\n")
open(os.path.join(root, 'web', 'foodlist.js'), 'w', encoding='utf-8', newline='\n').write(js)
print(len(items), 'иконок')

if sheet:
    cols = 20; rows = (len(items) + cols - 1) // cols; c = 64
    sh = Image.new('RGBA', (cols * c, rows * c), (247, 244, 233, 255))
    for i, (k, _) in enumerate(items):
        sh.alpha_composite(Image.open(os.path.join(out, k + '.webp')).resize((c, c)), ((i % cols) * c, (i // cols) * c))
    sh.save(sheet)
