// Экспликация помещений (CSV) и минимальный PDF.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createProject, createRoom, createLevel } from '../core/model.js';
import { roomSchedule, scheduleTotals, buildRoomScheduleCsv } from '../core/schedule.js';
import { buildImagePdf, pdfTextString } from '../core/pdf.js';
import { deriveWalls } from '../core/walls.js';

function house() {
  const p = createProject('Дом; «тест»');
  p.rooms.push(
    createRoom('kitchen', 5100, 0, 3600, 3000),
    createRoom('living', 0, 0, 5000, 4200),
    createRoom('terrace', 0, 4300, 5000, 2000),
  );
  p.levels.push(createLevel('Мансарда', 3000, 2700, 'L2'));
  p.activeLevel = 'L2';
  p.rooms.push(createRoom('bedroom', 0, 0, 4000, 3500));
  p.activeLevel = 'L1';
  return p;
}

test('экспликация: номера по этажам в порядке чтения, итоги', () => {
  const s = roomSchedule(house());
  assert.deepEqual(s.map((l) => l.level.name), ['1 этаж', 'Мансарда']);
  assert.deepEqual(s[0].rows.map((r) => [r.number, r.type]), [['1.01', 'living'], ['1.02', 'kitchen'], ['1.03', 'terrace']]);
  assert.deepEqual(s[1].rows.map((r) => r.number), ['2.01']);
  const t = scheduleTotals(s);
  assert.ok(Math.abs(t.total - (21 + 10.8 + 14)) < 1e-9, `общая ${t.total}`); // терраса не входит
  assert.ok(Math.abs(t.living - (21 + 14)) < 1e-9);
  assert.ok(Math.abs(t.summer - 10) < 1e-9);
});

test('CSV для Excel: BOM, «;», десятичная запятая, кавычки', () => {
  const csv = buildRoomScheduleCsv(house());
  assert.ok(csv.startsWith('﻿'));
  const lines = csv.slice(1).trim().split('\r\n');
  assert.equal(lines[0], 'Этаж;№;Помещение;Площадь, м²;Ширина, м;Длина, м;Высота, м;Жилое;Внутри помещения');
  assert.equal(lines[1], '1 этаж;1.01;Гостиная;21,00;5,00;4,20;2,70;да;');
  assert.ok(lines.includes(';;Общая площадь;45,80;;;;;'));
  assert.ok(lines.includes(';;Летние помещения (терраса, балкон);10,00;;;;;'));
});

test('терраса — открытое помещение: без собственных стен', () => {
  const p = house();
  const terrace = p.rooms.find((r) => r.type === 'terrace');
  const own = deriveWalls(p).filter((w) => w.kind === 'own' && w.rooms[0] === terrace.id);
  assert.equal(own.length, 0);
});

test('PDF: страницы-картинки, верная таблица xref, кириллица в заголовке', () => {
  const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
  const pdf = buildImagePdf([
    { jpeg, widthPx: 10, heightPx: 7, widthMm: 420, heightMm: 297 },
    { jpeg, widthPx: 10, heightPx: 7, widthMm: 420, heightMm: 297 },
  ], { title: 'Дом' });
  const text = new TextDecoder('latin1').decode(pdf);
  assert.ok(text.startsWith('%PDF-1.4'));
  assert.ok(text.trimEnd().endsWith('%%EOF'));
  assert.match(text, /\/Count 2/);
  assert.match(text, /\/MediaBox \[0 0 1190\.55 841\.89\]/);
  assert.ok(text.includes(pdfTextString('Дом')));
  // Каждая запись xref указывает ровно на «N 0 obj».
  const xrefAt = Number(text.match(/startxref\n(\d+)/)[1]);
  const rows = text.slice(xrefAt).split('\n');
  const count = Number(rows[1].split(' ')[1]);
  for (let n = 1; n < count; n += 1) {
    const off = Number(rows[2 + n].slice(0, 10));
    assert.equal(text.slice(off, off + `${n} 0 obj`.length), `${n} 0 obj`, `объект ${n}`);
  }
  // Длина потока картинки совпадает с байтами JPEG.
  assert.match(text, /\/Length 9 >>\nstream\n/);
});

import { rectsUnionArea, buildingFootprintM2 } from '../core/rooms.js';

test('пятно застройки: объединение комнат со стенами, без террасы', () => {
  assert.equal(rectsUnionArea([{ x: 0, y: 0, w: 10, h: 10 }, { x: 5, y: 5, w: 10, h: 10 }]), 175);
  const p = house();
  // Гостиная 5.5×4.7 и кухня 4.1×3.5 (с наружными стенами по 250) стыкуются.
  const expected = (5500 * 4700 + 4100 * 3500 - 400 * 3500) / 1e6;
  assert.ok(Math.abs(buildingFootprintM2(p) - expected) < 1e-9, `${buildingFootprintM2(p)} ≠ ${expected}`);
});
