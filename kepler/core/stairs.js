// Параметрическая лестница: формы, расчёт по нормам, раскладка маршей и
// площадок, ручки правки на плане. Чистый модуль без DOM.
//
// Лестница — предмет kind 'stairs' (оси дома, центр x/y, габарит w×h,
// rotation, mirrored). Форма — stairShape. Необязательные поля (появляются
// после «Подогнать», ручек или ввода в «Свойствах»; старые проекты без них
// раскладываются по габариту, как раньше):
//   flightWidth — ширина марша, going — проступь, flights — проступей в
//   каждом марше, risers — число подъёмов (иначе — по высоте этажа),
//   gap / landingDepth — П-образная: зазор между маршами и глубина площадки,
//   landings [{ w, h }] — Г-образная и «П, 3 марша»: размеры угловых площадок.
// Габарит w×h всегда равен раскладке; если его поменяли извне (групповой
// масштаб, поле габарита) — лестница снова раскладывается по габариту.
//
// Локальные оси раскладки: x — вправо, y — вниз, начало — центр габарита.
// Подъём начинается снизу (первый марш идёт вверх по плану).

export const STAIR_SHAPES = [
  { id: 'straight', title: 'Прямая' },
  { id: 'l', title: 'Г-образная' },
  { id: 'u', title: 'П-образная' },
  { id: 'u3', title: 'П-образная, 3 марша' },
];

// Нормы (СП 54.13330, внутриквартирные лестницы) и пределы ручек.
export const STAIR_NORMS = {
  riserMin: 150, riserMax: 190, treadMin: 230, treadMax: 340,
  comfortMin: 600, comfortMax: 640, widthMin: 900, flightRisersMin: 3, flightRisersMax: 18,
};
export const STAIR_LIMITS = { widthMin: 900, widthMax: 2000, goingMin: 200, goingMax: 450, gapMax: 1000, landingExtra: 2000 };

const FLIGHTS = { straight: 1, l: 2, u: 2, u3: 3 };
const LANDINGS = { straight: 0, l: 1, u: 1, u3: 2 };
// Куда уходят ступени, когда марш вытягивают: «тянешь нижний — убывают верхние».
const COMPENSATE = { l: [1, 0], u: [1, 0], u3: [2, 2, 0] };
const DEFAULT_WIDTH = 1000;
const DEFAULT_GAP = 200;

export function stairShape(item) {
  return STAIR_SHAPES.some((shape) => shape.id === item?.stairShape) ? item.stairShape : 'straight';
}

// Конструкция в 3D (поле stairBuild, необязательное): монолит до пола,
// открытые проступи на тетивах (по умолчанию) или консольные от стены.
// На плане не влияет.
export const STAIR_BUILDS = [
  { id: 'closed', title: 'Закрытая (монолит)' },
  { id: 'open', title: 'Открытая (тетивы)' },
  { id: 'cantilever', title: 'Консольная' },
];

export function stairBuild(item) {
  return STAIR_BUILDS.some((b) => b.id === item?.stairBuild) ? item.stairBuild : 'open';
}

// Готовые стили из библиотеки. Геометрия лестницы остаётся параметрической,
// а эти поля отвечают за назначение и внешний вид в 3D. Поля необязательные:
// старые проекты выглядят как прежняя интерьерная деревянная лестница.
export const STAIR_ENVIRONMENTS = [
  { id: 'interior', title: 'Интерьерная' },
  { id: 'exterior', title: 'Наружная' },
];

export const STAIR_MATERIALS = [
  { id: 'wood', title: 'Дерево' },
  { id: 'concrete', title: 'Бетон' },
  { id: 'metal', title: 'Металл' },
];

export const STAIR_RAILINGS = [
  { id: 'none', title: 'Без ограждения' },
  { id: 'wood', title: 'Деревянные' },
  { id: 'metal', title: 'Металлические' },
  { id: 'glass', title: 'Стеклянные' },
];

export const STAIR_STYLE_PRESETS = [
  { id: 'interior-wood', title: 'Деревянная открытая', environment: 'interior', material: 'wood', railing: 'wood', build: 'open', shape: 'straight' },
  { id: 'interior-concrete', title: 'Бетонная монолитная', environment: 'interior', material: 'concrete', railing: 'metal', build: 'closed', shape: 'l' },
  { id: 'interior-glass', title: 'Металл и стекло', environment: 'interior', material: 'metal', railing: 'glass', build: 'open', shape: 'u' },
  { id: 'interior-cantilever', title: 'Консольная деревянная', environment: 'interior', material: 'wood', railing: 'glass', build: 'cantilever', shape: 'straight' },
  { id: 'exterior-concrete', title: 'Наружная бетонная', environment: 'exterior', material: 'concrete', railing: 'metal', build: 'closed', shape: 'straight' },
  { id: 'exterior-metal', title: 'Наружная металлическая', environment: 'exterior', material: 'metal', railing: 'metal', build: 'open', shape: 'straight' },
  { id: 'exterior-wood', title: 'Наружная деревянная', environment: 'exterior', material: 'wood', railing: 'wood', build: 'open', shape: 'l' },
];

const validId = (list, value, fallback) => (list.some((entry) => entry.id === value) ? value : fallback);

export function stairAppearance(item) {
  const build = stairBuild(item);
  return {
    environment: validId(STAIR_ENVIRONMENTS, item?.stairEnvironment, 'interior'),
    material: validId(STAIR_MATERIALS, item?.stairMaterial, 'wood'),
    // У старого монолита ограждения не было; у открытой лестницы были
    // металлические перила. Так старые файлы сохраняют прежний вид.
    railing: validId(STAIR_RAILINGS, item?.stairRailing, build === 'closed' ? 'none' : 'metal'),
  };
}

export function stairStylePreset(value) {
  const id = typeof value === 'string' ? value : value?.stairStyle;
  return STAIR_STYLE_PRESETS.find((preset) => preset.id === id) || STAIR_STYLE_PRESETS[0];
}

export function applyStairStylePreset(item, presetId = STAIR_STYLE_PRESETS[0].id) {
  const preset = stairStylePreset(presetId);
  item.stairStyle = preset.id;
  item.stairEnvironment = preset.environment;
  item.stairMaterial = preset.material;
  item.stairRailing = preset.railing;
  item.stairBuild = preset.build;
  return item;
}

// Подъёмы: по высоте этажа (≈175 мм) или заданное число.
export function stairRisers(item, fallbackHeight = 3000) {
  const floorH = item?.floorHeight || fallbackHeight;
  const auto = Math.max(3, Math.round(floorH / 175));
  const risers = Number.isFinite(item?.risers) && item.risers >= 3 ? Math.round(item.risers) : auto;
  return { floorH, risers, riserH: floorH / risers };
}

// Проступей во всех маршах: подъёмов − 1 (последний — на перекрытие) − площадки.
export function flightTotal(shape, risers) {
  return Math.max(FLIGHTS[shape], risers - 1 - LANDINGS[shape]);
}

export function defaultFlights(shape, total) {
  if (shape === 'straight') return [total];
  if (shape === 'u3') {
    const mid = Math.max(1, Math.floor(total / 3));
    const first = Math.max(1, Math.floor((total - mid) / 2));
    return [first, mid, Math.max(1, total - mid - first)];
  }
  const first = Math.max(1, Math.floor(total / 2));
  return [first, Math.max(1, total - first)];
}

// Ступени по маршам с заданной суммой: лишнее/недостающее — с последнего
// марша (затем с остальных), в каждом марше не меньше одной проступи.
function fixFlights(shape, flights, total) {
  const count = FLIGHTS[shape];
  if (!Array.isArray(flights) || flights.length !== count || flights.some((n) => !Number.isFinite(n))) {
    return defaultFlights(shape, total);
  }
  const out = flights.map((n) => Math.max(1, Math.round(n)));
  let diff = total - out.reduce((s, n) => s + n, 0);
  for (let i = count - 1; diff !== 0 && i >= 0; i -= 1) {
    const next = Math.max(1, out[i] + diff);
    diff -= next - out[i];
    out[i] = next;
    if (i === 0 && diff !== 0) return defaultFlights(shape, total);
  }
  return out;
}

const finite = (v) => Number.isFinite(v) && v > 0;
export function isExplicitStair(item) {
  return finite(item?.flightWidth) && finite(item?.going);
}

// Параметры, заданные явно (поля предмета), без подгонки под габарит.
function explicitParams(item, base) {
  const { shape } = base;
  const fw = item.flightWidth;
  const p = { ...base, fw, going: item.going, flights: fixFlights(shape, item.flights, base.total) };
  if (shape === 'u') {
    p.gap = Number.isFinite(item.gap) ? Math.max(0, item.gap) : DEFAULT_GAP;
    p.depth = finite(item.landingDepth) ? item.landingDepth : fw;
  }
  if (shape === 'l' || shape === 'u3') {
    p.landings = Array.from({ length: LANDINGS[shape] }, (_, i) => ({
      w: finite(item.landings?.[i]?.w) ? item.landings[i].w : fw,
      h: finite(item.landings?.[i]?.h) ? item.landings[i].h : fw,
    }));
  }
  return p;
}

// Раскладка по габариту — как рисовались лестницы до явных параметров.
function fittedParams(base, w, h, flights) {
  const { shape } = base;
  const n = fixFlights(shape, flights, base.total);
  if (shape === 'straight') return { ...base, flights: n, fw: w, going: h / Math.max(1, n[0]) };
  if (shape === 'l') {
    const fw = Math.min(DEFAULT_WIDTH, w * 0.42, h * 0.42);
    const going = Math.max(1, Math.min((h - fw) / n[0], (w - fw) / n[1]));
    return { ...base, flights: n, fw, going, landings: [{ w: w - n[1] * going, h: h - n[0] * going }] };
  }
  if (shape === 'u') {
    const gap = Math.min(DEFAULT_GAP, w * 0.1);
    const fw = (w - gap) / 2;
    const depth0 = Math.min(fw, h * 0.36);
    const going = Math.max(1, (h - depth0) / Math.max(n[0], n[1]));
    return { ...base, flights: n, fw, going, gap, depth: h - Math.max(n[0], n[1]) * going };
  }
  const fw = Math.min(DEFAULT_WIDTH, w * 0.3, h * 0.42);
  const going = Math.max(1, Math.min((h - fw) / Math.max(n[0], n[2]), (w - 2 * fw) / n[1]));
  return {
    ...base, flights: n, fw, going,
    landings: [{ w: fw, h: h - n[0] * going }, { w: w - fw - n[1] * going, h: h - n[2] * going }],
  };
}

function baseOf(item, fallbackHeight) {
  const shape = stairShape(item);
  const { floorH, risers, riserH } = stairRisers(item, fallbackHeight);
  return { shape, floorH, risers, riserH, total: flightTotal(shape, risers) };
}

export function stairParams(item, fallbackHeight = 3000) {
  const base = baseOf(item, fallbackHeight);
  if (isExplicitStair(item)) {
    const p = explicitParams(item, base);
    const box = rawLayout(p);
    // Габарит поменяли извне — снова по габариту (ступени по маршам — свои).
    if (!(item.w > 0 && item.h > 0) || (Math.abs(box.W - item.w) < 1 && Math.abs(box.H - item.h) < 1)) return { ...p, explicit: true };
    return { ...fittedParams(base, item.w, item.h, p.flights), explicit: false };
  }
  return { ...fittedParams(base, item?.w || DEFAULT_WIDTH, item?.h || 3000, item?.flights), explicit: false };
}

// --- Раскладка ---

const UP = { x: 0, y: -1 };
const DOWN = { x: 0, y: 1 };
const RIGHT = { x: 1, y: 0 };

// Прямоугольники маршей и площадок от левого верхнего угла габарита.
// Площадка не уже марша (эффективный размер ≥ ширины марша).
function rawLayout(p) {
  const { shape, fw, going: g } = p;
  const n = p.flights;
  const flights = [];
  const landings = [];
  let W;
  let H;
  if (shape === 'straight') {
    flights.push({ x: 0, y: 0, w: fw, h: n[0] * g, dir: UP });
    W = fw; H = n[0] * g;
  } else if (shape === 'l') {
    const lw = Math.max(p.landings[0].w, fw);
    const lh = Math.max(p.landings[0].h, fw);
    landings.push({ x: 0, y: 0, w: lw, h: lh });
    flights.push({ x: 0, y: lh, w: fw, h: n[0] * g, dir: UP });
    flights.push({ x: lw, y: 0, w: n[1] * g, h: fw, dir: RIGHT });
    W = lw + n[1] * g; H = lh + n[0] * g;
  } else if (shape === 'u') {
    const gap = Math.max(0, p.gap);
    const d = Math.max(p.depth, fw);
    W = 2 * fw + gap;
    landings.push({ x: 0, y: 0, w: W, h: d });
    flights.push({ x: 0, y: d, w: fw, h: n[0] * g, dir: UP });
    flights.push({ x: fw + gap, y: d, w: fw, h: n[1] * g, dir: DOWN });
    H = d + Math.max(n[0], n[1]) * g;
  } else {
    const l1w = Math.max(p.landings[0].w, fw);
    const l1h = Math.max(p.landings[0].h, fw);
    const l2w = Math.max(p.landings[1].w, fw);
    const l2h = Math.max(p.landings[1].h, fw);
    const x2 = l1w + n[1] * g;
    landings.push({ x: 0, y: 0, w: l1w, h: l1h });
    landings.push({ x: x2, y: 0, w: l2w, h: l2h });
    flights.push({ x: 0, y: l1h, w: fw, h: n[0] * g, dir: UP });
    flights.push({ x: l1w, y: 0, w: n[1] * g, h: fw, dir: RIGHT });
    flights.push({ x: x2 + l2w - fw, y: l2h, w: fw, h: n[2] * g, dir: DOWN });
    W = x2 + l2w; H = Math.max(l1h + n[0] * g, l2h + n[2] * g);
  }
  return { W, H, flights, landings };
}

function edgeCenters(r) {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  if (r.dir === UP) return { start: { x: cx, y: r.y + r.h }, end: { x: cx, y: r.y } };
  if (r.dir === DOWN) return { start: { x: cx, y: r.y }, end: { x: cx, y: r.y + r.h } };
  return { start: { x: r.x, y: cy }, end: { x: r.x + r.w, y: cy } };
}

function layoutFrom(p) {
  const raw = rawLayout(p);
  const ox = -raw.W / 2;
  const oy = -raw.H / 2;
  const move = (r) => ({ ...r, x: r.x + ox, y: r.y + oy });
  let step = 1;
  const flights = [];
  const landings = [];
  raw.flights.forEach((f, i) => {
    const r = move(f);
    const ends = edgeCenters(r);
    flights.push({ ...r, n: p.flights[i], startStep: step, ...ends });
    step += p.flights[i];
    if (raw.landings[i]) {
      landings.push({ ...move(raw.landings[i]), step });
      step += 1;
    }
  });
  const hw = raw.W / 2;
  const hh = raw.H / 2;
  const points = {
    tl: { x: -hw, y: -hh }, tr: { x: hw, y: -hh }, bl: { x: -hw, y: hh }, br: { x: hw, y: hh },
    f0s: flights[0].start, fLe: flights[flights.length - 1].end,
  };
  return { ...p, W: raw.W, H: raw.H, flights, landings, points };
}

export function stairLayout(item, fallbackHeight = 3000) {
  return layoutFrom(stairParams(item, fallbackHeight));
}

// Средняя линия подъёма (для стрелки): начало первого марша → повороты на
// площадках → конец последнего марша. В локальных осях.
export function stairPath(layout) {
  const pts = [];
  layout.flights.forEach((f, i) => {
    if (i === 0) pts.push(f.start);
    const next = layout.flights[i + 1];
    if (!next) { pts.push(f.end); return; }
    const land = layout.landings[i];
    const perpendicular = f.dir.x * next.dir.x + f.dir.y * next.dir.y === 0;
    if (perpendicular) {
      pts.push(f.dir.x === 0 ? { x: f.end.x, y: next.start.y } : { x: next.start.x, y: f.end.y });
    } else if (f.dir.x === 0) {
      const y = land.y + land.h / 2;
      pts.push({ x: f.end.x, y }, { x: next.start.x, y });
    } else {
      const x = land.x + land.w / 2;
      pts.push({ x, y: f.end.y }, { x, y: next.start.y });
    }
  });
  return pts;
}

// --- Пресет и расчёт ---

// Удобная проступь под высоту подъёма: 2h + b ≈ 620 мм.
function comfortGoing(riserH) {
  return Math.min(320, Math.max(240, Math.round((620 - 2 * riserH) / 10) * 10));
}

function presetParams(shape, floorHeight) {
  const { floorH, risers, riserH } = stairRisers({ floorHeight }, floorHeight);
  const total = flightTotal(shape, risers);
  const p = {
    shape, floorH, risers, riserH, total,
    fw: DEFAULT_WIDTH, going: comfortGoing(riserH), flights: defaultFlights(shape, total),
  };
  if (shape === 'u') { p.gap = DEFAULT_GAP; p.depth = DEFAULT_WIDTH; }
  if (shape === 'l' || shape === 'u3') p.landings = Array.from({ length: LANDINGS[shape] }, () => ({ w: DEFAULT_WIDTH, h: DEFAULT_WIDTH }));
  return p;
}

export function stairPreset(shape = 'u', floorHeight = 3000) {
  const box = rawLayout(presetParams(shape, floorHeight));
  return { w: box.W, h: box.H };
}

const PARAM_FIELDS = ['flightWidth', 'going', 'flights', 'gap', 'landingDepth', 'landings'];
// Поля лестницы, которые меняют ручки и «Свойства» (для сравнения и отмены).
export const STAIR_FIELDS = ['stairShape', 'floorHeight', 'risers', ...PARAM_FIELDS, 'w', 'h'];

// Запись параметров в предмет (только поля своей формы) и габарит по раскладке.
function writeParams(item, p) {
  for (const key of PARAM_FIELDS) delete item[key];
  item.stairShape = p.shape;
  item.flightWidth = p.fw;
  item.going = p.going;
  item.flights = [...p.flights];
  if (p.shape === 'u') { item.gap = p.gap; item.landingDepth = Math.max(p.depth, p.fw); }
  if (p.landings) item.landings = p.landings.map((l) => ({ w: Math.max(l.w, p.fw), h: Math.max(l.h, p.fw) }));
  const box = rawLayout(p);
  item.w = box.W;
  item.h = box.H;
  return item;
}

export function applyStairPreset(item, shape = stairShape(item), floorHeight = item.floorHeight || 3000) {
  item.floorHeight = floorHeight;
  delete item.risers;
  return writeParams(item, presetParams(shape, floorHeight));
}

export function stairCalculation(item, fallbackHeight = 3000) {
  const p = stairParams(item, fallbackHeight);
  const lay = layoutFrom(p);
  const treads = p.flights.reduce((s, n) => s + n, 0);
  const treadD = p.going;
  const comfort = 2 * p.riserH + treadD;
  const N = STAIR_NORMS;
  const okRiser = p.riserH >= N.riserMin && p.riserH <= N.riserMax;
  const okTread = treadD >= N.treadMin && treadD <= N.treadMax;
  const okComfort = comfort >= N.comfortMin && comfort <= N.comfortMax;
  const okWidth = p.fw >= N.widthMin - 0.5;
  const okFlights = p.flights.every((n) => n + 1 >= N.flightRisersMin && n + 1 <= N.flightRisersMax);
  const okLandings = lay.landings.every((l) => Math.min(l.w, l.h) >= p.fw - 0.5);
  const warnings = [];
  if (!okRiser) warnings.push(`Высота ступени ${Math.round(p.riserH)} мм — норма ${N.riserMin}–${N.riserMax}`);
  if (!okTread) warnings.push(`Проступь ${Math.round(treadD)} мм — норма ${N.treadMin}–${N.treadMax}`);
  if (!okComfort) warnings.push(`2h + b = ${Math.round(comfort)} мм — удобно ${N.comfortMin}–${N.comfortMax}`);
  if (!okWidth) warnings.push(`Ширина марша ${Math.round(p.fw)} мм — не меньше ${N.widthMin}`);
  if (!okFlights) warnings.push(`В марше от ${N.flightRisersMin} до ${N.flightRisersMax} подъёмов`);
  return {
    shape: p.shape, floorH: p.floorH, risers: p.risers, riserH: p.riserH, treads,
    flights: [...p.flights], firstTreads: p.flights[0], secondTreads: p.flights[1] || 0, thirdTreads: p.flights[2] || 0,
    treadD, comfort, flightWidth: p.fw, explicit: p.explicit,
    okRiser, okTread, okComfort, okWidth, okFlights, okLandings, warnings,
  };
}

// --- Параметры по ключу (ручки и поля «Свойств») ---

function getParam(p, key) {
  if (key === 'width') return p.fw;
  if (key === 'going') return p.going;
  if (key === 'gap') return p.gap;
  if (key === 'depth') return Math.max(p.depth, p.fw);
  const m = /^l(\d)([wh])$/.exec(key);
  if (m) return Math.max(p.landings[Number(m[1])][m[2]], p.fw);
  const f = /^n:(\d)$/.exec(key);
  if (f) return p.flights[Number(f[1])];
  return undefined;
}

// Без ограничений (для пробного шага ручки); ограничения — clampParam.
function setParam(p, key, value) {
  const q = { ...p, flights: [...p.flights], landings: p.landings?.map((l) => ({ ...l })) };
  if (key === 'width') q.fw = value;
  else if (key === 'going') q.going = value;
  else if (key === 'gap') q.gap = value;
  else if (key === 'depth') q.depth = value;
  else if (/^l\d[wh]$/.test(key)) q.landings[Number(key[1])][key[2]] = value;
  else if (/^n:\d$/.test(key)) {
    const i = Number(key[2]);
    const j = COMPENSATE[p.shape]?.[i];
    if (j === undefined) return q;
    const keep = p.flights.reduce((s, n, k) => (k === i || k === j ? s : s + n), 0);
    q.flights[i] = value;
    q.flights[j] = p.total - keep - value;
  }
  return q;
}

function clampParam(p, key, value) {
  const L = STAIR_LIMITS;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  if (key === 'width') return clamp(value, L.widthMin, L.widthMax);
  if (key === 'going') return clamp(value, L.goingMin, L.goingMax);
  if (key === 'gap') return clamp(value, 0, L.gapMax);
  if (key === 'depth' || /^l\d[wh]$/.test(key)) return clamp(value, p.fw, p.fw + L.landingExtra);
  if (/^n:\d$/.test(key)) {
    const i = Number(key[2]);
    const j = COMPENSATE[p.shape]?.[i];
    if (j === undefined) return p.flights[i];
    return clamp(Math.round(value), 1, p.flights[i] + p.flights[j] - 1);
  }
  return value;
}

// Ключи параметров формы (для «Свойств»).
export function stairParamKeys(shape) {
  const keys = ['width', 'going'];
  if (shape !== 'straight') for (let i = 0; i < FLIGHTS[shape]; i += 1) keys.push(`n:${i}`);
  if (shape === 'u') keys.push('depth', 'gap');
  if (shape === 'l') keys.push('l0w', 'l0h');
  if (shape === 'u3') keys.push('l0w', 'l0h', 'l1w', 'l1h');
  return keys;
}

export function stairParamValue(item, key, fallbackHeight = 3000) {
  return getParam(stairParams(item, fallbackHeight), key);
}

// --- Локальные оси ↔ план ---

function frame(item) {
  const a = ((item.rotation || 0) * Math.PI) / 180;
  return { c: Math.cos(a), s: Math.sin(a), m: item.mirrored ? -1 : 1 };
}
export function stairToPlan(item, p) {
  const { c, s, m } = frame(item);
  const x = p.x * m;
  return { x: item.x + x * c - p.y * s, y: item.y + x * s + p.y * c };
}
function planToLocal(item, p) {
  const { c, s, m } = frame(item);
  const dx = p.x - item.x;
  const dy = p.y - item.y;
  return { x: (dx * c + dy * s) * m, y: -dx * s + dy * c };
}

// --- Ручки ---
// steps — конец марша (число ступеней; у прямой — проступь), width — боковая
// кромка первого марша (ширина марша), landing — угол площадки (размеры).
// axes — что меняет движение вдоль направления dir (локальные оси) и какая
// точка раскладки (anchor) остаётся на месте.
function handlesOf(lay) {
  const out = [];
  const { shape } = lay;
  const last = lay.flights.length - 1;
  lay.flights.forEach((f, i) => {
    if (shape === 'straight') {
      out.push({ id: 'going', kind: 'steps', flight: 0, x: f.start.x, y: f.start.y, axes: [{ key: 'going', dir: { x: -f.dir.x, y: -f.dir.y }, anchor: 'tl' }] });
      return;
    }
    const atStart = i === 0;
    const at = atStart ? f.start : f.end;
    const dir = atStart ? { x: -f.dir.x, y: -f.dir.y } : f.dir;
    if (i !== 0 && i !== last && shape !== 'u3') return;
    out.push({ id: `steps:${i}`, kind: 'steps', flight: i, x: at.x, y: at.y, axes: [{ key: `n:${i}`, dir, anchor: 'tl', int: true }] });
  });
  const f0 = lay.flights[0];
  if (shape === 'straight') {
    out.push({ id: 'width', kind: 'width', x: f0.x + f0.w, y: f0.y + f0.h / 2, axes: [{ key: 'width', dir: RIGHT, anchor: 'tl' }] });
  } else {
    out.push({ id: 'width', kind: 'width', x: f0.x, y: f0.y + f0.h / 2, axes: [{ key: 'width', dir: { x: -1, y: 0 }, anchor: 'tr' }] });
  }
  const L = lay.landings;
  if (shape === 'u') {
    out.push({ id: 'landing:0', kind: 'landing', x: L[0].x, y: L[0].y, axes: [
      { key: 'gap', dir: { x: -1, y: 0 }, anchor: 'br' }, { key: 'depth', dir: UP, anchor: 'br' }] });
  } else if (shape === 'l') {
    out.push({ id: 'landing:0', kind: 'landing', x: L[0].x, y: L[0].y, axes: [
      { key: 'l0w', dir: { x: -1, y: 0 }, anchor: 'br' }, { key: 'l0h', dir: UP, anchor: 'br' }] });
  } else if (shape === 'u3') {
    out.push({ id: 'landing:0', kind: 'landing', x: L[0].x, y: L[0].y, axes: [
      { key: 'l0w', dir: { x: -1, y: 0 }, anchor: 'tr' }, { key: 'l0h', dir: UP, anchor: 'f0s' }] });
    out.push({ id: 'landing:1', kind: 'landing', x: L[1].x + L[1].w, y: L[1].y, axes: [
      { key: 'l1w', dir: RIGHT, anchor: 'tl' }, { key: 'l1h', dir: UP, anchor: 'fLe' }] });
  }
  return out;
}

// Ручки выбранной лестницы в осях плана (+ локальные и направление наружу).
export function stairHandles(item, fallbackHeight = 3000) {
  const lay = stairLayout(item, fallbackHeight);
  return handlesOf(lay).map((h) => {
    const at = stairToPlan(item, h);
    const d = h.axes[0].dir;
    const tip = stairToPlan(item, { x: h.x + d.x * 1000, y: h.y + d.y * 1000 });
    const out = { x: (tip.x - at.x) / 1000, y: (tip.y - at.y) / 1000 };
    const label = h.kind === 'steps' ? String(lay.flights[h.flight].n) : '';
    return { id: h.id, kind: h.kind, flight: h.flight, local: { x: h.x, y: h.y }, x: at.x, y: at.y, out, label };
  });
}

// Явные параметры с прежним габаритом (для первой правки старой лестницы).
export function materializeStair(item, fallbackHeight = 3000) {
  const next = { ...item };
  const p = stairParams(item, fallbackHeight);
  if (!next.floorHeight) next.floorHeight = p.floorH;
  writeParams(next, p);
  return next;
}

// Сдвиг центра так, чтобы точка anchor старой раскладки осталась на месте.
function placeByAnchor(item, oldLay, newLay, anchor) {
  const a = oldLay.points[anchor];
  const b = newLay.points[anchor];
  const c = stairToPlan(item, { x: a.x - b.x, y: a.y - b.y });
  return { x: c.x, y: c.y };
}

function handleLocal(lay, id) {
  return handlesOf(lay).find((h) => h.id === id);
}

// Один параметр ручки: значение, при котором ручка (с неподвижной anchor)
// оказывается под курсором вдоль dir. Раскладка линейна по параметру на
// участке — секущая по пробному шагу.
function solveAxis(item, handleId, axisIndex, point, opts) {
  const p = stairParams(item, opts.fallbackHeight);
  const lay = layoutFrom(p);
  const h = handleLocal(lay, handleId);
  if (!h) return item;
  const axis = h.axes[axisIndex];
  const mouse = planToLocal(item, point);
  const target = (mouse.x - h.x) * axis.dir.x + (mouse.y - h.y) * axis.dir.y;
  const v0 = getParam(p, axis.key);
  const probe = (v) => {
    const q = layoutFrom(setParam(p, axis.key, v));
    const hq = handleLocal(q, handleId);
    const a = lay.points[axis.anchor];
    const b = q.points[axis.anchor];
    return (a.x + hq.x - b.x - h.x) * axis.dir.x + (a.y + hq.y - b.y - h.y) * axis.dir.y;
  };
  const eps = axis.int ? 1 : 100;
  const slope = (probe(v0 + eps) - probe(v0)) / eps;
  if (Math.abs(slope) < 1e-6) return item;
  let v = v0 + target / slope;
  if (axis.int) v = Math.round(v);
  else if (opts.snap > 1) v = Math.round(v / opts.snap) * opts.snap;
  v = clampParam(p, axis.key, v);
  const q = setParam(p, axis.key, v);
  const next = { ...item };
  writeParams(next, q);
  Object.assign(next, placeByAnchor(item, lay, layoutFrom(q), axis.anchor));
  return next;
}

// Перетаскивание ручки: start — лестница в начале жеста, point — курсор
// (оси плана). snap — шаг длины, мм (Shift — 1). Возвращает новые поля.
export function dragStairHandle(start, handleId, point, { snap = 10, fallbackHeight = 3000 } = {}) {
  let cur = materializeStair(start, fallbackHeight);
  const h = handleLocal(stairLayout(cur, fallbackHeight), handleId);
  if (!h) return null;
  for (let i = 0; i < h.axes.length; i += 1) cur = solveAxis(cur, handleId, i, point, { snap, fallbackHeight });
  return cur;
}

// Ввод параметра в «Свойствах»: левый верхний угол габарита на месте.
export function setStairParam(item, key, value, fallbackHeight = 3000) {
  if (key === 'risers') {
    // Другое число подъёмов: ступени добавляются/убираются в последнем марше.
    const cur = materializeStair(item, fallbackHeight);
    const lay0 = stairLayout(cur, fallbackHeight);
    const auto = Math.max(3, Math.round((cur.floorHeight || fallbackHeight) / 175));
    const r = Math.max(3, Math.min(60, Math.round(value)));
    if (r === auto) delete cur.risers; else cur.risers = r;
    const p = explicitParams(cur, baseOf(cur, fallbackHeight));
    writeParams(cur, p);
    Object.assign(cur, placeByAnchor(item, lay0, layoutFrom(p), 'tl'));
    Object.assign(item, cur);
    if (cur.risers === undefined) delete item.risers;
    return item;
  }
  const cur = materializeStair(item, fallbackHeight);
  const p = stairParams(cur, fallbackHeight);
  if (getParam(p, key) === undefined) return item;
  const q = setParam(p, key, clampParam(p, key, value));
  const lay0 = layoutFrom(p);
  writeParams(cur, q);
  Object.assign(cur, placeByAnchor(item, lay0, layoutFrom(q), 'tl'));
  return Object.assign(item, cur);
}

// Другая высота подъёма (лестница ведёт на этаж — разница отметок): число
// подъёмов — по высоте (≈175 мм), ширина марша и проступь — свои, ступени
// добавляются/убираются в последнем марше; левый верхний угол на месте.
export function setStairRise(item, height, fallbackHeight = 3000) {
  const h = Math.max(1000, Math.round(height));
  const cur = materializeStair(item, fallbackHeight);
  const lay0 = stairLayout(cur, fallbackHeight);
  cur.floorHeight = h;
  delete cur.risers;
  const p = explicitParams(cur, baseOf(cur, fallbackHeight));
  writeParams(cur, p);
  Object.assign(cur, placeByAnchor(item, lay0, layoutFrom(p), 'tl'));
  Object.assign(item, cur);
  delete item.risers;
  return item;
}

// Подпись при перетаскивании ручки.
export function stairHandleLabel(item, handleId, fallbackHeight = 3000) {
  const c = stairCalculation(item, fallbackHeight);
  const lay = stairLayout(item, fallbackHeight);
  if (handleId === 'width') return `Ширина марша ${Math.round(c.flightWidth)} мм`;
  if (handleId === 'going') return `Проступь ${Math.round(c.treadD)} мм · ${c.treads} ступ.`;
  if (handleId.startsWith('steps:')) return `Ступени по маршам: ${c.flights.join(' + ')} = ${c.treads}`;
  const i = Number(handleId.split(':')[1]) || 0;
  const l = lay.landings[i];
  if (lay.shape === 'u') return `Площадка ${Math.round(l.w)} × ${Math.round(l.h)} мм · зазор ${Math.round(lay.gap)} мм`;
  return `Площадка ${i + 1}: ${Math.round(l.w)} × ${Math.round(l.h)} мм`;
}
