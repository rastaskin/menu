const test = require('node:test'), assert = require('node:assert');
const MD = require('../web/md.js'), M = require('../web/model.js');

test('markdown: блоки и строчная разметка', () => {
  const h = MD.html('# Плов\n\nПродукты:\n- **рис** — 300 г\n- морковь\n\n1. Обжарить\n2. Тушить *40 мин*\n\n> совет\n\n---\n`код` и ~~старое~~ [видео](https://example.com/a?b=1&c=2)\nвторая строка');
  assert.match(h, /^<h4>Плов<\/h4>/);
  assert.match(h, /<ul><li><b>рис<\/b> — 300 г<\/li><li>морковь<\/li><\/ul>/);
  assert.match(h, /<ol><li>Обжарить<\/li><li>Тушить <i>40 мин<\/i><\/li><\/ol>/);
  assert.match(h, /<blockquote><p>совет<\/p><\/blockquote><hr>/);
  assert.match(h, /<code>код<\/code> и <s>старое<\/s> <a href="https:\/\/example\.com\/a\?b=1&amp;c=2" target="_blank" rel="noopener noreferrer">видео<\/a><br>вторая строка/);
});

test('markdown: чужой HTML и опасные ссылки остаются текстом', () => {
  const h = MD.html('<script>alert(1)</script>\n<img src=x onerror=alert(1)>\n[жми](javascript:alert(1))\n[x](https://a.b/" onmouseover="alert(1))\n```\n<b>не жирный</b>\n```');
  assert.doesNotMatch(h, /<script|<img|href="javascript|onmouseover="/);
  assert.match(h, /&lt;script&gt;/);
  assert.match(h, /<pre><code>&lt;b&gt;не жирный&lt;\/b&gt;<\/code><\/pre>/);
  assert.equal(MD.html(''), '');
});

test('markdown: превью без разметки', () => {
  assert.equal(MD.plain('## Шаги\n1. **Обжарить** лук\n- [рис](https://x.y)'), 'Шаги\nОбжарить лук\nрис');
});

test('продукты рецепта читаются и из Markdown', () => {
  const md = '## Продукты\n* **Рис** — 300 г\n1. Морковь — 2 шт\n- `соль`\n\n## Как готовить\n- Морковь нарезать';
  assert.deepEqual(M.ingredients(md).map((g) => g.name), ['Рис', 'Морковь']);
});
