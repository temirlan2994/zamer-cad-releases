// Состояние редактора и стеки отмены. Чистые данные, без DOM.

export const state = {
  project: null,
  walls: [],
  freeLoops: [], // замкнутые петли стен без помещения (core/bound-rooms.js)
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
  lsVis: { shadows: true, plants: true, covers: true, objects: true, labels: false, notes: true },
  // Стиль графики ландшафта: 'sketch' | 'drawing' (ui/landscape-style.js).
  lsStyle: 'sketch',
  // Тени ландшафта по солнцу (ui/landscape-style.js, ui/landscape-sun.js):
  // { mode: 'off'|'default'|'sun', date, time, analysis }; dragging — тянут ползунок.
  lsSun: { mode: 'default', date: '2026-06-21', time: 900, analysis: false },
  lsSunDragging: false,
  itemHandle: null, // { id, mode } — режим ручек мебели (core/item-handles.js)
  touchDeferSelect: false,
  touchDeferred: null,
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
  // Привязки черчения линий (ui/draw-snap-ui.js, core/draw-snap.js):
  // настройки мини-панели «Привязки», текущий результат и динамический ввод.
  snapSettings: null, // { ortho, polar, polarStep, objects, tracking }
  drawSnap: null, // { point, kind, label, guides, markers, tooltip, prev }
  dynInput: null, // { field: 'length'|'angle', length, angle }
  rejected: new Map(), // roomId -> причины отказов расстановки
  calibration: null, // {p1, p2, measured}
  underlayImg: null,
  pid: null, // идентификатор проекта в хранилище («Проекты»); null — ещё не сохранялся
};

export const history = { undo: [], redo: [] };
