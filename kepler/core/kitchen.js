// Кухня-конструктор (составная мебель, тип 'kitchen'). Чистый модуль без DOM;
// регистрируется в реестре TYPES (core/composite.js), сам от него не зависит.
//
// comp = {
//   type: 'kitchen',
//   shape: 'line' | 'L' | 'U',   // линейная, Г-образная, П-образная
//   len: { left, main, right },  // мм, наружные длины сторон по стене (вместе
//                                // с угловым шкафом); используются стороны формы
//   depth: 600,                  // мм, глубина нижних корпусов (столешницы)
//   mirror: false,               // Г: угол справа (true) или слева (false)
//   baseW: 600,                  // мм, ширина шкафов автозаполнения
//   upper: true,                 // верхние шкафы (пунктиром)
//   items: [{ type, side, x, w }], // элементы: мойка, плита, …, вытяжка;
//                                // x — мм от начала стороны (по её ходу)
// }
// Стороны формы идут цепочкой (как модули дивана): у каждой стороны своя
// рамка — начало O на линии стены, u — ход стороны, v = u, повёрнутый на +90°,
// — «вперёд» (от стены). Спинка кухни — к стене (−Y в локальных осях у
// основной стороны). Линейная: [main] →; Г: [left ↑, main →] или
// [main →, right ↓] (зеркально); П: [left ↑, main →, right ↓]. Угол — квадрат
// depth×depth на стыке сторон (угловой шкаф), он входит в длины обеих сторон,
// элементы стоят только на «рабочих» участках сторон между углами.
// Свободные места рабочих участков заполняются шкафами baseW, остаток
// ≥ 300 мм — узким шкафом, меньше — заглушкой. Пересечений нет по построению.

export const KITCHEN_KINDS = ['kitchen-row', 'kitchen-corner', 'kitchen-u'];
export const KITCHEN_SHAPES = Object.freeze({ line: 'Линейная', L: 'Г-образная', U: 'П-образная' });
export const KITCHEN_SIDES = Object.freeze({ left: 'Левая', main: 'Основная', right: 'Правая' });
export const KITCHEN_UPPER_DEPTH = 350; // мм, глубина верхних шкафов
export const KITCHEN_HOOD_DEPTH = 500; // мм, глубина вытяжки
export const KITCHEN_SNAP = 50; // мм, шаг перемещения элементов
const MIN_RUN = 300; // мм, минимальный рабочий участок стороны
const MAX_LEN = 12000;

// Элементы, включаемые галочками (порядок — как в панели; «Верхние шкафы» —
// отдельный флаг comp.upper). rows: какие ряды элемент занимает — нижний
// (base) и/или верхний (upper): колонны (холодильник, духовой шкаф-пенал)
// высокие и занимают оба, вытяжка — только верхний.
export const KITCHEN_ELEMENTS = Object.freeze({
  sink: { title: 'Мойка', w: 800, min: 800, max: 1200, rows: ['base'] },
  hob: { title: 'Плита', w: 600, min: 450, max: 900, rows: ['base'] },
  'oven-column': { title: 'Духовой шкаф', w: 600, min: 600, max: 600, rows: ['base', 'upper'] },
  fridge: { title: 'Холодильник', w: 600, min: 600, max: 700, rows: ['base', 'upper'] },
  dishwasher: { title: 'Посудомойка', w: 600, min: 450, max: 600, rows: ['base'] },
  hood: { title: 'Вытяжка', w: 600, min: 600, max: 900, rows: ['upper'] },
});

// Названия всех видов частей (для панели, IFC, DXF).
export const KITCHEN_PARTS = Object.freeze({
  base: 'Нижний шкаф', corner: 'Угловой шкаф', filler: 'Заглушка',
  'wall-cabinet': 'Верхний шкаф', 'wall-corner': 'Верхний угловой шкаф',
  sink: 'Мойка', hob: 'Варочная панель', 'oven-column': 'Духовой шкаф (колонна)',
  fridge: 'Холодильник', dishwasher: 'Посудомойка', hood: 'Вытяжка',
});
// Высота частей в IFC, мм.
export const KITCHEN_PART_HEIGHT = Object.freeze({
  base: 900, corner: 900, filler: 900, sink: 900, hob: 900, dishwasher: 900,
  'oven-column': 2100, fridge: 2000, 'wall-cabinet': 700, 'wall-corner': 700, hood: 400,
});

const num = (v, def, min, max) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : def;
};
const r3 = (v) => Math.round(v * 1000) / 1000 + 0; // + 0: без «-0»
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]]; // 0 →, 1 ↓, 2 ←, 3 ↑ (ось Y вниз)
const SHAPE_BY_KIND = { 'kitchen-row': 'line', 'kitchen-corner': 'L', 'kitchen-u': 'U' };

// Стороны формы по ходу цепочки и направление первой.
export function shapeSides(shape, mirror) {
  if (shape === 'U') return { sides: ['left', 'main', 'right'], dir: 3 };
  if (shape === 'L') return mirror ? { sides: ['main', 'right'], dir: 0 } : { sides: ['left', 'main'], dir: 3 };
  return { sides: ['main'], dir: 0 };
}

const rowsOf = (type) => KITCHEN_ELEMENTS[type]?.rows || [];

// Рамки сторон в «сырых» осях (первая сторона начинается в (0, 0)):
// { side, k, ox, oy, ux, uy, vx, vy, dir, len, start, end, cs, ce } —
// start…end — рабочий участок, cs/ce — есть ли угол в начале/конце.
export function kitchenFrames(comp) {
  const { sides, dir: dir0 } = shapeSides(comp.shape, comp.mirror);
  const D = comp.depth;
  let ox = 0; let oy = 0;
  return sides.map((side, k) => {
    const dir = (dir0 + k) % 4;
    const [ux, uy] = DIRS[dir];
    const len = comp.len[side];
    const cs = k > 0;
    const ce = k < sides.length - 1;
    const f = { side, k, ox, oy, ux, uy, vx: -uy, vy: ux, dir, len, start: cs ? D : 0, end: len - (ce ? D : 0), cs, ce };
    ox += ux * len; oy += uy * len;
    return f;
  });
}

// Минимальная длина стороны: углы + рабочий участок MIN_RUN.
function minLen(comp, side) {
  const f = kitchenFrames({ ...comp, len: { left: 1e4, main: 1e4, right: 1e4 } }).find((q) => q.side === side);
  return (f ? (f.cs ? 1 : 0) + (f.ce ? 1 : 0) : 0) * comp.depth + MIN_RUN;
}

// Свободные промежутки стороны в рядах rows (по умолчанию — рядах элемента
// type; сам type не мешает).
function freeSpans(frame, items, type, rows = rowsOf(type)) {
  const busy = items
    .filter((e) => e.side === frame.side && e.type !== type && rowsOf(e.type).some((r) => rows.includes(r)))
    .map((e) => [e.x, e.x + e.w])
    .sort((a, b) => a[0] - b[0]);
  const out = [];
  let a = frame.start;
  for (const [s, e] of busy) {
    if (s > a) out.push([a, Math.min(s, frame.end)]);
    a = Math.max(a, e);
  }
  if (frame.end > a) out.push([a, frame.end]);
  return out.filter(([s, e]) => e > s);
}

// Ближайшее к x допустимое положение элемента шириной w на стороне (или null).
// Возле соседа элемент «упирается» в него; если тянуть дальше — перескакивает
// на другую сторону соседа, когда там ближе.
function nearestX(frame, items, type, w, x) {
  let best = null;
  for (const [a, b] of freeSpans(frame, items, type)) {
    if (b - a < w - 1e-6) continue;
    const c = Math.min(b - w, Math.max(a, x));
    if (best === null || Math.abs(c - x) < Math.abs(best - x) - 1e-6) best = c;
  }
  return best === null ? null : r3(best);
}

// Первое свободное место (стороны — в порядке order).
function firstFree(frames, items, type, w, order) {
  for (const side of order) {
    const f = frames.find((q) => q.side === side);
    if (!f) continue;
    const span = freeSpans(f, items, type).find(([a, b]) => b - a >= w - 1e-6);
    if (span) return { side, x: r3(span[0]) };
  }
  return null;
}

const sideOrder = (frames, prefer) => [prefer, 'main', ...frames.map((f) => f.side)].filter((s, i, a) => s && a.indexOf(s) === i);

// Размещение одного элемента рядом с желаемым местом: сначала своя сторона,
// потом первое свободное место. null — нигде не помещается.
function placeElement(frames, placed, el) {
  const f = frames.find((q) => q.side === el.side);
  const x = f ? nearestX(f, placed, el.type, el.w, el.x) : null;
  if (x !== null) return { ...el, x };
  const any = firstFree(frames, placed, el.type, el.w, sideOrder(frames, el.side));
  return any ? { ...el, ...any } : null;
}

// Раскладка элементов без пересечений (по порядку списка). Не поместившиеся
// отбрасываются.
function resolveItems(comp, items) {
  const frames = kitchenFrames(comp);
  const placed = [];
  for (const el of items) {
    const p = placeElement(frames, placed, el);
    if (p) placed.push(p);
  }
  return placed;
}

function element(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const def = KITCHEN_ELEMENTS[raw.type];
  if (!def) return null;
  return {
    type: raw.type,
    side: KITCHEN_SIDES[raw.side] ? raw.side : 'main',
    x: num(raw.x, 0, -MAX_LEN, MAX_LEN),
    w: num(raw.w, def.w, def.min, def.max),
  };
}

const LEN = { left: 1800, main: 2400, right: 1800 };
const DEFAULT_ITEMS = {
  line: [['sink', 'main', 600], ['hob', 'main', 1800], ['hood', 'main', 1800]],
  L: [['sink', 'main', 1000], ['hob', 'left', 300], ['hood', 'left', 300]],
  U: [['sink', 'main', 1200], ['hob', 'left', 300], ['hood', 'left', 300], ['fridge', 'right', 1200]],
};

function defaults(kind) {
  const shape = SHAPE_BY_KIND[kind] || 'line';
  return {
    type: 'kitchen',
    shape,
    len: { ...LEN, main: shape === 'U' ? 3000 : LEN.main },
    depth: 600,
    mirror: false,
    baseW: 600,
    upper: true,
    items: DEFAULT_ITEMS[shape].map(([type, side, x]) => ({ type, side, x, w: KITCHEN_ELEMENTS[type].w })),
  };
}

function normalize(raw, kind) {
  const d = defaults(kind);
  const comp = {
    type: 'kitchen',
    shape: KITCHEN_SHAPES[raw.shape] ? raw.shape : d.shape,
    len: { ...d.len },
    depth: num(raw.depth, d.depth, 400, 900),
    mirror: Boolean(raw.mirror),
    baseW: num(raw.baseW, d.baseW, 300, 1200),
    upper: raw.upper === undefined ? d.upper : Boolean(raw.upper),
    items: [],
  };
  const len = raw.len && typeof raw.len === 'object' ? raw.len : {};
  for (const side of Object.keys(LEN)) comp.len[side] = num(len[side], d.len[side], minLen(comp, side), MAX_LEN);
  const seen = new Set();
  const items = (Array.isArray(raw.items) ? raw.items : []).map(element)
    .filter((e) => e && !seen.has(e.type) && seen.add(e.type));
  comp.items = resolveItems(comp, items);
  return comp;
}

// Заполнение промежутка [a, b] шкафами шириной bw: остаток ≥ 300 —
// узкий шкаф, меньше — заглушка (у конца промежутка).
function fillSpan(a, b, bw, kind, minRest = MIN_RUN, restKind = 'filler') {
  const out = [];
  const g = b - a;
  if (g < 0.5) return out;
  const n = Math.floor((g + 1e-6) / bw);
  let x = a;
  for (let i = 0; i < n; i += 1) { out.push({ kind, x, w: bw }); x += bw; }
  const rest = b - x;
  if (rest >= minRest - 1e-6) out.push({ kind, x, w: rest });
  else if (rest > 0.5 && restKind) out.push({ kind: restKind, x, w: rest });
  return out;
}

// Раскладка частей в «сырых» осях и габарит.
function kitchenLayout(comp) {
  const frames = kitchenFrames(comp);
  const D = comp.depth;
  const Du = Math.min(KITCHEN_UPPER_DEPTH, D);
  const parts = [];
  const push = (f, kind, x, w, h, layer, extra = {}) => parts.push({
    kind: `kitchen:${kind}`,
    x: f.ox + f.ux * (x + w / 2) + f.vx * (h / 2),
    y: f.oy + f.uy * (x + w / 2) + f.vy * (h / 2),
    w, h, rotation: f.dir * 90, side: f.side, at: x, layer, ...extra,
  });
  for (const f of frames) {
    const mine = comp.items.filter((e) => e.side === f.side);
    // Нижний ряд: элементы и шкафы в свободных местах.
    for (const e of mine) if (rowsOf(e.type).includes('base')) push(f, e.type, e.x, e.w, D, 'base', { element: e.type });
    for (const [a, b] of freeSpans(f, comp.items, null, ['base'])) {
      for (const p of fillSpan(a, b, comp.baseW, 'base')) push(f, p.kind, p.x, p.w, D, 'base');
    }
    if (f.ce) push(f, 'corner', f.len - D, D, D, 'base');
    // Верхний ряд: вытяжка, верхние шкафы (кроме мест колонн и вытяжки).
    const hood = mine.find((e) => e.type === 'hood');
    if (hood) push(f, 'hood', hood.x, hood.w, Math.min(KITCHEN_HOOD_DEPTH, D), 'upper', { element: 'hood' });
    if (comp.upper) {
      const uf = { ...f, start: f.cs ? Du : 0, end: f.len - (f.ce ? Du : 0) };
      for (const [a, b] of freeSpans(uf, comp.items, null, ['upper'])) {
        for (const p of fillSpan(a, b, comp.baseW, 'wall-cabinet', 150, null)) push(f, p.kind, p.x, p.w, Du, 'upper');
      }
      if (f.ce) push(f, 'wall-corner', f.len - Du, Du, Du, 'upper');
    }
  }
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  for (const p of parts) {
    const r = rectOf(p);
    minX = Math.min(minX, r.x); minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w); maxY = Math.max(maxY, r.y + r.h);
  }
  return { frames, parts, box: { x: minX, y: minY, w: maxX - minX, h: maxY - minY } };
}

function rectOf(p) {
  const odd = Math.round(p.rotation / 90) % 2 !== 0;
  const w = odd ? p.h : p.w;
  const h = odd ? p.w : p.h;
  return { x: p.x - w / 2, y: p.y - h / 2, w, h };
}

// Раскладка, сдвинутая так, что центр габарита — в (0, 0) (локальные оси
// предмета). cx, cy — сдвиг из «сырых» осей.
function centeredLayout(comp) {
  const l = kitchenLayout(comp);
  const cx = l.box.x + l.box.w / 2;
  const cy = l.box.y + l.box.h / 2;
  return {
    cx, cy, frames: l.frames,
    parts: l.parts.map((p) => ({ ...p, x: r3(p.x - cx), y: r3(p.y - cy) })),
    w: r3(l.box.w), h: r3(l.box.h),
  };
}

const rot = (x, y, deg) => {
  const r = (deg * Math.PI) / 180;
  const c = Math.round(Math.cos(r) * 1e9) / 1e9;
  const s = Math.round(Math.sin(r) * 1e9) / 1e9;
  return { x: x * c - y * s, y: x * s + y * c };
};

export const kitchen = {
  kinds: KITCHEN_KINDS,
  fixedSize: true, // размер предмета — габарит частей; длины — в панели
  defaults,
  normalize,
  parts(item, comp) {
    return centeredLayout(comp).parts;
  },
  fit(item, comp) {
    const c = centeredLayout(comp);
    item.w = c.w;
    item.h = c.h;
  },
};

function hoodOverHob(comp) {
  const hood = comp.items.find((e) => e.type === 'hood');
  const hob = comp.items.find((e) => e.type === 'hob');
  return Boolean(hood && hob && hood.side === hob.side && hood.x < hob.x + hob.w && hood.x + hood.w > hob.x);
}

const compOf = (item) => (item?.comp?.type === 'kitchen' && KITCHEN_KINDS.includes(item.kind) ? normalize(item.comp, item.kind) : null);

// Правка кухни без изменения предмета. edit:
//   { op: 'shape', value: 'line'|'L'|'U' }; { op: 'mirror', value };
//   { op: 'length', side, value }; { op: 'depth', value }; { op: 'baseW', value };
//   { op: 'upper', value };  { op: 'toggle', type, on };
//   { op: 'move', type, side?, x };  { op: 'width', type, value }.
// Возвращает { comp, x, y, w, h } или null (элементы не помещаются, неверная
// правка). Точка начала основной стороны у стены остаётся на месте.
export function editKitchen(item, edit) {
  const old = compOf(item);
  if (!old) return null;
  const comp = { ...old, len: { ...old.len }, items: old.items.map((e) => ({ ...e })) };
  const frames = () => kitchenFrames(comp);
  const find = (type) => comp.items.find((e) => e.type === type);
  let strict = true; // отказ, если какой-то элемент не поместился
  switch (edit?.op) {
    case 'shape':
      if (!KITCHEN_SHAPES[edit.value]) return null;
      comp.shape = edit.value;
      strict = false; // лишние элементы снимаются (UI сообщает какие)
      break;
    case 'mirror': {
      // Г: зеркальное отражение всей кухни (левая сторона ↔ правая, отсчёт
      // по ходу стороны переворачивается). У прочих форм — только флаг.
      const value = Boolean(edit.value);
      if (comp.shape === 'L' && value !== comp.mirror) {
        const swap = { left: 'right', right: 'left', main: 'main' };
        comp.len = { left: old.len.right, main: old.len.main, right: old.len.left };
        comp.items = comp.items.map((e) => {
          const side = swap[e.side];
          return { ...e, side, x: comp.len[side] - e.x - e.w };
        });
      }
      comp.mirror = value;
      break;
    }
    case 'length':
      if (!KITCHEN_SIDES[edit.side]) return null;
      comp.len[edit.side] = num(edit.value, comp.len[edit.side], minLen(comp, edit.side), MAX_LEN);
      break;
    case 'depth':
      comp.depth = num(edit.value, comp.depth, 400, 900);
      for (const s of Object.keys(comp.len)) comp.len[s] = Math.max(comp.len[s], minLen(comp, s));
      break;
    case 'baseW':
      comp.baseW = num(edit.value, comp.baseW, 300, 1200);
      break;
    case 'upper':
      comp.upper = Boolean(edit.value);
      break;
    case 'toggle': {
      const def = KITCHEN_ELEMENTS[edit.type];
      if (!def) return null;
      if (!edit.on) { comp.items = comp.items.filter((e) => e.type !== edit.type); break; }
      if (find(edit.type)) return null;
      const others = comp.items;
      let spot = null;
      // Вытяжка — над плитой, посудомойка — рядом с мойкой; иначе первое
      // свободное место (сначала основная сторона).
      const near = edit.type === 'hood' ? find('hob') : edit.type === 'dishwasher' ? find('sink') : null;
      if (near) {
        const f = frames().find((q) => q.side === near.side);
        const want = edit.type === 'hood' ? near.x + (near.w - def.w) / 2 : near.x + near.w;
        const x = f && nearestX(f, others, edit.type, def.w, want);
        if (x !== null && x !== undefined) spot = { side: near.side, x };
      }
      spot = spot || firstFree(frames(), others, edit.type, def.w, sideOrder(frames(), 'main'));
      if (!spot) return null;
      comp.items = [...others, { type: edit.type, ...spot, w: def.w }];
      break;
    }
    case 'move': {
      const el = find(edit.type);
      if (!el) return null;
      const side = edit.side || el.side;
      const f = frames().find((q) => q.side === side);
      if (!f) return null;
      const want = Number(edit.x);
      if (!Number.isFinite(want)) return null;
      // Вытяжка над плитой едет вместе с ней.
      const hood = edit.type === 'hob' ? find('hood') : null;
      const follow = hood && hood.side === el.side && hood.x < el.x + el.w && hood.x + hood.w > el.x;
      const others = comp.items.filter((e) => e !== el && !(follow && e === hood));
      const x = nearestX(f, others, el.type, el.w, want);
      if (x === null) return null;
      const moved = { ...el, side, x };
      const next = [...others, moved];
      if (follow) {
        const hx = nearestX(f, next, 'hood', hood.w, x + hood.x - el.x);
        if (hx !== null) next.push({ ...hood, side, x: hx });
      }
      comp.items = next;
      break;
    }
    case 'width': {
      const el = find(edit.type);
      if (!el) return null;
      const def = KITCHEN_ELEMENTS[el.type];
      const w = num(edit.value, el.w, def.min, def.max);
      const others = comp.items.filter((e) => e !== el);
      const f = frames().find((q) => q.side === el.side);
      const x = f && nearestX(f, others, el.type, w, el.x);
      if (x === null || x === undefined) return null;
      comp.items = [...others, { ...el, w, x }];
      break;
    }
    default:
      return null;
  }
  const next = normalize(comp, item.kind);
  if (strict && next.items.length < comp.items.length) return null;
  // Вытяжка была над плитой, а после правки (смена формы, длины) оторвалась —
  // возвращаем её к плите, если там есть место.
  if (['shape', 'length', 'depth'].includes(edit.op) && hoodOverHob(old) && !hoodOverHob(next)) {
    const hob = next.items.find((e) => e.type === 'hob');
    const i = next.items.findIndex((e) => e.type === 'hood');
    const f = hob && i >= 0 && kitchenFrames(next).find((q) => q.side === hob.side);
    const hood = next.items[i];
    const hx = f ? nearestX(f, next.items.filter((e) => e !== hood), 'hood', hood.w, hob.x + (hob.w - hood.w) / 2) : null;
    if (hx !== null) next.items[i] = { ...hood, side: hob.side, x: hx };
  }
  // Якорь — начало основной стороны у стены.
  const anchor = (c) => {
    const l = centeredLayout(c);
    const f = l.frames.find((q) => q.side === 'main');
    return { x: f.ox - l.cx, y: f.oy - l.cy, w: l.w, h: l.h };
  };
  if (edit.op === 'mirror') { const c = centeredLayout(next); return { comp: next, x: item.x, y: item.y, w: c.w, h: c.h }; }
  const a = anchor(old);
  const b = anchor(next);
  const d = rot(a.x - b.x, a.y - b.y, item.rotation || 0);
  return { comp: next, x: r3(item.x + d.x), y: r3(item.y + d.y), w: b.w, h: b.h };
}

// Сторона и положение вдоль неё для точки (в осях дома): ближайшая к точке
// сторона кухни. { side, t } — t, мм от начала стороны. null — не кухня.
export function kitchenProject(item, px, py) {
  const comp = compOf(item);
  if (!comp) return null;
  const l = centeredLayout(comp);
  const q = rot(px - item.x, py - item.y, -(item.rotation || 0));
  const x = q.x + l.cx;
  const y = q.y + l.cy;
  let best = null;
  for (const f of l.frames) {
    const t = (x - f.ox) * f.ux + (y - f.oy) * f.uy;
    const s = (x - f.ox) * f.vx + (y - f.oy) * f.vy;
    const dt = Math.max(f.start - t, 0, t - f.end);
    const ds = Math.max(-s, 0, s - comp.depth);
    const dist = Math.hypot(dt, ds);
    if (!best || dist < best.dist - 1e-6) best = { side: f.side, t: r3(t), dist };
  }
  return best && { side: best.side, t: best.t };
}

// Элемент кухни под точкой (в осях дома): { type, side, x } или null.
// Нижний ряд важнее вытяжки (она над плитой).
export function kitchenElementAt(item, px, py) {
  const comp = compOf(item);
  if (!comp) return null;
  const q = rot(px - item.x, py - item.y, -(item.rotation || 0));
  const parts = centeredLayout(comp).parts.filter((p) => p.element);
  const inside = (p) => { const r = rectOf(p); return q.x >= r.x && q.x <= r.x + r.w && q.y >= r.y && q.y <= r.y + r.h; };
  const hit = parts.find((p) => p.layer === 'base' && inside(p)) || parts.find((p) => p.layer === 'upper' && inside(p));
  if (!hit) return null;
  const el = comp.items.find((e) => e.type === hit.element);
  return el ? { type: el.type, side: el.side, x: el.x } : null;
}

// Ручки элементов выделенной кухни (в осях дома): середина передней кромки
// нижних элементов, у вытяжки — ближе к стене (не налезает на ручку плиты).
export function kitchenHandles(item) {
  const comp = compOf(item);
  if (!comp) return [];
  const l = centeredLayout(comp);
  const deg = item.rotation || 0;
  return comp.items.map((e) => {
    const f = l.frames.find((q) => q.side === e.side);
    const s = e.type === 'hood' ? comp.depth * 0.25 : comp.depth;
    const x = f.ox + f.ux * (e.x + e.w / 2) + f.vx * s - l.cx;
    const y = f.oy + f.uy * (e.x + e.w / 2) + f.vy * s - l.cy;
    const p = rot(x, y, deg);
    const u = rot(f.ux, f.uy, deg);
    return { type: e.type, side: e.side, x: r3(item.x + p.x), y: r3(item.y + p.y), ux: r3(u.x), uy: r3(u.y) };
  });
}
