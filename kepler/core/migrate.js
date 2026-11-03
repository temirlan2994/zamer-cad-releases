// Версии формата файла проекта (.kepler.json) и миграции между ними.
// Чистый модуль без DOM.
//
// Правило: формат меняется только вместе с новой версией схемы и миграцией
// сюда. Старые файлы (и автосохранение в браузере) при открытии проходят
// цепочку миграций v → v+1 → … → SCHEMA_VERSION, поэтому никогда не
// «ломаются». На каждую версию в tests/fixtures лежит настоящий файл.

export const SCHEMA_NAME = 'kepler-plan';
export const SCHEMA_VERSION = 5;
export const SCHEMA = `${SCHEMA_NAME}/${SCHEMA_VERSION}`;

const normDeg = (value) => {
  const n = Number(value);
  return Number.isFinite(n) ? ((n % 360) + 360) % 360 : 0;
};

// MIGRATIONS[n] переводит разобранный JSON версии n в версию n+1.
// Каждая миграция получает копию данных и возвращает новые данные.
export const MIGRATIONS = Object.freeze({
  // v1 → v2: поворот вида «Выровнять» назывался planSiteRot (исторически —
  // поворот только участка в «Плане»). Теперь это поворот камеры в обоих
  // режимах — поле viewRotation (градусы, 0…360).
  1(data) {
    const { planSiteRot, ...rest } = data;
    return { ...rest, viewRotation: normDeg(planSiteRot) };
  },
  // v2 → v3: у дома появилась своя система координат building {rotation,
  // origin}: комнаты — в осях дома, участок — в координатах съёмки. Вид
  // «План» теперь всегда идёт по осям дома, поэтому отдельный поворот камеры
  // viewRotation больше не хранится. Геометрия не меняется: дом стоит там же
  // (поворот 0, начало координат совпадает с миром).
  2(data) {
    const { viewRotation: _dropped, ...rest } = data;
    return { ...rest, building: { rotation: 0, origin: { x: 0, y: 0 } } };
  },
  // v3 → v4: этажи. Комнаты, проёмы, мебель и переопределения стен
  // переезжают в первый этаж levels[0]; активный этаж — activeLevel.
  3(data) {
    const { rooms = [], openings = [], items = [], wallOverrides = {}, ...rest } = data;
    return {
      ...rest,
      levels: [{ id: 'L1', name: '1 этаж', elevation: 0, height: 3000, rooms, openings, items, wallOverrides }],
      activeLevel: 'L1',
    };
  },
  // v4 → v5: составная мебель — у предмета необязательное поле comp
  // (core/composite.js). Обеденный стол раньше сам рисовал условные стулья
  // сверху и снизу; теперь стулья — его части. Чтобы старый план выглядел
  // как прежде, столу без настоящих стульев рядом даётся comp с теми же
  // сторонами. Значения записаны здесь буквально: миграция не зависит от
  // будущих умолчаний.
  4(data) {
    const level = (l) => ({ ...l, items: (l.items || []).map((it, _i, all) => migrateTable4(it, all)) });
    const out = { ...data };
    if (Array.isArray(data.levels)) out.levels = data.levels.map(level);
    if (Array.isArray(data.variants)) {
      out.variants = data.variants.map((v) => (Array.isArray(v?.house?.levels)
        ? { ...v, house: { ...v.house, levels: v.house.levels.map(level) } } : v));
    }
    return out;
  },
});

const TABLES_V4 = new Set(['dining-table', 'dining-table-6', 'conference-table']);
const CHAIR_RE = /chair|stool/;

function migrateTable4(item, all) {
  if (!item || !TABLES_V4.has(item.kind) || item.comp) return item;
  const reach = Math.max(item.w, item.h) / 2 + 700;
  const chairNear = all.some((o) => o !== item && CHAIR_RE.test(String(o?.kind))
    && Math.abs(o.x - item.x) <= reach && Math.abs(o.y - item.y) <= reach);
  if (chairNear) return item; // стулья уже расставлены отдельными предметами
  return {
    ...item,
    comp: {
      type: 'dining', chair: 'chair', offset: 100, spacing: 150,
      sides: { top: true, bottom: true, left: false, right: false }, count: 0,
    },
  };
}

// Номер версии из строки схемы 'kepler-plan/N'; null — не наш файл.
export function schemaVersion(schema) {
  const match = /^kepler-plan\/(\d+)$/.exec(String(schema ?? ''));
  return match ? Number(match[1]) : null;
}

// Приводит данные любой поддерживаемой версии к текущей.
export function migrateProject(data) {
  const version = schemaVersion(data?.schema);
  if (version == null || version < 1) {
    throw new Error('Это не файл проекта Kepler Plan');
  }
  if (version > SCHEMA_VERSION) {
    throw new Error(`Файл создан более новой версией Kepler Plan (формат ${version}, `
      + `здесь поддерживается до ${SCHEMA_VERSION}). Обновите приложение.`);
  }
  let out = JSON.parse(JSON.stringify(data));
  for (let v = version; v < SCHEMA_VERSION; v += 1) {
    const step = MIGRATIONS[v];
    if (!step) throw new Error(`Нет миграции формата ${v} → ${v + 1}`);
    out = step(out);
    out.schema = `${SCHEMA_NAME}/${v + 1}`;
  }
  return out;
}

export { normDeg };
