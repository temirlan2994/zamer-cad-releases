// Состояние редактора и стеки отмены. Чистые данные, без DOM.

export const state = {
  project: null,
  walls: [],
  freeLoops: [], // замкнутые петли стен без помещения (core/bound-rooms.js)
  gaps: [], // нестандартные зазоры этажа (core/gaps.js, без расчёта сдвига)
  issues: null, // замечания для кнопки «⚠» (core/issues.js, ui/issues.js)
  flash: null, // { rects, levelId } — мгновенная подсветка места замечания
  gapFocus: null, // ключ пары, выбранной по маркеру «≠ N мм»
  modeName: 'plan', // 'plan' | 'site' | 'landscape' (вид участка, ui/landscape.js)
  libraryTab: 'rooms', // 'rooms' | 'furniture' | 'stairs' — вкладка библиотеки (в режиме «План»)
  libraryPinned: false, // библиотека открыта кнопкой «Помещение»/«Мебель» (без активного размещения)
  propsTab: 'props', // 'props' | 'views' | 'sheets' | 'tep' — вкладка правой панели (ui/props.js)
  tepTab: 'tep', // 'rooms' (экспликация) | 'tep' (показатели) — подвкладка «ТЭП» (ui/props-tep.js)
  sheetSel: null, // ключ листа, выбранного в «Листах» (ui/props-sheets.js): «Свойства» без выбора — его настройки
  sheetOpen: null, // ключ листа, открытого на холсте (ui/sheet-view.js)
  sheetVp: null, // id видового экрана, выбранного на открытом листе пользователя
  sheetReturn: null, // ключ листа, с которого вид открыт двойным кликом (Esc — назад)
  elevationOpen: null, // id вида-фасада, открытого на холсте (ui/elevation-view.js), например 'elev-N'
  planGrid: null, // координационные оси на плане: { on, dims, sheets, snap } (ui/plan-grids.js, localStorage)
  planMass: null, // эскиз масс на плане: { on, outlineOnly } (ui/plan-masses.js, localStorage)
  ergo: null, // режим «Эргономика»: { on, okZones, heat, groups } (ui/render-ergonomics.js, localStorage)
  ergoFocus: null, // id находки эргономики, подсвеченной кнопкой «Показать»
  // Выбранная комната и слой световой карты. Это состояние вида: в проект
  // не сохраняется, а расчёт лениво кешируется в ui/render-solar.js.
  solarAnalysis: { on: false, roomId: null, mode: 'direct' },
  // Расчётная карта возможностей участка. Это состояние вида:
  // в файле проекта хранится только исходное пятно site.planning.referenceFootprint.
  siteOpportunity: { on: false, result: null, signature: null },
  siteBuildable: null, // производное рабочее пятно; обновляет «Маршрут проекта»
  // Функциональные зоны и связи программы дома — только экранный слой.
  homeProgramOverlay: {
    on: false, zones: false, routes: true, problemsOnly: false,
    selectedScenarioId: null, result: null, signature: null,
  },
  _homeProgramUI: null,
  _homeFlowsUI: null,
  // Предварительный инженерный обзор: потребности, исходные точки и кандидаты,
  // но не автоматически проложенные трубы/воздуховоды.
  homeEngineeringOverlay: { on: false, result: null, signature: null },
  _homeEngineeringUI: null,
  // Детальные маршруты внутри помещений и производная карта нагрузки.
  // Настройки относятся только к виду; в проекте сохраняются лишь явные
  // привязки сценарных точек к мебели или дверям.
  homeCirculationOverlay: {
    on: false, routes: true, heatmap: true, bottlenecks: true,
    metric: 'route_count', period: null, profileWidthMm: 600,
    result: null, signature: null,
  },
  _homeCirculationUI: null,
  planLs: null, // ландшафт на плане: { on, plants, covers, … } (ui/plan-landscape.js, localStorage)
  views: {
    plan: { scale: 0.08, panX: 120, panY: 120 },
    site: { scale: 0.03, panX: 120, panY: 120 },
    landscape: { scale: 0.03, panX: 120, panY: 120 },
  },
  ghostLandscape: null, // призрак объекта ландшафта при постановке
  lsVertex: null, // { id, index } — активная вершина линии/контура ландшафта (Delete удалит её)  // Видимость групп ландшафта (core/landscape.js LANDSCAPE_VIS).
  lsVis: { shadows: true, plants: true, covers: true, objects: true, labels: false, notes: true },
  // Стиль графики ландшафта: 'sketch' | 'drawing' (ui/landscape-style.js).
  lsStyle: 'sketch',
  // Тени ландшафта по солнцу (ui/landscape-style.js, ui/landscape-sun.js):
  // { mode: 'off'|'default'|'sun', date, time, analysis }; dragging — тянут ползунок.
  lsSun: { mode: 'default', date: '2026-06-21', time: 900, analysis: false },
  lsSunDragging: false,
  itemHandle: null, // { id, mode } — режим ручек мебели (core/item-handles.js); у группы id = 'group:…' (core/group-handles.js)
  groupRotateDeg: null, // угол текущего поворота группы мебели — для подписи
  touchDeferSelect: false,
  touchDeferred: null,
  view: { scale: 0.08, panX: 120, panY: 120, rotation: 0 },
  selection: null,
  hover: null,
  tool: null, // активный инструмент (размещение, рисование, калибровка...)
  ghost: null,
  ghostItem: null,
  ghostOpening: null,
  openingPreset: { door: null, window: null }, // параметры до вставки (ui/props.js)
  ghostOpeningFull: null, // проём-превью (для размеров до соседей)
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
  objGuides: null, // умные направляющие перемещения (ui/guides-ui.js): [{ type, from, to, label }]
  slabEdge: null, // активная грань проёма { id, index } во время перетаскивания
  slabEdgeHover: null, // грань выбранного проёма под указателем
  rejected: new Map(), // roomId -> причины отказов расстановки
  layoutVariants: new Map(), // roomId -> эфемерные варианты авторасстановки (не сохраняются в проект)
  calibration: null, // {p1, p2, measured}
  underlayImg: null,
  pid: null, // идентификатор проекта в хранилище («Проекты»); null — ещё не сохранялся
  // Облачный lease: при потере права редактирования UI и все центральные
  // операции записи блокируются. editLeasePid задан только у владельца.
  editLocked: false,
  editLockReason: '',
  editLeasePid: null,
};

export const history = { undo: [], redo: [] };
