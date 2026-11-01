// Состояние редактора и стеки отмены. Чистые данные, без DOM.

export const state = {
  project: null,
  walls: [],
  modeName: 'plan', // 'plan' | 'site'
  libraryTab: 'rooms', // 'rooms' | 'furniture' — вкладка левой панели (в режиме «План»)
  views: {
    plan: { scale: 0.08, panX: 120, panY: 120 },
    site: { scale: 0.03, panX: 120, panY: 120 },
  },
  view: { scale: 0.08, panX: 120, panY: 120, rotation: 0 },
  selection: null,
  hover: null,
  tool: null, // активный инструмент (размещение, рисование, калибровка...)
  ghost: null,
  ghostOpening: null,
  draft: null, // рисуемая ломаная участка
  marquee: null,
  guides: [],
  rejected: new Map(), // roomId -> причины отказов расстановки
  calibration: null, // {p1, p2, measured}
  underlayImg: null,
};

export const history = { undo: [], redo: [] };
