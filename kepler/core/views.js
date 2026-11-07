// Виды и листы проекта (как в Revit). Чистый модуль без DOM.
//
// Необязательные поля проекта (схема не меняется — kepler-plan/6 в памяти,
// kepler-plan/7 в файле переносят их как есть, старые файлы без них
// открываются):
//   project.views[]  = { id, kind, name, levelId?, dir?, scale?, marks? }
//     kind: 'plan' | 'site' | 'landscape' | '3d' | 'elevation' | 'section';
//     dir — сторона фасада 'N' | 'S' | 'E' | 'W'; scale — знаменатель
//     масштаба (по умолчанию 100); marks: false — отметки уровней скрыты.
//   project.sheets[] = { id, no, name, format: 'A3', orient: 'landscape', viewports: [] }
//     — заготовка: листы пока строятся из sheetPlan() (ui/sheet.js),
//     размещение видов (viewports) — следующий шаг.
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

export function normalizeView(v) {
  if (!isObj(v) || !VIEW_KINDS.includes(v.kind) || !str(v.id)) return null;
  const out = { ...v, name: str(v.name) || (v.kind === 'elevation' && DIR_NAMES[v.dir] ? `Фасад ${DIR_NAMES[v.dir]}` : 'Вид') };
  if (v.kind === 'elevation' && !DIR_NAMES[v.dir]) return null;
  if (v.dir != null && !DIR_NAMES[v.dir]) delete out.dir;
  if (v.levelId != null && !str(v.levelId)) delete out.levelId;
  const scale = Number(v.scale);
  if (scale > 0 && Number.isFinite(scale)) out.scale = Math.round(scale); else delete out.scale;
  if (v.marks !== false) delete out.marks;
  return out;
}

export function normalizeSheet(s, i) {
  if (!isObj(s)) return null;
  return {
    ...s,
    id: str(s.id) || `sheet-${i + 1}`,
    no: str(s.no) || String(s.no ?? i + 1),
    name: str(s.name) || `Лист ${i + 1}`,
    format: str(s.format) || 'A3',
    orient: s.orient === 'portrait' ? 'portrait' : 'landscape',
    viewports: Array.isArray(s.viewports) ? s.viewports.filter(isObj) : [],
  };
}

// Чистка при открытии (core/model.js normalizeProject): нет массива —
// поля нет; битые записи отбрасываются, повторные id — тоже.
export function normalizeViewsAndSheets(data) {
  if (Array.isArray(data.views)) {
    const seen = new Set();
    data.views = data.views.map(normalizeView).filter((v) => v && !seen.has(v.id) && seen.add(v.id));
  } else delete data.views;
  if (Array.isArray(data.sheets)) data.sheets = data.sheets.map(normalizeSheet).filter(Boolean);
  else delete data.sheets;
}
