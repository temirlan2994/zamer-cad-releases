// Виды и листы проекта (как в Revit). Чистый модуль без DOM.
//
// Необязательные поля проекта (схема не меняется — kepler-plan/6 в памяти,
// kepler-plan/7 в файле переносят их как есть, старые файлы без них
// открываются):
//   project.views[]  = { id, kind, name, levelId?, dir?, scale?, marks? }
//     kind: 'plan' | 'site' | 'landscape' | '3d' | 'elevation' | 'section';
//     dir — сторона фасада 'N' | 'S' | 'E' | 'W'; scale — знаменатель
//     масштаба (по умолчанию 100); marks: false — отметки уровней скрыты.
//     Разрез (kind 'section', core/section.js): levelId — этаж, на котором
//     проведена линия; line { a, b } — в осях дома; side 1 | -1 — сторона
//     взгляда; depth — глубина видимости, мм (нет — до габарита дома).
//   project.sheets[] = { id, no, name, format, orient, viewports[] } — листы
//     пользователя (как в Revit): format 'A4' | 'A3' | 'A2' | 'A1', orient
//     'landscape' | 'portrait'; viewports[] = { id, viewId, x, y, scale,
//     title? } — видовые экраны: viewId — ключ вида (viewKey), x, y — центр
//     вида в мм листа, scale — знаменатель масштаба, title — своя подпись.
//     Один вид — не больше чем на одном листе.
//   project.sheetsAuto === false — автолисты альбома (sheetPlan() в
//     ui/sheet.js: генплан, разрезы участка, этажи) скрыты. Без поля они
//     идут первыми, листы пользователя — после них; файл без sheets даёт
//     тот же альбом и тот же PDF, что и раньше.
// Планы этажей, «Участок», «Ландшафт» и 3D вычисляются по проекту и в views
// не хранятся. Фасады по умолчанию (Север, Юг, Запад, Восток) создаются
// лениво: пока их не меняли, project.views нет вовсе.

export const VIEW_KINDS = ['plan', 'site', 'landscape', '3d', 'elevation', 'section'];
export const ELEV_DIRS = ['N', 'S', 'W', 'E']; // порядок в дереве видов
export const DIR_NAMES = { N: 'Север', S: 'Юг', W: 'Запад', E: 'Восток' };
export const VIEW_SCALES = [50, 100, 200];
export const DEFAULT_VIEW_SCALE = 100;

const isObj = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' && v ? v : null);

export function defaultFacade(dir) {
  return { id: `elev-${dir}`, kind: 'elevation', name: `Фасад ${DIR_NAMES[dir]}`, dir, scale: DEFAULT_VIEW_SCALE };
}

// Фасады проекта: сохранённые (project.views) или по умолчанию — по одному
// на сторону света, в порядке ELEV_DIRS.
export function facadeViews(project) {
  const list = Array.isArray(project?.views) ? project.views : [];
  return ELEV_DIRS.map((dir) => list.find((v) => v.kind === 'elevation' && v.dir === dir) || defaultFacade(dir));
}

export function findView(project, id) {
  return facadeViews(project).find((v) => v.id === id)
    || (Array.isArray(project?.views) ? project.views.find((v) => v.id === id) : null) || null;
}

// Сохранить фасады в project.views (перед первой правкой их настроек).
// Возвращает сохранённый вид id или null.
export function materializeView(project, id) {
  if (!Array.isArray(project.views)) project.views = [];
  let view = project.views.find((v) => v.id === id);
  if (view) return view;
  const def = facadeViews(project).find((v) => v.id === id);
  if (!def) return null;
  view = { ...def };
  project.views.push(view);
  return view;
}

export const viewScale = (view) => (VIEW_SCALES.includes(view?.scale) ? view.scale
  : Number(view?.scale) > 0 ? Number(view.scale) : DEFAULT_VIEW_SCALE);

const finitePt = (p) => isObj(p) && Number.isFinite(Number(p.x)) && Number.isFinite(Number(p.y));

export function normalizeView(v) {
  if (!isObj(v) || !VIEW_KINDS.includes(v.kind) || !str(v.id)) return null;
  const out = { ...v, name: str(v.name) || (v.kind === 'elevation' && DIR_NAMES[v.dir] ? `Фасад ${DIR_NAMES[v.dir]}` : v.kind === 'section' ? 'Разрез' : 'Вид') };
  if (v.kind === 'elevation' && !DIR_NAMES[v.dir]) return null;
  if (v.kind === 'section') {
    const l = v.line;
    if (!isObj(l) || !finitePt(l.a) || !finitePt(l.b)) return null;
    const a = { x: Number(l.a.x), y: Number(l.a.y) };
    const b = { x: Number(l.b.x), y: Number(l.b.y) };
    if (Math.hypot(b.x - a.x, b.y - a.y) < 1) return null;
    out.line = { a, b };
    out.side = v.side === -1 ? -1 : 1;
    const depth = Number(v.depth);
    if (v.depth != null && depth > 0 && Number.isFinite(depth)) out.depth = Math.round(depth); else delete out.depth;
  }
  if (v.dir != null && !DIR_NAMES[v.dir]) delete out.dir;
  if (v.levelId != null && !str(v.levelId)) delete out.levelId;
  const scale = Number(v.scale);
  if (scale > 0 && Number.isFinite(scale)) out.scale = Math.round(scale); else delete out.scale;
  if (v.marks !== false) delete out.marks;
  return out;
}

// Видовой экран: нет вида, координат или масштаба — null.
export function normalizeViewport(vp) {
  if (!isObj(vp) || !str(vp.viewId)) return null;
  const x = Number(vp.x);
  const y = Number(vp.y);
  const scale = Number(vp.scale);
  if (!Number.isFinite(x) || !Number.isFinite(y) || !(scale > 0) || !Number.isFinite(scale)) return null;
  const out = { id: str(vp.id), viewId: vp.viewId, x: round1(x), y: round1(y), scale: Math.round(scale) || 1 };
  if (str(vp.title)) out.title = vp.title;
  return out;
}

export function normalizeSheet(s, i) {
  if (!isObj(s)) return null;
  const seen = new Set();
  const viewports = (Array.isArray(s.viewports) ? s.viewports : []).map(normalizeViewport).filter(Boolean);
  for (const vp of viewports) {
    if (!vp.id || seen.has(vp.id)) vp.id = freeId('vp', seen);
    seen.add(vp.id);
  }
  return {
    ...s,
    id: str(s.id) || `sheet-${i + 1}`,
    no: str(s.no) || String(s.no ?? i + 1),
    name: str(s.name) || `Лист ${i + 1}`,
    format: SHEET_FORMATS[s.format] ? s.format : 'A3',
    orient: s.orient === 'portrait' ? 'portrait' : 'landscape',
    viewports,
  };
}

// Чистка при открытии (core/model.js normalizeProject): нет массива —
// поля нет; битые записи отбрасываются, повторные id — тоже; вид, уже
// размещённый на листе выше, с последующих листов снимается.
export function normalizeViewsAndSheets(data) {
  if (Array.isArray(data.views)) {
    const seen = new Set();
    data.views = data.views.map(normalizeView).filter((v) => v && !seen.has(v.id) && seen.add(v.id));
  } else delete data.views;
  if (Array.isArray(data.sheets)) {
    const ids = new Set();
    const placed = new Set();
    const vpIds = new Set();
    data.sheets = data.sheets.map(normalizeSheet).filter((s) => s && !ids.has(s.id) && ids.add(s.id));
    for (const s of data.sheets) {
      s.viewports = s.viewports.filter((vp) => !placed.has(vp.viewId) && placed.add(vp.viewId));
      for (const vp of s.viewports) {
        if (vpIds.has(vp.id)) vp.id = freeId('vp', vpIds);
        vpIds.add(vp.id);
      }
    }
  } else delete data.sheets;
  if (data.sheetsAuto !== false) delete data.sheetsAuto;
}

// ------------------------------------------------------------ разрезы

// Разрезы по линии на плане этажа (в порядке создания).
export function sectionViews(project) {
  return Array.isArray(project?.views) ? project.views.filter((v) => v.kind === 'section') : [];
}

export const isSectionViewId = (project, id) => sectionViews(project).some((v) => v.id === id);

// Следующее свободное «Разрез N» и id.
export function nextSectionName(project) {
  const used = new Set(sectionViews(project).map((v) => v.name));
  let k = 1;
  while (used.has(`Разрез ${k}`)) k += 1;
  return `Разрез ${k}`;
}

function nextSectionId(project) {
  const ids = new Set((project.views || []).map((v) => v.id));
  let k = 1;
  while (ids.has(`sec-${k}`)) k += 1;
  return `sec-${k}`;
}

// Новый разрез в project.views (мутирует проект — вызывать внутри mutate).
export function addSectionView(project, { levelId = null, a, b, side = 1, depth = null, scale = DEFAULT_VIEW_SCALE, name = null }) {
  if (!Array.isArray(project.views)) project.views = [];
  const view = {
    id: nextSectionId(project), kind: 'section', name: name || nextSectionName(project),
    line: { a: { x: Math.round(a.x), y: Math.round(a.y) }, b: { x: Math.round(b.x), y: Math.round(b.y) } },
    side: side === -1 ? -1 : 1, scale,
  };
  if (levelId) view.levelId = levelId;
  if (Number(depth) > 0) view.depth = Math.round(Number(depth));
  project.views.push(view);
  return view;
}

export function removeView(project, id) {
  if (!Array.isArray(project.views)) return false;
  const i = project.views.findIndex((v) => v.id === id);
  if (i < 0) return false;
  project.views.splice(i, 1);
  return true;
}

// Номер/буква в «головке» разреза: «Разрез 1» → «1», «Разрез А» → «А».
export function sectionMark(view) {
  const m = /(\S+)\s*$/.exec(String(view?.name || ''));
  const t = m ? m[1] : '';
  return t.length <= 3 ? t : t.slice(0, 3);
}

// ------------------------------------------------------------ ключи видов

// Ключ вида (viewId видового экрана) — тот же, что у дерева «Виды»:
//   'plan:<id этажа>' | 'site' | 'landscape' | '3d' | 'elev-N|S|W|E' |
//   'sec-<n>' (разрез по плану) | 'section:<id>' (разрез участка).
// Планы, участок, ландшафт и 3D вычисляются по проекту; их ключи
// устойчивы, пока жив этаж / разрез.
export function viewKey(v) {
  if (!v) return null;
  if (typeof v === 'string') return v;
  if (v.kind === 'plan') return `plan:${v.levelId}`;
  if (v.kind === 'lsection') return `section:${v.sectionId}`;
  if (v.kind === 'elevation' || v.kind === 'section') return v.id;
  return v.kind;
}

const sortLevels = (project) => [...(project?.levels || [])].sort((a, b) => (a.elevation || 0) - (b.elevation || 0));
const lsSections = (project) => (Array.isArray(project?.site?.landscape?.sections) ? project.site.landscape.sections : []);

// Описание вида по ключу: { id, kind, name, levelId?, dir?, sectionId?,
// view? } или null (этаж/разрез удалён). kind: 'plan' | 'site' |
// 'landscape' | '3d' | 'elevation' | 'section' | 'lsection'.
export function viewById(project, id) {
  if (typeof id !== 'string' || !id || !project) return null;
  if (id.startsWith('plan:')) {
    const level = (project.levels || []).find((l) => l.id === id.slice(5));
    return level ? { id, kind: 'plan', levelId: level.id, name: `План: ${level.name}` } : null;
  }
  if (id === 'site') return { id, kind: 'site', name: 'Участок' };
  if (id === 'landscape') return { id, kind: 'landscape', name: 'Ландшафт' };
  if (id === '3d') return { id, kind: '3d', name: '3D-вид' };
  if (id.startsWith('section:')) {
    const sec = lsSections(project).find((s) => s.id === id.slice(8));
    return sec ? { id, kind: 'lsection', sectionId: sec.id, name: `Разрез участка ${sec.name}–${sec.name}` } : null;
  }
  const view = findView(project, id);
  if (!view || (view.kind !== 'elevation' && view.kind !== 'section')) return null;
  return { id, kind: view.kind, name: view.name, dir: view.dir, levelId: view.levelId, view };
}

// Все виды проекта в порядке дерева «Виды».
export function allViews(project) {
  return [
    ...sortLevels(project).map((l) => `plan:${l.id}`),
    'site', 'landscape', '3d',
    ...sectionViews(project).map((v) => v.id),
    ...lsSections(project).map((s) => `section:${s.id}`),
    ...facadeViews(project).map((v) => v.id),
  ].map((id) => viewById(project, id)).filter(Boolean);
}

// ------------------------------------------------------------ листы

// Форматы (альбомная ориентация), мм.
export const SHEET_FORMATS = { A4: { w: 297, h: 210 }, A3: { w: 420, h: 297 }, A2: { w: 594, h: 420 }, A1: { w: 841, h: 594 } };
export const SHEET_FORMAT_LIST = ['A4', 'A3', 'A2', 'A1'];
export const VIEWPORT_TITLE_H = 8; // мм под видом — подпись «Название · 1:100»
export const VIEWPORT_SNAP = 5; // мм — шаг привязки при перетаскивании
// Масштабы видового экрана (переключатель в «Свойствах») по типу вида.
export const VIEWPORT_SCALES = {
  plan: [50, 100, 200, 500], elevation: [50, 100, 200, 500], section: [50, 100, 200, 500],
  lsection: [50, 100, 200, 500], '3d': [50, 100, 200, 500],
  site: [200, 500, 1000, 2000], landscape: [200, 500, 1000, 2000],
};
export const viewportScales = (kind) => VIEWPORT_SCALES[kind] || VIEWPORT_SCALES.plan;

function round1(v) { return Math.round(v * 10) / 10; }

function freeId(prefix, used) {
  let k = 1;
  while (used.has(`${prefix}-${k}`)) k += 1;
  return `${prefix}-${k}`;
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// Размер листа с учётом ориентации, мм.
export function sheetSize(sheet) {
  const f = SHEET_FORMATS[sheet?.format] || SHEET_FORMATS.A3;
  return sheet?.orient === 'portrait' ? { w: f.h, h: f.w } : { w: f.w, h: f.h };
}

// Рамка (поле 20 мм слева, 5 мм с остальных сторон), штамп 185×55 в правом
// нижнем углу, поле чертежа — над штампом с отступом 5 мм. Для A3
// альбомного — те же числа, что у листов sheetPlan().
export function sheetFrame(size) {
  const frame = { x0: 20, y0: 5, x1: size.w - 5, y1: size.h - 5 };
  const stamp = { x0: Math.max(frame.x0, frame.x1 - 185), y0: frame.y1 - 55 };
  const area = { x0: frame.x0 + 5, y0: frame.y0 + 5, x1: frame.x1 - 5, y1: stamp.y0 - 5 };
  return { frame, stamp, area };
}

// Самый крупный масштаб из scales, при котором вид (габарит w×h в мм
// модели) с подписью помещается в поле чертежа листа.
export function fitViewportScale(w, h, sheet, scales = VIEWPORT_SCALES.plan) {
  const { area } = sheetFrame(sheetSize(sheet));
  const aw = area.x1 - area.x0;
  const ah = area.y1 - area.y0 - VIEWPORT_TITLE_H;
  return scales.find((d) => w / d <= aw && h / d <= ah) ?? scales[scales.length - 1];
}

// Габарит плана этажа в осях дома (мм) — комнаты плюс поле под стены и
// размерные линии, как на листе плана; нет комнат — null.
export function planExtent(lp) {
  const rooms = lp?.rooms || [];
  if (!rooms.length) return null;
  const pad = (lp.settings?.exterior || 250) + 1600;
  const x0 = Math.min(...rooms.map((r) => r.x)) - pad;
  const y0 = Math.min(...rooms.map((r) => r.y)) - pad;
  const x1 = Math.max(...rooms.map((r) => r.x + r.w)) + pad;
  const y1 = Math.max(...rooms.map((r) => r.y + r.h)) + pad;
  return { w: x1 - x0, h: y1 - y0 };
}

export const userSheets = (project) => (Array.isArray(project?.sheets) ? project.sheets : []);
export const findSheetById = (project, id) => userSheets(project).find((s) => s.id === id) || null;

// Лист, на котором размещён вид (или null).
export function sheetOfView(project, viewId) {
  return userSheets(project).find((s) => s.viewports.some((vp) => vp.viewId === viewId)) || null;
}

export function findViewport(project, vpId) {
  for (const sheet of userSheets(project)) {
    const vp = sheet.viewports.find((v) => v.id === vpId);
    if (vp) return { sheet, vp };
  }
  return null;
}

// Новый лист (мутирует проект — внутри mutate). no — номер в альбоме
// (после автолистов), name по умолчанию — «Лист <no>».
export function addSheet(project, { no = null, name = null, format = 'A3', orient = 'landscape' } = {}) {
  if (!Array.isArray(project.sheets)) project.sheets = [];
  const id = freeId('sh', new Set(project.sheets.map((s) => s.id)));
  const num = str(no) || String(no ?? project.sheets.length + 1);
  const sheet = {
    id, no: num, name: str(name) || `Лист ${num}`,
    format: SHEET_FORMATS[format] ? format : 'A3', orient: orient === 'portrait' ? 'portrait' : 'landscape', viewports: [],
  };
  project.sheets.push(sheet);
  return sheet;
}

export function removeSheet(project, id) {
  const list = userSheets(project);
  const i = list.findIndex((s) => s.id === id);
  if (i < 0) return false;
  list.splice(i, 1);
  if (!list.length) delete project.sheets;
  return true;
}

// Правка листа: название, номер, формат, ориентация. После смены формата
// виды остаются на месте, но не выходят за край листа.
export function updateSheet(project, id, patch = {}) {
  const sheet = findSheetById(project, id);
  if (!sheet) return null;
  if (patch.name != null && String(patch.name).trim()) sheet.name = String(patch.name).trim();
  if (patch.no != null && String(patch.no).trim()) sheet.no = String(patch.no).trim();
  if (patch.format && SHEET_FORMATS[patch.format]) sheet.format = patch.format;
  if (patch.orient === 'portrait' || patch.orient === 'landscape') sheet.orient = patch.orient;
  const size = sheetSize(sheet);
  for (const vp of sheet.viewports) {
    vp.x = clamp(vp.x, 0, size.w);
    vp.y = clamp(vp.y, 0, size.h);
  }
  return sheet;
}

export const snapMm = (v, step = VIEWPORT_SNAP) => Math.round(v / step) * step;

// Положить вид на лист. Вид уже на листе — { error: 'placed', sheet };
// нет листа или вида — { error: 'missing' }; иначе { viewport, sheet }.
export function placeView(project, sheetId, viewId, { x = null, y = null, scale = DEFAULT_VIEW_SCALE, title = null } = {}) {
  const sheet = findSheetById(project, sheetId);
  if (!sheet || !viewById(project, viewId)) return { error: 'missing' };
  const other = sheetOfView(project, viewId);
  if (other) return { error: 'placed', sheet: other };
  const size = sheetSize(sheet);
  const { area } = sheetFrame(size);
  const used = new Set(userSheets(project).flatMap((s) => s.viewports.map((v) => v.id)));
  const vp = {
    id: freeId('vp', used), viewId,
    x: round1(clamp(Number.isFinite(x) ? x : (area.x0 + area.x1) / 2, 0, size.w)),
    y: round1(clamp(Number.isFinite(y) ? y : (area.y0 + area.y1) / 2, 0, size.h)),
    scale: Math.round(Number(scale)) || DEFAULT_VIEW_SCALE,
  };
  if (str(title)) vp.title = title;
  sheet.viewports.push(vp);
  return { viewport: vp, sheet };
}

export function removeViewport(project, vpId) {
  const found = findViewport(project, vpId);
  if (!found) return false;
  found.sheet.viewports.splice(found.sheet.viewports.indexOf(found.vp), 1);
  return true;
}

// Сдвиг центра вида (мм листа); snap — шаг привязки (0 — свободно).
export function moveViewport(project, vpId, x, y, { snap = VIEWPORT_SNAP } = {}) {
  const found = findViewport(project, vpId);
  if (!found) return null;
  const size = sheetSize(found.sheet);
  const sx = snap ? snapMm(x, snap) : x;
  const sy = snap ? snapMm(y, snap) : y;
  found.vp.x = round1(clamp(sx, 0, size.w));
  found.vp.y = round1(clamp(sy, 0, size.h));
  return found.vp;
}

export function setViewportScale(project, vpId, scale) {
  const found = findViewport(project, vpId);
  const s = Math.round(Number(scale));
  if (!found || !(s > 0)) return null;
  found.vp.scale = s;
  return found.vp;
}

// Подпись видового экрана: своя или название вида.
export function viewportTitle(project, vp) {
  return vp.title || viewById(project, vp.viewId)?.name || 'Вид удалён';
}

// Следующий номер листа: после автолистов (autoCount) и номеров листов
// пользователя.
export function nextSheetNo(project, autoCount = 0) {
  const list = userSheets(project);
  const nums = list.map((s) => parseInt(s.no, 10)).filter(Number.isFinite);
  return String(Math.max(autoCount + list.length, ...nums) + 1);
}
