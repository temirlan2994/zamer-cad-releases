// Кеш спрайтов ландшафта (ui/render-landscape-kit.js): бюджет по суммарной
// площади пикселей с LRU-вытеснением; сброс при смене темы/стиля.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// В Node нет canvas — подставляем OffscreenCanvas-заглушку (кеш создаёт холст
// при вызове, а не при импорте).
globalThis.OffscreenCanvas = class {
  constructor(w, h) { this.width = w; this.height = h; }
  getContext() { return {}; }
};

const kit = await import('../ui/render-landscape-kit.js');
const { terrainColors } = await import('../ui/terrain-render.js');

const noop = () => {};

beforeEach(() => {
  kit.clearLandscapeSprites();
  kit.setSpriteBudget(1_000_000); // 1 Мпикс — чтобы тест был быстрым
});

test('бюджет по площади: сумма пикселей не превышает лимит', () => {
  for (let i = 0; i < 200; i += 1) kit.cachedSprite(`s${i}`, 300, 300, noop); // 90 000 пикс. каждый
  const s = kit.spriteStats();
  assert.ok(s.pixels <= 1_000_000, `pixels=${s.pixels}`);
  assert.equal(s.size, 11); // 11 × 90 000 = 990 000
  assert.equal(s.pixels, s.size * 90_000);
  assert.ok(s.evicted >= 189);
});

test('много мелких спрайтов помещаются — лимит не по числу', () => {
  for (let i = 0; i < 2000; i += 1) kit.cachedSprite(`m${i}`, 20, 20, noop); // 400 пикс.
  const s = kit.spriteStats();
  assert.equal(s.size, 2000);
  assert.equal(s.pixels, 800_000);
});

test('LRU: недавно использованный спрайт не вытесняется', () => {
  const a = kit.cachedSprite('a', 500, 500, noop); // 250 000
  kit.cachedSprite('b', 500, 500, noop);
  kit.cachedSprite('c', 500, 500, noop);
  kit.cachedSprite('d', 500, 500, noop); // занято 1 000 000
  assert.equal(kit.cachedSprite('a', 500, 500, noop), a); // a — свежий
  kit.cachedSprite('e', 500, 500, noop); // вытесняет b, самый давний
  let drawn = 0;
  assert.equal(kit.cachedSprite('a', 500, 500, () => { drawn += 1; }), a);
  kit.cachedSprite('b', 500, 500, () => { drawn += 1; });
  assert.equal(drawn, 1, 'b перерисован, a взят из кеша');
  assert.ok(kit.spriteStats().pixels <= 1_000_000);
});

test('слишком большой спрайт не кешируется (null)', () => {
  assert.equal(kit.cachedSprite('huge', 1500, 100, noop), null);
  assert.equal(kit.cachedSprite('area', 1200, 1200, noop), null);
  assert.equal(kit.spriteStats().size, 0);
});

test('сброс и уменьшение бюджета', () => {
  for (let i = 0; i < 5; i += 1) kit.cachedSprite(`r${i}`, 400, 400, noop); // 5 × 160 000
  assert.equal(kit.spriteStats().pixels, 800_000);
  kit.setSpriteBudget(350_000);
  assert.equal(kit.spriteStats().size, 2);
  assert.equal(kit.spriteStats().pixels, 320_000);
  kit.clearLandscapeSprites();
  assert.deepEqual([kit.spriteStats().size, kit.spriteStats().pixels], [0, 0]);
});

test('бюджет по умолчанию — в пределах 20–100 Мпикс', () => {
  kit.setSpriteBudget(0); // 0 — вернуть бюджет по умолчанию
  const b = kit.spriteBudget();
  assert.ok(b >= 20_000_000 && b <= 100_000_000, `budget=${b}`);
});

test('рельеф: цвета горизонталей по теме холста', () => {
  const light = terrainColors('#fbfcfe');
  const dark = terrainColors('#0d1118');
  assert.notEqual(light.contour, dark.contour);
  assert.equal(terrainColors('#ffffff'), light); // печать — светлая палитра
  assert.equal(terrainColors(' rgb(13, 17, 24) '), dark);
});
