// Состояние редактора и стеки отмены. Чистые данные, без DOM.

export const state = {
  project: null,
  walls: [],
  gaps: [], // нестандартные зазоры этажа (core/gaps.js, без расчёта сдвига)
  gapFocus: null, // ключ пары, выбранной по маркеру «≠ N мм»
  modeName: 'plan', // 'plan' | 'site' | 'landscape' (вид участка, ui/landscape.js)
  libraryTab: 'rooms', // 'rooms' | 'furniture' — вкладка левой панели (в режиме «План»)
  views: {
    plan: { scale: 0.08, panX: 120, panY: 120 },
    site: { scale: 0.03, panX: 120, panY: 120 },
    landscape: { scale: 0.03, panX: 120, panY: 120 },
  },
  ghostLandscape: null, // призрак объекта ландшафта при постановке
  lsVertex: null, // { id, index } — активная вершина линии/контура ландшафта (Delete удалит её)
  // Видимость групп ландшафта (core/landscape.js LANDSCAPE_VIS).
  lsVis: { shadows: true, plants: true, covers: true, objects: true, labels: false },
  view: { scale: 0.08, panX: 120, panY: 120, rotation: 0 },
  selection: null,
  hover: null,
  tool: null, // активный инструмент (размещение, рисование, калибровка...)
  ghost: null,
  ghostItem: null,
  ghostOpening: null,
  pendingRoomSplit: null, // временное деление стены до первого реального сдвига
  splitEdit: null, // ввод точки деления стены: {key, from, end: 'from'|'to', distance}
  _wallUI: null, // кликабельные размеры и ручка выбранной стены
  draft: null, // рисуемая ломаная участка
  marquee: null,
  guides: [],
  rejected: new Map(), // roomId -> причины отказов расстановки
  calibration: null, // {p1, p2, measured}
  underlayImg: null,
  pid: null, // идентификатор проекта в хранилище («Проекты»); null — ещё не сохранялся
};

export const history = { undo: [], redo: [] };
