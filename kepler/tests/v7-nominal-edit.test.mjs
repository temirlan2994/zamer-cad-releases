// Срез 5 этапа 2 (docs/v7-stage2-plan.md): размеры в панели «Свойства» правят
// НОМИНАЛ съеденной комнаты (liftForEdit), а площадь, ТЭП и мебель берут
// видимую форму (комната моста = результат carve v7).
import test from 'node:test';
import assert from 'node:assert/strict';

import { createItem, createProject, createRoom } from '../core/model.js';
import { roomShapeArea } from '../core/room-shape.js';
import { roomNetAreaM2 } from '../core/rooms.js';
import { tepReport } from '../core/tep.js';
import { arrangeRoom, itemRect } from '../core/furnish.js';
import { deriveWalls } from '../core/walls.js';
import { liftForEdit, nominalShape, reconcileEats } from '../core/v7/eat-bridge.js';

const shape = (r) => ({ x: r.x, y: r.y, w: r.w, h: r.h, outline: r.outline || null });

function pair(aw = 4000) {
  const p = createProject('срез 5');
  const a = createRoom('living', 0, 0, aw, 4000);
  const b = createRoom('bedroom', 3000, 3000, 3000, 3000);
  a.name = 'Нижняя'; b.name = 'Верхняя';
  p.rooms.push(a, b);
  reconcileEats(p, { touched: [b.id] });
  return { p, a, b };
}

// Правка ширины так, как её делает панель (ui/props.js applySize).
function panelResize(p, room, w, h) {
  const edit = liftForEdit(p, room.id);
  room.w = w; room.h = h;
  return reconcileEats(p, { touched: [room.id], under: edit.under, prev: edit.prev });
}

test('панель показывает номинал съеденной, площадь — видимой', () => {
  const { p, a } = pair();
  assert.ok(a.outline, 'нижняя съедена (Г)');
  const nom = nominalShape(a);
  assert.deepEqual([nom.x, nom.y, nom.w, nom.h], [0, 0, 4000, 4000]);
  assert.ok(roomNetAreaM2(p, a) < 16 - 0.5, 'площадь — по видимой форме');
});

test('правка ширины в панели меняет номинал, видимая = построение с нуля', () => {
  const { p, a, b } = pair();
  const edit = liftForEdit(p, a.id);
  assert.deepEqual(edit.nominal, { x: 0, y: 0, w: 4000, h: 4000 });
  a.w = 5000; a.h = 4000;
  reconcileEats(p, { touched: [a.id], under: edit.under, prev: edit.prev });
  assert.deepEqual(p.rooms.map((r) => r.id), [a.id, b.id], 'верхняя по-прежнему выше');
  assert.deepEqual(a.eatBase.base, { x: 0, y: 0, w: 5000, h: 4000 }, 'номинал вырос');
  const ref = pair(5000);
  assert.deepEqual(shape(a), shape(ref.a), 'видимая — как если бы сразу была 5000');
  assert.deepEqual(shape(b), shape(ref.b));
  // Повторная правка — от номинала, а не от видимой (раньше видимая
  // становилась номиналом и Г терялась).
  panelResize(p, a, 4000, 4000);
  const back = pair();
  assert.deepEqual(shape(a), shape(back.a));
  assert.deepEqual(a.eatBase.base, { x: 0, y: 0, w: 4000, h: 4000 });
});

test('уменьшили съеденную так, что ушла из-под верхней — снова целая', () => {
  const { p, a } = pair();
  panelResize(p, a, 2500, 4000);
  assert.equal(a.eatBase, undefined);
  assert.deepEqual(shape(a), { x: 0, y: 0, w: 2500, h: 4000, outline: null });
});

test('ТЭП: общая площадь — по видимым формам', () => {
  const { p, a, b } = pair();
  const total = tepReport(p).total;
  const visible = roomNetAreaM2(p, a) + roomNetAreaM2(p, b);
  assert.ok(Math.abs(total - visible) < 0.01, `ТЭП ${total} = видимая ${visible}`);
  assert.ok(total < (16e6 + 9e6) / 1e6 - 1, 'без двойного счёта перекрытия');
  assert.ok(roomShapeArea(a) < 16e6);
});

test('авторасстановка — по видимой форме: мебель не уходит под верхнюю', () => {
  const { p, a, b } = pair();
  p.items.push(createItem('sofa', 1500, 1500, 2200, 950), createItem('wardrobe', 1000, 2500, 1200, 600));
  arrangeRoom(p, a, deriveWalls(p));
  for (const item of p.items) {
    const r = itemRect(item);
    const inB = Math.min(r.x + r.w, b.x + b.w) - Math.max(r.x, b.x) > 1 &&
      Math.min(r.y + r.h, b.y + b.h) - Math.max(r.y, b.y) > 1;
    assert.ok(!inB, `${item.kind} не под «Верхней»`);
  }
});
