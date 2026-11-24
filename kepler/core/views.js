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
//     title?, no?, crop?, cam? } — видовые экраны: viewId — ключ вида
//     (viewKey), x, y — центр всего (необрезанного) вида в мм листа, scale —
//     знаменатель масштаба, title — своя подпись, no — свой номер вида на
//     листе, crop — рамка обрезки, cam — снимок камеры 3D (см. ниже).
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
export const ROOF_PLAN_VIEW = 'roofplan'; // ключ вида «План крыши» (вычисляется, не хранится)
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
  const no = vp.no == null ? '' : String(vp.no).trim();
  if (no) out.no = no.slice(0, 8);
  const crop = normalizeCrop(vp.crop);
  if (crop) out.crop = crop;
  const cam = normalizeCam(vp.cam);
  if (cam) out.cam = cam;
  return out;
}

// ------------------------------------------------------------ обрезка вида
//
// viewport.crop = { x0, y0, x1, y1, off? } — рамка обрезки (crop region
// Revit) в мм МОДЕЛИ от начала содержимого вида: точка (0, 0) — левый
// верхний угол чертежа без полей (план — габарит, фасад/разрез — u0/z1,
// 3D — габарит аксонометрии). Поэтому при смене масштаба рамка
// масштабируется вместе с видом. off: true — обрезка выключена (рамка
// помнится, «Обрезать вид» её вернёт). Поля вида (отметки фасада справа,
// рамка 3D) — в мм бумаги, рамка может их срезать, как аннотации в Revit.
// Видовой экран без crop рисуется целиком, как раньше.

export const CROP_MIN_MM = 5; // мм бумаги — наименьшая сторона рамки

export function normalizeCrop(c) {
  if (!isObj(c)) return null;
  const n = ['x0', 'y0', 'x1', 'y1'].map((k) => Number(c[k]));
  if (!n.every(Number.isFinite)) return null;
  const x0 = Math.round(Math.min(n[0], n[2]));
  const x1 = Math.round(Math.max(n[0], n[2]));
  const y0 = Math.round(Math.min(n[1], n[3]));
  const y1 = Math.round(Math.max(n[1], n[3]));
  if (x1 - x0 < 1 || y1 - y0 < 1) return null;
  const out = { x0, y0, x1, y1 };
  if (c.off === true) out.off = true;
  return out;
}

// Содержимое растра вида при знаменателе d: frame = { w, h, padL, padT, d }
// — размер растра на бумаге (мм) и поле до начала чертежа (мм бумаги).
// Прямоугольник обрезки в мм бумаги от левого верхнего угла растра или
// null (обрезки нет / выключена). Обрезается по краю растра.
export function cropPaperRect(crop, frame) {
  if (!crop || crop.off) return null;
  const { w, h, padL = 0, padT = 0, d } = frame;
  const r = {
    x0: clamp(padL + crop.x0 / d, 0, w), y0: clamp(padT + crop.y0 / d, 0, h),
    x1: clamp(padL + crop.x1 / d, 0, w), y1: clamp(padT + crop.y1 / d, 0, h),
  };
  return r.x1 - r.x0 > 0.01 && r.y1 - r.y0 > 0.01 ? r : null;
}

// Обратно: прямоугольник в мм бумаги растра → crop в мм модели.
export function cropFromPaper(rect, frame) {
  const { padL = 0, padT = 0, d } = frame;
  return normalizeCrop({ x0: (rect.x0 - padL) * d, y0: (rect.y0 - padT) * d, x1: (rect.x1 - padL) * d, y1: (rect.y1 - padT) * d });
}

// Ручки рамки: углы и середины сторон.
export const CROP_HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

// Точки ручек прямоугольника { x0, y0, x1, y1 }: [{ id, x, y }].
export function cropHandlePoints(r) {
  const mx = (r.x0 + r.x1) / 2;
  const my = (r.y0 + r.y1) / 2;
  const at = { nw: [r.x0, r.y0], n: [mx, r.y0], ne: [r.x1, r.y0], e: [r.x1, my], se: [r.x1, r.y1], s: [mx, r.y1], sw: [r.x0, r.y1], w: [r.x0, my] };
  return CROP_HANDLES.map((id) => ({ id, x: at[id][0], y: at[id][1] }));
}

// Тянуть ручку: rect — рамка в начале жеста (мм бумаги растра), dx, dy —
// сдвиг мыши (мм листа), origin — левый верхний угол растра на листе (для
// привязки краёв к сетке листа step мм; 0 — без шага), bounds — { w, h }
// растра, min — наименьшая сторона. Края не выходят за растр.
export function dragCropHandle(rect, handle, dx, dy, { origin = { x: 0, y: 0 }, step = 0, bounds, min = CROP_MIN_MM } = {}) {
  const r = { ...rect };
  const snap = (v, o) => (step ? snapMm(v + o, step) - o : v);
  const w = bounds?.w ?? Infinity;
  const h = bounds?.h ?? Infinity;
  if (handle.includes('w')) r.x0 = clamp(snap(rect.x0 + dx, origin.x), 0, rect.x1 - min);
  if (handle.includes('e')) r.x1 = clamp(snap(rect.x1 + dx, origin.x), rect.x0 + min, w);
  if (handle.includes('n')) r.y0 = clamp(snap(rect.y0 + dy, origin.y), 0, rect.y1 - min);
  if (handle.includes('s')) r.y1 = clamp(snap(rect.y1 + dy, origin.y), rect.y0 + min, h);
  return r;
}

// ------------------------------------------------------------ камера 3D
//
// viewport.cam = { yaw, pitch, dist?, roof? } — снимок камеры 3D-вида
// (ui/view3d.js: углы в радианах, dist — масштаб окна 3D, на листе масштаб
// задаёт видовой экран; roof — крыша показана). Без cam 3D на листе —
// фиксированная аксонометрия, как в B3.

export function normalizeCam(c) {
  if (!isObj(c)) return null;
  const yaw = Number(c.yaw);
  const pitch = Number(c.pitch);
  if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) return null;
  const out = { yaw: Math.round(yaw * 10000) / 10000, pitch: Math.round(clamp(pitch, -1.55, 1.55) * 10000) / 10000 };
  const dist = Number(c.dist);
  if (dist > 0 && Number.isFinite(dist)) out.dist = Math.round(dist);
  // Готовый дом на листе по умолчанию закрыт кровлей; false хранится явно,
  // чтобы интерьерный 3D-вид не менялся после сохранения.
  out.roof = c.roof !== false;
  // Полный кадр сохраняется только целиком. Старые снимки содержат углы
  // и продолжают строиться как аксонометрия с автоматическими границами.
  const target = c.target;
  if (['perspective', 'orthographic'].includes(c.projection) && out.dist > 0 &&
    Number.isFinite(c.eyeDist) && c.eyeDist > 0 && Number.isFinite(c.aspect) && c.aspect > 0 &&
    [target?.x, target?.y, target?.z].every(Number.isFinite)) {
    Object.assign(out, {
      projection: c.projection, eyeDist: c.eyeDist, target: { x: target.x, y: target.y, z: target.z },
      aspect: clamp(c.aspect, 0.05, 20), site: Boolean(c.site), landscape: Boolean(c.landscape),
      furniture: Boolean(c.furniture), masses: Boolean(c.masses),
      levels: ['only', 'upto'].includes(c.levels) ? c.levels : 'all',
      terrainScale: clamp(Number(c.terrainScale) || 1, 1, 5),
    });
    if (str(c.levelId)) out.levelId = c.levelId;
  }
  return out;
}

export const camKey = (cam) => cam ? JSON.stringify(normalizeCam(cam)) : 'axo';

// ------------------------------------------------------------ номера видов
//
// viewport.no — номер вида на листе (как «Номер вида» Revit). Без поля —
// по порядку размещения: 1, 2, 3…, пропуская номера, заданные вручную;
// удалили вид — следующие перенумеровываются.

export function viewportNumbers(sheet) {
  const list = sheet?.viewports || [];
  const used = new Set(list.map((vp) => vp.no).filter(Boolean));
  const out = new Map();
  let k = 1;
  for (const vp of list) {
    if (vp.no) { out.set(vp.id, vp.no); continue; }
    while (used.has(String(k))) k += 1;
    out.set(vp.id, String(k));
    k += 1;
  }
  return out;
}

export const viewportNo = (sheet, vp) => viewportNumbers(sheet).get(vp.id) || '';

// Где размещён вид: { sheet, vp, no, mark: 'Л3-1', text: 'Лист 3, вид 1' }
// или null.
export function viewPlacement(project, viewId) {
  const sheet = sheetOfView(project, viewId);
  if (!sheet) return null;
  const vp = sheet.viewports.find((v) => v.viewId === viewId);
  const no = viewportNo(sheet, vp);
  return { sheet, vp, no, mark: `Л${sheet.no}-${no}`, text: `Лист ${sheet.no}, вид ${no}` };
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
  // План крыши (ui/roof-plan.js): только крыши над подложкой этажей; на листы не идёт.
  if (id === ROOF_PLAN_VIEW) return { id, kind: 'roofplan', name: 'План крыши' };
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
export function placeView(project, sheetId, viewId, { x = null, y = null, scale = DEFAULT_VIEW_SCALE, title = null, cam = null } = {}) {
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
  const snapshot = viewId === '3d' && normalizeCam(cam);
  if (snapshot) vp.cam = snapshot;
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
