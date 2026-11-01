// Шаблоны домов для быстрого старта. Чистый модуль.
//
// Комнаты стоят рядами и стыкуются с зазором в толщину перегородки — так
// рождаются общие стены. Двери ставятся посередине общей стены двух
// комнат (door), наружные двери и окна — на наружные стороны (opening).
// Мебели нет (кроме лестничного марша) — её добавляют «+» по желанию.

import { DEFAULT_PARTITION } from './catalog.js';
import { createItem, createLevel, createOpening, createProject, createRoom } from './model.js';

const GAP = DEFAULT_PARTITION;

// Ряд комнат слева направо от x0 на отметке y. items: [{ type, w, h?, name? }].
function row(level, y, h, items, x0 = 0) {
  let x = x0;
  return items.map((it) => {
    const room = createRoom(it.type, x, y, it.w, it.h ?? h);
    if (it.name) room.name = it.name;
    level.rooms.push(room);
    x += it.w + GAP;
    return room;
  });
}

// Дверь из комнаты a в состыкованную b — посередине общей стены;
// открывается внутрь a (двери из коридора и холла — внутрь комнат).
export function door(level, a, b, width = 800) {
  let side;
  let from;
  let to;
  if (Math.abs(b.x - (a.x + a.w + GAP)) < 1 || Math.abs(a.x - (b.x + b.w + GAP)) < 1) {
    side = b.x > a.x ? 1 : 3;
    from = Math.max(a.y, b.y);
    to = Math.min(a.y + a.h, b.y + b.h);
  } else if (Math.abs(b.y - (a.y + a.h + GAP)) < 1 || Math.abs(a.y - (b.y + b.h + GAP)) < 1) {
    side = b.y > a.y ? 2 : 0;
    from = Math.max(a.x, b.x);
    to = Math.min(a.x + a.w, b.x + b.w);
  } else {
    throw new Error(`Шаблон: «${a.name}» и «${b.name}» не стыкуются`);
  }
  if (to - from < width + 200) throw new Error(`Шаблон: общая стена «${a.name}»/«${b.name}» коротка для двери`);
  const center = (from + to) / 2;
  const offset = side === 1 || side === 3 ? center - a.y : center - a.x;
  level.openings.push(createOpening('door', a.id, side, offset, width));
}

// Наружная дверь или окно на стороне комнаты; at — доля длины стороны.
function opening(level, kind, room, side, at = 0.5, width = kind === 'door' ? 900 : 1500) {
  const len = side === 0 || side === 2 ? room.w : room.h;
  level.openings.push(createOpening(kind, room.id, side, Math.round(len * at), width));
}

function stairsFlight(level, stairs) {
  level.items.push(createItem('stairs', stairs.x + stairs.w / 2, stairs.y + stairs.h / 2, 1000, 3000));
}

function compact() {
  const p = createProject('Компактный дом · 2 спальни');
  const L = p.levels[0];
  const [living, kitchen] = row(L, 0, 4200, [{ type: 'living', w: 5000 }, { type: 'kitchen', w: 3400 }]);
  const [corridor] = row(L, 4300, 1500, [{ type: 'corridor', w: 8500 }]);
  const [bed1, bath, bed2] = row(L, 5900, 3500, [
    { type: 'bedroom', w: 3800, name: 'Спальня 1' }, { type: 'bathroom', w: 1700 }, { type: 'bedroom', w: 2800, name: 'Спальня 2' },
  ]);
  for (const r of [living, kitchen, bed1, bath, bed2]) door(L, r, corridor);
  opening(L, 'door', corridor, 1); // вход
  opening(L, 'window', living, 0); opening(L, 'window', living, 3);
  opening(L, 'window', kitchen, 0); opening(L, 'window', kitchen, 1);
  opening(L, 'window', bed1, 2); opening(L, 'window', bed1, 3);
  opening(L, 'window', bath, 2, 0.5, 600);
  opening(L, 'window', bed2, 2); opening(L, 'window', bed2, 1);
  return p;
}

function oneStorey() {
  const p = createProject('Одноэтажный дом · 3 спальни');
  const L = p.levels[0];
  const [master, living, kitchen] = row(L, 0, 4500, [
    { type: 'master-bedroom', w: 4200 }, { type: 'living', w: 5600 }, { type: 'kitchen', w: 3600 },
  ]);
  const [corridor] = row(L, 4600, 1400, [{ type: 'corridor', w: 13600 }]);
  const [bedA, bath, hall, bedB] = row(L, 6100, 3600, [
    { type: 'bedroom', w: 3500, name: 'Спальня 1' }, { type: 'bathroom', w: 2400 },
    { type: 'hall', w: 2600 }, { type: 'bedroom', w: 4800, name: 'Спальня 2' },
  ]);
  for (const r of [master, living, kitchen, bedA, bath, hall, bedB]) door(L, r, corridor);
  opening(L, 'door', hall, 2); // вход
  opening(L, 'window', master, 0); opening(L, 'window', master, 3);
  opening(L, 'window', living, 0, 0.3); opening(L, 'window', living, 0, 0.7);
  opening(L, 'window', kitchen, 0); opening(L, 'window', kitchen, 1);
  opening(L, 'window', bedA, 2); opening(L, 'window', bedA, 3);
  opening(L, 'window', bath, 2, 0.5, 600);
  opening(L, 'window', bedB, 2); opening(L, 'window', bedB, 1);
  return p;
}

function twoStorey() {
  const p = createProject('Двухэтажный дом · 4 спальни');
  const L1 = p.levels[0];
  const [living, kitchen] = row(L1, 0, 4500, [{ type: 'living', w: 5600 }, { type: 'kitchen', w: 3700 }]);
  const [hall, stairs1, study] = row(L1, 4600, 3200, [
    { type: 'hall', w: 3000 }, { type: 'stairs-room', w: 2400 }, { type: 'cabinet', w: 3800, name: 'Кабинет / гостевая' },
  ]);
  door(L1, living, hall); door(L1, living, kitchen); door(L1, stairs1, hall);
  door(L1, study, stairs1); door(L1, study, kitchen);
  opening(L1, 'door', hall, 3); // вход
  opening(L1, 'window', living, 0, 0.3); opening(L1, 'window', living, 0, 0.7);
  opening(L1, 'window', kitchen, 0); opening(L1, 'window', kitchen, 1);
  opening(L1, 'window', study, 2); opening(L1, 'window', study, 1);
  stairsFlight(L1, stairs1);

  const L2 = createLevel('2 этаж', 3000, 3000, 'L2');
  p.levels.push(L2);
  const [master, bedR] = row(L2, 0, 4500, [{ type: 'master-bedroom', w: 5600 }, { type: 'bedroom', w: 3700, name: 'Спальня 2' }]);
  const [bedL, stairs2, hall2, bath2] = row(L2, 4600, 3200, [
    { type: 'bedroom', w: 3000, name: 'Спальня 3' }, { type: 'stairs-room', w: 2400 },
    { type: 'corridor', w: 1300, name: 'Холл 2 этажа' }, { type: 'bathroom', w: 2400 },
  ]);
  door(L2, master, stairs2); door(L2, bedL, stairs2); door(L2, stairs2, hall2);
  door(L2, bedR, hall2); door(L2, bath2, hall2);
  opening(L2, 'window', master, 0, 0.3); opening(L2, 'window', master, 0, 0.7); opening(L2, 'window', master, 3);
  opening(L2, 'window', bedR, 0); opening(L2, 'window', bedR, 1);
  opening(L2, 'window', bedL, 2); opening(L2, 'window', bedL, 3);
  opening(L2, 'window', bath2, 2, 0.5, 600);
  stairsFlight(L2, stairs2);
  return p;
}

export const TEMPLATES = [
  { id: 'compact', title: 'Компактный · 2 спальни', note: '≈ 8,5 × 9,4 м, один этаж', build: compact },
  { id: 'one-storey', title: 'Одноэтажный · 3 спальни', note: '≈ 13,6 × 9,7 м, мастер-спальня', build: oneStorey },
  { id: 'two-storey', title: 'Двухэтажный · 4 спальни', note: '≈ 9,4 × 7,8 м, лестница, кабинет', build: twoStorey },
];

export function buildTemplate(id) {
  const t = TEMPLATES.find((x) => x.id === id);
  if (!t) throw new Error(`Нет шаблона ${id}`);
  return t.build();
}
