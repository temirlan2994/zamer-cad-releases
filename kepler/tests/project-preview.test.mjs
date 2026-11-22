import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createProjectPreview, fallbackProjectPreview, projectPreviewHtml, projectPreviewSvg,
  safeProjectPreview,
} from '../core/project-preview.js';
import { buildTemplate } from '../core/templates.js';

test('эскиз проекта нормализует геометрию комнат для карточки', () => {
  const preview = createProjectPreview(buildTemplate('compact'));
  assert.equal(preview.v, 1);
  assert.ok(preview.rooms.length >= 5);
  assert.ok(preview.rooms.every((room) => room.x >= 0 && room.y >= 0
    && room.x + room.w <= 1000 && room.y + room.h <= 620));
  assert.match(projectPreviewSvg(preview), /^<svg[^>]+>/);
});

test('старый проект без эскиза получает безопасный заполнитель', () => {
  const fallback = fallbackProjectPreview({ rooms: 7 });
  assert.equal(fallback.rooms.length, 7);
  const svg = projectPreviewSvg({ v: 99, rooms: [{ x: '" onload="x' }], site: [] }, { rooms: 3 });
  assert.equal(svg.includes('onload'), false);
  assert.equal((svg.match(/<rect /g) || []).length, 3);
  assert.equal((projectPreviewSvg({ v: 1, rooms: [], site: [] }, { rooms: 2 }).match(/<rect /g) || []).length, 2);
});

test('растровый эскиз v2 строго проверяется и безопасно выводится как изображение', () => {
  const webp = { v: 2, image: 'data:image/webp;base64,AAAA' };
  const jpeg = { v: 2, image: 'data:image/jpeg;base64,/9j/AA==' };
  assert.deepEqual(safeProjectPreview(webp), webp);
  assert.deepEqual(safeProjectPreview(jpeg), jpeg);
  const html = projectPreviewHtml(webp);
  assert.match(html, /^<img class="project-preview-image"/);
  assert.match(html, /loading="lazy"/);
  assert.match(html, /decoding="async"/);

  assert.equal(safeProjectPreview({ ...webp, extra: 'нет' }), null, 'лишние поля запрещены');
  assert.equal(safeProjectPreview({ v: 2, image: 'data:image/png;base64,AAAA' }), null);
  assert.equal(safeProjectPreview({ v: 2, image: 'data:image/webp;base64,AAAA" onerror="x' }), null);
  assert.equal(safeProjectPreview({
    v: 2,
    image: `data:image/webp;base64,${'A'.repeat(180000)}`,
  }), null, 'общая длина data URL ограничена');
  assert.match(projectPreviewHtml({ v: 2, image: 'javascript:alert(1)' }, { rooms: 2 }), /^<svg/);
});

test('эскиз дома не смешивает координаты плана и геодезическую границу участка', () => {
  const preview = createProjectPreview({
    rooms: [{ x: 0, y: 0, w: 5000, h: 4000 }],
    site: { boundary: [{ x: 500000, y: 700000 }, { x: 510000, y: 700000 }, { x: 510000, y: 710000 }] },
  });
  assert.equal(preview.site.length, 0);
  assert.ok(preview.rooms[0].w > 600, 'дом остаётся читаемым, а не сжимается участком');
});
