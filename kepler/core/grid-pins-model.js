// Привязки стен к координационным осям — формат и чистка (лёгкий модуль без
// зависимостей: его читает core/model.js). Логика — core/grid-pins.js.
//
// Комната: room.axisPins = [{ dir, gridId, off, mode }]
//   dir  — сторона номинальной формы: 'n' | 'e' | 's' | 'w' (грань, смотрящая
//          наружу в эту сторону; у Г-комнаты — та из граней этой стороны,
//          что стоит на оси + off);
//   off  — грань = ось.at + off (мм; 0 — грань на оси, ±толщина стены —
//          наружная грань стены на оси, ±полтолщины — ось стены на оси);
//   mode — как прикрепили: 'face' (по грани) | 'axis' (по оси стены).
// Ручная стена: wall.axisPins = { line?: { gridId, off, mode }, a?: { gridId, off },
//   b?: { gridId, off } } — line: линия оси стены = ось.at + off (параллельная
//   ось); a/b — торец оси стены по своей координате = ось.at + off
//   (перпендикулярная ось). Поле axis у ручной стены уже занято геометрией.
// Необязательные поля, версия схемы не меняется: старые файлы — без них.

export const PIN_DIRS = ['n', 'e', 's', 'w'];
const MODES = new Set(['face', 'axis']);

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : null));
const str = (v) => (typeof v === 'string' && v ? v : null);
const round = (v) => Math.round(v * 100) / 100;

function cleanPin(p, withMode) {
  if (!p || typeof p !== 'object') return null;
  const gridId = str(p.gridId);
  const off = num(p.off ?? 0);
  if (!gridId || off === null) return null;
  const out = { gridId, off: round(off) };
  if (withMode) out.mode = MODES.has(p.mode) ? p.mode : 'face';
  return out;
}

// Привязки комнаты: битые отброшены, дубли (сторона + ось + off) — один раз.
export function normalizeRoomPins(list) {
  if (!Array.isArray(list)) return null;
  const out = [];
  const seen = new Set();
  for (const raw of list) {
    if (!PIN_DIRS.includes(raw?.dir)) continue;
    const p = cleanPin(raw, true);
    if (!p) continue;
    const key = `${raw.dir}|${p.gridId}|${p.off}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ dir: raw.dir, ...p });
  }
  return out.length ? out : null;
}

export function normalizeWallPins(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const out = {};
  const line = cleanPin(v.line, true);
  if (line) out.line = line;
  for (const end of ['a', 'b']) {
    const p = cleanPin(v[end], false);
    if (p) out[end] = p;
  }
  return Object.keys(out).length ? out : null;
}

// Чистка на месте (normalizeRoom / normalizeWall): пустое поле удаляется.
export function cleanRoomPins(room) {
  if (!('axisPins' in room)) return room;
  const pins = normalizeRoomPins(room.axisPins);
  if (pins) room.axisPins = pins; else delete room.axisPins;
  return room;
}

export function cleanWallPins(wall) {
  if (!('axisPins' in wall)) return wall;
  const pins = normalizeWallPins(wall.axisPins);
  if (pins) wall.axisPins = pins; else delete wall.axisPins;
  return wall;
}
